import { NextResponse } from "next/server";
import { respostaArquivo } from "@/lib/pdf/resposta";
import { ErroDocumentacao, zipDoEnvio } from "@/lib/documentacao/pacote-server";
import { guardaDeEnvio } from "@/lib/documentacao/pacote-rotas";

type Params = { params: Promise<{ id: string }> };

/** O pacote em zip, com as pastas que a pessoa escolheu. Registra o download no histórico. */
export async function GET(_req: Request, { params }: Params) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const { id } = await params;
  try {
    return respostaArquivo(await zipDoEnvio(id, ator), "application/zip");
  } catch (e) {
    if (e instanceof ErroDocumentacao) return NextResponse.json({ erro: e.message, detalhe: e.detalhe }, { status: e.status });
    throw e;
  }
}
