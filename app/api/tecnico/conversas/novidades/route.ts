import { NextRequest, NextResponse } from "next/server";
import { esperarNovidades, marcaAtual, ondeNovidadesTecnico } from "@/lib/chat/servidor";
import { guardaTecnico, lerDesde, SEM_CACHE } from "@/lib/chat/rotas-server";

/** O long-polling segura a resposta por até 8 s (ESPERA_NOVIDADES_MS): folga para o limite da função na Vercel. */
export const maxDuration = 20;

/** GET /api/tecnico/conversas/novidades?desde=<marca> — CHAT-1, o tempo real do app: só as OS do técnico. */
export async function GET(req: NextRequest) {
  const g = await guardaTecnico();
  if (g.resposta) return g.resposta;
  const onde = await ondeNovidadesTecnico(g.empresaId, g.tecnicoId);
  const r = await esperarNovidades(() => marcaAtual(onde, g.usuarioId), lerDesde(req.url), { cancelado: () => req.signal.aborted });
  return NextResponse.json(r, { headers: SEM_CACHE });
}
