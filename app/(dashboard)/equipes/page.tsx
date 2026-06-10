import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import Link from "next/link";
import { UsersRound, Plus, Truck, Crown } from "lucide-react";

export const metadata: Metadata = { title: "Equipes" };

export default async function EquipesPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const equipes = await prisma.equipe.findMany({
    where: { empresaId },
    include: {
      lider: { select: { id: true, nome: true, avatar: true } },
      membros: { select: { id: true, nome: true, avatar: true } },
      veiculos: { select: { id: true, placa: true } },
    },
    orderBy: { nome: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><UsersRound className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Equipes</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{equipes.length}</span>
        </div>
        <Link href="/equipes/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
          <Plus className="w-4 h-4" /> Nova Equipe
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {equipes.length === 0 ? (
          <p className="text-ink-subtle col-span-full text-center py-12">Nenhuma equipe cadastrada.</p>
        ) : (
          equipes.map((e) => (
            <Link key={e.id} href={`/equipes/${e.id}/editar`} className="bg-white border border-surface-border rounded-xl p-4 hover:border-primary-300 hover:shadow-card-hover transition-all">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: e.cor }} />
                  <span className="font-semibold text-ink truncate">{e.nome}</span>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${e.status === "ATIVA" ? "bg-success-50 text-success-700" : "bg-surface-alt text-ink-muted"}`}>
                  {e.status === "ATIVA" ? "Ativa" : "Inativa"}
                </span>
              </div>

              {e.lider && (
                <div className="flex items-center gap-2 mt-3">
                  <AvatarTecnico nome={e.lider.nome} fotoUrl={e.lider.avatar} size={28} />
                  <div className="min-w-0">
                    <p className="text-xs text-ink-muted flex items-center gap-1"><Crown className="w-3 h-3 text-amber-500" /> Líder</p>
                    <p className="text-sm text-ink truncate">{e.lider.nome}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-surface-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted">{e.membros.length} membro(s)</span>
                  <AvatarStack tecnicos={e.membros.map((m) => ({ id: m.id, nome: m.nome, avatar: m.avatar }))} size={26} />
                </div>
                {e.veiculos[0] && (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Truck className="w-3.5 h-3.5" />{e.veiculos[0].placa}</span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
