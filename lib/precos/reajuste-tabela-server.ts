/**
 * Reajuste em massa da tabela de preço — a parte do servidor (regras em lib/precos/reajuste-tabela): ler os itens,
 * gravar o lote (tabela_preco_reajustes, com o antes e o depois) e desfazer o último lote ainda não desfeito.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  erroDoPedido, planoDeDesfazer, previaDoReajuste,
  type ItemDaTabela, type LinhaReajuste, type PlanoDesfazer, type TipoPreco, type TipoReajuste,
} from "@/lib/precos/reajuste-tabela";

type Db = PrismaClient | Prisma.TransactionClient;
type Falha = { ok: false; status: number; erro: string };
const falha = (status: number, erro: string): Falha => ({ ok: false, status, erro });
const num = (v: unknown) => (v == null ? null : Number(v));

/** Os itens da tabela como estão agora (null = a tabela não é desta empresa) */
export async function itensDaTabela(empresaId: string, tabelaId: string, db: Db = prisma): Promise<ItemDaTabela[] | null> {
  const t = await db.tabelaPreco.findFirst({
    where: { id: tabelaId, empresaId },
    select: { itens: { select: {
      id: true, servicoId: true, produtoId: true, tipoPreco: true, valorFixo: true, descontoPercent: true, valorFinal: true,
      servico: { select: { nome: true, valorPadrao: true } }, produto: { select: { nome: true, valorPadrao: true } },
    } } },
  });
  if (!t) return null;
  return t.itens
    .map((i) => ({
      id: i.id, servicoId: i.servicoId, produtoId: i.produtoId, tipoPreco: i.tipoPreco as TipoPreco,
      valorFixo: num(i.valorFixo), descontoPercent: num(i.descontoPercent), valorFinal: Number(i.valorFinal),
      descricao: (i.servico ?? i.produto)?.nome ?? "(item removido)",
      valorPadrao: Number((i.servico ?? i.produto)?.valorPadrao ?? 0),
    }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
}

export interface ResumoLote { id: string; tipo: string; valor: number; motivo: string; criadoEm: Date; usuarioNome: string | null; itens: number }

/** O último lote ainda não desfeito (é ele que o "Desfazer reajuste" desfaz) */
async function loteAtivo(empresaId: string, tabelaId: string, db: Db) {
  return db.tabelaPrecoReajuste.findFirst({ where: { empresaId, tabelaPrecoId: tabelaId, desfeitoEm: null }, orderBy: { criadoEm: "desc" } });
}

export async function ultimoReajuste(empresaId: string, tabelaId: string, db: Db = prisma): Promise<ResumoLote | null> {
  const l = await loteAtivo(empresaId, tabelaId, db);
  if (!l) return null;
  const u = l.usuarioId ? await db.usuario.findFirst({ where: { id: l.usuarioId }, select: { nome: true } }) : null;
  return { id: l.id, tipo: l.tipo, valor: Number(l.valor), motivo: l.motivo, criadoEm: l.criadoEm, usuarioNome: u?.nome ?? null, itens: (l.itens as unknown as LinhaReajuste[]).length };
}

/**
 * Reajustar: `previa` = só a conta (nada gravado); sem ela, grava os preços novos e o lote, na mesma transação.
 */
export async function reajustarTabela(o: {
  empresaId: string; usuarioId: string | null; tabelaId: string;
  corpo: { tipo?: unknown; valor?: unknown; itemIds?: unknown; motivo?: unknown; previa?: unknown };
}): Promise<{ ok: true; previa: boolean; linhas: LinhaReajuste[]; loteId?: string } | Falha> {
  const c = o.corpo;
  const previa = c.previa !== false;
  // Na prévia o motivo ainda pode estar em branco; para aplicar, é obrigatório
  const erro = erroDoPedido({ tipo: c.tipo, valor: c.valor, itemIds: c.itemIds ?? undefined, motivo: previa ? undefined : (c.motivo ?? "") });
  if (erro) return falha(400, erro);
  const pedido = { tipo: c.tipo as TipoReajuste, valor: Number(c.valor), itemIds: (c.itemIds as string[] | undefined) ?? null };

  return prisma.$transaction(async (tx) => {
    const itens = await itensDaTabela(o.empresaId, o.tabelaId, tx);
    if (!itens) return falha(404, "Tabela de preço não encontrada.");
    const p = previaDoReajuste(itens, pedido);
    if (!p.ok) return falha(400, p.erro);
    if (previa) return { ok: true as const, previa: true, linhas: p.linhas };
    for (const l of p.linhas) {
      await tx.tabelaPrecoItem.update({ where: { id: l.itemId }, data: { tipoPreco: l.depois.tipoPreco, valorFixo: l.depois.valorFixo, descontoPercent: l.depois.descontoPercent, valorFinal: l.depois.valorFinal } });
    }
    const lote = await tx.tabelaPrecoReajuste.create({ data: {
      empresaId: o.empresaId, tabelaPrecoId: o.tabelaId, usuarioId: o.usuarioId, tipo: pedido.tipo, valor: pedido.valor,
      motivo: String(c.motivo).trim(), itens: p.linhas as unknown as Prisma.InputJsonValue,
    } });
    return { ok: true as const, previa: false, linhas: p.linhas, loteId: lote.id };
  }, { timeout: 20_000 });
}

/**
 * Desfazer o último lote ainda não desfeito: volta o antes de cada item que está como o lote deixou; os outros ficam
 * (e voltam no aviso). `previa`: só o plano. Marca o lote como desfeito (quem e quando) mesmo que nenhum item volte:
 * o lote anterior passa a ser o "último".
 */
export async function desfazerReajuste(o: { empresaId: string; usuarioId: string | null; tabelaId: string; previa: boolean }):
  Promise<{ ok: true; previa: boolean; lote: { id: string; tipo: string; valor: number; motivo: string; criadoEm: Date }; plano: PlanoDesfazer } | Falha> {
  return prisma.$transaction(async (tx) => {
    const itens = await itensDaTabela(o.empresaId, o.tabelaId, tx);
    if (!itens) return falha(404, "Tabela de preço não encontrada.");
    const lote = await loteAtivo(o.empresaId, o.tabelaId, tx);
    if (!lote) return falha(409, "Não há reajuste para desfazer nesta tabela.");
    const plano = planoDeDesfazer(lote.itens as unknown as LinhaReajuste[], itens);
    const resumo = { id: lote.id, tipo: lote.tipo, valor: Number(lote.valor), motivo: lote.motivo, criadoEm: lote.criadoEm };
    if (o.previa) return { ok: true as const, previa: true, lote: resumo, plano };
    // Marca primeiro, condicionado a "ainda não desfeito": dois cliques ao mesmo tempo não desfazem duas vezes
    const marcado = await tx.tabelaPrecoReajuste.updateMany({ where: { id: lote.id, desfeitoEm: null }, data: { desfeitoEm: new Date(), desfeitoPorId: o.usuarioId } });
    if (!marcado.count) return falha(409, "Este reajuste já foi desfeito.");
    for (const v of plano.voltam) {
      await tx.tabelaPrecoItem.update({ where: { id: v.itemId }, data: { tipoPreco: v.preco.tipoPreco, valorFixo: v.preco.valorFixo, descontoPercent: v.preco.descontoPercent, valorFinal: v.preco.valorFinal } });
    }
    return { ok: true as const, previa: false, lote: resumo, plano };
  }, { timeout: 20_000 });
}
