import { NextRequest } from "next/server";
import { enviarDocumento } from "@/lib/admissao/admissao-server";
import { corpo, responderPublico } from "@/lib/admissao/admissao-rotas";

/**
 * Um documento que a empresa pede, gravado nos anexos do colaborador. O tipo do arquivo é decidido
 * pelos BYTES (um HTML com nome de PDF não passa), como em todo anexo do sistema.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await corpo(req);
  return responderPublico(req, () => enviarDocumento(token, {
    docId: typeof b.docId === "string" ? b.docId : "",
    nome: typeof b.nome === "string" ? b.nome : "",
    arquivoUrl: typeof b.arquivoUrl === "string" ? b.arquivoUrl : "",
  }), 201);
}
