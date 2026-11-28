import { NextRequest, NextResponse } from "next/server";
import { fotoDaMensagem } from "@/lib/execucao/comentarios";
import { respostaAnexo } from "@/lib/anexos-server";
import { MSG_SEM_CONVERSA } from "@/lib/chat/regras";
import { guardaEscritorio } from "@/lib/chat/rotas-server";
import { escritorioVeMensagem } from "@/lib/chat/pessoas-servidor";

type Params = { params: Promise<{ fotoId: string }> };

/** GET /api/conversas/fotos/[fotoId] — CHAT-1: a foto inteira de uma mensagem (ampliar), para quem vê a conversa. */
export async function GET(_: NextRequest, { params }: Params) {
  const g = await guardaEscritorio("visualizar");
  if (g.resposta) return g.resposta;
  const { fotoId } = await params;
  const f = await fotoDaMensagem(g.quem.empresaId, fotoId);
  if (!f || !(await escritorioVeMensagem(g.quem, f.comentarioId))) return NextResponse.json({ erro: MSG_SEM_CONVERSA }, { status: 404 });
  return respostaAnexo({ nome: "foto.jpg", conteudo: f.conteudo }, true);
}
