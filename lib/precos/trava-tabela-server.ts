/**
 * Preço de tabela travado — a parte do servidor: a tabela que vale para o cliente (a mesma regra de
 * /api/clientes/[id]/tabela-preco: só a tabela vinculada e ATIVA; sem ela, nada é de tabela) e a permissão.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pode, type Permissoes } from "@/lib/permissoes";
import { alteracoesDePrecoDeTabela, chaveCatalogo, conferirPrecoDeTabela, PERMISSAO_PRECO_TABELA, type AlteracaoPrecoTabela, type ItemComPreco, type Veredito } from "@/lib/precos/trava-tabela";

type Db = PrismaClient | Prisma.TransactionClient;

/** chave do catálogo ("servico:id" / "produto:id") → valor da tabela do cliente. Vazio = sem tabela ativa. */
export async function precosDaTabelaDoCliente(empresaId: string, clienteId: string | null | undefined, db: Db = prisma): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (!clienteId) return mapa;
  const cliente = await db.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { tabelaPrecoId: true } });
  if (!cliente?.tabelaPrecoId) return mapa;
  const tabela = await db.tabelaPreco.findFirst({
    where: { id: cliente.tabelaPrecoId, empresaId, ativo: true },
    select: { itens: { select: { servicoId: true, produtoId: true, valorFinal: true } } },
  });
  for (const it of tabela?.itens ?? []) {
    if (it.servicoId) mapa.set(chaveCatalogo("servico", it.servicoId), Number(it.valorFinal));
    else if (it.produtoId) mapa.set(chaveCatalogo("produto", it.produtoId), Number(it.valorFinal));
  }
  return mapa;
}

/** A pessoa pode alterar preço de tabela? (o administrador pode; perfis, só com a permissão marcada) */
export const podeAlterarPrecoTabela = (user: { permissoes?: unknown; role?: string }) =>
  pode(user.permissoes as Permissoes, PERMISSAO_PRECO_TABELA[0], PERMISSAO_PRECO_TABELA[1], user.role);


/**
 * A conferência inteira, num lugar só (orçamento e OS usam a mesma): a tabela do cliente, as alterações e o
 * veredito pela permissão e pelo motivo.
 */
export async function verificarPrecoDeTabela(o: {
  user: { permissoes?: unknown; role?: string };
  empresaId: string;
  clienteId: string | null | undefined;
  itens: readonly ItemComPreco[];
  anteriores?: ReadonlyMap<string, readonly number[]>;
  motivo?: string | null;
  db?: Db;
}): Promise<{ veredito: Veredito; alteracoes: AlteracaoPrecoTabela[] }> {
  const tabela = await precosDaTabelaDoCliente(o.empresaId, o.clienteId, o.db);
  const alteracoes = alteracoesDePrecoDeTabela(o.itens, tabela, o.anteriores);
  return { alteracoes, veredito: conferirPrecoDeTabela(alteracoes, { podeAlterar: podeAlterarPrecoTabela(o.user), motivo: o.motivo }) };
}

/**
 * O preço de uma linha de SERVIÇO que se compara com a tabela: a base unitária (antes dos materiais inclusos;
 * `valorBase` é o TOTAL da base = unitário × quantidade), ou o unitário efetivo se o total foi digitado à mão.
 */
export const precoComparavelDoServico = (s: { valorUnitario: number; quantidade?: number | null; valorBase?: number | null; valorManual?: boolean | null }) =>
  s.valorManual || s.valorBase == null ? Number(s.valorUnitario) : Math.round((Number(s.valorBase) / (Number(s.quantidade) || 1)) * 100) / 100;

/** Acrescenta um valor já gravado de um item do catálogo (a edição não pede de novo o que já estava). */
export function anotarAnterior(mapa: Map<string, number[]>, chave: string | null, valor: unknown) {
  if (!chave) return;
  const n = Number(valor);
  if (!Number.isFinite(n)) return;
  mapa.set(chave, [...(mapa.get(chave) ?? []), n]);
}

/** As linhas do orçamento (já montadas por montarValoresOrcamento) no formato da conferência. */
export function itensDoOrcamentoParaTrava(valores: {
  servicos: { servicoId: string | null; descricao: string; quantidade: number; valorUnitario: number; valorBase?: number | null; valorManual?: boolean }[];
  produtos: { produtoId: string | null; descricao: string; valorUnitario: number }[];
}): ItemComPreco[] {
  return [
    ...valores.servicos.map((s) => ({ tipo: "servico" as const, catalogoId: s.servicoId, descricao: s.descricao, valorUnitario: precoComparavelDoServico(s) })),
    ...valores.produtos.map((p) => ({ tipo: "produto" as const, catalogoId: p.produtoId, descricao: p.descricao, valorUnitario: Number(p.valorUnitario) })),
  ];
}

/** Os preços já gravados no orçamento (para a edição não pedir de novo o que já estava). */
export async function precosAnterioresDoOrcamento(orcamentoId: string, db: Db = prisma): Promise<Map<string, number[]>> {
  const [ss, ps] = await Promise.all([
    db.orcamentoServico.findMany({ where: { orcamentoId }, select: { servicoId: true, quantidade: true, valorUnitario: true, valorBase: true, valorManual: true } }),
    db.orcamentoProduto.findMany({ where: { orcamentoId }, select: { produtoId: true, valorUnitario: true } }),
  ]);
  const m = new Map<string, number[]>();
  for (const s of ss) anotarAnterior(m, s.servicoId ? chaveCatalogo("servico", s.servicoId) : null,
    precoComparavelDoServico({ valorUnitario: Number(s.valorUnitario), quantidade: Number(s.quantidade), valorBase: s.valorBase == null ? null : Number(s.valorBase), valorManual: s.valorManual }));
  for (const p of ps) anotarAnterior(m, p.produtoId ? chaveCatalogo("produto", p.produtoId) : null, p.valorUnitario);
  return m;
}

/**
 * A conferência de UM item da OS (incluir, editar, editar como uso). `anterior`: o preço comparável gravado
 * antes (na edição). O cliente é o da OS.
 */
export async function verificarItemDaOs(o: {
  user: { permissoes?: unknown; role?: string };
  empresaId: string;
  osId: string;
  item: { tipo: "SERVICO" | "PRODUTO"; servicoId?: string | null; produtoId?: string | null; descricao: string; quantidade: number; valorUnitario: number; valorBase?: number | null; valorManual?: boolean | null };
  anterior?: number | null;
  motivo?: string | null;
  db?: Db;
}) {
  const os = await (o.db ?? prisma).ordemServico.findFirst({ where: { id: o.osId, empresaId: o.empresaId }, select: { clienteId: true } });
  const tipo = o.item.tipo === "SERVICO" ? "servico" as const : "produto" as const;
  const catalogoId = tipo === "servico" ? o.item.servicoId : o.item.produtoId;
  return verificarPrecoDeTabela({
    user: o.user, empresaId: o.empresaId, clienteId: os?.clienteId, db: o.db, motivo: o.motivo,
    itens: [{ tipo, catalogoId, descricao: o.item.descricao, valorUnitario: precoComparavelDoServico(o.item) }],
    anteriores: catalogoId && o.anterior != null ? new Map([[chaveCatalogo(tipo, catalogoId), [o.anterior]]]) : undefined,
  });
}
