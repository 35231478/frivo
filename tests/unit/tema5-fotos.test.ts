/**
 * Tema 5 (A) — fotos do cadastro de equipamento não estouram o limite de 4,5 MB do Vercel.
 * A galeria já reduz a foto nova (ver tema5-equipamento-ui); aqui a rede de segurança do envio:
 * foto ANTIGA grande é recomprimida e o TOTAL do conjunto é conferido.
 */
import { describe, expect, it, vi } from "vitest";
import { FOTO_GALERIA, LIMITE_TOTAL_FOTOS_BYTES, aliviarFotos, bytesDataUrl } from "@/lib/imagem-cliente";

/** Uma "foto" data URL com N bytes de imagem */
const fotoDe = (bytes: number, marca = "A") => `data:image/jpeg;base64,${marca.repeat(Math.ceil((bytes * 4) / 3))}`;
/** Redutor de mentira: devolve uma foto com a fração pedida do tamanho original */
const redutor = (fracao: number) => vi.fn(async (blob: Blob) => {
  const bytes = Math.floor(blob.size * fracao);
  return { imagem: { dataUrl: fotoDe(bytes, "R"), bytes } };
});
const total = (fotos: string[]) => fotos.reduce((n, f) => n + (f.startsWith("data:image/") ? bytesDataUrl(f) : 0), 0);

describe("aliviarFotos", () => {
  it("fotos já leves (até 600 KB cada, conjunto dentro do teto) passam intactas — nada é recomprimido", async () => {
    const reduzir = redutor(0.5);
    const fotos = [fotoDe(300_000), fotoDe(550_000), fotoDe(200_000)];
    expect(await aliviarFotos(fotos, reduzir)).toEqual(fotos);
    expect(reduzir).not.toHaveBeenCalled();
  });

  it("foto ANTIGA grande (salva no tamanho original) é reduzida como a galeria faz: 1280 px, qualidade 0,8", async () => {
    const reduzir = redutor(0.1);
    const grande = fotoDe(2_000_000);
    const [saida] = await aliviarFotos([grande], reduzir);
    expect(reduzir).toHaveBeenCalledTimes(1);
    expect(reduzir.mock.calls[0].slice(1)).toEqual([FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade]);
    expect(bytesDataUrl(saida)).toBeLessThan(250_000);
  });

  it("o TOTAL também é conferido: 5 fotos de ~590 KB (cada uma passa sozinha) são apertadas, da maior para a menor, até caber", async () => {
    const reduzir = redutor(0.5);
    const fotos = [fotoDe(590_000), fotoDe(580_000), fotoDe(595_000), fotoDe(570_000), fotoDe(585_000)];
    expect(total(fotos)).toBeGreaterThan(LIMITE_TOTAL_FOTOS_BYTES);
    const saida = await aliviarFotos(fotos, reduzir);
    expect(total(saida)).toBeLessThanOrEqual(LIMITE_TOTAL_FOTOS_BYTES);
    expect(saida).toHaveLength(5); // nenhuma foto some
    expect(reduzir).toHaveBeenCalledTimes(1); // só o necessário: a maior já resolve
    expect(saida[2]).not.toBe(fotos[2]); // a maior (595 KB) foi a apertada
    expect([saida[0], saida[1], saida[3], saida[4]]).toEqual([fotos[0], fotos[1], fotos[3], fotos[4]]);
    expect(reduzir.mock.calls[0].slice(1)).toEqual([1024, 0.7]);
  });

  it("o teto do total cabe nos 4,5 MB do Vercel mesmo em base64, com folga para o resto do cadastro", () => {
    const emBase64 = Math.ceil((LIMITE_TOTAL_FOTOS_BYTES * 4) / 3);
    expect(emBase64).toBeLessThan(4_000_000);
  });

  it("nunca perde foto: a que não dá para ler fica como está; endereço que não é data URL não é tocado; redução que não diminui é descartada", async () => {
    const quebra = vi.fn(async () => { throw new Error("não é imagem"); });
    const grande = fotoDe(900_000);
    expect(await aliviarFotos([grande, "/api/equipamentos/eq1/foto"], quebra)).toEqual([grande, "/api/equipamentos/eq1/foto"]);
    const naoDiminui = redutor(1.2);
    expect(await aliviarFotos([grande], naoDiminui)).toEqual([grande]);
    expect(await aliviarFotos([], redutor(0.5))).toEqual([]);
  });
});
