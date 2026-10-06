"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Rows3, Search, X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TAMANHOS_PAGINA } from "@/lib/listagem";
import type { Visao } from "@/components/listagem/use-listagem-url";

/**
 * Peças visuais comuns às listagens (Equipamentos, Veículos…), para as telas
 * ficarem com a mesma cara: chips de resumo, filtros, cabeçalho ordenável,
 * alternância lista/cards e paginação.
 */

export type Opcao = { value: string; label: string };

/** Atalho de filtro com contador ("12 Ativos", "3 Documento vencendo"). */
export function ChipResumo({ ativo, onClick, icone: Icone, cor, rotulo, valor, id }: {
  ativo: boolean; onClick: () => void; icone: LucideIcon; cor: string; rotulo: string; valor: number; id?: string;
}) {
  return (
    <button
      onClick={onClick} data-chip={id} aria-pressed={ativo}
      className={cn(
        "shrink-0 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
        ativo ? "bg-primary-50 border-primary-300" : "bg-white border-surface-border hover:border-primary-200",
      )}
    >
      <Icone className={cn("w-4 h-4", cor)} />
      <span className="font-semibold text-ink tabular-nums">{valor.toLocaleString("pt-BR")}</span>
      <span className="text-ink-muted">{rotulo}</span>
    </button>
  );
}

export function SelectFiltro({ valor, onChange, vazio, opcoes, rotulo }: { valor: string; onChange: (v: string) => void; vazio: string; opcoes: Opcao[]; rotulo?: string }) {
  return (
    <select
      value={valor} onChange={(e) => onChange(e.target.value)} aria-label={rotulo ?? vazio}
      className={cn(
        "bg-white border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary-500 max-w-[200px]",
        valor ? "border-primary-300 text-primary-700 bg-primary-50/50" : "border-surface-border text-ink",
      )}
    >
      <option value="">{vazio}</option>
      {opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Seleção múltipla em lista suspensa (ex.: tipos). `icone` desenha o ícone de cada opção. */
export function MultiSelect({ titulo, opcoes, selecionados, onChange, icone }: {
  titulo: string; opcoes: Opcao[]; selecionados: string[]; onChange: (v: string[]) => void;
  icone?: (value: string) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  function toggle(id: string) {
    onChange(selecionados.includes(id) ? selecionados.filter((s) => s !== id) : [...selecionados, id]);
  }
  return (
    <div ref={ref} className="relative" data-multiselect={titulo}>
      <button
        type="button" onClick={() => setAberto((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 bg-white border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none",
          selecionados.length ? "border-primary-300 text-primary-700 bg-primary-50/50" : "border-surface-border text-ink",
        )}
      >
        {selecionados.length === 0 ? `${titulo}: todos` : `${titulo} (${selecionados.length})`}
        <ChevronDown className="w-3.5 h-3.5 text-ink-muted" />
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-64 bg-white border border-surface-border rounded-lg shadow-lg max-h-72 overflow-y-auto py-1">
          {opcoes.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-alt cursor-pointer text-sm">
              <input type="checkbox" checked={selecionados.includes(o.value)} onChange={() => toggle(o.value)} className="accent-primary-600" />
              {icone?.(o.value)}
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cabeçalho de coluna ordenável (asc/desc). */
export function ThOrd<K extends string>({ label, k, ordem, dir, onOrdenar, className }: {
  label: string; k: K; ordem: K; dir: "asc" | "desc"; onOrdenar: (k: K) => void; className?: string;
}) {
  const ativo = ordem === k;
  return (
    <th className={cn("text-left px-3 py-2.5 font-semibold whitespace-nowrap", className)}>
      <button onClick={() => onOrdenar(k)} className={cn("inline-flex items-center gap-1 hover:text-ink transition-colors uppercase", ativo && "text-ink")}>
        {label}
        {ativo ? (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}

/** Alternância Lista ↔ Cards (desktop; no celular a lista compacta é sempre usada). */
export function AlternarVisao({ visao, onTrocar }: { visao: Visao; onTrocar: (v: Visao) => void }) {
  return (
    <div className="hidden md:flex items-center bg-surface-alt border border-surface-border rounded-lg p-0.5" data-alternar-visao>
      <button onClick={() => onTrocar("lista")} title="Lista" aria-pressed={visao === "lista"} className={cn("p-1.5 rounded-md transition-colors", visao === "lista" ? "bg-white text-primary-600 shadow-sm" : "text-ink-muted hover:text-ink")}>
        <Rows3 className="w-4 h-4" />
      </button>
      <button onClick={() => onTrocar("cards")} title="Cards" aria-pressed={visao === "cards"} className={cn("p-1.5 rounded-md transition-colors", visao === "cards" ? "bg-white text-primary-600 shadow-sm" : "text-ink-muted hover:text-ink")}>
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
}

/** Campo de busca com ícone e botão de limpar. */
export function CampoBusca({ valor, onChange, placeholder, rotulo }: { valor: string; onChange: (v: string) => void; placeholder: string; rotulo?: string }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
      <input
        value={valor} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={rotulo ?? placeholder}
        className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-9 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
      />
      {valor && (
        <button onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink" title="Limpar busca">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/** "1–50 de 1.234" + itens por página + anterior/próxima (a página fica na URL). */
export function Paginacao({ total, pagina, porPagina, onNavegar }: {
  total: number; pagina: number; porPagina: number;
  onNavegar: (mudancas: Record<string, string | null>, manterPagina?: boolean) => void;
}) {
  if (total <= 0) return null;
  const inicio = (pagina - 1) * porPagina + 1;
  const fim = Math.min(total, pagina * porPagina);
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-sm" data-paginacao>
      <p className="text-ink-muted">
        <span className="font-medium text-ink">{inicio.toLocaleString("pt-BR")}–{fim.toLocaleString("pt-BR")}</span> de {total.toLocaleString("pt-BR")}
      </p>
      <div className="flex items-center gap-2">
        <select
          value={porPagina} onChange={(e) => onNavegar({ por: e.target.value === "50" ? null : e.target.value })}
          className="bg-white border border-surface-border rounded-lg px-2 py-1.5 text-sm text-ink focus:outline-none focus:border-primary-500"
          title="Itens por página"
        >
          {TAMANHOS_PAGINA.map((n) => <option key={n} value={n}>{n} / pág.</option>)}
        </select>
        <button
          disabled={pagina <= 1} onClick={() => onNavegar({ pagina: String(pagina - 1) }, true)}
          className="p-2 rounded-lg border border-surface-border bg-white text-ink-muted hover:text-primary-600 disabled:opacity-40 disabled:pointer-events-none" title="Anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-ink-muted tabular-nums">{pagina} / {totalPaginas}</span>
        <button
          disabled={pagina >= totalPaginas} onClick={() => onNavegar({ pagina: String(pagina + 1) }, true)}
          className="p-2 rounded-lg border border-surface-border bg-white text-ink-muted hover:text-primary-600 disabled:opacity-40 disabled:pointer-events-none" title="Próxima"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
