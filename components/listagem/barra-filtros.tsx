"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEBOUNCE_BUSCA_MS } from "@/components/listagem/use-listagem-url";

type Navegar = (m: Record<string, string | null>) => void;

/**
 * A barra enxuta das telas de lista (padrão da casa, estilo Conta Azul), numa linha só:
 *   Período                 Pesquisar no período selecionado
 *   [‹ | Novembro de 2026 ⌄ | ›]   [Pesquisar…]   [Mais filtros ⌄] [extras]
 *   Limpar filtros
 * Os filtros extras (situação, cliente, categoria…) ficam recolhidos num painel — fechado por padrão,
 * para sobrar espaço — com o contador dos ativos no botão. "Limpar filtros" zera os filtros do painel
 * e a busca; o período fica (é navegação, não filtro). No celular tudo empilha.
 */
export function BarraFiltros({ periodo, busca, paramsFiltros, paramBusca = "q", navegar, extras, children, className }: {
  /** O seletor de período (BarraPeriodo) — opcional nas listas sem período */
  periodo?: ReactNode;
  /** O campo de busca (BuscaUrl / CampoBusca) */
  busca: ReactNode;
  /** Os parâmetros da URL que o painel controla (para contar os ativos e limpar) */
  paramsFiltros: string[];
  /** O parâmetro da busca ("q", "busca", "fornecedor"…), limpo junto */
  paramBusca?: string;
  navegar: Navegar;
  /** Botões à direita (Exportar, alternar visão…) */
  extras?: ReactNode;
  /** O conteúdo do painel "Mais filtros" (CampoFiltro…) */
  children?: ReactNode;
  className?: string;
}) {
  const sp = useSearchParams();
  const [aberto, setAberto] = useState(false);
  const ativos = paramsFiltros.filter((k) => (sp.get(k) ?? "") !== "").length;
  const temBusca = (sp.get(paramBusca) ?? "") !== "";
  const limpar = () => navegar(Object.fromEntries([...paramsFiltros, paramBusca].map((k) => [k, null])));
  return (
    <div className={cn("card p-3 sm:p-4", className)} data-barra-filtros>
      {/* Linha 1: período · busca · Mais filtros · extras (cada um com o rótulo em cima, como na referência) */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
        {periodo}
        <label className="flex-1 min-w-0 sm:min-w-[240px] flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Pesquisar no período selecionado</span>
          {busca}
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          {children && (
            <button
              type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls="painel-filtros" data-mais-filtros
              className={cn("inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold border transition-colors",
                aberto || ativos ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-surface-border text-primary-700 hover:bg-primary-50")}
            >
              Mais filtros
              {ativos > 0 && <span className="text-[10px] font-bold bg-primary-500 text-white rounded-full min-w-4 h-4 px-1 flex items-center justify-center" data-filtros-ativos>{ativos}</span>}
              <ChevronDown className={cn("w-4 h-4 transition-transform", aberto && "rotate-180")} aria-hidden />
            </button>
          )}
          {extras}
        </div>
      </div>
      {/* Linha 2: Limpar filtros (zera o painel e a busca; o período fica) */}
      <div className="mt-2">
        <button
          type="button" onClick={limpar} disabled={!ativos && !temBusca} data-limpar-filtros
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          <Trash2 className="w-4 h-4" aria-hidden /> Limpar filtros
        </button>
      </div>
      {aberto && children && (
        <div id="painel-filtros" className="mt-3 pt-3 border-t border-surface-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-painel-filtros>
          {children}
        </div>
      )}
    </div>
  );
}

/** Um filtro do painel: rótulo em cima, o controle embaixo (o controle já se destaca quando ativo) */
export function CampoFiltro({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 min-w-0", className)}>
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

export const INPUT_FILTRO = "w-full bg-white border border-surface-border rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-primary-500";

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
      className={cn(INPUT_FILTRO, naUrl && "border-primary-300 text-primary-700 bg-primary-50/50")}
    />
  );
}
