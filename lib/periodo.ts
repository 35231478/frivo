/**
 * Período das telas financeiras (padrão da casa — central de NFS-e, Contas a Receber…): o mês com
 * ‹ ›, um intervalo personalizado (de/até) ou, onde a tela permite, "todo o período". Fica na URL
 * (`mes`, `de`, `ate`, `periodo=todos`): compartilhável e o "voltar" do navegador funciona.
 */
import { diaCivilUTC, inicioDiaBR, partesBR } from "@/lib/fuso";
import { MESES_PT } from "@/lib/utils";
import { um, type ParamsUrl } from "@/lib/listagem";

export interface Periodo {
  tipo: "mes" | "intervalo" | "todos";
  /** "AAAA-MM" (tipo mes) */
  mes: string | null;
  /** "AAAA-MM-DD" (tipo intervalo; um dos dois pode faltar) */
  de: string | null;
  ate: string | null;
  /** Instantes (UTC) do período no relógio de Brasília: [gte, lt) */
  gte: Date | null;
  lt: Date | null;
  rotulo: string;
}

const RE_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
function diaValido(v: string): { ano: number; mes: number; dia: number } | null {
  const m = RE_DIA.exec(v);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const d = new Date(Date.UTC(ano, mes, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes && d.getUTCDate() === dia ? { ano, mes, dia } : null;
}
const br = (v: string) => v.split("-").reverse().join("/");

/** "AAAA-MM" do mês corrente em Brasília */
export function mesAtual(agora = new Date()) {
  const { ano, mes } = partesBR(agora);
  return `${ano}-${String(mes + 1).padStart(2, "0")}`;
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

/**
 * Período da URL: `de`/`ate` (intervalo personalizado, dias de Brasília; datas inválidas ignoradas)
 * vence `mes` (AAAA-MM); sem nada válido = o mês corrente. `ate` antes de `de` = trocados.
 * `periodo=todos` (só onde a tela permite) = sem limite de data.
 */
export function lerPeriodo(sp: ParamsUrl, agora = new Date(), o: { permitirTodos?: boolean } = {}): Periodo {
  if (o.permitirTodos && um(sp.periodo) === "todos") {
    return { tipo: "todos", mes: null, de: null, ate: null, gte: null, lt: null, rotulo: "Todo o período" };
  }
  let de = diaValido(um(sp.de)) ? um(sp.de) : null;
  let ate = diaValido(um(sp.ate)) ? um(sp.ate) : null;
  if (de && ate && ate < de) [de, ate] = [ate, de];
  if (de || ate) {
    const a = de ? diaValido(de)! : null, b = ate ? diaValido(ate)! : null;
    return {
      tipo: "intervalo", mes: null, de, ate,
      gte: a ? inicioDiaBR(a.ano, a.mes, a.dia) : null,
      lt: b ? inicioDiaBR(b.ano, b.mes, b.dia + 1) : null,
      rotulo: de && ate ? `${br(de)} a ${br(ate)}` : de ? `A partir de ${br(de)}` : `Até ${br(ate!)}`,
    };
  }
  const mes = RE_MES.test(um(sp.mes)) ? um(sp.mes) : mesAtual(agora);
  const [ano, m] = mes.split("-").map(Number);
  return { tipo: "mes", mes, de: null, ate: null, gte: inicioDiaBR(ano, m - 1, 1), lt: inicioDiaBR(ano, m, 1), rotulo: rotuloMes(mes) };
}

/**
 * O mesmo período sobre uma coluna de DIA CIVIL (vencimento: meia-noite UTC do dia): [gte, lt).
 * Todo o período = null (sem condição).
 */
export function faixaDiaCivil(p: Periodo): { gte?: Date; lt?: Date } | null {
  if (p.tipo === "todos") return null;
  if (p.tipo === "mes" && p.mes) {
    const [ano, m] = p.mes.split("-").map(Number);
    return { gte: diaCivilUTC(ano, m - 1, 1), lt: diaCivilUTC(ano, m, 1) };
  }
  const a = p.de ? diaValido(p.de) : null, b = p.ate ? diaValido(p.ate) : null;
  if (!a && !b) return null;
  return { ...(a && { gte: diaCivilUTC(a.ano, a.mes, a.dia) }), ...(b && { lt: diaCivilUTC(b.ano, b.mes, b.dia + 1) }) };
}
