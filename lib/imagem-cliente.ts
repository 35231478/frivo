/**
 * Utilitários de imagem no navegador (cadastro de equipamento por foto).
 * - reduzirImagem: corrige a orientação (EXIF), limita o lado maior e recomprime
 *   em JPEG — a foto do celular (3–8 MB) vira ~200–500 KB antes de ir para a IA
 *   e para o banco (fotos do equipamento são guardadas em base64).
 * - avaliarQualidade: checagem local, grátis, de foto escura/tremida, para avisar
 *   a pessoa ANTES de gastar uma chamada de IA. É só um aviso: ela pode seguir.
 */

export interface ImagemReduzida { dataUrl: string; largura: number; altura: number; bytes: number }
export interface QualidadeImagem { escura: boolean; borrada: boolean; nitidez: number; brilho: number }

async function carregar(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* cai no <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function reduzirImagem(file: Blob, ladoMax = 1600, qualidade = 0.82): Promise<{ imagem: ImagemReduzida; qualidade: QualidadeImagem }> {
  const fonte = await carregar(file);
  const w0 = "naturalWidth" in fonte ? fonte.naturalWidth : fonte.width;
  const h0 = "naturalHeight" in fonte ? fonte.naturalHeight : fonte.height;
  const escala = Math.min(1, ladoMax / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * escala));
  const h = Math.max(1, Math.round(h0 * escala));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // Fundo branco: PNG/WEBP com transparência não fica preto ao virar JPEG
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(fonte, 0, 0, w, h);
  if ("close" in fonte) fonte.close();
  const dataUrl = canvas.toDataURL("image/jpeg", qualidade);
  const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
  return { imagem: { dataUrl, largura: w, altura: h, bytes }, qualidade: avaliarQualidade(canvas) };
}

/** Lado maior e qualidade das fotos de galeria (equipamento/veículo): ~150–400 KB cada. */
export const FOTO_GALERIA = { ladoMax: 1280, qualidade: 0.8 } as const;
/** Acima disto, uma foto já salva (ex.: original do celular de antes da compressão) é recomprimida. */
const LIMITE_FOTO_BYTES = 600 * 1024;

export function bytesDataUrl(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  return Math.floor(((dataUrl.length - i - 1) * 3) / 4);
}

/**
 * Garante que as fotos vão leves para o servidor (corpo da requisição no Vercel ≤ 4,5 MB).
 * Fotos novas já chegam reduzidas pela galeria; aqui pegamos as antigas, salvas com o
 * tamanho original. Se uma não puder ser lida, fica como está.
 */
export async function aliviarFotos(fotos: string[]): Promise<string[]> {
  return Promise.all(fotos.map(async (f) => {
    if (!f.startsWith("data:image/") || bytesDataUrl(f) <= LIMITE_FOTO_BYTES) return f;
    try {
      const blob = await (await fetch(f)).blob();
      const { imagem } = await reduzirImagem(blob, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade);
      return imagem.bytes < bytesDataUrl(f) ? imagem.dataUrl : f;
    } catch { return f; }
  }));
}

/** Brilho médio e variância do Laplaciano (medida clássica de foco) numa versão reduzida. */
export function avaliarQualidade(origem: HTMLCanvasElement): QualidadeImagem {
  const L = 320;
  const escala = Math.min(1, L / Math.max(origem.width, origem.height));
  const w = Math.max(3, Math.round(origem.width * escala));
  const h = Math.max(3, Math.round(origem.height * escala));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(origem, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const cinza = new Float32Array(w * h);
  let soma = 0;
  for (let i = 0; i < w * h; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    cinza[i] = v; soma += v;
  }
  const brilho = soma / (w * h);
  let n = 0, media = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = cinza[i - w] + cinza[i + w] + cinza[i - 1] + cinza[i + 1] - 4 * cinza[i];
      n++; const d = lap - media; media += d / n; m2 += d * (lap - media);
    }
  }
  const nitidez = n > 1 ? m2 / (n - 1) : 0;
  // Limiares conservadores: só avisam em casos claros (escuro de verdade / sem nenhuma borda)
  return { escura: brilho < 45, borrada: nitidez < 40, nitidez: Math.round(nitidez), brilho: Math.round(brilho) };
}
