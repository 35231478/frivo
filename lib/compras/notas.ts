/**
 * Nota de compra (NF-e por XML) → fornecedor + produtos + estoque + contas a pagar.
 *
 *   importarNota   lê o XML, barra nota repetida (chave de acesso) e nota de outro CNPJ, cria/vincula o
 *                  fornecedor pelo CNPJ e pré-vincula os itens que o de-para já conhece;
 *   conciliar      liga cada item a um produto existente ou cria o produto novo;
 *   lancarNota     numa ÚNICA transação: entrada de cada item no estoque (função da E1, origem COMPRA,
 *                  refId = nota, custo = valor unitário da NF), grava o de-para aprendido, gera a(s)
 *                  conta(s) a pagar (uma por duplicata), leva o custo real ao pedido de compra (se
 *                  informado) e marca a nota como LANCADA. Ou tudo, ou nada; lançar 2x é recusado.
 *
 * Empresa SEMPRE a da sessão (quem chama passa); nota/produto/pedido de outra empresa = recusado.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatarCpfCnpj, gerarNumeroContaPagar } from "@/lib/utils";
import { arred } from "@/lib/estoque/regras";
import { movimentar } from "@/lib/estoque/servidor";
import { chaveDePara, ErroNfe, lerNfe, mesmaRaizCnpj, parcelasDaNota, type DuplicataNfe } from "@/lib/compras/nfe";

/** Recusa com status HTTP e dados extras (ex.: a nota que já existe). */
export class ErroNota extends Error {
  constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); }
}

export const LABEL_STATUS_NOTA = { IMPORTADA: "Importada", CONCILIADA: "Conciliada", LANCADA: "Lançada" } as const;
const so = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/* ───────── Importar ───────── */
export async function importarNota({ empresaId, usuarioId, xml }: { empresaId: string; usuarioId: string | null; xml: string }) {
  let nfe;
  try { nfe = lerNfe(xml); } catch (e) { if (e instanceof ErroNfe) throw new ErroNota(e.message); throw e; }

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { cnpj: true } });
  if (!empresa) throw new ErroNota("Empresa não encontrada.", 404);
  if (!mesmaRaizCnpj(nfe.destinatario.documento, empresa.cnpj))
    throw new ErroNota(`Esta NF foi emitida para ${nfe.destinatario.documento ? `o CNPJ/CPF ${formatarCpfCnpj(nfe.destinatario.documento)}` : "outro destinatário"}${nfe.destinatario.nome ? ` (${nfe.destinatario.nome})` : ""}, não para a sua empresa.`);

  const repetida = await prisma.notaCompra.findFirst({
    where: { empresaId, chaveAcesso: nfe.chave },
    select: { id: true, numero: true, status: true, criadoEm: true, emitenteNome: true },
  });
  if (repetida) throw notaRepetida(repetida);

  // Fornecedor pelo CNPJ (gravado só com dígitos; cadastros antigos podem estar com máscara)
  const docs = [...new Set([nfe.emitente.cnpj, formatarCpfCnpj(nfe.emitente.cnpj)])];
  const fornecedor = await prisma.fornecedor.findFirst({ where: { empresaId, documento: { in: docs } }, select: { id: true, nome: true } })
    ?? await prisma.fornecedor.create({
      data: { empresaId, nome: nfe.emitente.nome || nfe.emitente.fantasia || formatarCpfCnpj(nfe.emitente.cnpj), documento: nfe.emitente.cnpj, telefone: nfe.emitente.telefone, email: nfe.emitente.email },
      select: { id: true, nome: true },
    });

  // Aprendizado: código do item neste fornecedor → produto (só produto ativo da empresa)
  const deParas = await prisma.deParaProdutoFornecedor.findMany({
    where: { empresaId, fornecedorId: fornecedor.id, codigoFornecedor: { in: nfe.itens.map((i) => chaveDePara(i.codigo)) }, produto: { ativo: true } },
    select: { codigoFornecedor: true, produtoId: true },
  });
  const conhecido = new Map(deParas.map((d) => [d.codigoFornecedor, d.produtoId]));
  const itens = nfe.itens.map((i) => ({
    numeroItem: i.numeroItem, codigoFornecedor: i.codigo, descricaoFornecedor: i.descricao, ncm: i.ncm, cfop: i.cfop,
    unidade: i.unidade, quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorTotal: i.valorTotal,
    produtoId: conhecido.get(chaveDePara(i.codigo)) ?? null,
  }));

  const avisos: string[] = [];
  const somaDup = arred(nfe.duplicatas.reduce((t, d) => t + d.valor, 0));
  if (nfe.duplicatas.length && Math.abs(somaDup - nfe.totais.nota) > 0.01)
    avisos.push(`As duplicatas somam ${somaDup.toFixed(2)} e a nota ${nfe.totais.nota.toFixed(2)}: as contas a pagar seguem as duplicatas.`);
  if (!nfe.status) avisos.push("XML sem protocolo de autorização da SEFAZ (veio só a NF-e).");

  try {
    const nota = await prisma.notaCompra.create({
      data: {
        empresaId, fornecedorId: fornecedor.id, chaveAcesso: nfe.chave, numero: nfe.numero, serie: nfe.serie,
        dataEmissao: nfe.dataEmissao, valorTotal: nfe.totais.nota, xml, emitenteNome: nfe.emitente.nome, emitenteCnpj: nfe.emitente.cnpj,
        duplicatas: nfe.duplicatas as unknown as Prisma.InputJsonValue, usuarioId,
        status: itens.every((i) => i.produtoId) ? "CONCILIADA" : "IMPORTADA",
        itens: { create: itens },
      },
      select: { id: true, status: true },
    });
    return { nota, fornecedor, preVinculados: itens.filter((i) => i.produtoId).length, totalItens: itens.length, avisos };
  } catch (e) {
    // Duas importações simultâneas da mesma nota: a segunda bate na chave única
    if ((e as { code?: string })?.code === "P2002") {
      const r = await prisma.notaCompra.findFirst({ where: { empresaId, chaveAcesso: nfe.chave }, select: { id: true, numero: true, status: true, criadoEm: true, emitenteNome: true } });
      if (r) throw notaRepetida(r);
    }
    throw e;
  }
}

