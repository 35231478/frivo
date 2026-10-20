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
import { validarRefEmpresa } from "@/lib/ref-empresa";
import { janela, lerOrdem, lerPaginacao, ordemPrisma, paginaValida, um, type MapaOrdem, type ParamsUrl } from "@/lib/listagem";
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

export async function movimentar(m: Movimentar): Promise<Movimentado> {
  const defineSaldo = m.operacao === "AJUSTE" || m.operacao === "INVENTARIO";
  // Quantidade > 0 (o sinal vem da operação); saldo final ≥ 0. Também barra NaN/Infinity.
  if (!Number.isFinite(m.valor) || (defineSaldo ? m.valor < 0 : !(arred(m.valor) > 0)))
    throw new ErroEstoque(defineSaldo ? "O saldo informado não pode ser negativo." : "A quantidade precisa ser maior que zero.");
  await validarRefEmpresa("produto", m.produtoId, m.empresaId, "Produto");
  return prisma.$transaction(async (tx) => {
    // "saldo + 0" trava a linha do produto até o fim da transação e devolve o saldo atual:
    // dois lançamentos simultâneos do mesmo produto entram em fila (nenhum se perde).
    const atual = await tx.produto.update({
      where: { id: m.produtoId, empresaId: m.empresaId },
      data: { saldo: { increment: 0 } },
      select: { saldo: true, unidade: true },
    });
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
  });
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
  id: string; nome: string; descricao: string | null; unidade: string; ativo: boolean;
  saldo: number; estoqueMinimo: number | null; situacao: Situacao;
}

export function whereEstoque(empresaId: string, f: { busca?: string; inativos?: string }): Prisma.ProdutoWhereInput {
  const q = (f.busca ?? "").trim().slice(0, 100);
  return {
    empresaId,
    ...(f.inativos === "1" ? {} : { ativo: true }),
    ...(q && { OR: [{ nome: { contains: q, mode: "insensitive" } }, { descricao: { contains: q, mode: "insensitive" } }] }),
  };
}

const linha = (p: { id: string; nome: string; descricao: string | null; unidade: string; ativo: boolean; saldo: unknown; estoqueMinimo: number | null }): LinhaEstoque => {
  const saldo = arred(Number(p.saldo));
  return { id: p.id, nome: p.nome, descricao: p.descricao, unidade: p.unidade, ativo: p.ativo, saldo, estoqueMinimo: p.estoqueMinimo, situacao: situacaoEstoque(saldo, p.estoqueMinimo) };
};
const SELECT_LINHA = { id: true, nome: true, descricao: true, unidade: true, ativo: true, saldo: true, estoqueMinimo: true } as const;

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

/** Produtos ativos abaixo do mínimo (inclui os negativos) e com saldo negativo — para o aviso no topo. */
export async function contarAlertas(empresaId: string) {
  const ps = await prisma.produto.findMany({
    where: { empresaId, ativo: true, OR: [{ estoqueMinimo: { not: null } }, { saldo: { lt: 0 } }] },
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

/** null = produto não existe NA EMPRESA (a rota responde 404, sem dizer se existe em outra). */
export async function extratoProduto(empresaId: string, produtoId: string, sp: ParamsUrl) {
  const produto = await prisma.produto.findFirst({ where: { id: produtoId, empresaId }, select: SELECT_LINHA });
  if (!produto) return null;
  const where: Prisma.MovimentacaoEstoqueWhereInput = { empresaId, produtoId };
  const total = await prisma.movimentacaoEstoque.count({ where });
  const { pagina: pedida, porPagina } = lerPaginacao(sp);
  const pagina = paginaValida(pedida, porPagina, total);
  const movs = total ? await prisma.movimentacaoEstoque.findMany({
    where, orderBy: [{ data: "desc" }, { criadoEm: "desc" }, { id: "desc" }], ...janela(pagina, porPagina),
    select: { id: true, data: true, tipo: true, origem: true, quantidade: true, saldoApos: true, custoUnitario: true, observacao: true, refId: true, usuario: { select: { nome: true } } },
  }) : [];
  const soma = await prisma.movimentacaoEstoque.aggregate({ where, _sum: { quantidade: true } });
  const p = linha(produto);
  return {
    produto: p,
    movimentacoes: movs.map((m): LinhaExtrato => ({
      id: m.id, data: m.data, tipo: m.tipo, origem: m.origem, quantidade: arred(Number(m.quantidade)), saldoApos: arred(Number(m.saldoApos)),
      custoUnitario: m.custoUnitario == null ? null : Number(m.custoUnitario), observacao: m.observacao, refId: m.refId, usuario: m.usuario?.nome ?? null,
    })),
    total, pagina, porPagina,
    /** Conferência: soma do razão (deve ser igual ao saldo do produto) */
    somaRazao: arred(Number(soma._sum.quantidade ?? 0)),
  };
}
