/**
 * Nota de compra (NF-e por XML) → fornecedor + produtos + estoque + contas a pagar.
 *
 *   importarNota   lê o XML, barra nota repetida (chave de acesso) e nota de outro CNPJ, cria/vincula o
 *                  fornecedor pelo CNPJ e pré-vincula os itens que o de-para já conhece — com o fator
 *                  de conversão aprendido, se a unidade da nota for a mesma de antes;
 *   conciliar      liga cada item a um produto existente ou cria o produto novo (com os dados fiscais
 *                  do XML) e guarda o fator "1 [unidade da nota] = fator [unidade do produto]";
 *   lancarNota     numa ÚNICA transação: entrada de cada item no estoque (função da E1, origem COMPRA,
 *                  refId = nota) já convertida — quantidade × fator, custo = valor unitário ÷ fator —,
 *                  grava o de-para aprendido (com unidade e fator), completa os dados fiscais vazios do
 *                  produto, gera a(s) conta(s) a pagar (uma por parcela do rascunho; padrão = as duplicatas)
 *                  com categoria, centro de custo, forma de pagamento e boleto, aprende a categoria e o
 *                  centro de custo do fornecedor, aplica o preço de venda definido na linha (se houver),
 *                  leva o custo real ao pedido de compra (se informado) e marca a nota como LANCADA. Ou
 *                  tudo, ou nada; lançar 2x é recusado. Custo diferente da compra anterior: só AVISA (o
 *                  preço só muda se a pessoa definir na linha).
 *
 * Central de lançamento (E2.1): até "Confirmar e lançar" a nota é um RASCUNHO editável — vínculos,
 * conversão, preço de venda na linha, categoria, centro de custo, forma de pagamento (do pag/tPag do
 * XML) e parcelas (das duplicatas, editáveis, com o boleto de cada uma). "Salvar rascunho" grava; nada
 * vai para o estoque nem para o financeiro antes de lançar.
 *
 * Empresa SEMPRE a da sessão (quem chama passa); nota/produto/pedido de outra empresa = recusado.
 */
import { criarProdutoComCodigo } from "@/lib/cadastros/codigos-server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatarCpfCnpj, formatarData, gerarNumeroContaPagar } from "@/lib/utils";
import { arred } from "@/lib/estoque/regras";
import { movimentar } from "@/lib/estoque/servidor";
import { ultimosCustos } from "@/lib/estoque/custo";
import { arred2, avisoCusto, converterItem, mesmaUnidade, precoPorMargem, type AvisoCusto } from "@/lib/estoque/preco";
import { LABEL_STATUS_NOTA } from "@/lib/compras/rotulos";
import { chaveDePara, ErroNfe, formaDaNota, lerNfe, mesmaRaizCnpj, type DuplicataNfe } from "@/lib/compras/nfe";
import { parcelasDaNf, type ParcelaRascunho } from "@/lib/compras/parcelas";
import { mensagemZod, parcelaSchema, type FinanceiroRascunho, type PrecoLinha } from "@/lib/compras/validacao";
import { lerBoleto } from "@/lib/financeiro/boleto";
import { validarRefEmpresa } from "@/lib/ref-empresa";
import { sugestoesDaNota, vincularNota } from "@/lib/compras/conciliacao-server";
import { anoBR } from "@/lib/fuso";

/** Recusa com status HTTP e dados extras (ex.: a nota que já existe). */
export { LABEL_STATUS_NOTA };

export class ErroNota extends Error {
  constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); }
}

