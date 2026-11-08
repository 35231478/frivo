/**
 * "Faturar" (faturamento avulso) — regras puras. A fatura É uma medição (mesma engine: conta a
 * receber, NFS-e, retenções); só nasce liberada para a nota e aparece como "Fatura" (D1/D3 do #102).
 * O número interno MED-AAAA-NNNN não muda: na tela vira "Fatura AAAA-NNNN".
 */
import { round2, versaoCliente, type EntradaCalculo } from "@/lib/orcamentos/calculo";

/** "MED-21" → "21" (formato novo); "MED-2026-0012" → "2026-0012" (antigo) */
export const numeroFatura = (numero: string) => numero.replace(/^MED-/, "");

/** Como a medição aparece para quem lê: "Fatura 21" (avulsa) ou "Medição MED-21" */
export function rotuloMedicao(m: { numero: string; avulsa?: boolean | null }) {
  return m.avulsa ? `Fatura ${numeroFatura(m.numero)}` : `Medição ${m.numero}`;
}

/** Referência na discriminação da NFS-e: "Fatura nº 21" ou "Medição MED-21" */
export function referenciaNota(m: { numero: string; avulsa?: boolean | null; faturaParcial?: boolean | null; percentualFaturado?: unknown }) {
  if (!m.avulsa) return `Medição ${m.numero}`;
  // P5: a nota de uma parte diz que é parte ("Fatura nº 2026-0012 (parcial 40%)")
  const parte = m.faturaParcial && m.percentualFaturado != null ? ` (${rotuloParcial(Number(m.percentualFaturado))})` : "";
  return `Fatura nº ${numeroFatura(m.numero)}${parte}`;
}

/** Por que o orçamento não pode ser faturado (null = pode) */
export function motivoNaoFaturarOrcamento(o: { status: string; tipo: string }): string | null {
  if (o.tipo === "PROPOSTA_CONTRATO") return "Proposta de contrato é faturada pelo contrato.";
  if (o.status !== "APROVADO") return "Só orçamento aprovado pode ser faturado.";
  return null;
}

/** Por que a OS não pode ser faturada pelo botão (null = pode) */
export function motivoNaoFaturarOs(os: { status: string; contratoId?: string | null }): string | null {
  if (os.contratoId) return "OS de contrato: fature pela medição do contrato.";
  if (os.status !== "CONCLUIDA") return "Conclua a OS antes de faturar.";
  return null;
}

/**
 * Vencimento da fatura avulsa: o próximo dia de faturamento do cliente a partir de hoje (nunca
 * nasce vencida). `hoje` e o resultado são dias civis (meia-noite UTC).
 */
export function vencimentoAvulso(diaFaturamento: number | null | undefined, hoje: { ano: number; mes0: number; dia: number }): Date {
  const dia = Math.min(Math.max(diaFaturamento || 1, 1), 28);
  const proximoMes = dia < hoje.dia;
  const mes0 = proximoMes ? (hoje.mes0 + 1) % 12 : hoje.mes0;
  const ano = proximoMes && hoje.mes0 === 11 ? hoje.ano + 1 : hoje.ano;
  return new Date(Date.UTC(ano, mes0, dia));
}

export interface LinhaFatura {
  tipo: "SERVICO" | "PRODUTO";
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  servicoId?: string | null;
  produtoId?: string | null;
  orcamentoId?: string | null;
  ordemServicoId?: string | null;
}
export interface Fatura { linhas: LinhaFatura[]; valorTotal: number; descontoValor: number; valorLiquido: number }

type ItemOrc = { descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; ordem?: number | null };

/**
 * Fatura do orçamento aprovado: os itens como o CLIENTE aprovou (ISS embutido nos serviços, como no
 * documento dele), o desconto dos grupos e o total = total geral do orçamento, ao centavo.
 */
export function faturaDoOrcamento(o: EntradaCalculo & {
  id: string;
  servicos: (ItemOrc & { servicoId?: string | null })[];
  produtos: (ItemOrc & { produtoId?: string | null })[];
}): Fatura {
  const ordenar = <T extends ItemOrc>(l: T[]) => l.map((it, i) => ({ it, i })).sort((a, b) => (a.it.ordem ?? 0) - (b.it.ordem ?? 0) || a.i - b.i).map((x) => x.it);
  const servicos = ordenar(o.servicos);
  const produtos = ordenar(o.produtos);
  const v = versaoCliente({ ...o, servicos, produtos });
  const linhas: LinhaFatura[] = [
    ...servicos.map((s, i) => ({
      tipo: "SERVICO" as const, descricao: s.descricao.trim().slice(0, 500), quantidade: Number(s.quantidade),
      valorUnitario: v.servicos[i].valorUnitario, valorTotal: v.servicos[i].valorTotal, servicoId: s.servicoId ?? null, orcamentoId: o.id,
    })),
    ...produtos.map((p, i) => ({
      tipo: "PRODUTO" as const, descricao: p.descricao.trim().slice(0, 500), quantidade: Number(p.quantidade),
      valorUnitario: v.produtos[i].valorUnitario, valorTotal: v.produtos[i].valorTotal, produtoId: p.produtoId ?? null, orcamentoId: o.id,
    })),
  ];
  return {
    linhas,
    valorTotal: round2(v.subtotalServicos + v.subtotalProdutos),
    descontoValor: round2(v.descontoServicos + v.descontoProdutos),
    valorLiquido: v.totalGeral,
  };
}

