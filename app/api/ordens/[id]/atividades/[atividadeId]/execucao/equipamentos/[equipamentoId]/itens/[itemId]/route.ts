import { NextRequest, NextResponse } from "next/server";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { respostaAcao, respostaSchema, responderItem } from "@/lib/execucao/acoes";
import { escopoBarra } from "@/lib/escopo/proprios-server";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string; itemId: string }> };

/**
 * Responde UM item do checklist de UM equipamento. Incremental: só muda o que veio no corpo (a
 * observação não apaga o status e vice-versa); reabrir a execução e responder de novo não perde nada.
 * Item de medição: número + unidade (ou "Não se aplica").
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId, itemId } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = respostaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  return respostaAcao(await responderItem(ctx, itemId, parsed.data));
}
