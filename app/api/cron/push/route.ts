import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verificarEsquecidas } from "@/lib/push/eventos";
import { pushLigado } from "@/lib/push/config";

/**
 * Rotina das notificações push: confere as ATIVIDADES ESQUECIDAS em andamento de cada empresa com aparelho
 * inscrito e avisa (o técnico e o escritório). Para ser chamada de hora em hora por um agendador externo:
 *   GET /api/cron/push  com  Authorization: Bearer <CRON_SECRET>
 * SÓ autoriza pelo segredo (sem CRON_SECRET configurado, fica desligada). Pode rodar quantas vezes quiser:
 * push_envios não deixa o mesmo aviso sair duas vezes. Não está no vercel.json (decisão: o sino do escritório
 * já confere a cada 5 minutos com alguém usando o sistema; esta rota é o reforço com todos fora).
 */
export const maxDuration = 120;

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pushLigado()) return NextResponse.json({ ok: true, ligado: false, empresas: 0, esquecidas: 0 });
  const empresas = await prisma.empresa.findMany({
    where: { ativo: true, usuarios: { some: { ativo: true, pushSubscriptions: { some: {} } } } }, select: { id: true },
  });
  let esquecidas = 0;
  for (const e of empresas) esquecidas += await verificarEsquecidas(e.id).catch((err) => { console.error("[push] cron", (err as Error)?.message); return 0; });
  return NextResponse.json({ ok: true, ligado: true, empresas: empresas.length, esquecidas });
}