/**
 * Fatura da OS concluída: itens EXECUTADOS (com o serviço do orçamento de origem, quando a OS foi
 * gerada dele) + adicionais marcados "Cobrar" com preço. Sem desconto.
 */
export function faturaDaOs(osId: string,
  itens: { descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; servicoId?: string | null; tipo?: string | null; produtoId?: string | null }[],
  adicionais: { descricao: string; valor: unknown }[],
): Fatura {
  const linhas: LinhaFatura[] = [
    // E3.3b: item PRODUTO da OS (peça à parte) vira linha de produto; item antigo (sem tipo) é serviço, como sempre
    ...itens.map((it) => (it.tipo === "PRODUTO" ? {
      tipo: "PRODUTO" as const, descricao: it.descricao.trim().slice(0, 500), quantidade: Number(it.quantidade),
      valorUnitario: Number(it.valorUnitario), valorTotal: Number(it.valorTotal), produtoId: it.produtoId ?? null, ordemServicoId: osId,
    } : {
      tipo: "SERVICO" as const, descricao: it.descricao.trim().slice(0, 500), quantidade: Number(it.quantidade),
      valorUnitario: Number(it.valorUnitario), valorTotal: Number(it.valorTotal), servicoId: it.servicoId ?? null, ordemServicoId: osId,
    })),
    ...adicionais.map((a) => ({
      tipo: "SERVICO" as const, descricao: `Serviço adicional — ${a.descricao.trim()}`.slice(0, 500), quantidade: 1,
      valorUnitario: Number(a.valor), valorTotal: Number(a.valor), ordemServicoId: osId,
    })),
  ];
  const valorTotal = round2(linhas.reduce((s, l) => s + l.valorTotal, 0));
  return { linhas, valorTotal, descontoValor: 0, valorLiquido: valorTotal };
}

/**
 * E5 — medição COMPLETA (relatório + medição, aprovada pelo cliente): o serviço do período sai numa linha só, como
 * sempre; as PEÇAS (itens PRODUTO executados da OS) saem como linhas de produto, cobradas à parte — a mesma regra do
 * "Faturar" e do "Gerar medição". O material incluso já está embutido no serviço (ajuste pela diferença) e nunca vira
 * linha. Sem peça, a medição é idêntica à de antes (uma linha com o valor do relatório).
 */
export function linhasMedicaoCompleta(
  numeroRelatorio: string, valorFinanceiro: unknown, osId: string,
  produtos: { descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; produtoId?: string | null }[],
): LinhaFatura[] {
  const pecas: LinhaFatura[] = produtos.map((p) => ({
    tipo: "PRODUTO" as const, descricao: p.descricao.trim().slice(0, 500), quantidade: Number(p.quantidade),
    valorUnitario: Number(p.valorUnitario), valorTotal: round2(Number(p.valorTotal)), produtoId: p.produtoId ?? null, ordemServicoId: osId,
  }));
  const totalPecas = round2(pecas.reduce((s, l) => s + l.valorTotal, 0));
  const servico = round2(Math.max(0, Number(valorFinanceiro) - totalPecas));
  const linhas: LinhaFatura[] = servico > 0 || !pecas.length
    ? [{ tipo: "SERVICO", descricao: `Serviço do período — ${numeroRelatorio}`, quantidade: 1, valorUnitario: servico, valorTotal: servico, ordemServicoId: osId }]
    : [];
  return [...linhas, ...pecas];
}

/** Status na tela: a fatura avulsa nasce liberada para a nota (sem PC), então "PC recebido" vira "A emitir" */
export function rotuloStatusMedicao(m: { status: string; avulsa?: boolean | null }, labels: Record<string, string>) {
  if (m.avulsa && m.status === "PC_RECEBIDO") return "A emitir";
  return labels[m.status] ?? m.status;
}

/* ───────────────────────── P5 — faturamento parcial (regras puras) ───────────────────────── */

/** Uma fatura (medição avulsa viva) ligada à origem, como a tela mostra */
export interface FaturaDaOrigem {
  id: string; numero: string; status: string; valor: number;
  parcial: boolean; percentual: number | null; criadoEm: string; nfNumero: string | null;
}
/** Quanto da origem já foi faturado e quanto resta */
export interface FaturamentoOrigem { total: number; faturado: number; saldo: number; faturas: FaturaDaOrigem[] }

