/**
 * Reajuste anual do contrato (PR4, D8 = percentual fixo, SUGERIDO e CONFIRMADO). Regras puras:
 * - aniversário: o mês de aniversário do contrato (sem ele, o mês do início). O 1º reajuste vem no 1º
 *   aniversário com pelo menos 12 meses de contrato; depois, um por ano;
 * - só o percentual fixo gera a sugestão (índices como IPCA ficam para reajustar à mão);
 * - no mês do aniversário (ou depois, enquanto ninguém decidir), a sugestão fica pendente: aplicar,
 *   adiar ou dispensar. Uma decisão por contrato × ano; o ano que passou sem decisão não acumula;
 * - "Avisar antes" mostra o aniversário que vem chegando (só na lista, sem o botão de aplicar).
 * Nada aqui grava: o servidor aplica, com trava, e a sincronização das previsões (PR1) leva o valor
 * novo só ao que ainda é previsão, da competência corrente em diante.
 */
import { chaveDiaCivil } from "@/lib/fuso";
import { formatarMoeda } from "@/lib/utils";

export type Competencia = { ano: number; mes: number };
export type HojeReajuste = Competencia & { dia: number };

export type ContratoReajuste = {
  numero?: string;
  status: string;
  dataInicio: Date | string;
  valorMensal: unknown;
  reajusteAtivo: boolean | null;
  reajusteIndice: string | null;
  reajustePercentual: unknown;
  reajusteMesAniversario: number | null;
  reajusteNotificar?: boolean | null;
  reajusteNotificarDias?: number | null;
  reajusteAdiadoAte?: Date | string | null;
};

export type SugestaoReajuste = {
  /** PENDENTE: o aniversário chegou e ninguém decidiu. ADIADO: alguém adiou até `adiadoAte`. EM_BREVE: vem chegando ("Avisar antes") */
  situacao: "PENDENTE" | "ADIADO" | "EM_BREVE";
  aniversario: Competencia;
  percentual: number;
  valorAtual: number;
  valorNovo: number;
  adiadoAte: string | null;
};

const indice = (c: Competencia) => c.ano * 12 + (c.mes - 1);
const deIndice = (i: number): Competencia => ({ ano: Math.floor(i / 12), mes: (i % 12) + 1 });

function inicioDe(c: Pick<ContratoReajuste, "dataInicio">): Competencia {
  const k = chaveDiaCivil(c.dataInicio);
  return { ano: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)) };
}

/** O mês de aniversário: o do contrato; sem ele, o mês do início */
export function mesAniversarioDe(c: Pick<ContratoReajuste, "reajusteMesAniversario" | "dataInicio">): number {
  const m = c.reajusteMesAniversario;
  return m && m >= 1 && m <= 12 ? m : inicioDe(c).mes;
}

/** O 1º aniversário com pelo menos 12 meses de contrato */
export function primeiroAniversario(c: Pick<ContratoReajuste, "reajusteMesAniversario" | "dataInicio">): Competencia {
  const ini = inicioDe(c);
  const mes = mesAniversarioDe(c);
  let ano = ini.ano;
  while (indice({ ano, mes }) - indice(ini) < 12) ano++;
  return { ano, mes };
}

/** O aniversário mais recente que já chegou (mês de hoje incluído), ou null se o 1º ainda não chegou */
export function aniversarioDevido(c: Pick<ContratoReajuste, "reajusteMesAniversario" | "dataInicio">, hoje: Competencia): Competencia | null {
  const primeiro = primeiroAniversario(c);
  if (indice(hoje) < indice(primeiro)) return null;
  const mes = primeiro.mes;
  return { ano: hoje.mes >= mes ? hoje.ano : hoje.ano - 1, mes };
}

/** O próximo aniversário depois do mês de hoje */
export function proximoAniversario(c: Pick<ContratoReajuste, "reajusteMesAniversario" | "dataInicio">, hoje: Competencia): Competencia {
  const primeiro = primeiroAniversario(c);
  if (indice(primeiro) > indice(hoje)) return primeiro;
  const mes = primeiro.mes;
  return { ano: hoje.mes < mes ? hoje.ano : hoje.ano + 1, mes };
}