const so = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const dataBr = (d: Date) => formatarData(d); // dia de Brasília

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
  const padroes = { categoriaPadrao: { select: { id: true, ativo: true } }, centroCustoPadrao: { select: { id: true, ativo: true } } } as const;
  const fornecedor = await prisma.fornecedor.findFirst({ where: { empresaId, documento: { in: docs } }, select: { id: true, nome: true, ...padroes } })
    ?? await prisma.fornecedor.create({
      data: { empresaId, nome: nfe.emitente.nome || nfe.emitente.fantasia || formatarCpfCnpj(nfe.emitente.cnpj), documento: nfe.emitente.cnpj, telefone: nfe.emitente.telefone, email: nfe.emitente.email },
      select: { id: true, nome: true, ...padroes },
    });

  // Aprendizado: código do item neste fornecedor → produto (só produto ativo da empresa)
  const deParas = await prisma.deParaProdutoFornecedor.findMany({
    where: { empresaId, fornecedorId: fornecedor.id, codigoFornecedor: { in: nfe.itens.map((i) => chaveDePara(i.codigo)) }, produto: { ativo: true } },
    select: { codigoFornecedor: true, produtoId: true, unidadeOrigem: true, fatorConversao: true },
  });
  const conhecido = new Map(deParas.map((d) => [d.codigoFornecedor, d]));
  const itens = nfe.itens.map((i) => {
    const dp = conhecido.get(chaveDePara(i.codigo));
    // O fator aprendido só vale se o fornecedor manda na mesma unidade de antes (UN → 13,6 kg não serve para CX)
    const fator = dp && (dp.unidadeOrigem == null || mesmaUnidade(dp.unidadeOrigem, i.unidade)) ? Number(dp.fatorConversao) : 1;
    return {
      numeroItem: i.numeroItem, codigoFornecedor: i.codigo, descricaoFornecedor: i.descricao, ncm: i.ncm, cfop: i.cfop,
      cest: i.cest, gtin: i.ean, origem: i.origem, unidadeTributavel: i.unidadeTributavel,
      unidade: i.unidade, quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorTotal: i.valorTotal,
      produtoId: dp?.produtoId ?? null, fatorConversao: fator,
    };
  });

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
        // Rascunho financeiro: o que este fornecedor usou da última vez (se ainda ativo) e a forma do XML
        categoriaId: fornecedor.categoriaPadrao?.ativo ? fornecedor.categoriaPadrao.id : null,
        centroCustoId: fornecedor.centroCustoPadrao?.ativo ? fornecedor.centroCustoPadrao.id : null,
        formaPagamento: formaDaNota(nfe.pagamentos),
        itens: { create: itens },
      },
      select: { id: true, status: true, categoriaId: true, centroCustoId: true, formaPagamento: true },
    });
    return { nota, fornecedor: { id: fornecedor.id, nome: fornecedor.nome }, preVinculados: itens.filter((i) => i.produtoId).length, totalItens: itens.length, avisos };
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
      fornecedor: { select: { id: true, nome: true, documento: true, categoriaPadraoId: true, centroCustoPadraoId: true } },
      categoria: { select: { id: true, nome: true, cor: true, ativo: true } },
      centroCusto: { select: { id: true, nome: true, ativo: true } },
      itens: {
        orderBy: { numeroItem: "asc" },
        include: {
          produto: {
            select: {
              id: true, nome: true, unidade: true, saldo: true, ativo: true, valorPadrao: true, margemVenda: true,
              ncm: true, cest: true, gtin: true, origemMercadoria: true, unidadeTributavel: true,
            },
          },
        },
      },
      contasPagar: {
        orderBy: [{ dataVencimento: "asc" }, { numero: "asc" }],
        select: { id: true, numero: true, valorTotal: true, dataVencimento: true, status: true, descricao: true, linhaDigitavel: true },
      },
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
/**
 * `fator`: 1 [unidade da nota] = fator [unidade do produto] (sem fator = 1). `preco`: preço de venda
 * definido na linha (rascunho; vai para o produto só ao lançar) — ausente = não mexe; null = tira.
 */
export type Escolha = ({ itemId: string; produtoId: string } | { itemId: string; novo: { nome: string; unidade?: string | null } }) & { fator?: number; preco?: PrecoLinha | null };

