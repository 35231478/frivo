import { NextRequest, NextResponse } from "next/server";
import { ipDaRequisicao } from "@/lib/orcamentos/ciclo";
import { getPortalSession } from "@/lib/auth-portal";
import { aceitePublicoSchema } from "@/lib/os/aceite";
import { ErroAceite, confirmarAceitePublico } from "@/lib/os/aceite-server";

/**
 * Aceite pelo link público: quem tem o token confirma, sem login. Grava o nome de quem confirmou, a
 * data/hora, o IP e o navegador — o mesmo mecanismo da aprovação do orçamento, com troca atômica
 * (dois cliques não confirmam duas vezes). Se quem confirma está logado no portal do mesmo cliente,
 * o contato fica registrado junto.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = aceitePublicoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const sessao = await getPortalSession().catch(() => null);
  const contato = sessao?.user ? { id: sessao.user.id, clienteId: sessao.user.clienteId, empresaId: sessao.user.empresaId } : null;
  try {
    const r = await confirmarAceitePublico(token, parsed.data, { ip: ipDaRequisicao(req.headers), userAgent: req.headers.get("user-agent"), contato });
    return NextResponse.json({ ok: true, situacao: "CONFIRMADO", ...r });
  } catch (e) {
    if (e instanceof ErroAceite) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
