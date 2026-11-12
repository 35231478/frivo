/**
 * Estoque — regras PURAS (sem banco): como cada operação vira um lançamento no razão, a situação do
 * saldo (negativo / abaixo do mínimo) e a validação do lançamento manual.
 *
 * O razão (movimentacoes_estoque) guarda `quantidade` COM SINAL: + entra, − sai. O saldo do produto
 * é a soma do razão (o campo `saldo` do produto é só um cache, atualizado na mesma transação).
 */
import { z } from "zod";

export type TipoMov = "ENTRADA" | "SAIDA" | "AJUSTE" | "DEVOLUCAO" | "RESERVA";
export type OrigemMov = "COMPRA" | "OS" | "AJUSTE" | "INVENTARIO";
/**
 * O que se quer fazer. AJUSTE e INVENTARIO informam o saldo FINAL; os outros, a quantidade. RESERVA (E4.1, separação
 * para a OS) subtrai como a saída; ESTORNO_RESERVA (separação desfeita) devolve ao disponível — também fica no razão
 * como RESERVA, com sinal +: a soma das RESERVAs de uma OS é o que está separado para ela. ESTORNO_SAIDA (E4.2, consumo
 * desfeito) idem para a SAIDA: fica no razão como SAIDA com sinal +. DEVOLUCAO (E4.3, a sobra separada que volta ao
 * estoque) soma; ESTORNO_DEVOLUCAO (devolução desfeita) é DEVOLUCAO com sinal −.
 */
export type Operacao = "ENTRADA" | "SAIDA" | "ESTORNO_SAIDA" | "DEVOLUCAO" | "ESTORNO_DEVOLUCAO" | "RESERVA" | "ESTORNO_RESERVA" | "AJUSTE" | "INVENTARIO";

export const CASAS = 3;
export const arred = (n: number) => Math.round(n * 10 ** CASAS) / 10 ** CASAS;

export const LABEL_TIPO: Record<TipoMov, string> = { ENTRADA: "Entrada", SAIDA: "Saída", AJUSTE: "Ajuste", DEVOLUCAO: "Devolução", RESERVA: "Reserva" };
export const LABEL_ORIGEM: Record<OrigemMov, string> = { COMPRA: "Compra", OS: "Ordem de serviço", AJUSTE: "Ajuste manual", INVENTARIO: "Inventário" };

/**
 * Lançamento que a operação gera, dado o saldo atual:
 *  - ENTRADA / DEVOLUCAO somam a quantidade; SAIDA / RESERVA subtraem;
 *  - AJUSTE / INVENTARIO levam o saldo ao valor informado: o lançamento é a DIFERENÇA (pode ser 0
 *    no inventário — a contagem que confirma o saldo também fica registrada).
 */
export function calcularMovimento(op: Operacao, saldoAtual: number, valor: number): { tipo: TipoMov; origem: OrigemMov; delta: number } {
  const v = arred(valor);
  switch (op) {
    case "ENTRADA": return { tipo: "ENTRADA", origem: "COMPRA", delta: v };
    case "DEVOLUCAO": return { tipo: "DEVOLUCAO", origem: "OS", delta: v };
    case "ESTORNO_DEVOLUCAO": return { tipo: "DEVOLUCAO", origem: "OS", delta: -v };
    case "SAIDA": return { tipo: "SAIDA", origem: "OS", delta: -v };
    case "ESTORNO_SAIDA": return { tipo: "SAIDA", origem: "OS", delta: v };
    case "RESERVA": return { tipo: "RESERVA", origem: "OS", delta: -v };
    case "ESTORNO_RESERVA": return { tipo: "RESERVA", origem: "OS", delta: v };
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

/** Origem da operação quando é lançamento MANUAL (tela): a saída avulsa (perda/uso) não é de OS, é ajuste manual */
export const origemManual = (op: Operacao): OrigemMov | undefined => (op === "SAIDA" ? "AJUSTE" : undefined);

/* ───────── Lançamento manual (tela) ───────── */
/** Número vindo da tela: aceita "2,5" e "1.234,5"; string vazia = ausente */
export const numeroBr = (msg: string) => z.preprocess((v) => {
  if (typeof v === "string") { const t = v.trim().replace(/\./g, (m, i, s) => (s.includes(",") ? "" : m)).replace(",", "."); return t === "" ? undefined : Number(t); }
  return v;
}, z.number({ required_error: msg, invalid_type_error: msg }).finite(msg));
const numero = numeroBr;
export const temAteTresCasas = (n: number) => Math.abs(n * 10 ** CASAS - Math.round(n * 10 ** CASAS)) < 1e-6;
const casas = temAteTresCasas;
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
    operacao: z.literal("SAIDA"),
    quantidade: numero("Informe a quantidade.").refine((n) => n > 0, "A quantidade precisa ser maior que zero.").refine((n) => n < MAX, "Quantidade grande demais.").refine(casas, "Use no máximo 3 casas decimais."),
    observacao: z.string({ required_error: "Saída exige o motivo (observação)." }).trim().max(500, "Observação: no máximo 500 caracteres.").min(3, "Saída exige o motivo (observação)."),
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
export const valorDoLancamento = (l: LancamentoManual) =>
  l.operacao === "ENTRADA" || l.operacao === "SAIDA" ? l.quantidade : l.operacao === "AJUSTE" ? l.novoSaldo : l.contagem;

export function mensagemLancamento(e: z.ZodError) {
  const i = e.issues[0];
  if (!i) return "Dados inválidos.";
  if (i.code === "unrecognized_keys") return `Campo não permitido: ${i.keys.join(", ")}.`;
  if (i.code === "invalid_union_discriminator") return "Escolha entrada, saída, ajuste ou inventário.";
  if (i.path.length === 0) return "Dados inválidos.";
  return i.message;
}
