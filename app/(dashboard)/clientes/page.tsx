import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarCpfCnpj, cn, LABELS_STATUS_FINANCEIRO, COR_STATUS_FINANCEIRO, LABELS_SEGMENTO } from "@/lib/utils";
import Link from "next/link";
import { Users, Plus, FileCheck, Star } from "lucide-react";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; pagina?: string; status?: string; segmento?: string }>;
}) {
  const { busca = "", pagina = "1", status = "", segmento = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const porPagina = 20;
  const skip = (Number(pagina) - 1) * porPagina;

  const where: any = { empresaId, ativo: true };
  if (busca) {
    where.OR = [
      { nome: { contains: busca, mode: "insensitive" } },
      { nomeFantasia: { contains: busca, mode: "insensitive" } },
      { cpfCnpj: { contains: busca } },
    ];
  }
  if (status) where.statusFinanceiro = status;
  if (segmento) where.segmento = segmento;

  const [clientes, total] = await Promise.all([
    prisma.cliente.findMany({
      where,
      include: {
        _count: { select: { unidades: true, ordensServico: true, contratos: true } },
        responsavelTecnico: { select: { nome: true } },
      },
      orderBy: { nome: "asc" },
      skip,
      take: porPagina,
    }),
    prisma.cliente.count({ where }),
  ]);

  function estrelas(n: number | null) {
    if (!n) return null;
    return (
      <span className="inline-flex items-center gap-0.5" title={`${n} de 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={cn("w-3 h-3", i < n ? "text-amber-400 fill-amber-400" : "text-surface-border")} />
        ))}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <Users className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Clientes</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link
          href="/clientes/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" /> Novo Cliente
        </Link>
      </div>

      <div className="card overflow-hidden">
        {/* Filtros */}
        <div className="p-4 border-b border-surface-border flex flex-wrap gap-3 bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2 flex-1">
            <input
              name="busca" defaultValue={busca}
              placeholder="Buscar por nome, fantasia ou CPF/CNPJ..."
              className="flex-1 min-w-[200px] bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
            <select name="status" defaultValue={status}
              className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Status financeiro</option>
              {Object.entries(LABELS_STATUS_FINANCEIRO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <select name="segmento" defaultValue={segmento}
              className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Segmento</option>
              {Object.entries(LABELS_SEGMENTO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">
              Filtrar
            </button>
          </form>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-surface-alt border-b border-surface-border">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Nome</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">CPF/CNPJ</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Segmento</th>
              <th className="text-center px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden xl:table-cell">Satisfação</th>
              <th className="text-center px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">End.</th>
              <th className="text-center px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">OS</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {clientes.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-ink-subtle py-12">Nenhum cliente encontrado</td></tr>
            ) : (
              clientes.map((c, idx) => (
                <tr key={c.id} className={cn(
                  "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                  idx % 2 === 1 && "bg-surface-alt/30",
                )}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/clientes/${c.id}/editar`} className="font-semibold text-ink hover:text-primary-600 transition-colors">
                        {c.nomeFantasia ?? c.nome}
                      </Link>
                      {c._count.contratos > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-success-50 text-success-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                          <FileCheck className="w-2.5 h-2.5" /> Cliente de Contrato
                        </span>
                      )}
                    </div>
                    {c.nomeFantasia && <p className="text-xs text-ink-subtle mt-0.5">{c.nome}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{formatarCpfCnpj(c.cpfCnpj)}</td>
                  <td className="px-4 py-3 text-ink-muted hidden lg:table-cell text-xs">
                    {c.segmento ? (LABELS_SEGMENTO[c.segmento] ?? c.segmento) : "—"}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex justify-center">{estrelas(c.satisfacao)}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-ink-muted">{c._count.unidades}</td>
                  <td className="px-4 py-3 text-center text-ink-muted">{c._count.ordensServico}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap", COR_STATUS_FINANCEIRO[c.statusFinanceiro])}>
                      {LABELS_STATUS_FINANCEIRO[c.statusFinanceiro]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
