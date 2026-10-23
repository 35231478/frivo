/**
 * Datas no fuso da operação (America/Sao_Paulo) — o ÚNICO lugar do sistema que converte fuso.
 * O servidor (Vercel) roda em UTC e o navegador pode estar em qualquer fuso/idioma; por isso nada
 * aqui usa getHours/getDate/setHours "locais": tudo é calculado pelo relógio de Brasília.
 * O Brasil não tem horário de verão desde 2019: o deslocamento é fixo em -03:00.
 *
 * Dois tipos de valor:
 *  - INSTANTE (criadoEm, dataAgendada, pagoEm…): um momento; mostra-se a hora de Brasília.
 *  - DIA CIVIL (vencimento, validade, prazo, previsão…): só o dia. É gravado à meia-noite UTC
 *    ("AAAA-MM-DD" do campo de data) — ou ao meio-dia UTC (NF-e). O dia não tem fuso: lê-se como
 *    está. `chaveDiaCivil` reconhece os dois: meia-noite UTC = dia gravado; qualquer outra hora =
 *    instante, e vale o dia dele em Brasília.
 *
 * Regra de comparação: um dia civil "passou" quando o DIA DE HOJE EM BRASÍLIA é posterior a ele —
 * nunca às 21h da véspera (o erro de comparar `prazo < new Date()`).
 */
export const FUSO_OPERACAO = "America/Sao_Paulo";
const OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3
const DIA_MS = 86_400_000;

const dois = (n: number) => String(n).padStart(2, "0");
const comoData = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));

/** Ano/mês(0-11)/dia/hora/minuto/segundo/dia-da-semana do instante, no relógio de Brasília. */
export function partesBR(d: Date | string | number = new Date()) {
  const local = new Date(comoData(d).getTime() - OFFSET_MS);
  return {
    ano: local.getUTCFullYear(), mes: local.getUTCMonth(), dia: local.getUTCDate(),
    hora: local.getUTCHours(), minuto: local.getUTCMinutes(), segundo: local.getUTCSeconds(),
    diaSemana: local.getUTCDay(),
  };
}

/** Instante (UTC) em que começa o dia `ano-mes-dia` em Brasília (aceita mês/dia fora da faixa). */
export function inicioDiaBR(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes, dia) + OFFSET_MS);
}

/** Instante (UTC) de `ano-mes-dia hora:minuto` no relógio de Brasília. */
export function instanteBR(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  return new Date(Date.UTC(ano, mes, dia, hora, minuto) + OFFSET_MS);
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

/** Início do dia (em Brasília) de um instante qualquer. */
export function inicioDoDiaBR(d: Date | string): Date {
  const { ano, mes, dia } = partesBR(d);
  return inicioDiaBR(ano, mes, dia);
}

/** Chave "AAAA-MM-DD" do dia em Brasília de um INSTANTE (para agrupar por dia). */
export function chaveDiaBR(d: Date | string | number): string {
  const { ano, mes, dia } = partesBR(d);
  return `${ano}-${dois(mes + 1)}-${dois(dia)}`;
}

/** "HH:mm" em Brasília. */
export function horaBR(d: Date | string | number): string {
  const { hora, minuto } = partesBR(d);
  return `${dois(hora)}:${dois(minuto)}`;
}

/** O valor é um DIA CIVIL gravado à meia-noite UTC (campo só de data)? */
export function ehDiaCivil(d: Date | string | number): boolean {
  const x = comoData(d);
  return !x.getUTCHours() && !x.getUTCMinutes() && !x.getUTCSeconds() && !x.getUTCMilliseconds();
}

/**
 * "AAAA-MM-DD" de um dia civil gravado. Gravado como dia (meia-noite UTC): lê as partes UTC — o
 * dia não tem fuso. Gravado com hora (ex.: OS criada pelo calendário com a hora da visita; NF-e ao
 * meio-dia UTC): é um instante, e vale o dia dele em Brasília.
 */
export function chaveDiaCivil(d: Date | string | number): string {
  const x = comoData(d);
  if (!ehDiaCivil(x)) return chaveDiaBR(x);
  return `${x.getUTCFullYear()}-${dois(x.getUTCMonth() + 1)}-${dois(x.getUTCDate())}`;
}

const diasEntreChaves = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);

/**
 * Dias de hoje (em Brasília) até o dia civil (negativo = já passou; 0 = é hoje). A regra única de
 * "vencido/atrasado/expirado" do sistema. null sem data.
 */
export function diasAteDiaCivil(d: Date | string | null | undefined, agora: Date = new Date()): number | null {
  if (!d) return null;
  return diasEntreChaves(chaveDiaBR(agora), chaveDiaCivil(d));
}

/** O dia civil já passou (hoje em Brasília é depois dele)? */
export const diaCivilPassou = (d: Date | string | null | undefined, agora: Date = new Date()) =>
  (diasAteDiaCivil(d, agora) ?? 0) < 0;

