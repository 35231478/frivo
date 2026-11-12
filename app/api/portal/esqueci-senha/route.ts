import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { conferirBloqueio, ipDaRequisicao, registrarTentativa } from "@/lib/acesso/limite";
import { urlBasePublica } from "@/lib/acesso/recuperacao";
import { enviarRecuperacaoPortal, MENSAGEM_ESQUECI_PORTAL } from "@/lib/portal/recuperacao";

/**
 * Pública: "Esqueci minha senha" do PORTAL DO CLIENTE (UX-5/Y13). Mesmo desenho do fluxo
 * interno: resposta SEMPRE igual (exista o e-mail ou não), e-mail enviado DEPOIS da resposta
 * (`after`) para o tempo não revelar nada, e limite por e-mail e por IP.
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
    try { await enviarRecuperacaoPortal(email, baseUrl); }
    catch (e) { console.error("[portal] falha ao processar o pedido de nova senha", e); }
  });
  return NextResponse.json({ ok: true, mensagem: MENSAGEM_ESQUECI_PORTAL });
}
