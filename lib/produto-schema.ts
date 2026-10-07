import { z } from "zod";

/**
 * Produto (catálogo). Campo numérico vazio ("" ou só espaços) = "não informado" (null), nunca erro.
 * Aceita número ou texto numérico ("12.5" / "12,5").
 */
const numeroOpcional = (inteiro: boolean) => z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : v;
  }
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}, (inteiro ? z.number().int("Estoque mínimo deve ser um número inteiro.") : z.number()).min(0, "Não pode ser negativo.").nullable().optional());

const textoOpcional = z.preprocess((v) => (typeof v === "string" && !v.trim() ? null : v), z.string().nullable().optional());

const campos = {
  nome: z.string().trim().min(1, "Nome é obrigatório."),
  descricao: textoOpcional,
  // Unidade vazia ("Selecione") = não informada: na criação vira "un"; na edição não muda
  unidade: z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), z.string().trim().min(1).optional()),
  valorPadrao: numeroOpcional(false),
  estoqueMinimo: numeroOpcional(true),
  ativo: z.boolean(),
};

/** Criação: só os campos do produto (empresa vem da sessão). */
export const produtoCriarSchema = z.object({
  ...campos,
  unidade: campos.unidade.transform((u) => u ?? "un"),
  ativo: campos.ativo.default(true),
});

/**
 * Edição PARCIAL: só altera o que veio no corpo (Reativar manda só `{ ativo: true }` e não
 * pode zerar nada). Campos fora da lista (id, empresaId, criadoEm…) são ignorados.
 */
export const produtoEditarSchema = z.object(campos).partial();

export function primeiroErro(e: z.ZodError) {
  return e.issues[0]?.message ?? "Dados inválidos";
}
