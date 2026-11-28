/**
 * O MOTOR DOS DOCUMENTOS no servidor: gerar o papel a partir do modelo da empresa, assinar com a
 * prova, e guardar na seção Documentos da ficha do colaborador.
 *
 * Quem pode: "Documentos do colaborador › criar" para gerar e assinar; o tipo ADVERTÊNCIA exige
 * "› disciplinar", que também é o que deixa a pessoa VER esse papel na ficha. O escopo é sempre a
 * EMPRESA da sessão — documento de outra empresa é 404, nunca o arquivo.
 *
 * As duas garantias que valem para tudo aqui:
 *  • O TEXTO É CONGELADO na emissão. Mudar o modelo depois não altera o papel que já foi entregue,
 *    pela mesma razão que o contrato da admissão congela na assinatura.
 *  • O PAPEL SÓ VIRA ANEXO QUANDO ESTÁ PRONTO. Se o modelo pede assinatura, o arquivo entra na
 *    ficha depois que o colaborador assina; antes disso existe a prévia, marcada como prévia.
 *    Documento com cara de final e sem assinatura é pior do que documento nenhum.
 */

import { prisma } from "@/lib/prisma";
import { faixasDoColaborador, textoDaJornada } from "@/lib/colaborador/jornada";
import { formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { formatarDocumento } from "@/lib/documento";
import { formatarPis } from "@/lib/admissao/admissao";
import { validarFoto } from "@/lib/anexos-server";
import { CATEGORIA_PADRAO } from "@/lib/colaborador/documentos";
import { gerarDocumentoPdf } from "@/lib/documentos/documento-pdf";
import {
  ID_CAMPOS_AUTOMATICOS, acaoDoTipo, camposAPreencher, categoriaDoModelo, ehSensivel, erroDosItens,
  limparItens, preencherModelo, tipoDe, tituloDoDocumento, valorNoTexto, valoresDoTipo, vencimentoDe,
  type ItemDocumento,
} from "@/lib/documentos/modelos";
import type { ArquivoGerado } from "@/lib/pdf/resposta";

export class ErroDocumento extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ErroDocumento";
  }
}

export const MSG_NAO_ENCONTRADO = "Documento não encontrado";
export const MSG_MODELO_NAO_ENCONTRADO = "Modelo não encontrado";
export const MSG_SEM_SELFIE = "Tire a foto para concluir a assinatura.";
export const MSG_JA_ASSINADO = "Este documento já foi assinado.";
export const MSG_CANCELADO = "Este documento foi cancelado.";
export const MSG_SEM_ASSINATURA = "Este documento não pede assinatura.";
export const DOCUMENTOS_POR_COLABORADOR_MAX = 300;

const limpo = (v: string | null | undefined) => (v ?? "").trim();
const navegador = (ua: string | null | undefined) => limpo(ua).slice(0, 300) || null;

export interface Origem { ip?: string | null; userAgent?: string | null }

/* ───────────────────────── o que o sistema preenche ───────────────────────── */

const SELECT_COLABORADOR = {
  id: true, nome: true, cpf: true, rg: true, pis: true, email: true, telefone: true,
  ctpsNumero: true, ctpsSerie: true, ctpsUf: true, dataNascimento: true, dataAdmissao: true,
  salario: true, jornadaEntrada: true, jornadaSaida: true, jornadaDias: true, jornadaFaixas: true,
  endereco: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true,
  cargo: { select: { nome: true, cbo: true } },
  empresa: { select: { nome: true, nomeFantasia: true, cnpj: true, cidade: true, estado: true } },
} as const;

type Colaborador = NonNullable<Awaited<ReturnType<typeof carregarColaborador>>>;

async function carregarColaborador(colaboradorId: string, empresaId: string) {
  return prisma.tecnico.findFirst({ where: { id: colaboradorId, empresaId }, select: SELECT_COLABORADOR });
}

/** Endereço numa linha só, como vai no papel. */
function enderecoDe(c: Colaborador): string {
  const rua = [c.endereco, c.numero].filter(Boolean).join(", ");
  const local = [c.bairro, [c.cidade, c.estado].filter(Boolean).join("/")].filter(Boolean).join(" — ");
  return [rua, c.complemento, local, c.cep].filter((p) => limpo(p)).join(" — ");
}

/**
 * Os valores dos campos que o SISTEMA conhece — só do cadastro, nunca de palpite. Campo que o
 * cadastro não tem fica de fora do mapa, e o `{{campo}}` continua visível no papel: quem gera vê
 * na prévia que falta dado, em vez de receber um documento com um buraco silencioso.
 */