/** Quem salva/lança pode mexer em quê (a rota decide pela sessão). */
export interface Poderes {
  /** Configurações › gerenciar: definir o preço de venda na linha */
  podePrecificar?: boolean;
  /** Financeiro › fluxo de caixa: categoria, centro de custo, forma e parcelas */
  podeFinanceiro?: boolean;
}
const SEM_PRECO = "Definir o preço de venda precisa de Configurações › gerenciar (o mesmo do cadastro de produtos).";
const SEM_FINANCEIRO = "Categoria, centro de custo, forma de pagamento e parcelas geram a conta a pagar: precisa de Financeiro › fluxo de caixa.";

/** Preço da linha → o que fica no item (por margem, o preço sai do custo DESTA nota, já convertido). */
function precoDoItem(preco: PrecoLinha | null, item: { quantidade: Prisma.Decimal | number; valorUnitario: Prisma.Decimal | number; descricaoFornecedor: string }, fator: number) {
  if (!preco) return { precoVenda: null, margemVenda: null };
  if (preco.modo === "preco") return { precoVenda: arred2(preco.preco), margemVenda: null };
  const custo = converterItem(Number(item.quantidade), Number(item.valorUnitario), fator).custoUnitario;
  const valor = precoPorMargem(custo, preco.margem);
  if (valor == null) throw new ErroNota(`${item.descricaoFornecedor}: sem custo nesta nota não dá para calcular pela margem — defina um preço fixo.`);
  return { precoVenda: valor, margemVenda: arred2(preco.margem) };
}

/** Dados fiscais do item da nota no formato do produto */
const fiscalDoItem = (i: { ncm: string | null; cest: string | null; gtin: string | null; origem: string | null; unidadeTributavel: string | null }) =>
  ({ ncm: i.ncm, cest: i.cest, gtin: i.gtin, origemMercadoria: i.origem, unidadeTributavel: i.unidadeTributavel });
const CAMPOS_FISCAIS = [["ncm", "NCM"], ["cest", "CEST"], ["gtin", "GTIN/EAN"], ["origemMercadoria", "origem da mercadoria"], ["unidadeTributavel", "unidade tributável"]] as const;

