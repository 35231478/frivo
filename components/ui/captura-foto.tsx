"use client";

import { useRef, type ChangeEvent } from "react";
import { Camera, RotateCcw, X } from "lucide-react";

/** O teto de uma foto de assinatura: acima disso a câmera do celular já está exagerando. */
export const TAMANHO_MAX_FOTO = 6 * 1024 * 1024;

/**
 * A FOTO TIRADA NA HORA — a câmera do aparelho abre direto, e o que fica é uma data URL.
 *
 * Nasceu na assinatura do contrato da admissão digital e virou componente quando a assinatura dos
 * documentos gerados por modelo passou a precisar exatamente da mesma coisa: um lugar só para a
 * câmera, o teto de tamanho, o "tirar outra" e o X que descarta.
 *
 * Quem valida de verdade é o servidor, pelos BYTES. Aqui é só o que a pessoa vê.
 */
export function CapturaFoto({
  valor, onValor, onErro, rotulo = "Foto", ajuda = "A câmera da frente abre direto",
  tamanhoMax = TAMANHO_MAX_FOTO, marca, obrigatorio = false,
}: {
  valor: string | null;
  onValor: (dataUrl: string | null) => void;
  /** Mensagem para a tela mostrar (foto grande demais, arquivo ilegível). */
  onErro?: (mensagem: string) => void;
  rotulo?: string;
  ajuda?: string;
  tamanhoMax?: number;
  /** Sufixo dos data-atributos, quando há mais de uma captura na mesma tela. */
  marca?: string;
  /** Marca o rótulo com o asterisco da casa — sem a foto, o botão de assinar fica travado. */
  obrigatorio?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);

  function pegar(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > tamanhoMax) {
      onErro?.(`A foto passou de ${Math.round(tamanhoMax / 1024 / 1024)} MB. Tire outra.`);
      return;
    }
    const r = new FileReader();
    r.onload = () => onValor(String(r.result));
    r.onerror = () => onErro?.("Não foi possível ler a foto. Tente de novo.");
    r.readAsDataURL(f);
  }

  return (
    <div>
      <p className="text-sm font-medium text-ink mb-1.5">
        {rotulo}{obrigatorio && <span className="text-atrasado ml-0.5">*</span>}
      </p>
      <input
        ref={camera} type="file" accept="image/*" capture="user" className="hidden"
        onChange={pegar} aria-label={rotulo} data-entrada-foto={marca ?? true}
      />
      {valor ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={valor} alt={rotulo} className="w-full max-h-72 object-contain rounded-lg bg-surface-alt" data-selfie={marca ?? true} />
          <button
            type="button" onClick={() => onValor(null)} aria-label="Tirar a foto"
            className="absolute top-2 right-2 bg-ink/60 hover:bg-atrasado text-white rounded-full p-1.5" data-tirar-selfie={marca ?? true}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
          <button
            type="button" onClick={() => camera.current?.click()}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <RotateCcw className="w-4 h-4" aria-hidden /> Tirar outra
          </button>
        </div>
      ) : (
        <button
          type="button" onClick={() => camera.current?.click()} data-abrir-camera={marca ?? true}
          className="w-full h-36 rounded-lg border border-dashed border-primary-300 bg-primary-50/30 flex flex-col items-center justify-center gap-1.5 text-primary-700"
        >
          <Camera className="w-7 h-7" aria-hidden />
          <span className="text-sm font-semibold">Tirar a foto</span>
          <span className="text-xs text-ink-muted">{ajuda}</span>
        </button>
      )}
    </div>
  );
}
