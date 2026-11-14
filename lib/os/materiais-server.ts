import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { erroDosMateriais, materialAvulso, type MaterialOrcamento } from "@/lib/orcamentos/materiais";
import { materiaisPadraoDoServico, precosDeVendaParaCliente, produtoComoMaterial } from "@/lib/orcamentos/materiais-server";
import { prepararItemOs, type EntradaItemOs, type ItemOsPreparado } from "@/lib/os/materiais";

/**
 * Estoque E3.3b — lado do servidor dos itens da OS com materiais/peças. A regra é a pura (lib/os/materiais +
 * lib/orcamentos/materiais); aqui entra o banco: preço do catálogo para o cliente da OS, materializar a composição
 * (reusa o do orçamento), conferir que o catálogo é da empresa e gravar o item + snapshot + peças derivadas.
 */

type Tx = Prisma.TransactionClient;

/** Preço de um serviço do catálogo para o cliente: o da tabela de preços ATIVA dele (se o serviço estiver nela) ou o padrão. */
export async function precoDoServicoParaCliente(empresaId: string, clienteId: string | null | undefined, servicoId: string) {
  const s = await prisma.servico.findFirst({ where: { id: servicoId, empresaId }, select: { id: true, nome: true, descricao: true, unidade: true, valorPadrao: true, _count: { select: { materiais: true } } } });
  if (!s) return null;
  let valor = s.valorPadrao == null ? 0 : Number(s.valorPadrao);
  let origemPreco: "padrao" | "contrato" = "padrao";
  if (clienteId) {
    const c = await prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { tabelaPreco: { select: { ativo: true, itens: { where: { servicoId }, select: { valorFinal: true } } } } } });
    const it = c?.tabelaPreco?.ativo ? c.tabelaPreco.itens[0] : null;
    if (it) { valor = Number(it.valorFinal); origemPreco = "contrato"; }
  }
  return { servico: s, valorUnitario: valor, origemPreco, temMateriais: s._count.materiais > 0 };
}

/**
 * O que a tela precisa para adicionar um item do catálogo na OS: descrição, unidade, preço (tabela do cliente ou
 * padrão) e, no serviço com composição, os materiais já materializados (kit explodido, venda e custo).
 */
export async function catalogoParaItemOs(empresaId: string, clienteId: string | null, p: { servicoId?: string | null; produtoId?: string | null }) {
  if (p.servicoId) {
    const r = await precoDoServicoParaCliente(empresaId, clienteId, p.servicoId);
    if (!r) return null;
    const materiais = r.temMateriais ? await materiaisPadraoDoServico(empresaId, p.servicoId, clienteId) : [];
    return { tipo: "SERVICO" as const, servicoId: r.servico.id, descricao: r.servico.nome, unidade: r.servico.unidade, valorUnitario: r.valorUnitario, origemPreco: r.origemPreco, materiais: materiais ?? [] };
  }
  if (p.produtoId) {
    const r = await produtoComoMaterial(empresaId, p.produtoId, clienteId);
    if (!r) return null;
    const m = materialAvulso({ produtoId: r.produto.id, nome: r.produto.nome, unidade: r.produto.unidade, comportamento: r.produto.categoriaProduto?.comportamento, valorVendaUnit: r.valorVendaUnit, custoUnit: r.custoUnit });
    const precos = await precosDeVendaParaCliente(empresaId, clienteId, [r.produto.id]);
    return { tipo: "PRODUTO" as const, produtoId: r.produto.id, descricao: r.produto.nome, unidade: r.produto.unidade, valorUnitario: precos.get(r.produto.id) ?? 0, origemPreco: "padrao" as const, material: m };
  }
  return null;
}

/** Confere (400 via ErroRefEmpresa) e monta o item: catálogo e produtos dos materiais da empresa da sessão. */
export async function prepararItemOsConferido(empresaId: string, e: EntradaItemOs): Promise<ItemOsPreparado> {
  const erro = erroDosMateriais(e.materiais ?? []);
  if (erro) throw new ErroRefEmpresa(erro);
  await Promise.all([
    validarRefEmpresa("servico", e.tipo === "PRODUTO" ? null : e.servicoId, empresaId, "Serviço do catálogo"),
    validarRefEmpresa("produto", e.tipo === "PRODUTO" ? e.produtoId : null, empresaId, "Produto do catálogo"),
    validarRefsEmpresa("produto", (e.materiais ?? []).map((m) => m.produtoId), empresaId, "Produto do material"),
  ]);
  return prepararItemOs(e);
}

