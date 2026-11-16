import { type NextRequest } from "next/server";
import { corpo, guardaDeDocumentos, responderDocumento } from "@/lib/documentos/documentos-rotas";
import { cancelarDocumento } from "@/lib/documentos/documentos-server";

type Params = { params: Promise<{ id: string }> };

/** Cancelar não apaga: guarda quem, quando e por quê, e tira o anexo da ficha (com rastro). */
export async function POST(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeDocumentos();
  if (!ator) return resposta;
  const { id } = await params;
  const b = await corpo(req);
  return responderDocumento(() => cancelarDocumento(
    id, ator.empresaId, String(b.motivo ?? ""),
    { usuarioId: ator.usuarioId, podeDisciplinar: ator.podeDisciplinar },
  ));
}
