import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { exigirPermissao } from "@/lib/permissoes-server";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { comentarioSchema } from "@/lib/tecnico/comentarios";
import { comentarDoEscritorio, comentariosParaEscritorio } from "@/lib/execucao/comentarios";
import { escopoBarra } from "@/lib/escopo/proprios-server";

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
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const lista = await comentariosParaEscritorio(guard.session.user.empresaId, id, guard.session.user.id);
  if (!lista) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json({ comentarios: lista }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST { clientId?, texto, foto?, miniatura? } — o escritório responde na OS (quem edita a OS). Sem clientId, o servidor dá um. */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  if (escopoDaSessao(guard.session).restrito) return NextResponse.json({ erro: MSG_APP }, { status: 403 });
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404 (antes de ler o corpo)
  if (foraDoEscopo) return foraDoEscopo;
  const bruto = await req.json().catch(() => null);
  const parsed = comentarioSchema.safeParse(bruto && typeof bruto === "object" ? { clientId: randomUUID().replace(/-/g, ""), ...bruto } : bruto);
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await comentarDoEscritorio(guard.session.user.empresaId, id, guard.session.user.id, parsed.data);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ comentario: r.dados.comentario }, { status: r.status });
}
