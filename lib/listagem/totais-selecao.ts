/**
 * Totais do que está SELECIONADO numa lista (painel do rodapé: "Total dos N selecionados"), com a
 * mesma quebra dos cards do período de cada tela — e as MESMAS regras (lib/listas/filtros:
 * condCardPeriodoReceber/Pagar/Orcamentos, CAMPO_CARD_*), só que calculadas na hora, sobre as
 * linhas que o usuário marcou. Puro: entra a lista das linhas marcadas, sai { chave: { v, q } }.
 */
import { statusVisualPagar, statusVisualReceber } from "@/lib/financeiro-status";
import { saldoDaConta } from "@/lib/financeiro/parcelas";
import { diaCivilPassou } from "@/lib/fuso";

export interface Soma { v: number; q: number }
export type Totais<K extends string> = Record<K, Soma>;

const cent = (n: number) => Math.round(n * 100) / 100;
function somar<K extends string>(chaves: readonly K[], itens: { chaves: K[]; valores: Partial<Record<K, number>> }[]): Totais<K> {
  const t = Object.fromEntries(chaves.map((k) => [k, { v: 0, q: 0 }])) as Totais<K>;
  for (const i of itens) for (const k of i.chaves) { t[k].q += 1; t[k].v = cent(t[k].v + (i.valores[k] ?? 0)); }
  return t;
}

/* ───────── Contas a receber: Vencidos · Vencem hoje · A vencer · Recebidos · Perdas · Total ───────── */
export const CHAVES_RECEBER = ["VENCIDO", "VENCE_HOJE", "A_VENCER", "RECEBIDO", "PERDA", "TOTAL"] as const;
export type ChaveReceber = (typeof CHAVES_RECEBER)[number];
export interface ContaReceberSoma {
  status: string; dataVencimento: string | null; valor: number; valorRecebido?: number | null; valorPerda?: number | null;
  /** A conta nova de uma renegociação (não soma de novo no total: vale a original) */
  renegociacao?: boolean;
}
/**
 * Como os cards: abertas pelo SALDO (vencida, vence hoje, a vencer — a previsão entra em "a vencer");
 * recebidas pelo valor; perdas pelo valor perdido; total = tudo menos canceladas, renegociações e o
 * lançamento parcelado (as parcelas é que são cobranças).
 */
export function totaisReceber(contas: ContaReceberSoma[], agora = new Date()): Totais<ChaveReceber> {
  return somar(CHAVES_RECEBER, contas.filter((c) => c.status !== "PARCELADO").map((c) => {
    const sv = statusVisualReceber(c.status, c.dataVencimento, agora);
    const chaves: ChaveReceber[] = [];
    const valores: Partial<Record<ChaveReceber, number>> = {};
    const saldo = saldoDaConta({ status: c.status, valor: c.valor, valorRecebido: c.valorRecebido ?? 0 });
    if (sv.chave === "VENCIDO") { chaves.push("VENCIDO"); valores.VENCIDO = saldo; }
    else if (sv.chave === "VENCE_HOJE") { chaves.push("VENCE_HOJE"); valores.VENCE_HOJE = saldo; }
    else if (sv.chave === "A_VENCER" || sv.chave === "PREVISTO") { chaves.push("A_VENCER"); valores.A_VENCER = saldo; }
    else if (sv.chave === "PAGO") { chaves.push("RECEBIDO"); valores.RECEBIDO = c.valor; }
    else if (sv.chave === "PERDA") { chaves.push("PERDA"); valores.PERDA = Number(c.valorPerda ?? 0); }
    if (c.status !== "CANCELADO" && !c.renegociacao) { chaves.push("TOTAL"); valores.TOTAL = c.valor; }
    return { chaves, valores };
  }));
}

