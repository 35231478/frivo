import { NextRequest, NextResponse } from "next/server";
import { rodarFaturamentoContratos } from "@/lib/faturamento/rotina-contratos-server";

/**
 * Rotina diária do faturamento automático dos contratos (vercel.json, 1×/dia de manhã em Brasília).
 * SÓ autoriza por `Authorization: Bearer <CRON_SECRET>` (sem segredo configurado, fica desligada).
 * Liberada no middleware (rota de cron). Só mexe em contrato com "Faturamento automático" ligado.
 */
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await rodarFaturamentoContratos()) });
}
