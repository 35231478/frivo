import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { chavesVapid } from "@/lib/push/config";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(300) }),
  userAgent: z.string().max(500).optional(),
});

/**
 * POST: inscreve ESTE aparelho (o navegador) para receber push. O mesmo endpoint de outro usuário (o
 * aparelho trocou de dono) passa para quem está logado agora. Sem as chaves VAPID, 409 (nada a inscrever).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!chavesVapid()) return NextResponse.json({ erro: "As notificações ainda não foram ligadas no servidor." }, { status: 409 });
  const userId = session.user!.id;
  const empresaId = session.user!.empresaId;

  const parsed = subscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const { endpoint, keys, userAgent } = parsed.data;

  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId, empresaId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null, falhas: 0 },
    create: { userId, empresaId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null },
  });
  return NextResponse.json({ ok: true, id: sub.id }, { status: 201 });
}

/** DELETE { endpoint }: desliga ESTE aparelho. Só o do próprio usuário (antes apagava o de qualquer um). */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({ endpoint: null }));
  if (!endpoint || typeof endpoint !== "string") return NextResponse.json({ erro: "endpoint obrigatório" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: session.user!.id } });
  return NextResponse.json({ ok: true });
}
