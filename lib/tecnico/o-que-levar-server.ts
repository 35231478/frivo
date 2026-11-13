/**
 * App do técnico — "O que levar", lado do SERVIDOR: lê as linhas das OS (uma consulta para a lista
 * inteira) e devolve os materiais previstos de cada uma. A regra é a pura (lib/tecnico/o-que-levar).
 *
 * Só lê. Nada é gravado, reservado nem baixado. Nenhum valor (venda ou custo) é selecionado.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { materiaisPrevistosDaOs, type LinhaDaOs, type MaterialPrevisto } from "@/lib/tecnico/o-que-levar";

const PRODUTO = { id: true, nome: true, unidade: true, ativo: true, categoriaProduto: { select: { comportamento: true } } } satisfies Prisma.ProdutoSelect;

const SELECT_LINHA = {
  ordemServicoId: true, tipo: true, executado: true, descricao: true, quantidade: true, materialId: true,
  produto: { select: { id: true, nome: true, unidade: true } },
  materiais: { orderBy: { ordem: "asc" }, select: { produtoId: true, descricao: true, unidade: true, quantidade: true, estadoSeparacao: true } },
  // A composição padrão do serviço do catálogo: só vale quando a linha não tem material lançado
  servico: {
    select: {
      materiais: {
        orderBy: { ordem: "asc" },
        select: {
          produtoId: true, kitId: true, quantidade: true, comportamento: true,
          produto: { select: PRODUTO },
          kit: { select: { id: true, nome: true, ativo: true, itens: { orderBy: { ordem: "asc" }, select: { produtoId: true, quantidade: true, produto: { select: PRODUTO } } } } },
        },
      },
    },
  },
} satisfies Prisma.OsItemOrcamentoSelect;

/** Os materiais previstos de cada OS (só as da empresa). OS sem linha, ou sem material previsto, não aparece no mapa. */
export async function materiaisPorOs(empresaId: string, osIds: readonly string[]): Promise<Map<string, MaterialPrevisto[]>> {
  const ids = [...new Set(osIds)];
  const saida = new Map<string, MaterialPrevisto[]>();
  if (!ids.length) return saida;
  const linhas = await prisma.osItemOrcamento.findMany({
    where: { ordemServicoId: { in: ids }, ordemServico: { empresaId, status: { not: "CANCELADA" } } },
    orderBy: [{ ordemServicoId: "asc" }, { ordem: "asc" }],
    select: SELECT_LINHA,
  });
  const porOs = new Map<string, LinhaDaOs[]>();
  for (const l of linhas) {
    const linha: LinhaDaOs = {
      tipo: l.tipo, executado: l.executado, descricao: l.descricao, quantidade: l.quantidade, materialId: l.materialId,
      produto: l.produto, materiais: l.materiais, composicao: l.servico?.materiais ?? null,
    };
    porOs.set(l.ordemServicoId, [...(porOs.get(l.ordemServicoId) ?? []), linha]);
  }
  for (const [osId, daOs] of porOs) {
    const previstos = materiaisPrevistosDaOs(daOs);
    if (previstos.length) saida.set(osId, previstos);
  }
  return saida;
}

/**
 * Põe em cada cartão os materiais previstos da OS dele. Com a opção da empresa desligada
 * (Equipes › App do colaborador), nada é lido e nada sai do servidor.
 */
export async function comMateriaisPrevistos<T extends { osId: string }>(empresaId: string, cartoes: T[], ligado: boolean): Promise<(T & { materiais?: MaterialPrevisto[] })[]> {
  if (!ligado || !cartoes.length) return cartoes;
  const porOs = await materiaisPorOs(empresaId, cartoes.map((c) => c.osId));
  return cartoes.map((c) => ({ ...c, materiais: porOs.get(c.osId) ?? [] }));
}
