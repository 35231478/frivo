import { NextRequest, NextResponse } from "next/server";
import { fotoDaMensagem } from "@/lib/execucao/comentarios";
import { respostaAnexo } from "@/lib/anexos-server";
import { MSG_SEM_CONVERSA } from "@/lib/chat/regras";
import { tecnicoVeMensagem } from "@/lib/chat/pessoas-servidor";
import { guardaTecnico } from "@/lib/chat/rotas-server";

type Params = { params: Promise<{ fotoId: string }> };

/** GET /api/tecnico/conversas/fotos/[fotoId] — CHAT-1: a foto inteira de uma mensagem, só de OS do técnico. */
export async function GET(_: NextRequest, { params }: Params) {
  const g = await guardaTecnico();
  if (g.resposta) return g.resposta;
  const { fotoId } = await params;
  const f = await fotoDaMensagem(g.empresaId, fotoId);
  if (!f || !(await tecnicoVeMensagem(g.empresaId, g.usuarioId, g.tecnicoId, f.comentarioId))) return NextResponse.json({ erro: MSG_SEM_CONVERSA }, { status: 404 });
  return respostaAnexo({ nome: "foto.jpg", conteudo: f.conteudo }, true);
}
