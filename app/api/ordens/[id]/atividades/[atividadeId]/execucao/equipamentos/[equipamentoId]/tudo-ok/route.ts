import { contextoExecucao } from "@/lib/execucao/contexto";
import { respostaAcao, tudoOk } from "@/lib/execucao/acoes";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

/**
 * UX-8 (G4): "TUDO OK" na execução DESKTOP — a mesma operação em lote do app do técnico
 * (lib/execucao/acoes.ts): marca OK, numa transação, só os itens ativos de OK/Atenção/N.A.
 * ainda sem resposta. Medições, fotos e observações continuam por conta do usuário.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  return respostaAcao(await tudoOk(ctx));
}
