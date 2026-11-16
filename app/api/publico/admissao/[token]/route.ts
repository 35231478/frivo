import { NextRequest } from "next/server";
import { abrirAdmissao } from "@/lib/admissao/admissao-server";
import { responderPublico } from "@/lib/admissao/admissao-rotas";

/**
 * O colaborador abriu o link: devolve SÓ o que a tela pública pode ver (a empresa, o nome dele, o
 * cargo e, depois do consentimento, o formulário e os documentos). Nada de outro colaborador, e o
 * CPF do convite vai mascarado — quem está preenchendo digita o próprio para conferir.
 * Sem login. O limite por IP conta os tokens recusados.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return responderPublico(req, () => abrirAdmissao(token));
}
