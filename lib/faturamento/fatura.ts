/**
 * "Faturar" (faturamento avulso) — regras puras. A fatura É uma medição (mesma engine: conta a
 * receber, NFS-e, retenções); só nasce liberada para a nota e aparece como "Fatura" (D1/D3 do #102).
 * O número interno MED-AAAA-NNNN não muda: na tela vira "Fatura AAAA-NNNN".
 */
import { round2, versaoCliente, type EntradaCalculo } from "@/lib/orcamentos/calculo";

/** "MED-2026-0012" → "2026-0012" */
export const numeroFatura = (numero: string) => numero.replace(/^MED-/, "");

/** Como a medição aparece para quem lê: "Fatura 2026-0012" (avulsa) ou "Medição MED-2026-0012" */
export function rotuloMedicao(m: { numero: string; avulsa?: boolean | null }) {
  return m.avulsa ? `Fatura ${numeroFatura(m.numero)}` : `Medição ${m.numero}`;
}

/** Referência na discriminação da NFS-e: "Fatura nº 2026-0012" ou "Medição MED-2026-0012" */
export function referenciaNota(m: { numero: string; avulsa?: boolean | null }) {
  return m.avulsa ? `Fatura nº ${numeroFatura(m.numero)}` : `Medição ${m.numero}`;
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
  itens: { descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; servicoId?: string | null }[],
  adicionais: { descricao: string; valor: unknown }[],
): Fatura {
  const linhas: LinhaFatura[] = [
    ...itens.map((it) => ({
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

/** Status na tela: a fatura avulsa nasce liberada para a nota (sem PC), então "PC recebido" vira "A emitir" */
export function rotuloStatusMedicao(m: { status: string; avulsa?: boolean | null }, labels: Record<string, string>) {
  if (m.avulsa && m.status === "PC_RECEBIDO") return "A emitir";
  return labels[m.status] ?? m.status;
}
