import { NextRequest, NextResponse } from "next/server";
import { conversasDoEscritorio } from "@/lib/chat/servidor";
import { guardaEscritorio, SEM_CACHE } from "@/lib/chat/rotas-server";

/**
 * GET /api/conversas?busca= — CHAT-1: as conversas do escritório (uma por OS, mais recente primeiro) com as não lidas
 * de quem vê; com busca, também as OS que batem e ainda não têm conversa. Só o que a permissão de OS e o "Ver só os
 * próprios" deixam ver.
 */
export async function GET(req: NextRequest) {
  const g = await guardaEscritorio("visualizar");
  if (g.resposta) return g.resposta;
  const busca = req.nextUrl.searchParams.get("busca")?.slice(0, 80) ?? null;
  const r = await conversasDoEscritorio(g.quem, { busca });
  return NextResponse.json({ ...r, naoLidas: r.conversas.filter((c) => c.naoLidas > 0).length }, { headers: SEM_CACHE });
}