function notaRepetida(n: { id: string; numero: string; status: keyof typeof LABEL_STATUS_NOTA; criadoEm: Date; emitenteNome: string }) {
  return new ErroNota(
    `Esta NF já foi importada em ${dataBr(n.criadoEm)} (NF ${n.numero} · ${n.emitenteNome} · ${LABEL_STATUS_NOTA[n.status]}). Nada foi lançado de novo.`,
    409, { notaId: n.id },
  );
}

/* ───────── Consultar ───────── */
export async function carregarNota(empresaId: string, id: string) {
  return prisma.notaCompra.findFirst({
    where: { id, empresaId },
    include: {
      fornecedor: { select: { id: true, nome: true, documento: true } },
      itens: { orderBy: { numeroItem: "asc" }, include: { produto: { select: { id: true, nome: true, unidade: true, saldo: true, ativo: true } } } },
      contasPagar: { orderBy: { dataVencimento: "asc" }, select: { id: true, numero: true, valorTotal: true, dataVencimento: true, status: true, descricao: true } },
      pedidoCompra: { select: { id: true, numero: true } },
      usuario: { select: { nome: true } },
    },
  });
}

export async function listarNotas(empresaId: string, { pagina = 1, porPagina = 25 } = {}) {
  const where = { empresaId };
  const [total, notas] = await Promise.all([
    prisma.notaCompra.count({ where }),
    prisma.notaCompra.findMany({
      where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], skip: (pagina - 1) * porPagina, take: porPagina,
      select: { id: true, numero: true, serie: true, dataEmissao: true, valorTotal: true, status: true, emitenteNome: true, criadoEm: true, _count: { select: { itens: true } } },
    }),
  ]);
  return { total, notas };
}

/* ───────── Conciliar (de-para) ───────── */
export type Escolha = { itemId: string; produtoId: string } | { itemId: string; novo: { nome: string; unidade?: string | null } };