export type StatusFaturamento = "A_FATURAR" | "PARCIAL" | "FATURADO";
export const ROTULO_STATUS_FATURAMENTO: Record<StatusFaturamento, string> = { A_FATURAR: "A faturar", PARCIAL: "Parcialmente faturado", FATURADO: "Faturado" };

/** Saldo a faturar da origem (nunca negativo), ao centavo */
export const saldoAFaturar = (total: number, faturado: number) => round2(Math.max(0, Number(total) - Number(faturado)));

/** A faturar (nada faturado) → parcialmente faturado → faturado (saldo zerado) */
export function statusFaturamento(f: { total: number; faturado: number }): StatusFaturamento {
  if (Number(f.faturado) <= 0) return "A_FATURAR";
  return saldoAFaturar(f.total, f.faturado) <= 0 ? "FATURADO" : "PARCIAL";
}

/** O pedido do modal: por valor OU por percentual do total da origem */
export interface PedidoParcial { valor?: number | null; percentual?: number | null }

/**
 * Valida a parte pedida contra o saldo. Percentual é sobre o TOTAL da origem (40% do orçamento), não sobre o saldo.
 * Diferença de até 1 centavo para cima é arredondada ao saldo (o último "resto" por percentual fecha a conta).
 */
export function validarParcial(f: { total: number; saldo: number }, pedido: PedidoParcial): { ok: true; valor: number; percentual: number } | { ok: false; erro: string } {
  const total = round2(Number(f.total)), saldo = round2(Number(f.saldo));
  if (saldo <= 0) return { ok: false, erro: "Nada a faturar: a origem já está faturada." };
  let valor: number;
  if (pedido.percentual != null && Number.isFinite(Number(pedido.percentual))) {
    const pct = Number(pedido.percentual);
    if (pct <= 0 || pct > 100) return { ok: false, erro: "Informe um percentual entre 0 e 100." };
    valor = round2(total * pct / 100);
  } else if (pedido.valor != null && Number.isFinite(Number(pedido.valor))) {
    valor = round2(Number(pedido.valor));
  } else {
    return { ok: false, erro: "Informe o valor ou o percentual da parte a faturar." };
  }
  if (valor <= 0) return { ok: false, erro: "A parte a faturar precisa ser maior que zero." };
  if (valor > saldo + 0.01) return { ok: false, erro: `A parte (${valor.toFixed(2)}) passa do saldo a faturar (${saldo.toFixed(2)}).` };
  if (valor > saldo) valor = saldo;
  return { ok: true, valor, percentual: percentualDoTotal(valor, total) };
}

/** Fatia do total, em % com 2 casas (100% quando o valor é o total) */
export const percentualDoTotal = (valor: number, total: number) => (total > 0 ? round2(Math.min(100, (valor / total) * 100)) : 0);

/**
 * A fatura de UMA PARTE da origem: cada linha da fatura cheia entra proporcional (mantém serviço/produto —
 * é por eles que a NFS-e e as retenções saem, agora sobre o valor parcial), a última linha absorve o
 * arredondamento para fechar o total ao centavo. Desconto proporcional; líquido = exatamente a parte pedida.
 */
export function faturaParcial(base: Fatura, valor: number, rotulo: string): Fatura {
  const total = Number(base.valorLiquido);
  if (total <= 0 || valor <= 0) return { linhas: [], valorTotal: 0, descontoValor: 0, valorLiquido: 0 };
  // Nunca mais que a fatura cheia (quem chama já validou contra o saldo; aqui é só a divisão)
  const f = Math.min(1, valor / total);
  const descontoValor = round2(Number(base.descontoValor) * f);
  const valorLiquido = round2(Math.min(valor, total));
  const valorTotal = round2(valorLiquido + descontoValor);
  const linhas: LinhaFatura[] = base.linhas.map((l) => {
    const v = round2(Number(l.valorTotal) * f);
    return { ...l, descricao: `${l.descricao} — ${rotulo}`.slice(0, 500), quantidade: 1, valorUnitario: v, valorTotal: v };
  }).filter((l) => l.valorTotal > 0);
  if (linhas.length) {
    const soma = round2(linhas.reduce((s, l) => s + l.valorTotal, 0));
    const ajuste = round2(valorTotal - soma);
    if (ajuste !== 0) { const u = linhas[linhas.length - 1]; u.valorTotal = round2(u.valorTotal + ajuste); u.valorUnitario = u.valorTotal; }
  }
  return { linhas, valorTotal, descontoValor, valorLiquido };
}

/** Rótulo da parte: "parcial 40%" (entra na descrição da fatura, das linhas e da NFS-e) */
export const rotuloParcial = (percentual: number) => `parcial ${Number(percentual).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
