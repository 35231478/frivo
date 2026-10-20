/**
 * Estoque — regras PURAS (sem banco): como cada operação vira um lançamento no razão, a situação do
 * saldo (negativo / abaixo do mínimo) e a validação do lançamento manual.
 *
 * O razão (movimentacoes_estoque) guarda `quantidade` COM SINAL: + entra, − sai. O saldo do produto
 * é a soma do razão (o campo `saldo` do produto é só um cache, atualizado na mesma transação).
 */
import { z } from "zod";

export type TipoMov = "ENTRADA" | "SAIDA" | "AJUSTE" | "DEVOLUCAO";
export type OrigemMov = "COMPRA" | "OS" | "AJUSTE" | "INVENTARIO";
/** O que se quer fazer. AJUSTE e INVENTARIO informam o saldo FINAL; os outros, a quantidade. */
export type Operacao = "ENTRADA" | "SAIDA" | "DEVOLUCAO" | "AJUSTE" | "INVENTARIO";

export const CASAS = 3;
export const arred = (n: number) => Math.round(n * 10 ** CASAS) / 10 ** CASAS;

export const LABEL_TIPO: Record<TipoMov, string> = { ENTRADA: "Entrada", SAIDA: "Saída", AJUSTE: "Ajuste", DEVOLUCAO: "Devolução" };
export const LABEL_ORIGEM: Record<OrigemMov, string> = { COMPRA: "Compra", OS: "Ordem de serviço", AJUSTE: "Ajuste manual", INVENTARIO: "Inventário" };

/**
 * Lançamento que a operação gera, dado o saldo atual:
 *  - ENTRADA / DEVOLUCAO somam a quantidade; SAIDA subtrai;
 *  - AJUSTE / INVENTARIO levam o saldo ao valor informado: o lançamento é a DIFERENÇA (pode ser 0
 *    no inventário — a contagem que confirma o saldo também fica registrada).
 */
export function calcularMovimento(op: Operacao, saldoAtual: number, valor: number): { tipo: TipoMov; origem: OrigemMov; delta: number } {
  const v = arred(valor);
  switch (op) {
    case "ENTRADA": return { tipo: "ENTRADA", origem: "COMPRA", delta: v };
    case "DEVOLUCAO": return { tipo: "DEVOLUCAO", origem: "OS", delta: v };
    case "SAIDA": return { tipo: "SAIDA", origem: "OS", delta: -v };
    case "AJUSTE": return { tipo: "AJUSTE", origem: "AJUSTE", delta: arred(v - saldoAtual) };
    case "INVENTARIO": return { tipo: "AJUSTE", origem: "INVENTARIO", delta: arred(v - saldoAtual) };
  }
}

export type Situacao = "negativo" | "abaixo" | "ok";
/** Saldo negativo é permitido (não bloqueia) mas é destacado; "abaixo" = saldo ≤ estoque mínimo. */
export function situacaoEstoque(saldo: number, minimo: number | null | undefined): Situacao {
  if (saldo < 0) return "negativo";
  if (minimo != null && saldo <= minimo) return "abaixo";
  return "ok";
}

/** 1234.5 → "1.234,5" (até 3 casas, sem zeros sobrando) */
export const formatarQtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: CASAS });
/** Quantidade do razão com sinal: "+10", "−3,5" */
export const formatarDelta = (n: number) => (n > 0 ? `+${formatarQtd(n)}` : n < 0 ? `−${formatarQtd(-n)}` : "0");

export function avisoSaldo(saldo: number, unidade = "") {
  return saldo < 0 ? `Atenção: o saldo ficou negativo (${formatarQtd(saldo)}${unidade ? ` ${unidade}` : ""}). O lançamento foi feito; confira as entradas.` : null;
}

/* ───────── Lançamento manual (tela) ───────── */
const numero = (msg: string) => z.preprocess((v) => {
  if (typeof v === "string") { const t = v.trim().replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", "."); return t === "" ? undefined : Number(t); }
  return v;
}, z.number({ required_error: msg, invalid_type_error: msg }).finite(msg));
const casas = (n: number) => Math.abs(n * 10 ** CASAS - Math.round(n * 10 ** CASAS)) < 1e-6;
const MAX = 1_000_000_000;
const obs = z.string().trim().max(500, "Observação: no máximo 500 caracteres.");

export const lancamentoManualSchema = z.discriminatedUnion("operacao", [
  z.object({
    operacao: z.literal("ENTRADA"),
    quantidade: numero("Informe a quantidade.").refine((n) => n > 0, "A quantidade precisa ser maior que zero.").refine((n) => n < MAX, "Quantidade grande demais.").refine(casas, "Use no máximo 3 casas decimais."),
    custoUnitario: numero("Custo inválido.").refine((n) => n >= 0, "O custo não pode ser negativo.").optional(),
    observacao: obs.optional(),
  }).strict(),
  z.object({
    operacao: z.literal("AJUSTE"),
    novoSaldo: numero("Informe o saldo correto.").refine((n) => n >= 0, "O saldo correto não pode ser negativo.").refine((n) => n < MAX, "Valor grande demais.").refine(casas, "Use no máximo 3 casas decimais."),
    observacao: z.string({ required_error: "Ajuste exige o motivo (observação)." }).trim().max(500, "Observação: no máximo 500 caracteres.").min(3, "Ajuste exige o motivo (observação)."),
  }).strict(),
  z.object({
    operacao: z.literal("INVENTARIO"),
    contagem: numero("Informe a quantidade contada.").refine((n) => n >= 0, "A contagem não pode ser negativa.").refine((n) => n < MAX, "Valor grande demais.").refine(casas, "Use no máximo 3 casas decimais."),
    observacao: obs.optional(),
  }).strict(),
]);
export type LancamentoManual = z.infer<typeof lancamentoManualSchema>;

/** Valor que vai para calcularMovimento (quantidade, ou o saldo final) */
export const valorDoLancamento = (l: LancamentoManual) => (l.operacao === "ENTRADA" ? l.quantidade : l.operacao === "AJUSTE" ? l.novoSaldo : l.contagem);

export function mensagemLancamento(e: z.ZodError) {
  const i = e.issues[0];
  if (!i) return "Dados inválidos.";
  if (i.code === "unrecognized_keys") return `Campo não permitido: ${i.keys.join(", ")}.`;
  if (i.code === "invalid_union_discriminator") return "Escolha entrada, ajuste ou inventário.";
  if (i.path.length === 0) return "Dados inválidos.";
  return i.message;
}
