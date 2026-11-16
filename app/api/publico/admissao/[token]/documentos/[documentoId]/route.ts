import { NextRequest } from "next/server";
import { removerDocumento } from "@/lib/admissao/admissao-server";
import { responderPublico } from "@/lib/admissao/admissao-rotas";

/** O colaborador apaga um arquivo que ele mesmo mandou (enquanto não assinou). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string; documentoId: string }> }) {
  const { token, documentoId } = await params;
  return responderPublico(req, async () => {
    await removerDocumento(token, documentoId);
    return { ok: true };
  });
}
