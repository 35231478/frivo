import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rotuloAparelho } from "@/lib/push/tipos";

/**
 * GET /api/push/aparelhos — os aparelhos do PRÓPRIO usuário que recebem notificações. O endpoint não volta
 * inteiro (é um segredo do navegador): só o final, para a tela marcar "este aparelho".
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: session.user!.id }, orderBy: { criadoEm: "desc" },
    select: { id: true, endpoint: true, userAgent: true, criadoEm: true, ultimoEnvioEm: true },
  });
  return NextResponse.json(subs.map((s) => ({
    id: s.id, aparelho: rotuloAparelho(s.userAgent), desde: s.criadoEm, ultimoEnvioEm: s.ultimoEnvioEm, final: s.endpoint.slice(-24),
  })));
}
