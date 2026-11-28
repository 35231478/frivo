"use client";

import { cn } from "@/lib/utils";
import { ROTULO_CITACAO_INDISPONIVEL } from "@/lib/chat/regras";
import type { CitacaoTela } from "@/lib/tecnico/comentarios";

/**
 * A CITAÇÃO de uma mensagem (responder, como no WhatsApp) — a mesma no topo do balão, acima do campo de texto e na
 * lista da OS no app: quem falou e uma linha (ou a miniatura, se for foto). No balão, tocar vai até a original.
 */
export function Citacao({ c, onIr, className }: { c: CitacaoTela; onIr?: () => void; className?: string }) {
  const corpo = (
    <>
      <span className="min-w-0 flex-1">
        {c.indisponivel
          ? <span className="block text-xs italic text-ink-subtle">{ROTULO_CITACAO_INDISPONIVEL}</span>
          : <>
            <span className="block text-xs font-semibold text-primary-700 truncate" data-citacao-autor>{c.autor}</span>
            {c.texto && <span className="block text-xs text-ink-muted truncate" data-citacao-texto>{c.texto}</span>}
          </>}
      </span>
      {!c.indisponivel && c.miniatura && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.miniatura} alt="" className="shrink-0 w-10 h-10 rounded object-cover" data-citacao-foto />
      )}
    </>
  );
  const estilo = cn("flex items-center gap-2 w-full min-w-0 rounded-lg border-l-4 border-primary-400 bg-surface-alt/80 px-2 py-1 text-left", className);
  return onIr && !c.indisponivel
    ? <button type="button" onClick={onIr} className={cn(estilo, "hover:bg-surface-alt")} title="Ir até a mensagem respondida" data-citacao>{corpo}</button>
    : <div className={estilo} data-citacao>{corpo}</div>;
}
