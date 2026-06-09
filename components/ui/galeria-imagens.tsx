"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ImagePlus, ChevronLeft, ChevronRight, X, Star, Image as ImageIcon } from "lucide-react";

const MAX_IMAGENS = 5;
const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];

/** Lê um arquivo como data URL (base64). */
function lerArquivo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface Props {
  fotos: string[];
  onChange: (fotos: string[]) => void;
}

export function GaleriaImagens({ fotos, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [atual, setAtual] = useState(0);
  const [erro, setErro] = useState("");

  async function adicionar(e: React.ChangeEvent<HTMLInputElement>) {
    setErro("");
    const arquivos = Array.from(e.target.files ?? []);
    if (arquivos.length === 0) return;

    const restante = MAX_IMAGENS - fotos.length;
    if (restante <= 0) { setErro(`Máximo de ${MAX_IMAGENS} imagens.`); return; }

    const validos = arquivos.filter((f) => TIPOS_ACEITOS.includes(f.type));
    if (validos.length < arquivos.length) setErro("Apenas JPG, PNG ou WEBP são aceitos.");

    const novas = await Promise.all(validos.slice(0, restante).map(lerArquivo));
    onChange([...fotos, ...novas]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remover(idx: number) {
    const novas = fotos.filter((_, i) => i !== idx);
    onChange(novas);
    setAtual((a) => Math.max(0, Math.min(a, novas.length - 1)));
  }

  function definirPrincipal(idx: number) {
    if (idx === 0) return;
    const novas = [...fotos];
    const [escolhida] = novas.splice(idx, 1);
    novas.unshift(escolhida);
    onChange(novas);
    setAtual(0);
  }

  const temFotos = fotos.length > 0;
  const indice = Math.min(atual, Math.max(0, fotos.length - 1));

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={adicionar} className="hidden" />

      {/* Visualizador / carrossel */}
      <div className="relative bg-surface-alt border border-surface-border rounded-xl overflow-hidden aspect-video flex items-center justify-center">
        {temFotos ? (
          <>
            <img src={fotos[indice]} alt={`Imagem ${indice + 1}`} className="w-full h-full object-contain" />
            {indice === 0 && (
              <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-success-500 text-white text-[11px] font-semibold px-2 py-0.5 rounded-full">
                <Star className="w-3 h-3 fill-white" /> Principal
              </span>
            )}
            <button type="button" onClick={() => remover(indice)} className="absolute top-2 right-2 bg-black/50 hover:bg-red-500 text-white rounded-full p-1.5" title="Remover">
              <X className="w-4 h-4" />
            </button>
            {fotos.length > 1 && (
              <>
                <button type="button" onClick={() => setAtual((a) => (a - 1 + fotos.length) % fotos.length)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1.5">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button type="button" onClick={() => setAtual((a) => (a + 1) % fotos.length)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1.5">
                  <ChevronRight className="w-5 h-5" />
                </button>
                <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[11px] px-2 py-0.5 rounded-full">
                  {indice + 1} / {fotos.length}
                </span>
              </>
            )}
          </>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} className="flex flex-col items-center justify-center gap-2 text-ink-subtle hover:text-primary-600 transition-colors">
            <ImageIcon className="w-10 h-10" />
            <span className="text-sm">Adicionar foto do equipamento</span>
          </button>
        )}
      </div>

      {/* Miniaturas */}
      {temFotos && (
        <div className="flex flex-wrap gap-2">
          {fotos.map((f, i) => (
            <div key={i} className="relative group">
              <button
                type="button"
                onClick={() => { setAtual(i); definirPrincipal(i); }}
                className={cn(
                  "w-16 h-16 rounded-lg overflow-hidden border-2 transition-all",
                  i === 0 ? "border-success-500" : "border-surface-border hover:border-primary-400",
                )}
                title={i === 0 ? "Imagem principal" : "Definir como principal"}
              >
                <img src={f} alt={`Miniatura ${i + 1}`} className="w-full h-full object-cover" />
              </button>
              <button type="button" onClick={() => remover(i)} className="absolute -top-1.5 -right-1.5 bg-white border border-surface-border text-ink-muted hover:text-red-500 rounded-full p-0.5 shadow opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {fotos.length < MAX_IMAGENS && (
            <button type="button" onClick={() => inputRef.current?.click()} className="w-16 h-16 rounded-lg border-2 border-dashed border-surface-border hover:border-primary-400 flex items-center justify-center text-ink-subtle hover:text-primary-600 transition-colors">
              <ImagePlus className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      {erro && <p className="text-xs text-red-500">{erro}</p>}
      <p className="text-xs text-ink-subtle">Até {MAX_IMAGENS} imagens (JPG, PNG ou WEBP). A primeira é a principal — clique numa miniatura para defini-la.</p>
    </div>
  );
}
