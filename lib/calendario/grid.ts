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

/* ───────── navegação: as setas andam no período que está na tela ───────── */

/** O ponto em que o calendário está: mês/ano e, na visão Semana, o dia de referência. */
export interface PontoDoCalendario { ano: number; mes: number; dia: number }

/**
 * Para onde as setas `‹ ›` levam, no período da visão ATUAL.
 *
 * Até esta leva as duas setas somavam um MÊS mesmo na visão Semana — não havia como ir para a
 * semana seguinte, só pular o mês inteiro. Agora:
 *   • Mês    → mês a mês (o dia vai para o 1º, que é o que a grade do mês usa);
 *   • Semana → semana a semana, sete dias para frente ou para trás, virando mês e ano sozinho.
 */
export function passoDoPeriodo(
  view: "mensal" | "semanal", de: PontoDoCalendario, direcao: 1 | -1,
): PontoDoCalendario {
  if (view === "semanal") {
    const d = diaCivilUTC(de.ano, de.mes - 1, de.dia + 7 * direcao);
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
  }
  const d = diaCivilUTC(de.ano, de.mes - 1 + direcao, 1);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: 1 };
}

const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * O que o cabeçalho escreve: no mês, "Novembro 2026"; na semana, o intervalo dela — porque uma
 * semana atravessa o mês ("29 de novembro – 5 de dezembro de 2026") e o nome do mês sozinho
 * mentiria sobre o que está na tela.
 */
export function rotuloDoPeriodo(view: "mensal" | "semanal", dias: Date[], mes: number, ano: number): string {
  const mesTitulo = (MES_LONGO[mes - 1] ?? "").replace(/^./, (c) => c.toUpperCase());
  if (view !== "semanal" || dias.length < 2) return `${mesTitulo} ${ano}`;
  const a = dias[0], b = dias[dias.length - 1];
  const dA = a.getUTCDate(), dB = b.getUTCDate();
  const mA = MES_LONGO[a.getUTCMonth()], mB = MES_LONGO[b.getUTCMonth()];
  const yA = a.getUTCFullYear(), yB = b.getUTCFullYear();
  if (yA !== yB) return `${dA} de ${mA} de ${yA} – ${dB} de ${mB} de ${yB}`;
  if (mA !== mB) return `${dA} de ${mA} – ${dB} de ${mB} de ${yB}`;
  return `${dA} – ${dB} de ${mB} de ${yB}`;
}
