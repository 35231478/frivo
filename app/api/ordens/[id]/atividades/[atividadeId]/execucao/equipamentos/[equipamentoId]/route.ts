import { NextRequest, NextResponse } from "next/server";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { equipamentoSchema, marcarEquipamento, respostaAcao } from "@/lib/execucao/acoes";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

/**
 * Atendido / não atendido e a observação deste equipamento na atividade. "Não atendido" não apaga
 * nada: o checklist e as fotos ficam guardados (só deixam de contar até marcar de novo).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = equipamentoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  return respostaAcao(await marcarEquipamento(ctx, parsed.data));
}
