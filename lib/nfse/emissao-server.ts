/**
 * NFS-e PR3 — emissão pelo PlugNotas a partir da MEDIÇÃO (a OS concluída emite pela medição dela).
 * Empresa SEMPRE a da sessão (quem chama passa). Nada de token/credencial aqui: o cliente HTTP
 * (lib/nfse/plugnotas.ts) é o único que fala com o PlugNotas, e toda mensagem que vem de lá é
 * limpa dos segredos antes de ir para o banco ou para a tela.
 *
 * Fluxo: preparar (pré-validação + prévia das notas, uma por código) → emitir (trava a medição,
 * grava as notas como ENVIANDO, envia uma a uma) → consultar (PROCESSANDO → CONCLUIDO/REJEITADO)
 * → autorizada: PDF/XML pelo nosso servidor, nº na medição, medição "NF emitida" e conta a receber
 * liberada. Rejeitada: o motivo fica na nota e os itens voltam a poder ser emitidos.
 */
import { prisma } from "@/lib/prisma";
import { referenciaNota, rotuloMedicao } from "@/lib/faturamento/fatura";
import { digitos } from "@/lib/documento";
import { LABELS_STATUS_MEDICAO } from "@/lib/utils";
import { buscarMunicipio, normalizarNome } from "@/lib/nfse/municipio";
import { ambienteDisponivel, baixarNfse, consultarNfse, emitirNfse, ErroPlugNotas, mensagemLimpa } from "@/lib/nfse/plugnotas";
import { LABEL_AMBIENTE, type Ambiente } from "@/lib/nfse/regras";
import {
  agruparNotas, aguardandoResposta, corpoNotaPlugNotas, LABEL_STATUS_NOTA, lerConsulta, pendenciasEmitente, pendenciasItens,
  pendenciasMedicao, pendenciasNotas, pendenciasTomador, statusVivo,
  type GrupoNota, type ItemEmissao, type Pendencia, type ResultadoConsulta, type StatusNota, type TomadorEmissao,
} from "@/lib/nfse/nota";

export class ErroEmissao extends Error {
  constructor(message: string, public status = 400, public pendencias?: Pendencia[]) { super(message); }
}

/** Emissão em PRODUÇÃO: fechada nesta leva (começamos em homologação). Abre com NFSE_EMISSAO_PRODUCAO=liberada */
export const producaoLiberada = () => process.env.NFSE_EMISSAO_PRODUCAO === "liberada";
/** Intervalo mínimo entre duas consultas da mesma nota (a tela consulta sozinha enquanto processa) */
export const INTERVALO_CONSULTA_MS = 5_000;
/** Sem o id do PlugNotas e sem registro lá depois disto: o envio não chegou (pode emitir de novo) */
export const PRAZO_SEM_REGISTRO_MS = 2 * 60_000;

export interface Ator { id: string; empresaId: string }

const SELECT_SERVICO = {
  id: true, nome: true, codigoLc116: true, codigoMunicipal: true, aliquotaISS: true, nfseTributacao: true,
  issRetido: true, cnae: true, discriminacaoPadrao: true,
} as const;

/* ───────── Código IBGE da cidade do cliente ───────── */
const cacheIbge = new Map<string, { codigo: string | null; ate: number }>();
const HORA = 3_600_000;

async function codigoCidadeTomador(c: { cep?: string | null; cidade?: string | null; estado?: string | null }, fiscal: { codigoMunicipio: string | null; municipioNome: string | null; municipioUf: string | null } | null) {
  const cidade = c.cidade?.trim() ?? "";
  const uf = c.estado?.trim().toUpperCase() ?? "";
  if (!cidade || !/^[A-Z]{2}$/.test(uf)) return null;
  // Mesma cidade do emitente (o caso mais comum): o código já está nos Dados fiscais
  if (fiscal?.codigoMunicipio && fiscal.municipioUf?.toUpperCase() === uf && normalizarNome(fiscal.municipioNome ?? "") === normalizarNome(cidade)) {
    return fiscal.codigoMunicipio;
  }
  const chave = `${digitos(c.cep ?? "")}|${uf}|${normalizarNome(cidade)}`;
  const guardado = cacheIbge.get(chave);
  if (guardado && guardado.ate > Date.now()) return guardado.codigo;
  const m = await buscarMunicipio({ cep: c.cep, cidade, uf });
  const codigo = m && m.uf === uf ? m.codigo : null;
  cacheIbge.set(chave, { codigo, ate: Date.now() + (codigo ? 24 * HORA : HORA / 12) });
  return codigo;
}

