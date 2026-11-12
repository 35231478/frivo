/**
 * PMOC — OCORRÊNCIAS: o registro das não conformidades achadas na manutenção dos equipamentos do
 * plano (vazamento, corrosão, ruído anormal, filtro danificado, falha elétrica…). Regras puras, usadas
 * na tela e no servidor: sem banco e sem dependências de Node.
 *
 * - GRAVIDADE: Baixa, Média, Alta ou Crítica. SITUAÇÃO: Aberta, Em andamento ou Resolvida.
 * - A ocorrência é de um equipamento do plano ou GERAL da unidade (sem equipamento).
 * - Resolvida guarda a data e o que foi feito; ao reabrir, os dois são limpos (ficam no histórico).
 * - Excluir é guardar fora da vista: a ocorrência sai da lista e do documento e pode ser restaurada.
 */
import { z } from "zod";
import { dataBR } from "@/lib/pmoc";
import { dataValida } from "@/lib/pmoc-renovacao";

export const GRAVIDADES = ["BAIXA", "MEDIA", "ALTA", "CRITICA"] as const;
export type GravidadeOcorrencia = (typeof GRAVIDADES)[number];
export const LABELS_GRAVIDADE: Record<GravidadeOcorrencia, string> = { BAIXA: "Baixa", MEDIA: "Média", ALTA: "Alta", CRITICA: "Crítica" };

export const SITUACOES = ["ABERTA", "EM_ANDAMENTO", "RESOLVIDA"] as const;
export type SituacaoOcorrencia = (typeof SITUACOES)[number];
export const LABELS_SITUACAO: Record<SituacaoOcorrencia, string> = { ABERTA: "Aberta", EM_ANDAMENTO: "Em andamento", RESOLVIDA: "Resolvida" };

/** De onde veio: hoje só o escritório registra; "APP" fica reservado para a "Atenção" do técnico */
export const ORIGENS_OCORRENCIA = ["MANUAL", "APP"] as const;

export const TIPOS_ANEXO_OCORRENCIA = ["image/jpeg", "image/png", "application/pdf"] as const;
/**
 * 3 MB: o anexo viaja em base64 dentro do pedido (4 MB de texto) e a hospedagem recusa pedidos acima
 * de 4,5 MB. A foto é reduzida na tela antes de enviar; PDF maior que isso precisa ser exportado menor.
 */
export const TAMANHO_MAX_ANEXO_OCORRENCIA = 3 * 1024 * 1024;
export const MSG_ANEXO_GRANDE = "Anexo acima de 3 MB.";
export const MSG_ANEXO_TIPO = "O anexo deve ser foto (JPG ou PNG) ou PDF.";
export const DESCRICAO_MAX = 2000;
export const ROTULO_GERAL = "Geral da unidade";

/* ───────── o que a tela recebe ───────── */

export interface OcorrenciaPmoc {
  id: string;
  /** "AAAA-MM-DD" */
  data: string;
  descricao: string;
  gravidade: GravidadeOcorrencia;
  situacao: SituacaoOcorrencia;
  resolvidaEm: string | null;
  resolucao: string | null;
  /** null = geral da unidade */
  equipamento: { id: string; rotulo: string; tag: string | null } | null;
  ordemServico: { id: string; numero: string } | null;
  anexo: { nome: string; tipo: string | null; tamanho: number | null } | null;
  origem: string;
  /** false = excluída */
  ativo: boolean;
  criadoEm: string;
}
/** OS que podem ser ligadas à ocorrência: as do cliente do plano */
export interface OrdemDaOcorrencia { id: string; numero: string; descricao: string }

/* ───────── validação ───────── */

const data = (msg: string) => z.string({ required_error: msg, invalid_type_error: msg }).refine(dataValida, msg);
const idOpcional = z.string().trim().max(60).optional().nullable().transform((v) => v || null);
const MSG_DESCRICAO = "Descreva o problema (mín. 3 caracteres).";
const MSG_GRAVIDADE = "Escolha a gravidade.";
const MSG_SITUACAO = "Situação inválida.";
const resolucao = {
  // Data da resolução: vazia em "Resolvida" = hoje
  resolvidaEm: z.string().trim().optional().nullable().transform((v) => v || null),
  resolucao: z.string().trim().max(DESCRICAO_MAX, "A observação da resolução vai até 2.000 caracteres.").optional().nullable().transform((v) => v || null),
};

