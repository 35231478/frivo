import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { mesPedido, veValores } from "@/lib/desempenho/api";
import { painelDoMes, responder } from "@/lib/desempenho/servidor";

/**
 * Painel do mês: ranking por perfil (posição, escore, faixa), resumo por equipe e prêmio em disputa.
 * Exige "Desempenho › Visualizar". O bônus em reais só vai para quem tem "Desempenho › Gerenciar".
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "visualizar");
  if (guard.erro) return guard.resposta;
  return responder(() => painelDoMes(guard.session.user.empresaId, mesPedido(req), veValores(guard.session)));
}
