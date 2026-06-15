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

export interface OcorrenciaRecorrencia {
  ano: number;
  mes: number;
  periodo: string; // "AAAA-MM"
  data: Date;
}

/**
 * Lista as próximas ocorrências (datas agendadas) de uma recorrência, a partir
 * de uma data de corte (default: hoje), respeitando a vigência e um limite.
 * Função pura — usada tanto na prévia (cliente) quanto na geração (servidor).
 */
export function proximasOcorrencias(opts: {
  dataInicio: Date;
  dataFim?: Date | null;
  frequencia: Periodicidade | string | null | undefined;
  diaRecorrencia?: number | null;
  fimSemana?: TratamentoFimSemana | string | null;
  limite?: number;
  aPartirDe?: Date;
}): OcorrenciaRecorrencia[] {
  const limite = opts.limite ?? 12;
  const intervalo = intervaloMeses(opts.frequencia);
  const inicio = new Date(opts.dataInicio);
  const desde = opts.aPartirDe ? new Date(opts.aPartirDe) : new Date();
  desde.setHours(0, 0, 0, 0);
  const fim = opts.dataFim ? new Date(opts.dataFim) : null;

  const out: OcorrenciaRecorrencia[] = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1, 12, 0, 0);

  for (let i = 0; i < 600 && out.length < limite; i++) {
    const ano = cursor.getFullYear();
    const mes = cursor.getMonth() + 1;
    if (fim && new Date(ano, mes - 1, 1) > fim) break;
    if (ehOcorrencia(inicio, ano, mes, intervalo)) {
      const data = dataAgendadaRecorrencia(ano, mes, opts.diaRecorrencia ?? 1, opts.fimSemana);
      if ((!fim || data <= fim) && data >= desde) {
        out.push({ ano, mes, periodo: `${ano}-${String(mes).padStart(2, "0")}`, data });
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}
