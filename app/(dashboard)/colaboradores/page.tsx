import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarCpfCnpj, formatarTelefone } from "@/lib/utils";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import Link from "next/link";
import { HardHat, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Colaboradores" };

const LABEL_TIPO: Record<string, string> = {
  TECNICO_CAMPO: "Técnico de Campo",
  RESPONSAVEL_TECNICO: "Responsável Técnico",
  ADMINISTRATIVO: "Administrativo",
  MOTORISTA: "Motorista",
  OUTRO: "Outro",
};

const BADGE_STATUS: Record<string, string> = {
  ATIVO: "bg-success-50 text-success-700",
  INATIVO: "bg-surface-alt text-ink-muted",
  FERIAS: "bg-amber-50 text-amber-700",
  AFASTADO: "bg-red-50 text-red-700",
};
const LABEL_STATUS: Record<string, string> = { ATIVO: "Ativo", INATIVO: "Inativo", FERIAS: "Férias", AFASTADO: "Afastado" };

export default async function ColaboradoresPage({
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

  const colaboradores = await prisma.tecnico.findMany({
    where,
    include: { _count: { select: { atividadesOs: true } }, cargo: { select: { nome: true } } },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <HardHat className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Colaboradores</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{colaboradores.length}</span>
        </div>
        <Link
          href="/colaboradores/novo"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4" />
          Novo Colaborador
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
          {colaboradores.length === 0 ? (
            <p className="text-ink-subtle col-span-full text-center py-8">Nenhum colaborador encontrado</p>
          ) : (
            colaboradores.map((c) => (
              <Link
                key={c.id}
                href={`/colaboradores/${c.id}/editar`}
                className="flex items-start gap-4 p-4 bg-white border border-surface-border rounded-xl hover:border-primary-300 hover:shadow-card-hover transition-all"
              >
                <AvatarTecnico nome={c.nome} fotoUrl={c.avatar} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-ink truncate">{c.nome}</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${BADGE_STATUS[c.statusColaborador] ?? ""}`}>{LABEL_STATUS[c.statusColaborador] ?? c.statusColaborador}</span>
                  </div>
                  <p className="text-xs text-ink-muted">{c.cargo?.nome ?? LABEL_TIPO[c.tipo] ?? c.tipo}</p>
                  <p className="text-xs text-ink-subtle mt-1">{formatarCpfCnpj(c.cpf)} · {formatarTelefone(c.telefone)}</p>
                  {c.especialidades.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {c.especialidades.slice(0, 2).map((esp) => (
                        <span key={esp} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">{esp}</span>
                      ))}
                      {c.especialidades.length > 2 && <span className="text-xs text-ink-subtle">+{c.especialidades.length - 2}</span>}
                    </div>
                  )}
                  <p className="text-xs text-ink-subtle mt-2 pt-2 border-t border-surface-border">
                    {c._count.atividadesOs} atividades realizadas
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
