import { NextRequest, NextResponse } from "next/server";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { formularioSchema, respostaAcao, responderFormulario } from "@/lib/execucao/acoes";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

/**
 * Responde UM campo do formulário do tipo (tipo de OS × tipo de equipamento) para ESTE equipamento.
 * Antes o formulário era preenchido uma vez e replicado para todos do mesmo tipo — e reabrir gravava
 * vazio por cima. Agora: só o campo enviado muda, só neste equipamento.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = formularioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  return respostaAcao(await responderFormulario(ctx, parsed.data));
}
