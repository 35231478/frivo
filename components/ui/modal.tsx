"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface ModalProps {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  children: React.ReactNode;
  tamanho?: "sm" | "md" | "lg";
}

export function Modal({ aberto, onFechar, titulo, children, tamanho = "md" }: ModalProps) {
  useEffect(() => {
    if (!aberto) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onFechar(); }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onFechar} />
      <div className={cn(
        "relative bg-white rounded-2xl shadow-card-hover w-full max-h-[90vh] overflow-y-auto",
        tamanho === "sm" ? "max-w-md" : tamanho === "lg" ? "max-w-2xl" : "max-w-lg",
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border sticky top-0 bg-white">
          <h3 className="text-base font-bold text-ink">{titulo}</h3>
          <button type="button" onClick={onFechar} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
