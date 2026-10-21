import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { contextoExecucao } from "@/lib/execucao/contexto";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

const schema = z.object({
  feito: z.boolean().optional(),
  observacao: z.string().max(4000, "Observação com no máximo 4.000 caracteres.").nullable().optional(),
}).strict().refine((d) => d.feito !== undefined || d.observacao !== undefined, "Nada para gravar.");

/**
 * Atendido / não atendido e a observação deste equipamento na atividade. "Não atendido" não apaga
 * nada: o checklist e as fotos ficam guardados (só deixam de contar até marcar de novo).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { feito } = parsed.data;
  const observacao = parsed.data.observacao === undefined ? undefined : (parsed.data.observacao ?? "").trim() || null;
  const r = await prisma.atividadeEquipamento.update({
    where: { id: ctx.vinculo!.id },
    data: {
      ...(feito !== undefined && { feito, feitoEm: feito ? (ctx.vinculo!.feito ? undefined : new Date()) : null }),
      ...(observacao !== undefined && { observacao }),
      // Escreveu uma observação: o equipamento passa a contar como atendido
      ...(feito === undefined && observacao && !ctx.vinculo!.feito && { feito: true, feitoEm: new Date() }),
    },
    select: { feito: true, observacao: true },
  });
  return NextResponse.json(r);
}
