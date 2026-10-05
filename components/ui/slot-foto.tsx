"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { ImagePlus, RotateCcw, X } from "lucide-react";

/**
 * Espaço de foto rotulado (câmera + galeria, trocar/remover). Usado no cadastro
 * por foto do equipamento (etiqueta / equipamento / outro ângulo) e nas fotos do
 * veículo por ângulo (frente, traseira, laterais).
 */
export function SlotFoto({ id, titulo, selo, seloCor, icone: Icone, dica, obrigatoria, url, rotuloAria, onArquivo, onRemover }: {
  id: string; titulo: string; selo: string; seloCor: string; icone: React.ComponentType<{ className?: string }>; dica: string;
  obrigatoria?: boolean; url: string | null; rotuloAria: string; onArquivo: (f: File | undefined) => void; onRemover: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; onArquivo(f); };
  return (
    <div data-slot={id} className={cn("rounded-xl border p-2.5 flex flex-col gap-2", url ? "border-surface-border bg-white" : "border-dashed border-primary-300 bg-primary-50/30")}>
      <div className="flex items-center justify-between gap-1">
        <p className="text-xs font-semibold text-ink truncate">{titulo}{obrigatoria && <span className="text-red-500"> *</span>}</p>
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0", seloCor)}>{selo}</span>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={escolher} aria-label={`${rotuloAria} (câmera)`} />
      <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={escolher} aria-label={`${rotuloAria} (arquivo)`} />
      {url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={titulo} className="w-full h-32 object-cover rounded-lg bg-surface-alt" />
          <button type="button" onClick={onRemover} title="Remover foto" className="absolute top-1.5 right-1.5 bg-black/55 hover:bg-red-600 text-white rounded-full p-1"><X className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => camera.current?.click()} className="mt-1.5 w-full inline-flex items-center justify-center gap-1 text-xs text-ink-muted hover:text-ink"><RotateCcw className="w-3 h-3" /> Trocar</button>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => camera.current?.click()} className="h-28 rounded-lg flex flex-col items-center justify-center gap-1 text-primary-700 hover:bg-primary-50">
            <Icone className="w-7 h-7" />
            <span className="text-xs font-semibold">Fotografar</span>
            <span className="text-[10px] text-primary-600/80 text-center px-1">{dica}</span>
          </button>
          <button type="button" onClick={() => galeria.current?.click()} className="inline-flex items-center justify-center gap-1 text-[11px] text-ink-muted hover:text-ink">
            <ImagePlus className="w-3 h-3" /> da galeria
          </button>
        </>
      )}
    </div>
  );
}
