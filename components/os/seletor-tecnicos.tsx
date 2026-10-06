"use client";

import { useMemo } from "react";
import { AlertTriangle, Crown, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { TECNICO } from "@/components/cadastro-rapido/definicoes";

export interface TecnicoOpcao { id: string; nome: string; competencias?: { id: string }[] }
export interface EquipeOpcao { id: string; nome: string; cor: string; liderId: string | null; membroIds: string[] }
export interface ValorTecnicos { tecnicoIds: string[]; responsavelId: string | null; equipeId: string | null }

export const VALOR_TECNICOS_VAZIO: ValorTecnicos = { tecnicoIds: [], responsavelId: null, equipeId: null };

/** Valor inicial a partir de uma atividade já salva (responsável + demais + equipe). */
export function valorDaAtividade(a: any): ValorTecnicos {
  const resp = a?.tecnico?.id ?? a?.tecnicoId ?? null;
  const outros = (a?.tecnicosEquipe ?? []).map((t: any) => t.tecnico?.id ?? t.tecnicoId).filter(Boolean);
  return { tecnicoIds: [resp, ...outros].filter(Boolean), responsavelId: resp, equipeId: a?.equipe?.id ?? a?.equipeId ?? null };
}

/** Corpo para a API (POST/PUT da atividade). */
export function corpoTecnicos(v: ValorTecnicos) {
  return { tecnicoIds: v.tecnicoIds, responsavelId: v.responsavelId, equipeId: v.equipeId };
}

/**
 * Técnicos da atividade: escolher uma EQUIPE (preenche os membros, com o líder como
 * responsável) e/ou adicionar técnicos um a um — com o cadastro rápido (#9/#10).
 * Respeita a competência: com tipo de OS, só entra quem tem competência nele.
 */
export function SeletorTecnicos({ tecnicos, equipes, tipoOsId, valor, onChange, carregando, onTecnicoCriado }: {
  tecnicos: TecnicoOpcao[];
  equipes: EquipeOpcao[];
  tipoOsId: string;
  valor: ValorTecnicos;
  onChange: (v: ValorTecnicos) => void;
  carregando?: boolean;
  onTecnicoCriado?: (t: TecnicoOpcao) => void;
}) {
  const porId = useMemo(() => new Map(tecnicos.map((t) => [t.id, t])), [tecnicos]);
  const temCompetencia = (id: string) => !tipoOsId || (porId.get(id)?.competencias ?? []).some((c) => c.id === tipoOsId);
  const equipeSel = equipes.find((e) => e.id === valor.equipeId) ?? null;

  function usarEquipe(id: string) {
    if (!id) { onChange({ ...valor, equipeId: null }); return; }
    const eq = equipes.find((e) => e.id === id);
    if (!eq) return;
    const todos = [...new Set([eq.liderId, ...eq.membroIds].filter(Boolean) as string[])].filter((m) => porId.has(m));
    const aptos = todos.filter(temCompetencia);
    const resp = eq.liderId && aptos.includes(eq.liderId) ? eq.liderId : aptos[0] ?? null;
    onChange({ tecnicoIds: aptos, responsavelId: resp, equipeId: eq.id });
  }
  function adicionar(id: string) {
    if (!id || valor.tecnicoIds.includes(id)) return;
    onChange({ ...valor, tecnicoIds: [...valor.tecnicoIds, id], responsavelId: valor.responsavelId ?? id });
  }
  function remover(id: string) {
    const ids = valor.tecnicoIds.filter((t) => t !== id);
    onChange({ ...valor, tecnicoIds: ids, responsavelId: valor.responsavelId === id ? ids[0] ?? null : valor.responsavelId });
  }

  // Membros da equipe escolhida que ficaram de fora por falta de competência
  const foraDaEquipe = equipeSel
    ? [...new Set([equipeSel.liderId, ...equipeSel.membroIds].filter(Boolean) as string[])].filter((m) => porId.has(m) && !temCompetencia(m) && !valor.tecnicoIds.includes(m))
    : [];
  const semCompetencia = valor.tecnicoIds.filter((id) => !temCompetencia(id));
  const opcoesAdicionar = tecnicos.filter((t) => !valor.tecnicoIds.includes(t.id) && temCompetencia(t.id)).map((t) => ({ value: t.id, label: t.nome }));

  return (
    <div className="space-y-2.5" data-seletor-tecnicos>
      {equipes.length > 0 && (
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-ink-subtle shrink-0" />
          <select
            aria-label="Usar equipe" value={valor.equipeId ?? ""} onChange={(e) => usarEquipe(e.target.value)}
            className={cn("flex-1 min-w-0 bg-white border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500",
              valor.equipeId ? "border-primary-300 text-primary-700 bg-primary-50/40" : "border-surface-border text-ink")}
          >
            <option value="">Usar uma equipe… (opcional)</option>
            {equipes.map((e) => <option key={e.id} value={e.id}>{e.nome} ({e.membroIds.length + (e.liderId && !e.membroIds.includes(e.liderId) ? 1 : 0)})</option>)}
          </select>
        </div>
      )}

      {valor.tecnicoIds.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-tecnicos-escolhidos>
          {valor.tecnicoIds.map((id) => {
            const t = porId.get(id); const resp = valor.responsavelId === id; const apto = temCompetencia(id);
            return (
              <li key={id} data-tecnico-chip={id} data-responsavel={resp || undefined}
                className={cn("inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full border text-sm",
                  !apto ? "border-red-300 bg-red-50 text-red-700" : resp ? "border-amber-300 bg-amber-50 text-ink" : "border-surface-border bg-white text-ink")}>
                <AvatarTecnico nome={t?.nome ?? "?"} size={22} />
                <span className="max-w-[160px] truncate">{t?.nome ?? "Técnico"}</span>
                <button type="button" onClick={() => onChange({ ...valor, responsavelId: id })} title={resp ? "Responsável" : "Tornar responsável"}
                  aria-label={resp ? `${t?.nome} é o responsável` : `Tornar ${t?.nome} responsável`}
                  className={cn("p-0.5 rounded", resp ? "text-amber-600" : "text-ink-subtle hover:text-amber-600")}>
                  <Crown className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => remover(id)} title="Remover" aria-label={`Remover ${t?.nome}`} className="p-0.5 rounded text-ink-subtle hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
              </li>
            );
          })}
        </ul>
      )}

      <SelectCadastroRapido
        value="" onChange={adicionar} opcoes={opcoesAdicionar}
        entidade={TECNICO.entidade} contexto={tipoOsId ? "com competência neste tipo de OS" : undefined}
        placeholder={valor.tecnicoIds.length ? "Adicionar outro técnico…" : "Selecione o técnico"}
        carregando={carregando} campos={TECNICO.campos} campoBusca="nome" permissao={TECNICO.permissao} linkCadastroCompleto={TECNICO.link}
        criar={async (v) => {
          // Já habilita no tipo de OS da atividade (senão o filtro de competência o esconderia)
          const t = await TECNICO.criar(v, tipoOsId || undefined);
          onTecnicoCriado?.({ id: t.id, nome: t.nome, competencias: tipoOsId ? [{ id: tipoOsId }] : [] });
          return { value: t.id, label: t.nome };
        }}
      />

      <p className="text-[11px] text-ink-subtle">
        {valor.tecnicoIds.length > 1
          ? <>A <Crown className="inline w-3 h-3 text-amber-600" /> marca o responsável; todos os técnicos podem executar e concluir a atividade.</>
          : tipoOsId ? "Apenas colaboradores com competência neste tipo de OS." : "Escolha uma equipe ou um ou mais técnicos."}
      </p>
      {foraDaEquipe.length > 0 && (
        <p data-fora-equipe className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Ficaram de fora por não ter competência neste tipo de OS: {foraDaEquipe.map((id) => porId.get(id)?.nome).join(", ")}.
        </p>
      )}
      {semCompetencia.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Sem competência neste tipo de OS: {semCompetencia.map((id) => porId.get(id)?.nome).join(", ")}. Remova ou troque o tipo de OS.
        </p>
      )}
    </div>
  );
}
