"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { abrirCamada, fecharCamada, noTopo, prenderFoco } from "@/components/ui/camadas";

interface ModalProps {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  children: React.ReactNode;
  tamanho?: "sm" | "md" | "lg";
}

export function Modal({ aberto, onFechar, titulo, children, tamanho = "md" }: ModalProps) {
  const painelRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  // Esc fecha só a camada do topo (modal dentro de gaveta não fecha a gaveta); foco preso no modal
  useEffect(() => {
    if (!aberto) return;
    const camada = abrirCamada();
    const antes = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (!noTopo(camada)) return;
      if (e.key === "Escape") { e.stopPropagation(); fecharRef.current(); return; }
      prenderFoco(e, painelRef.current);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      fecharCamada(camada);
      if (antes && document.contains(antes)) antes.focus?.();
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    // text-left/whitespace-normal: o modal é renderizado no lugar do botão (ex.: célula "Ações" alinhada à
    // direita e sem quebra de linha) e não pode herdar esse alinhamento
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 text-left whitespace-normal" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onFechar} />
      <div ref={painelRef} className={cn(
        "relative bg-white rounded-card border border-surface-border shadow-elevated w-full max-h-[90vh] overflow-y-auto",
        tamanho === "sm" ? "max-w-md" : tamanho === "lg" ? "max-w-2xl" : "max-w-lg",
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border sticky top-0 bg-white">
          <h3 className="font-display text-base font-semibold text-ink">{titulo}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1 -mr-1 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-page"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
