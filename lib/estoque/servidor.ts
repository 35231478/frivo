/**
 * Estoque — acesso ao banco: lançar movimentação (razão + saldo na MESMA transação), a lista com
 * saldos e alertas, e o extrato de um produto. Empresa sempre da sessão (quem chama passa a da
 * sessão); o produto precisa ser da empresa (validarRefEmpresa).
 *
 * Fonte da verdade = razão (movimentacoes_estoque, quantidade COM SINAL). `produtos.saldo` é cache:
 * só muda aqui, junto com o lançamento — então saldo = soma do razão, sempre.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ErroRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida, um, type MapaOrdem, type ParamsUrl } from "@/lib/listagem";
import { lerPeriodo, type Periodo } from "@/lib/periodo";
import { arred, avisoSaldo, calcularMovimento, situacaoEstoque, type Operacao, type OrigemMov, type Situacao, type TipoMov } from "@/lib/estoque/regras";

/** Regra de negócio recusada (vira 400 na API). */
export class ErroEstoque extends Error {}

export interface Movimentar {
  empresaId: string;
  produtoId: string;
  operacao: Operacao;
  /** Quantidade (ENTRADA/SAIDA/DEVOLUCAO) ou saldo final (AJUSTE/INVENTARIO) */
  valor: number;
  usuarioId?: string | null;
  custoUnitario?: number | null;
  observacao?: string | null;
  /** Documento de origem (pedido de compra, OS…) — para as próximas levas */
  refId?: string | null;
  /** Sobrescreve a origem padrão da operação (ex.: ENTRADA vinda de inventário inicial) */
  origem?: OrigemMov;
}

export interface Movimentado {
  movimentacao: { id: string; tipo: TipoMov; origem: OrigemMov; quantidade: number; saldoApos: number };
  saldo: number;
  /** Saldo negativo é permitido — mas avisa */
  aviso: string | null;
}

/**
 * Lança a movimentação (razão + saldo juntos). Sem `tx`: abre a própria transação. Com `tx`: roda
 * DENTRO da transação de quem chama (ex.: lançamento da nota de compra, que grava várias entradas
 * e as contas a pagar de uma vez — ou tudo, ou nada).
 */
export async function movimentar(m: Movimentar, tx?: Prisma.TransactionClient): Promise<Movimentado> {
  const defineSaldo = m.operacao === "AJUSTE" || m.operacao === "INVENTARIO";
  // Quantidade > 0 (o sinal vem da operação); saldo final ≥ 0. Também barra NaN/Infinity.
  if (!Number.isFinite(m.valor) || (defineSaldo ? m.valor < 0 : !(arred(m.valor) > 0)))
    throw new ErroEstoque(defineSaldo ? "O saldo informado não pode ser negativo." : "A quantidade precisa ser maior que zero.");
  if (tx) return lancarNaTransacao(tx, m);
  await validarRefEmpresa("produto", m.produtoId, m.empresaId, "Produto");
  return prisma.$transaction((t) => lancarNaTransacao(t, m));
}

async function lancarNaTransacao(tx: Prisma.TransactionClient, m: Movimentar): Promise<Movimentado> {
  // "saldo + 0" trava a linha do produto até o fim da transação e devolve o saldo atual:
  // dois lançamentos simultâneos do mesmo produto entram em fila (nenhum se perde).
  // Produto de outra empresa (ou inexistente) não casa com o where → recusado.
  const atual = await tx.produto.update({
    where: { id: m.produtoId, empresaId: m.empresaId },
    data: { saldo: { increment: 0 } },
    select: { saldo: true, unidade: true },
  }).catch((e: { code?: string }) => { throw e?.code === "P2025" ? new ErroRefEmpresa("Produto inválido(a).") : e; });
  const saldoAtual = Number(atual.saldo);
  const { tipo, origem, delta } = calcularMovimento(m.operacao, saldoAtual, m.valor);
  if (m.operacao === "AJUSTE" && delta === 0) throw new ErroEstoque("O saldo já é esse — não há o que ajustar.");

  const novo = await tx.produto.update({
    where: { id: m.produtoId, empresaId: m.empresaId },
    data: { saldo: { increment: delta } },
    select: { saldo: true },
  });
  const saldoApos = arred(Number(novo.saldo));
  const mov = await tx.movimentacaoEstoque.create({
    data: {
      empresaId: m.empresaId, produtoId: m.produtoId, tipo, origem: m.origem ?? origem,
      quantidade: delta, saldoApos,
      custoUnitario: m.custoUnitario ?? null, refId: m.refId ?? null,
      observacao: m.observacao?.trim() || null, usuarioId: m.usuarioId ?? null,
    },
    select: { id: true },
  });
  return {
    movimentacao: { id: mov.id, tipo, origem: m.origem ?? origem, quantidade: delta, saldoApos },
    saldo: saldoApos,
    aviso: avisoSaldo(saldoApos, atual.unidade),
  };
}

