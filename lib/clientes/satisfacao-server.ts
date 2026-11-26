import { prisma } from "@/lib/prisma";
import { satisfacaoPorCliente, type ResumoSatisfacao } from "@/lib/clientes/satisfacao";

/**
 * A satisfação real (média do aceite das OS) dos clientes pedidos — uma consulta para a página inteira.
 * Só aceites CONFIRMADOS com nota, sempre da empresa da sessão (a OS também é conferida).
 */
export async function satisfacaoDosClientes(empresaId: string, clienteIds: string[]): Promise<Map<string, ResumoSatisfacao>> {
  if (!clienteIds.length) return new Map();
  const linhas = await prisma.osAceite.findMany({
    where: { empresaId, situacao: "CONFIRMADO", avaliacao: { not: null }, ordemServico: { empresaId, clienteId: { in: clienteIds } } },
    select: { avaliacao: true, ordemServico: { select: { clienteId: true } } },
  });
  return satisfacaoPorCliente(linhas.map((l) => ({ clienteId: l.ordemServico.clienteId, avaliacao: l.avaliacao })));
}
