import { z } from "zod";
import { arred } from "@/lib/estoque/regras";

/**
 * Conversão de unidade da nota de compra e preço de venda por margem. Puro (tela e servidor).
 *
 * Conversão: "1 [unidade da nota] = fator [unidade do produto]".
 *   quantidade que entra = quantidade da nota × fator; custo por unidade do produto = valor unitário ÷ fator.
 *   Ex.: 1 UN (cilindro) a R$ 1.360,00, fator 13,6 → entram 13,6 kg a R$ 100,00/kg.
 *
 * Preço: margem SOBRE A VENDA.  preço = custo ÷ (1 − margem%)   ·   margem% = (preço − custo) ÷ preço
 *   e o markup SOBRE O CUSTO:  markup% = (preço − custo) ÷ custo.
 *   Ex.: custo R$ 100 e margem 30% → preço R$ 142,86 (markup 42,9%).
 */
export const FATOR_MAX = 1_000_000;
export const MARGEM_MAX = 99.99;

const casas = (n: number, c: number) => Math.round(n * 10 ** c) / 10 ** c;
export const arred2 = (n: number) => casas(n, 2);
export const arred4 = (n: number) => casas(n, 4);

export const mesmaUnidade = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export const fatorValido = (f: unknown): f is number => typeof f === "number" && Number.isFinite(f) && f > 0 && f <= FATOR_MAX;

/** Item da nota na unidade do produto. */
export function converterItem(quantidadeNota: number, valorUnitarioNota: number, fator: number) {
  return { quantidade: arred(quantidadeNota * fator), custoUnitario: arred4(valorUnitarioNota / fator) };
}

/** Preço para ter a margem (sobre a venda) pedida. Sem custo, ou margem fora de 0–99,99%: null. */
export function precoPorMargem(custo: number | null | undefined, margem: number | null | undefined): number | null {
  if (custo == null || !(custo > 0) || margem == null || !Number.isFinite(margem) || margem < 0 || margem > MARGEM_MAX) return null;
  return arred2(custo / (1 - margem / 100));
}

/** Margem % sobre a venda que este preço dá. */
export function margemSobreVenda(preco: number | null | undefined, custo: number | null | undefined): number | null {
  if (preco == null || !(preco > 0) || custo == null || !Number.isFinite(custo)) return null;
  return ((preco - custo) / preco) * 100;
}

/** Markup % sobre o custo que este preço dá. */
export function markupSobreCusto(preco: number | null | undefined, custo: number | null | undefined): number | null {
  if (preco == null || !Number.isFinite(preco) || custo == null || !(custo > 0)) return null;
  return ((preco - custo) / custo) * 100;
}

export const formatarPct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const formatarFator = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });

export interface AvisoCusto {
  produtoId: string; produto: string; unidade: string;
  custoAnterior: number; custoNovo: number; variacao: number;
  preco: number | null; margemAgora: number | null; margemAntes: number | null;
  /** margem alvo do produto (definida por margem) e o preço que a manteria — só sugestão */
  margemAlvo: number | null; precoParaManter: number | null;
  texto: string;
}

const moeda = (n: number, max = 2) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: max });

/**
 * O custo mudou? Só AVISA: diz que margem o preço atual dá agora (e, se o produto tem margem alvo,
 * que preço a manteria). Nunca muda o preço. Custo igual (ou sem custo anterior): null.
 */
export function avisoCusto(p: {
  produtoId: string; produto: string; unidade: string;
  custoAnterior: number | null | undefined; custoNovo: number;
  preco: number | null | undefined; margemAlvo: number | null | undefined;
}): AvisoCusto | null {
  if (p.custoAnterior == null || !(p.custoAnterior > 0) || Math.abs(p.custoNovo - p.custoAnterior) < 0.00005) return null;
  const preco = p.preco != null && p.preco > 0 ? p.preco : null;
  const variacao = ((p.custoNovo - p.custoAnterior) / p.custoAnterior) * 100;
  const margemAgora = margemSobreVenda(preco, p.custoNovo);
  const margemAntes = margemSobreVenda(preco, p.custoAnterior);
  const margemAlvo = p.margemAlvo ?? null;
  const precoParaManter = margemAlvo != null ? precoPorMargem(p.custoNovo, margemAlvo) : null;
  const sinal = variacao > 0 ? "+" : "−";
  let texto = `O custo mudou: era ${moeda(p.custoAnterior, 4)}/${p.unidade}, nesta nota ${moeda(p.custoNovo, 4)}/${p.unidade} (${sinal}${formatarPct(Math.abs(variacao))}). `;
  texto += preco
    ? `Seu preço atual (${moeda(preco)}) dá ${formatarPct(margemAgora)} de margem agora (antes ${formatarPct(margemAntes)}).`
    : "O produto ainda não tem preço de venda.";
  if (preco && precoParaManter != null && Math.abs(precoParaManter - preco) >= 0.01)
    texto += ` Para manter ${formatarPct(margemAlvo)}, o preço seria ${moeda(precoParaManter)}.`;
  texto += " O preço não foi alterado.";
  return { produtoId: p.produtoId, produto: p.produto, unidade: p.unidade, custoAnterior: p.custoAnterior, custoNovo: p.custoNovo, variacao, preco, margemAgora, margemAntes, margemAlvo, precoParaManter, texto };
}

/** PUT do preço: por margem (sobre o custo informado) OU preço fixo. */
export const precoVendaSchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("margem"),
    margem: z.number({ invalid_type_error: "Informe a margem." }).min(0, "A margem não pode ser negativa.").max(MARGEM_MAX, "A margem sobre a venda precisa ser menor que 100%."),
    custoBase: z.number({ invalid_type_error: "Sem custo não dá para calcular pela margem." }).positive("Sem custo não dá para calcular pela margem: defina um preço fixo."),
  }).strict(),
  z.object({
    modo: z.literal("preco"),
    preco: z.number({ invalid_type_error: "Informe o preço." }).positive("O preço precisa ser maior que zero.").max(99_999_999.99),
  }).strict(),
]);
export type PrecoVendaInput = z.infer<typeof precoVendaSchema>;

/** Número digitado ("1.360,00", "13,6" ou "13.6") → number; vazio ou inválido = null */
export function lerNumero(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}
