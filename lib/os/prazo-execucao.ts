/**
 * PRAZO DE EXECUÇÃO da OS — até que dia ela precisa estar concluída. Regras puras (sem banco).
 *
 * A OS tem DUAS datas que não se confundem:
 *   • `previsaoConclusao` = a DATA PREVISTA: quando o serviço está marcado (agenda). É ela que
 *     posiciona a OS no calendário quando ainda não há atividade agendada, que o arrasto muda e que
 *     diz o mês em "a faturar".
 *   • `prazoExecucao` = o PRAZO: o compromisso. É o "Prazo para finalizar" da tela, e é por ele que a
 *     OS fica "atrasada" (calendário, dashboard, sino, central da OS, desempenho).
 *
 * A ligação entre as duas é UMA regra, e fica só aqui: OS sem prazo próprio vale o dia previsto —
 * quem marcou o serviço para o dia 20 e não disse outra coisa espera vê-lo feito no dia 20. É o que o
 * sistema sempre fez, então nenhuma OS antiga muda de "no prazo" para "atrasada" (nem o contrário).
 */
import { z } from "zod";
import { chaveDiaCivil, diaCivilDeChave, hojeDiaCivil } from "@/lib/fuso";
import { situacaoPrazo } from "@/lib/os/prazos";

export interface DatasDaOs {
  prazoExecucao?: Date | string | null;
  previsaoConclusao?: Date | string | null;
}

/** OS que não atrasa mais: terminou ou foi cancelada */
export const STATUS_FINAIS_OS = ["CONCLUIDA", "CANCELADA"] as const;
export const osEncerrada = (status: string) => (STATUS_FINAIS_OS as readonly string[]).includes(status);

/** A OS tem prazo digitado (ou preenchido pelo tipo)? Sem ele, o prazo que vale é o dia previsto. */
export const temPrazoProprio = (os: DatasDaOs) => !!os.prazoExecucao;

/**
 * O prazo de execução QUE VALE, como dia civil (meia-noite UTC): o próprio ou, sem ele, o dia
 * previsto. null = OS sem prazo e sem data prevista (não atrasa).
 */
export function prazoEfetivo(os: DatasDaOs): Date | null {
  const base = os.prazoExecucao ?? os.previsaoConclusao;
  return base ? diaCivilDeChave(chaveDiaCivil(base)) : null;
}

/** Situação do prazo de execução hoje (em Brasília): no prazo, vence hoje, atrasada… */
export const situacaoPrazoExecucao = (os: DatasDaOs & { status: string }, agora: Date = new Date()) =>
  situacaoPrazo(prazoEfetivo(os), osEncerrada(os.status), agora);

/** A regra única de "OS atrasada": aberta e com o dia do prazo já passado em Brasília. */
export const osAtrasada = (os: DatasDaOs & { status: string }, agora: Date = new Date()) =>
  situacaoPrazoExecucao(os, agora).situacao === "ATRASADO";

/**
 * A MESMA regra como filtro do banco (dashboard, sino, lista): OS aberta com o prazo vencido — o
 * próprio ou, sem ele, a data prevista. Junte com `empresaId`.
 */
export function whereOsAtrasada(agora: Date = new Date()) {
  const hoje = hojeDiaCivil(agora);
  return {
    status: { notIn: [...STATUS_FINAIS_OS] },
    OR: [
      { prazoExecucao: { lt: hoje } },
      { prazoExecucao: null, previsaoConclusao: { lt: hoje } },
    ],
  };
}

/* ───────── o prazo padrão do tipo de OS ───────── */

export const PRAZO_DIAS_MAX = 365;
/** O campo "prazo padrão" do tipo de OS: vazio = sem padrão; 0 = o próprio dia agendado */
export const prazoDiasSchema = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.number({ invalid_type_error: "Prazo padrão: informe um número de dias." }).int("Prazo padrão: use dias inteiros.")
    .min(0, "Prazo padrão: não pode ser negativo.").max(PRAZO_DIAS_MAX, `Prazo padrão: no máximo ${PRAZO_DIAS_MAX} dias.`).nullable(),
);

/**
 * O prazo que o tipo de OS sugere: o dia agendado (em Brasília) + N dias. null quando o tipo não
 * tem padrão ou ainda não há dia agendado — aí o campo fica vazio e vale a regra do dia previsto.
 */
