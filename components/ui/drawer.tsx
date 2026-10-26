"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { abrirCamada, fecharCamada, noTopo, prenderFoco } from "@/components/ui/camadas";

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
 * Acessível: foco vai para o painel ao abrir, fica preso nele (Tab) e volta para quem abriu;
 * com camadas uma dentro da outra, Esc fecha só a de cima.
 */
export function Drawer({ aberto, onFechar, titulo, children, largura, rodape, abas, abaAtiva, onAbaChange }: DrawerProps) {
  const [montado, setMontado] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const idTitulo = useId();
  const painelRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;

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

  // ESC fecha (só a camada do topo) + foco preso no painel + scroll do body travado enquanto aberto.
  useEffect(() => {
    if (!aberto) return;
    const camada = abrirCamada();
    const antes = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (!noTopo(camada)) return;
      if (e.key === "Escape") { e.stopPropagation(); fecharRef.current(); return; }
      prenderFoco(e, painelRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      fecharCamada(camada);
      if (antes && document.contains(antes)) antes.focus?.();
    };
  }, [aberto]);

  // Ao abrir, o foco entra no painel (leitor de tela anuncia o título) — sem tirar de um campo
  // que já pegou o foco sozinho (autoFocus)
  useEffect(() => {
    const p = painelRef.current;
    if (aberto && montado && p && !p.contains(document.activeElement)) p.focus();
  }, [aberto, montado]);

  if (!montado || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div
        onClick={onFechar}
        className={cn("absolute inset-0 bg-ink/40 transition-opacity duration-300", entrando ? "opacity-100" : "opacity-0")}
      />
      <div
        ref={painelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={cn(
          "absolute right-0 top-0 h-full bg-white border-l border-surface-border shadow-elevated flex flex-col transition-transform duration-300 ease-out outline-none",
          largura ?? "w-full sm:w-[52vw] sm:min-w-[460px] sm:max-w-[780px]",
          entrando ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header: superfície branca com divisória (sistema de design) */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-white border-b border-surface-border shrink-0">
          <h3 id={idTitulo} className="font-display text-base font-semibold text-ink truncate">{titulo}</h3>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar"
            aria-label="Fechar"
            className="p-1.5 -mr-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-page transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas opcionais */}
        {abas && abas.length > 0 && (
          <nav className="flex gap-1 px-4 border-b border-surface-border bg-white shrink-0 overflow-x-auto">
            {abas.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onAbaChange?.(t.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-3 -mb-px text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                  abaAtiva === t.id ? "border-acento text-acento font-semibold" : "border-transparent text-ink-muted hover:text-ink",
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
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-border bg-white shrink-0">
            {rodape}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