export async function dadosAutomaticos(
  colaboradorId: string, empresaId: string, agora: Date = new Date(),
): Promise<{ colaborador: Colaborador; valores: Record<string, string> }> {
  const c = await carregarColaborador(colaboradorId, empresaId);
  if (!c) throw new ErroDocumento("Colaborador não encontrado", 404);

  const contrato = await prisma.admissao.findFirst({
    where: { colaboradorId, empresaId, assinaturaEm: { not: null } },
    orderBy: { assinaturaEm: "desc" },
    select: { assinaturaEm: true },
  });

  const ctps = [c.ctpsNumero, c.ctpsSerie, c.ctpsUf].filter((p) => limpo(p)).join(" / ");
  const empresa = limpo(c.empresa.nomeFantasia) || c.empresa.nome;
  const bruto: Record<string, string | null> = {
    nome: c.nome,
    cpf: c.cpf ? formatarDocumento(c.cpf) : null,
    rg: c.rg,
    pis: c.pis ? formatarPis(c.pis) : null,
    ctps: ctps || null,
    nascimento: c.dataNascimento ? formatarData(c.dataNascimento) : null,
    telefone: c.telefone,
    email: c.email,
    endereco: enderecoDe(c) || null,
    cargo: c.cargo?.nome ?? null,
    cbo: c.cargo?.cbo ?? null,
    salario: c.salario === null || c.salario === undefined ? null : formatarMoeda(Number(c.salario)),
    jornada: textoDaJornada(faixasDoColaborador(c)) || null,
    admissao: c.dataAdmissao ? formatarData(c.dataAdmissao) : null,
    contratoEm: contrato?.assinaturaEm ? formatarData(contrato.assinaturaEm) : null,
    empresa,
    empresaCnpj: c.empresa.cnpj,
    cidade: [c.empresa.cidade, c.empresa.estado].filter(Boolean).join("/") || null,
    data: formatarData(agora),
  };

  const valores: Record<string, string> = {};
  for (const id of ID_CAMPOS_AUTOMATICOS) {
    const v = limpo(bruto[id]);
    if (v) valores[id] = v;
  }
  return { colaborador: c, valores };
}

/* ───────────────────────── gerar ───────────────────────── */

const SELECT_MODELO = {
  id: true, nome: true, tipo: true, texto: true, categoria: true, temItens: true,
  validadeDias: true, exigeAssinatura: true, ativo: true,
} as const;

async function exigirModelo(modeloId: string, empresaId: string) {
  const m = await prisma.documentoModelo.findFirst({ where: { id: modeloId, empresaId }, select: SELECT_MODELO });
  if (!m) throw new ErroDocumento(MSG_MODELO_NAO_ENCONTRADO, 404);
  if (!m.ativo) throw new ErroDocumento("Este modelo está inativo.", 409);
  return m;
}

/** A permissão que o tipo do modelo exige de quem gera. */
export const exigeDisciplinar = (tipo: string) => acaoDoTipo(tipo) === "disciplinar";

export interface DadosGerar {
  modeloId: string;
  /** O que o usuário completou: { motivo: "…", entregaEm: "2026-11-16" } */
  valores?: Record<string, string> | null;
  itens?: Partial<ItemDocumento>[] | null;
}

export interface DocumentoPronto {
  titulo: string;
  texto: string;
  itens: ItemDocumento[];
  /** Campos do tipo que o modelo usa e o usuário deixou em branco */
  faltando: string[];
  /** Campos que o modelo usa e o sistema não conhece — ficam visíveis no texto */
  desconhecidos: string[];
}

/**
 * Monta o papel sem gravar nada: é o que a tela mostra na prévia e o que `gerarDocumento` grava.
 * Campo em branco NÃO é preenchido com palpite — some do mapa e o `{{campo}}` fica à vista.
 */
