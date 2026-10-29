/**
 * NFS-e PR3 — a NOTA emitida pelo PlugNotas: regras puras (servidor, tela e testes usam as mesmas).
 *
 * De onde sai: da MEDIÇÃO (o documento de cobrança: tem os valores aprovados, o desconto, a conta a
 * receber e, em cada item, o serviço do catálogo com os dados fiscais). A OS concluída emite pela
 * medição em que ela entrou.
 *
 * O que vai em cada nota (POST /nfse do PlugNotas, um array de notas; enviamos uma por requisição):
 *   { idIntegracao, prestador: { cpfCnpj }, tomador: { cpfCnpj, razaoSocial, email?, endereco },
 *     servico: [ { codigo, codigoTributacao, discriminacao, cnae?, iss, responsavelRetencao?, valor } ] }
 *
 * Uma nota por código: a prefeitura (ex.: Senador Canedo) não aceita códigos diferentes na mesma
 * nota. Os itens de serviço são agrupados pelo que vai no `servico` da nota: código municipal
 * (`codigoTributacao`), LC 116, CNAE e a regra de ISS (tributação, alíquota, retido). Itens com o
 * mesmo código mas ISS diferente também vão em notas separadas (uma nota tem uma alíquota só).
 * Produtos não entram na NFS-e.
 */
import { cnpjValido, cpfValido, digitos } from "@/lib/documento";
import { formatarMoeda } from "@/lib/utils";
import { pendenciasServicoNfse, servicoPlugNotas, type ServicoFiscal } from "@/lib/nfse/servico";
import { ehCodigoIbge, LABEL_AMBIENTE, separarLogradouro, type Ambiente } from "@/lib/nfse/regras";

/* ───────── Status ───────── */
export const STATUS_NOTA = ["ENVIANDO", "PROCESSANDO", "CONCLUIDO", "REJEITADO", "CANCELADO", "INTERROMPIDO"] as const;
export type StatusNota = (typeof STATUS_NOTA)[number];
export const LABEL_STATUS_NOTA: Record<StatusNota, string> = {
  ENVIANDO: "Enviando",
  PROCESSANDO: "Processando na prefeitura",
  CONCLUIDO: "Autorizada",
  REJEITADO: "Rejeitada",
  CANCELADO: "Cancelada",
  INTERROMPIDO: "Interrompida",
};
/** Nota "viva": os itens dela não podem entrar em outra nota */
export const STATUS_VIVOS: readonly StatusNota[] = ["ENVIANDO", "PROCESSANDO", "CONCLUIDO"];
export const statusVivo = (s: string) => (STATUS_VIVOS as readonly string[]).includes(s);
/** Esperando a resposta da prefeitura: a tela consulta sozinha */
export const aguardandoResposta = (s: string) => s === "ENVIANDO" || s === "PROCESSANDO";

/**
 * Situação devolvida pelo PlugNotas (consulta ou webhook) → status da nota. Desconhecida = null
 * (a nota fica como estava). Aceita variações de grafia (acento, feminino, "EXCEPTION").
 */