/* ───────── Lista ───────── */
export const ORDEM_ESTOQUE: MapaOrdem = {
  nome: (d) => ({ nome: d }),
  saldo: (d) => ({ saldo: d }),
  minimo: (d) => ({ estoqueMinimo: { sort: d, nulls: "last" } }),
  unidade: (d) => ({ unidade: d }),
};
export const ORDEM_PADRAO_ESTOQUE = { nome: "asc" };
export const FILTROS_SITUACAO = { abaixo: "Abaixo do mínimo", negativo: "Saldo negativo" } as const;
export type FiltroSituacao = keyof typeof FILTROS_SITUACAO;

export interface LinhaEstoque {
  id: string; nome: string; descricao: string | null; unidade: string; ativo: boolean; controlaEstoque: boolean;
  saldo: number; estoqueMinimo: number | null; situacao: Situacao;
}

/** A tela Estoque é dos produtos que CONTROLAM estoque (ativos; inativos sob pedido). */
export function whereEstoque(empresaId: string, f: { busca?: string; inativos?: string }): Prisma.ProdutoWhereInput {
  const q = (f.busca ?? "").trim().slice(0, 100);
  return {
    empresaId, controlaEstoque: true,
    ...(f.inativos === "1" ? {} : { ativo: true }),
    ...(q && { OR: [{ nome: { contains: q, mode: "insensitive" } }, { descricao: { contains: q, mode: "insensitive" } }] }),
  };
}

const linha = (p: { id: string; nome: string; descricao: string | null; unidade: string; ativo: boolean; controlaEstoque: boolean; saldo: unknown; estoqueMinimo: number | null }): LinhaEstoque => {
  const saldo = arred(Number(p.saldo));
  return { id: p.id, nome: p.nome, descricao: p.descricao, unidade: p.unidade, ativo: p.ativo, controlaEstoque: p.controlaEstoque, saldo, estoqueMinimo: p.estoqueMinimo, situacao: situacaoEstoque(saldo, p.estoqueMinimo) };
};
const SELECT_LINHA = { id: true, nome: true, descricao: true, unidade: true, ativo: true, controlaEstoque: true, saldo: true, estoqueMinimo: true } as const;