export async function montarDocumento(
  colaboradorId: string, empresaId: string, dados: DadosGerar, agora: Date = new Date(),
): Promise<DocumentoPronto & { modelo: Awaited<ReturnType<typeof exigirModelo>>; colaborador: Colaborador }> {
  const modelo = await exigirModelo(dados.modeloId, empresaId);
  const { colaborador, valores: automaticos } = await dadosAutomaticos(colaboradorId, empresaId, agora);

  const doUsuario: Record<string, string> = {};
  for (const campo of camposAPreencher(modelo.texto, modelo.tipo)) {
    const v = limpo(dados.valores?.[campo.id]);
    if (v) doUsuario[campo.id] = valorNoTexto(campo, v.slice(0, 2000));
  }
  const faltando = camposAPreencher(modelo.texto, modelo.tipo)
    .filter((c) => c.obrigatorio && !doUsuario[c.id])
    .map((c) => c.rotulo);

  const itens = modelo.temItens ? limparItens(dados.itens) : [];
  const erro = erroDosItens(itens, modelo.tipo);
  if (modelo.temItens && erro) throw new ErroDocumento(erro, 400);

  const juntos = { ...automaticos, ...doUsuario };
  const texto = preencherModelo(modelo.texto, juntos);
  const desconhecidos = [...texto.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

  return {
    modelo, colaborador,
    titulo: modelo.nome,
    texto,
    itens,
    faltando,
    desconhecidos: [...new Set(desconhecidos)],
  };
}

export interface EmitidoResumo {
  id: string;
  tipo: string;
  tipoRotulo: string;
  titulo: string;
  criadoEm: string;
  criadoPor: string | null;
  assinadoEm: string | null;
  assinadoPor: string | null;
  exigeAssinatura: boolean;
  canceladoEm: string | null;
  cancelamentoMotivo: string | null;
  documentoId: string | null;
  itens: number;
}

const SELECT_EMITIDO = {
  id: true, tipo: true, titulo: true, texto: true, itens: true, valores: true,
  empresaId: true, colaboradorId: true, documentoId: true,
  assinaturaNome: true, assinaturaEm: true, assinaturaIp: true, assinaturaUserAgent: true, selfie: true,
  canceladoEm: true, cancelamentoMotivo: true, criadoEm: true,
  criadoPor: { select: { nome: true } },
  modelo: { select: { exigeAssinatura: true, validadeDias: true, categoria: true, nome: true } },
  colaborador: { select: { id: true, nome: true, cpf: true, empresa: { select: { nome: true, nomeFantasia: true, cnpj: true } } } },
} as const;

type LinhaEmitido = NonNullable<Awaited<ReturnType<typeof carregarEmitido>>>;

async function carregarEmitido(id: string, empresaId: string) {
  return prisma.documentoEmitido.findFirst({ where: { id, empresaId }, select: SELECT_EMITIDO });
}

const resumo = (e: LinhaEmitido): EmitidoResumo => ({
  id: e.id,
  tipo: e.tipo,
  tipoRotulo: tipoDe(e.tipo).rotulo,
  titulo: e.titulo,
  criadoEm: e.criadoEm.toISOString(),
  criadoPor: e.criadoPor?.nome ?? null,
  assinadoEm: e.assinaturaEm ? e.assinaturaEm.toISOString() : null,
  assinadoPor: e.assinaturaNome,
  exigeAssinatura: e.modelo?.exigeAssinatura ?? true,
  canceladoEm: e.canceladoEm ? e.canceladoEm.toISOString() : null,
  cancelamentoMotivo: e.cancelamentoMotivo,
  documentoId: e.documentoId,
  itens: Array.isArray(e.itens) ? e.itens.length : 0,
});

/**
 * Gera o papel e grava. O arquivo só entra nos Documentos da ficha quando o documento está pronto:
 * sem assinatura exigida, agora; com assinatura, depois que o colaborador assinar.
 */
export async function gerarDocumento(
  colaboradorId: string, empresaId: string, dados: DadosGerar,
  autor: { usuarioId: string; podeDisciplinar: boolean }, agora: Date = new Date(),
): Promise<EmitidoResumo> {
  const pronto = await montarDocumento(colaboradorId, empresaId, dados, agora);
  if (ehSensivel(pronto.modelo.tipo) && !autor.podeDisciplinar) {
    throw new ErroDocumento("Sem permissão para esta ação", 403);
  }
  if (pronto.faltando.length) {
    throw new ErroDocumento(`Preencha: ${pronto.faltando.join(", ")}.`, 400);
  }

  const quantos = await prisma.documentoEmitido.count({ where: { colaboradorId, canceladoEm: null } });
  if (quantos >= DOCUMENTOS_POR_COLABORADOR_MAX) {
    throw new ErroDocumento("Muitos documentos neste colaborador.", 409);
  }

  const criado = await prisma.documentoEmitido.create({
    data: {
      empresaId,
      colaboradorId,
      modeloId: pronto.modelo.id,
      tipo: pronto.modelo.tipo,
      titulo: pronto.titulo,
      texto: pronto.texto,
      // só os campos do tipo, aparados: o que vai ao banco é o que o documento usa, não o JSON
      // cru que a tela (ou um cliente da API) mandou
      valores: valoresDoTipo(pronto.modelo.tipo, dados.valores) as object,
      itens: pronto.itens as unknown as object,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
    },
    select: SELECT_EMITIDO,
  });

  // Sem assinatura a pedir, o papel já está pronto: vira anexo na hora.
  if (!pronto.modelo.exigeAssinatura) await guardarNosAnexos(criado, agora);
  const depois = (await carregarEmitido(criado.id, empresaId))!;
  return resumo(depois);
}

/* ───────────────────────── assinar ───────────────────────── */

export interface DadosAssinatura { nome: string; selfie: string }

/**
 * A assinatura presencial, no aparelho de quem entrega: nome digitado, foto, e o sistema grava IP,
 * navegador e hora. É a MESMA prova da admissão digital — nenhum mecanismo novo.
 */
export async function assinarDocumento(
  id: string, empresaId: string, dados: DadosAssinatura,
  origem: Origem = {}, agora: Date = new Date(),
): Promise<EmitidoResumo> {
  const e = await carregarEmitido(id, empresaId);
  if (!e) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);
  if (e.canceladoEm) throw new ErroDocumento(MSG_CANCELADO, 409);
  if (!(e.modelo?.exigeAssinatura ?? true)) throw new ErroDocumento(MSG_SEM_ASSINATURA, 409);
  if (e.assinaturaEm) throw new ErroDocumento(MSG_JA_ASSINADO, 409);

  const nome = limpo(dados.nome);
  if (nome.length < 3) throw new ErroDocumento("Digite o nome completo de quem assina.", 400);
  const selfie = limpo(dados.selfie);
  if (!selfie) throw new ErroDocumento(MSG_SEM_SELFIE, 400);
  const foto = validarFoto(selfie);
  if (!foto.ok) throw new ErroDocumento(foto.erro, 400);

  // Uma instrução só: quem decide se ainda dava para assinar é a contagem do próprio UPDATE —
  // dois toques ao mesmo tempo não escrevem a assinatura duas vezes.
  const { count } = await prisma.documentoEmitido.updateMany({
    where: { id: e.id, empresaId, assinaturaEm: null, canceladoEm: null },
    data: {
      assinaturaNome: nome.slice(0, 120),
      assinaturaEm: agora,
      assinaturaIp: origem.ip ?? null,
      assinaturaUserAgent: navegador(origem.userAgent),
      selfie: foto.arquivo.conteudo,
    },
  });
  if (count !== 1) throw new ErroDocumento(MSG_JA_ASSINADO, 409);

  const assinado = (await carregarEmitido(id, empresaId))!;
  await guardarNosAnexos(assinado, agora);
  return resumo((await carregarEmitido(id, empresaId))!);
}

