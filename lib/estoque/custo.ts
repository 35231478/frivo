import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Último custo de compra de cada produto (por unidade do produto): o da entrada mais recente que tem
 * custo. `excetoNotaId` ignora as entradas desta nota (para comparar o custo dela com o anterior);
 * `antesDe` olha só o que entrou antes (a nota já lançada compara com a compra anterior a ela).
 */
export async function ultimosCustos(
  empresaId: string, produtoIds: string[], opcoes: { excetoNotaId?: string; antesDe?: Date | null } = {}, db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, number>> {
  const custos = new Map<string, number>();
  for (const produtoId of [...new Set(produtoIds)]) {
    const [m] = await db.movimentacaoEstoque.findMany({
      where: {
        empresaId, produtoId, tipo: "ENTRADA", custoUnitario: { not: null },
        ...(opcoes.excetoNotaId && { NOT: { origem: "COMPRA", refId: opcoes.excetoNotaId } }),
        ...(opcoes.antesDe && { data: { lt: opcoes.antesDe } }),
      },
      orderBy: [{ data: "desc" }, { criadoEm: "desc" }, { id: "desc" }], take: 1, select: { custoUnitario: true },
    });
    if (m?.custoUnitario != null) custos.set(produtoId, Number(m.custoUnitario));
  }
  return custos;
}