export function prazoPadrao(dataAgendada: Date | string | null | undefined, diasDoTipo: number | null | undefined): Date | null {
  if (!dataAgendada || diasDoTipo == null || !Number.isInteger(diasDoTipo) || diasDoTipo < 0) return null;
  const dia = diaCivilDeChave(chaveDiaCivil(dataAgendada));
  return dia ? new Date(dia.getTime() + diasDoTipo * 864e5) : null;
}

/**
 * Reagendamento feito pelo SISTEMA (o cronograma do PMOC mudou a data da OS): o prazo próprio anda
 * junto, a mesma quantidade de dias. Sem prazo próprio não há o que mover (vale o novo dia previsto).
 * O arrasto no calendário NÃO passa por aqui: ali quem decide se o prazo muda é a pessoa.
 */
export function deslocarPrazo(prazo: Date | string | null | undefined, de: Date | string, para: Date | string): Date | null {
  const atual = prazo ? diaCivilDeChave(chaveDiaCivil(prazo)) : null;
  const a = diaCivilDeChave(chaveDiaCivil(de)), b = diaCivilDeChave(chaveDiaCivil(para));
  if (!atual || !a || !b) return atual;
  return new Date(atual.getTime() + (b.getTime() - a.getTime()));
}

/**
 * "AAAA-MM-DD" (ou ISO) digitado → o dia civil gravado. null = vazio; undefined = inválido. O dia
 * precisa EXISTIR: "2026-02-31" e "2026-13-45" são recusados (o Date os "ajustaria" para outro dia,
 * e a OS ganharia um prazo que ninguém digitou).
 */
export function lerPrazoDigitado(valor: string | null | undefined): Date | null | undefined {
  if (valor == null || valor === "") return null;
  const dia = diaCivilDeChave(valor);
  if (!dia || Number.isNaN(dia.getTime())) return undefined;
  return chaveDiaCivil(dia) === valor.slice(0, 10) ? dia : undefined;
}

/**
 * O prazo a gravar quando a OS nasce: o que a pessoa digitou vence; sem nada digitado, o padrão do
 * tipo (se houver); senão vazio.
 */
export function prazoAoCriar(o: { digitado?: Date | null; dataAgendada?: Date | string | null; diasDoTipo?: number | null }): Date | null {
  return o.digitado ?? prazoPadrao(o.dataAgendada, o.diasDoTipo);
}

/* ───────── atraso justificado ───────── */

export const MOTIVOS_ATRASO = ["CLIENTE_AUSENTE", "PECA_FALTANDO", "ACESSO_NEGADO", "CLIMA", "OUTRO"] as const;
export type MotivoAtraso = (typeof MOTIVOS_ATRASO)[number];
export const ROTULO_MOTIVO_ATRASO: Record<MotivoAtraso, string> = {
  CLIENTE_AUSENTE: "Cliente ausente",
  PECA_FALTANDO: "Peça faltando",
  ACESSO_NEGADO: "Acesso ao local negado",
  CLIMA: "Chuva ou clima",
  OUTRO: "Outro motivo",
};
export const MSG_ATRASO_OUTRO = "Explique o motivo do atraso.";
export const MSG_ATRASO_NAO_ATRASADA = "Esta OS não está atrasada: não há atraso para justificar.";

/** O que o gestor informa ao justificar: um motivo da lista e, em "Outro", a explicação. */
export const atrasoJustificadoSchema = z.object({
  motivo: z.enum(MOTIVOS_ATRASO, { errorMap: () => ({ message: "Escolha o motivo do atraso." }) }),
  observacao: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(500, "Explicação com no máximo 500 caracteres.").optional().default("")),
}).superRefine((d, ctx) => {
  if (d.motivo === "OUTRO" && !d.observacao) ctx.addIssue({ code: "custom", path: ["observacao"], message: MSG_ATRASO_OUTRO });
});

/** O atraso desta OS foi justificado? (não pesa no desempenho de quem executou) */
export const atrasoJustificado = (os: { atrasoJustificadoMotivo?: string | null }) => !!os.atrasoJustificadoMotivo;
export const rotuloMotivoAtraso = (motivo: string | null | undefined) =>
  (motivo && (ROTULO_MOTIVO_ATRASO as Record<string, string>)[motivo]) || "";
