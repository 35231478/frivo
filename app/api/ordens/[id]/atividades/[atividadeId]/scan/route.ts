import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { respostaAcao, vincularPorQr } from "@/lib/execucao/acoes";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

const schema = z.object({ valor: z.string().min(1) });

/**
 * Resolve um QR escaneado (URL .../qr/<token>, token puro ou código QR-AAAA-NNNN) para o equipamento:
 * já vinculado à atividade → marca como atendido; ainda não → VINCULA (se for do cliente da OS e
 * estiver ativo) já como atendido. Equipamento de outro cliente nunca entra.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, atividadeId } = await params;
  const ctx = await contextoExecucao(id, atividadeId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  return respostaAcao(await vincularPorQr(ctx, parsed.data.valor));
}
