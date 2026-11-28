import { contextoExecucao } from "@/lib/execucao/contexto";
import { respostaAcao, tudoOk } from "@/lib/execucao/acoes";
import { escopoBarra } from "@/lib/escopo/proprios-server";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

/**
 * UX-8 (G4): "TUDO OK" na execução DESKTOP — a mesma operação em lote do app do técnico
 * (lib/execucao/acoes.ts): marca OK, numa transação, só os itens ativos de OK/Atenção/N.A.
 * ainda sem resposta. Medições, fotos e observações continuam por conta do usuário.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  return respostaAcao(await tudoOk(ctx));
}
