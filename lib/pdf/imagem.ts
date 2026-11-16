/**
 * Foto dentro do PDF — a selfie da assinatura, hoje no contrato da admissão e nos documentos
 * gerados por modelo. Fica aqui, na maquinaria compartilhada, porque os dois precisam do mesmo
 * cuidado: o tipo sai dos BYTES, e qualquer coisa que não abra fica de fora sem derrubar o papel.
 */

import type { PDFDocument, PDFImage } from "pdf-lib";
import { identificarTipo } from "@/lib/anexos";
import { decodificarDataUrl } from "@/lib/anexos-server";

/** A imagem embutida, ou null quando não é foto (ou não abre). Nunca lança. */
export async function embutirFoto(doc: PDFDocument, dataUrl: string | null | undefined): Promise<PDFImage | null> {
  if (!dataUrl) return null;
  const bytes = decodificarDataUrl(dataUrl);
  if (!bytes) return null;
  const tipo = identificarTipo(bytes, "foto");
  try {
    if (tipo === "image/png") return await doc.embedPng(bytes);
    if (tipo === "image/jpeg") return await doc.embedJpg(bytes);
  } catch { return null; }
  return null;
}
