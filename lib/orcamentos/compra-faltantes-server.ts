/**
 * Orçamento, leva C — o lado do servidor da "compra dos faltantes" (regras em lib/orcamentos/compra-faltantes).
 *
 * - Quem pode: a MESMA regra do POST /api/pedidos-compra para um pedido com origem no orçamento — Compras › gerenciar
 *   ou Orçamentos › editar (`podeSolicitarCompraDoOrcamento`).
 * - Módulos: só com Compras E Estoque ligados (`compraFaltantesLigada`); desligado, a tela some (nunca 403).
 * - O pedido nasce no estado inicial do fluxo de compras (SOLICITADO), ligado ao orçamento e à OS gerada dele (se
 *   houver), com a observação de origem, cada produto faltante na quantidade que falta e SEM valor estimado (nenhum
 *   custo novo vai a ninguém).
 * - Idempotente e seguro contra clique duplo: tudo numa transação com uma trava por orçamento.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pode, type Permissoes } from "@/lib/permissoes";
import { temModulo } from "@/lib/modulos/servidor";
import { arred } from "@/lib/estoque/regras";
import { proximoNumeroPedido, registrarEventoPedido } from "@/lib/compras/pedido-server";
import { pedidoEncerrado } from "@/lib/compras/pedido";
import {
  faltantesDoOrcamento, necessidadePorProduto, observacaoDeOrigem, orcamentoAceitaSolicitacao, planoDaSolicitacao,
  type Faltante, type PedidoAbertoResumo,
} from "@/lib/orcamentos/compra-faltantes";

type Db = Prisma.TransactionClient | typeof prisma;
type Usuario = { id: string; empresaId: string; permissoes?: unknown; role?: string | null };

/** Quem pode pedir a compra pelo orçamento: a mesma regra do POST de pedido com origem no orçamento. */
export function podeSolicitarCompraDoOrcamento(u: Pick<Usuario, "permissoes" | "role">): boolean {
  const p = u.permissoes as Permissoes;
  return pode(p, "compras", "gerenciar", u.role ?? undefined) || pode(p, "orcamentos", "editar", u.role ?? undefined);
}

/** A ação existe só com Compras E Estoque ligados (sem Estoque não há disponível; sem Compras, não há pedido). */
export async function compraFaltantesLigada(empresaId: string): Promise<boolean> {
  const [compras, estoque] = await Promise.all([temModulo(empresaId, "compras"), temModulo(empresaId, "estoque")]);
  return compras && estoque;
}

export interface SituacaoFaltantes {
  orcamento: { id: string; codigo: string; status: string; osGeradaId: string | null };
  faltantes: Faltante[];
  abertos: PedidoAbertoResumo[];
}

/** O que falta no estoque para este orçamento e o que já está pedido (só a empresa da sessão). */
export async function situacaoDosFaltantes(empresaId: string, orcamentoId: string, db: Db = prisma): Promise<SituacaoFaltantes | null> {
  const o = await db.orcamento.findFirst({
    where: { id: orcamentoId, empresaId },
    select: {
      id: true, codigo: true, status: true, osGerada: { select: { id: true } },
      produtos: { select: { produtoId: true, quantidade: true, materialId: true } },
      servicos: { select: { materiais: { select: { produtoId: true, quantidade: true } } } },
    },
  });
  if (!o) return null;
  const necessidade = necessidadePorProduto({ produtos: o.produtos, materiais: o.servicos.flatMap((s) => s.materiais) });
  const ids = [...necessidade.keys()];
  const [produtos, pedidos] = await Promise.all([
    ids.length ? db.produto.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, nome: true, unidade: true, controlaEstoque: true, saldo: true } }) : Promise.resolve([]),
    db.pedidoCompraInterno.findMany({
      where: { empresaId, orcamentoId: o.id },
      orderBy: { criadoEm: "desc" },
      select: { id: true, numero: true, status: true, itens: { select: { produtoId: true, quantidade: true } } },
    }),
  ]);
  const abertos = pedidos.filter((p) => !pedidoEncerrado(p.status));
  const faltantes = faltantesDoOrcamento(
    necessidade,
    produtos.map((p) => ({ id: p.id, nome: p.nome, unidade: p.unidade, controlaEstoque: p.controlaEstoque, disponivel: arred(Number(p.saldo)) })),
    abertos,
  );
  return { orcamento: { id: o.id, codigo: o.codigo, status: o.status, osGeradaId: o.osGerada?.id ?? null }, faltantes, abertos };
}

