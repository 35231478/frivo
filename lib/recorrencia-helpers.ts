import type { Periodicidade, TratamentoFimSemana } from "@prisma/client";

/** Intervalo em meses de uma frequência de recorrência. */
export function intervaloMeses(freq: Periodicidade | string | null | undefined): number {
  switch (freq) {
    case "MENSAL": return 1;
    case "BIMESTRAL": return 2;
    case "TRIMESTRAL": return 3;
    case "SEMESTRAL": return 6;
    case "ANUAL": return 12;
    default: return 1;
  }
}

/**
 * Ajusta uma data conforme o tratamento de fim de semana.
 * Recebe/retorna uma data ao meio-dia para evitar problemas de fuso.
 */
export function ajustarFimDeSemana(data: Date, tratamento: TratamentoFimSemana | string | null | undefined): Date {
  const d = new Date(data);
  const dow = d.getDay(); // 0 = domingo, 6 = sábado
  if (tratamento === "ADIANTAR") {
    if (dow === 6) d.setDate(d.getDate() - 1); // sábado → sexta
    else if (dow === 0) d.setDate(d.getDate() - 2); // domingo → sexta
  } else if (tratamento === "POSTERGAR") {
    if (dow === 6) d.setDate(d.getDate() + 2); // sábado → segunda
    else if (dow === 0) d.setDate(d.getDate() + 1); // domingo → segunda
  }
  return d;
}

/**
 * Verifica se o mês/ano alvo é uma ocorrência da recorrência iniciada em dataInicio.
 * Ex.: trimestral a partir de jan → jan, abr, jul, out.
 */
export function ehOcorrencia(dataInicio: Date, alvoAno: number, alvoMes: number, intervalo: number): boolean {
  const inicio = new Date(dataInicio);
  const diff = (alvoAno - inicio.getFullYear()) * 12 + (alvoMes - 1 - inicio.getMonth());
  return diff >= 0 && diff % intervalo === 0;
}

/** Monta a data agendada (dia do mês, ao meio-dia) com tratamento de fim de semana aplicado. */
export function dataAgendadaRecorrencia(
  ano: number,
  mes: number,
  dia: number,
  tratamento: TratamentoFimSemana | string | null | undefined,
): Date {
  const diaSeguro = Math.min(Math.max(dia || 1, 1), 28);
  const base = new Date(ano, mes - 1, diaSeguro, 12, 0, 0);
  return ajustarFimDeSemana(base, tratamento);
}