export async function listarEstoque(empresaId: string, sp: ParamsUrl) {
  const busca = um(sp.busca), inativos = um(sp.inativos), sit = um(sp.situacao);
  const situacao = (Object.prototype.hasOwnProperty.call(FILTROS_SITUACAO, sit) ? sit : "") as FiltroSituacao | "";
  const where = whereEstoque(empresaId, { busca, inativos });
  const { pagina: pedida, porPagina } = lerPaginacao(sp);
  const orderBy = ordemPrisma(lerOrdem(sp, ORDEM_ESTOQUE), ORDEM_ESTOQUE, ORDEM_PADRAO_ESTOQUE) as Prisma.ProdutoOrderByWithRelationInput[];

  let total: number, pagina: number, itens: LinhaEstoque[];
  if (situacao) {
    // O banco não compara saldo (decimal) com o mínimo (inteiro): filtra aqui e pagina os ids.
    const candidatos = await prisma.produto.findMany({ where, select: { id: true, saldo: true, estoqueMinimo: true }, orderBy });
    const ids = candidatos.filter((p) => {
      const s = situacaoEstoque(Number(p.saldo), p.estoqueMinimo);
      return situacao === "negativo" ? s === "negativo" : s !== "ok";
    }).map((p) => p.id);
    total = ids.length;
    pagina = paginaValida(pedida, porPagina, total);
    const { skip, take } = janela(pagina, porPagina);
    const daPagina = ids.slice(skip, skip + take);
    itens = daPagina.length ? (await prisma.produto.findMany({ where: { id: { in: daPagina }, empresaId }, select: SELECT_LINHA, orderBy })).map(linha) : [];
  } else {
    total = await prisma.produto.count({ where });
    pagina = paginaValida(pedida, porPagina, total);
    itens = total ? (await prisma.produto.findMany({ where, select: SELECT_LINHA, orderBy, ...janela(pagina, porPagina) })).map(linha) : [];
  }
  return { itens, total, pagina, porPagina, busca, situacao, inativos: inativos === "1" };
}

/** Produtos ativos (que controlam estoque) abaixo do mínimo (inclui os negativos) e com saldo negativo — para o aviso no topo. */
export async function contarAlertas(empresaId: string) {
  const ps = await prisma.produto.findMany({
    where: { empresaId, ativo: true, controlaEstoque: true, OR: [{ estoqueMinimo: { not: null } }, { saldo: { lt: 0 } }] },
    select: { saldo: true, estoqueMinimo: true },
  });
  let abaixo = 0, negativo = 0;
  for (const p of ps) {
    const s = situacaoEstoque(Number(p.saldo), p.estoqueMinimo);
    if (s !== "ok") abaixo++;
    if (s === "negativo") negativo++;
  }
  return { abaixo, negativo };
}

/* ───────── Extrato ───────── */
export interface LinhaExtrato {
  id: string; data: Date; tipo: TipoMov; origem: OrigemMov; quantidade: number; saldoApos: number;
  custoUnitario: number | null; observacao: string | null; refId: string | null; usuario: string | null;
}

const TIPOS: readonly TipoMov[] = ["ENTRADA", "SAIDA", "AJUSTE", "DEVOLUCAO", "RESERVA"];
const ORIGENS: readonly OrigemMov[] = ["COMPRA", "OS", "AJUSTE", "INVENTARIO"];

/** O período do extrato (padrão da casa) sobre a DATA da movimentação; padrão: todo o período. */
export function periodoExtrato(sp: ParamsUrl, agora = new Date()): Periodo {
  return lerPeriodo(sp, agora, { permitirTodos: true, padrao: "todos" });
}
const condPeriodoData = (p: Periodo): Prisma.MovimentacaoEstoqueWhereInput =>
  !p.gte && !p.lt ? {} : { data: { ...(p.gte && { gte: p.gte }), ...(p.lt && { lt: p.lt }) } };

