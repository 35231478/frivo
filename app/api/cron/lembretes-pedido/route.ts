import { NextRequest, NextResponse } from "next/server";
import { processarLembretesPedido } from "@/lib/pedido-cliente/lembretes-server";

/**
 * PC-2 — rotina diária dos LEMBRETES do pedido do cliente (vercel.json, 1×/dia de manhã em Brasília): o e-mail ao
 * contato de compras com o que espera o pedido de compra, nos dias da régua de cada empresa.
 * SÓ autoriza por `Authorization: Bearer <CRON_SECRET>` (sem segredo configurado, fica desligada).
 * Liberada no middleware (rota de cron). Idempotente: rodar de novo no mesmo dia não repete nenhum e-mail.
 */
export const maxDuration = 300;

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const resumo = await processarLembretesPedido();
  return NextResponse.json({ ok: true, ...resumo });
}
