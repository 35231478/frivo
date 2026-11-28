"use client";

/**
 * O quadro de assinatura NÃO apaga o que o cliente já assinou quando a tela muda de tamanho.
 *
 * O react-signature-canvas, por padrão (`clearOnResize`), redimensiona e LIMPA o quadro a cada evento
 * `resize` da janela. No celular esse evento dispara sozinho: a barra de endereço some ao rolar, o
 * teclado abre, o aparelho gira. O cliente assinava, rolava até o botão e a assinatura sumia.
 *
 * Uso: `clearOnResize={false}` no <SignatureCanvas> e `useAssinaturaPreservada(ref)` no componente.
 * Só redimensiona quando o tamanho do quadro mudou DE FATO (rolar ou abrir o teclado não mudam nada);
 * quando muda (girou o aparelho, a janela encolheu), guarda os PONTOS, redimensiona e redesenha EM ESCALA:
 * a mesma proporção (sem esticar nem achatar), centralizada no quadro novo — nada fica cortado fora dele.
 *
 * `exportarAssinatura`: a imagem salva é só a assinatura (recortada com margem, numa escala fixa), a mesma
 * em qualquer aparelho e orientação — por isso sai igual no aceite, no relatório e no PDF.
 */
import { useEffect, type RefObject } from "react";
import type SignatureCanvas from "react-signature-canvas";

export interface Tamanho { largura: number; altura: number }
/** Margem em volta da assinatura na imagem salva (cobre a espessura do traço) e a escala fixa da imagem */
export const MARGEM_ASSINATURA = 12;
export const ESCALA_ASSINATURA = 2;
/** Um ponto do traço, em pixels da TELA (não do canvas interno) */
export interface PontoTraco { x: number; y: number; time?: number; [k: string]: unknown }
/**
 * Um traço como a biblioteca guarda: no signature_pad 2.x (o instalado), a lista de pontos; nas versões
 * novas, um objeto com `points`. Os dois formatos são aceitos (e devolvidos como vieram).
 */
export type Traco = PontoTraco[] | { points: PontoTraco[]; [k: string]: unknown };
const pontosDe = (t: Traco): PontoTraco[] => (Array.isArray(t) ? t : t.points ?? []);
const comPontos = <T extends Traco>(t: T, pontos: PontoTraco[]): T => (Array.isArray(t) ? pontos : { ...t, points: pontos }) as T;

/** O tamanho interno que o quadro deveria ter para a largura/altura exibidas (regra da própria biblioteca) */
export function tamanhoInterno(exibido: Tamanho, devicePixelRatio: number | undefined): Tamanho {
  const ratio = Math.max(devicePixelRatio ?? 1, 1);
  return { largura: exibido.largura * ratio, altura: exibido.altura * ratio };
}

/** O quadro precisa ser redimensionado? Só se o tamanho interno não bate com o exibido */
export function precisaRedimensionar(interno: Tamanho, exibido: Tamanho, devicePixelRatio: number | undefined): boolean {
  const alvo = tamanhoInterno(exibido, devicePixelRatio);
  return interno.largura !== alvo.largura || interno.altura !== alvo.altura;
}

/**
 * Os traços do quadro de tamanho `de` levados ao quadro de tamanho `para`, SEM distorcer (uma escala só nos
 * dois eixos):
 *  - cabe no quadro novo: mantém o tamanho (escala 1) — girar e voltar devolve a assinatura exatamente igual;
 *  - não cabe (o quadro ficou menor que o desenho): encolhe só o necessário para caber inteiro, com margem;
 *  - o centro da assinatura fica na mesma posição RELATIVA do quadro (no meio continua no meio), sem sair dele.
 * Tamanho de/para zerado (quadro escondido) ou sem pontos: não mexe.
 */
