"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type Icone = React.ComponentType<{ className?: string }>;

export interface DrawerAba {
  id: string;
  label: string;
  icone?: Icone;
}

interface DrawerProps {
  aberto: boolean;
  onFechar: () => void;
  titulo: React.ReactNode;
  children: React.ReactNode;
  /** Classes Tailwind de largura do painel (sobrescreve o padrão ~50% no desktop). */
  largura?: string;
  /** Ações fixas no rodapé (ex.: Cancelar / Salvar). */
  rodape?: React.ReactNode;
  /** Abas opcionais no topo do painel. */
  abas?: DrawerAba[];
  abaAtiva?: string;
  onAbaChange?: (id: string) => void;
}

/**
 * Painel lateral deslizante (drawer) reutilizável — desliza a partir da direita,
 * com overlay que escurece o fundo, fechamento por clique fora / ESC, header no
 * tema do sistema, abas opcionais e rodapé de ações. Padrão de cadastro do Frivo.
 */
export function Drawer({ aberto, onFechar, titulo, children, largura, rodape, abas, abaAtiva, onAbaChange }: DrawerProps) {
  const [montado, setMontado] = useState(false);
  const [entrando, setEntrando] = useState(false);

  // Monta ao abrir; mantém montado durante a animação de saída.
  useEffect(() => {
    if (aberto) {
      setMontado(true);
      const r = requestAnimationFrame(() => setEntrando(true));
      return () => cancelAnimationFrame(r);
    }
    if (montado) {
      setEntrando(false);
      const t = setTimeout(() => setMontado(false), 300);
      return () => clearTimeout(t);
    }
  }, [aberto, montado]);

  // ESC fecha + trava o scroll do body enquanto aberto.
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [aberto, onFechar]);

  if (!montado || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div
        onClick={onFechar}
        className={cn("absolute inset-0 bg-slate-900/40 transition-opacity duration-300", entrando ? "opacity-100" : "opacity-0")}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute right-0 top-0 h-full bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out",
          largura ?? "w-full sm:w-[52vw] sm:min-w-[460px] sm:max-w-[780px]",
          entrando ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header (tema navy do sistema) */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-sidebar text-white shrink-0">
          <h3 className="text-base font-semibold truncate">{titulo}</h3>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            className="p-1.5 -mr-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas opcionais */}
        {abas && abas.length > 0 && (
          <nav className="flex gap-1.5 px-4 pt-3 pb-3 border-b border-surface-border bg-surface-alt/40 shrink-0 overflow-x-auto">
            {abas.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onAbaChange?.(t.id)}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all",
                  abaAtiva === t.id ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-white",
                )}
              >
                {t.icone && <t.icone className="w-4 h-4" />} {t.label}
              </button>
            ))}
          </nav>
        )}

        {/* Conteúdo (rolável) */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {/* Rodapé de ações */}
        {rodape && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-border bg-surface-alt/40 shrink-0">
            {rodape}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
