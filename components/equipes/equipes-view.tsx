"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { UsersRound, Plus, Truck, Crown, HardHat, Building2 } from "lucide-react";

interface Membro { id: string; nome: string; avatar: string | null }
interface Grupo {
  id: string; nome: string; cor: string; status: string;
  lider: Membro | null; membros: Membro[]; veiculos: { id: string; placa: string }[];
}
interface Colaborador {
  id: string; nome: string; avatar: string | null; tipoEquipe: string;
  cargo: { nome: string } | null;
  perfilAcesso: { nome: string; cor: string } | null;
}

type Aba = "grupos" | "campo" | "administrativa";

export function EquipesView({ grupos, colaboradores }: { grupos: Grupo[]; colaboradores: Colaborador[] }) {
  const [aba, setAba] = useState<Aba>("grupos");
  const [perfilFiltro, setPerfilFiltro] = useState("");

  const perfis = Array.from(new Map(colaboradores.filter((c) => c.perfilAcesso).map((c) => [c.perfilAcesso!.nome, c.perfilAcesso!])).values());

  const campo = colaboradores.filter((c) => c.tipoEquipe === "CAMPO");
  const adm = colaboradores.filter((c) => c.tipoEquipe === "ADMINISTRATIVO");

  const ABAS: { id: Aba; label: string; icone: any; count: number }[] = [
    { id: "grupos", label: "Grupos de Equipe", icone: UsersRound, count: grupos.length },
    { id: "campo", label: "Equipe de Campo", icone: HardHat, count: campo.length },
    { id: "administrativa", label: "Equipe Administrativa", icone: Building2, count: adm.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><UsersRound className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Equipes</h1>
        </div>
        {aba === "grupos" && (
          <Link href="/equipes/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
            <Plus className="w-4 h-4" /> Nova Equipe
          </Link>
        )}
      </div>

      {/* Abas */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-surface-border">
        {ABAS.map((t) => {
          const ativa = aba === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setAba(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                ativa ? "border-primary-500 text-primary-600" : "border-transparent text-ink-muted hover:text-ink",
              )}>
              <t.icone className="w-4 h-4" />
              {t.label}
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", ativa ? "bg-primary-100 text-primary-700" : "bg-surface-alt text-ink-muted")}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* Filtro por perfil (abas de colaboradores) */}
      {aba !== "grupos" && perfis.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Perfil:</span>
          <select value={perfilFiltro} onChange={(e) => setPerfilFiltro(e.target.value)}
            className="bg-white border border-surface-border rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-primary-500">
            <option value="">Todos</option>
            {perfis.map((p) => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
          </select>
        </div>
      )}

      {aba === "grupos" && (
        grupos.length === 0 ? (
          <p className="text-ink-subtle text-center py-12">Nenhuma equipe cadastrada.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {grupos.map((e) => (
              <Link key={e.id} href={`/equipes/${e.id}/editar`} className="bg-white border border-surface-border rounded-xl p-4 hover:border-primary-300 hover:shadow-card-hover transition-all">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: e.cor }} />
                    <span className="font-semibold text-ink truncate">{e.nome}</span>
                  </div>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${e.status === "ATIVA" ? "bg-success-50 text-success-700" : "bg-surface-alt text-ink-muted"}`}>{e.status === "ATIVA" ? "Ativa" : "Inativa"}</span>
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
                  {e.veiculos[0] && <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Truck className="w-3.5 h-3.5" />{e.veiculos[0].placa}</span>}
                </div>
              </Link>
            ))}
          </div>
        )
      )}

      {aba !== "grupos" && (
        <ListaColaboradores
          lista={(aba === "campo" ? campo : adm).filter((c) => !perfilFiltro || c.perfilAcesso?.nome === perfilFiltro)}
        />
      )}
    </div>
  );
}

function ListaColaboradores({ lista }: { lista: Colaborador[] }) {
  if (lista.length === 0) return <p className="text-ink-subtle text-center py-12">Nenhum colaborador nesta equipe.</p>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {lista.map((c) => (
        <Link key={c.id} href={`/colaboradores/${c.id}/editar`} className="flex items-center gap-3 p-4 bg-white border border-surface-border rounded-xl hover:border-primary-300 hover:shadow-card-hover transition-all">
          <AvatarTecnico nome={c.nome} fotoUrl={c.avatar} size={44} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink truncate">{c.nome}</p>
            <p className="text-xs text-ink-muted truncate">{c.cargo?.nome ?? "—"}</p>
            {c.perfilAcesso && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1" style={{ backgroundColor: `${c.perfilAcesso.cor}1a`, color: c.perfilAcesso.cor }}>
                {c.perfilAcesso.nome}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
