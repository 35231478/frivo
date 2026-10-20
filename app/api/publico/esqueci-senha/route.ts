import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { conferirBloqueio, ipDaRequisicao, registrarTentativa } from "@/lib/acesso/limite";
import { MENSAGEM_ESQUECI, enviarRecuperacaoSenha, urlBasePublica } from "@/lib/acesso/recuperacao";

/**
 * Pública: "Esqueci minha senha". A resposta é SEMPRE a mesma (exista o e-mail ou não) e sai antes do
 * envio — o e-mail é mandado depois da resposta (`after`), então nem o tempo de resposta revela se o
 * e-mail existe. Limite por e-mail e por IP (lib/acesso/limite), contado igual para qualquer e-mail.
 */
const schema = z.object({ email: z.string().trim().max(200).email("Informe um e-mail válido.") }).strict();

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { email } = parsed.data;

  const alvos = { email, ip: ipDaRequisicao(req.headers) };
  const bloqueio = await conferirBloqueio("ESQUECI_SENHA", alvos);
  if (bloqueio.bloqueado) {
    return NextResponse.json({ erro: `Muitos pedidos seguidos. Aguarde ${bloqueio.minutos} min e tente de novo.` }, { status: 429 });
  }
  await registrarTentativa("ESQUECI_SENHA", alvos);

  const baseUrl = urlBasePublica(req.nextUrl.origin);
  after(async () => {
    try { await enviarRecuperacaoSenha(email, baseUrl); }
    catch (e) { console.error("[acesso] falha ao processar o pedido de nova senha", e); }
  });
  return NextResponse.json({ ok: true, mensagem: MENSAGEM_ESQUECI });
}
