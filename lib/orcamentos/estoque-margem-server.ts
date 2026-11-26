/**
 * Orçamento, leva B — o lado do servidor de estoque e margem (regras em lib/orcamentos/estoque-margem).
 *
 * - `podeVerCusto`: a permissão "Orçamentos › Ver custo e margem" (administrador sempre).
 * - `situacaoDosProdutos`: disponível (só com o módulo Estoque ligado — desligado, o campo nem vem) e custo
 *   (só com a permissão — sem ela, o campo nem vem). Só produtos da empresa da sessão.
 * - `fixarCustosDosMateriais`: ao salvar, o custo de cada material é decidido AQUI, nunca o do navegador.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pode, type Permissoes } from "@/lib/permissoes";
import { temModulo } from "@/lib/modulos/servidor";
import { ultimosCustos } from "@/lib/estoque/custo";
import { arred } from "@/lib/estoque/regras";
import { custoConfiavel, type SituacaoProduto } from "@/lib/orcamentos/estoque-margem";

type Db = Prisma.TransactionClient | typeof prisma;
/** Quantos produtos uma consulta da tela pode pedir de uma vez */
export const MAX_PRODUTOS_SITUACAO = 300;

/** A sessão tem "Orçamentos › Ver custo e margem"? (role ADMIN/SUPER_ADMIN: sempre) */
export function podeVerCusto(user: { permissoes?: unknown; role?: string | null } | null | undefined): boolean {
  return !!user && pode(user.permissoes as Permissoes, "orcamentos", "verCusto", user.role ?? undefined);
}

export interface RespostaSituacao {
  /** O módulo Estoque está ligado para a empresa? Desligado: nenhum `disponivel` vem */
  estoque: boolean;
  produtos: Record<string, SituacaoProduto>;
}

/** Disponível e custo dos produtos pedidos, só o que a empresa e a permissão deixam. */
export async function situacaoDosProdutos(empresaId: string, ids: readonly string[], opcoes: { verCusto: boolean }): Promise<RespostaSituacao> {
  const unicos = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, MAX_PRODUTOS_SITUACAO);
  const estoque = await temModulo(empresaId, "estoque");
  if (!unicos.length) return { estoque, produtos: {} };
  const linhas = await prisma.produto.findMany({
    where: { id: { in: unicos }, empresaId },
    select: { id: true, unidade: true, saldo: true, controlaEstoque: true },
  });
  const custos = opcoes.verCusto ? await ultimosCustos(empresaId, linhas.map((l) => l.id)) : null;
  const produtos: Record<string, SituacaoProduto> = {};
  for (const l of linhas) {
    const s: SituacaoProduto = { unidade: l.unidade };
    if (estoque) s.disponivel = l.controlaEstoque ? arred(Number(l.saldo)) : null;
    if (custos) s.custo = custos.get(l.id) ?? null;
    produtos[l.id] = s;
  }
  return { estoque, produtos };
}

/**
 * Ao salvar: troca o custo de cada material pelo custo CONFIÁVEL (o gravado neste orçamento, ou o último custo de
 * compra para material novo). Assim o custo nunca precisa ir ao navegador de quem não tem a permissão — e
 * ninguém consegue gravar um custo inventado.
 */
export async function fixarCustosDosMateriais(
  empresaId: string, orcamentoId: string | null,
  servicos: readonly { materiais: { id?: string | null; produtoId?: string | null; custoUnit: number | null }[] }[],
  db: Db = prisma,
) {
  const todos = servicos.flatMap((s) => s.materiais);
  if (!todos.length) return;
  const gravados = new Map<string, { produtoId: string | null; custoUnit: number | null }>();
  if (orcamentoId) {
    const linhas = await db.orcamentoMaterial.findMany({
      where: { orcamentoId, orcamento: { empresaId } },
      select: { id: true, produtoId: true, custoUnit: true },
    });
    for (const l of linhas) gravados.set(l.id, { produtoId: l.produtoId, custoUnit: l.custoUnit == null ? null : Number(l.custoUnit) });
  }
  const novos = todos.filter((m) => m.produtoId && !(m.id && gravados.get(m.id)?.produtoId === m.produtoId)).map((m) => m.produtoId!);
  const ultimos = novos.length ? await ultimosCustos(empresaId, novos, {}, db) : new Map<string, number>();
  for (const m of todos) m.custoUnit = custoConfiavel(m, gravados, ultimos);
}
