import { NextRequest } from "next/server";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { removerFoto, respostaAcao } from "@/lib/execucao/acoes";

type Params = { params: Promise<{ id: string; atividadeId: string; fotoId: string }> };

/** Tira UMA foto (a que a pessoa escolheu), com a atividade aberta. Nada mais é apagado. */
export async function DELETE(_: NextRequest, { params }: Params) {
  const { id, atividadeId, fotoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId);
  if (!ctx.ok) return ctx.resposta;
  const r = await removerFoto(ctx, { fotoId });
  return respostaAcao(r.ok ? { ...r, dados: { ok: true } } : r);
}
