import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { autorDa, corpo, invalido, mesPedido } from "@/lib/desempenho/api";
import { fecharSchema } from "@/lib/desempenho/fechamento";
import { fecharMes, historicoDeFechamentos, previaDoFechamento } from "@/lib/desempenho/fechamento-server";
import { responder } from "@/lib/desempenho/servidor";

/**
 * A folha de bônus do mês pedido (`?mes=`): a gravada, se o mês está fechado; a projeção, se está
 * aberto — e o histórico de fechamentos. São valores em reais: exige "Desempenho › Gerenciar".
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;
  return responder(async () => ({ mes: await previaDoFechamento(empresaId, mesPedido(req)), historico: await historicoDeFechamentos(empresaId) }));
}

/** FECHA o mês: congela escore, faixa e valor do bônus de cada colaborador. "Desempenho › Gerenciar". */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = fecharSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  return responder(() => fecharMes(autorDa(guard.session), parsed.data), 201);
}