export type ResultadoSolicitacao =
  | { ok: true; acao: "criado" | "acrescentado" | "nada"; pedido: { id: string; numero: string } | null; pedidos: { id: string; numero: string }[]; itens: number }
  | { ok: false; status: number; erro: string };

/** Cria (ou completa) o pedido de compra dos faltantes deste orçamento. Clicar de novo não duplica. */
export async function solicitarCompraDosFaltantes(empresaId: string, usuarioId: string, orcamentoId: string): Promise<ResultadoSolicitacao> {
  const executar = () => prisma.$transaction(async (tx): Promise<ResultadoSolicitacao> => {
    // Trava por orçamento: dois cliques ao mesmo tempo esperam um pelo outro e o segundo vê o pedido do primeiro
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`compra-faltantes:${orcamentoId}`}))`;
    const s = await situacaoDosFaltantes(empresaId, orcamentoId, tx);
    if (!s) return { ok: false, status: 404, erro: "Orçamento não encontrado" };
    if (!orcamentoAceitaSolicitacao(s.orcamento.status)) return { ok: false, status: 400, erro: "Orçamento cancelado ou reprovado: não há compra a solicitar." };
    const plano = planoDaSolicitacao(s.faltantes, s.abertos);
    if (plano.acao === "nada") {
      if (!s.faltantes.length) return { ok: false, status: 400, erro: "Nenhum item deste orçamento está faltando no estoque." };
      return { ok: true, acao: "nada", pedido: plano.pedidos[0] ?? null, pedidos: plano.pedidos, itens: 0 };
    }
    if (plano.acao === "acrescentar") {
      const pedido = await tx.pedidoCompraInterno.findUniqueOrThrow({ where: { id: plano.pedidoId }, select: { id: true, numero: true, itens: { select: { id: true, produtoId: true, quantidade: true } } } });
      for (const it of plano.itens) {
        const existente = pedido.itens.find((i) => i.produtoId === it.produtoId);
        if (existente) await tx.pedidoCompraItem.update({ where: { id: existente.id }, data: { quantidade: arred(Number(existente.quantidade) + it.quantidade) } });
        else await tx.pedidoCompraItem.create({ data: { pedidoId: pedido.id, produtoId: it.produtoId, descricao: it.descricao, quantidade: it.quantidade, unidade: it.unidade } });
      }
      await registrarEventoPedido({
        empresaId, pedidoId: pedido.id, tipo: "EDITADO", usuarioId,
        detalhe: `Faltantes do orçamento ${s.orcamento.codigo}: ${plano.itens.map((i) => `${i.descricao} +${i.quantidade} ${i.unidade}`).join("; ")}`.slice(0, 1000),
      }, tx);
      return { ok: true, acao: "acrescentado", pedido: { id: pedido.id, numero: pedido.numero }, pedidos: [{ id: pedido.id, numero: pedido.numero }], itens: plano.itens.length };
    }
    const numero = await proximoNumeroPedido(empresaId, tx);
    const pedido = await tx.pedidoCompraInterno.create({
      data: {
        empresaId, numero, orcamentoId: s.orcamento.id, ordemServicoId: s.orcamento.osGeradaId, solicitanteId: usuarioId,
        status: "SOLICITADO", observacao: observacaoDeOrigem(s.orcamento.codigo),
        itens: { create: plano.itens.map((i) => ({ produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade })) },
      },
      select: { id: true, numero: true },
    });
    await registrarEventoPedido({
      empresaId, pedidoId: pedido.id, tipo: "CRIADO", usuarioId,
      detalhe: `${plano.itens.length} ${plano.itens.length === 1 ? "item" : "itens"} · faltantes do orçamento ${s.orcamento.codigo}`,
    }, tx);
    return { ok: true, acao: "criado", pedido, pedidos: [pedido], itens: plano.itens.length };
  });
  // Dois pedidos de orçamentos diferentes ao mesmo tempo podem disputar o número: tenta de novo (como o POST do pedido)
  for (let tentativa = 0; ; tentativa++) {
    try { return await executar(); }
    catch (e) { if (tentativa >= 2 || (e as { code?: string })?.code !== "P2002") throw e; }
  }
}
