/**
 * Tela central "Notas fiscais de serviço" — regras puras (servidor e tela): o período (mês com
 * ‹ › ou intervalo), os filtros da URL, os grupos de situação dos cards, a data da nota e QUAIS
 * ações cada nota permite (nada de botão que não funciona).
 * Lê só o que a emissão já grava em `notas_fiscais` / `notas_fiscais_eventos` (sem coluna nova).
 */
import { lerPeriodo, type Periodo } from "@/lib/periodo";
import { aguardandoResposta, type StatusNota } from "@/lib/nfse/nota";
import { lerPaginacao, um, type ParamsUrl } from "@/lib/listagem";

/* ───────── Situação (grupos dos cards e do filtro) ───────── */
export const GRUPOS_SITUACAO = {
  transmissao: { rotulo: "Em transmissão", status: ["ENVIANDO", "PROCESSANDO"] },
  emitidas: { rotulo: "Emitidas", status: ["CONCLUIDO"] },
  falha: { rotulo: "Com falha", status: ["REJEITADO", "INTERROMPIDO"] },
  canceladas: { rotulo: "Canceladas", status: ["CANCELADO"] },
} as const satisfies Record<string, { rotulo: string; status: readonly StatusNota[] }>;
export type GrupoSituacao = keyof typeof GRUPOS_SITUACAO;
export const ehGrupo = (v: string): v is GrupoSituacao => Object.prototype.hasOwnProperty.call(GRUPOS_SITUACAO, v);

export const AMBIENTES_FILTRO = ["HOMOLOGACAO", "PRODUCAO"] as const;

/* ───────── Período (padrão da casa: lib/periodo.ts) ───────── */
export { lerPeriodo, mesAtual, mesVizinho, rotuloMes, type Periodo } from "@/lib/periodo";

/* ───────── Filtros da URL ───────── */
export interface FiltrosCentral {
  periodo: Periodo;
  q: string;
  situacao: GrupoSituacao | null;
  ambiente: (typeof AMBIENTES_FILTRO)[number] | null;
  pagina: number;
  porPagina: number;
}
export function lerFiltros(sp: ParamsUrl, agora = new Date()): FiltrosCentral {
  const situacao = um(sp.situacao);
  const ambiente = um(sp.ambiente);
  return {
    periodo: lerPeriodo(sp, agora),
    q: um(sp.q).trim().slice(0, 100),
    situacao: ehGrupo(situacao) ? situacao : null,
    ambiente: (AMBIENTES_FILTRO as readonly string[]).includes(ambiente) ? (ambiente as FiltrosCentral["ambiente"]) : null,
    ...lerPaginacao(sp),
  };
}

/**
 * A data da nota na tela e no período: a da AUTORIZAÇÃO quando autorizada (é a data fiscal);
 * senão, a do envio. O filtro de período segue a mesma regra.
 */
export const dataDaNota = (n: { autorizadaEm: Date | string | null; criadoEm: Date | string }) => n.autorizadaEm ?? n.criadoEm;

/** Condição do período sobre a data da nota (autorizada: autorizadaEm; senão: criadoEm) */
export function wherePeriodo(p: Pick<Periodo, "gte" | "lt">) {
  const faixa = { ...(p.gte ? { gte: p.gte } : {}), ...(p.lt ? { lt: p.lt } : {}) };
  if (!p.gte && !p.lt) return {};
  return { OR: [{ autorizadaEm: faixa }, { autorizadaEm: null, criadoEm: faixa }] };
}

/** A busca: número da nota, tomador (nome ou CPF/CNPJ) ou a origem (nº da OS / da medição) */
export function whereBusca(q: string) {
  if (!q) return {};
  const digitos = q.replace(/\D/g, "");
  const ou: object[] = [
    { numero: { contains: q, mode: "insensitive" } },
    { tomadorNome: { contains: q, mode: "insensitive" } },
    { medicao: { numero: { contains: q, mode: "insensitive" } } },
    { ordemServico: { numero: { contains: q, mode: "insensitive" } } },
  ];
  if (digitos.length >= 3) ou.push({ tomadorCpfCnpj: { contains: digitos } });
  return { OR: ou };
}

/** O `where` completo da lista (empresa SEMPRE a da sessão: quem chama passa) */
export function whereNotas(empresaId: string, f: Pick<FiltrosCentral, "periodo" | "q" | "situacao" | "ambiente">) {
  return {
    empresaId,
    AND: [
      wherePeriodo(f.periodo),
      whereBusca(f.q),
      f.situacao ? { status: { in: [...GRUPOS_SITUACAO[f.situacao].status] } } : {},
      f.ambiente ? { ambiente: f.ambiente } : {},
    ],
  };
}

/* ───────── Ações por nota ───────── */
export interface NotaAcoes {
  status: string;
  medicaoId: string | null;
  ordemServicoId: string | null;
  temPdf: boolean;
  temXml: boolean;
}
export interface Acoes {
  origem: string | null;
  pdf: boolean;
  xml: boolean;
  reconsultar: boolean;
  /** Cancelar: só para autorizada; o cancelamento pelo PlugNotas ainda não existe (fica desabilitado, "em breve") */
  cancelar: "em-breve" | null;
  /** Rejeitada/interrompida: abre a emissão da medição (onde a tela mostra o que corrigir) */
  reemitir: string | null;
}

export const hrefMedicao = (id: string) => `/financeiro/medicoes/${id}`;
export const hrefOs = (id: string) => `/ordens/${id}`;
/** A origem: a OS quando a nota partiu dela; senão a medição */
export function hrefOrigem(n: Pick<NotaAcoes, "medicaoId" | "ordemServicoId"> & { origem?: string }) {
  if (n.ordemServicoId && n.origem !== "MEDICAO") return hrefOs(n.ordemServicoId);
  if (n.medicaoId) return hrefMedicao(n.medicaoId);
  return n.ordemServicoId ? hrefOs(n.ordemServicoId) : null;
}

export function acoesDaNota(n: NotaAcoes & { origem?: string }): Acoes {
  const autorizada = n.status === "CONCLUIDO";
  const falhou = n.status === "REJEITADO" || n.status === "INTERROMPIDO";
  return {
    origem: hrefOrigem(n),
    pdf: autorizada && n.temPdf,
    xml: autorizada && n.temXml,
    reconsultar: aguardandoResposta(n.status),
    cancelar: autorizada ? "em-breve" : null,
    reemitir: falhou && n.medicaoId ? `${hrefMedicao(n.medicaoId)}?nfse=emitir#nfse` : null,
  };
}

/** Por que o PDF/XML não está disponível (dica do botão desabilitado) */
export function motivoSemArquivo(status: string, tipo: "pdf" | "xml") {
  if (status !== "CONCLUIDO") return "Disponível após a autorização da nota.";
  return tipo === "pdf" ? "O PlugNotas ainda não disponibilizou o PDF desta nota." : "O PlugNotas ainda não disponibilizou o XML desta nota.";
}

/** Cor do badge por status (tons do sistema de design: components/ui/status-pill) */
export const TOM_STATUS_NOTA: Record<string, "ok" | "atencao" | "atrasado" | "previsto"> = {
  ENVIANDO: "atencao", PROCESSANDO: "atencao", CONCLUIDO: "ok", REJEITADO: "atrasado", INTERROMPIDO: "atrasado", CANCELADO: "previsto",
};