export const ocorrenciaSchema = z.object({
  data: data("Informe a data da ocorrência."),
  equipamentoId: idOpcional,
  descricao: z.string({ required_error: MSG_DESCRICAO, invalid_type_error: MSG_DESCRICAO }).trim().min(3, MSG_DESCRICAO).max(DESCRICAO_MAX, "A descrição vai até 2.000 caracteres."),
  gravidade: z.enum(GRAVIDADES, { errorMap: () => ({ message: MSG_GRAVIDADE }) }),
  situacao: z.enum(SITUACOES, { errorMap: () => ({ message: MSG_SITUACAO }) }).default("ABERTA"),
  ...resolucao,
  ordemServicoId: idOpcional,
  // Anexo: data URL para trocar; `removerAnexo: true` para tirar; ausente = mantém
  anexo: z.string().optional().nullable(),
  anexoNome: z.string().max(200).optional().nullable(),
  removerAnexo: z.boolean().optional(),
});
export type OcorrenciaInput = z.infer<typeof ocorrenciaSchema>;

/** Mudança rápida de situação (o botão "Resolver" e o "Reabrir") */
export const situacaoSchema = z.object({ situacao: z.enum(SITUACOES, { errorMap: () => ({ message: MSG_SITUACAO }) }), ...resolucao });
export type SituacaoInput = z.infer<typeof situacaoSchema>;

type Datas = { data: string; situacao: SituacaoOcorrencia; resolvidaEm?: string | null; resolucao?: string | null };

/** O que impede gravar (null = pode). `hoje`: "AAAA-MM-DD" em Brasília. */
export function erroDaOcorrencia(d: Datas, hoje: string): string | null {
  if (d.data > hoje) return "A data da ocorrência não pode ser futura.";
  if (d.situacao !== "RESOLVIDA") return null;
  const fim = d.resolvidaEm ?? hoje;
  if (!dataValida(fim)) return "Data da resolução inválida.";
  if (fim < d.data) return "A resolução não pode ser antes da data da ocorrência.";
  if (fim > hoje) return "A data da resolução não pode ser futura.";
  return null;
}

/** O que grava da resolução: só a ocorrência resolvida tem data e observação */
export function resolucaoGravada(d: Datas, hoje: string): { resolvidaEm: string | null; resolucao: string | null } {
  if (d.situacao !== "RESOLVIDA") return { resolvidaEm: null, resolucao: null };
  return { resolvidaEm: d.resolvidaEm ?? hoje, resolucao: d.resolucao ?? null };
}

/* ───────── lista: busca, filtros, ordem e contagem ───────── */

/** "EXCLUIDAS" mostra só as excluídas; qualquer outro valor mostra só as que estão valendo */
export type FiltroSituacao = "" | SituacaoOcorrencia | "EXCLUIDAS";
export interface FiltroOcorrencias { busca: string; situacao: FiltroSituacao; gravidade: "" | GravidadeOcorrencia }
export const FILTRO_VAZIO: FiltroOcorrencias = { busca: "", situacao: "", gravidade: "" };

const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Onde a busca procura: descrição, resolução, equipamento (nome e TAG) e número da OS */
function textoDaBusca(o: OcorrenciaPmoc): string {
  return semAcento([o.descricao, o.resolucao, o.equipamento ? `${o.equipamento.tag ?? ""} ${o.equipamento.rotulo}` : ROTULO_GERAL, o.ordemServico?.numero].filter(Boolean).join(" "));
}

export function filtrarOcorrencias(lista: OcorrenciaPmoc[], f: FiltroOcorrencias): OcorrenciaPmoc[] {
  const termos = semAcento(f.busca).split(/\s+/).filter(Boolean);
  return lista.filter((o) => {
    if (f.situacao === "EXCLUIDAS" ? o.ativo : !o.ativo) return false;
    if (f.situacao && f.situacao !== "EXCLUIDAS" && o.situacao !== f.situacao) return false;
    if (f.gravidade && o.gravidade !== f.gravidade) return false;
    if (!termos.length) return true;
    const texto = textoDaBusca(o);
    return termos.every((t) => texto.includes(t));
  });
}