/** Dia civil "AAAA-MM-DD" → o Date gravado (meia-noite UTC). null se vazio/inválido. */
export function diaCivilDeChave(chave: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(chave ?? "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** Hoje (em Brasília) como dia civil gravável (meia-noite UTC do dia de Brasília) + `deslocDias`. */
export function hojeDiaCivil(agora: Date = new Date(), deslocDias = 0): Date {
  const { ano, mes, dia } = partesBR(agora);
  return new Date(Date.UTC(ano, mes, dia + deslocDias));
}

/** Instante → "AAAA-MM-DDTHH:mm" no relógio de Brasília (valor de campo de data e hora). */
export function paraLocalBR(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = comoData(d);
  if (Number.isNaN(x.getTime())) return "";
  const p = partesBR(x);
  return `${p.ano}-${dois(p.mes + 1)}-${dois(p.dia)}T${dois(p.hora)}:${dois(p.minuto)}`;
}

/** "AAAA-MM-DDTHH:mm" no relógio de Brasília → instante. null se inválido. */
export function deLocalBR(valor: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor ?? "");
  if (!m) return null;
  return instanteBR(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/**
 * Um Date cujos campos LOCAIS (getFullYear, getHours…) são o relógio de Brasília do valor — para
 * entregar a bibliotecas de formatação (date-fns) que leem o fuso de quem roda. Dia civil vira a
 * meia-noite do próprio dia (não volta para a véspera).
 */
export function relogioBR(d: Date | string | number): Date {
  const x = comoData(d);
  if (ehDiaCivil(x)) return new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const p = partesBR(x);
  return new Date(p.ano, p.mes, p.dia, p.hora, p.minuto, p.segundo);
}

/**
 * Para FILTRAR no banco colunas de dia civil (gravadas à meia-noite ou ao meio-dia UTC): o dia
 * `ano-mes-dia` começa em `diaCivilUTC(...)` e termina antes do dia seguinte. Ex.: vencidas =
 * `dataVencimento < hojeDiaCivil()`; vencem hoje = `>= hojeDiaCivil()` e `< hojeDiaCivil(agora, 1)`.
 */
export function diaCivilUTC(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes, dia));
}

/** Primeiro dia (dia civil) do mês corrente em Brasília (+ `deslocMeses`). */
export function inicioMesDiaCivil(agora: Date = new Date(), deslocMeses = 0): Date {
  const { ano, mes } = partesBR(agora);
  return diaCivilUTC(ano, mes + deslocMeses, 1);
}

const partesChave = (chave: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(chave);
  return m ? { ano: Number(m[1]), mes: Number(m[2]) - 1, dia: Number(m[3]) } : null;
};

/**
 * Filtro "de/até" (dias "AAAA-MM-DD" da tela) sobre uma coluna de INSTANTE (criadoEm, dataAgendada):
 * do início do dia `de` em Brasília até antes do dia seguinte a `ate`. Campos vazios/ inválidos
 * ficam de fora. Devolve null se nada a filtrar.
 */
export function periodoInstanteBR(de?: string | null, ate?: string | null): { gte?: Date; lt?: Date } | null {
  const a = de ? partesChave(de) : null, b = ate ? partesChave(ate) : null;
  if (!a && !b) return null;
  return {
    ...(a && { gte: inicioDiaBR(a.ano, a.mes, a.dia) }),
    ...(b && { lt: inicioDiaBR(b.ano, b.mes, b.dia + 1) }),
  };
}

/** O mesmo filtro "de/até" sobre uma coluna de DIA CIVIL (vencimento, vigência…). */
export function periodoDiaCivil(de?: string | null, ate?: string | null): { gte?: Date; lt?: Date } | null {
  const a = de ? partesChave(de) : null, b = ate ? partesChave(ate) : null;
  if (!a && !b) return null;
  return {
    ...(a && { gte: diaCivilUTC(a.ano, a.mes, a.dia) }),
    ...(b && { lt: diaCivilUTC(b.ano, b.mes, b.dia + 1) }),
  };
}

/** "AAAA-MM-DD" de hoje em Brasília (+ `deslocDias`) — valor padrão de campo de data. */
export const chaveHojeBR = (deslocDias = 0, agora: Date = new Date()) => chaveDiaBR(inicioHojeBR(agora, deslocDias));

/** Ano corrente em Brasília (numeração "OS-2026-…", "CT-2026-…": não vira o ano às 21h de 31/12). */
export const anoBR = (agora: Date = new Date()) => partesBR(agora).ano;

/** Mês corrente (1-12) em Brasília. */
export const mesBR = (agora: Date = new Date()) => partesBR(agora).mes + 1;

/** Dia do mês (1-31) de um dia civil gravado (vencimento, primeira OS…) — o dia gravado, sem fuso. */
export const diaDoMesCivil = (d: Date | string) => Number(chaveDiaCivil(d).slice(8, 10));
