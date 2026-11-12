import type { Periodicidade, TratamentoFimSemana } from "@prisma/client";
import { chaveDiaCivil, diaCivilUTC, instanteBR, partesBR } from "@/lib/fuso";

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
 * Ajusta uma data conforme o tratamento de fim de semana — pelo dia da semana EM BRASÍLIA (no
 * servidor em UTC e em qualquer navegador). Mantém a hora; só desloca dias inteiros.
 */
export function ajustarFimDeSemana(data: Date, tratamento: TratamentoFimSemana | string | null | undefined): Date {
  const dow = partesBR(data).diaSemana; // 0 = domingo, 6 = sábado
  let delta = 0;
  if (tratamento === "ADIANTAR") {
    if (dow === 6) delta = -1; // sábado → sexta
    else if (dow === 0) delta = -2; // domingo → sexta
  } else if (tratamento === "POSTERGAR") {
    if (dow === 6) delta = 2; // sábado → segunda
    else if (dow === 0) delta = 1; // domingo → segunda
  }
  return new Date(data.getTime() + delta * 86_400_000);
}

/**
 * Verifica se o mês/ano alvo é uma ocorrência da recorrência iniciada em dataInicio.
 * Ex.: trimestral a partir de jan → jan, abr, jul, out.
 */
export function ehOcorrencia(dataInicio: Date, alvoAno: number, alvoMes: number, intervalo: number): boolean {
  // Início é dia civil: mês/ano do dia gravado (no navegador em Brasília não volta para o mês anterior)
  const [anoIni, mesIni] = chaveDiaCivil(dataInicio).split("-").map(Number);
  const diff = (alvoAno - anoIni) * 12 + (alvoMes - mesIni);
  return diff >= 0 && diff % intervalo === 0;
}

/** Monta a data agendada (dia do mês, ao MEIO-DIA DE BRASÍLIA) com tratamento de fim de semana aplicado. */
export function dataAgendadaRecorrencia(
  ano: number,
  mes: number,
  dia: number,
  tratamento: TratamentoFimSemana | string | null | undefined,
): Date {
  const diaSeguro = Math.min(Math.max(dia || 1, 1), 28);
  const base = instanteBR(ano, mes - 1, diaSeguro, 12, 0);
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
  // "A partir de hoje" = início do dia em Brasília; o fim da vigência vale o dia inteiro (dia civil)
  const { ano: anoDesde, mes: mesDesde, dia: diaDesde } = partesBR(opts.aPartirDe ?? new Date());
  const desde = instanteBR(anoDesde, mesDesde, diaDesde);
  const chaveFim = opts.dataFim ? chaveDiaCivil(opts.dataFim) : null;
  const fim = chaveFim ? (() => { const [a, m, d] = chaveFim.split("-").map(Number); return instanteBR(a, m - 1, d + 1); })() : null;

  const out: OcorrenciaRecorrencia[] = [];
  const [anoIni, mesIni] = chaveDiaCivil(inicio).split("-").map(Number);
  let cursorAno = anoIni, cursorMes0 = mesIni - 1;

  for (let i = 0; i < 600 && out.length < limite; i++) {
    const ano = cursorAno;
    const mes = cursorMes0 + 1;
    if (fim && diaCivilUTC(ano, mes - 1, 1) >= fim) break;
    if (ehOcorrencia(inicio, ano, mes, intervalo)) {
      const data = dataAgendadaRecorrencia(ano, mes, opts.diaRecorrencia ?? 1, opts.fimSemana);
      if ((!fim || data < fim) && data >= desde) {
        out.push({ ano, mes, periodo: `${ano}-${String(mes).padStart(2, "0")}`, data });
      }
    }
    cursorMes0++; if (cursorMes0 > 11) { cursorMes0 = 0; cursorAno++; }
  }
  return out;
}
