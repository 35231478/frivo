import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { cn, formatarData, formatarMoeda, formatarCpfCnpj } from "@/lib/utils";
import { statusVisualPagar, LABELS_STATUS_CONTA_PAGAR } from "@/lib/financeiro-status";
import { Upload, Plus, AlertTriangle, ShoppingCart } from "lucide-react";
import { ContaPagarAcoes } from "@/components/financeiro/conta-pagar-acoes";

export const metadata: Metadata = { title: "Contas a Pagar" };

export default async function ContasPagarPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; fornecedor?: string; origem?: string; dataInicio?: string; dataFim?: string }>;
}) {
  const { status = "", fornecedor = "", origem = "", dataInicio = "", dataFim = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  await prisma.contaPagar.updateMany({
    where: { empresaId, status: "PENDENTE", dataVencimento: { lt: hoje } },
    data: { status: "VENCIDO" },
  });

  const where: any = { empresaId };
  if (status) where.status = status;
  if (fornecedor) where.fornecedor = { contains: fornecedor, mode: "insensitive" };
  if (origem === "PEDIDO") where.pedidoCompraId = { not: null };
  else if (origem === "MANUAL") where.pedidoCompraId = null;
  if (dataInicio || dataFim) {
    where.dataVencimento = {};
    if (dataInicio) where.dataVencimento.gte = new Date(dataInicio);
    if (dataFim) { const f = new Date(dataFim); f.setHours(23, 59, 59, 999); where.dataVencimento.lte = f; }
  }

  const contas = await prisma.contaPagar.findMany({
    where,
    include: { pedidoCompra: { select: { numero: true } } },
    orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }],
    take: 300,
  });

  let totalFiltrado = 0, totalVencido = 0, totalAberto = 0, totalPago = 0;
  for (const c of contas) {
    totalFiltrado += Number(c.valorTotal);
    totalPago += Number(c.valorPago);
    if (c.status === "VENCIDO") totalVencido += Number(c.saldoRestante);
    else if (c.status !== "PAGO_TOTAL" && c.status !== "CANCELADO") totalAberto += Number(c.saldoRestante);
  }

  const inputCls = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Upload className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Contas a Pagar</h1>
        </div>
        <Link href="/financeiro/contas-pagar/nova" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
          <Plus className="w-4 h-4" /> Nova Conta
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <select name="status" defaultValue={status} className={inputCls}>
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_CONTA_PAGAR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input name="fornecedor" defaultValue={fornecedor} placeholder="Fornecedor" className={inputCls} />
            <select name="origem" defaultValue={origem} className={inputCls}>
              <option value="">Todas origens</option>
              <option value="MANUAL">Manual</option>
              <option value="PEDIDO">Pedido de compra</option>
            </select>
            <input type="date" name="dataInicio" defaultValue={dataInicio} title="Vencimento de" className={inputCls} />
            <input type="date" name="dataFim" defaultValue={dataFim} title="Vencimento até" className={inputCls} />
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Fornecedor</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden xl:table-cell">Descrição</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Total</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Pago</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Saldo</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Vencimento</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Origem</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contas.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-ink-subtle py-12">Nenhuma conta a pagar encontrada</td></tr>
              ) : (
                contas.map((c) => {
                  const sv = statusVisualPagar(c.status, c.dataVencimento);
                  return (
                    <tr key={c.id} className={cn("border-b border-surface-border transition-colors", sv.linhaVermelha ? "bg-red-50 hover:bg-red-100/60" : "hover:bg-primary-50/40")}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink truncate max-w-[180px]">{c.fornecedor}</p>
                        {c.fornecedorCnpj && <p className="text-xs text-ink-subtle">{formatarCpfCnpj(c.fornecedorCnpj)}</p>}
                      </td>
                      <td className="px-4 py-3 text-ink-muted hidden xl:table-cell truncate max-w-[200px]">{c.descricao}</td>
                      <td className="px-4 py-3 text-right font-semibold text-ink">{formatarMoeda(Number(c.valorTotal))}</td>
                      <td className="px-4 py-3 text-right text-success-700 hidden md:table-cell">{formatarMoeda(Number(c.valorPago))}</td>
                      <td className="px-4 py-3 text-right font-bold text-ink">{formatarMoeda(Number(c.saldoRestante))}</td>
                      <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{formatarData(c.dataVencimento)}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", sv.classe)}>
                          {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {c.pedidoCompra ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full"><ShoppingCart className="w-3 h-3" /> Pedido {c.pedidoCompra.numero}</span>
                        ) : (
                          <span className="text-[11px] font-semibold bg-surface-alt text-ink-muted px-2 py-0.5 rounded-full">Manual</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ContaPagarAcoes conta={{ id: c.id, numero: c.numero, fornecedor: c.fornecedor, valorTotal: Number(c.valorTotal), valorPago: Number(c.valorPago), saldoRestante: Number(c.saldoRestante), status: c.status }} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {contas.length > 0 && (
              <tfoot className="bg-surface-alt border-t border-surface-border">
                <tr className="text-sm">
                  <td colSpan={2} className="px-4 py-3 font-semibold text-ink">Totais ({contas.length})</td>
                  <td className="px-4 py-3 text-right font-bold text-ink">{formatarMoeda(totalFiltrado)}</td>
                  <td className="px-4 py-3 text-right text-success-700 hidden md:table-cell">{formatarMoeda(totalPago)}</td>
                  <td colSpan={5} className="px-4 py-3">
                    <div className="flex items-center justify-end gap-4 text-xs">
                      <span className="text-red-700 font-semibold">Vencido: {formatarMoeda(totalVencido)}</span>
                      <span className="text-amber-700 font-semibold">Em aberto: {formatarMoeda(totalAberto)}</span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
