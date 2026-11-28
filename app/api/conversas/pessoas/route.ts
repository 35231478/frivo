import { NextRequest, NextResponse } from "next/server";
import { pessoasDoEscritorio, podeConversas } from "@/lib/chat/pessoas-servidor";
import { MSG_SEM_PERMISSAO_CONVERSAS } from "@/lib/chat/regras";
import { guardaEscritorio, SEM_CACHE } from "@/lib/chat/rotas-server";

/**
 * GET /api/conversas/pessoas?busca= — CHAT-1: a lista POR PESSOA (os técnicos com login): a última mensagem, a hora e as
 * não lidas de quem vê; não lidas primeiro. Pede a permissão "Conversas" (o administrador sempre).
 */
export async function GET(req: NextRequest) {
  const g = await guardaEscritorio("visualizar", [["conversas", "visualizar"]]);
  if (g.resposta) return g.resposta;
  if (!podeConversas(g.quem, "visualizar")) return NextResponse.json({ erro: MSG_SEM_PERMISSAO_CONVERSAS }, { status: 403 });
  const pessoas = await pessoasDoEscritorio(g.quem, { busca: req.nextUrl.searchParams.get("busca")?.slice(0, 80) ?? null });
  return NextResponse.json({ pessoas, naoLidas: pessoas.filter((p) => p.naoLidas > 0).length }, { headers: SEM_CACHE });
}