/** O percentual que a sugestão usa: só o percentual fixo, maior que zero */
export function percentualDe(c: Pick<ContratoReajuste, "reajusteIndice" | "reajustePercentual">): number | null {
  if (c.reajusteIndice !== "PERCENTUAL_FIXO") return null;
  const p = Number(c.reajustePercentual);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** Valor reajustado, em centavos inteiros (sem erro de ponto flutuante) */
export const valorReajustado = (valor: number, percentual: number) => Math.round(valor * (100 + percentual)) / 100;

/** O contrato entra na conta do reajuste? (ativo, chave ligada, percentual fixo, com valor) */
export function reajusteSugerivel(c: ContratoReajuste): boolean {
  return c.status === "ATIVO" && !!c.reajusteAtivo && percentualDe(c) != null && Number(c.valorMensal) > 0;
}

const chaveHoje = (h: HojeReajuste) => `${h.ano}-${String(h.mes).padStart(2, "0")}-${String(h.dia).padStart(2, "0")}`;
const diasAte = (de: HojeReajuste, ate: Competencia) => Math.round((Date.UTC(ate.ano, ate.mes - 1, 1) - Date.UTC(de.ano, de.mes - 1, de.dia)) / 86_400_000);

/**
 * A sugestão de reajuste do contrato hoje (null = nada a mostrar).
 * `decididos`: os anos de aniversário que já têm decisão (aplicado ou dispensado).
 */
export function sugestaoReajuste(c: ContratoReajuste, decididos: Iterable<number>, hoje: HojeReajuste): SugestaoReajuste | null {
  if (!reajusteSugerivel(c)) return null;
  const percentual = percentualDe(c)!;
  const valorAtual = Number(c.valorMensal);
  const base = { percentual, valorAtual, valorNovo: valorReajustado(valorAtual, percentual) };
  const anos = new Set(decididos);
  const devido = aniversarioDevido(c, hoje);
  if (devido && !anos.has(devido.ano)) {
    const adiado = c.reajusteAdiadoAte ? chaveDiaCivil(c.reajusteAdiadoAte) : null;
    if (adiado && adiado > chaveHoje(hoje)) return { situacao: "ADIADO", aniversario: devido, adiadoAte: adiado, ...base };
    return { situacao: "PENDENTE", aniversario: devido, adiadoAte: null, ...base };
  }
  const dias = c.reajusteNotificarDias ?? 0;
  if (c.reajusteNotificar && dias > 0) {
    const proximo = proximoAniversario(c, hoje);
    if (!anos.has(proximo.ano) && diasAte(hoje, proximo) <= dias) return { situacao: "EM_BREVE", aniversario: proximo, adiadoAte: null, ...base };
  }
  return null;
}

/** "5%" / "4,5%" / "4,125%" */
export const textoPercentual = (p: number) => `${p.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "mar/2027" */
export const textoCompetencia = (c: Competencia) => `${MESES_CURTOS[c.mes - 1]}/${c.ano}`;

/** A pergunta da sugestão: "Contrato CT-1 faz aniversário em mar/2027 — aplicar reajuste de 5% (R$ 1.200,00 → R$ 1.260,00)?" */
export function textoSugestao(numero: string, s: Pick<SugestaoReajuste, "aniversario" | "percentual" | "valorAtual" | "valorNovo">): string {
  return `Contrato ${numero} faz aniversário em ${textoCompetencia(s.aniversario)} — aplicar reajuste de ${textoPercentual(s.percentual)} (${formatarMoeda(s.valorAtual)} → ${formatarMoeda(s.valorNovo)})?`;
}

/** O índice que a competência tem em meses (para comparar) */
export const compararCompetencias = (a: Competencia, b: Competencia) => indice(a) - indice(b);
export const competenciaMaisMeses = (c: Competencia, n: number) => deIndice(indice(c) + n);
