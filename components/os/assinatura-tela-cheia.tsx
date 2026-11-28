"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SignatureCanvas from "react-signature-canvas";
import { Check, Eraser, RotateCw, X } from "lucide-react";
import { CAMADA } from "@/lib/ui/camadas";
import { cn } from "@/lib/utils";
import { neutro } from "@/lib/ui/tokens";
import { abrirCamada, fecharCamada, noTopo } from "@/components/ui/camadas";
import { ambienteDoNavegador, entrarPaisagem, sairPaisagem, useAssinaturaPreservada, type AmbienteTela, type EstadoPaisagem, type Tamanho, type Traco } from "@/lib/assinatura-quadro";

/**
 * D6 — ASSINAR EM TELA CHEIA: um quadro do tamanho da tela, em paisagem (só nesta tela; onde o aparelho deixa travar).
 * Começa com o que já estava assinado no quadro pequeno. "Usar assinatura" devolve os traços e o tamanho do quadro
 * em que foram feitos (quem chama leva ao quadro pequeno em escala, sem distorcer). Esc / "Voltar": nada muda.
 */
export function AssinaturaTelaCheia({ inicial, aoUsar, aoVoltar, ambiente }: {
  inicial: { tracos: Traco[]; tamanho: Tamanho } | null;
  aoUsar: (tracos: Traco[], tamanho: Tamanho) => void;
  aoVoltar: () => void;
  /** Para testar; padrão = o navegador */
  ambiente?: AmbienteTela;
}) {
  const quadro = useRef<SignatureCanvas | null>(null);
  useAssinaturaPreservada(quadro);
  const [vazio, setVazio] = useState(!inicial?.tracos.length);
  const [emPe, setEmPe] = useState(false);
  const voltarRef = useRef(aoVoltar);
  voltarRef.current = aoVoltar;

  // Tela cheia + paisagem ao abrir; desfaz ao fechar (o resto do app gira livre)
  useEffect(() => {
    const amb = ambiente ?? ambienteDoNavegador();
    let estado: EstadoPaisagem = { telaCheia: false, travou: false };
    let vivo = true;
    void entrarPaisagem(amb).then((e) => { if (vivo) estado = e; else void sairPaisagem(amb, e); });
    return () => { vivo = false; void sairPaisagem(amb, estado); };
  }, [ambiente]);

  // Em pé (iPhone não trava): pede para girar — e assina assim mesmo, se quiser
  useEffect(() => {
    const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(orientation: portrait)") : null;
    const ver = () => setEmPe(!!mq?.matches);
    ver();
    mq?.addEventListener?.("change", ver);
    return () => mq?.removeEventListener?.("change", ver);
  }, []);

  // O que já estava assinado entra no quadro grande (do mesmo tamanho; o grande não estica)
  useEffect(() => {
    const q = quadro.current;
    if (!q || !inicial?.tracos.length) return;
    q.fromData(inicial.tracos as unknown as ReturnType<SignatureCanvas["toData"]>);
  }, [inicial]);

  // Esc fecha só esta camada (o modal do aceite continua aberto)
  useEffect(() => {
    const camada = abrirCamada();
    const onKey = (e: KeyboardEvent) => { if (noTopo(camada) && e.key === "Escape") { e.stopPropagation(); voltarRef.current(); } };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); fecharCamada(camada); };
  }, []);

  function usar() {
    const q = quadro.current;
    if (!q || q.isEmpty()) return;
    const c = q.getCanvas();
    aoUsar(q.toData() as unknown as Traco[], { largura: c.offsetWidth, altura: c.offsetHeight });
  }

  const conteudo = (
    <div className={cn("fixed inset-0 bg-white flex flex-col", CAMADA.lightbox)} role="dialog" aria-modal="true" aria-label="Assinatura em tela cheia" data-assinatura-tela-cheia>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-surface-border" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <button type="button" onClick={aoVoltar} className="inline-flex items-center gap-1 text-sm font-semibold text-ink px-2 touch-target" data-voltar-tela-cheia>
          <X className="w-5 h-5" aria-hidden /> Voltar
        </button>
        <span className="text-sm text-ink-muted truncate">Assine com o dedo</span>
        <button type="button" onClick={() => { quadro.current?.clear(); setVazio(true); }} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted px-2 touch-target" data-limpar-tela-cheia>
          <Eraser className="w-4 h-4" aria-hidden /> Limpar
        </button>
      </div>
      {emPe && (
        <p className="flex items-center justify-center gap-2 bg-surface-alt text-ink text-sm px-3 py-2" role="status" data-gire-celular>
          <RotateCw className="w-4 h-4" aria-hidden /> Gire o celular para assinar deitado.
        </p>
      )}
      <div className="flex-1 min-h-0 p-2 touch-none">
        <SignatureCanvas ref={quadro} clearOnResize={false} penColor={neutro.texto} onEnd={() => setVazio(false)}
          canvasProps={{ className: "w-full h-full bg-white border-2 border-dashed border-surface-border rounded-lg", "aria-label": "Quadro de assinatura em tela cheia" } as React.CanvasHTMLAttributes<HTMLCanvasElement>} />
      </div>
      <div className="px-3 py-2 border-t border-surface-border" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={usar} disabled={vazio} data-usar-tela-cheia
          className="w-full rounded-card bg-primary-600 text-white py-3 text-base font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40 touch-target">
          <Check className="w-5 h-5" aria-hidden /> Usar assinatura
        </button>
      </div>
    </div>
  );
  return typeof document === "undefined" ? conteudo : createPortal(conteudo, document.body);
}