/** Na tela: a mais recente primeiro (no documento a ordem é a do livro: da mais antiga para a mais nova) */
export function ordenarOcorrencias<T extends { data: string; criadoEm: string }>(lista: T[], sentido: "recentes" | "antigas" = "recentes"): T[] {
  const s = sentido === "recentes" ? -1 : 1;
  return [...lista].sort((a, b) => s * (a.data.localeCompare(b.data) || a.criadoEm.localeCompare(b.criadoEm)));
}

export interface ContagemOcorrencias { total: number; abertas: number; emAndamento: number; resolvidas: number; pendentes: number; excluidas: number }
/** Só as que estão valendo contam; as excluídas vão à parte */
export function contarOcorrencias(lista: { situacao: string; ativo?: boolean }[]): ContagemOcorrencias {
  const valendo = lista.filter((o) => o.ativo !== false);
  const de = (s: SituacaoOcorrencia) => valendo.filter((o) => o.situacao === s).length;
  const abertas = de("ABERTA"), emAndamento = de("EM_ANDAMENTO"), resolvidas = de("RESOLVIDA");
  return { total: valendo.length, abertas, emAndamento, resolvidas, pendentes: abertas + emAndamento, excluidas: lista.length - valendo.length };
}

/** "3 ocorrências: 1 aberta, 1 em andamento e 1 resolvida" (só o que há) */
export function resumoDasOcorrencias(c: Pick<ContagemOcorrencias, "total" | "abertas" | "emAndamento" | "resolvidas">): string {
  if (!c.total) return "Nenhuma ocorrência registrada";
  const partes = [
    c.abertas ? `${c.abertas} ${c.abertas === 1 ? "aberta" : "abertas"}` : "",
    c.emAndamento ? `${c.emAndamento} em andamento` : "",
    c.resolvidas ? `${c.resolvidas} ${c.resolvidas === 1 ? "resolvida" : "resolvidas"}` : "",
  ].filter(Boolean);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : partes[0];
  return `${c.total} ${c.total === 1 ? "ocorrência" : "ocorrências"}: ${lista}`;
}

/* ───────── textos ───────── */

/** "Resolvida em 12/11/2026" | "Aberta" | "Em andamento" */
export function textoDaSituacao(o: { situacao: string; resolvidaEm?: string | Date | null }): string {
  const rotulo = LABELS_SITUACAO[o.situacao as SituacaoOcorrencia] ?? o.situacao;
  return o.situacao === "RESOLVIDA" && o.resolvidaEm ? `${rotulo} em ${dataBR(o.resolvidaEm)}` : rotulo;
}

/** "TAG-01 · Split da recepção" (sem TAG, só o nome) */
export function rotuloDoEquipamento(e: { patrimonio?: string | null; nome?: string | null; marca?: string | null; modelo?: string | null }): string {
  const nome = (e.nome ?? "").trim() || [e.marca, e.modelo].map((v) => (v ?? "").trim()).filter(Boolean).join(" ") || "Equipamento";
  return [(e.patrimonio ?? "").trim(), nome].filter(Boolean).join(" · ");
}

/** A linha do histórico do plano: "Alta · TAG-01 · Split — Vazamento de gás na linha de sucção" */
export function detalheDaOcorrencia(o: { gravidade: string; descricao: string; equipamento?: string | null }): string {
  const cabeca = [LABELS_GRAVIDADE[o.gravidade as GravidadeOcorrencia] ?? o.gravidade, o.equipamento || ROTULO_GERAL].join(" · ");
  const texto = `${cabeca} — ${o.descricao.replace(/\s+/g, " ").trim()}`;
  return texto.length > 200 ? `${texto.slice(0, 199).trimEnd()}…` : texto;
}

/** O que mudou na situação, para o histórico: registrada, resolvida, reaberta ou só alterada */
export function acaoDaMudanca(antes: string | null, depois: string): string {
  if (antes === null) return "Ocorrência registrada";
  if (antes !== "RESOLVIDA" && depois === "RESOLVIDA") return "Ocorrência resolvida";
  if (antes === "RESOLVIDA" && depois !== "RESOLVIDA") return "Ocorrência reaberta";
  return "Ocorrência alterada";
}
export const ACAO_EXCLUIDA = "Ocorrência excluída";
export const ACAO_RESTAURADA = "Ocorrência restaurada";
