/**
 * Pedido de Compra (PCI) — o lado do servidor das regras de lib/compras/pedido.ts: número do ano pelo
 * MAIOR sequencial, histórico (eventos), última compra de cada produto e quem pode ser comprador.
 * Empresa SEMPRE a da sessão (quem chama passa).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { anoBR, chaveDiaCivil } from "@/lib/fuso";
import { permissoesDoUsuario } from "@/lib/permissoes";
import {
  codigoPedidoCompra, origemDoPedido, pedidoEditavel, podeEditarPedido, podeEnviarPedido, temAcessoCompras,
  type PedidoTela, type StatusPedido, type UltimaCompra, type UsuarioPedido,
} from "@/lib/compras/pedido";

type Tx = Prisma.TransactionClient | typeof prisma;

/**
 * Próximo número do PC do ano ("PCI-2026-0147"), por empresa, pelo MAIOR sequencial já usado — a mesma
 * regra da OS e do orçamento. Nunca "total + 1" (colide depois de excluir) nem a ordem de texto.
 */
export async function proximoNumeroPedido(empresaId: string, ano = anoBR(), db: Tx = prisma): Promise<string> {
  const prefixo = `PCI-${ano}-`;
  const [r] = await db.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(split_part(numero, '-', 3) AS INTEGER)) AS max
    FROM pedidos_compra_interno
    WHERE empresa_id = ${empresaId} AND numero LIKE ${prefixo + "%"} AND split_part(numero, '-', 3) ~ '^[0-9]{1,9}$'`;
  return codigoPedidoCompra(ano, (r?.max ?? 0) + 1);
}

/** Uma linha no histórico do pedido */
export function registrarEventoPedido(
  p: { empresaId: string; pedidoId: string; tipo: string; detalhe?: string | null; usuarioId?: string | null },
  db: Tx = prisma,
) {
  return db.pedidoCompraEvento.create({
    data: { empresaId: p.empresaId, pedidoId: p.pedidoId, tipo: p.tipo, detalhe: p.detalhe ?? null, usuarioId: p.usuarioId ?? null },
  });
}

/**
 * Última compra de cada produto (a dica do valor estimado): o valor unitário NA UNIDADE DO PRODUTO,
 * o fornecedor e a data. Fontes, a mais recente vence:
 *  - entrada de estoque por COMPRA com custo (a da NF traz o fornecedor e a data de emissão);
 *  - item de NF já vinculado ao produto (valor ÷ fator de conversão), mesmo antes de lançar.
 * Sem histórico, o produto não aparece no mapa.
 */
export async function ultimasCompras(empresaId: string, produtoIds: string[]): Promise<Record<string, UltimaCompra>> {
  const ids = [...new Set(produtoIds.filter(Boolean))];
  if (!ids.length) return {};
  const [movs, itensNf] = await Promise.all([
    prisma.movimentacaoEstoque.findMany({
      where: { empresaId, produtoId: { in: ids }, tipo: "ENTRADA", origem: "COMPRA", custoUnitario: { gt: 0 } },
      orderBy: [{ produtoId: "asc" }, { data: "desc" }, { criadoEm: "desc" }],
      distinct: ["produtoId"],
      select: { produtoId: true, custoUnitario: true, data: true, refId: true },
    }),
    prisma.notaCompraItem.findMany({
      where: { produtoId: { in: ids }, valorUnitario: { gt: 0 }, nota: { empresaId } },
      orderBy: [{ produtoId: "asc" }, { nota: { dataEmissao: "desc" } }, { criadoEm: "desc" }],
      distinct: ["produtoId"],
      select: { produtoId: true, valorUnitario: true, fatorConversao: true, nota: { select: { dataEmissao: true, emitenteNome: true, fornecedor: { select: { nome: true } } } } },
    }),
  ]);
  const notas = await prisma.notaCompra.findMany({
    where: { empresaId, id: { in: movs.map((m) => m.refId).filter((x): x is string => !!x) } },
    select: { id: true, dataEmissao: true, emitenteNome: true, fornecedor: { select: { nome: true } } },
  });
  const notaPorId = new Map(notas.map((n) => [n.id, n]));

  const r: Record<string, UltimaCompra> = {};
  const ficar = (produtoId: string, u: UltimaCompra) => {
    const atual = r[produtoId];
    if (!atual || new Date(u.data).getTime() > new Date(atual.data).getTime()) r[produtoId] = u;
  };
  for (const m of movs) {
    const nota = m.refId ? notaPorId.get(m.refId) : undefined;
    ficar(m.produtoId, {
      valorUnitario: Number(m.custoUnitario),
      fornecedor: nota ? nota.fornecedor?.nome ?? nota.emitenteNome : null,
      data: nota?.dataEmissao ?? m.data,
    });
  }
  for (const i of itensNf) {
    const fator = Number(i.fatorConversao) > 0 ? Number(i.fatorConversao) : 1;
    ficar(i.produtoId!, { valorUnitario: Number(i.valorUnitario) / fator, fornecedor: i.nota.fornecedor?.nome ?? i.nota.emitenteNome, data: i.nota.dataEmissao });
  }
  return r;
}

/** Quem pode ser comprador responsável: usuários ATIVOS da empresa com acesso a Compras */
export async function compradoresDaEmpresa(empresaId: string): Promise<{ id: string; nome: string }[]> {
  const usuarios = await prisma.usuario.findMany({
    where: { empresaId, ativo: true },
    select: { id: true, nome: true, role: true, perfilAcesso: { select: { ativo: true, permissoes: true } } },
    orderBy: { nome: "asc" },
  });
  return usuarios.filter((u) => temAcessoCompras({ role: u.role, permissoes: permissoesDoUsuario(u) })).map((u) => ({ id: u.id, nome: u.nome }));
}

/** O comprador escolhido é um dos que podem (vazio = sem comprador) */
export async function compradorValido(empresaId: string, compradorId: string | null | undefined): Promise<boolean> {
  if (!compradorId) return true;
  return (await compradoresDaEmpresa(empresaId)).some((c) => c.id === compradorId);
}

/** O que a tela e o PDF precisam do pedido (empresa da sessão) */
export const INCLUDE_PEDIDO = {
  itens: { orderBy: { id: "asc" }, include: { produto: { select: { id: true, nome: true } } } },
  comprador: { select: { id: true, nome: true, telefone: true } },
  solicitante: { select: { id: true, nome: true } },
  fornecedor: { select: { id: true, nome: true, email: true, telefone: true, ativo: true } },
  ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
  orcamento: { select: { id: true, codigo: true, ordensServico: { select: { ordemServico: { select: { id: true, numero: true } } }, take: 1 } } },
  eventos: { orderBy: { criadoEm: "desc" }, include: { usuario: { select: { nome: true } } } },
} satisfies Prisma.PedidoCompraInternoInclude;

export type PedidoCompleto = Prisma.PedidoCompraInternoGetPayload<{ include: typeof INCLUDE_PEDIDO }>;

export function carregarPedido(id: string, empresaId: string) {
  return prisma.pedidoCompraInterno.findFirst({ where: { id, empresaId }, include: INCLUDE_PEDIDO });
}

/** Origem do pedido carregado com INCLUDE_PEDIDO (o orçamento dentro de uma OS mostra a OS) */
type Ref = { id: string; numero: string };
export function origemDoPedidoCompleto(p: {
  ordemServico: Ref | null;
  orcamento: { id: string; codigo: string; ordensServico: { ordemServico: Ref }[] } | null;
}) {
  return origemDoPedido({
    ordemServico: p.ordemServico ? { id: p.ordemServico.id, numero: p.ordemServico.numero } : null,
    orcamento: p.orcamento ? { id: p.orcamento.id, codigo: p.orcamento.codigo, ordensServico: p.orcamento.ordensServico.map((v) => v.ordemServico) } : null,
  });
}

/** O pedido como a tela usa (datas em texto, decimais em número) e o que este usuário pode fazer nele */
export function pedidoParaTela(p: PedidoCompleto, u: UsuarioPedido): PedidoTela {
  return {
    id: p.id, numero: p.numero, status: p.status as StatusPedido, statusEm: p.statusEm.toISOString(), criadoEm: p.criadoEm.toISOString(),
    prazoNecessario: p.prazoNecessario ? chaveDiaCivil(p.prazoNecessario) : null,
    observacao: p.observacao, motivo: p.motivo, tokenPublico: p.tokenPublico,
    solicitante: p.solicitante, comprador: p.comprador ? { id: p.comprador.id, nome: p.comprador.nome } : null,
    fornecedor: p.fornecedor,
    origem: origemDoPedidoCompleto(p),
    itens: p.itens.map((i) => ({
      id: i.id, produtoId: i.produtoId, produtoNome: i.produto?.nome ?? null, descricao: i.descricao, quantidade: Number(i.quantidade), unidade: i.unidade,
      valorEstimado: i.valorEstimado == null ? null : Number(i.valorEstimado), valorReal: i.valorReal == null ? null : Number(i.valorReal),
    })),
    eventos: p.eventos.map((e) => ({ id: e.id, tipo: e.tipo, detalhe: e.detalhe, criadoEm: e.criadoEm.toISOString(), usuarioNome: e.usuario?.nome ?? null })),
    podeEditar: podeEditarPedido(u, p) && pedidoEditavel(p.status),
    podeEnviar: podeEnviarPedido(u, p),
  };
}
