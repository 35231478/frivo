"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";

export interface ItemLightbox {
  src: string;
  /** Endereço para baixar (pode ser o mesmo da imagem) */
  baixar: string;
  /** Nome do arquivo baixado */
  nomeArquivo: string;
  titulo: string;
  /** Linhas de apoio (equipamento, atividade, quem/quando) */
  detalhes?: (string | null | undefined)[];
}

/**
 * Foto em tela cheia, com legenda, detalhes e "Baixar". Setas (botões e ← →) passam entre as fotos
 * do mesmo grupo; Esc ou clique fora fecha e devolve o foco a quem abriu. No celular ocupa a tela.
 */
export function Lightbox({ itens, indice, onIndice, onFechar }: {
  itens: ItemLightbox[]; indice: number; onIndice: (i: number) => void; onFechar: () => void;
}) {
  const fechar = useRef<HTMLButtonElement>(null);
  const item = itens[indice];
  const varios = itens.length > 1;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; anterior?.focus?.(); };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onFechar(); }
      else if (e.key === "ArrowRight" && varios) { e.preventDefault(); onIndice((indice + 1) % itens.length); }
      else if (e.key === "ArrowLeft" && varios) { e.preventDefault(); onIndice((indice - 1 + itens.length) % itens.length); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [indice, itens.length, varios, onFechar, onIndice]);

  if (!item || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink/95" role="dialog" aria-modal="true" aria-label={`Foto: ${item.titulo}`} data-lightbox>
      <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-5 sm:py-3 text-white shrink-0">
        <span className="text-sm tabular-nums text-white/80" aria-live="polite">{varios ? `${indice + 1} de ${itens.length}` : ""}</span>
        <div className="flex items-center gap-1">
          <a href={item.baixar} download={item.nomeArquivo} data-lightbox-baixar
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Download className="w-4 h-4" aria-hidden="true" /> Baixar
          </a>
          <button ref={fechar} type="button" onClick={onFechar} aria-label="Fechar"
            className="rounded-lg p-2 text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.src} alt={item.titulo} className="max-h-full max-w-full object-contain rounded-lg" />
        {varios && (
          <>
            <button type="button" onClick={() => onIndice((indice - 1 + itens.length) % itens.length)} aria-label="Foto anterior"
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <ChevronLeft className="w-6 h-6" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onIndice((indice + 1) % itens.length)} aria-label="Próxima foto"
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <ChevronRight className="w-6 h-6" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 sm:px-6 sm:py-4 text-white max-w-3xl w-full mx-auto">
        <p className="font-semibold leading-snug" data-lightbox-legenda>{item.titulo}</p>
        {item.detalhes?.filter(Boolean).map((d, i) => <p key={i} className="text-sm text-white/75 leading-snug">{d}</p>)}
      </div>
    </div>,
    document.body,
  );
}
