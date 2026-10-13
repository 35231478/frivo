"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Loader2, Rows3, Search, SearchX, X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAVE_TAMANHO_PAGINA, faixa, MAX_SUGESTOES, paginasVisiveis, TAMANHO_PADRAO, TAMANHOS_PAGINA, type Sugestao } from "@/lib/listagem";
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
  label: string; k: K; ordem: K | null | ""; dir: "asc" | "desc"; onOrdenar: (k: K) => void; className?: string;
}) {
  const ativo = ordem === k;
  return (
    <th className={cn("text-left px-3 py-2.5 font-semibold whitespace-nowrap", className)} aria-sort={ativo ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onOrdenar(k)} data-ordenar={k} className={cn("inline-flex items-center gap-1 hover:text-ink transition-colors uppercase", ativo && "text-ink")}>
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

/**
 * Campo de busca das listas: lupa, "x" para limpar, atalho "/" (desktop) e — se a tela passar
 * `sugerir` — uma sugestão compacta com as ~5 que mais combinam (não um dropdown gigante).
 * Escolher uma sugestão: `onEscolher` (abre o registro) ou, sem ele, aplica o nome como filtro.
 * Quem chama faz o debounce do filtro da lista; as sugestões têm o próprio debounce (300 ms).
 */
export function CampoBusca({ valor, onChange, placeholder, rotulo, sugerir, onEscolher, carregando, atalho = true }: {
  valor: string; onChange: (v: string) => void; placeholder: string; rotulo?: string;
  sugerir?: (q: string) => Promise<Sugestao[]>; onEscolher?: (s: Sugestao) => void; carregando?: boolean; atalho?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [focado, setFocado] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [destaque, setDestaque] = useState(-1);
  const digitou = useRef(false);

  // Atalho "/": foca a busca (fora de campos de texto)
  useEffect(() => {
    if (!atalho) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [atalho]);

  // Sugestões com debounce (só enquanto a pessoa digita; 2+ letras)
  useEffect(() => {
    if (!sugerir || !digitou.current) return;
    const q = valor.trim();
    if (q.length < 2) { setSugestoes([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      sugerir(q).then((r) => { if (vivo) { setSugestoes(r.slice(0, MAX_SUGESTOES)); setDestaque(-1); } }).catch(() => { if (vivo) setSugestoes([]); });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [valor, sugerir]);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (caixa.current && !caixa.current.contains(e.target as Node)) setFocado(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function escolher(sug: Sugestao) {
    digitou.current = false;
    setSugestoes([]); setFocado(false);
    if (onEscolher) onEscolher(sug); else onChange(sug.rotulo);
  }
  function limpar() { digitou.current = false; setSugestoes([]); onChange(""); ref.current?.focus(); }

  const aberto = focado && sugestoes.length > 0 && valor.trim().length >= 2;
  return (
    <div className="relative" ref={caixa} data-campo-busca>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
      <input
        ref={ref} type="search" value={valor} placeholder={placeholder} aria-label={rotulo ?? placeholder}
        role="combobox" aria-expanded={aberto} aria-autocomplete="list" autoComplete="off" data-busca
        onChange={(e) => { digitou.current = true; onChange(e.target.value); }}
        onFocus={() => setFocado(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setFocado(false); return; }
          if (!aberto) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setDestaque((i) => Math.min(i + 1, sugestoes.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setDestaque((i) => Math.max(i - 1, -1)); }
          else if (e.key === "Enter" && destaque >= 0) { e.preventDefault(); escolher(sugestoes[destaque]); }
        }}
        className="w-full bg-white border border-surface-border rounded-lg pl-9 pr-16 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        {carregando && <Loader2 className="w-3.5 h-3.5 text-ink-subtle animate-spin" aria-label="Buscando" />}
        {valor ? (
          <button type="button" onClick={limpar} className="text-ink-subtle hover:text-ink p-0.5" title="Limpar busca" aria-label="Limpar busca" data-limpar-busca>
            <X className="w-4 h-4" />
          </button>
        ) : atalho ? (
          <kbd className="hidden md:inline-block text-[10px] font-medium text-ink-subtle border border-surface-border rounded px-1.5 py-0.5" title="Atalho: / foca a busca">/</kbd>
        ) : null}
      </span>
      {aberto && (
        <ul role="listbox" className="absolute z-40 left-0 right-0 mt-1 bg-white border border-surface-border rounded-lg shadow-lg py-1 text-sm" data-sugestoes>
          {sugestoes.map((sug, i) => (
            <li key={sug.id} role="option" aria-selected={i === destaque}>
              <button
                type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(sug)} onMouseEnter={() => setDestaque(i)}
                className={cn("w-full text-left px-3 py-1.5 flex items-center gap-2 min-w-0", i === destaque ? "bg-primary-50" : "hover:bg-surface-alt")}
                data-sugestao={sug.id}
              >
                <Search className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="truncate text-ink"><Destacar texto={sug.rotulo} termo={valor.trim()} /></span>
                {sug.detalhe && <span className="ml-auto pl-2 text-xs text-ink-subtle truncate shrink-0 max-w-[45%]">{sug.detalhe}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Negrito no trecho que combina com a busca (sem acento/maiúsculas). */
function Destacar({ texto, termo }: { texto: string; termo: string }) {
  const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const i = termo ? norm(texto).indexOf(norm(termo)) : -1;
  if (i < 0) return <>{texto}</>;
  return <>{texto.slice(0, i)}<strong className="font-semibold">{texto.slice(i, i + termo.length)}</strong>{texto.slice(i + termo.length)}</>;
}

/** Busca as sugestões numa URL que responde { sugestoes } (q é acrescentado no fim). */
export function sugerirPorUrl(base: string) {
  return async (q: string): Promise<Sugestao[]> => {
    const r = await fetch(`${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}`, { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json().catch(() => null);
    return Array.isArray(d?.sugestoes) ? d.sugestoes : [];
  };
}

/** Lembra o tamanho de página escolhido (todas as listas, neste navegador). */
export function gravarTamanhoPreferido(n: number) {
  try { window.localStorage.setItem(CHAVE_TAMANHO_PAGINA, String(n)); } catch { /* modo privado */ }
}
export function lerTamanhoPreferido(): number | null {
  try { const v = Number(window.localStorage.getItem(CHAVE_TAMANHO_PAGINA)); return (TAMANHOS_PAGINA as readonly number[]).includes(v) ? v : null; } catch { return null; }
}

/**
 * Rodapé da lista: "Mostrando 26–50 de 312 clientes" + itens por página (25/50/100, lembrado) +
 * anterior / números / próxima. A página fica na URL (ou no estado, para quem passa `onNavegar` próprio).
 */
export function Paginacao({ total, pagina, porPagina, onNavegar, rotulo }: {
  total: number; pagina: number; porPagina: number; rotulo?: string;
  onNavegar: (mudancas: Record<string, string | null>, manterPagina?: boolean) => void;
}) {
  if (total <= 0) return null;
  const { de, ate } = faixa(pagina, porPagina, total);
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const ir = (p: number) => onNavegar({ pagina: p <= 1 ? null : String(p) }, true);
  const btn = "min-w-[2.25rem] h-9 px-2 rounded-lg border text-sm tabular-nums disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-sm" data-paginacao>
      <p className="text-ink-muted" data-faixa>
        Mostrando <span className="font-medium text-ink">{de.toLocaleString("pt-BR")}–{ate.toLocaleString("pt-BR")}</span> de{" "}
        <span className="font-medium text-ink">{total.toLocaleString("pt-BR")}</span>{rotulo ? ` ${rotulo}` : ""}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <select
          value={porPagina} aria-label="Itens por página" data-por-pagina
          onChange={(e) => { const n = Number(e.target.value); gravarTamanhoPreferido(n); onNavegar({ por: n === TAMANHO_PADRAO ? null : String(n) }); }}
          className="bg-white border border-surface-border rounded-lg px-2 h-9 text-sm text-ink focus:outline-none focus:border-primary-500 mr-1"
        >
          {TAMANHOS_PAGINA.map((n) => <option key={n} value={n}>{n} por página</option>)}
        </select>
        <button type="button" disabled={pagina <= 1} onClick={() => ir(pagina - 1)} className={cn(btn, "border-surface-border bg-white text-ink-muted hover:text-primary-600")} title="Página anterior" aria-label="Página anterior" data-pagina-anterior>
          <ChevronLeft className="w-4 h-4 mx-auto" />
        </button>
        {/* Números: no celular só "3 / 12" */}
        <span className="sm:hidden text-ink-muted tabular-nums px-1">{pagina} / {totalPaginas}</span>
        {paginasVisiveis(pagina, totalPaginas).map((n, i) => n === null
          ? <span key={`r${i}`} className="hidden sm:inline px-1 text-ink-subtle">…</span>
          : (
            <button
              key={n} type="button" onClick={() => ir(n)} aria-current={n === pagina ? "page" : undefined} data-pagina={n}
              className={cn(btn, "hidden sm:inline-block", n === pagina ? "bg-primary-500 border-primary-500 text-white font-semibold" : "border-surface-border bg-white text-ink hover:border-primary-300")}
            >{n}</button>
          ))}
        <button type="button" disabled={pagina >= totalPaginas} onClick={() => ir(pagina + 1)} className={cn(btn, "border-surface-border bg-white text-ink-muted hover:text-primary-600")} title="Próxima página" aria-label="Próxima página" data-pagina-proxima>
          <ChevronRight className="w-4 h-4 mx-auto" />
        </button>
      </div>
    </div>
  );
}

/** Estado vazio claro: "Nenhum cliente encontrado" (com a busca) ou a mensagem da tela. */
export function ListaVazia({ mensagem, busca, onLimpar }: { mensagem: string; busca?: string; onLimpar?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
      <SearchX className="w-8 h-8 text-ink-subtle" />
      <p className="text-sm font-medium text-ink">{mensagem}</p>
      {busca && <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>}
      {busca && onLimpar && <button type="button" onClick={onLimpar} className="text-sm text-primary-600 hover:underline">Limpar busca</button>}
    </div>
  );
}

/** Esqueleto enquanto a lista carrega (mantém a altura: nada "pula"). */
export function SkeletonLista({ linhas = 6 }: { linhas?: number }) {
  return (
    <div className="divide-y divide-surface-border" aria-busy="true" aria-label="Carregando" data-skeleton>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
          <div className="h-3.5 rounded bg-surface-alt flex-1 max-w-[40%]" />
          <div className="h-3.5 rounded bg-surface-alt w-24 hidden sm:block" />
          <div className="h-3.5 rounded bg-surface-alt w-16 hidden sm:block" />
          <div className="h-3.5 rounded bg-surface-alt w-10 ml-auto" />
        </div>
      ))}
    </div>
  );
}