/** Aplica as escolhas na transação; devolve quantos itens ainda estão sem produto. Valida TUDO antes de gravar. */
async function aplicarEscolhas(tx: Prisma.TransactionClient, empresaId: string, notaId: string, escolhas: Escolha[]) {
  const itens = await tx.notaCompraItem.findMany({ where: { notaId }, select: { id: true, unidade: true, produtoId: true } });
  const doItem = new Map(itens.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  for (const e of escolhas) {
    if (!doItem.has(e.itemId)) throw new ErroNota("Item não é desta nota.");
    if (vistos.has(e.itemId)) throw new ErroNota("Item escolhido duas vezes.");
    vistos.add(e.itemId);
    if ("novo" in e && e.novo.nome.trim().length < 2) throw new ErroNota("Dê um nome ao produto novo.");
  }
  const existentes = [...new Set(escolhas.flatMap((e) => ("produtoId" in e ? [e.produtoId] : [])))];
  if (existentes.length && (await tx.produto.count({ where: { id: { in: existentes }, empresaId } })) !== existentes.length)
    throw new ErroNota("Produto inválido(a).");

  for (const e of escolhas) {
    const item = doItem.get(e.itemId)!;
    // Produto novo: unidade da nota (conversão de unidade fica para depois)
    const produtoId = "produtoId" in e ? e.produtoId
      : (await tx.produto.create({ data: { empresaId, nome: e.novo.nome.trim().slice(0, 200), unidade: (e.novo.unidade || item.unidade).trim().slice(0, 10) || "un" }, select: { id: true } })).id;
    await tx.notaCompraItem.update({ where: { id: item.id }, data: { produtoId } });
    item.produtoId = produtoId;
  }
  return itens.filter((i) => !i.produtoId).length;
}

export async function conciliar({ empresaId, notaId, escolhas }: { empresaId: string; notaId: string; escolhas: Escolha[] }) {
  return prisma.$transaction(async (tx) => {
    const nota = await tx.notaCompra.findFirst({ where: { id: notaId, empresaId }, select: { id: true, status: true } });
    if (!nota) throw new ErroNota("Nota não encontrada.", 404);
    if (nota.status === "LANCADA") throw new ErroNota("Nota já lançada: os vínculos não mudam mais.", 409);
    const faltam = await aplicarEscolhas(tx, empresaId, notaId, escolhas);
    const status = faltam ? "IMPORTADA" : "CONCILIADA";
    await tx.notaCompra.update({ where: { id: notaId }, data: { status } });
    return { status, faltam };
  });
}

/* ───────── Lançar ───────── */
export async function lancarNota({ empresaId, usuarioId, notaId, escolhas = [], pedidoCompraId = null }: {
  empresaId: string; usuarioId: string | null; notaId: string; escolhas?: Escolha[]; pedidoCompraId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    // Reserva a nota: só UMA confirmação passa daqui (a outra, simultânea, encontra LANCADA)
    const reservada = await tx.notaCompra.updateMany({
      where: { id: notaId, empresaId, status: { not: "LANCADA" } },
      data: { status: "LANCADA", lancadaEm: new Date() },
    });
    if (!reservada.count) {
      const existe = await tx.notaCompra.findFirst({ where: { id: notaId, empresaId }, select: { id: true } });
      throw existe ? new ErroNota("Esta nota já foi lançada: o estoque e as contas não são lançados de novo.", 409) : new ErroNota("Nota não encontrada.", 404);
    }
    if (escolhas.length) await aplicarEscolhas(tx, empresaId, notaId, escolhas);

    const nota = await tx.notaCompra.findFirstOrThrow({
      where: { id: notaId, empresaId },
      include: { itens: { orderBy: { numeroItem: "asc" }, include: { produto: { select: { nome: true, unidade: true } } } }, fornecedor: { select: { id: true, nome: true, documento: true } } },
    });
    const semProduto = nota.itens.filter((i) => !i.produtoId);
    if (semProduto.length) throw new ErroNota(`Falta escolher o produto de ${semProduto.length} item(ns): ${semProduto.map((i) => i.descricaoFornecedor).join("; ")}.`);

    // Pedido de compra (opcional): da empresa e ainda sem conta a pagar (senão duplicaria a dívida)
    if (pedidoCompraId) {
      const pedido = await tx.pedidoCompraInterno.findFirst({ where: { id: pedidoCompraId, empresaId }, select: { id: true, numero: true, contasPagar: { select: { numero: true }, take: 1 } } });
      if (!pedido) throw new ErroNota("Pedido de compra inválido.");
      if (pedido.contasPagar.length) throw new ErroNota(`O pedido ${pedido.numero} já tem a conta a pagar ${pedido.contasPagar[0].numero}: lance a nota sem vincular o pedido, ou cancele aquela conta antes.`, 409);
    }

    // 1) Entrada no estoque — a função da E1, dentro desta transação
    const entradas = [];
    const avisos: string[] = [];
    for (const it of nota.itens) {
      const r = await movimentar({
        empresaId, produtoId: it.produtoId!, operacao: "ENTRADA", valor: Number(it.quantidade), usuarioId,
        custoUnitario: Number(it.valorUnitario), origem: "COMPRA", refId: nota.id,
        observacao: `NF ${nota.numero}/${nota.serie} · ${nota.fornecedor.nome} · item ${it.numeroItem}`,
      }, tx);
      entradas.push({ itemId: it.id, produto: it.produto!.nome, quantidade: arred(Number(it.quantidade)), custoUnitario: Number(it.valorUnitario), saldo: r.saldo });
      if (it.produto!.unidade.trim().toLowerCase() !== it.unidade.trim().toLowerCase())
        avisos.push(`${it.produto!.nome}: a nota vem em "${it.unidade}" e o produto é em "${it.produto!.unidade}" — entrou ${arred(Number(it.quantidade))} como está na nota (sem conversão).`);
    }

    // 2) De-para aprendido (código do item neste fornecedor → produto)
    for (const it of nota.itens) {
      const codigo = chaveDePara(it.codigoFornecedor);
      await tx.deParaProdutoFornecedor.upsert({
        where: { empresaId_fornecedorId_codigoFornecedor: { empresaId, fornecedorId: nota.fornecedorId, codigoFornecedor: codigo } },
        create: { empresaId, fornecedorId: nota.fornecedorId, codigoFornecedor: codigo, descricaoFornecedor: it.descricaoFornecedor, produtoId: it.produtoId! },
        update: { produtoId: it.produtoId!, descricaoFornecedor: it.descricaoFornecedor },
      });
    }

    // 3) Contas a pagar: uma por duplicata (sem duplicata: uma, à vista, no valor da nota)
    const parcelas = parcelasDaNota({ duplicatas: nota.duplicatas as unknown as DuplicataNfe[], valorTotal: Number(nota.valorTotal), dataEmissao: nota.dataEmissao });
    const ano = new Date().getFullYear();
    const ultimo = await tx.contaPagar.findFirst({ where: { empresaId, numero: { startsWith: `CP-${ano}-` } }, orderBy: { numero: "desc" }, select: { numero: true } });
    let seq = ultimo ? Number(ultimo.numero.split("-")[2]) : 0;
    const contas = [];
    for (const [i, p] of parcelas.entries()) {
      const valor = arred(p.valor);
      contas.push(await tx.contaPagar.create({
        data: {
          empresaId, numero: gerarNumeroContaPagar(++seq, ano),
          fornecedorId: nota.fornecedorId, fornecedor: nota.fornecedor.nome, fornecedorCnpj: nota.fornecedor.documento ?? nota.emitenteCnpj,
          descricao: `NF ${nota.numero}/${nota.serie}${parcelas.length > 1 ? ` — parcela ${i + 1}/${parcelas.length}` : ""}`,
          valorTotal: valor, valorPago: 0, saldoRestante: valor, status: "PENDENTE", dataVencimento: p.vencimento,
          notaCompraId: nota.id, pedidoCompraId: pedidoCompraId ?? null, observacao: `Duplicata ${p.numero} da NF-e ${nota.chaveAcesso}`,
        },
        select: { id: true, numero: true, valorTotal: true, dataVencimento: true },
      }));
    }

    // 4) Pedido de compra: o custo real da NF vai para os itens do pedido com o mesmo produto
    let itensPedido = 0;
    if (pedidoCompraId) {
      const custo = new Map<string, { qtd: number; total: number }>();
      for (const it of nota.itens) {
        const c = custo.get(it.produtoId!) ?? { qtd: 0, total: 0 };
        custo.set(it.produtoId!, { qtd: c.qtd + Number(it.quantidade), total: c.total + Number(it.quantidade) * Number(it.valorUnitario) });
      }
      for (const pi of await tx.pedidoCompraItem.findMany({ where: { pedidoId: pedidoCompraId, produtoId: { in: [...custo.keys()] } }, select: { id: true, produtoId: true } })) {
        const c = custo.get(pi.produtoId!)!;
        await tx.pedidoCompraItem.update({ where: { id: pi.id }, data: { valorReal: Math.round((c.total / c.qtd) * 100) / 100 } });
        itensPedido++;
      }
    }

    // (quem lançou fica em cada movimentação; usuarioId da nota continua sendo quem importou)
    await tx.notaCompra.update({ where: { id: notaId }, data: { pedidoCompraId: pedidoCompraId ?? null } });
    return {
      notaId,
      entradas,
      contas: contas.map((c) => ({ id: c.id, numero: c.numero, valor: Number(c.valorTotal), vencimento: c.dataVencimento })),
      itensPedido,
      avisos,
    };
  }, { timeout: 30_000 });
}
