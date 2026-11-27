import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { TEXTO_MAX } from "@/lib/tecnico/comentarios";
import { comentarDoEscritorio, comentariosParaEscritorio } from "@/lib/execucao/comentarios";

type Params = { params: Promise<{ id: string }> };
const MSG_APP = "O técnico comenta pelo app.";

/**
 * GET /api/ordens/[id]/comentarios — a conversa interna da OS com o campo (o cliente nunca vê). Ler marca como lido
 * para quem leu (o aviso do sino apaga). O técnico (modo técnico) usa o app, não esta rota.
 */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  if (escopoDaSessao(guard.session).restrito) return NextResponse.json({ erro: MSG_APP }, { status: 403 });
  const { id } = await params;
  const lista = await comentariosParaEscritorio(guard.session.user.empresaId, id, guard.session.user.id);
  if (!lista) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json({ comentarios: lista }, { headers: { "Cache-Control": "private, no-store" } });
}

const corpo = z.object({ texto: z.string().trim().min(1, "Escreva o comentário.").max(TEXTO_MAX, `No máximo ${TEXTO_MAX.toLocaleString("pt-BR")} caracteres.`) }).strict();

/** POST { texto } — o escritório responde na OS (quem edita a OS). */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  if (escopoDaSessao(guard.session).restrito) return NextResponse.json({ erro: MSG_APP }, { status: 403 });
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { id } = await params;
  const c = await comentarDoEscritorio(guard.session.user.empresaId, id, guard.session.user.id, parsed.data.texto);
  if (!c) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json({ comentario: c }, { status: 201 });
}
