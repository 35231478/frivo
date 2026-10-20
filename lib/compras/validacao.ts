import { z } from "zod";
import { FATOR_MAX } from "@/lib/estoque/preco";

/** 1 [unidade da nota] = fator [unidade do produto]; sem fator = 1 */
const fator = z.number({ invalid_type_error: "Informe o fator de conversão." })
  .positive("O fator de conversão precisa ser maior que zero.").max(FATOR_MAX, "Fator de conversão grande demais.")
  .transform((f) => Math.round(f * 1e6) / 1e6).optional();

/** Escolha da conciliação: produto existente OU produto novo (nome; unidade = a da nota se vazia) */
export const escolhaSchema = z.union([
  z.object({ itemId: z.string().min(1), produtoId: z.string().min(1), fator }).strict(),
  z.object({ itemId: z.string().min(1), novo: z.object({ nome: z.string().trim().min(2, "Dê um nome ao produto novo.").max(200), unidade: z.string().trim().max(10).nullish() }).strict(), fator }).strict(),
]);
export const conciliacaoSchema = z.object({ itens: z.array(escolhaSchema).max(990) }).strict();
export const lancarSchema = z.object({
  itens: z.array(escolhaSchema).max(990).optional(),
  pedidoCompraId: z.string().min(1).nullish(),
}).strict();
