import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corrigirEquipamentoDaFoto, fotoNoRelatorio } from "@/lib/execucao/comentarios";
import { ondeEscritorioVe } from "@/lib/chat/pessoas-servidor";
import { guardaEscritorio } from "@/lib/chat/rotas-server";

type Params = { params: Promise<{ comentarioId: string }> };
const id = z.string().min(1).max(64);
const corpoSchema = z.object({ equipamentoId: id.nullable().optional(), noRelatorio: z.boolean().optional() }).strict()
  .refine((d) => (d.equipamentoId !== undefined) !== (d.noRelatorio !== undefined), { message: "Envie o equipamento ou o relatório." });

/**
 * PATCH /api/conversas/mensagens/[comentarioId]/foto { equipamentoId } | { noRelatorio } — CHAT-1.1: o escritório
 * corrige (ou tira) o equipamento de uma foto do chat, ou a põe no relatório da atividade (por referência). Quem edita a
 * OS, dentro do que vê ("Ver só os próprios"). A mensagem não muda; cada mudança fica no histórico da OS.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await guardaEscritorio("editar");
  if (g.resposta) return g.resposta;
  const { comentarioId } = await params;
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const podeVer = ondeEscritorioVe(g.quem);
  const r = parsed.data.noRelatorio !== undefined
    ? await fotoNoRelatorio({ empresaId: g.quem.empresaId, usuarioId: g.quem.id, comentarioId, noRelatorio: parsed.data.noRelatorio, podeVer })
    : await corrigirEquipamentoDaFoto({ empresaId: g.quem.empresaId, usuarioId: g.quem.id, ref: { id: comentarioId }, equipamentoId: parsed.data.equipamentoId ?? null, podeVer, doApp: false });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ mensagem: r.dados.comentario });
}
