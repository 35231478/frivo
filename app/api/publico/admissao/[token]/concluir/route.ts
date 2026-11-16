import { NextRequest } from "next/server";
import { concluirPreenchimento } from "@/lib/admissao/admissao-server";
import { responderPublico } from "@/lib/admissao/admissao-rotas";

/**
 * Terminou de preencher: o que foi digitado passa para o cadastro do colaborador (e os dependentes)
 * e a admissão fica aguardando a assinatura. O CPF digitado tem de casar com o do convite.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return responderPublico(req, () => concluirPreenchimento(token));
}
