"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Crown, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { SelectCadastroRapido, usePodeCriar } from "@/components/ui/select-cadastro-rapido";
import { TECNICO } from "@/components/cadastro-rapido/definicoes";
import { toast } from "@/components/ui/avisos";

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
export function SeletorTecnicos({ tecnicos, equipes, tipoOsId, valor, onChange, carregando, onTecnicoCriado, onCompetencia }: {
  tecnicos: TecnicoOpcao[];
  equipes: EquipeOpcao[];
  tipoOsId: string;
  valor: ValorTecnicos;
  onChange: (v: ValorTecnicos) => void;
  carregando?: boolean;
  onTecnicoCriado?: (t: TecnicoOpcao) => void;
  /** UX-8 (Y6): competência habilitada inline — o pai anota no estado para o técnico aparecer */
  onCompetencia?: (tecnicoId: string) => void;
}) {
  const podeGerenciar = usePodeCriar(TECNICO.permissao);
  const [habilitando, setHabilitando] = useState(false);

  async function habilitarCompetencia(tecnicoId: string) {
    if (!tecnicoId || !tipoOsId) return;
    setHabilitando(true);
    try {
      const r = await fetch(`/api/tecnicos/${tecnicoId}/competencias`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipoOsId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível habilitar a competência.", "erro"); return; }
      onCompetencia?.(tecnicoId);
      toast("Competência habilitada — o colaborador já aparece na lista.", "sucesso");
    } catch { toast("Erro de conexão.", "erro"); } finally { setHabilitando(false); }
  }
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
  // Quem não aparece por falta de competência no tipo de OS (para não parecer que "não há técnicos")
  const ocultosCompetencia = tipoOsId ? tecnicos.filter((t) => !temCompetencia(t.id) && !valor.tecnicoIds.includes(t.id)).length : 0;

  return (
    <div className="space-y-2.5" data-seletor-tecnicos>
      {equipes.length > 0 && (
        <SeletorEquipe
          equipes={equipes} nomeDe={(id) => porId.get(id)?.nome} valor={valor.equipeId}
          placeholder={valor.tecnicoIds.length ? "Sem equipe (colaboradores avulsos)" : "Escolher uma equipe…"}
          semEquipe={valor.tecnicoIds.length ? "Sem equipe (colaboradores avulsos)" : "Nenhuma equipe"}
          onChange={usarEquipe}
        />
      )}

      {valor.tecnicoIds.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-tecnicos-escolhidos>
          {valor.tecnicoIds.map((id) => {
            const t = porId.get(id); const resp = valor.responsavelId === id; const apto = temCompetencia(id);
            return (
              <li key={id} data-tecnico-chip={id} data-responsavel={resp || undefined}
                className={cn("inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full border text-sm",
                  !apto ? "border-atrasado/40 bg-atrasado-claro text-atrasado-texto" : resp ? "border-atencao/40 bg-atencao-claro text-ink" : "border-surface-border bg-white text-ink")}>
                <AvatarTecnico nome={t?.nome ?? "?"} size={22} />
                <span className="max-w-[160px] truncate">{t?.nome ?? "Técnico"}</span>
                <button type="button" onClick={() => onChange({ ...valor, responsavelId: id })} title={resp ? "Responsável" : "Tornar responsável"}
                  aria-label={resp ? `${t?.nome} é o responsável` : `Tornar ${t?.nome} responsável`}
                  className={cn("p-0.5 rounded", resp ? "text-atencao" : "text-ink-subtle hover:text-atencao")}>
                  <Crown className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => remover(id)} title="Remover" aria-label={`Remover ${t?.nome}`} className="p-0.5 rounded text-ink-subtle hover:text-atrasado"><X className="w-3.5 h-3.5" /></button>
              </li>
            );
          })}
        </ul>
      )}

      <SelectCadastroRapido
        value="" onChange={adicionar} opcoes={opcoesAdicionar} icone={<UserPlus className="w-4 h-4" />}
        entidade={TECNICO.entidade} contexto={tipoOsId ? "com competência neste tipo de OS" : undefined}
        placeholder={valor.tecnicoIds.length ? "Adicionar outro colaborador…" : equipes.length ? "…ou escolha colaboradores" : "Selecione o colaborador"}
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
          ? <>A <Crown className="inline w-3 h-3 text-atencao" /> marca o responsável; todos podem executar e concluir a atividade.</>
          : tipoOsId ? "Apenas colaboradores com competência neste tipo de OS." : "Obrigatório: escolha uma equipe ou um ou mais colaboradores."}
      </p>
      {ocultosCompetencia > 0 && (
        <div data-ocultos-competencia className="text-[11px] text-ink-muted space-y-1.5">
          <p>
            {ocultosCompetencia} colaborador{ocultosCompetencia > 1 ? "es" : ""} sem competência neste tipo de OS não aparece{ocultosCompetencia > 1 ? "m" : ""} na lista —
            habilite em <a href="/colaboradores" target="_blank" rel="noreferrer" className="font-semibold text-primary-600 hover:underline">Colaboradores › Competências</a> ou deixe o tipo de OS em branco.
          </p>
          {/* Y6: saída INLINE — habilita a competência sem abandonar o formulário (quem pode gerenciar colaboradores) */}
          {podeGerenciar && onCompetencia && (
            <select
              aria-label="Habilitar competência neste tipo de OS" data-habilitar-competencia value="" disabled={habilitando}
              onChange={(e) => void habilitarCompetencia(e.target.value)}
              className="w-full bg-white border border-dashed border-primary-300 text-primary-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none disabled:opacity-60"
            >
              <option value="">{habilitando ? "Habilitando…" : "＋ Habilitar a competência num colaborador…"}</option>
              {tecnicos.filter((t) => !temCompetencia(t.id) && !valor.tecnicoIds.includes(t.id)).map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {foraDaEquipe.length > 0 && (
        <p data-fora-equipe className="flex items-start gap-1.5 text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Ficaram de fora por não ter competência neste tipo de OS: {foraDaEquipe.map((id) => porId.get(id)?.nome).join(", ")}.
        </p>
      )}
      {semCompetencia.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Sem competência neste tipo de OS: {semCompetencia.map((id) => porId.get(id)?.nome).join(", ")}. Remova ou troque o tipo de OS.
        </p>
      )}
    </div>
  );
}

/** Líder primeiro, depois os demais (sem repetir), só quem está na lista de colaboradores. */
export function integrantesDaEquipe(e: EquipeOpcao, nomeDe: (id: string) => string | undefined): string[] {
  return [...new Set([e.liderId, ...e.membroIds].filter(Boolean) as string[])]
    .map((id) => nomeDe(id)).filter((n): n is string => !!n);
}

/**
 * Escolha da equipe: cada opção mostra o nome e, discretos embaixo (menor, cinza), os integrantes —
 * para escolher sem precisar lembrar quem está em cada equipe. Lista acessível (listbox): setas,
 * Home/End, Enter/Espaço escolhem, Esc fecha e devolve o foco ao botão.
 */
function SeletorEquipe({ equipes, nomeDe, valor, placeholder, semEquipe, onChange }: {
  equipes: EquipeOpcao[];
  nomeDe: (id: string) => string | undefined;
  valor: string | null;
  /** Texto do botão sem equipe escolhida. */
  placeholder: string;
  /** Rótulo da opção que tira a equipe. */
  semEquipe: string;
  onChange: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const idLista = useId();
  // Índice 0 = "sem equipe"; 1..n = equipes
  const opcoes = useMemo(() => [{ id: "", nome: semEquipe, integrantes: [] as string[], cor: null as string | null },
    ...equipes.map((e) => ({ id: e.id, nome: e.nome, integrantes: integrantesDaEquipe(e, nomeDe), cor: e.cor }))], [equipes, nomeDe, semEquipe]);
  const sel = opcoes.find((o) => o.id && o.id === valor) ?? null;

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", fora);
    listaRef.current?.focus();
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  useEffect(() => {
    if (aberto) listaRef.current?.querySelector(`[data-indice="${ativo}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [aberto, ativo]);

  function abrir() {
    setAtivo(Math.max(0, opcoes.findIndex((o) => o.id === (valor ?? ""))));
    setAberto(true);
  }
  function escolher(i: number) {
    onChange(opcoes[i].id);
    setAberto(false);
    botaoRef.current?.focus();
  }
  function teclas(e: React.KeyboardEvent) {
    const ultimo = opcoes.length - 1;
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(ultimo, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setAtivo(0); }
    else if (e.key === "End") { e.preventDefault(); setAtivo(ultimo); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); escolher(ativo); }
    else if (e.key === "Escape" || e.key === "Tab") { setAberto(false); if (e.key === "Escape") { e.preventDefault(); botaoRef.current?.focus(); } }
  }

  return (
    <div ref={ref} className="relative" data-seletor-equipe>
      <button
        ref={botaoRef} type="button" aria-label="Usar equipe" aria-haspopup="listbox" aria-expanded={aberto} aria-controls={aberto ? idLista : undefined}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        onKeyDown={(e) => { if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !aberto) { e.preventDefault(); abrir(); } }}
        className={cn("w-full flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2.5 text-sm text-left transition-all",
          "focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10",
          sel ? "border-primary-300 bg-primary-50/40" : "border-surface-border")}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          {sel ? (
            <span className="truncate text-ink" data-equipe-escolhida>
              {sel.nome}<span className="text-ink-muted"> · {sel.integrantes.length} {sel.integrantes.length === 1 ? "integrante" : "integrantes"}</span>
            </span>
          ) : <span className="truncate text-ink-subtle">{placeholder}</span>}
        </span>
        <ChevronDown className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden="true" />
      </button>

      {aberto && (
        <ul
          ref={listaRef} id={idLista} role="listbox" aria-label="Equipes" tabIndex={-1}
          aria-activedescendant={`${idLista}-${ativo}`} onKeyDown={teclas}
          className="absolute z-40 left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-white border border-surface-border rounded-lg shadow-card-hover py-1 focus:outline-none"
        >
          {opcoes.map((o, i) => {
            const escolhida = (valor ?? "") === o.id;
            return (
              <li
                key={o.id || "sem-equipe"} id={`${idLista}-${i}`} role="option" aria-selected={escolhida} data-indice={i}
                data-opcao-equipe={o.id || "sem-equipe"}
                onMouseEnter={() => setAtivo(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(i)}
                className={cn("flex items-start gap-2 px-3 py-2 cursor-pointer text-sm",
                  i === ativo && "bg-primary-50", escolhida ? "text-primary-700 font-medium" : "text-ink")}
              >
                {o.cor ? <span className="w-2 h-2 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: o.cor }} aria-hidden="true" />
                  : <span className="w-2 shrink-0" aria-hidden="true" />}
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{o.nome}</span>
                  {o.integrantes.length > 0 && (
                    <span className="block truncate text-xs font-normal text-ink-muted" data-integrantes title={o.integrantes.join(", ")}>
                      {o.integrantes.join(", ")}
                    </span>
                  )}
                </span>
                {escolhida && <Check className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
