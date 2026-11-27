import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CHAVE_SINO_LIDOS, ehAvisoDoNumero, lerLidos, marcarLido, type AvisoDoNumero } from "@/lib/alertas/lidos";
import { chaveHojeBR } from "@/lib/fuso";

/**
 * O toque num aviso do sino: marca como LIDO hoje (lib/alertas/lidos). Só o do próprio usuário da sessão;
 * não tem permissão de módulo (é o estado do sino dele, como as preferências de tela). A assinatura vem da
 * tela (a contagem que ela mostrava): se o aviso mudou até lá, o sino volta a contá-lo na próxima leitura.
 */
const corpoSchema = z.object({ campo: z.string().refine(ehAvisoDoNumero), assinatura: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const usuarioId = session.user!.id;
  const hoje = chaveHojeBR();
  const chave = { usuarioId_chave: { usuarioId, chave: CHAVE_SINO_LIDOS } };
  const atual = await prisma.preferenciaUsuario.findUnique({ where: chave, select: { valor: true } });
  const valor = marcarLido(lerLidos(atual?.valor, hoje), parsed.data.campo as AvisoDoNumero, parsed.data.assinatura, hoje);
  await prisma.preferenciaUsuario.upsert({ where: chave, create: { usuarioId, chave: CHAVE_SINO_LIDOS, valor }, update: { valor } });
  return NextResponse.json({ ok: true });
}
