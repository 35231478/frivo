import { NextRequest, NextResponse } from "next/server";
import { conversaDoTecnico } from "@/lib/chat/servidor";
import { MSG_SEM_CONVERSA } from "@/lib/chat/regras";
import { guardaTecnico, SEM_CACHE } from "@/lib/chat/rotas-server";

type Params = { params: Promise<{ osId: string }> };

/**
 * GET /api/tecnico/conversas/[osId] — CHAT-1: a conversa de uma OS do técnico (OS de outro técnico: 404). Ler marca
 * como lidas. Escrever é pela fila do app (/api/tecnico/sync, operação "comentario"): funciona sem sinal e não duplica.
 */
export async function GET(_: NextRequest, { params }: Params) {
  const g = await guardaTecnico();
  if (g.resposta) return g.resposta;
  const { osId } = await params;
  const r = await conversaDoTecnico(g.empresaId, g.usuarioId, g.tecnicoId, osId);
  if (!r) return NextResponse.json({ erro: MSG_SEM_CONVERSA }, { status: 404 });
  return NextResponse.json(r, { headers: SEM_CACHE });
}
