/**
 * Contas a Receber — renegociar (regras puras, sem Prisma). A tela usa estas regras para habilitar a
 * escolha e o botão; o servidor usa as MESMAS para recusar.
 *
 * Uma ou mais cobranças em aberto do MESMO cliente viram uma conta nova (à vista ou parcelada): entra só
 * o SALDO de cada (o que já foi recebido fica onde está) + juros + multa − desconto. As originais ficam
 * RENEGOCIADO, apontando para a nova. Juros e multa são receita financeira; o desconto é desconto
 * concedido — ficam em colunas próprias da conta nova e não inflam o faturamento (que continua sendo o
 * das cobranças originais). Desfazer: só enquanto nenhum dinheiro se mexeu nas cobranças novas.
 */
import { MIN_PARCELAS, motivoPlanoInvalido, saldoDaConta, type ParcelaPlano } from "@/lib/financeiro/parcelas";

const cent = (v: number) => Math.round(v * 100);
const reais = (c: number) => Math.round(c) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Motivo mínimo para desfazer (uma palavra de verdade, não ".") */
export const MOTIVO_MINIMO_DESFAZER = 3;

export interface ContaRenegociavel {
  status: string;
  valor: unknown;
  valorRecebido?: unknown;
  boletoStatus?: string | null;
  excluidaEm?: Date | string | null;
}

/** Pode entrar numa renegociação: cobrança em aberto (a receber ou vencida), com saldo e sem boleto emitido */
export function motivoNaoRenegociar(c: ContaRenegociavel): string | null {
  if (c.excluidaEm) return "Esta conta foi excluída.";
  if (c.status === "RENEGOCIADO") return "Esta conta já foi renegociada.";
  if (c.status === "PERDA") return "Conta em perda: reverta a perda antes.";
  if (c.status === "PARCELADO") return "Conta parcelada: renegocie as parcelas.";
  if (c.status === "PREVISTO") return "Ainda é previsão: não é cobrança.";
  if (c.status === "RECEBIDO") return "Conta recebida não se renegocia.";
  if (c.status === "CANCELADO") return "Conta cancelada não se renegocia.";
  if (c.boletoStatus === "EMITIDO") return "Cancele o boleto antes: o cliente ainda consegue pagá-lo.";
  if (!(saldoDaConta(c) > 0)) return "Não há nada em aberto nesta conta.";
  return null;
}

/** A escolha como um todo: pelo menos uma, todas do mesmo cliente, cada uma renegociável */
export function motivoSelecaoInvalida(contas: (ContaRenegociavel & { numero: string; clienteId: string })[]): string | null {
  if (!contas.length) return "Escolha pelo menos uma cobrança.";
  if (new Set(contas.map((c) => c.clienteId)).size > 1) return "Escolha cobranças do mesmo cliente.";
  for (const c of contas) {
    const m = motivoNaoRenegociar(c);
    if (m) return `${c.numero}: ${m}`;
  }
  return null;
}

export interface Encargos { juros?: number | null; multa?: number | null; desconto?: number | null }

/** Saldo renegociado (soma dos saldos) e o total novo = saldo + juros + multa − desconto */
export function totalRenegociacao(saldos: number[], e: Encargos) {
  const saldo = reais(saldos.reduce((s, v) => s + cent(v), 0));
  const total = reais(cent(saldo) + cent(e.juros ?? 0) + cent(e.multa ?? 0) - cent(e.desconto ?? 0));
  return { saldo, total };
}

/** Juros, multa e desconto: nunca negativos; o desconto não pode zerar (nem passar) o total */
export function motivoEncargosInvalidos(saldo: number, e: Encargos): string | null {
  const vals = [e.juros ?? 0, e.multa ?? 0, e.desconto ?? 0];
  if (vals.some((v) => !Number.isFinite(v))) return "Juros, multa e desconto: informe valores em R$.";
  if (vals.some((v) => v < 0)) return "Juros, multa e desconto não podem ser negativos.";
  if (cent(e.desconto ?? 0) >= cent(saldo) + cent(e.juros ?? 0) + cent(e.multa ?? 0)) return "O desconto não pode zerar a renegociação.";
  return null;
}

/** O plano da conta nova: um vencimento só (à vista, valor = total) ou parcelas (regra do parcelamento) */
export function motivoPlanoRenegociacao(total: number, plano: ParcelaPlano[]): string | null {
  if (!plano.length) return "Informe o vencimento.";
  if (plano.length === 1) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plano[0].vencimento ?? "")) return "Informe o vencimento.";
    if (cent(plano[0].valor) !== cent(total)) return `O valor tem que ser o total da renegociação (${brl(total)}).`;
    return null;
  }
  if (plano.length < MIN_PARCELAS) return "Informe o vencimento.";
  return motivoPlanoInvalido(total, plano);
}

/** "Renegociação de CR-1 e CR-2" / "de CR-1, CR-2 e CR-3" / "de CR-1, CR-2, CR-3 e mais 4" */
export function descricaoRenegociacao(numeros: string[]): string {
  const ns = [...numeros];
  let lista: string;
  if (ns.length <= 1) lista = ns[0] ?? "";
  else if (ns.length <= 4) lista = `${ns.slice(0, -1).join(", ")} e ${ns[ns.length - 1]}`;
  else lista = `${ns.slice(0, 3).join(", ")} e mais ${ns.length - 3}`;
  return `Renegociação de ${lista}`.slice(0, 500);
}

/**
 * D3 (DRE futura): quanto de um valor recebido na renegociação é principal (o saldo renegociado), quanto
 * é receita financeira (juros + multa) e quanto de desconto concedido foi "usado". Proporcional ao total:
 * principal + encargos − desconto = recebido.
 */
export function composicaoDoRecebido(r: { saldo: number; juros: number; multa: number; desconto: number }, recebido: number) {
  const total = r.saldo + r.juros + r.multa - r.desconto;
  if (!(total > 0) || !(recebido > 0)) return { principal: 0, encargos: 0, desconto: 0 };
  const f = Math.min(1, recebido / total);
  const encargos = reais(cent((r.juros + r.multa) * f));
  const desconto = reais(cent(r.desconto * f));
  const principal = reais(cent(recebido) - cent(encargos) + cent(desconto));
  return { principal, encargos, desconto };
}

export interface CobrancaDaRenegociacao { numero: string; status: string; valorRecebido?: unknown; boletoStatus?: string | null }

/** Desfazer: só enquanto nenhuma cobrança nova teve dinheiro, boleto, perda ou outra renegociação */
export function motivoNaoDesfazer(r: { status: string }, cobrancas: CobrancaDaRenegociacao[]): string | null {
  if (r.status === "CANCELADO") return "Esta renegociação já foi desfeita.";
  for (const c of cobrancas) {
    if (c.status === "RECEBIDO" || Number(c.valorRecebido ?? 0) > 0) return `Já entrou dinheiro em ${c.numero}: não dá para desfazer.`;
    if (c.boletoStatus === "EMITIDO") return `Boleto emitido em ${c.numero}: cancele o boleto antes.`;
    if (c.status === "PERDA") return `${c.numero} está em perda: reverta a perda antes.`;
    if (c.status === "RENEGOCIADO") return `${c.numero} foi renegociada de novo: desfaça aquela renegociação antes.`;
  }
  return null;
}

export const motivoTextoDesfazer = (motivo: string | null | undefined) =>
  (motivo ?? "").trim().length < MOTIVO_MINIMO_DESFAZER ? "Informe o motivo." : null;
