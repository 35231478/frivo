import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { expandirComposicao } from "@/lib/estoque/composicao";
import { ultimosCustos } from "@/lib/estoque/custo";
import { PRODUTO_DA_COMPOSICAO } from "@/lib/cadastros/registro";
import { ErroRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { erroDosMateriais, materializarComposicao, type MaterialOrcamento } from "@/lib/orcamentos/materiais";

/**
 * Estoque E3.3 — lado do servidor dos materiais do orçamento. A regra (ajuste, peças, valor da linha) é a pura
 * (lib/orcamentos/materiais); aqui entra o banco: materializar a composição com os preços do cliente e os custos,
 * conferir que os produtos são da empresa e gravar o snapshot junto com as linhas.
 */

/** Valor de venda de cada produto para um cliente: o da tabela de preços ATIVA dele (item presente) ou o padrão. */
export async function precosDeVendaParaCliente(empresaId: string, clienteId: string | null | undefined, produtoIds: string[]) {
  const ids = [...new Set(produtoIds)];
  if (!ids.length) return new Map<string, number>();
  const produtos = await prisma.produto.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, valorPadrao: true } });
  const precos = new Map(produtos.map((p) => [p.id, p.valorPadrao == null ? 0 : Number(p.valorPadrao)]));
  if (clienteId) {
    const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { tabelaPreco: { select: { ativo: true, itens: { where: { produtoId: { in: ids } }, select: { produtoId: true, valorFinal: true } } } } } });
    if (cliente?.tabelaPreco?.ativo) for (const it of cliente.tabelaPreco.itens) if (it.produtoId) precos.set(it.produtoId, Number(it.valorFinal));
  }
  return precos;
}

/**
 * A composição do serviço materializada para o orçamento: kit explodido em itens, quantidade padrão, valor de venda
 * (tabela do cliente ou padrão) e custo interno. Serviço de outra empresa = null.
 */
export async function materiaisPadraoDoServico(empresaId: string, servicoId: string, clienteId?: string | null): Promise<MaterialOrcamento[] | null> {
  const servico = await prisma.servico.findFirst({
    where: { id: servicoId, empresaId },
    select: { id: true, materiais: { orderBy: { ordem: "asc" }, include: { produto: { select: PRODUTO_DA_COMPOSICAO }, kit: { select: { id: true, nome: true, ativo: true, itens: { orderBy: { ordem: "asc" }, select: { produtoId: true, quantidade: true, produto: { select: PRODUTO_DA_COMPOSICAO } } } } } } } },
  });
  if (!servico) return null;
  const efetivos = expandirComposicao(servico.materiais);
  if (!efetivos.length) return [];
  const ids = efetivos.map((m) => m.produtoId);
  const [precos, custos] = await Promise.all([precosDeVendaParaCliente(empresaId, clienteId, ids), ultimosCustos(empresaId, ids)]);
  return materializarComposicao(efetivos, (id) => precos.get(id), custos);
}

/** Um produto do catálogo como material AVULSO: comportamento pela categoria, venda pela tabela/padrão, custo interno. */
export async function produtoComoMaterial(empresaId: string, produtoId: string, clienteId?: string | null) {
  const p = await prisma.produto.findFirst({ where: { id: produtoId, empresaId }, select: { ...PRODUTO_DA_COMPOSICAO, valorPadrao: true } });
  if (!p) return null;
  const [precos, custos] = await Promise.all([precosDeVendaParaCliente(empresaId, clienteId, [p.id]), ultimosCustos(empresaId, [p.id])]);
  return { produto: p, valorVendaUnit: precos.get(p.id) ?? 0, custoUnit: custos.get(p.id) ?? null };
}

type Tx = Prisma.TransactionClient;
export interface ItemParaGravar { servicoId?: string | null; produtoId?: string | null; descricao: string; quantidade: number; valorUnitario: number; valorTotal: number; observacao: string | null; ordem: number }
export interface ServicoParaGravar extends ItemParaGravar {
  valorBase: number | null; ajusteMateriais: number; valorManual: boolean;
  materiais: (MaterialOrcamento & { ordem: number })[];
}
export interface PecaParaGravar extends ItemParaGravar { idxServico: number; idxMaterial: number }
export interface ItensParaGravar { servicos: ServicoParaGravar[]; produtos: ItemParaGravar[]; pecas: PecaParaGravar[] }

/** Confere (400) os materiais: regra pura + produtos da empresa da sessão. */
export async function validarMateriaisDoOrcamento(empresaId: string, servicos: { materiais?: readonly Partial<MaterialOrcamento>[] | null }[]) {
  const todos = servicos.flatMap((s) => s.materiais ?? []);
  const erro = erroDosMateriais(todos);
  if (erro) throw new ErroRefEmpresa(erro);
  await validarRefsEmpresa("produto", todos.map((m) => m.produtoId), empresaId, "Produto do material");
}

/**
 * Grava as linhas do orçamento em ordem: serviço → materiais dele → produtos do usuário → peças (linhas de produto
 * derivadas, apontando para o material). Chamado dentro da transação que cria/atualiza o orçamento.
 */
export async function gravarItensOrcamento(tx: Tx, orcamentoId: string, v: ItensParaGravar) {
  const materialIds: string[][] = [];
  for (const s of v.servicos) {
    const { materiais, ...linha } = s;
    const criado = await tx.orcamentoServico.create({ data: { ...linha, orcamentoId } });
    const ids: string[] = [];
    for (const m of materiais) {
      const { id: _id, ...dados } = m;
      const mat = await tx.orcamentoMaterial.create({ data: { ...dados, kitNome: m.kitNome ?? null, orcamentoId, orcamentoServicoId: criado.id } });
      ids.push(mat.id);
    }
    materialIds.push(ids);
  }
  for (const p of v.produtos) await tx.orcamentoProduto.create({ data: { ...p, orcamentoId } });
  for (const p of v.pecas) {
    const { idxServico, idxMaterial, ...linha } = p;
    await tx.orcamentoProduto.create({ data: { ...linha, orcamentoId, materialId: materialIds[idxServico]?.[idxMaterial] ?? null } });
  }
}

/** Apaga as linhas (materiais e peças derivadas caem em cascata) antes de regravar na edição. */
export async function apagarItensOrcamento(tx: Tx, orcamentoId: string) {
  await tx.orcamentoProduto.deleteMany({ where: { orcamentoId } });
  await tx.orcamentoMaterial.deleteMany({ where: { orcamentoId } });
  await tx.orcamentoServico.deleteMany({ where: { orcamentoId } });
}