/** null = produto não existe NA EMPRESA (a rota responde 404, sem dizer se existe em outra). */
export async function extratoProduto(empresaId: string, produtoId: string, sp: ParamsUrl, agora = new Date()) {
  const produto = await prisma.produto.findFirst({ where: { id: produtoId, empresaId }, select: SELECT_LINHA });
  if (!produto) return null;
  const periodo = periodoExtrato(sp, agora);
  const tipo = TIPOS.includes(um(sp.tipo) as TipoMov) ? (um(sp.tipo) as TipoMov) : "";
  const origem = ORIGENS.includes(um(sp.origem) as OrigemMov) ? (um(sp.origem) as OrigemMov) : "";
  const busca = um(sp.busca).trim().slice(0, 100);
  const where: Prisma.MovimentacaoEstoqueWhereInput = {
    empresaId, produtoId, ...condPeriodoData(periodo), ...(tipo && { tipo }), ...(origem && { origem }),
    ...(busca && { observacao: { contains: busca, mode: "insensitive" } }),
  };
  const total = await prisma.movimentacaoEstoque.count({ where });
  const { pagina: pedida, porPagina } = lerPaginacao(sp);
  const pagina = paginaValida(pedida, porPagina, total);
  const movs = total ? await prisma.movimentacaoEstoque.findMany({
    where, orderBy: [{ data: "desc" }, { criadoEm: "desc" }, { id: "desc" }], ...janela(pagina, porPagina),
    select: { id: true, data: true, tipo: true, origem: true, quantidade: true, saldoApos: true, custoUnitario: true, observacao: true, refId: true, usuario: { select: { nome: true } } },
  }) : [];
  // A conferência é sobre o razão INTEIRO (não só o período da tela)
  const soma = await prisma.movimentacaoEstoque.aggregate({ where: { empresaId, produtoId }, _sum: { quantidade: true } });
  const p = linha(produto);
  return {
    produto: p, periodo, tipo, origem, busca,
    movimentacoes: movs.map((m): LinhaExtrato => ({
      id: m.id, data: m.data, tipo: m.tipo, origem: m.origem, quantidade: arred(Number(m.quantidade)), saldoApos: arred(Number(m.saldoApos)),
      custoUnitario: m.custoUnitario == null ? null : Number(m.custoUnitario), observacao: m.observacao, refId: m.refId, usuario: m.usuario?.nome ?? null,
    })),
    total, pagina, porPagina,
    /** Conferência: soma do razão (deve ser igual ao saldo do produto) */
    somaRazao: arred(Number(soma._sum.quantidade ?? 0)),
  };
}

/* ───────── Recálculo pelo histórico (conferência/correção do cache) ───────── */
export interface Recalculo { produtoId: string; nome: string; saldoCache: number; somaRazao: number; divergia: boolean }

/**
 * Recalcula o saldo do produto a partir do razão e corrige o cache se divergir — com a linha do
 * produto trancada (um lançamento simultâneo entra na fila e já parte do saldo certo). Não grava
 * movimentação: o razão É a verdade; só o cache é acertado. null = produto não é da empresa.
 */
export async function recalcularSaldo(empresaId: string, produtoId: string): Promise<Recalculo | null> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.produto.update({
      where: { id: produtoId, empresaId }, data: { saldo: { increment: 0 } }, select: { id: true, nome: true, saldo: true },
    }).catch((e: { code?: string }) => { if (e?.code === "P2025") return null; throw e; });
    if (!p) return null;
    const soma = await tx.movimentacaoEstoque.aggregate({ where: { empresaId, produtoId }, _sum: { quantidade: true } });
    const somaRazao = arred(Number(soma._sum.quantidade ?? 0));
    const saldoCache = arred(Number(p.saldo));
    const divergia = saldoCache !== somaRazao;
    if (divergia) await tx.produto.update({ where: { id: produtoId }, data: { saldo: somaRazao } });
    return { produtoId, nome: p.nome, saldoCache, somaRazao, divergia };
  });
}

/** Conferência da empresa inteira: os produtos cujo cache não bate com a soma do razão (só leitura). */
export async function conferirSaldos(empresaId: string): Promise<Recalculo[]> {
  const [produtos, somas] = await Promise.all([
    prisma.produto.findMany({ where: { empresaId }, select: { id: true, nome: true, saldo: true } }),
    prisma.movimentacaoEstoque.groupBy({ by: ["produtoId"], where: { empresaId }, _sum: { quantidade: true } }),
  ]);
  const soma = new Map(somas.map((s) => [s.produtoId, arred(Number(s._sum.quantidade ?? 0))]));
  return produtos
    .map((p) => ({ produtoId: p.id, nome: p.nome, saldoCache: arred(Number(p.saldo)), somaRazao: soma.get(p.id) ?? 0, divergia: false }))
    .map((r) => ({ ...r, divergia: r.saldoCache !== r.somaRazao }))
    .filter((r) => r.divergia);
}
