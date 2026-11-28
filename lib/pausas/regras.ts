/**
 * PAUSAR / IMPEDIMENTO na atividade (app do técnico) — as regras puras (tela, servidor e testes usam as mesmas).
 *
 * - A atividade em andamento pode ser PAUSADA com um motivo obrigatório da lista da empresa (Configurações › Motivos
 *   de pausa). "Retomar" fecha a pausa e a atividade segue em execução.
 * - O tempo pausado NÃO conta como tempo de execução: cada pausa guarda o início e o fim (relógio do aparelho).
 * - Motivo de IMPEDIMENTO avisa o escritório (sino/push) e permite encerrar a visita como "Não concluída — precisa
 *   voltar" (a atividade volta para reagendar, com o motivo). INTERVALO (almoço) só para o relógio.
 * - O cliente nunca vê as pausas (relatório e PDF do cliente); o escritório vê na OS, na lista e nas Pendências.
 */
import { z } from "zod";

export type TipoMotivo = "IMPEDIMENTO" | "INTERVALO";
export interface MotivoPausaTela { id: string; nome: string; tipo: TipoMotivo; pedeTexto: boolean }

/** Os padrões que nascem para a empresa na 1ª vez (ela edita, inativa e cria outros) */
export const MOTIVOS_PADRAO: readonly { nome: string; tipo: TipoMotivo; pedeTexto: boolean; ordem: number }[] = [
  { nome: "Falta de peça/material", tipo: "IMPEDIMENTO", pedeTexto: false, ordem: 1 },
  { nome: "Cliente ausente", tipo: "IMPEDIMENTO", pedeTexto: false, ordem: 2 },
  { nome: "Acesso negado", tipo: "IMPEDIMENTO", pedeTexto: false, ordem: 3 },
  { nome: "Aguardando aprovação do cliente", tipo: "IMPEDIMENTO", pedeTexto: false, ordem: 4 },
  { nome: "Chuva/condição do local", tipo: "IMPEDIMENTO", pedeTexto: false, ordem: 5 },
  { nome: "Almoço/intervalo", tipo: "INTERVALO", pedeTexto: false, ordem: 6 },
  { nome: "Outro", tipo: "IMPEDIMENTO", pedeTexto: true, ordem: 7 },
];

export const ROTULO_TIPO_MOTIVO: Record<TipoMotivo, string> = { IMPEDIMENTO: "Impedimento", INTERVALO: "Intervalo" };
export const OBSERVACAO_MAX = 500;
export const MOTIVO_MAX = 80;

export const MSG_MOTIVO_OBRIGATORIO = "Escolha o motivo da pausa.";
export const MSG_TEXTO_OBRIGATORIO = "Escreva o motivo (pelo menos 3 letras).";
export const MSG_JA_PAUSADA = "A atividade já está pausada.";
export const MSG_NAO_PAUSADA = "A atividade não está pausada.";
export const MSG_NAO_EM_ANDAMENTO = "Só dá para pausar a atividade em andamento (toque em “Cheguei” antes).";
export const MSG_SO_IMPEDIMENTO = "Só uma pausa por impedimento encerra a visita como não concluída.";

/** Os dados da operação "pausar" (vêm do aparelho; o servidor confere o motivo no cadastro) */
export const pausarSchema = z.object({
  clientId: z.string().min(8).max(64),
  motivoId: z.string().min(1).max(64).nullable(),
  motivo: z.string().trim().min(1).max(MOTIVO_MAX),
  impedimento: z.boolean(),
  observacao: z.string().trim().max(OBSERVACAO_MAX).nullable().optional(),
});
export const retomarSchema = z.object({ pausaClientId: z.string().min(8).max(64) });
export const naoConcluidaSchema = z.object({ pausaClientId: z.string().min(8).max(64), observacao: z.string().trim().max(OBSERVACAO_MAX).nullable().optional() });

/** O que falta para poder pausar (null = pode) */
export function problemaDaPausa(motivo: Pick<MotivoPausaTela, "pedeTexto"> | null, observacao: string | null | undefined): string | null {
  if (!motivo) return MSG_MOTIVO_OBRIGATORIO;
  if (motivo.pedeTexto && (observacao ?? "").trim().length < 3) return MSG_TEXTO_OBRIGATORIO;
  return null;
}

