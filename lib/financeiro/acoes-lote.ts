/**
 * Ações em lote nas listas financeiras (Contas a Receber e a Pagar) — regras PURAS, as mesmas da
 * ação individual de cada conta: o lote nunca faz o que a tela de uma conta só recusaria.
 *  - "baixar": dar como recebido/pago pelo SALDO de cada conta (parcial quita o que falta);
 *  - "vencimento": uma data única para todas ou empurrar X dias a partir do vencimento de cada uma;
 *  - "cancelar": cancelamento (reversível, o registro fica), nunca exclusão.
 * Cada ação só pega as ELEGÍVEIS; as outras entram no resumo com o motivo. A tela usa estas regras
 * para o resumo antes de confirmar e o servidor usa as MESMAS para decidir item a item.
 */
import { motivoNaoCancelar, motivoNaoReceber, travasDaConta, type ContaGestao } from "@/lib/financeiro/conta-receber-gestao";
import { saldoDaConta } from "@/lib/financeiro/parcelas";

export const ACOES_LOTE = ["baixar", "vencimento", "cancelar"] as const;
export type AcaoLote = (typeof ACOES_LOTE)[number];
export type TipoLista = "receber" | "pagar";

/** Como mudar o vencimento: uma data única (dia civil "AAAA-MM-DD") ou empurrar N dias (pode ser negativo) */
export type ParamsVencimento = { modo: "data"; data: string } | { modo: "dias"; dias: number };

/** Por requisição (a seleção é da página: cabe folgado) */
export const MAX_LOTE = 200;
/** Empurrar no máximo ±2 anos (digitou errado) */
export const MAX_DIAS = 730;

export const ROTULOS: Record<TipoLista, Record<AcaoLote, { rotulo: string; feito: [singular: string, plural: string] }>> = {
  receber: {
    baixar: { rotulo: "Dar como recebido", feito: ["baixada", "baixadas"] },
    vencimento: { rotulo: "Editar vencimento", feito: ["alterada", "alteradas"] },
    cancelar: { rotulo: "Cancelar cobranças", feito: ["cancelada", "canceladas"] },
  },
  pagar: {
    baixar: { rotulo: "Dar como pago", feito: ["baixada", "baixadas"] },
    vencimento: { rotulo: "Editar vencimento", feito: ["alterada", "alteradas"] },
    cancelar: { rotulo: "Cancelar contas", feito: ["cancelada", "canceladas"] },
  },
};

/* ───────── Contas a Receber: as regras de lib/financeiro/conta-receber-gestao ───────── */
export type ContaReceberLote = ContaGestao & { valor: unknown; dataVencimento?: Date | string | null };

export function motivoLoteReceber(acao: AcaoLote, c: ContaReceberLote, params?: ParamsVencimento): string | null {
  if (acao === "baixar") return motivoNaoReceber(c);
  if (acao === "cancelar") return motivoNaoCancelar(c);
  if (c.status === "RECEBIDO") return "Conta recebida.";
  if (c.status === "CANCELADO") return "Conta cancelada.";
  const trava = travasDaConta(c).vencimento;
  if (trava) return trava;
  if (params?.modo === "dias" && !c.dataVencimento) return "Sem vencimento: escolha uma data única.";
  return null;
}

/* ───────── Contas a Pagar (a ação individual não tem travas além do status) ───────── */
export interface ContaPagarLote { status: string; valorPago: unknown; saldoRestante: unknown; dataVencimento?: Date | string | null }

export function motivoNaoPagarPagar(c: ContaPagarLote): string | null {
  if (c.status === "CANCELADO") return "Conta cancelada não recebe baixa.";
  if (c.status === "PAGO_TOTAL" || Number(c.saldoRestante) <= 0) return "Esta conta já foi paga.";
  return null;
}
export function motivoNaoMudarVencimentoPagar(c: ContaPagarLote, params?: ParamsVencimento): string | null {
  if (c.status === "CANCELADO") return "Conta cancelada.";
  if (c.status === "PAGO_TOTAL") return "Conta paga.";
  if (params?.modo === "dias" && !c.dataVencimento) return "Sem vencimento: escolha uma data única.";
  return null;
}
/** Em lote, conta com pagamento lançado fica de fora (uma a uma, pela tela da conta, dá para cancelar olhando o histórico). */
export function motivoNaoCancelarPagar(c: ContaPagarLote): string | null {
  if (c.status === "CANCELADO") return "Esta conta já está cancelada.";
  if (c.status === "PAGO_TOTAL") return "Conta paga não pode ser cancelada.";
  if (Number(c.valorPago) > 0) return "Já tem pagamento lançado: cancele pela tela da conta, conferindo o histórico.";
  return null;
}
export function motivoLotePagar(acao: AcaoLote, c: ContaPagarLote, params?: ParamsVencimento): string | null {
  if (acao === "baixar") return motivoNaoPagarPagar(c);
  if (acao === "cancelar") return motivoNaoCancelarPagar(c);
  return motivoNaoMudarVencimentoPagar(c, params);
}