/* ───────────────────────── o anexo na ficha ───────────────────────── */

/**
 * O papel vira anexo na seção Documentos da pessoa — a mesma lista do contrato, do ASO e do RG,
 * sem lista paralela. A validade do modelo vira a data de vencimento, e é ela que alimenta os
 * avisos de "vencido" e "vence em breve" que a ficha e a lista de colaboradores já mostram.
 *
 * Idempotente: se o anexo já existe, devolve o que está lá.
 */
export async function guardarNosAnexos(e: LinhaEmitido, agora: Date = new Date()): Promise<{ id: string }> {
  if (e.documentoId) {
    const existente = await prisma.colaboradorDocumento.findFirst({
      where: { id: e.documentoId, excluidoEm: null }, select: { id: true },
    });
    if (existente) return existente;
  }

  const pdf = await pdfDoEmitido(e, agora);
  const categoria = categoriaDoModelo({ categoria: e.modelo?.categoria ?? null, tipo: e.tipo }) || CATEGORIA_PADRAO;
  const base = e.assinaturaEm ?? e.criadoEm;

  const criado = await prisma.colaboradorDocumento.create({
    data: {
      colaboradorId: e.colaboradorId,
      tipo: categoria,
      categoria,
      nome: tituloDoDocumento(e.titulo, e.colaborador.nome),
      arquivoUrl: `data:application/pdf;base64,${Buffer.from(pdf.bytes).toString("base64")}`,
      arquivoTipo: "application/pdf",
      tamanho: pdf.bytes.length,
      origem: "GERADO",
      dataVencimento: vencimentoDe(e.modelo?.validadeDias ?? null, base),
      criadoEm: agora,
    },
    select: { id: true },
  });
  await prisma.documentoEmitido.update({ where: { id: e.id }, data: { documentoId: criado.id } });
  return criado;
}

