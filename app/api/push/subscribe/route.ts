import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { chavesVapid } from "@/lib/push/config";
import { impressaoDaChave } from "@/lib/push/diagnostico";

const MSG_CHAVE_DIFERENTE = "Este aparelho se inscreveu com outra chave de notificações. Ative de novo neste aparelho.";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(300) }),
  userAgent: z.string().max(500).optional(),
  /** HOTFIX push: a chave pública com que o navegador se inscreveu (para conferir com a do servidor; só a impressão é gravada) */
  chave: z.string().max(200).optional(),
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
  const { endpoint, keys, userAgent, chave } = parsed.data;
  // Inscrição feita com outra chave VAPID nunca recebe (o serviço de push recusa com 403): o navegador refaz
  const servidor = impressaoDaChave(chavesVapid()!.publica);
  const doNavegador = chave ? impressaoDaChave(chave) : null;
  if (doNavegador && doNavegador !== servidor) {
    return NextResponse.json({ erro: MSG_CHAVE_DIFERENTE, reinscrever: true }, { status: 409 });
  }

  const sub = await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId, empresaId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null, falhas: 0, chaveImpressao: doNavegador, ultimoErro: null },
    create: { userId, empresaId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null, chaveImpressao: doNavegador },
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
