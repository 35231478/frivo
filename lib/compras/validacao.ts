import { z } from "zod";
import { FATOR_MAX, MARGEM_MAX } from "@/lib/estoque/preco";
import { lerBoleto } from "@/lib/financeiro/boleto";
import { MAX_PARCELAS } from "@/lib/compras/parcelas";

/** 1 [unidade da nota] = fator [unidade do produto]; sem fator = 1 */
const fator = z.number({ invalid_type_error: "Informe o fator de conversão." })
  .positive("O fator de conversão precisa ser maior que zero.").max(FATOR_MAX, "Fator de conversão grande demais.")
  .transform((f) => Math.round(f * 1e6) / 1e6).optional();

/**
 * Preço de venda definido na linha (rascunho, aplicado ao produto só ao lançar): por margem sobre a
 * venda (o preço sai do custo desta nota) ou preço fixo. null = não mexer no preço do produto.
 */
export const precoLinhaSchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("margem"),
    margem: z.number({ invalid_type_error: "Informe a margem." }).min(0, "A margem não pode ser negativa.").max(MARGEM_MAX, "A margem sobre a venda precisa ser menor que 100%."),
  }).strict(),
  z.object({
    modo: z.literal("preco"),
    preco: z.number({ invalid_type_error: "Informe o preço." }).positive("O preço precisa ser maior que zero.").max(99_999_999.99),
  }).strict(),
]);
export type PrecoLinha = z.infer<typeof precoLinhaSchema>;
const preco = precoLinhaSchema.nullable().optional();

const nomeNovo = z.string().trim().min(2, "Dê um nome ao produto novo.").max(200);
/** Escolha da conciliação: produto existente OU produto novo (nome; unidade = a da nota se vazia) */
export const escolhaSchema = z.union([
  z.object({ itemId: z.string().min(1), produtoId: z.string().min(1), fator, preco }).strict(),
  z.object({ itemId: z.string().min(1), novo: z.object({ nome: nomeNovo, unidade: z.string().trim().max(10).nullish() }).strict(), fator, preco }).strict(),
]);

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimento inválido (use AAAA-MM-DD).")
  .refine((d) => { const t = new Date(`${d}T12:00:00.000Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; }, "Vencimento inválido.");

/** Parcela: vencimento, valor e (opcional) o boleto colado — DVs conferidos; guarda só os dígitos da linha. */
export const parcelaSchema = z.object({
  duplicata: z.string().trim().max(60).nullable().default(null),
  vencimento: dia,
  valor: z.number({ invalid_type_error: "Informe o valor da parcela." }).positive("Toda parcela precisa de valor maior que zero.").max(99_999_999.99)
    .transform((v) => Math.round(v * 100) / 100),
  boleto: z.string().max(80).nullish().transform((v, ctx) => {
    if (v == null || !v.replace(/\D/g, "")) return null;
    const r = lerBoleto(v);
    if (!r.ok) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.erro }); return z.NEVER; }
    return r.boleto.linhaDigitavel;
  }),
}).strict();

const FORMAS = ["BOLETO", "PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "CHEQUE"] as const;
const idOpcional = z.preprocess((v) => (v === "" ? null : v), z.string().min(1).max(40).nullable()).optional();

/**
 * Rascunho financeiro da nota. Campo ausente = não mexe; null = limpa (parcelas null = voltar às
 * duplicatas da NF).
 */
export const financeiroSchema = z.object({
  categoriaId: idOpcional,
  centroCustoId: idOpcional,
  formaPagamento: z.preprocess((v) => (v === "" ? null : v), z.enum(FORMAS).nullable()).optional(),
  parcelas: z.array(parcelaSchema).min(1, "A nota precisa de ao menos uma parcela.").max(MAX_PARCELAS, `No máximo ${MAX_PARCELAS} parcelas.`).nullable().optional(),
}).strict();
export type FinanceiroRascunho = z.infer<typeof financeiroSchema>;

export const conciliacaoSchema = z.object({
  itens: z.array(escolhaSchema).max(990),
  financeiro: financeiroSchema.optional(),
}).strict();
export const lancarSchema = z.object({
  itens: z.array(escolhaSchema).max(990).optional(),
  pedidoCompraId: z.string().min(1).nullish(),
  financeiro: financeiroSchema.optional(),
}).strict();

/** Mensagem do 1º erro, com o número da parcela quando é nela ("Parcela 2: …"). */
export function mensagemZod(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "Dados inválidos.";
  const k = i.path.indexOf("parcelas");
  if (k >= 0 && typeof i.path[k + 1] === "number") return `Parcela ${(i.path[k + 1] as number) + 1}: ${i.message}`;
  return i.message;
}
