/**
 * Datas no fuso da operação (America/Sao_Paulo). O servidor (Vercel) roda em UTC, então
 * "hoje" calculado com `new Date(ano, mes, dia)` erra o dia entre 21h e 0h de Brasília.
 * O Brasil não tem horário de verão desde 2019: o deslocamento é fixo em -03:00.
 */
export const FUSO_OPERACAO = "America/Sao_Paulo";
const OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

/** Ano/mês(0-11)/dia do instante, no fuso da operação. */
export function partesBR(d: Date = new Date()) {
  const local = new Date(d.getTime() - OFFSET_MS);
  return { ano: local.getUTCFullYear(), mes: local.getUTCMonth(), dia: local.getUTCDate() };
}

/** Instante (UTC) em que começa o dia `ano-mes-dia` em Brasília. */
export function inicioDiaBR(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes, dia) + OFFSET_MS);
}

/** Início do dia de hoje em Brasília (+ `deslocDias`). */
export function inicioHojeBR(agora: Date = new Date(), deslocDias = 0): Date {
  const { ano, mes, dia } = partesBR(agora);
  return inicioDiaBR(ano, mes, dia + deslocDias);
}

/** Início do mês corrente em Brasília (+ `deslocMeses`). */
export function inicioMesBR(agora: Date = new Date(), deslocMeses = 0): Date {
  const { ano, mes } = partesBR(agora);
  return inicioDiaBR(ano, mes + deslocMeses, 1);
}

/** Chave "AAAA-MM-DD" do dia em Brasília (para agrupar por dia). */
export function chaveDiaBR(d: Date): string {
  const { ano, mes, dia } = partesBR(d);
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** "HH:mm" em Brasília. */
export function horaBR(d: Date): string {
  const local = new Date(d.getTime() - OFFSET_MS);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}
