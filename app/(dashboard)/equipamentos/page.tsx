import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LABELS_TIPO_EQUIPAMENTO, formatarData } from "@/lib/utils";
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
          <Thermometer className="w-6 h-6 text-frivo-600" />
          <h1 className="text-2xl font-bold text-gray-900">Equipamentos</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{total}</span>
        </div>
        <Link
          href="/equipamentos/novo"
          className="flex items-center gap-2 bg-frivo-600 hover:bg-frivo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Equipamento
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <form method="get">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por marca, modelo, série, cliente ou endereço..."
              className="w-full sm:max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-frivo-500"
            />
          </form>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Equipamento</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Tipo</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Endereço</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 hidden xl:table-cell">Localização</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {equipamentos.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-12">Nenhum equipamento encontrado</td>
              </tr>
            ) : (
              equipamentos.map((eq) => (
                <tr key={eq.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/equipamentos/${eq.id}`} className="font-medium text-gray-900 hover:text-frivo-600">
                      {eq.marca} {eq.modelo}
                    </Link>
                    <Link href={`/equipamentos/${eq.id}/editar`} className="text-xs text-frivo-500 hover:underline ml-2">editar</Link>
                    {eq.numeroSerie && <p className="text-xs text-gray-400">N° {eq.numeroSerie}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {LABELS_TIPO_EQUIPAMENTO[eq.tipo] ?? eq.tipo}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    <Link href={`/clientes/${eq.unidade.cliente.id}`} className="hover:text-frivo-600">
                      {eq.unidade.cliente.nomeFantasia ?? eq.unidade.cliente.nome}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                    {eq.unidade.nome}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden xl:table-cell">
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
