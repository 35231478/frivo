import { prisma } from "@/lib/prisma";
import { calcularStatusFinanceiroDetalhado } from "@/lib/status-financeiro";
import { contatoSeguro } from "@/lib/contato-cliente";
import { perdasRecentesDoCliente } from "@/lib/financeiro/perda-estorno-server";

/**
 * O cliente como a ficha e a edição precisam: o mesmo carregamento nas duas telas (/clientes/[id] em
 * consulta e /clientes/[id]/editar). Sempre filtrado pela empresa da sessão; null se não for dela.
 */
export async function carregarFichaCliente(id: string, empresaId: string) {
  const cliente = await prisma.cliente.findFirst({
    where: { id, empresaId },
    include: {
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      tabelaPreco: { select: { nome: true, ativo: true } },
      unidades: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      contatosCliente: { where: { ativo: true }, orderBy: [{ principal: "desc" }, { nome: "asc" }] },
      interacoes: { include: { usuario: { select: { id: true, nome: true } } }, orderBy: { criadoEm: "desc" }, take: 50 },
      _count: { select: { contratos: { where: { status: "ATIVO" } } } },
    },
  });
  if (!cliente) return null;

  const [{ status, totalProximos30Dias }, perdas12m] = await Promise.all([
    calcularStatusFinanceiroDetalhado(id, empresaId),
    perdasRecentesDoCliente(id, empresaId),
  ]);
  // Contatos vão para o client sem hash/senha do portal
  const dados = { ...cliente, contatosCliente: cliente.contatosCliente.map(contatoSeguro) };
  return { dados, status, totalProximos30Dias, perdas12m };
}