export function statusDaSituacao(situacao: unknown): StatusNota | null {
  const s = String(situacao ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  if (!s) return null;
  if (["CONCLUIDO", "CONCLUIDA", "AUTORIZADO", "AUTORIZADA"].includes(s)) return "CONCLUIDO";
  if (["PROCESSANDO", "EM_PROCESSAMENTO", "AGUARDANDO", "PENDENTE"].includes(s)) return "PROCESSANDO";
  if (["REJEITADO", "REJEITADA", "DENEGADO", "DENEGADA"].includes(s)) return "REJEITADO";
  if (["CANCELADO", "CANCELADA"].includes(s)) return "CANCELADO";
  if (["INTERROMPIDO", "INTERROMPIDA", "EXCEPTION", "EXCECAO", "ERRO"].includes(s)) return "INTERROMPIDO";
  return null;
}

/* ───────── Pré-validação: o que falta (com o link para corrigir) ───────── */
export type AreaPendencia = "emitente" | "medicao" | "tomador" | "servico" | "item" | "nota";
export interface Pendencia { area: AreaPendencia; texto: string; link?: string; rotuloLink?: string; itemId?: string; chave?: string }

const LINK_FISCAL = "/configuracoes/dados-fiscais";
const LINK_SERVICOS = "/configuracoes/servicos";

export interface EmitenteEmissao {
  /** status do emitente no Frivo (PR1): ATIVO = cadastrado no PlugNotas */
  status: string;
  cnpj: string | null;
  ambiente: Ambiente;
  /** ambiente em que o emitente foi cadastrado no PlugNotas */
  emitenteAmbiente: string | null;
  certificadoValidoAte: Date | null;
  /** o servidor tem o token do PlugNotas deste ambiente */
  tokenDisponivel: boolean;
  /** emissão em produção liberada (nesta leva: não, começamos em homologação) */
  producaoLiberada: boolean;
}

export function pendenciasEmitente(e: EmitenteEmissao, agora: Date = new Date()): Pendencia[] {
  const p: Pendencia[] = [];
  const add = (texto: string) => p.push({ area: "emitente", texto, link: LINK_FISCAL, rotuloLink: "Abrir Dados fiscais" });
  if (e.status !== "ATIVO" || !e.cnpj) {
    add("A empresa ainda não está ativa como emitente no PlugNotas.");
    return p;
  }
  if (e.emitenteAmbiente !== e.ambiente) {
    add(`O emitente foi cadastrado em ${LABEL_AMBIENTE[e.emitenteAmbiente as Ambiente] ?? "outro ambiente"}, mas a empresa está em ${LABEL_AMBIENTE[e.ambiente]}: salve os Dados fiscais de novo.`);
  }
  if (e.ambiente === "PRODUCAO" && !e.producaoLiberada) {
    add("A emissão em Produção ainda não está liberada: nesta fase as notas saem só em Homologação (testes).");
  }
  if (e.certificadoValidoAte && e.certificadoValidoAte.getTime() < agora.getTime()) add("O certificado digital venceu: envie o novo em Dados fiscais.");
  if (!e.tokenDisponivel) p.push({ area: "emitente", texto: "A integração com o PlugNotas não está configurada neste servidor (falta o token). Avise o suporte." });
  return p;
}

/** Medição em que a NF pode sair: aprovada (e com o pedido de compra, se o cliente exige) */
export const STATUS_MEDICAO_EMITE = ["PC_RECEBIDO", "NF_EMITIDA", "BOLETO_GERADO", "PAGO"] as const;
export interface MedicaoEmissao {
  id: string; numero: string; status: string;
  /** Número de NF registrada à mão (Registrar NF) que não é nota emitida aqui */
  nfManual: string | null;
}

export function pendenciasMedicao(m: MedicaoEmissao, rotuloStatus: string): Pendencia[] {
  const link = `/financeiro/medicoes/${m.id}`;
  if (m.status === "CANCELADA") return [{ area: "medicao", texto: `A medição ${m.numero} está cancelada.`, link, rotuloLink: "Abrir a medição" }];
  if (m.nfManual) return [{ area: "medicao", texto: `A medição ${m.numero} já tem NF registrada à mão (nº ${m.nfManual}): não emitimos outra.`, link, rotuloLink: "Abrir a medição" }];
  if (!(STATUS_MEDICAO_EMITE as readonly string[]).includes(m.status)) {
    return [{ area: "medicao", texto: `A medição ${m.numero} precisa estar aprovada (e com o pedido de compra, se o cliente exige) antes da nota. Hoje está “${rotuloStatus}”.`, link, rotuloLink: "Abrir a medição" }];
  }
  return [];
}

export interface TomadorEmissao {
  id: string; nome: string; cpfCnpj: string; email?: string | null;
  endereco?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null;
  cidade?: string | null; estado?: string | null; cep?: string | null;
  /** Código IBGE da cidade (resolvido pelo servidor a partir do CEP/cidade); null = não achado */
  codigoCidade: string | null;
}

export function pendenciasTomador(t: TomadorEmissao): Pendencia[] {
  const link = `/clientes/${t.id}/editar`;
  const p: Pendencia[] = [];
  const add = (texto: string) => p.push({ area: "tomador", texto, link, rotuloLink: "Editar o cliente" });
  const doc = digitos(t.cpfCnpj ?? "");
  if (!(doc.length === 11 ? cpfValido(doc) : doc.length === 14 ? cnpjValido(doc) : false)) add("CPF/CNPJ do cliente inválido.");
  if (!t.nome?.trim()) add("Nome / razão social do cliente.");
  const falta = ([[t.endereco, "logradouro"], [t.numero, "número"], [t.bairro, "bairro"], [t.cidade, "cidade"]] as const)
    .filter(([v]) => !v?.toString().trim()).map(([, n]) => n as string);
  if (!/^[A-Za-z]{2}$/.test((t.estado ?? "").trim())) falta.push("UF");
  if (digitos(t.cep ?? "").length !== 8) falta.push("CEP");
  if (falta.length) add(`Endereço do cliente: ${falta.join(", ")}.`);
  else if (!ehCodigoIbge(t.codigoCidade)) add(`Não achamos o código IBGE da cidade do cliente (${t.cidade?.trim()}/${t.estado?.trim().toUpperCase()}, CEP ${digitos(t.cep ?? "")}): confira o CEP e a cidade.`);
  return p;
}

/* ───────── Itens e agrupamento ───────── */
export interface ServicoCatalogo extends ServicoFiscal { id: string }
export interface ItemEmissao {
  id: string;
  tipo: "SERVICO" | "PRODUTO";
  descricao: string;
  quantidade: number;
  valorTotal: number;
  servico: ServicoCatalogo | null;
  /** Já está numa nota viva (enviando, processando ou autorizada) */
  emNota?: boolean;
}
export interface OpcoesNota { aliquotaPadrao: number | null; cnaeEmpresa: string | null }

/** Pendências dos itens de serviço que ainda vão para nota: serviço do catálogo e os dados fiscais dele */
export function pendenciasItens(itens: readonly ItemEmissao[], o: OpcoesNota): Pendencia[] {
  const p: Pendencia[] = [];
  const vistos = new Set<string>();
  for (const it of itens) {
    if (it.tipo !== "SERVICO" || it.emNota || !(it.valorTotal > 0)) continue;
    if (!it.servico) {
      p.push({ area: "item", itemId: it.id, texto: `Item “${it.descricao}”: escolha o serviço do catálogo (de onde vêm os dados fiscais).` });
      continue;
    }
    if (vistos.has(it.servico.id)) continue;
    vistos.add(it.servico.id);
    const falta = pendenciasServicoNfse(it.servico, o.aliquotaPadrao);
    if (falta.length) {
      p.push({ area: "servico", texto: `Serviço “${it.servico.nome}”: falta ${falta.join(" e ")}.`, link: LINK_SERVICOS, rotuloLink: "Abrir Serviços" });
    }
  }
  return p;
}

const centavos = (v: number) => Math.round(v * 100);

/**
 * Rateia o desconto da medição pelos itens, proporcional ao valor, em centavos exatos (a sobra
 * de arredondamento vai para os itens de maior fração). A soma das partes = o desconto.
 */
export function ratearDesconto(valores: readonly number[], desconto: number): number[] {
  const total = valores.reduce((s, v) => s + centavos(v), 0);
  const d = Math.min(Math.max(centavos(desconto), 0), total);
  if (!total || !d) return valores.map(() => 0);
  const brutas = valores.map((v) => (centavos(v) * d) / total);
  const partes = brutas.map(Math.floor);
  let sobra = d - partes.reduce((s, x) => s + x, 0);
  const ordem = brutas.map((b, i) => ({ i, f: b - Math.floor(b) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of ordem) { if (sobra <= 0) break; partes[i]++; sobra--; }
  return partes.map((c) => c / 100);
}

export type ServicoNota = ReturnType<typeof servicoPlugNotas>;
export interface GrupoNota {
  /** Assinatura fiscal (o que precisa ser igual para ir na mesma nota) */
  chave: string;
  rotulo: string;
  codigoLc116: string;
  codigoTributacao: string;
  aliquota: number;
  retido: boolean;
  itens: { item: ItemEmissao; desconto: number }[];
  valorServicos: number;
  valorDesconto: number;
  /** Base do `servico` da nota (sem valor e discriminação, que são da nota) */
  servico: Omit<ServicoNota, "valor" | "discriminacao">;
  discriminacao: string;
}

export interface ContextoDiscriminacao { medicaoNumero: string; osNumeros?: string[] }

/** Valor em reais com espaço comum (o Intl usa espaço sem quebra, que algumas prefeituras recusam) */
const reais = (v: number) => formatarMoeda(v).replace(/\s/g, " ");

/** Discriminação padrão: o texto base dos serviços, os itens (qtd × valor) e a referência. "|" quebra a linha no PDF. */
export function discriminacaoPadrao(g: Pick<GrupoNota, "itens">, ctx: ContextoDiscriminacao): string {
  const bases = [...new Set(g.itens.map(({ item }) => item.servico?.discriminacaoPadrao?.trim()).filter(Boolean))] as string[];
  const linhas = g.itens.map(({ item }) => {
    const q = item.quantidade;
    const unit = q ? item.valorTotal / q : item.valorTotal;
    return q && q !== 1
      ? `${item.descricao.trim()} — ${String(q).replace(".", ",")} x ${reais(unit)} = ${reais(item.valorTotal)}`
      : `${item.descricao.trim()} — ${reais(item.valorTotal)}`;
  });
  const ref = [`Medição ${ctx.medicaoNumero}`, ...(ctx.osNumeros?.length ? [`OS ${ctx.osNumeros.join(", ")}`] : [])].join(" · ");
  return [...bases, ...linhas, `Ref.: ${ref}`].join(" | ");
}

/** Tamanho máximo da discriminação (o padrão ABRASF aceita 2000 caracteres) */
export const MAX_DISCRIMINACAO = 2000;

/**
 * Agrupa os itens de SERVIÇO livres (fora de nota viva, com serviço do catálogo sem pendência) em
 * notas. `desconto`: o desconto total da medição, rateado por TODOS os itens (a parte dos produtos
 * não vai para a NFS-e). Ordem: a dos itens.
 */
export function agruparNotas(itens: readonly ItemEmissao[], desconto: number, o: OpcoesNota, ctx: ContextoDiscriminacao): GrupoNota[] {
  const descontos = ratearDesconto(itens.map((i) => i.valorTotal), desconto);
  const grupos = new Map<string, GrupoNota>();
  itens.forEach((item, idx) => {
    if (item.tipo !== "SERVICO" || item.emNota || !(item.valorTotal > 0) || !item.servico) return;
    if (pendenciasServicoNfse(item.servico, o.aliquotaPadrao).length) return;
    const { valor: _v, discriminacao: _d, ...base } = servicoPlugNotas(item.servico, { valor: 0, aliquotaPadrao: o.aliquotaPadrao, cnaeEmpresa: o.cnaeEmpresa });
    const chave = JSON.stringify([base.codigoTributacao, base.codigo, base.cnae ?? null, base.iss.tipoTributacao, base.iss.exigibilidade, Number(base.iss.aliquota), base.iss.retido]);
    let g = grupos.get(chave);
    if (!g) {
      g = {
        chave, rotulo: "", codigoLc116: base.codigo, codigoTributacao: base.codigoTributacao, aliquota: Number(base.iss.aliquota), retido: base.iss.retido,
        itens: [], valorServicos: 0, valorDesconto: 0, servico: base, discriminacao: "",
      };
      grupos.set(chave, g);
    }
    g.itens.push({ item, desconto: descontos[idx] });
    g.valorServicos = (centavos(g.valorServicos) + centavos(item.valorTotal)) / 100;
    g.valorDesconto = (centavos(g.valorDesconto) + centavos(descontos[idx])) / 100;
  });
  const lista = [...grupos.values()];
  const porCodigo = new Map<string, number>();
  for (const g of lista) porCodigo.set(g.codigoTributacao, (porCodigo.get(g.codigoTributacao) ?? 0) + 1);
  for (const g of lista) {
    const lc = g.codigoTributacao !== g.codigoLc116 ? ` (LC 116 ${g.codigoLc116})` : "";
    const iss = (porCodigo.get(g.codigoTributacao) ?? 0) > 1 ? ` · ISS ${String(g.aliquota).replace(".", ",")}%${g.retido ? " retido" : ""}` : "";
    g.rotulo = `Código ${g.codigoTributacao}${lc}${iss}`;
    g.discriminacao = discriminacaoPadrao(g, ctx);
  }
  return lista;
}

/** Pendências de cada nota montada (discriminação vazia ou longa demais) */
export function pendenciasNotas(grupos: readonly Pick<GrupoNota, "chave" | "rotulo" | "discriminacao">[]): Pendencia[] {
  return grupos.flatMap((g) => {
    const t = g.discriminacao.trim();
    if (!t) return [{ area: "nota" as const, chave: g.chave, texto: `${g.rotulo}: escreva a discriminação do serviço.` }];
    if (t.length > MAX_DISCRIMINACAO) return [{ area: "nota" as const, chave: g.chave, texto: `${g.rotulo}: a discriminação passou de ${MAX_DISCRIMINACAO} caracteres (tem ${t.length}).` }];
    return [];
  });
}

/* ───────── Corpo da nota no PlugNotas ───────── */
export interface DadosNota {
  /** idIntegracao: o id da nota no Frivo */
  id: string;
  prestadorCnpj: string;
  tomador: TomadorEmissao;
  servico: Omit<ServicoNota, "valor" | "discriminacao">;
  discriminacao: string;
  valorServicos: number;
  valorDesconto: number;
}

/** A nota no formato do POST /nfse do PlugNotas (o envio é um array com ela) */
export function corpoNotaPlugNotas(n: DadosNota) {
  const t = n.tomador;
  const { tipoLogradouro, logradouro } = separarLogradouro(t.endereco ?? "");
  const email = t.email?.trim();
  return {
    idIntegracao: n.id,
    prestador: { cpfCnpj: digitos(n.prestadorCnpj) },
    tomador: {
      cpfCnpj: digitos(t.cpfCnpj),
      razaoSocial: t.nome.trim(),
      ...(email ? { email } : {}),
      endereco: {
        descricaoCidade: (t.cidade ?? "").trim(),
        cep: digitos(t.cep ?? ""),
        tipoLogradouro,
        logradouro,
        tipoBairro: "Bairro",
        codigoCidade: t.codigoCidade!,
        ...(t.complemento?.trim() ? { complemento: t.complemento.trim() } : {}),
        estado: (t.estado ?? "").trim().toUpperCase(),
        numero: (t.numero ?? "").trim(),
        bairro: (t.bairro ?? "").trim(),
      },
    },
    servico: [{
      ...n.servico,
      discriminacao: n.discriminacao.trim(),
      valor: { servico: n.valorServicos, ...(n.valorDesconto > 0 ? { descontoIncondicionado: n.valorDesconto } : {}) },
    }],
  };
}

/* ───────── Respostas do PlugNotas ───────── */
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Resposta do POST /nfse: { documents: [{ id, idIntegracao }], protocol, message } → id e protocolo */
export function lerEmissao(corpo: unknown, idIntegracao: string): { id: string; protocolo: string | null } | null {
  const c = obj(corpo);
  const raiz = obj(c?.data) ?? c;
  const docs = Array.isArray(raiz?.documents) ? raiz!.documents as unknown[] : Array.isArray(corpo) ? corpo as unknown[] : raiz ? [raiz] : [];
  const doc = (docs.map(obj).find((d) => txt(d?.idIntegracao) === idIntegracao) ?? obj(docs[0]));
  const id = txt(doc?.id ?? doc?._id);
  if (!id) return null;
  const protocolo = txt(raiz?.protocol ?? raiz?.protocolo ?? c?.protocol ?? doc?.protocol ?? doc?.protocolo) || null;
  return { id, protocolo };
}

/** Data "2026-10-29T10:00:00Z" ou "29/10/2026 10:00:00" → Date (inválida = null) */
export function lerData(v: unknown): Date | null {
  const s = typeof v === "string" ? v.trim() : "";
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!br && !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = br ? new Date(Date.UTC(+br[3], +br[2] - 1, +br[1], +(br[4] ?? 0) + 3, +(br[5] ?? 0), +(br[6] ?? 0))) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ResultadoConsulta {
  id: string | null;
  situacao: string;
  status: StatusNota | null;
  numero: string | null;
  codigoVerificacao: string | null;
  mensagem: string | null;
  pdf: string | null;
  xml: string | null;
  autorizadaEm: Date | null;
}

/**
 * Resposta da consulta (lista ou objeto, direto ou em `data`) → o que interessa da nota `ids`
 * (o id no PlugNotas ou o idIntegracao). `numero` é o da NFS-e (numeroNfse), nunca o do RPS.
 */
export function lerConsulta(corpo: unknown, ids: { id?: string | null; idIntegracao?: string | null } = {}): ResultadoConsulta | null {
  const c = obj(corpo);
  const lista: unknown[] = Array.isArray(corpo) ? corpo : Array.isArray(c?.data) ? c!.data as unknown[] : obj(c?.data) ? [c!.data] : c ? [c] : [];
  const itens = lista.map(obj).filter(Boolean) as Record<string, unknown>[];
  const n = itens.find((i) => (ids.id && txt(i.id) === ids.id) || (ids.idIntegracao && txt(i.idIntegracao) === ids.idIntegracao)) ?? itens[0];
  if (!n) return null;
  const situacao = txt(n.situacao ?? n.status);
  const nfse = obj(n.nfse);
  const retorno = obj(n.retorno);
  return {
    id: txt(n.id) || null,
    situacao,
    status: statusDaSituacao(situacao),
    numero: txt(n.numeroNfse ?? n.numeroNFSe ?? nfse?.numero) || null,
    codigoVerificacao: txt(n.codigoVerificacao ?? nfse?.codigoVerificacao) || null,
    mensagem: txt(n.mensagem ?? n.motivo ?? retorno?.mensagem ?? retorno?.mensagemRetorno) || null,
    pdf: txt(n.pdf) || null,
    xml: txt(n.xml) || null,
    autorizadaEm: lerData(n.dataAutorizacao ?? n.autorizacao ?? n.dataEmissao ?? n.emissao),
  };
}
