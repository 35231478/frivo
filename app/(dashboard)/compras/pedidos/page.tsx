import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { cn, formatarData, LABELS_STATUS_PEDIDO_COMPRA, CLASSE_STATUS_PEDIDO_COMPRA } from "@/lib/utils";
import { ShoppingCart } from "lucide-react";

export const metadata: Metadata = { title: "Pedidos de Compra" };

export default async function PedidosCompraPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; compradorId?: string }>;
}) {
  const { status = "", compradorId = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const where: any = { empresaId };
  if (status) where.status = status;
  if (compradorId) where.compradorId = compradorId;

  const [pedidos, total, compradores] = await Promise.all([
    prisma.pedidoCompraInterno.findMany({
      where,
      include: {
        itens: true,
        comprador: { select: { id: true, nome: true } },
        ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
      },
      orderBy: { criadoEm: "desc" },
      take: 200,
    }),
    prisma.pedidoCompraInterno.count({ where }),
    prisma.usuario.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><ShoppingCart className="w-5 h-5 text-primary-600" /></div>
        <h1 className="page-title">Pedidos de Compra</h1>
        <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <select name="status" defaultValue={status} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_PEDIDO_COMPRA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="compradorId" defaultValue={compradorId} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos compradores</option>
              {compradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Número</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Itens</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">OS</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Comprador</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Prazo</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-ink-subtle py-12">Nenhum pedido de compra encontrado</td></tr>
              ) : (
                pedidos.map((p, idx) => (
                  <tr key={p.id} className={cn("border-b border-surface-border hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
                    <td className="px-4 py-3">
                      <Link href={`/compras/pedidos/${p.id}`} className="font-mono font-semibold text-primary-600 hover:underline">{p.numero}</Link>
                    </td>
                    <td className="px-4 py-3 text-ink-muted max-w-[280px] truncate">
                      {p.itens.map((i) => `${i.descricao} (${Number(i.quantidade)} ${i.unidade})`).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{p.ordemServico?.numero ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{p.comprador?.nome ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{formatarData(p.prazoNecessario)}</td>
                    <td className="px-4 py-3"><span className={CLASSE_STATUS_PEDIDO_COMPRA[p.status]}>{LABELS_STATUS_PEDIDO_COMPRA[p.status]}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
