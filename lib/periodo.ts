/**
 * Período das telas de lista (padrão da casa — Orçamentos, OS, Contas a Receber/Pagar, NFS-e,
 * Faturas…): um seletor compacto com atalhos (Hoje · Esta semana · Este mês · Este ano · Últimos
 * 30 dias · Últimos 12 meses · Todo o período · Período personalizado) e as setas ‹ › que andam
 * uma unidade do atalho (dia, semana, mês, ano, 30 dias, 12 meses ou o tamanho do intervalo).
 *
 * Fica na URL (compartilhável; o "voltar" do navegador funciona):
 *   - `mes=AAAA-MM`                       → o mês (o mês corrente é o padrão e não vai para a URL);
 *   - `de=AAAA-MM-DD` / `ate=AAAA-MM-DD`  → período personalizado (vence os outros);
 *   - `periodo=hoje|semana|ano|30d|12m`   → o atalho, com `ref=AAAA-MM-DD` quando navegado
 *                                           (sem `ref` = o de hoje; para 30d/12m, `ref` é o último dia);
 *   - `periodo=todos`                     → sem limite de data (só onde a tela permite).
 * Dias são os de Brasília; `gte`/`lt` são os instantes [início, fim) para colunas de instante e
 * `dias` os dias civis inclusivos para colunas de DIA (vencimento).
 */
import { inicioDiaBR, partesBR } from "@/lib/fuso";
import { MESES_PT } from "@/lib/utils";
import { um, type ParamsUrl } from "@/lib/listagem";

export type TipoPeriodo = "hoje" | "semana" | "mes" | "ano" | "30d" | "12m" | "todos" | "intervalo";
/** Os atalhos do seletor, na ordem do menu */
export const ATALHOS: { tipo: TipoPeriodo; nome: string }[] = [
  { tipo: "hoje", nome: "Hoje" },
  { tipo: "semana", nome: "Esta semana" },
  { tipo: "mes", nome: "Este mês" },
  { tipo: "ano", nome: "Este ano" },
  { tipo: "30d", nome: "Últimos 30 dias" },
  { tipo: "12m", nome: "Últimos 12 meses" },
  { tipo: "todos", nome: "Todo o período" },
  { tipo: "intervalo", nome: "Período personalizado" },
];
export const nomeAtalho = (tipo: TipoPeriodo) => ATALHOS.find((a) => a.tipo === tipo)!.nome;

export interface Periodo {
  tipo: TipoPeriodo;
  /** "AAAA-MM" (tipo mes) */
  mes: string | null;
  /** "AAAA-MM-DD" do período personalizado (tipo intervalo; um dos dois pode faltar) */
  de: string | null;
  ate: string | null;
  /** "AAAA-MM-DD" de referência dos atalhos navegados (hoje/semana/ano: um dia dentro; 30d/12m: o último dia) */
  ref: string | null;
  /** Dias civis inclusivos do período (null = sem limite); um lado pode faltar no intervalo */
  dias: { de: string | null; ate: string | null } | null;
  /** Instantes (UTC) do período no relógio de Brasília: [gte, lt) */
  gte: Date | null;
  lt: Date | null;
  rotulo: string;
}
export type PadraoPeriodo = "mes" | "todos";

