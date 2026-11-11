/**
 * Leitura de QR Code no navegador, em QUALQUER navegador — inclusive iPhone (Safari e Chrome do iOS,
 * que usam o WebKit e não têm o `BarcodeDetector`). Tudo acontece NO APARELHO: nada vai para a rede,
 * então lê sem sinal.
 *
 * Dois motores:
 *  - "nativo": o `BarcodeDetector` do navegador, quando ele existe E lê QR de verdade (há navegadores
 *    que têm a classe mas nenhum formato — aí não serve);
 *  - "jsqr": a biblioteca jsQR, que lê o QR dos pixels de um canvas. É o que vale no iPhone e o
 *    reserva de todos os outros (se o nativo falhar no meio, a leitura passa para ele).
 *
 * As fontes: o vídeo da câmera (um quadro por vez) ou uma FOTO do QR (quando a câmera não abre).
 */
import jsQR from "jsqr";

export type MotorQr = "nativo" | "jsqr";

/** Lado (px) do quadro da câmera entregue ao jsQR: menor = mais rápido; 480 lê bem um QR enquadrado */
export const LADO_QUADRO = 480;
/** Tamanhos (maior lado, px) tentados numa FOTO: a foto vem grande; reduzir ajuda o QR pequeno e o ruído */
export const LADOS_FOTO = [1600, 1000, 600] as const;

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Lê um QR dos pixels (RGBA). `completo` tenta também o QR invertido (claro sobre escuro) — mais
 * lento, usado na foto; na câmera, o próximo quadro é a nova tentativa.
 */
export function lerQrDosPixels(dados: Uint8ClampedArray, largura: number, altura: number, completo = false): string | null {
  if (!largura || !altura || dados.length < largura * altura * 4) return null;
  try {
    return texto(jsQR(dados, largura, altura, { inversionAttempts: completo ? "attemptBoth" : "dontInvert" })?.data);
  } catch {
    return null;
  }
}

type FonteImagem = HTMLVideoElement | HTMLImageElement | ImageBitmap | HTMLCanvasElement;
export type DetectorNativo = (fonte: FonteImagem) => Promise<string | null>;

interface ClasseBarcodeDetector {
  new (o: { formats: string[] }): { detect: (fonte: unknown) => Promise<{ rawValue?: string }[]> };
  getSupportedFormats?: () => Promise<string[]>;
}

/** O detector nativo do navegador — só quando ele existe e lê QR. Senão, null (vale o jsQR). */
export async function detectorNativo(): Promise<DetectorNativo | null> {
  const Classe = (globalThis as { BarcodeDetector?: ClasseBarcodeDetector }).BarcodeDetector;
  if (typeof Classe !== "function") return null;
  try {
    const formatos = typeof Classe.getSupportedFormats === "function" ? await Classe.getSupportedFormats() : ["qr_code"];
    if (!formatos.includes("qr_code")) return null;
    const detector = new Classe({ formats: ["qr_code"] });
    return async (fonte) => texto((await detector.detect(fonte))[0]?.rawValue);
  } catch {
    return null;
  }
}

/** O recorte QUADRADO central de uma imagem (é o que o visor mostra) e o tamanho final. */
export function recorteCentral(largura: number, altura: number, ladoMax: number = LADO_QUADRO): { sx: number; sy: number; lado: number; destino: number } {
  const lado = Math.min(largura, altura);
  return { sx: Math.round((largura - lado) / 2), sy: Math.round((altura - lado) / 2), lado, destino: Math.max(1, Math.min(lado, ladoMax)) };
}

/** A imagem inteira reduzida para caber em `ladoMax` (nunca amplia). */
export function reducao(largura: number, altura: number, ladoMax: number): { largura: number; altura: number } {
  const fator = Math.min(1, ladoMax / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * fator)), altura: Math.max(1, Math.round(altura * fator)) };
}

const contexto = (canvas: HTMLCanvasElement) => canvas.getContext("2d", { willReadFrequently: true });

/** Lê o QR do quadro atual do vídeo (recorte central), com o jsQR. null = neste quadro, nada. */
export function lerQrDoVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return null;
  const { sx, sy, lado, destino } = recorteCentral(w, h);
  canvas.width = destino; canvas.height = destino;
  const ctx = contexto(canvas);
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, lado, lado, 0, 0, destino, destino);
  return lerQrDosPixels(ctx.getImageData(0, 0, destino, destino).data, destino, destino);
}

