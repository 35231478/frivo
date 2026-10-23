import { chaveDiaBR, chaveDiaCivil, diaCivilUTC, ehDiaCivil, horaBR, inicioDiaBR } from "@/lib/fuso";

/**
 * Grid do calendário no relógio de BRASÍLIA (o servidor roda em UTC). Os dias são dias civis
 * (meia-noite UTC); os limites de busca são instantes do começo/fim desses dias em Brasília.
 * Puro: a página do calendário só consulta o banco e monta os cards.
 */
export function gridCalendario({ ano, mes, view, dia }: { ano: number; mes: number; view: "mensal" | "semanal"; dia: number }) {
  const dias: Date[] = [];
  if (view === "semanal") {
    const ref = diaCivilUTC(ano, mes - 1, dia);
    const domingo = ref.getUTCDate() - ref.getUTCDay();
    for (let i = 0; i < 7; i++) dias.push(diaCivilUTC(ref.getUTCFullYear(), ref.getUTCMonth(), domingo + i));
  } else {
    const primeiro = diaCivilUTC(ano, mes - 1, 1);
    // 6 semanas cobrem qualquer mês (começando no domingo)
    for (let i = 0; i < 42; i++) dias.push(diaCivilUTC(ano, mes - 1, 1 - primeiro.getUTCDay() + i));
  }
  const primeiroDia = dias[0], ultimoDia = dias[dias.length - 1];
  const gridInicio = inicioDiaBR(primeiroDia.getUTCFullYear(), primeiroDia.getUTCMonth(), primeiroDia.getUTCDate());
  const gridFim = new Date(inicioDiaBR(ultimoDia.getUTCFullYear(), ultimoDia.getUTCMonth(), ultimoDia.getUTCDate() + 1).getTime() - 1);
  return {
    dias,
    chaves: new Set(dias.map(chaveDiaCivil)),
    /** Instantes (atividade agendada, previsão com hora) */
    periodo: { gte: gridInicio, lte: gridFim },
    /** Dias civis (previsão só de dia) */
    periodoDia: { gte: primeiroDia, lt: diaCivilUTC(ultimoDia.getUTCFullYear(), ultimoDia.getUTCMonth(), ultimoDia.getUTCDate() + 1) },
  };
}

/**
 * Em que dia (chave "AAAA-MM-DD") e a que hora um card aparece: atividade agendada = dia e hora de
 * Brasília; previsão só de dia = o próprio dia, sem hora inventada ("00:00").
 */
export function posicaoNoCalendario(data: Date | string, deAtividade: boolean): { chave: string; hora: string | null } {
  const d = new Date(data);
  if (!deAtividade && ehDiaCivil(d)) return { chave: chaveDiaCivil(d), hora: null };
  return { chave: chaveDiaBR(d), hora: horaBR(d) };
}
