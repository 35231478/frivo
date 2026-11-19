/**
 * ANOTAÇÕES INTERNAS — a captura do print, no navegador.
 *
 * Mora num arquivo só dele de propósito: a ferramenta o alcança por `import()` dentro do handler
 * de salvar, então a biblioteca de captura (~54 KB) só é baixada quando o dono salva a PRIMEIRA
 * anotação. Nem o cliente do Frivo nem o próprio dono pagam por ela antes disso.
 *
 * Por que a captura pega `document.body` e sai do tamanho da viewport: no painel, a casca é
 * `h-screen overflow-hidden` e quem rola é o `#conteudo-scroll` — o body NÃO rola, então a caixa
 * dele já é exatamente a janela. Nada de montar imagem de página inteira.
 *
 * E a regra que vale acima de tudo: se qualquer coisa aqui falhar, devolve `null`. O print é o
 * contexto; a anotação é o que importa. Perder a anotação porque a captura deu errado seria
 * trocar o essencial pelo acessório.
 */
import { domToJpeg } from "modern-screenshot";
import { PRINT_MAX_BYTES } from "@/lib/anotacoes/regras";

export interface PrintCapturado {
  conteudo: string;
  largura: number;
  altura: number;
  printFx: number | null;
  printFy: number | null;
}

const bytesDoDataUrl = (url: string) => Math.floor(((url.length - url.indexOf(",") - 1) * 3) / 4);

/** Duas tentativas: a boa e a leve. Se as duas estourarem o teto, melhor nenhum print. */
const TENTATIVAS = [
  { scale: 0.5, quality: 0.7 },
  { scale: 0.34, quality: 0.55 },
];

/**
 * Captura a viewport e devolve o data URL já no tamanho de guardar, mais a posição do ponto
 * anotado DENTRO da imagem (fração 0..1) — para a tela desenhar o alvo sem reprocessar nada.
 */
export async function capturarPrintDaViewport(ponto?: { x: number; y: number }): Promise<PrintCapturado | null> {
  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!w || !h) return null;
    for (const { scale, quality } of TENTATIVAS) {
      const conteudo = await domToJpeg(document.body, {
        width: w,
        height: h,
        scale,
        quality,
        backgroundColor: "#ffffff",
        // o overlay da própria ferramenta não entra no print (ele some antes, mas vai dobrado)
        filter: (no: Node) =>
          !(no instanceof Element && no.hasAttribute?.("data-anotacoes-fora-do-print")),
      });
      if (bytesDoDataUrl(conteudo) <= PRINT_MAX_BYTES) {
        return {
          conteudo,
          largura: Math.round(w * scale),
          altura: Math.round(h * scale),
          printFx: ponto ? Math.min(1, Math.max(0, ponto.x / w)) : null,
          printFy: ponto ? Math.min(1, Math.max(0, ponto.y / h)) : null,
        };
      }
    }
    return null;
  } catch {
    return null; // tela que não rasteriza: a anotação segue sem print
  }
}
