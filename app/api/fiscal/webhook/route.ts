import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroWebhook, gerarWebhook } from "@/lib/nfse/webhook-server";

/**
 * POST /api/fiscal/webhook — gera (ou gira) a URL do aviso automático do PlugNotas da empresa da
 * sessão e tenta cadastrá-la lá. A URL (com o segredo) volta SÓ nesta resposta; girar invalida a
 * anterior na hora. Financeiro › Fiscal.
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const base = (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  try {
    return NextResponse.json(await gerarWebhook(user.empresaId, user.id, base));
  } catch (e) {
    if (e instanceof ErroWebhook) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
