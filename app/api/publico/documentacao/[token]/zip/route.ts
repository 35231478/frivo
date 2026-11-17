import { type NextRequest } from "next/server";
import { respostaArquivo } from "@/lib/pdf/resposta";
import { zipDaDocumentacao } from "@/lib/documentacao/pacote-server";
import { origemDa, responderLink } from "@/lib/documentacao/pacote-rotas";

/** O pacote inteiro em zip, pelo link — com as mesmas pastas que a empresa escolheu. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return responderLink(req, async () => respostaArquivo(await zipDaDocumentacao(token, origemDa(req)), "application/zip"));
}