/* ───────── Resumo (tela e servidor): quem entra, quem fica de fora e por quê ───────── */
export interface ItemLote { id: string; numero: string; motivo: string | null; saldo: number }
export interface ResumoLote {
  elegiveis: ItemLote[];
  ignoradas: ItemLote[];
  /** Soma do saldo das elegíveis (o que a baixa vai registrar) */
  total: number;
  /** Quantas por motivo, para o resumo curto ("2 já recebidas · 1 cancelada") */
  porMotivo: { motivo: string; n: number }[];
}
const cent = (n: number) => Math.round(n * 100) / 100;

export function resumoLote(itens: { id: string; numero: string; motivo: string | null; saldo: number }[]): ResumoLote {
  const elegiveis = itens.filter((i) => !i.motivo);
  const ignoradas = itens.filter((i) => i.motivo);
  const contagem = new Map<string, number>();
  for (const i of ignoradas) contagem.set(i.motivo!, (contagem.get(i.motivo!) ?? 0) + 1);
  return {
    elegiveis, ignoradas,
    total: cent(elegiveis.reduce((s, i) => s + i.saldo, 0)),
    porMotivo: [...contagem].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
  };
}

export const resumoReceber = (acao: AcaoLote, contas: (ContaReceberLote & { id: string; numero: string })[], params?: ParamsVencimento) =>
  resumoLote(contas.map((c) => ({ id: c.id, numero: c.numero, motivo: motivoLoteReceber(acao, c, params), saldo: saldoDaConta(c) })));
export const resumoPagar = (acao: AcaoLote, contas: (ContaPagarLote & { id: string; numero: string })[], params?: ParamsVencimento) =>
  resumoLote(contas.map((c) => ({ id: c.id, numero: c.numero, motivo: motivoLotePagar(acao, c, params), saldo: Number(c.saldoRestante) })));

/* ───────── Vencimento novo ───────── */
const dois = (n: number) => String(n).padStart(2, "0");
/** Chave do dia civil ("AAAA-MM-DD") de um vencimento gravado (meia-noite UTC = dia civil) */
export function chaveDoVencimento(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return null;
  return `${x.getUTCFullYear()}-${dois(x.getUTCMonth() + 1)}-${dois(x.getUTCDate())}`;
}
/** "2026-11-20" + 30 → "2026-12-20" (no calendário, sem fuso) */
export function empurrarDiaCivil(chave: string, dias: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(chave);
  if (!m) throw new Error("Data inválida");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}
/** O vencimento que a conta vai ter (null = não dá: sem vencimento e modo "dias") */
export function novoVencimento(atual: Date | string | null | undefined, p: ParamsVencimento): string | null {
  if (p.modo === "data") return p.data.slice(0, 10);
  const chave = chaveDoVencimento(atual);
  return chave ? empurrarDiaCivil(chave, p.dias) : null;
}

/** Validação do pedido (tela e rota): o que está errado no formulário, antes de tocar em qualquer conta */
export function motivoPedidoInvalido(acao: AcaoLote, dados: { data?: string | null; vencimento?: ParamsVencimento | null; motivo?: string | null }): string | null {
  const dia = /^\d{4}-\d{2}-\d{2}$/;
  if (acao === "baixar") {
    if (!dados.data || !dia.test(dados.data)) return "Informe a data.";
    if (Number.isNaN(new Date(`${dados.data}T00:00:00Z`).getTime())) return "Data inválida.";
  }
  if (acao === "vencimento") {
    const v = dados.vencimento;
    if (!v) return "Escolha como alterar o vencimento.";
    if (v.modo === "data" && (!dia.test(v.data) || Number.isNaN(new Date(`${v.data}T00:00:00Z`).getTime()))) return "Informe a nova data de vencimento.";
    if (v.modo === "dias" && (!Number.isInteger(v.dias) || v.dias === 0 || Math.abs(v.dias) > MAX_DIAS)) return `Informe quantos dias empurrar (até ${MAX_DIAS}, diferente de zero).`;
  }
  if (acao === "cancelar" && (dados.motivo ?? "").trim().length < 3) return "Informe o motivo do cancelamento.";
  return null;
}
