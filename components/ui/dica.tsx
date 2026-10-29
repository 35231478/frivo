"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ícone ⓘ com uma explicação curta (Princípio 7: texto curto na tela, o detalhe na dica).
 * Abre no hover, no foco (teclado) e no toque (celular não tem hover); Esc fecha.
 */
export function Dica({ texto, className, lado = "centro" }: { texto: string; className?: string; lado?: "centro" | "direita" | "esquerda" }) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  return (
    <span className={cn("relative inline-flex align-middle", className)} onMouseEnter={() => setAberta(true)} onMouseLeave={() => setAberta(false)}>
      <button
        type="button" aria-label={texto} aria-describedby={aberta ? id : undefined} data-dica
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAberta((v) => !v); }}
        onFocus={() => setAberta(true)} onBlur={() => setAberta(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setAberta(false); }}
        className="p-0.5 rounded-full text-ink-subtle hover:text-acento focus:outline-none focus-visible:ring-2 focus-visible:ring-acento/40"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {aberta && (
        <span
          id={id} role="tooltip" data-dica-texto
          className={cn(
            "absolute top-full mt-1.5 z-40 w-56 rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-normal leading-snug text-white shadow-elevated normal-case tracking-normal text-left",
            lado === "centro" && "left-1/2 -translate-x-1/2", lado === "direita" && "left-0", lado === "esquerda" && "right-0",
          )}
        >
          {texto}
        </span>
      )}
    </span>
  );
}
