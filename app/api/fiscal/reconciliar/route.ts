import { NextRequest, NextResponse } from "next/server";
import { reconciliarNotas } from "@/lib/nfse/webhook-server";

/**
 * Reconciliação das NFS-e paradas (todas as empresas), chamada pelo cron (vercel.json). Reserva:
 * o aviso do PlugNotas e o sino (que reconcilia a empresa de quem está usando) cuidam do dia a dia.
 * SÓ autoriza por `Authorization: Bearer <CRON_SECRET>` (sem segredo configurado, fica desligado).
 * Liberado no middleware (rota de cron).
 */
const LIMITE = 50;

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await reconciliarNotas({}, new Date(), LIMITE)) });
}
