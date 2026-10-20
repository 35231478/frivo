import { z } from "zod";

/** Escolha da conciliação: produto existente OU produto novo (nome; unidade = a da nota se vazia) */
export const escolhaSchema = z.union([
  z.object({ itemId: z.string().min(1), produtoId: z.string().min(1) }).strict(),
  z.object({ itemId: z.string().min(1), novo: z.object({ nome: z.string().trim().min(2, "Dê um nome ao produto novo.").max(200), unidade: z.string().trim().max(10).nullish() }).strict() }).strict(),
]);
export const conciliacaoSchema = z.object({ itens: z.array(escolhaSchema).max(990) }).strict();
export const lancarSchema = z.object({
  itens: z.array(escolhaSchema).max(990).optional(),
  pedidoCompraId: z.string().min(1).nullish(),
}).strict();