export function escalarTracos<T extends Traco>(tracos: T[], de: Tamanho, para: Tamanho, margem = MARGEM_ASSINATURA): T[] {
  if (de.largura <= 0 || de.altura <= 0 || para.largura <= 0 || para.altura <= 0) return tracos;
  if (de.largura === para.largura && de.altura === para.altura) return tracos;
  const pontos = tracos.flatMap(pontosDe);
  if (!pontos.length) return tracos;
  const xs = pontos.map((p) => p.x), ys = pontos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [w, h] = [x1 - x0, y1 - y0];
  const cabeL = Math.max(para.largura - 2 * margem, 1), cabeA = Math.max(para.altura - 2 * margem, 1);
  const f = Math.min(1, w > 0 ? cabeL / w : 1, h > 0 ? cabeA / h : 1);
  // Centro: a mesma posição relativa no quadro novo, preso para o desenho inteiro caber
  const prender = (v: number, meio: number, total: number) => Math.min(Math.max(v, margem + meio), Math.max(total - margem - meio, margem + meio));
  const cx = prender(((x0 + x1) / 2 / de.largura) * para.largura, (w * f) / 2, para.largura);
  const cy = prender(((y0 + y1) / 2 / de.altura) * para.altura, (h * f) / 2, para.altura);
  const [ox, oy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  return tracos.map((t) => comPontos(t, pontosDe(t).map((p) => ({ ...p, x: (p.x - ox) * f + cx, y: (p.y - oy) * f + cy }))));
}

/** A caixa que contém todos os pontos, com margem, presa ao quadro. Sem ponto: null (quadro vazio). */
export function caixaDosTracos(tracos: Traco[], margem: number, quadro: Tamanho): { x: number; y: number; largura: number; altura: number } | null {
  const pontos = tracos.flatMap(pontosDe);
  if (!pontos.length) return null;
  const xs = pontos.map((p) => p.x), ys = pontos.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - margem)), y0 = Math.max(0, Math.floor(Math.min(...ys) - margem));
  const x1 = Math.min(quadro.largura, Math.ceil(Math.max(...xs) + margem)), y1 = Math.min(quadro.altura, Math.ceil(Math.max(...ys) + margem));
  return { x: x0, y: y0, largura: Math.max(1, x1 - x0), altura: Math.max(1, y1 - y0) };
}


/** A imagem (PNG) a salvar: só a assinatura, recortada com margem, em escala fixa (independe do aparelho) */
export function exportarAssinatura(quadro: SignatureCanvas): string {
  const canvas = quadro.getCanvas();
  const exibido = { largura: canvas.offsetWidth, altura: canvas.offsetHeight };
  const caixa = caixaDosTracos(quadro.toData() as unknown as Traco[], MARGEM_ASSINATURA, exibido);
  if (!caixa || !exibido.largura) return canvas.toDataURL("image/png");
  const ratio = canvas.width / exibido.largura; // pixels internos por pixel de tela
  const saida = document.createElement("canvas");
  saida.width = Math.round(caixa.largura * ESCALA_ASSINATURA);
  saida.height = Math.round(caixa.altura * ESCALA_ASSINATURA);
  saida.getContext("2d")?.drawImage(canvas, caixa.x * ratio, caixa.y * ratio, caixa.largura * ratio, caixa.altura * ratio, 0, 0, saida.width, saida.height);
  return saida.toDataURL("image/png");
}

