import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LABELS_TIPO_EQUIPAMENTO, cn } from "@/lib/utils";
import Link from "next/link";
import { Thermometer, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Equipamentos" };

export default async function EquipamentosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; pagina?: string }>;
}) {
  const { busca = "", pagina = "1" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const porPagina = 20;
  const skip = (Number(pagina) - 1) * porPagina;

  const where: any = { empresaId, ativo: true };
  if (busca) {
    where.OR = [
      { marca: { contains: busca, mode: "insensitive" } },
      { modelo: { contains: busca, mode: "insensitive" } },
      { numeroSerie: { contains: busca, mode: "insensitive" } },
      { unidade: { cliente: { nome: { contains: busca, mode: "insensitive" } } } },
      { unidade: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const [equipamentos, total] = await Promise.all([
    prisma.equipamento.findMany({
      where,
      include: {
        unidade: {
          select: {
            id: true,
            nome: true,
            cliente: { select: { id: true, nome: true, nomeFantasia: true } },
          },
        },
      },
      orderBy: { criadoEm: "desc" },
      skip,
      take: porPagina,
    }),
    prisma.equipamento.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <Thermometer className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Equipamentos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link
          href="/equipamentos/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" />
          Novo Equipamento
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por marca, modelo, série, cliente ou endereço..."
              className="w-full sm:max-w-sm bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
          </form>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-surface-alt border-b border-surface-border">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Equipamento</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Tipo</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Endereço</th>
              <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden xl:table-cell">Localização</th>
            </tr>
          </thead>
          <tbody>
            {equipamentos.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-ink-subtle py-12">Nenhum equipamento encontrado</td>
              </tr>
            ) : (
              equipamentos.map((eq, idx) => (
                <tr key={eq.id} className={cn(
                  "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                  idx % 2 === 1 && "bg-surface-alt/30",
                )}>
                  <td className="px-4 py-3">
                    <Link href={`/equipamentos/${eq.id}`} className="font-semibold text-ink hover:text-primary-600 transition-colors">
                      {eq.marca} {eq.modelo}
                    </Link>
                    <Link href={`/equipamentos/${eq.id}/editar`} className="text-xs text-primary-600 hover:underline ml-2">editar</Link>
                    {eq.numeroSerie && <p className="text-xs text-ink-subtle mt-0.5">N° {eq.numeroSerie}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted hidden md:table-cell">
                    {LABELS_TIPO_EQUIPAMENTO[eq.tipo] ?? eq.tipo}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    <Link href={`/clientes/${eq.unidade.cliente.id}`} className="hover:text-primary-600 transition-colors">
                      {eq.unidade.cliente.nomeFantasia ?? eq.unidade.cliente.nome}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">
                    {eq.unidade.nome}
                  </td>
                  <td className="px-4 py-3 text-ink-muted hidden xl:table-cell">
                    {eq.localizacao ?? "—"}
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
