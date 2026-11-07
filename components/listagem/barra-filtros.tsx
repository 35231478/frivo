"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEBOUNCE_BUSCA_MS } from "@/components/listagem/use-listagem-url";

type Navegar = (m: Record<string, string | null>) => void;

/** Um filtro do menu "Mais filtros": o nome, os parâmetros da URL que ele controla e o controle */
export interface FiltroDef {
  id: string;
  label: string;
  params: string[];
  render: () => ReactNode;
  /** Ocupa a linha toda (chips de status, por exemplo) */
  largo?: boolean;
}

/**
 * A barra enxuta das telas de lista (padrão da casa, estilo Conta Azul):
 *   Vencimento                 Pesquisar no período selecionado
 *   [‹ | Novembro de 2026 ⌄ | ›]   [Pesquisar…]   [Mais filtros ⌄] [extras]
 *   Limpar filtros
 *   [os filtros escolhidos, cada um com o rótulo em cima e um × para tirar]
 * "Mais filtros" abre a LISTA DOS NOMES dos filtros; escolher um faz o campo dele aparecer embaixo.
 * Um filtro com valor na URL aparece sozinho (já marcado). "Limpar filtros" zera todos e a busca; o
 * período fica (é navegação, não filtro). No celular tudo empilha.
 */
export function BarraFiltros({ periodo, busca, filtros = [], paramBusca = "q", navegar, extras, className }: {
  /** O seletor de período (BarraPeriodo) — opcional nas listas sem período */
  periodo?: ReactNode;
  /** O campo de busca (BuscaUrl / CampoBusca) */
  busca: ReactNode;
  /** Os filtros do menu "Mais filtros" */
  filtros?: FiltroDef[];
  /** O parâmetro da busca ("q", "busca", "fornecedor"…), limpo junto */
  paramBusca?: string;
  navegar: Navegar;
  /** Botões à direita (Exportar, alternar visão…) */
  extras?: ReactNode;
  className?: string;
}) {
  const sp = useSearchParams();
  const [menu, setMenu] = useState(false);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  const ativo = (f: FiltroDef) => f.params.some((k) => (sp.get(k) ?? "") !== "");
  const ativos = filtros.filter(ativo).length;
  const temBusca = (sp.get(paramBusca) ?? "") !== "";
  // Visíveis: os com valor na URL + os escolhidos no menu (na ordem do menu)
  const visiveis = filtros.filter((f) => ativo(f) || escolhidos.includes(f.id));
  const escolher = (f: FiltroDef) => {
    setMenu(false);
    setEscolhidos((e) => [...e, f.id]); // repetido não duplica na tela: `visiveis` filtra pela lista dos filtros
  };
  const tirar = (f: FiltroDef) => {
    setEscolhidos((e) => e.filter((id) => id !== f.id));
    if (ativo(f)) navegar(Object.fromEntries(f.params.map((k) => [k, null])));
  };
  const limpar = () => {
    setEscolhidos([]);
    navegar(Object.fromEntries([...filtros.flatMap((f) => f.params), paramBusca].map((k) => [k, null])));
  };

  return (
    <div className={cn("card p-3 sm:p-4", className)} data-barra-filtros>
      {/* Linha 1: período · busca · Mais filtros · extras (cada um com o rótulo em cima) */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        {periodo}
        <label className="flex-1 min-w-0 sm:min-w-[240px] flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">{periodo ? "Pesquisar no período selecionado" : "Pesquisar"}</span>
          {busca}
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          {filtros.length > 0 && (
            <div ref={ref} className="relative">
              <button
                type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} data-mais-filtros
                className={cn("inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold border transition-colors",
                  menu || ativos ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-primary-700 hover:bg-primary-50")}
              >
                Mais filtros
                {ativos > 0 && <span className="text-[10px] font-bold bg-primary-500 text-white rounded-full min-w-4 h-4 px-1 flex items-center justify-center" data-filtros-ativos>{ativos}</span>}
                <ChevronDown className={cn("w-4 h-4 transition-transform", menu && "rotate-180")} aria-hidden />
              </button>
              {menu && (
                <ul role="menu" aria-label="Mais filtros" className="absolute z-40 left-0 sm:left-auto sm:right-0 mt-1 w-64 max-h-[70vh] overflow-y-auto bg-white border border-surface-border rounded-lg shadow-elevated py-1" data-menu-filtros>
                  {filtros.map((f) => {
                    const v = visiveis.includes(f);
                    return (
                      <li key={f.id} role="none">
                        <button type="button" role="menuitem" onClick={() => escolher(f)} data-filtro-opcao={f.id}
                          className={cn("w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left hover:bg-surface-alt", v ? "text-primary-700 font-semibold" : "text-ink")}>
                          {f.label}
                          {v && <Check className="w-4 h-4 shrink-0" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {extras}
        </div>
      </div>
      {/* Linha 2: Limpar filtros (zera os filtros e a busca; o período fica) */}
      <div className="mt-2">
        <button
          type="button" onClick={limpar} disabled={!ativos && !temBusca && !escolhidos.length} data-limpar-filtros
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          <Trash2 className="w-4 h-4" aria-hidden /> Limpar filtros
        </button>
      </div>
      {/* Os filtros escolhidos (e os que já têm valor), cada um com rótulo e × */}
      {visiveis.length > 0 && (
        <div className="mt-3 pt-3 border-t border-surface-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-painel-filtros>
          {visiveis.map((f) => (
            <div key={f.id} className={cn("flex flex-col gap-1 min-w-0", f.largo && "sm:col-span-2 lg:col-span-4")} data-filtro-caixa={f.id} data-filtro-ativo={ativo(f) || undefined}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-muted">{f.label}</span>
                <button type="button" onClick={() => tirar(f)} aria-label={`Tirar o filtro ${f.label}`} title="Tirar este filtro" data-fechar-filtro={f.id}
                  className="text-ink-subtle hover:text-ink rounded p-0.5"><X className="w-3.5 h-3.5" /></button>
              </div>
              {f.render()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const INPUT_FILTRO = "w-full bg-white border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-primary-500";
/** O controle ativo (com valor na URL) se destaca */
export const inputFiltro = (ativo: unknown) => cn(INPUT_FILTRO, ativo ? "border-primary-300 text-primary-700 bg-primary-50/50" : "");

/** Texto ou número livre que vai para a URL com atraso (sem Enter) — "Banco", "Valor de", "Número da OS"… */
export function FiltroTextoUrl({ param, navegar, placeholder, tipo = "text", rotulo }: {
  param: string; navegar: Navegar; placeholder?: string; tipo?: "text" | "number"; rotulo?: string;
}) {
  const sp = useSearchParams();
  const naUrl = sp.get(param) ?? "";
  const [valor, setValor] = useState(naUrl);
  useEffect(() => { setValor(naUrl); }, [naUrl]);
  useEffect(() => {
    if (valor.trim() === naUrl) return;
    const t = setTimeout(() => navegar({ [param]: valor.trim() || null }), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <input
      type={tipo} value={valor} onChange={(e) => setValor(e.target.value)} placeholder={placeholder} aria-label={rotulo ?? placeholder} data-filtro={param}
      className={inputFiltro(naUrl)}
    />
  );
}
