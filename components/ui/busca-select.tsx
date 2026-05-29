"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Search, X, ChevronDown } from "lucide-react";

export interface OpcaoBusca { value: string; label: string }

interface BuscaSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: OpcaoBusca[];
  placeholder?: string;
  className?: string;
}

/** Select de seleção única com campo de busca. */
export function BuscaSelect({ value, onChange, options, placeholder = "Selecione...", className }: BuscaSelectProps) {
  const [aberto, setAberto] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const selecionada = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtradas = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center justify-between gap-2 bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-left focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
      >
        <span className={cn("truncate", selecionada ? "text-ink" : "text-ink-subtle")}>{selecionada?.label ?? placeholder}</span>
        <span className="flex items-center gap-1 shrink-0">
          {value && (
            <X className="w-3.5 h-3.5 text-ink-subtle hover:text-ink" onClick={(e) => { e.stopPropagation(); onChange(""); }} />
          )}
          <ChevronDown className="w-4 h-4 text-ink-subtle" />
        </span>
      </button>
      {aberto && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-surface-border rounded-lg shadow-card-hover">
          <div className="p-2 border-b border-surface-border relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-subtle pointer-events-none" />
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="w-full bg-surface-alt rounded-md pl-8 pr-2 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtradas.length === 0 && <p className="px-3 py-3 text-xs text-ink-subtle italic">Nenhum resultado.</p>}
            {filtradas.slice(0, 50).map((o) => (
              <button
                key={o.value} type="button"
                onClick={() => { onChange(o.value); setAberto(false); setQuery(""); }}
                className={cn("w-full text-left px-3 py-2 text-sm hover:bg-primary-50 border-b border-surface-border last:border-0", o.value === value ? "bg-primary-50 text-primary-700 font-medium" : "text-ink")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
