/**
 * Parcelas da conta a pagar gerada pela nota de compra (E2.1). Puro (tela e servidor).
 *
 * Padrão = as duplicatas da NF (cobr/dup); sem duplicata, uma parcela à vista no valor da nota. Na
 * central de lançamento a pessoa ajusta tudo antes de lançar: o nº de parcelas (redistribui o valor da
 * nota), cada vencimento ou todos de uma vez, cada valor e o boleto de cada uma. Soma diferente do
 * valor da nota (vNF) só AVISA: valem as parcelas.
 */
import { diaNoBrasil, type DuplicataNfe } from "@/lib/compras/nfe";

export interface ParcelaRascunho {
  /** nDup da NF quando a parcela é a duplicata (some ao mudar o nº de parcelas) */
  duplicata: string | null;
  /** "AAAA-MM-DD" */
  vencimento: string;
  valor: number;
  /** linha digitável ou código de barras, só dígitos (null = ainda sem boleto) */
  boleto: string | null;
}

export const MAX_PARCELAS = 120;
/** "Todos de uma vez": mensal (mesmo dia, todo mês) ou a cada N dias */
export type Intervalo = "mensal" | number;

const centavos = (n: number) => Math.round(n * 100);
export const somaParcelas = (ps: { valor: number }[]) => centavos(ps.reduce((t, p) => t + p.valor, 0)) / 100;

/** As parcelas que a NF traz (duplicatas), ou a parcela única à vista na data de emissão. */
export function parcelasDaNf(n: { duplicatas: DuplicataNfe[]; valorTotal: number; dataEmissao: Date }): ParcelaRascunho[] {
  if (n.duplicatas.length)
    return n.duplicatas.map((d) => ({ duplicata: d.numero, vencimento: d.vencimento, valor: d.valor, boleto: null }));
  return [{ duplicata: null, vencimento: diaNoBrasil(n.dataEmissao), valor: n.valorTotal, boleto: null }];
}

/** "AAAA-MM-DD" + meses (dia 31 em mês curto vira o último dia do mês) */
export function somarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
export function somarDias(dia: string, dias: number): string {
  const t = new Date(`${dia}T12:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}
const proximo = (dia: string, k: number, intervalo: Intervalo) => (intervalo === "mensal" ? somarMeses(dia, k) : somarDias(dia, intervalo * k));

/** Divide o total em n parcelas iguais; os centavos que sobram vão para a última. */
export function dividir(total: number, n: number): number[] {
  const t = centavos(total);
  const base = Math.floor(t / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? t - base * (n - 1) : base) / 100);
}

/**
 * Muda o nº de parcelas: o valor da NOTA é redistribuído em partes iguais; os vencimentos que já
 * existem ficam e os novos seguem mês a mês depois do último. Boleto fica onde a parcela continua.
 * A numeração das duplicatas deixa de valer (as parcelas não são mais as da NF).
 */
export function redistribuir(atuais: ParcelaRascunho[], n: number, totalNota: number, hoje: string): ParcelaRascunho[] {
  const qtd = Math.max(1, Math.min(MAX_PARCELAS, Math.trunc(n) || 1));
  const valores = dividir(totalNota, qtd);
  const base = atuais.length ? atuais : [{ duplicata: null, vencimento: hoje, valor: 0, boleto: null }];
  return valores.map((valor, i) => {
    const existente = base[i];
    const ultimo = base[base.length - 1];
    return {
      duplicata: null,
      vencimento: existente?.vencimento ?? somarMeses(ultimo.vencimento, i - (base.length - 1)),
      valor,
      boleto: existente?.boleto ?? null,
    };
  });
}

/** Todos de uma vez: 1º vencimento e o intervalo (mensal = mesmo dia todo mês, ou a cada N dias). */
export function aplicarVencimentos(atuais: ParcelaRascunho[], primeiro: string, intervalo: Intervalo): ParcelaRascunho[] {
  return atuais.map((p, i) => ({ ...p, vencimento: i === 0 ? primeiro : proximo(primeiro, i, intervalo) }));
}

/** Soma das parcelas ≠ valor da nota: o aviso (null = bate). */
export function avisoSomaParcelas(ps: { valor: number }[], totalNota: number): string | null {
  const soma = somaParcelas(ps);
  const dif = centavos(soma) - centavos(totalNota);
  if (dif === 0) return null;
  const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `As parcelas somam ${moeda(soma)} e a nota é de ${moeda(totalNota)} (${dif > 0 ? "sobram" : "faltam"} ${moeda(Math.abs(dif) / 100)}). As contas a pagar seguem as parcelas.`;
}

/** As parcelas são as mesmas da NF (para mostrar "como veio na NF")? */
export function igualANf(ps: ParcelaRascunho[], nf: ParcelaRascunho[]): boolean {
  return ps.length === nf.length && ps.every((p, i) => p.vencimento === nf[i].vencimento && centavos(p.valor) === centavos(nf[i].valor) && p.duplicata === nf[i].duplicata);
}
