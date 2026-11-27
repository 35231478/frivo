import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { enviarPush } from "@/lib/push/servidor";
import { MSG_TESTE } from "@/lib/push/tipos";

/** POST /api/push/teste — manda uma notificação de teste para os aparelhos do PRÓPRIO usuário. */
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const u = session.user!;
  const r = await enviarPush({ empresaId: u.empresaId, tipo: "TESTE", alcance: "pessoal", usuarios: [u.id], chave: `teste:${Date.now()}`, mensagem: MSG_TESTE });
  if (r.desligado) return NextResponse.json({ erro: "As notificações ainda não foram ligadas no servidor." }, { status: 409 });
  const aparelhos = r.enviados[0]?.aparelhos ?? 0;
  if (!aparelhos) return NextResponse.json({ erro: "Nenhum aparelho recebeu. Ative as notificações neste aparelho." }, { status: 409 });
  return NextResponse.json({ ok: true, aparelhos });
}