/** Mantém a assinatura quando o quadro muda de tamanho (janela, rotação, layout), redesenhando em escala */
export function useAssinaturaPreservada(ref: RefObject<SignatureCanvas | null>): void {
  useEffect(() => {
    function aoRedimensionar() {
      const quadro = ref.current;
      if (!quadro) return;
      const canvas = quadro.getCanvas();
      const exibido = { largura: canvas.offsetWidth, altura: canvas.offsetHeight };
      if (!exibido.largura || !exibido.altura) return; // escondido: espera aparecer
      if (!precisaRedimensionar({ largura: canvas.width, altura: canvas.height }, exibido, window.devicePixelRatio)) return;
      // O tamanho de TELA em que os pontos foram desenhados (o interno dividido pela escala que a biblioteca usou)
      const ratioAnterior = Math.max(canvas.getContext("2d")?.getTransform?.().a ?? window.devicePixelRatio ?? 1, 1);
      const anterior = { largura: canvas.width / ratioAnterior, altura: canvas.height / ratioAnterior };
      const tracos = quadro.toData() as unknown as Traco[];
      quadro._resizeCanvas(); // redimensiona e limpa
      if (tracos.length) quadro.fromData(escalarTracos(tracos, anterior, exibido) as unknown as ReturnType<SignatureCanvas["toData"]>);
    }
    window.addEventListener("resize", aoRedimensionar);
    window.addEventListener("orientationchange", aoRedimensionar);
    // O quadro também muda de tamanho sem a janela mudar (o modal reorganiza): observa o próprio canvas
    const canvas = ref.current?.getCanvas();
    const observador = typeof ResizeObserver !== "undefined" && canvas instanceof Element ? new ResizeObserver(() => aoRedimensionar()) : null;
    if (observador && canvas) observador.observe(canvas);
    return () => {
      window.removeEventListener("resize", aoRedimensionar);
      window.removeEventListener("orientationchange", aoRedimensionar);
      observador?.disconnect();
    };
  }, [ref]);
}

/* ───────── D6 — assinar em tela cheia (paisagem só nessa tela) ───────── */

/** O que o navegador oferece para a tela cheia e a orientação (injetável para testar) */
export interface AmbienteTela {
  raiz?: { requestFullscreen?: () => Promise<void> } | null;
  emTelaCheia?: () => boolean;
  sairTelaCheia?: () => Promise<void>;
  orientacao?: { lock?: (o: "landscape") => Promise<void>; unlock?: () => void } | null;
}
export interface EstadoPaisagem { telaCheia: boolean; travou: boolean }

/** O ambiente real do navegador */
export function ambienteDoNavegador(): AmbienteTela {
  if (typeof document === "undefined") return {};
  const d = document as Document & { exitFullscreen?: () => Promise<void> };
  const o = (typeof screen !== "undefined" ? screen.orientation : null) as AmbienteTela["orientacao"];
  return {
    raiz: document.documentElement as AmbienteTela["raiz"],
    emTelaCheia: () => !!document.fullscreenElement,
    sairTelaCheia: d.exitFullscreen ? () => d.exitFullscreen!() : undefined,
    orientacao: o ?? null,
  };
}

/**
 * Entra em tela cheia e trava em PAISAGEM — onde o aparelho deixa (Android/Chrome; o lock exige tela cheia).
 * No iPhone não há trava: a tela de assinatura pede para girar (e funciona deitada ou em pé). Nunca falha:
 * devolve o que conseguiu, para desfazer só isso ao sair.
 */
export async function entrarPaisagem(a: AmbienteTela): Promise<EstadoPaisagem> {
  const estado: EstadoPaisagem = { telaCheia: false, travou: false };
  if (a.raiz?.requestFullscreen && !a.emTelaCheia?.()) {
    try { await a.raiz.requestFullscreen(); estado.telaCheia = true; } catch { /* o navegador recusou: segue sem */ }
  }
  if (a.orientacao?.lock) {
    try { await a.orientacao.lock("landscape"); estado.travou = true; } catch { /* sem trava (iPhone, desktop) */ }
  }
  return estado;
}

/** Desfaz só o que entrarPaisagem fez: o resto do app volta a girar livre e sai da tela cheia */
export async function sairPaisagem(a: AmbienteTela, estado: EstadoPaisagem): Promise<void> {
  if (estado.travou) { try { a.orientacao?.unlock?.(); } catch { /* nada */ } }
  if (estado.telaCheia && a.emTelaCheia?.()) { try { await a.sairTelaCheia?.(); } catch { /* nada */ } }
}
