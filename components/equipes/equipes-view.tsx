"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { CampoBusca, ListaVazia, Paginacao, SelectFiltro, sugerirPorUrl } from "@/components/listagem/listagem-ui";
import { cn } from "@/lib/utils";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { UsersRound, Plus, Truck, Crown, HardHat, Building2, LayoutDashboard } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { InativarRegistro } from "@/components/ui/inativar-registro";

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

export function EquipesView({ aba, q, grupos, colaboradores, perfis, contagens, total, pagina, porPagina }: {
  aba: Aba; q: string; grupos: Grupo[]; colaboradores: Colaborador[]; perfis: { nome: string; cor: string }[];
  contagens: Record<Aba, number>; total: number; pagina: number; porPagina: number;
}) {
  const { pode } = usePermissoes();
  const podeGerenciar = pode("equipes", "gerenciar");
  const router = useRouter();
  const sp = useSearchParams();
  const { busca, setBusca, navegar, pendente } = useListagemUrl({ chave: "equipes", qAtual: q, lembrarFiltros: false });
  const sugerir = useMemo(() => sugerirPorUrl(aba === "grupos" ? "/api/listas/sugestoes?lista=equipes" : "/api/listas/sugestoes?lista=colaboradores"), [aba]);
  const ordem = sp.get("ordem") ?? "nome";
  const dir = sp.get("dir") === "desc" ? "desc" : "asc";

  const ABAS: { id: Aba; label: string; icone: any }[] = [
    { id: "grupos", label: "Grupos de Equipe", icone: UsersRound },
    { id: "campo", label: "Equipe de Campo", icone: HardHat },
    { id: "administrativa", label: "Equipe Administrativa", icone: Building2 },
  ];
  const opcoesOrdem = aba === "grupos"
    ? [["nome:asc", "Nome (A–Z)"], ["nome:desc", "Nome (Z–A)"], ["membros:desc", "Mais membros"], ["membros:asc", "Menos membros"]]
    : [["nome:asc", "Nome (A–Z)"], ["nome:desc", "Nome (Z–A)"], ["cargo:asc", "Cargo (A–Z)"], ["cargo:desc", "Cargo (Z–A)"]];
  const vazio = aba === "grupos" ? "Nenhuma equipe encontrada" : "Nenhum colaborador encontrado";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><UsersRound className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Equipes</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/equipes/montador" data-abrir-montador className="inline-flex items-center gap-2 border border-primary-300 text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all">
            <LayoutDashboard className="w-4 h-4" /> Montar equipes
          </Link>
          {aba === "grupos" && podeGerenciar && (
            <Link href="/equipes/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
              <Plus className="w-4 h-4" /> Nova Equipe
            </Link>
          )}
        </div>
      </div>

      {/* Abas (os números já consideram a busca) */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-surface-border">
        {ABAS.map((t) => {
          const ativa = aba === t.id;
          return (
            <button key={t.id} type="button" onClick={() => navegar({ aba: t.id === "grupos" ? null : t.id, ordem: null, dir: null, perfil: null })} data-aba={t.id}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                ativa ? "border-primary-500 text-primary-600" : "border-transparent text-ink-muted hover:text-ink",
              )}>
              <t.icone className="w-4 h-4" />
              {t.label}
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums", ativa ? "bg-primary-100 text-primary-700" : "bg-surface-alt text-ink-muted")}>{contagens[t.id]}</span>
            </button>
          );
        })}
      </div>

      {/* Busca ao vivo + filtros + ordem */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px] sm:max-w-md">
          <CampoBusca
            valor={busca} onChange={setBusca} carregando={pendente} sugerir={sugerir}
            onEscolher={(s) => (s.href ? router.push(s.href) : setBusca(s.rotulo))}
            placeholder={aba === "grupos" ? "Buscar equipe, líder ou membro…" : "Buscar colaborador ou cargo…"}
            rotulo={aba === "grupos" ? "Buscar equipes" : "Buscar colaboradores"}
          />
        </div>
        {aba !== "grupos" && perfis.length > 0 && (
          <SelectFiltro valor={sp.get("perfil") ?? ""} onChange={(v) => navegar({ perfil: v || null })} vazio="Todos os perfis" opcoes={perfis.map((p) => ({ value: p.nome, label: p.nome }))} />
        )}
        <select
          value={`${ordem}:${dir}`} aria-label="Ordenar" data-ordenar-equipes
          onChange={(e) => { const [o, d] = e.target.value.split(":"); navegar({ ordem: o === "nome" ? null : o, dir: d === "desc" ? "desc" : null }, true); }}
          className="bg-white border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-primary-500"
        >
          {opcoesOrdem.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {aba === "grupos" && (
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted select-none">
            <input type="checkbox" checked={sp.get("inativas") === "1"} onChange={(e) => navegar({ inativas: e.target.checked ? "1" : null })} className="accent-primary-600" aria-label="Mostrar inativas" />
            Mostrar inativas
          </label>
        )}
      </div>

      <div className={cn("space-y-4 transition-opacity", pendente && "opacity-60")} aria-busy={pendente}>
      {total === 0 && (
        <div className="bg-white border border-surface-border rounded-card">
          <ListaVazia mensagem={vazio} busca={q || undefined} onLimpar={() => setBusca("")} />
        </div>
      )}
      {aba === "grupos" && grupos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {grupos.map((e) => (
              <div key={e.id} data-card-id={e.id} className="relative">
              <Link href={`/equipes/${e.id}/editar`} className={cn("block h-full bg-white border border-surface-border rounded-card p-4 pb-10 hover:border-primary-300 hover:shadow-card-hover transition-all", e.status !== "ATIVA" && "opacity-70")}>
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
                      <p className="text-xs text-ink-muted flex items-center gap-1"><Crown className="w-3 h-3 text-atencao-texto" /> Líder</p>
                      <p className="text-sm text-ink truncate">{e.lider.nome}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-surface-border">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted">{e.membros.length} membro(s)</span>
                    <AvatarStack tecnicos={e.membros.map((m) => ({ id: m.id, nome: m.nome, avatar: m.avatar }))} size={26} />
                  </div>
                  {e.veiculos.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Truck className="w-3.5 h-3.5" />{e.veiculos.map((v) => v.placa).join(", ")}</span>}
                </div>
              </Link>
              <div className="absolute bottom-2 right-2">
                <InativarRegistro url={`/api/equipes/${e.id}`} modulo="equipes" acaoReativar="gerenciar" ativo={e.status === "ATIVA"} nome={e.nome} entidade="equipe" feminino />
              </div>
              </div>
            ))}
          </div>
      )}

      {aba !== "grupos" && colaboradores.length > 0 && <ListaColaboradores lista={colaboradores} />}
      </div>
      <Paginacao total={total} pagina={pagina} porPagina={porPagina} rotulo={aba === "grupos" ? "equipes" : "colaboradores"} onNavegar={navegar} />
    </div>
  );
}

function ListaColaboradores({ lista }: { lista: Colaborador[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {lista.map((c) => (
        <Link key={c.id} href={`/colaboradores/${c.id}/editar`} className="flex items-center gap-3 p-4 bg-white border border-surface-border rounded-card hover:border-primary-300 hover:shadow-card-hover transition-all">
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
