import { NextRequest, NextResponse } from "next/server";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { adicionarFoto, fotoSchema, respostaAcao } from "@/lib/execucao/acoes";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

/** Uma foto DESTE equipamento (antes/depois, de um item ou geral). Nunca é copiada para outro equipamento. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = fotoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Foto inválida." }, { status: 400 });
  return respostaAcao(await adicionarFoto(ctx, parsed.data));
}
