import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarData, cn, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Ordens de Serviço" };

const COR_STATUS: Record<string, string> = {
  ABERTA: "bg-blue-100 text-blue-700", AGENDADA: "bg-purple-100 text-purple-700",
  EM_ANDAMENTO: "bg-yellow-100 text-yellow-700", PAUSADA: "bg-orange-100 text-orange-700",
  AGUARDANDO_PECA: "bg-amber-100 text-amber-700", CONCLUIDA: "bg-green-100 text-green-700",
  CANCELADA: "bg-red-100 text-red-700",
};
const COR_PRIORIDADE: Record<string, string> = {
  BAIXA: "bg-gray-100 text-gray-600", NORMAL: "bg-blue-100 text-blue-600",
  ALTA: "bg-orange-100 text-orange-600", URGENTE: "bg-red-100 text-red-700 font-semibold",
};

export default async function OrdensPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; status?: string; prioridade?: string }>;
}) {
  const { busca = "", status = "", prioridade = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const where: any = { empresaId };
  if (status) where.status = status;
  if (prioridade) where.prioridade = prioridade;
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { descricao: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const [ordens, total] = await Promise.all([
    prisma.ordemServico.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        unidade: { select: { nome: true } },
        responsavel: { select: { nome: true } },
        _count: { select: { atividades: true } },
      },
      orderBy: { criadoEm: "desc" },
      take: 100,
    }),
    prisma.ordemServico.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-frivo-600" />
          <h1 className="text-2xl font-bold text-gray-900">Ordens de Serviço</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{total}</span>
        </div>
        <Link href="/ordens/nova" className="flex items-center gap-2 bg-frivo-600 hover:bg-frivo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Nova OS
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <form method="get" className="flex flex-wrap gap-2">
            <input name="busca" defaultValue={busca} placeholder="Buscar por número, cliente ou descrição..."
              className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-frivo-500" />
            <select name="status" defaultValue={status} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Status</option>
              {Object.entries(LABELS_STATUS_OS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <select name="prioridade" defaultValue={prioridade} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Prioridade</option>
              {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <button type="submit" className="bg-frivo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-frivo-700">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Número</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Endereço</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Ativid.</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Abertura</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Prioridade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ordens.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-gray-400 py-12">Nenhuma OS encontrada</td></tr>
              ) : (
                ordens.map((os) => (
                  <tr key={os.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/ordens/${os.id}`} className="font-mono font-medium text-frivo-600 hover:underline">{os.numero}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{os.cliente.nomeFantasia ?? os.cliente.nome}</td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{os.unidade?.nome ?? "—"}</td>
                    <td className="px-4 py-3 text-center text-gray-500 hidden lg:table-cell">{os._count.atividades}</td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{formatarData(os.criadoEm)}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs", COR_STATUS[os.status])}>{LABELS_STATUS_OS[os.status]}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs", COR_PRIORIDADE[os.prioridade])}>{LABELS_PRIORIDADE[os.prioridade]}</span>
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
