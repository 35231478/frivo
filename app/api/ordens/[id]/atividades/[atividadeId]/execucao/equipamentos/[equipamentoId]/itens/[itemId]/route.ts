import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { contextoExecucao, itemDoEquipamento, marcarAtendido } from "@/lib/execucao/contexto";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string; itemId: string }> };

const schema = z.object({
  status: z.enum(["OK", "ATENCAO", "NAO_SE_APLICA"]).nullable().optional(),
  observacao: z.string().max(2000, "Observação com no máximo 2.000 caracteres.").nullable().optional(),
}).strict().refine((d) => d.status !== undefined || d.observacao !== undefined, "Nada para gravar.");

/**
 * Responde UM item do checklist de UM equipamento. Incremental: só muda o que veio no corpo (a
 * observação não apaga o status e vice-versa); reabrir a execução e responder de novo não perde nada.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId, itemId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const vinculo = ctx.vinculo!;
  const item = await itemDoEquipamento(ctx.empresaId, atividadeId, vinculo.equipamento, itemId);
  if (!item) return NextResponse.json({ erro: "Este item não é do checklist deste equipamento." }, { status: 400 });

  const { status } = parsed.data;
  const observacao = parsed.data.observacao === undefined ? undefined : (parsed.data.observacao ?? "").trim() || null;
  const agora = new Date();
  const r = await prisma.checklistResposta.upsert({
    where: { atividadeId_equipamentoId_itemId: { atividadeId, equipamentoId, itemId } },
    create: {
      empresaId: ctx.empresaId, atividadeId, equipamentoId, itemId, textoItem: item.texto,
      status: status ?? null, observacao: observacao ?? null, respondidoPorId: ctx.usuarioId, respondidoEm: agora,
    },
    update: {
      ...(status !== undefined && { status }),
      ...(observacao !== undefined && { observacao }),
      textoItem: item.texto, respondidoPorId: ctx.usuarioId, respondidoEm: agora,
    },
    select: { itemId: true, status: true, observacao: true },
  });
  if (r.status || r.observacao) await marcarAtendido(vinculo);
  return NextResponse.json({ ...r, feito: vinculo.feito });
}
