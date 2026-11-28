/**
 * CHAT-1 — a foto da mensagem, preparada NO APARELHO antes de enviar (escritório e app): reduzida pelo mesmo
 * `reduzirImagem` das outras fotos do sistema (orientação certa, lado maior limitado, JPEG) e com a miniatura do balão.
 * Se mesmo reduzida passar do limite, reduz mais uma vez; se ainda passar, avisa (a pessoa tira outra).
 */
import { bytesDataUrl, reduzirImagem } from "@/lib/imagem-cliente";
import { FOTO_LADO_MAX, FOTO_QUALIDADE, FOTO_TAMANHO_MAX, MINIATURA_LADO, MINIATURA_QUALIDADE, MSG_FOTO_GRANDE } from "@/lib/chat/regras";

export type FotoPreparada = { ok: true; foto: string; miniatura: string } | { ok: false; erro: string };
type Redutor = (f: Blob, lado: number, q: number) => Promise<{ imagem: { dataUrl: string } }>;

/** `reduzir` existe para os testes (o padrão usa o canvas do navegador). */
export async function prepararFoto(arquivo: Blob, reduzir: Redutor = reduzirImagem): Promise<FotoPreparada> {
  if (!arquivo.type.startsWith("image/")) return { ok: false, erro: "Escolha uma foto (JPG, PNG ou WEBP)." };
  try {
    let foto = (await reduzir(arquivo, FOTO_LADO_MAX, FOTO_QUALIDADE)).imagem.dataUrl;
    if (bytesDataUrl(foto) > FOTO_TAMANHO_MAX) foto = (await reduzir(arquivo, 1280, 0.7)).imagem.dataUrl;
    if (bytesDataUrl(foto) > FOTO_TAMANHO_MAX) return { ok: false, erro: MSG_FOTO_GRANDE };
    const miniatura = (await reduzir(arquivo, MINIATURA_LADO, MINIATURA_QUALIDADE)).imagem.dataUrl;
    return { ok: true, foto, miniatura };
  } catch {
    return { ok: false, erro: "Não foi possível ler esta foto. Tente outra." };
  }
}
