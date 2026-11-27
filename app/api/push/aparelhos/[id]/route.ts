import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** DELETE /api/push/aparelhos/[id] — revoga um aparelho (só os do próprio usuário; o de outro é 404). */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const { count } = await prisma.pushSubscription.deleteMany({ where: { id, userId: session.user!.id } });
  if (!count) return NextResponse.json({ erro: "Aparelho não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