/* ───────── Contas a pagar: Vencidos · Vencem hoje · A vencer · Pagos · Total ───────── */
export const CHAVES_PAGAR = ["VENCIDO", "VENCE_HOJE", "A_VENCER", "PAGO", "TOTAL"] as const;
export type ChavePagar = (typeof CHAVES_PAGAR)[number];
export interface ContaPagarSoma { status: string; dataVencimento: string | null; valorTotal: number; valorPago: number; saldoRestante: number }
/** Como os cards: abertas pelo saldo restante (a sem vencimento entra em "a vencer"); pagas pelo valor pago; total pelo valor da conta. */
export function totaisPagar(contas: ContaPagarSoma[], agora = new Date()): Totais<ChavePagar> {
  return somar(CHAVES_PAGAR, contas.map((c) => {
    const sv = statusVisualPagar(c.status, c.dataVencimento, agora);
    const chaves: ChavePagar[] = [];
    const valores: Partial<Record<ChavePagar, number>> = {};
    const aberta = ["PENDENTE", "PAGO_PARCIAL", "VENCIDO"].includes(c.status);
    if (aberta) {
      const k: ChavePagar = sv.chave === "VENCIDO" ? "VENCIDO" : sv.chave === "VENCE_HOJE" ? "VENCE_HOJE" : "A_VENCER";
      chaves.push(k); valores[k] = c.saldoRestante;
    } else if (c.status === "PAGO_TOTAL") { chaves.push("PAGO"); valores.PAGO = c.valorPago; }
    if (c.status !== "CANCELADO") { chaves.push("TOTAL"); valores.TOTAL = c.valorTotal; }
    return { chaves, valores };
  }));
}

/* ───────── Orçamentos: Em aberto · Aprovados · Recusados · Vencidos · Total ───────── */
export const CHAVES_ORCAMENTOS = ["EM_ABERTO", "APROVADO", "RECUSADO", "VENCIDO", "TOTAL"] as const;
export type ChaveOrcamentos = (typeof CHAVES_ORCAMENTOS)[number];
export interface OrcamentoSoma { status: string; validadeEm: string | null; totalGeral: number }
/** Como os cards de funil: enviado na validade = em aberto; enviado vencido = vencido; aprovado inclui convertido; total sem cancelados. */
// (a validade é dia civil de Brasília: lib/fuso.diaCivilPassou, a mesma regra do ciclo)
export function totaisOrcamentos(itens: OrcamentoSoma[], agora = new Date()): Totais<ChaveOrcamentos> {
  return somar(CHAVES_ORCAMENTOS, itens.map((o) => {
    const chaves: ChaveOrcamentos[] = [];
    const valores: Partial<Record<ChaveOrcamentos, number>> = {};
    const venceu = diaCivilPassou(o.validadeEm, agora); // dia civil de Brasília, como o ciclo e os cards
    if (o.status === "ENVIADO") chaves.push(venceu ? "VENCIDO" : "EM_ABERTO");
    else if (o.status === "APROVADO" || o.status === "CONVERTIDA") chaves.push("APROVADO");
    else if (o.status === "REPROVADO") chaves.push("RECUSADO");
    if (o.status !== "CANCELADO") chaves.push("TOTAL");
    for (const k of chaves) valores[k] = o.totalGeral;
    return { chaves, valores };
  }));
}

/* ───────── NFS-e: Em transmissão · Emitidas · Com falha · Canceladas · Total emitido ───────── */
export const CHAVES_NOTAS = ["transmissao", "emitidas", "falha", "canceladas", "total"] as const;
export type ChaveNotas = (typeof CHAVES_NOTAS)[number];
export interface NotaSoma { status: string; valorServicos: number }
/** Como os cards da central (lib/nfse/central: GRUPOS_SITUACAO); "total" = o emitido (autorizadas). */
export function totaisNotas(notas: NotaSoma[]): Totais<ChaveNotas> {
  return somar(CHAVES_NOTAS, notas.map((n) => {
    const grupo: ChaveNotas | null =
      n.status === "ENVIANDO" || n.status === "PROCESSANDO" ? "transmissao"
      : n.status === "CONCLUIDO" ? "emitidas"
      : n.status === "REJEITADO" || n.status === "INTERROMPIDO" ? "falha"
      : n.status === "CANCELADO" ? "canceladas" : null;
    const chaves: ChaveNotas[] = grupo ? [grupo] : [];
    if (n.status === "CONCLUIDO") chaves.push("total");
    const valores: Partial<Record<ChaveNotas, number>> = {};
    for (const k of chaves) valores[k] = n.valorServicos;
    return { chaves, valores };
  }));
}