/* ───────────────────────── o PDF ───────────────────────── */

async function pdfDoEmitido(e: LinhaEmitido, agora: Date): Promise<ArquivoGerado & { paginas: number }> {
  const empresa = limpo(e.colaborador.empresa.nomeFantasia) || e.colaborador.empresa.nome;
  return gerarDocumentoPdf({
    empresa: { nome: empresa, cnpj: e.colaborador.empresa.cnpj },
    colaborador: { nome: e.colaborador.nome, cpf: e.colaborador.cpf ? formatarDocumento(e.colaborador.cpf) : "—" },
    titulo: e.titulo,
    geradoEm: formatarDataHora(agora),
    texto: e.texto,
    tipo: e.tipo,
    valores: (e.valores ?? null) as Record<string, unknown> | null,
    itens: (Array.isArray(e.itens) ? e.itens : []) as unknown as ItemDocumento[],
    assinatura: e.assinaturaEm
      ? {
          nome: e.assinaturaNome,
          em: formatarDataHora(e.assinaturaEm),
          ip: e.assinaturaIp,
          navegador: e.assinaturaUserAgent,
        }
      : null,
    selfie: e.selfie,
    exigeAssinatura: e.modelo?.exigeAssinatura ?? true,
  });
}

/** O PDF do documento — a prévia enquanto não assinado, o papel final depois. */
export async function pdfDoDocumento(
  id: string, empresaId: string, podeDisciplinar: boolean, agora: Date = new Date(),
): Promise<ArquivoGerado & { paginas: number }> {
  const e = await carregarEmitido(id, empresaId);
  if (!e) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);
  // Papel sensível some para quem não tem a permissão: 404, e não 403 — quem não pode ver não
  // precisa nem saber que ele existe.
  if (ehSensivel(e.tipo) && !podeDisciplinar) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);
  return pdfDoEmitido(e, agora);
}

/* ───────────────────────── histórico e cancelamento ───────────────────────── */

/** O histórico da pessoa: o que foi gerado, quando, por quem, e assinado ou não. */
export async function documentosDoColaborador(
  colaboradorId: string, empresaId: string, podeDisciplinar: boolean,
): Promise<EmitidoResumo[]> {
  const linhas = await prisma.documentoEmitido.findMany({
    where: {
      colaboradorId, empresaId,
      ...(podeDisciplinar ? {} : { tipo: { not: "ADVERTENCIA" } }),
    },
    orderBy: { criadoEm: "desc" },
    select: SELECT_EMITIDO,
  });
  return linhas.map(resumo);
}

/**
 * Cancelar não apaga: guarda quem, quando e por quê, e tira o anexo da ficha (que já é exclusão
 * com rastro). Advertência errada se cancela — não se faz sumir.
 */
export async function cancelarDocumento(
  id: string, empresaId: string, motivo: string,
  autor: { usuarioId: string; podeDisciplinar: boolean }, agora: Date = new Date(),
): Promise<EmitidoResumo> {
  const e = await carregarEmitido(id, empresaId);
  if (!e) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);
  if (ehSensivel(e.tipo) && !autor.podeDisciplinar) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);
  if (e.canceladoEm) throw new ErroDocumento(MSG_CANCELADO, 409);
  const razao = limpo(motivo);
  if (razao.length < 3) throw new ErroDocumento("Diga por que está cancelando.", 400);

  const { count } = await prisma.documentoEmitido.updateMany({
    where: { id: e.id, empresaId, canceladoEm: null },
    data: { canceladoEm: agora, canceladoPorId: autor.usuarioId, cancelamentoMotivo: razao.slice(0, 500) },
  });
  if (count !== 1) throw new ErroDocumento(MSG_CANCELADO, 409);

  // O arquivo sai da ficha com o mesmo rastro de qualquer exclusão de documento
  if (e.documentoId) {
    await prisma.colaboradorDocumento.updateMany({
      where: { id: e.documentoId, excluidoEm: null },
      data: { excluidoEm: agora, excluidoPorId: autor.usuarioId },
    });
  }
  return resumo((await carregarEmitido(id, empresaId))!);
}