/** Aplica as escolhas na transação; devolve quantos itens ainda estão sem produto. Valida TUDO antes de gravar. */
async function aplicarEscolhas(tx: Prisma.TransactionClient, empresaId: string, notaId: string, escolhas: Escolha[], poderes: Poderes = {}) {
  if (!poderes.podePrecificar && escolhas.some((e) => e.preco !== undefined)) throw new ErroNota(SEM_PRECO, 403);
  const itens = await tx.notaCompraItem.findMany({
    where: { notaId },
    select: {
      id: true, unidade: true, produtoId: true, ncm: true, cest: true, gtin: true, origem: true, unidadeTributavel: true,
      quantidade: true, valorUnitario: true, descricaoFornecedor: true,
    },
  });
  const doItem = new Map(itens.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  for (const e of escolhas) {
    if (!doItem.has(e.itemId)) throw new ErroNota("Item não é desta nota.");
    if (vistos.has(e.itemId)) throw new ErroNota("Item escolhido duas vezes.");
    vistos.add(e.itemId);
    if ("novo" in e && e.novo.nome.trim().length < 2) throw new ErroNota("Dê um nome ao produto novo.");
    if (e.fator !== undefined && !(Number.isFinite(e.fator) && e.fator > 0)) throw new ErroNota("O fator de conversão precisa ser maior que zero.");
  }
  const existentes = [...new Set(escolhas.flatMap((e) => ("produtoId" in e ? [e.produtoId] : [])))];
  if (existentes.length && (await tx.produto.count({ where: { id: { in: existentes }, empresaId } })) !== existentes.length)
    throw new ErroNota("Produto inválido(a).");

  for (const e of escolhas) {
    const item = doItem.get(e.itemId)!;
    // Produto novo: unidade escolhida (ou a da nota) e os dados fiscais do XML
    const produtoId = "produtoId" in e ? e.produtoId
      : (await criarProdutoComCodigo(empresaId, (codigo, t) => t.produto.create({
        data: { empresaId, codigo, nome: e.novo.nome.trim().slice(0, 200), unidade: (e.novo.unidade || item.unidade).trim().slice(0, 10) || "un", ...fiscalDoItem(item) },
        select: { id: true },
      }), tx)).id;
    const fator = e.fator ?? 1;
    // Preço da linha: o que veio; sem preço no corpo e o produto mudou, o rascunho antigo (de outro produto) sai
    const preco = e.preco !== undefined ? precoDoItem(e.preco, item, fator)
      : produtoId !== item.produtoId ? { precoVenda: null, margemVenda: null } : {};
    await tx.notaCompraItem.update({ where: { id: item.id }, data: { produtoId, fatorConversao: fator, ...preco } });
    item.produtoId = produtoId;
  }
  return itens.filter((i) => !i.produtoId).length;
}

/**
 * Rascunho financeiro da nota: categoria e centro de custo da empresa (escolha NOVA precisa estar ativa;
 * manter o atual é aceito), forma de pagamento e parcelas (null = voltar às duplicatas da NF).
 */
async function salvarFinanceiro(tx: Prisma.TransactionClient, empresaId: string, nota: { id: string; categoriaId: string | null; centroCustoId: string | null }, f: FinanceiroRascunho, poderes: Poderes) {
  if (!poderes.podeFinanceiro) throw new ErroNota(SEM_FINANCEIRO, 403);
  if (f.categoriaId) await validarRefEmpresa("categoriaFinanceira", f.categoriaId, empresaId, "Categoria financeira", { novoAtivo: true, manter: [nota.categoriaId] });
  if (f.centroCustoId) await validarRefEmpresa("centroCusto", f.centroCustoId, empresaId, "Centro de custo", { novoAtivo: true, manter: [nota.centroCustoId] });
  const data: Prisma.NotaCompraUncheckedUpdateInput = {};
  if (f.categoriaId !== undefined) data.categoriaId = f.categoriaId;
  if (f.centroCustoId !== undefined) data.centroCustoId = f.centroCustoId;
  if (f.formaPagamento !== undefined) data.formaPagamento = f.formaPagamento;
  if (f.parcelas !== undefined) {
    // conferidas aqui também (quem chama a função direto não passa pela rota): boleto vira a linha digitável
    const ps = f.parcelas === null ? null : z.object({ parcelas: z.array(parcelaSchema).min(1, "A nota precisa de ao menos uma parcela.") }).safeParse({ parcelas: f.parcelas });
    if (ps && !ps.success) throw new ErroNota(mensagemZod(ps.error));
    data.parcelas = ps === null ? Prisma.DbNull : (ps.data.parcelas as unknown as Prisma.InputJsonValue);
  }
  if (Object.keys(data).length) await tx.notaCompra.update({ where: { id: nota.id }, data });
}

/** "Salvar rascunho": vínculos, conversão e preço da linha (itens) + o financeiro. Nada é lançado. */
export async function conciliar({ empresaId, notaId, escolhas, financeiro, ...poderes }: {
  empresaId: string; notaId: string; escolhas: Escolha[]; financeiro?: FinanceiroRascunho;
} & Poderes) {
  return prisma.$transaction(async (tx) => {
    const nota = await tx.notaCompra.findFirst({ where: { id: notaId, empresaId }, select: { id: true, status: true, categoriaId: true, centroCustoId: true } });
    if (!nota) throw new ErroNota("Nota não encontrada.", 404);
    if (nota.status === "LANCADA") throw new ErroNota("Nota já lançada: os vínculos não mudam mais.", 409);
    const faltam = await aplicarEscolhas(tx, empresaId, notaId, escolhas, poderes);
    if (financeiro) await salvarFinanceiro(tx, empresaId, nota, financeiro, poderes);
    const status = faltam ? "IMPORTADA" : "CONCILIADA";
    await tx.notaCompra.update({ where: { id: notaId }, data: { status } });
    return { status, faltam };
  });
}

/** Parcelas do rascunho (JSON da nota) conferidas de novo; null = ainda as duplicatas da NF. */
export function parcelasDoRascunho(json: unknown): ParcelaRascunho[] | null {
  if (json == null) return null;
  const r = z.array(parcelaSchema).min(1).safeParse(json);
  if (!r.success) throw new ErroNota("As parcelas do rascunho estão inválidas: ajuste e salve de novo.");
  return r.data;
}

/** As parcelas que viram conta a pagar: as do rascunho ou, sem rascunho, as da NF. */
export function parcelasParaLancar(nota: { parcelas: unknown; duplicatas: unknown; valorTotal: Prisma.Decimal | number; dataEmissao: Date }) {
  return parcelasDoRascunho(nota.parcelas)
    ?? parcelasDaNf({ duplicatas: nota.duplicatas as DuplicataNfe[], valorTotal: Number(nota.valorTotal), dataEmissao: nota.dataEmissao });
}

/* ───────── Lançar ───────── */
export async function lancarNota({ empresaId, usuarioId, notaId, escolhas = [], pedidoCompraId = null, financeiro, podePrecificar = false, podeVincularPedido = false }: {
  empresaId: string; usuarioId: string | null; notaId: string; escolhas?: Escolha[]; pedidoCompraId?: string | null;
  /** o que estiver na tela na hora de confirmar (grava no rascunho antes de lançar) */
  financeiro?: FinanceiroRascunho;
  /** Configurações › gerenciar: o preço de venda da linha só é aplicado por quem pode precificar */
  podePrecificar?: boolean;
  /** Compras › gerenciar: escolher o pedido de compra da nota (o idêntico vincula sozinho, sem precisar) */
  podeVincularPedido?: boolean;
}) {
  if (pedidoCompraId && !podeVincularPedido) throw new ErroNota("Vincular a nota a um pedido de compra precisa de Compras › gerenciar.", 403);
  // Quem lança já tem Financeiro › fluxo de caixa (a rota exige): o financeiro da tela é aceito
  const poderes: Poderes = { podePrecificar, podeFinanceiro: true };
  return prisma.$transaction(async (tx) => {
    // Preço de venda na linha (no corpo ou no rascunho salvo) só por quem pode precificar — antes de tudo
    if (!podePrecificar) {
      if (escolhas.some((e) => e.preco !== undefined)) throw new ErroNota(SEM_PRECO, 403);
      const comPrecoSalvo = (await tx.notaCompraItem.findMany({
        where: { notaId, nota: { empresaId } }, select: { descricaoFornecedor: true, precoVenda: true, margemVenda: true },
      })).filter((i) => i.precoVenda != null || i.margemVenda != null);
      if (comPrecoSalvo.length)
        throw new ErroNota(`Esta nota tem preço de venda definido na linha (${comPrecoSalvo.map((i) => i.descricaoFornecedor).join(", ")}): lançar aplica o preço e precisa de Configurações › gerenciar. Peça a quem pode, ou tire o preço da linha.`, 403);
    }
    // Reserva a nota: só UMA confirmação passa daqui (a outra, simultânea, encontra LANCADA)
    const reservada = await tx.notaCompra.updateMany({
      where: { id: notaId, empresaId, status: { not: "LANCADA" } },
      data: { status: "LANCADA", lancadaEm: new Date() },
    });
    if (!reservada.count) {
      const existe = await tx.notaCompra.findFirst({ where: { id: notaId, empresaId }, select: { id: true } });
      throw existe ? new ErroNota("Esta nota já foi lançada: o estoque e as contas não são lançados de novo.", 409) : new ErroNota("Nota não encontrada.", 404);
    }
    if (escolhas.length) await aplicarEscolhas(tx, empresaId, notaId, escolhas, poderes);
    if (financeiro) {
      const atual = await tx.notaCompra.findFirstOrThrow({ where: { id: notaId }, select: { id: true, categoriaId: true, centroCustoId: true } });
      await salvarFinanceiro(tx, empresaId, atual, financeiro, poderes);
    }

    const nota = await tx.notaCompra.findFirstOrThrow({
      where: { id: notaId, empresaId },
      include: {
        itens: {
          orderBy: { numeroItem: "asc" },
          include: { produto: { select: { nome: true, unidade: true, valorPadrao: true, margemVenda: true, ncm: true, cest: true, gtin: true, origemMercadoria: true, unidadeTributavel: true } } },
        },
        fornecedor: { select: { id: true, nome: true, documento: true } },
      },
    });
    const semProduto = nota.itens.filter((i) => !i.produtoId);
    if (semProduto.length) throw new ErroNota(`Falta escolher o produto de ${semProduto.length} item(ns): ${semProduto.map((i) => i.descricaoFornecedor).join("; ")}.`);
    // Preço de venda definido na linha (quem lança sem poder precificar já foi barrado lá em cima)
    const comPreco = nota.itens.filter((i) => i.precoVenda != null || i.margemVenda != null);
    const parcelas = parcelasParaLancar(nota);

    // Pedido de compra (opcional): da empresa e sem conta a pagar lançada à mão (essa duplicaria a dívida).
    // Conta de OUTRA NF não trava: entrega parcial = uma NF (e uma dívida) por entrega.
    if (pedidoCompraId) {
      const pedido = await tx.pedidoCompraInterno.findFirst({ where: { id: pedidoCompraId, empresaId }, select: { id: true, numero: true, contasPagar: { where: { notaCompraId: null }, select: { numero: true }, take: 1 } } });
      if (!pedido) throw new ErroNota("Pedido de compra inválido.");
      if (pedido.contasPagar.length) throw new ErroNota(`O pedido ${pedido.numero} já tem a conta a pagar ${pedido.contasPagar[0].numero}: lance a nota sem vincular o pedido, ou cancele aquela conta antes.`, 409);
    }

    // Pedido idêntico (mesmo fornecedor, todos os itens, mesmas quantidades): vincula sozinho — reversível.
    // Com o pedido escolhido na tela, vale o escolhido.
    const automatico = pedidoCompraId ? null : (await sugestoesDaNota(empresaId, notaId, tx))?.automatico ?? null;
    const pedidoDaNota = pedidoCompraId ?? automatico?.pedidoId ?? null;
    // a conta a pagar aponta para o pedido (o escolhido; o idêntico só se não tiver conta lançada à mão)
    const pedidoDaConta = pedidoCompraId
      ?? (automatico && !(await tx.contaPagar.count({ where: { pedidoCompraId: automatico.pedidoId, notaCompraId: null } })) ? automatico.pedidoId : null);

    // Custo da compra anterior de cada produto (antes desta nota), para o aviso de custo
    const custoAnterior = await ultimosCustos(empresaId, nota.itens.map((i) => i.produtoId!), { excetoNotaId: nota.id }, tx);

    // 1) Entrada no estoque — a função da E1, dentro desta transação — já na unidade do produto
    const entradas = [];
    const avisos: string[] = [];
    const avisosCusto: AvisoCusto[] = [];
    const custoDoItem = new Map<string, number>();
    for (const it of nota.itens) {
      const fator = Number(it.fatorConversao);
      const { quantidade, custoUnitario } = converterItem(Number(it.quantidade), Number(it.valorUnitario), fator);
      const r = await movimentar({
        empresaId, produtoId: it.produtoId!, operacao: "ENTRADA", valor: quantidade, usuarioId,
        custoUnitario, origem: "COMPRA", refId: nota.id,
        observacao: `NF ${nota.numero}/${nota.serie} · ${nota.fornecedor.nome} · item ${it.numeroItem}`
          + (fator !== 1 || !mesmaUnidade(it.unidade, it.produto!.unidade) ? ` · ${arred(Number(it.quantidade))} ${it.unidade} × ${fator}` : ""),
      }, tx);
      entradas.push({ itemId: it.id, produto: it.produto!.nome, unidade: it.produto!.unidade, quantidade, custoUnitario, fator, saldo: r.saldo });
      custoDoItem.set(it.id, custoUnitario);
      // preço definido nesta nota: a pessoa já decidiu (o aviso de custo seria sobre o preço antigo)
      if (it.precoVenda != null || it.margemVenda != null) continue;
      const aviso = avisoCusto({
        produtoId: it.produtoId!, produto: it.produto!.nome, unidade: it.produto!.unidade,
        custoAnterior: custoAnterior.get(it.produtoId!), custoNovo: custoUnitario,
        preco: it.produto!.valorPadrao == null ? null : Number(it.produto!.valorPadrao),
        margemAlvo: it.produto!.margemVenda == null ? null : Number(it.produto!.margemVenda),
      });
      if (aviso) avisosCusto.push(aviso);
    }

    // 2) De-para aprendido (código do item neste fornecedor → produto, com a unidade e o fator)
    for (const it of nota.itens) {
      const codigo = chaveDePara(it.codigoFornecedor);
      const aprendido = { produtoId: it.produtoId!, descricaoFornecedor: it.descricaoFornecedor, unidadeOrigem: it.unidade, fatorConversao: it.fatorConversao };
      await tx.deParaProdutoFornecedor.upsert({
        where: { empresaId_fornecedorId_codigoFornecedor: { empresaId, fornecedorId: nota.fornecedorId, codigoFornecedor: codigo } },
        create: { empresaId, fornecedorId: nota.fornecedorId, codigoFornecedor: codigo, ...aprendido },
        update: aprendido,
      });
    }

    // 2b) Dados fiscais: completa o que o produto ainda não tem; o que já tem fica (só avisa se a nota diz outra coisa)
    const fiscalFeito = new Set<string>();
    for (const it of nota.itens) {
      if (fiscalFeito.has(it.produtoId!)) continue;
      fiscalFeito.add(it.produtoId!);
      const doItem = fiscalDoItem(it);
      const novos: Record<string, string> = {};
      for (const [campo, rotulo] of CAMPOS_FISCAIS) {
        const v = doItem[campo], atual = it.produto![campo];
        if (!v) continue;
        if (!atual) novos[campo] = v;
        else if (atual.trim() !== v.trim()) avisos.push(`${it.produto!.nome}: ${rotulo} do cadastro (${atual}) é diferente da nota (${v}) — mantido o do cadastro.`);
      }
      if (Object.keys(novos).length) await tx.produto.update({ where: { id: it.produtoId!, empresaId }, data: novos });
    }

    // 2c) Preço de venda definido na linha: vai para o produto (por margem, com o custo desta nota)
    const precosAplicados: { produtoId: string; produto: string; precoAnterior: number | null; preco: number; margem: number | null }[] = [];
    for (const it of comPreco) {
      const margem = it.margemVenda == null ? null : Number(it.margemVenda);
      const preco = margem != null ? precoPorMargem(custoDoItem.get(it.id), margem) : Number(it.precoVenda);
      if (preco == null || !(preco > 0)) throw new ErroNota(`${it.produto!.nome}: sem custo nesta nota não dá para calcular pela margem — defina um preço fixo.`);
      const ja = precosAplicados.find((p) => p.produtoId === it.produtoId);
      if (ja) {
        if (ja.preco !== preco || ja.margem !== margem) throw new ErroNota(`${it.produto!.nome} aparece em mais de um item com preços diferentes: deixe o preço de venda em um só.`);
        continue;
      }
      await tx.produto.update({ where: { id: it.produtoId!, empresaId }, data: { valorPadrao: preco, margemVenda: margem } });
      precosAplicados.push({ produtoId: it.produtoId!, produto: it.produto!.nome, precoAnterior: it.produto!.valorPadrao == null ? null : Number(it.produto!.valorPadrao), preco, margem });
    }

    // 3) Contas a pagar: uma por parcela (padrão = as duplicatas; sem duplicata, uma à vista), com a
    //    classificação, a forma de pagamento e o boleto do rascunho
    const ajustadas = nota.parcelas != null;
    const ano = anoBR();
    const ultimo = await tx.contaPagar.findFirst({ where: { empresaId, numero: { startsWith: `CP-${ano}-` } }, orderBy: { numero: "desc" }, select: { numero: true } });
    let seq = ultimo ? Number(ultimo.numero.split("-")[2]) : 0;
    const contas = [];
    for (const [i, p] of parcelas.entries()) {
      const valor = arred(p.valor);
      const boleto = p.boleto ? lerBoleto(p.boleto) : null;
      const deQual = parcelas.length > 1 ? `Parcela ${i + 1}/${parcelas.length}` : "Parcela única";
      contas.push(await tx.contaPagar.create({
        data: {
          empresaId, numero: gerarNumeroContaPagar(++seq, ano),
          fornecedorId: nota.fornecedorId, fornecedor: nota.fornecedor.nome, fornecedorCnpj: nota.fornecedor.documento ?? nota.emitenteCnpj,
          descricao: `NF ${nota.numero}/${nota.serie}${parcelas.length > 1 ? ` — parcela ${i + 1}/${parcelas.length}` : ""}`,
          valorTotal: valor, valorPago: 0, saldoRestante: valor, status: "PENDENTE", dataVencimento: new Date(`${p.vencimento}T12:00:00.000Z`),
          notaCompraId: nota.id, pedidoCompraId: pedidoDaConta,
          categoriaId: nota.categoriaId, centroCustoId: nota.centroCustoId, formaPagamento: nota.formaPagamento,
          linhaDigitavel: boleto?.ok ? boleto.boleto.linhaDigitavel : null, codigoBarrasBoleto: boleto?.ok ? boleto.boleto.codigoBarras : null,
          observacao: p.duplicata ? `Duplicata ${p.duplicata} da NF-e ${nota.chaveAcesso}`
            : `${deQual} da NF-e ${nota.chaveAcesso}${ajustadas ? " (parcelas ajustadas no lançamento)" : " (à vista)"}`,
        },
        select: { id: true, numero: true, valorTotal: true, dataVencimento: true, linhaDigitavel: true },
      }));
    }

    // 3b) Aprende com o fornecedor: a categoria e o centro de custo desta nota viram o padrão das próximas
    //     (escolher "nenhum" não apaga o que já foi aprendido)
    const aprender = { ...(nota.categoriaId && { categoriaPadraoId: nota.categoriaId }), ...(nota.centroCustoId && { centroCustoPadraoId: nota.centroCustoId }) };
    if (Object.keys(aprender).length) await tx.fornecedor.update({ where: { id: nota.fornecedorId }, data: aprender });

    // 4) Pedido de compra: vínculo POR ITEM (quantidade e custo real da NF nos itens, status Parcial/Concluída,
    //    histórico). O escolhido que não casa com nada fica só como o pedido da nota, como antes.
    const vinculoPedido = pedidoDaNota
      ? await vincularNota(tx, { empresaId, usuarioId, notaId, pedidoId: pedidoDaNota, automatico: !pedidoCompraId, exigirCasamento: false })
      : null;
    const itensPedido = vinculoPedido?.itens.length ?? 0;

    // (quem lançou fica em cada movimentação; usuarioId da nota continua sendo quem importou)
    if (pedidoCompraId) await tx.notaCompra.update({ where: { id: notaId }, data: { pedidoCompraId } });
    return {
      notaId,
      entradas,
      contas: contas.map((c) => ({ id: c.id, numero: c.numero, valor: Number(c.valorTotal), vencimento: c.dataVencimento, boleto: !!c.linhaDigitavel })),
      itensPedido,
      vinculoPedido,
      avisos,
      avisosCusto,
      precosAplicados,
    };
  }, { timeout: 30_000 });
}
