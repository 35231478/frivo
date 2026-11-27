"use client";

/**
 * O quadro de assinatura NÃO apaga o que o cliente já assinou quando a janela muda de tamanho.
 *
 * O react-signature-canvas, por padrão (`clearOnResize`), redimensiona e LIMPA o quadro a cada evento
 * `resize` da janela. No celular esse evento dispara sozinho: a barra de endereço some ao rolar, o
 * teclado abre, o aparelho gira. O cliente assinava, rolava até o botão e a assinatura sumia.
 *
 * Uso: `clearOnResize={false}` no <SignatureCanvas> e `useAssinaturaPreservada(ref)` no componente.
 * Só redimensiona quando o tamanho do quadro mudou DE FATO (rolar não muda nada); quando muda, guarda
 * os traços, redimensiona e redesenha (os traços ficam nas mesmas coordenadas da tela).
 */
import { useEffect, type RefObject } from "react";
import type SignatureCanvas from "react-signature-canvas";

/** O tamanho interno que o quadro deveria ter para a largura/altura exibidas (regra da própria biblioteca) */
export function tamanhoInterno(exibido: { largura: number; altura: number }, devicePixelRatio: number | undefined): { largura: number; altura: number } {
  const ratio = Math.max(devicePixelRatio ?? 1, 1);
  return { largura: exibido.largura * ratio, altura: exibido.altura * ratio };
}

/** O quadro precisa ser redimensionado? Só se o tamanho interno não bate com o exibido */
export function precisaRedimensionar(
  interno: { largura: number; altura: number }, exibido: { largura: number; altura: number }, devicePixelRatio: number | undefined,
): boolean {
  const alvo = tamanhoInterno(exibido, devicePixelRatio);
  return interno.largura !== alvo.largura || interno.altura !== alvo.altura;
}

export function useAssinaturaPreservada(ref: RefObject<SignatureCanvas | null>): void {
  useEffect(() => {
    function aoRedimensionar() {
      const quadro = ref.current;
      if (!quadro) return;
      const canvas = quadro.getCanvas();
      const exibido = { largura: canvas.offsetWidth, altura: canvas.offsetHeight };
      if (!precisaRedimensionar({ largura: canvas.width, altura: canvas.height }, exibido, window.devicePixelRatio)) return;
      const tracos = quadro.toData();
      quadro._resizeCanvas(); // redimensiona e limpa
      if (tracos.length) quadro.fromData(tracos);
    }
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [ref]);
}
