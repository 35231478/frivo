import { type NextRequest } from "next/server";
import { abrirDocumentacao } from "@/lib/documentacao/pacote-server";
import { jsonSemCache, origemDa, responderLink } from "@/lib/documentacao/pacote-rotas";

/**
 * O cliente abriu o link: devolve SÓ os arquivos deste pacote — os colaboradores e os tipos que a
 * empresa marcou, e nada além. Sem login. Registra o acesso; token recusado conta no limite por IP.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return responderLink(req, async () => jsonSemCache(await abrirDocumentacao(token, origemDa(req))));
}
