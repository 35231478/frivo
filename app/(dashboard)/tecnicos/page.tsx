import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarCpfCnpj, formatarTelefone } from "@/lib/utils";
import Link from "next/link";
import { HardHat, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Técnicos" };

export default async function TecnicosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string }>;
}) {
  const { busca = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const where: any = { empresaId, ativo: true };
  if (busca) {
    where.OR = [
      { nome: { contains: busca, mode: "insensitive" } },
      { cpf: { contains: busca } },
    ];
  }

  const tecnicos = await prisma.tecnico.findMany({
    where,
    include: { _count: { select: { atividadesOs: true } } },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardHat className="w-6 h-6 text-frivo-600" />
          <h1 className="text-2xl font-bold text-gray-900">Técnicos</h1>
          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{tecnicos.length}</span>
        </div>
        <Link
          href="/tecnicos/novo"
          className="flex items-center gap-2 bg-frivo-600 hover:bg-frivo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Técnico
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <form method="get">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por nome ou CPF..."
              className="w-full sm:max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-frivo-500"
            />
          </form>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {tecnicos.length === 0 ? (
            <p className="text-gray-400 col-span-full text-center py-8">Nenhum técnico encontrado</p>
          ) : (
            tecnicos.map((tc) => (
              <Link
                key={tc.id}
                href={`/tecnicos/${tc.id}/editar`}
                className="flex items-start gap-4 p-4 border border-gray-200 rounded-xl hover:border-frivo-300 hover:bg-frivo-50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-frivo-100 flex items-center justify-center text-frivo-700 font-bold text-sm shrink-0">
                  {tc.nome.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{tc.nome}</p>
                  <p className="text-xs text-gray-400">{formatarCpfCnpj(tc.cpf)}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatarTelefone(tc.telefone)}</p>
                  {tc.crea && <p className="text-xs text-gray-400">CREA: {tc.crea}</p>}
                  {tc.especialidades.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tc.especialidades.slice(0, 2).map((esp) => (
                        <span key={esp} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{esp}</span>
                      ))}
                      {tc.especialidades.length > 2 && (
                        <span className="text-xs text-gray-400">+{tc.especialidades.length - 2}</span>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{tc._count.atividadesOs} atividades realizadas</p>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