/** Abre o arquivo de imagem (foto do QR) como algo que o canvas desenha. */
async function abrirImagem(arquivo: Blob): Promise<{ imagem: ImageBitmap | HTMLImageElement; largura: number; altura: number; fechar: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(arquivo);
      return { imagem: bitmap, largura: bitmap.width, altura: bitmap.height, fechar: () => bitmap.close?.() };
    } catch { /* formato que o createImageBitmap não abre: tenta pela tag <img> */ }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    await new Promise<void>((ok, falha) => { img.onload = () => ok(); img.onerror = () => falha(new Error("imagem inválida")); img.src = url; });
    return { imagem: img, largura: img.naturalWidth, altura: img.naturalHeight, fechar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Lê o QR de uma FOTO (a saída quando a câmera ao vivo não abre). Tenta o detector nativo e, depois,
 * o jsQR em alguns tamanhos. null = não achou QR na foto. Lança se o arquivo não for uma imagem.
 */
export async function lerQrDaFoto(arquivo: Blob, nativo?: DetectorNativo | null): Promise<string | null> {
  const { imagem, largura, altura, fechar } = await abrirImagem(arquivo);
  try {
    if (!largura || !altura) return null;
    if (nativo) {
      try { const v = await nativo(imagem); if (v) return v; } catch { /* segue para o jsQR */ }
    }
    const canvas = document.createElement("canvas");
    const ctx = contexto(canvas);
    if (!ctx) return null;
    for (const ladoMax of LADOS_FOTO) {
      const d = reducao(largura, altura, ladoMax);
      canvas.width = d.largura; canvas.height = d.altura;
      ctx.drawImage(imagem, 0, 0, d.largura, d.altura);
      const v = lerQrDosPixels(ctx.getImageData(0, 0, d.largura, d.altura).data, d.largura, d.altura, true);
      if (v) return v;
      if (d.largura === largura && d.altura === altura) break; // a foto já é menor que isto: reduzir mais não muda
    }
    return null;
  } finally {
    fechar();
  }
}

/* ───────── a câmera ───────── */

/** Por que a câmera não abriu — sempre com a saída (foto ou código digitado). */
export function motivoSemCamera(erro: unknown): string {
  const nome = (erro as { name?: string } | null)?.name ?? "";
  if (nome === "NotAllowedError" || nome === "SecurityError") return "Câmera bloqueada neste navegador. Libere o acesso, tire uma foto do QR ou digite o código.";
  if (nome === "NotFoundError" || nome === "OverconstrainedError") return "Nenhuma câmera encontrada. Tire uma foto do QR ou digite o código.";
  if (nome === "NotReadableError" || nome === "AbortError") return "A câmera está em uso por outro app. Tire uma foto do QR ou digite o código.";
  return "Não foi possível abrir a câmera. Tire uma foto do QR ou digite o código.";
}

export const MSG_SEM_API_CAMERA = "Este navegador não abre a câmera aqui. Tire uma foto do QR ou digite o código.";
export const MSG_FOTO_SEM_QR = "Não achei um QR nessa foto. Enquadre o código inteiro, de perto, e tente de novo.";
export const MSG_FOTO_INVALIDA = "Não consegui abrir essa foto. Tire outra ou digite o código.";

/**
 * Pede a câmera traseira (getUserMedia). Se o aparelho não tiver "traseira" (notebook, alguns
 * tablets), aceita qualquer câmera. Lança o erro do navegador quando ela não abre.
 */
export async function abrirCamera(): Promise<MediaStream> {
  const midia = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!midia?.getUserMedia) throw Object.assign(new Error(MSG_SEM_API_CAMERA), { name: "SemApiCamera" });
  try {
    return await midia.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (e) {
    if ((e as { name?: string })?.name !== "OverconstrainedError") throw e;
    return midia.getUserMedia({ video: true, audio: false });
  }
}

export const pararCamera = (stream: MediaStream | null | undefined) => { stream?.getTracks().forEach((t) => t.stop()); };
