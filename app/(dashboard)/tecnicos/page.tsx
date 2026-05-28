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
          <div className="p-2 bg-primary-50 rounded-lg">
            <HardHat className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Técnicos</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{tecnicos.length}</span>
        </div>
        <Link
          href="/tecnicos/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" />
          Novo Técnico
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por nome ou CPF..."
              className="w-full sm:max-w-sm bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
          </form>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {tecnicos.length === 0 ? (
            <p className="text-ink-subtle col-span-full text-center py-8">Nenhum técnico encontrado</p>
          ) : (
            tecnicos.map((tc) => (
              <Link
                key={tc.id}
                href={`/tecnicos/${tc.id}/editar`}
                className="flex items-start gap-4 p-4 bg-white border border-surface-border rounded-xl hover:border-primary-300 hover:shadow-card-hover transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500 to-success-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {tc.nome.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink truncate">{tc.nome}</p>
                  <p className="text-xs text-ink-subtle">{formatarCpfCnpj(tc.cpf)}</p>
                  <p className="text-xs text-ink-muted mt-1">{formatarTelefone(tc.telefone)}</p>
                  {tc.crea && <p className="text-xs text-ink-subtle">CREA: {tc.crea}</p>}
                  {tc.especialidades.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tc.especialidades.slice(0, 2).map((esp) => (
                        <span key={esp} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">{esp}</span>
                      ))}
                      {tc.especialidades.length > 2 && (
                        <span className="text-xs text-ink-subtle">+{tc.especialidades.length - 2}</span>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-ink-subtle mt-2 pt-2 border-t border-surface-border">
                    {tc._count.atividadesOs} atividades realizadas
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
