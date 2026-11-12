/**
 * Ajuda dos testes do documento do PMOC: lê de volta o que foi escrito num PDF gerado pelo sistema
 * (descomprime as instruções de desenho de cada página e junta os textos) e cria PDFs/imagens de exemplo.
 */
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

/** O texto escrito no PDF, um trecho por linha */
export async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const win = new TextDecoder("windows-1252");
  const partes: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let conteudo: Uint8Array;
    try { conteudo = decodePDFRawStream(obj).decode(); } catch { continue; }
    for (const m of Buffer.from(conteudo).toString("latin1").matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) partes.push(win.decode(Buffer.from(m[1], "hex")));
  }
  return partes.join("\n");
}

/** Largura e altura de cada página, em pontos (arredondado) */
export const paginasDe = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);

/** Um PDF pequeno de `n` páginas (300×400), fazendo as vezes do arquivo da ART */
export async function pdfDeTeste(n: number, texto = "ART de teste"): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([300, 400]).drawText(`${texto} ${i + 1}`, { x: 20, y: 300, size: 12 });
  return d.save();
}

/** PNG de 1×1 ponto */
export const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

export const dataUrl = (bytes: Uint8Array, tipo: string) => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