const RE_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
type Ymd = { ano: number; mes: number; dia: number };
function diaValido(v: string): Ymd | null {
  const m = RE_DIA.exec(v);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const d = new Date(Date.UTC(ano, mes, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes && d.getUTCDate() === dia ? { ano, mes, dia } : null;
}
const utc = (y: Ymd, dDias = 0) => new Date(Date.UTC(y.ano, y.mes, y.dia + dDias));
const chave = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
/** "AAAA-MM-DD" deslocado em dias (aritmética de dia civil, sem fuso) */
export function diaMais(dia: string, n: number) {
  const y = diaValido(dia);
  return y ? chave(utc(y, n)) : dia;
}
/** "AAAA-MM-DD" deslocado em meses (dia 31 + 1 mês cai no último dia do mês seguinte) */
export function mesMais(dia: string, n: number) {
  const y = diaValido(dia);
  if (!y) return dia;
  const ultimo = new Date(Date.UTC(y.ano, y.mes + n + 1, 0)).getUTCDate();
  return chave(new Date(Date.UTC(y.ano, y.mes + n, Math.min(y.dia, ultimo))));
}
const br = (v: string) => v.split("-").reverse().join("/");
const diasEntre = (a: string, b: string) => Math.round((utc(diaValido(b)!).getTime() - utc(diaValido(a)!).getTime()) / 86_400_000);

/** "AAAA-MM-DD" de hoje em Brasília */
export function hojeBR(agora = new Date()) {
  const { ano, mes, dia } = partesBR(agora);
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
/** "AAAA-MM" do mês corrente em Brasília */
export function mesAtual(agora = new Date()) {
  return hojeBR(agora).slice(0, 7);
}
/** Mês vizinho de "AAAA-MM" (delta = -1 anterior, +1 seguinte) */
export function mesVizinho(mes: string, delta: number) {
  const m = RE_MES.exec(mes);
  if (!m) return mes;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export const rotuloMes = (mes: string) => {
  const m = RE_MES.exec(mes);
  return m ? `${MESES_PT[Number(m[2]) - 1]} de ${m[1]}` : mes;
};
/** Segunda-feira da semana do dia */
export function inicioSemana(dia: string) {
  const y = diaValido(dia);
  if (!y) return dia;
  const dow = utc(y).getUTCDay(); // 0 = domingo
  return chave(utc(y, dow === 0 ? -6 : 1 - dow));
}

const NOMES_DIA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function montar(tipo: TipoPeriodo, campos: Partial<Periodo>, dias: Periodo["dias"], rotulo: string): Periodo {
  const a = dias?.de ? diaValido(dias.de) : null, b = dias?.ate ? diaValido(dias.ate) : null;
  return {
    tipo, mes: null, de: null, ate: null, ref: null, ...campos, dias,
    gte: a ? inicioDiaBR(a.ano, a.mes, a.dia) : null,
    lt: b ? inicioDiaBR(b.ano, b.mes, b.dia + 1) : null,
    rotulo,
  };
}

/**
 * Período da URL. Ordem: `de`/`ate` (personalizado; datas inválidas ignoradas; `ate` antes de `de` =
 * trocados) › `periodo` (atalho; "todos" só onde a tela permite) › `mes` › o padrão da tela
 * (`padrao`: "mes" = o mês corrente, "todos" = sem limite).
 */
export function lerPeriodo(sp: ParamsUrl, agora = new Date(), o: { permitirTodos?: boolean; padrao?: PadraoPeriodo } = {}): Periodo {
  const hoje = hojeBR(agora);
  let de = diaValido(um(sp.de)) ? um(sp.de) : null;
  let ate = diaValido(um(sp.ate)) ? um(sp.ate) : null;
  if (de && ate && ate < de) [de, ate] = [ate, de];
  if (de || ate) {
    const rotulo = de && ate ? `${br(de)} a ${br(ate)}` : de ? `A partir de ${br(de)}` : `Até ${br(ate!)}`;
    return montar("intervalo", { de, ate }, { de, ate }, rotulo);
  }
  const atalho = um(sp.periodo);
  const refUrl = diaValido(um(sp.ref)) ? um(sp.ref) : null;
  const todos = () => montar("todos", {}, null, "Todo o período");
  if (atalho === "todos" && o.permitirTodos) return todos();
  if (atalho === "hoje") {
    const dia = refUrl ?? hoje;
    const y = diaValido(dia)!;
    return montar("hoje", { ref: dia === hoje ? null : dia }, { de: dia, ate: dia }, dia === hoje ? `Hoje, ${br(dia)}` : `${NOMES_DIA[utc(y).getUTCDay()]}, ${br(dia)}`);
  }
  if (atalho === "semana") {
    const ini = inicioSemana(refUrl ?? hoje), fim = diaMais(ini, 6);
    return montar("semana", { ref: ini === inicioSemana(hoje) ? null : ini }, { de: ini, ate: fim }, `${br(ini)} a ${br(fim)}`);
  }
  if (atalho === "ano") {
    const ano = (refUrl ?? hoje).slice(0, 4);
    return montar("ano", { ref: ano === hoje.slice(0, 4) ? null : `${ano}-01-01` }, { de: `${ano}-01-01`, ate: `${ano}-12-31` }, ano);
  }
  if (atalho === "30d" || atalho === "12m") {
    const fim = refUrl ?? hoje;
    const ini = atalho === "30d" ? diaMais(fim, -29) : diaMais(mesMais(fim, -12), 1);
    return montar(atalho, { ref: fim === hoje ? null : fim }, { de: ini, ate: fim }, `${br(ini)} a ${br(fim)}`);
  }
  const mesUrl = RE_MES.test(um(sp.mes)) ? um(sp.mes) : null;
  if (!mesUrl && o.padrao === "todos") return todos();
  const mes = mesUrl ?? mesAtual(agora);
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return montar("mes", { mes }, { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` }, rotuloMes(mes));
}

/** Os parâmetros do período zerados (base de qualquer troca) */
export const PARAMS_PERIODO = { mes: null, de: null, ate: null, periodo: null, ref: null } as const;

/** Mudanças na URL para ir a um atalho (o "de hoje"); `intervalo` é tratado pela tela (abre os campos). */
export function urlDoAtalho(tipo: Exclude<TipoPeriodo, "intervalo">): Record<string, string | null> {
  return { ...PARAMS_PERIODO, ...(tipo === "mes" ? {} : { periodo: tipo }) };
}

/**
 * Mudanças na URL para a seta ‹ (delta -1) ou › (+1): anda uma unidade do atalho (dia, semana, mês,
 * ano, 30 dias, 12 meses, ou o tamanho do intervalo). "Todo o período" (e intervalo aberto) = null.
 */
export function urlVizinho(p: Periodo, delta: number, agora = new Date()): Record<string, string | null> | null {
  const hoje = hojeBR(agora);
  const limpar = (ref: string | null, periodo: string) => ({ ...PARAMS_PERIODO, periodo, ref });
  switch (p.tipo) {
    case "mes": {
      const m = mesVizinho(p.mes ?? mesAtual(agora), delta);
      return { ...PARAMS_PERIODO, mes: m === mesAtual(agora) ? null : m };
    }
    case "hoje": {
      const dia = diaMais(p.dias!.de!, delta);
      return limpar(dia === hoje ? null : dia, "hoje");
    }
    case "semana": {
      const ini = diaMais(p.dias!.de!, 7 * delta);
      return limpar(ini === inicioSemana(hoje) ? null : ini, "semana");
    }
    case "ano": {
      const ano = Number(p.dias!.de!.slice(0, 4)) + delta;
      return limpar(String(ano) === hoje.slice(0, 4) ? null : `${ano}-01-01`, "ano");
    }
    case "30d": {
      const fim = diaMais(p.dias!.ate!, 30 * delta);
      return limpar(fim === hoje ? null : fim, "30d");
    }
    case "12m": {
      const fim = mesMais(p.dias!.ate!, 12 * delta);
      return limpar(fim === hoje ? null : fim, "12m");
    }
    case "intervalo": {
      if (!p.de || !p.ate) return null;
      const n = (diasEntre(p.de, p.ate) + 1) * delta;
      return { ...PARAMS_PERIODO, de: diaMais(p.de, n), ate: diaMais(p.ate, n) };
    }
    default:
      return null;
  }
}

/** O período é "o de hoje" do atalho (sem navegação)? Decide se o menu mostra "Este mês" ou só o rótulo. */
export const ehAtual = (p: Periodo, agora = new Date()) =>
  p.tipo === "todos" || p.tipo === "intervalo" ? false : p.tipo === "mes" ? (p.mes === mesAtual(agora)) : p.ref === null;

/**
 * O mesmo período sobre uma coluna de DIA CIVIL (vencimento: meia-noite UTC do dia): [gte, lt).
 * Todo o período = null (sem condição).
 */
export function faixaDiaCivil(p: Periodo): { gte?: Date; lt?: Date } | null {
  if (!p.dias) return null;
  const a = p.dias.de ? diaValido(p.dias.de) : null, b = p.dias.ate ? diaValido(p.dias.ate) : null;
  if (!a && !b) return null;
  const utcDia = (y: Ymd, mais = 0) => new Date(Date.UTC(y.ano, y.mes, y.dia + mais));
  return { ...(a && { gte: utcDia(a) }), ...(b && { lt: utcDia(b, 1) }) };
}
