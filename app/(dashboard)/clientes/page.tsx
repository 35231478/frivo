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
          <Star key={i} className={cn("w-3 h-3", i < n ? "text-amber-400 fill-amber-400" : "text-gray-200")} />
        ))}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-frivo-600" />
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{total}</span>
        </div>
        <Link
          href="/clientes/novo"
          className="flex items-center gap-2 bg-frivo-600 hover:bg-frivo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo Cliente
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Filtros */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3">
          <form method="get" className="flex flex-wrap gap-2 flex-1">
            <input
              name="busca" defaultValue={busca}
              placeholder="Buscar por nome, fantasia ou CPF/CNPJ..."
              className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-frivo-500"
            />
            <select name="status" defaultValue={status}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-frivo-500">
              <option value="">Status financeiro</option>
              {Object.entries(LABELS_STATUS_FINANCEIRO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <select name="segmento" defaultValue={segmento}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-frivo-500">
              <option value="">Segmento</option>
              {Object.entries(LABELS_SEGMENTO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <button type="submit" className="bg-frivo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-frivo-700 transition-colors">
              Filtrar
            </button>
          </form>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nome</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">CPF/CNPJ</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Segmento</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 hidden xl:table-cell">Satisfação</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">End.</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">OS</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {clientes.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-12">Nenhum cliente encontrado</td></tr>
            ) : (
              clientes.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/clientes/${c.id}/editar`} className="font-medium text-gray-900 hover:text-frivo-600">
                        {c.nomeFantasia ?? c.nome}
                      </Link>
                      {c._count.contratos > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          <FileCheck className="w-2.5 h-2.5" /> Contrato
                        </span>
                      )}
                    </div>
                    {c.nomeFantasia && <p className="text-xs text-gray-400">{c.nome}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{formatarCpfCnpj(c.cpfCnpj)}</td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell text-xs">
                    {c.segmento ? (LABELS_SEGMENTO[c.segmento] ?? c.segmento) : "—"}
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="flex justify-center">{estrelas(c.satisfacao)}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">{c._count.unidades}</td>
                  <td className="px-4 py-3 text-center text-gray-500">{c._count.ordensServico}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", COR_STATUS_FINANCEIRO[c.statusFinanceiro])}>
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
