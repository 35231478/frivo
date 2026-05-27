import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarMoeda, cn } from "@/lib/utils";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Contratos" };

const LABELS_TIPO: Record<string, string> = {
  MANUTENCAO_PREVENTIVA: "Prev.",
  MANUTENCAO_CORRETIVA: "Corr.",
  MANUTENCAO_COMPLETA: "Completa",
  INSTALACAO: "Instalação",
  LOCACAO: "Locação",
  ASSISTENCIA_TECNICA: "A. Técnica",
};

const COR_STATUS: Record<string, string> = {
  ATIVO: "bg-green-100 text-green-700",
  SUSPENSO: "bg-orange-100 text-orange-700",
  ENCERRADO: "bg-gray-100 text-gray-600",
  VENCIDO: "bg-red-100 text-red-700",
  AGUARDANDO_ASSINATURA: "bg-blue-100 text-blue-700",
};

const LABELS_STATUS: Record<string, string> = {
  ATIVO: "Ativo",
  SUSPENSO: "Suspenso",
  ENCERRADO: "Encerrado",
  VENCIDO: "Vencido",
  AGUARDANDO_ASSINATURA: "Aguard. Assinatura",
};

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; pagina?: string }>;
}) {
  const { busca = "", pagina = "1" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;
  const porPagina = 20;
  const skip = (Number(pagina) - 1) * porPagina;

  const where: any = { empresaId };
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const [contratos, total] = await Promise.all([
    prisma.contrato.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        _count: { select: { unidades: true } },
      },
      orderBy: { criadoEm: "desc" },
      skip,
      take: porPagina,
    }),
    prisma.contrato.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-frivo-600" />
          <h1 className="text-2xl font-bold text-gray-900">Contratos</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{total}</span>
        </div>
        <Link
          href="/contratos/novo"
          className="flex items-center gap-2 bg-frivo-600 hover:bg-frivo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Contrato
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <form method="get">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por número ou cliente..."
              className="w-full sm:max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-frivo-500"
            />
          </form>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Número</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Tipo</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Vigência</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Valor/mês</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {contratos.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-12">
                  Nenhum contrato encontrado
                </td>
              </tr>
            ) : (
              contratos.map((ct) => (
                <tr key={ct.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/contratos/${ct.id}`} className="font-mono font-medium text-frivo-600 hover:underline">
                      {ct.numero}
                    </Link>
                    <Link href={`/contratos/${ct.id}/editar`} className="block text-xs text-gray-400 hover:underline">editar</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-900">{ct.cliente.nomeFantasia ?? ct.cliente.nome}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{LABELS_TIPO[ct.tipo] ?? ct.tipo}</td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                    {formatarData(ct.dataInicio)} – {formatarData(ct.dataFim) ?? "indeterminado"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden lg:table-cell">
                    {formatarMoeda(ct.valorMensal ? Number(ct.valorMensal) : null)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs", COR_STATUS[ct.status])}>
                      {LABELS_STATUS[ct.status] ?? ct.status}
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
