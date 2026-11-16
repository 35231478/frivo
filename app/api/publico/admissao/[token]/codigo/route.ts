import { NextRequest, NextResponse } from "next/server";
import { enviarCodigoEmail } from "@/lib/admissao/admissao-server";
import { conferirBloqueio, registrarTentativa } from "@/lib/acesso/limite";
import { corpo, ipDaRequisicao, responderPublico } from "@/lib/admissao/admissao-rotas";

/**
 * Manda o código de verificação para o e-mail digitado. O banco guarda só o HASH do código.
 * Limite próprio (por IP e por admissão): o link da admissão não vira máquina de mandar e-mail
 * para o endereço de outra pessoa.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await corpo(req);
  const alvos = { ip: ipDaRequisicao(req.headers), usuarioId: token };
  const bloqueio = await conferirBloqueio("ADMISSAO_CODIGO", alvos);
  if (bloqueio.bloqueado) {
    return NextResponse.json({ erro: `Muitos códigos pedidos. Tente de novo em ${bloqueio.minutos} min.` }, { status: 429 });
  }
  await registrarTentativa("ADMISSAO_CODIGO", alvos);
  return responderPublico(req, () => enviarCodigoEmail(token, typeof b.email === "string" ? b.email : ""));
}
