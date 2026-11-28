/**
 * CHAT-1 — a foto da mensagem, preparada NO APARELHO antes de enviar (escritório e app): reduzida pelo mesmo
 * `reduzirImagem` das outras fotos do sistema (orientação certa, lado maior limitado, JPEG) e com a miniatura do balão.
 * Desce pelos degraus até caber no alvo (≤ 200 KB; miniatura ≤ 15 KB); se nem o menor couber no limite, avisa.
 */
import { bytesDataUrl, reduzirImagem } from "@/lib/imagem-cliente";
import { ALVO_FOTO_BYTES, ALVO_MINIATURA_BYTES, DEGRAUS_FOTO, DEGRAUS_MINIATURA, FOTO_TAMANHO_MAX, MSG_FOTO_GRANDE } from "@/lib/chat/regras";

export type FotoPreparada = { ok: true; foto: string; miniatura: string } | { ok: false; erro: string };
type Redutor = (f: Blob, lado: number, q: number) => Promise<{ imagem: { dataUrl: string } }>;

/** Reduz pelos degraus até caber no alvo (o 1º que couber); nenhum coube: o último (o menor). */
async function reduzirAte(arquivo: Blob, degraus: typeof DEGRAUS_FOTO, alvo: number, reduzir: Redutor): Promise<string> {
  let atual = "";
  for (const [lado, q] of degraus) {
    atual = (await reduzir(arquivo, lado, q)).imagem.dataUrl;
    if (bytesDataUrl(atual) <= alvo) break;
  }
  return atual;
}

/** `reduzir` existe para os testes (o padrão usa o canvas do navegador). */
export async function prepararFoto(arquivo: Blob, reduzir: Redutor = reduzirImagem): Promise<FotoPreparada> {
  if (!arquivo.type.startsWith("image/")) return { ok: false, erro: "Escolha uma foto (JPG, PNG ou WEBP)." };
  try {
    const foto = await reduzirAte(arquivo, DEGRAUS_FOTO, ALVO_FOTO_BYTES, reduzir);
    if (bytesDataUrl(foto) > FOTO_TAMANHO_MAX) return { ok: false, erro: MSG_FOTO_GRANDE };
    const miniatura = await reduzirAte(arquivo, DEGRAUS_MINIATURA, ALVO_MINIATURA_BYTES, reduzir);
    return { ok: true, foto, miniatura };
  } catch {
    return { ok: false, erro: "Não foi possível ler esta foto. Tente outra." };
  }
}
