import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn, formatarData, formatarMoeda, LABELS_STATUS_ORCAMENTO, CLASSE_STATUS_ORCAMENTO, LABELS_TIPO_ORCAMENTO, CLASSE_TIPO_ORCAMENTO } from "@/lib/utils";
import Link from "next/link";
import { Calculator, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Orçamentos" };

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; status?: string; tipo?: string; clienteId?: string; dataInicio?: string; dataFim?: string }>;
}) {
  const { busca = "", status = "", tipo = "", clienteId = "", dataInicio = "", dataFim = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const where: any = { empresaId };
  if (status) where.status = status;
  if (tipo) where.tipo = tipo;
  if (clienteId) where.clienteId = clienteId;
  if (dataInicio || dataFim) {
    where.criadoEm = {};
    if (dataInicio) where.criadoEm.gte = new Date(dataInicio);
    if (dataFim) {
      const fim = new Date(dataFim);
      fim.setHours(23, 59, 59, 999);
      where.criadoEm.lte = fim;
    }
  }
  if (busca) {
    where.OR = [
      { codigo: { contains: busca, mode: "insensitive" } },
      { nome: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const [orcamentos, total, clientes] = await Promise.all([
    prisma.orcamento.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        _count: { select: { ordensServico: true } },
      },
      orderBy: { criadoEm: "desc" },
      take: 100,
    }),
    prisma.orcamento.count({ where }),
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <Calculator className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Orçamentos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link
          href="/orcamentos/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" /> Novo Orçamento
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por código, nome ou cliente..."
              className="flex-1 min-w-[220px] bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
            <select name="tipo" defaultValue={tipo}
              className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos os tipos</option>
              {Object.entries(LABELS_TIPO_ORCAMENTO).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select name="status" defaultValue={status}
              className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_ORCAMENTO).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <select name="clienteId" defaultValue={clienteId}
              className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos clientes</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>
              ))}
            </select>
            <input
              type="date"
              name="dataInicio"
              defaultValue={dataInicio}
              title="Data inicial"
              className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
            <input
              type="date"
              name="dataFim"
              defaultValue={dataFim}
              title="Data final"
              className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">
              Filtrar
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Código</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Nome</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Tipo</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Total</th>
                <th className="text-center px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">OS</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Criado</th>
              </tr>
            </thead>
            <tbody>
              {orcamentos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-ink-subtle py-12">
                    Nenhum orçamento encontrado
                  </td>
                </tr>
              ) : (
                orcamentos.map((o, idx) => (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                      idx % 2 === 1 && "bg-surface-alt/30",
                    )}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/orcamentos/${o.id}`} className="font-mono font-semibold text-primary-600 hover:underline">
                        {o.codigo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink font-medium">{o.nome}</td>
                    <td className="px-4 py-3 text-ink-muted">{o.cliente.nomeFantasia ?? o.cliente.nome}</td>
                    <td className="px-4 py-3">
                      <span className={CLASSE_TIPO_ORCAMENTO[o.tipo]}>
                        {LABELS_TIPO_ORCAMENTO[o.tipo]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={CLASSE_STATUS_ORCAMENTO[o.status]}>
                        {LABELS_STATUS_ORCAMENTO[o.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-ink">
                      {formatarMoeda(Number(o.totalGeral))}
                    </td>
                    <td className="px-4 py-3 text-center text-ink-muted hidden md:table-cell">
                      {o._count.ordensServico}
                    </td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">
                      {formatarData(o.criadoEm)}
                    </td>
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