const linha = (p: ItemOsPreparado) => ({
  tipo: p.tipo, servicoId: p.servicoId, produtoId: p.produtoId, descricao: p.descricao, quantidade: p.quantidade, valorUnitario: p.valorUnitario, valorTotal: p.valorTotal,
  valorBase: p.valorBase, ajusteMateriais: p.ajusteMateriais, valorManual: p.valorManual,
});
const materialData = (m: MaterialOrcamento & { ordem: number }) => ({
  produtoId: m.produtoId ?? null, descricao: m.descricao, unidade: m.unidade || "un", comportamento: m.comportamento, quantidade: m.quantidade, quantidadePadrao: m.quantidadePadrao,
  valorVendaUnit: m.valorVendaUnit, custoUnit: m.custoUnit ?? null, origem: m.origem, kitNome: m.kitNome ?? null, ordem: m.ordem,
});

/** Grava os filhos de um item de serviço já criado: o snapshot e, para cada peça, o item PRODUTO derivado. */
async function gravarFilhos(tx: Tx, osId: string, itemId: string, p: ItemOsPreparado, ordemBase: number, extra: Record<string, unknown> = {}) {
  const ids: string[] = [];
  for (const m of p.materiais) ids.push((await tx.osMaterial.create({ data: { ...materialData(m), ordemServicoId: osId, osItemId: itemId } })).id);
  for (const [i, pc] of p.pecas.entries()) {
    await tx.osItemOrcamento.create({ data: {
      ordemServicoId: osId, tipo: "PRODUTO", produtoId: pc.produtoId, descricao: pc.descricao, quantidade: pc.quantidade, valorUnitario: pc.valorUnitario, valorTotal: pc.valorTotal,
      materialId: ids[pc.idxMaterial] ?? null, ordem: ordemBase + 1 + i, ...extra,
    } });
  }
}

/** Cria o item da OS (serviço com materiais → snapshot + peças derivadas) no fim da lista. */
export async function criarItemOs(tx: Tx, osId: string, p: ItemOsPreparado, extra: Record<string, unknown> = {}) {
  const ultimo = await tx.osItemOrcamento.findFirst({ where: { ordemServicoId: osId }, orderBy: { ordem: "desc" }, select: { ordem: true } });
  const ordem = (ultimo?.ordem ?? -1) + 1 + (p.pecas.length ? 0 : 0);
  const item = await tx.osItemOrcamento.create({ data: { ...linha(p), ordemServicoId: osId, ordem, ...extra } });
  await gravarFilhos(tx, osId, item.id, p, ordem, extra);
  return item;
}

/** Regrava um item de serviço da OS: valores, snapshot (apaga e recria) e peças derivadas (idem). */
export async function regravarItemOs(tx: Tx, osId: string, itemId: string, p: ItemOsPreparado) {
  const atual = await tx.osItemOrcamento.findFirst({ where: { id: itemId, ordemServicoId: osId }, select: { ordem: true } });
  // As peças derivadas caem com os materiais (FK CASCADE)
  await tx.osMaterial.deleteMany({ where: { osItemId: itemId } });
  const item = await tx.osItemOrcamento.update({ where: { id: itemId }, data: linha(p) });
  await gravarFilhos(tx, osId, itemId, p, atual?.ordem ?? 0);
  return item;
}

/**
 * Edição da linha como USO (descrição, quantidade, preço): grava só os valores da linha. O snapshot dos
 * materiais e as peças derivadas ficam como estão — não dependem da quantidade nem do preço da linha.
 */
export async function atualizarValoresDoItemOs(tx: Tx, itemId: string, p: ItemOsPreparado) {
  return tx.osItemOrcamento.update({ where: { id: itemId }, data: linha(p) });
}

/** Include do item da OS com o snapshot e a peça de origem (o que a tela e a fatura leem). */
export const INCLUIR_ITEM_OS = { materiais: { orderBy: { ordem: "asc" } }, material: { select: { osItemId: true } } } as const;