export interface Intervalo { inicio: Date | string; fim: Date | string | null }
const ms = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

/** Quanto do período [de, ate] ficou pausado (as pausas abertas vão até `ate`; sobreposição conta uma vez só) */
export function tempoPausadoMs(de: Date | string, ate: Date | string, pausas: readonly Intervalo[]): number {
  const a = ms(de), b = ms(ate);
  if (!(b > a)) return 0;
  const partes = pausas
    .map((p) => [Math.max(a, ms(p.inicio)), Math.min(b, p.fim ? ms(p.fim) : b)] as const)
    .filter(([x, y]) => y > x)
    .sort((x, y) => x[0] - y[0]);
  let total = 0, ini = -Infinity, fim = -Infinity;
  for (const [x, y] of partes) {
    if (x > fim) { if (fim > ini) total += fim - ini; ini = x; fim = y; }
    else fim = Math.max(fim, y);
  }
  if (fim > ini) total += fim - ini;
  return total;
}

/** Tempo de execução = do início ao fim (ou agora), menos o tempo pausado */
export function tempoDeExecucaoMs(inicio: Date | string, fim: Date | string, pausas: readonly Intervalo[]): number {
  const total = ms(fim) - ms(inicio);
  return total > 0 ? total - tempoPausadoMs(inicio, fim, pausas) : 0;
}

/** "45 min", "2 h", "2 h 10 min", "3 dias" */
export function duracaoCurta(msTotal: number): string {
  const min = Math.max(0, Math.floor(msTotal / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), resto = min % 60;
  if (h < 24) return resto ? `${h} h ${resto} min` : `${h} h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/** "Pausada — Falta de peça/material — há 2 h" (o que o escritório e o técnico leem) */
export function textoPausada(p: { motivo: string; inicio: Date | string }, agora: Date | string): string {
  return `Pausada — ${p.motivo} — há ${duracaoCurta(ms(agora) - ms(p.inicio))}`;
}

/** A pausa aberta (fim nulo), se houver — a mais recente */
export function pausaAberta<T extends { fim: Date | string | null; inicio: Date | string }>(pausas: readonly T[]): T | null {
  return [...pausas].filter((p) => !p.fim).sort((a, b) => ms(b.inicio) - ms(a.inicio))[0] ?? null;
}

/** Encerrar a visita como "Não concluída — precisa voltar": só com uma pausa ABERTA de impedimento */
export const podeEncerrarNaoConcluida = (p: { fim: Date | string | null; impedimento: boolean } | null) => !!p && !p.fim && p.impedimento;

/** O texto que vai para os equipamentos não feitos (o mesmo "não atendido" de sempre) e para o histórico da OS */
export const textoNaoConcluida = (motivo: string, observacao?: string | null) =>
  `Não concluída — precisa voltar: ${motivo}${observacao?.trim() ? ` (${observacao.trim()})` : ""}`;

type PausaCartao = { clientId: string; motivo: string; inicio: string; impedimento: boolean };
type OpPausa = { tipo: string; atividadeId: string; em?: string | null; criadoEm: string; dados?: unknown };
/**
 * A pausa que o cartão do Meu dia mostra: a do servidor, corrigida pelo que está na fila deste aparelho (pausou ou
 * retomou sem sinal), na ordem em que o técnico tocou.
 */
export function pausaDoCartao(atividadeId: string, doServidor: PausaCartao | null | undefined, fila: readonly OpPausa[]): PausaCartao | null {
  let p: PausaCartao | null = doServidor ?? null;
  for (const op of fila) {
    if (op.atividadeId !== atividadeId) continue;
    const d = (op.dados ?? {}) as Record<string, unknown>;
    if (op.tipo === "pausar" && !p) p = { clientId: String(d.clientId), motivo: String(d.motivo), inicio: op.em ?? op.criadoEm, impedimento: d.impedimento === true };
    else if ((op.tipo === "retomar" || op.tipo === "naoConcluida") && p?.clientId === d.pausaClientId) p = null;
    else if (op.tipo === "concluir") p = null;
  }
  return p;
}