/* ───────── Carregar e preparar ───────── */
async function carregar(empresaId: string, medicaoId: string) {
  const [medicao, empresa, config] = await Promise.all([
    prisma.medicao.findFirst({
      where: { id: medicaoId, empresaId },
      include: {
        cliente: true,
        itens: { orderBy: { ordem: "asc" }, include: { servico: { select: SELECT_SERVICO }, ordemServico: { select: { id: true, numero: true, chamadoNumero: true } } } },
        nfs: true,
        contasReceber: { where: { status: { not: "CANCELADO" } }, orderBy: { criadoEm: "asc" }, select: { id: true } },
        notasFiscais: { select: { id: true, status: true, numero: true, itens: { select: { medicaoItemId: true } } } },
      },
    }),
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { cnaePrincipal: true, fiscal: true } }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { issAliquota: true } }),
  ]);
  if (!medicao) throw new ErroEmissao("Medição não encontrada.", 404);
  return { medicao, fiscal: empresa?.fiscal ?? null, cnaeEmpresa: empresa?.cnaePrincipal ?? null, aliquotaPadrao: config?.issAliquota != null ? Number(config.issAliquota) : null };
}
type Carga = Awaited<ReturnType<typeof carregar>>;

const ambienteDe = (fiscal: Carga["fiscal"]): Ambiente => (fiscal?.ambiente === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO");

/** Itens da medição com o que a emissão precisa (e se já estão numa nota viva) */
function itensDe(c: Carga): ItemEmissao[] {
  const emNota = new Set(c.medicao.notasFiscais.filter((n) => statusVivo(n.status)).flatMap((n) => n.itens.map((i) => i.medicaoItemId)));
  return c.medicao.itens.map((it) => ({
    id: it.id,
    tipo: it.tipo,
    descricao: it.descricao,
    quantidade: Number(it.quantidade),
    valorTotal: Number(it.valorTotal),
    servico: it.servico ? { ...it.servico, aliquotaISS: it.servico.aliquotaISS != null ? Number(it.servico.aliquotaISS) : null } : null,
    emNota: emNota.has(it.id),
  }));
}

/** NF registrada à mão (Registrar NF) que não é uma nota emitida aqui */
function nfManual(c: Carga): string | null {
  const nossas = new Set(c.medicao.notasFiscais.flatMap((n) => [n.numero, n.id]).filter(Boolean));
  return c.medicao.nfs.find((nf) => !nossas.has(nf.numero))?.numero ?? null;
}

function tomadorDe(c: Carga, codigoCidade: string | null): TomadorEmissao {
  const cl = c.medicao.cliente;
  return {
    id: cl.id, nome: cl.nome, cpfCnpj: cl.cpfCnpj, email: cl.emailsFaturamento?.[0] || cl.email,
    endereco: cl.endereco, numero: cl.numero, complemento: cl.complemento, bairro: cl.bairro,
    cidade: cl.cidade, estado: cl.estado, cep: cl.cep, codigoCidade,
  };
}

/** Os números das OS que entraram na medição (para a referência da discriminação) */
const numerosOs = (c: Carga) => [...new Set(c.medicao.itens.map((i) => i.ordemServico?.chamadoNumero ?? i.ordemServico?.numero).filter(Boolean))] as string[];

async function preparar(empresaId: string, medicaoId: string) {
  const c = await carregar(empresaId, medicaoId);
  const ambiente = ambienteDe(c.fiscal);
  const emitente = {
    status: c.fiscal?.status ?? "NAO_CONFIGURADO", cnpj: c.fiscal?.emitenteCnpj ?? null, ambiente,
    emitenteAmbiente: c.fiscal?.emitenteAmbiente ?? null, certificadoValidoAte: c.fiscal?.certificadoValidoAte ?? null,
    tokenDisponivel: ambienteDisponivel(ambiente), producaoLiberada: producaoLiberada(),
  };
  const itens = itensDe(c);
  const opcoes = { aliquotaPadrao: c.aliquotaPadrao, cnaeEmpresa: c.cnaeEmpresa };
  const grupos = agruparNotas(itens, Number(c.medicao.valorTotal) - Number(c.medicao.valorLiquido), opcoes, { medicaoNumero: c.medicao.numero, osNumeros: numerosOs(c), referencia: referenciaNota(c.medicao) });
  const tomador = tomadorDe(c, await codigoCidadeTomador(c.medicao.cliente, c.fiscal));
  const pendencias = [
    ...pendenciasEmitente(emitente),
    ...pendenciasMedicao({ id: c.medicao.id, numero: c.medicao.numero, status: c.medicao.status, nfManual: nfManual(c) }, LABELS_STATUS_MEDICAO[c.medicao.status] ?? c.medicao.status),
    ...pendenciasTomador(tomador),
    ...pendenciasItens(itens, opcoes),
  ];
  return { c, ambiente, itens, grupos, tomador, pendencias };
}

const grupoParaTela = (g: GrupoNota) => ({
  chave: g.chave, rotulo: g.rotulo, codigoLc116: g.codigoLc116, codigoTributacao: g.codigoTributacao,
  aliquota: g.aliquota, retido: g.retido, valorServicos: g.valorServicos, valorDesconto: g.valorDesconto, discriminacao: g.discriminacao,
  itens: g.itens.map(({ item, desconto }) => ({ id: item.id, descricao: item.descricao, quantidade: item.quantidade, valorTotal: item.valorTotal, desconto })),
});

/** O que a tela "Emitir NFS-e" mostra: o que falta, as notas que vão sair e o que fica de fora */
export async function previaEmissao(empresaId: string, medicaoId: string) {
  const p = await preparar(empresaId, medicaoId);
  const produtos = p.itens.filter((i) => i.tipo === "PRODUTO");
  return {
    medicao: { id: p.c.medicao.id, numero: p.c.medicao.numero, status: p.c.medicao.status, rotulo: rotuloMedicao(p.c.medicao) },
    ambiente: p.ambiente,
    ambienteLabel: LABEL_AMBIENTE[p.ambiente],
    tomador: { nome: p.tomador.nome, cpfCnpj: p.tomador.cpfCnpj },
    pendencias: p.pendencias,
    grupos: p.grupos.map(grupoParaTela),
    itensSemServico: p.itens.filter((i) => i.tipo === "SERVICO" && !i.emNota && !i.servico && i.valorTotal > 0).map((i) => ({ id: i.id, descricao: i.descricao, valorTotal: i.valorTotal })),
    jaEmNota: p.itens.filter((i) => i.emNota).length,
    produtos: { quantidade: produtos.length, valor: produtos.reduce((s, i) => s + i.valorTotal, 0) },
  };
}

/* ───────── Item sem serviço do catálogo ───────── */

/**
 * Liga um item de serviço da medição (sem serviço do catálogo) ao serviço escolhido na tela de
 * emissão, de onde vêm os dados fiscais. Só PREENCHE: item que já tem serviço, de outra medição,
 * produto ou já numa nota viva não muda. O valor do item não muda (medição aprovada continua igual).
 */
export async function vincularServicoItem(empresaId: string, medicaoId: string, itemId: string, servicoId: string) {
  const servico = await prisma.servico.findFirst({ where: { id: servicoId, empresaId }, select: { id: true } });
  if (!servico) throw new ErroEmissao("Serviço não encontrado.", 400);
  const emNota = await prisma.notaFiscalItem.count({ where: { medicaoItemId: itemId, nota: { status: { in: ["ENVIANDO", "PROCESSANDO", "CONCLUIDO"] } } } });
  if (emNota) throw new ErroEmissao("Este item já está numa nota.", 409);
  const { count } = await prisma.medicaoItem.updateMany({ where: { id: itemId, medicaoId, medicao: { empresaId }, tipo: "SERVICO", servicoId: null }, data: { servicoId } });
  if (!count) throw new ErroEmissao("Item não encontrado (ou já tem serviço).", 404);
}

/* ───────── Emitir ───────── */
export interface OpcoesEmitir {
  origem: "OS" | "MEDICAO";
  ordemServicoId?: string | null;
  /** Discriminação ajustada na tela, por nota (chave do grupo) */
  discriminacoes?: Record<string, string>;
}

export async function registrar(notaId: string, tipo: "ENVIO" | "CONSULTA" | "STATUS" | "ERRO", o: { usuarioId?: string | null; status?: string | null; mensagem?: string | null }) {
  await prisma.notaFiscalEvento.create({ data: { notaId, tipo, usuarioId: o.usuarioId ?? null, status: o.status ?? null, mensagem: o.mensagem ?? null } });
}

async function historicoOs(osIds: (string | null | undefined)[], usuarioId: string | null, acao: string, detalhes: string) {
  const ids = [...new Set(osIds.filter(Boolean))] as string[];
  if (!usuarioId || !ids.length) return;
  await prisma.osHistorico.createMany({ data: ids.map((ordemServicoId) => ({ ordemServicoId, usuarioId, acao, detalhes })) });
}

export async function emitirNotas(ator: Ator, medicaoId: string, o: OpcoesEmitir) {
  const { empresaId } = ator;
  if (o.ordemServicoId) {
    const daMedicao = await prisma.medicaoItem.count({ where: { medicaoId, ordemServicoId: o.ordemServicoId, medicao: { empresaId } } });
    if (!daMedicao) throw new ErroEmissao("A OS não faz parte desta medição.", 400);
  }

  const p = await preparar(empresaId, medicaoId);
  const grupos = p.grupos.map((g) => ({ ...g, discriminacao: (o.discriminacoes?.[g.chave] ?? g.discriminacao).trim() }));
  const pendencias = [...p.pendencias, ...pendenciasNotas(grupos)];
  if (pendencias.length) throw new ErroEmissao("Falta corrigir alguns dados antes de emitir.", 409, pendencias);
  if (!grupos.length) throw new ErroEmissao("Nada a emitir: os serviços desta medição já estão em notas (ou não há serviço com valor).", 409);

  const prestadorCnpj = p.c.fiscal!.emitenteCnpj!;
  const contaReceberId = p.c.medicao.contasReceber[0]?.id ?? null;
  // Trava a medição: duas emissões ao mesmo tempo (clique duplo, duas abas) não geram nota em dobro
  const notas = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM medicoes WHERE id = ${medicaoId} FOR UPDATE`;
    const ocupados = await tx.notaFiscalItem.findMany({
      where: { medicaoItemId: { in: grupos.flatMap((g) => g.itens.map(({ item }) => item.id)) }, nota: { status: { in: ["ENVIANDO", "PROCESSANDO", "CONCLUIDO"] } } },
      select: { id: true },
    });
    if (ocupados.length) throw new ErroEmissao("Outra emissão desta medição acabou de começar. Atualize a tela.", 409);
    const criadas = [];
    for (const g of grupos) {
      criadas.push(await tx.notaFiscal.create({
        data: {
          empresaId, medicaoId, ordemServicoId: o.ordemServicoId ?? null, clienteId: p.c.medicao.clienteId, contaReceberId,
          origem: o.origem, ambiente: p.ambiente, status: "ENVIANDO", grupo: g.chave,
          codigoLc116: g.codigoLc116, codigoTributacao: g.codigoTributacao, aliquotaIss: g.aliquota, issRetido: g.retido,
          valorServicos: g.valorServicos, valorDesconto: g.valorDesconto, discriminacao: g.discriminacao,
          tomadorCpfCnpj: digitos(p.tomador.cpfCnpj), tomadorNome: p.tomador.nome.trim(), emitidaPorId: ator.id,
          itens: {
            create: g.itens.map(({ item, desconto }) => ({
              medicaoItemId: item.id, servicoId: item.servico?.id ?? null, descricao: item.descricao,
              quantidade: item.quantidade, valorTotal: item.valorTotal, valorDesconto: desconto,
            })),
          },
        },
      }));
    }
    return criadas;
  });

  const osIds = [o.ordemServicoId, ...p.c.medicao.itens.map((i) => i.ordemServicoId)];
  const resultado = [];
  for (const [i, nota] of notas.entries()) {
    const g = grupos[i];
    const corpo = corpoNotaPlugNotas({
      id: nota.id, prestadorCnpj, tomador: p.tomador, servico: g.servico, discriminacao: g.discriminacao,
      valorServicos: g.valorServicos, valorDesconto: g.valorDesconto,
    });
    try {
      const r = await emitirNfse(p.ambiente, corpo);
      await prisma.notaFiscal.update({ where: { id: nota.id }, data: { plugnotasId: r.id, protocolo: r.protocolo, status: "PROCESSANDO", motivo: null } });
      await registrar(nota.id, "ENVIO", { usuarioId: ator.id, status: "PROCESSANDO", mensagem: `Enviada ao PlugNotas (${LABEL_AMBIENTE[p.ambiente]})${r.protocolo ? ` · protocolo ${r.protocolo}` : ""}.` });
      resultado.push({ id: nota.id, status: "PROCESSANDO" as StatusNota });
    } catch (e) {
      const incerto = !(e instanceof ErroPlugNotas) || e.incerto;
      const msg = e instanceof ErroPlugNotas ? e.message : "Erro inesperado no envio.";
      // Sem resposta: pode ter chegado. Fica ENVIANDO e a consulta pelo nosso id decide
      const status: StatusNota = incerto ? "ENVIANDO" : "REJEITADO";
      await prisma.notaFiscal.update({ where: { id: nota.id }, data: { status, motivo: incerto ? `${msg} Consultando o status…` : msg } });
      await registrar(nota.id, "ERRO", { usuarioId: ator.id, status, mensagem: msg });
      if (!(e instanceof ErroPlugNotas)) console.error("[nfse] erro inesperado no envio", nota.id, (e as Error)?.name);
      resultado.push({ id: nota.id, status });
    }
  }
  await historicoOs(osIds, ator.id, "NFS-e enviada",
    `${notas.length} ${notas.length === 1 ? "nota" : "notas"} da ${rotuloMedicao(p.c.medicao).replace(/^\w/, (l) => l.toLowerCase())} (${LABEL_AMBIENTE[p.ambiente]}): ${grupos.map((g) => g.rotulo).join("; ")}`);
  return resultado;
}

/* ───────── Consultar e aplicar a situação ───────── */
type NotaBanco = NonNullable<Awaited<ReturnType<typeof prisma.notaFiscal.findFirst>>>;

/** Aplica o que o PlugNotas devolveu. Mudou de status = evento; autorizada = efeitos na medição */
export async function aplicarSituacao(nota: NotaBanco, r: ResultadoConsulta, usuarioId: string | null) {
  const novo: StatusNota = r.status ?? (nota.status === "ENVIANDO" && r.id ? "PROCESSANDO" : (nota.status as StatusNota));
  const rejeitada = novo === "REJEITADO" || novo === "INTERROMPIDO";
  const data = {
    plugnotasId: nota.plugnotasId ?? r.id,
    status: novo,
    numero: r.numero ?? nota.numero,
    codigoVerificacao: r.codigoVerificacao ?? nota.codigoVerificacao,
    pdfUrl: r.pdf ?? nota.pdfUrl,
    xmlUrl: r.xml ?? nota.xmlUrl,
    autorizadaEm: novo === "CONCLUIDO" ? (nota.autorizadaEm ?? r.autorizadaEm ?? new Date()) : nota.autorizadaEm,
    motivo: rejeitada ? mensagemLimpa(r.mensagem || "A prefeitura não aceitou a nota (o PlugNotas não informou o motivo).") : novo === "CONCLUIDO" ? null : nota.motivo,
  };
  // Só grava se ninguém mudou a nota no meio (consulta e webhook ao mesmo tempo)
  const { count } = await prisma.notaFiscal.updateMany({ where: { id: nota.id, status: nota.status }, data });
  if (!count || novo === nota.status) return { ...nota, ...data };
  await registrar(nota.id, "STATUS", {
    usuarioId, status: novo,
    mensagem: novo === "CONCLUIDO" ? `Autorizada${data.numero ? `: NFS-e nº ${data.numero}` : ""}.` : rejeitada ? data.motivo : LABEL_STATUS_NOTA[novo],
  });
  if (novo === "CONCLUIDO") await efeitosAutorizacao(nota.id, usuarioId);
  if (rejeitada) {
    const os = await osDaNota(nota.id);
    await historicoOs([nota.ordemServicoId, ...os], usuarioId, "NFS-e rejeitada", data.motivo ?? "");
  }
  return { ...nota, ...data };
}

async function osDaNota(notaId: string) {
  const itens = await prisma.notaFiscalItem.findMany({ where: { notaId }, select: { medicaoItem: { select: { ordemServicoId: true } } } });
  return itens.map((i) => i.medicaoItem?.ordemServicoId);
}

/**
 * Nota autorizada: o nº entra na medição (e na lista de NFs dela). Quando TODOS os serviços da
 * medição estão em notas autorizadas e a medição esperava a NF (PC recebido), ela vira "NF emitida"
 * e a conta a receber passa a "A receber" — o mesmo que o "Registrar NF" manual faz.
 */
async function efeitosAutorizacao(notaId: string, usuarioId: string | null) {
  const nota = await prisma.notaFiscal.findUnique({ where: { id: notaId } });
  if (!nota?.medicaoId) return;
  const medicao = await prisma.medicao.findUnique({
    where: { id: nota.medicaoId },
    include: {
      itens: { where: { tipo: "SERVICO", valorTotal: { gt: 0 } }, select: { id: true } },
      nfs: { select: { numero: true } },
      notasFiscais: { where: { status: "CONCLUIDO" }, select: { numero: true, id: true, itens: { select: { medicaoItemId: true } } } },
    },
  });
  if (!medicao) return;
  const numeroNf = nota.numero ?? nota.id;
  if (!medicao.nfs.some((nf) => nf.numero === numeroNf)) {
    await prisma.medicaoNf.create({ data: { medicaoId: medicao.id, numero: numeroNf, url: `/api/fiscal/notas/${nota.id}/arquivo?tipo=pdf` } });
  }
  const cobertos = new Set(medicao.notasFiscais.flatMap((n) => n.itens.map((i) => i.medicaoItemId)));
  const completa = medicao.itens.every((i) => cobertos.has(i.id));
  const numeros = medicao.notasFiscais.map((n) => n.numero ?? n.id).join(", ");
  await prisma.medicao.update({
    where: { id: medicao.id },
    data: { nfNumero: numeros || numeroNf, ...(completa && medicao.status === "PC_RECEBIDO" ? { status: "NF_EMITIDA" as const } : {}) },
  });
  if (completa) {
    await prisma.contaReceber.updateMany({ where: { medicaoId: medicao.id, status: "PREVISTO" }, data: { status: "A_RECEBER" } });
  }
  const os = await osDaNota(nota.id);
  await historicoOs([nota.ordemServicoId, ...os], usuarioId, "NFS-e autorizada", `NFS-e nº ${numeroNf} da ${rotuloMedicao(medicao).replace(/^\w/, (l) => l.toLowerCase())}`);
}

/**
 * Consulta a situação da nota no PlugNotas (só enquanto espera resposta; no máximo uma vez a cada
 * 5 s por nota). Sem o id do PlugNotas (o envio ficou sem resposta), consulta pelo nosso id: se lá
 * não existe registro depois de 2 min, a nota fica INTERROMPIDA e pode ser emitida de novo.
 */
export async function consultarNota(
  ator: Ator | { id: null; empresaId: string }, notaId: string, agora = new Date(),
  /** O aviso do PlugNotas consulta mesmo logo depois da tela (só não repete no mesmo segundo) */
  opcoes: { intervaloMs?: number } = {},
) {
  const nota = await prisma.notaFiscal.findFirst({ where: { id: notaId, empresaId: ator.empresaId } });
  if (!nota) throw new ErroEmissao("Nota não encontrada.", 404);
  if (!aguardandoResposta(nota.status)) return nota;
  const intervalo = opcoes.intervaloMs ?? INTERVALO_CONSULTA_MS;
  if (nota.ultimaConsultaEm && agora.getTime() - nota.ultimaConsultaEm.getTime() < intervalo) return nota;
  const fiscal = await prisma.empresaFiscal.findUnique({ where: { empresaId: ator.empresaId }, select: { emitenteCnpj: true } });
  await prisma.notaFiscal.update({ where: { id: nota.id }, data: { consultas: { increment: 1 }, ultimaConsultaEm: agora } });
  let corpo: unknown;
  try {
    corpo = await consultarNfse(nota.ambiente as Ambiente, { id: nota.plugnotasId, idIntegracao: nota.id, cnpj: fiscal?.emitenteCnpj ?? "" });
  } catch (e) {
    if (!(e instanceof ErroPlugNotas)) throw e;
    await registrar(nota.id, "CONSULTA", { usuarioId: ator.id, status: nota.status, mensagem: e.message });
    throw new ErroEmissao(e.message, e.status >= 500 ? 502 : 422);
  }
  const r = corpo == null ? null : lerConsulta(corpo, { id: nota.plugnotasId, idIntegracao: nota.id });
  if (!r) {
    if (!nota.plugnotasId && agora.getTime() - nota.criadoEm.getTime() > PRAZO_SEM_REGISTRO_MS) {
      return aplicarSituacao(nota, {
        id: null, situacao: "INTERROMPIDO", status: "INTERROMPIDO", numero: null, codigoVerificacao: null, pdf: null, xml: null, autorizadaEm: null,
        mensagem: "O PlugNotas não tem registro desta nota (o envio não chegou lá). Pode emitir de novo.",
      }, ator.id);
    }
    return nota;
  }
  return aplicarSituacao(nota, r, ator.id);
}

/* ───────── Listar e baixar ───────── */
const SELECT_NOTA = {
  id: true, status: true, origem: true, ambiente: true, codigoLc116: true, codigoTributacao: true, aliquotaIss: true, issRetido: true,
  valorServicos: true, valorDesconto: true, discriminacao: true, tomadorNome: true, tomadorCpfCnpj: true, protocolo: true,
  numero: true, codigoVerificacao: true, autorizadaEm: true, motivo: true, criadoEm: true, medicaoId: true, ordemServicoId: true,
  contaReceber: { select: { id: true, numero: true } },
  medicao: { select: { id: true, numero: true, avulsa: true } },
  emitidaPor: { select: { nome: true } },
  itens: { select: { descricao: true, valorTotal: true } },
  eventos: { orderBy: { criadoEm: "desc" as const }, take: 20, select: { tipo: true, status: true, mensagem: true, criadoEm: true, usuario: { select: { nome: true } } } },
} as const;

export async function listarNotas(empresaId: string, filtro: { medicaoId?: string; ordemServicoId?: string }) {
  const where = filtro.medicaoId
    ? { empresaId, medicaoId: filtro.medicaoId }
    : { empresaId, OR: [{ ordemServicoId: filtro.ordemServicoId }, { itens: { some: { medicaoItem: { ordemServicoId: filtro.ordemServicoId } } } }] };
  const notas = await prisma.notaFiscal.findMany({ where, orderBy: { criadoEm: "desc" }, select: SELECT_NOTA });
  return notas.map((n) => ({
    ...n,
    medicao: n.medicao ? { id: n.medicao.id, numero: n.medicao.numero, rotulo: rotuloMedicao(n.medicao) } : null,
    statusLabel: LABEL_STATUS_NOTA[n.status as StatusNota] ?? n.status,
    valorServicos: Number(n.valorServicos), valorDesconto: Number(n.valorDesconto), aliquotaIss: n.aliquotaIss != null ? Number(n.aliquotaIss) : null,
    itens: n.itens.map((i) => ({ descricao: i.descricao, valorTotal: Number(i.valorTotal) })),
  }));
}

/** O PDF (DANFSE) ou o XML da nota autorizada, buscado no PlugNotas com o token (que nunca vai para a tela) */
export async function arquivoNota(empresaId: string, notaId: string, tipo: "pdf" | "xml") {
  const nota = await prisma.notaFiscal.findFirst({ where: { id: notaId, empresaId }, select: { status: true, plugnotasId: true, ambiente: true, numero: true } });
  if (!nota) throw new ErroEmissao("Nota não encontrada.", 404);
  if ((nota.status !== "CONCLUIDO" && nota.status !== "CANCELADO") || !nota.plugnotasId) {
    throw new ErroEmissao("O PDF e o XML só existem depois que a nota é autorizada.", 409);
  }
  try {
    const a = await baixarNfse(nota.ambiente as Ambiente, tipo, nota.plugnotasId);
    return { ...a, nome: `nfse-${(nota.numero ?? notaId).replace(/[^\w.-]+/g, "")}.${tipo}` };
  } catch (e) {
    if (e instanceof ErroPlugNotas) throw new ErroEmissao(e.message, 502);
    throw e;
  }
}
