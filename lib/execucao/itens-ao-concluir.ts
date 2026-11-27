/**
 * Concluir a ÚLTIMA atividade aberta da OS marca como executados os itens da OS ainda não
 * marcados (decisão "Pronto pra janeiro 2", F). Sem isso, a OS concluída no app ficava com
 * "Executado R$ 0,00" e nada a faturar até alguém marcar item por item na aba Comercial.
 *
 * Os itens pertencem à OS, não à atividade (não há vínculo item↔atividade): por isso só a
 * última atividade marca — numa OS com várias visitas, as primeiras não mexem nos itens.
 * O escritório pode desmarcar na aba Comercial (enquanto a OS não estiver fechada).
 * Fica no histórico da OS. Idempotente: sem item pendente, não grava nada.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export const ACAO_HISTORICO_ITENS = "Itens marcados como executados";

export function detalheItensAoConcluir(n: number): string {
  return `${n === 1 ? "1 item marcado" : `${n} itens marcados`} como executado${n === 1 ? "" : "s"} ao concluir a última atividade (dá para desmarcar na aba Comercial).`;
}

export async function marcarItensAoConcluirUltima(
  empresaId: string, osId: string, usuarioId: string, em: Date, db: Db = prisma,
): Promise<number> {
  const abertas = await db.atividadeOs.count({ where: { ordemServicoId: osId, empresaId, status: { notIn: ["CONCLUIDA", "CANCELADA"] } } });
  if (abertas > 0) return 0;
  const { count } = await db.osItemOrcamento.updateMany({
    where: { ordemServicoId: osId, executado: false, ordemServico: { empresaId } },
    data: { executado: true, executadoEm: em },
  });
  if (count > 0) {
    await db.osHistorico.create({ data: { ordemServicoId: osId, usuarioId, acao: ACAO_HISTORICO_ITENS, detalhes: detalheItensAoConcluir(count) } });
  }
  return count;
}
