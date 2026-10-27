/**
 * Conciliação NF ↔ Pedido de Compra — o lado do servidor das regras de lib/compras/conciliacao.ts:
 * carregar os pedidos candidatos e a NF (quantidades e custo na unidade do produto, o que já foi
 * vinculado), vincular por item (idempotente: o único por par não deixa duplicar), desvincular
 * (volta o status e o valor real) e avisar o solicitante (sino + e-mail).
 * Empresa SEMPRE a da sessão (quem chama passa); pedido e NF de outra empresa = não encontrado.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatarData } from "@/lib/utils";
import { enviarEmailInterno } from "@/lib/email";
import { montarEmailHtml } from "@/lib/email-templates";
import { registrarEventoPedido } from "@/lib/compras/pedido-server";
import { LABEL_STATUS_PEDIDO, type StatusPedido } from "@/lib/compras/pedido";
import {
  arred2, arred4, casarItens, PEDIDO_ABERTO_PARA_NF, statusPorCobertura, statusSemNota, sugerirPedidos, textoVinculo, valorRealDoItem,
  type Avaliacao, type NotaConc, type PedidoConc,
} from "@/lib/compras/conciliacao";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export class ErroConciliacao extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const DIA = 86_400_000;

/** A NF como o casamento usa: quantidade e custo na unidade do produto; o que já foi para algum pedido */
export async function notaParaConciliar(db: Db, empresaId: string, notaId: string) {
  const nota = await db.notaCompra.findFirst({
    where: { id: notaId, empresaId },
    select: {
      id: true, numero: true, serie: true, status: true, fornecedorId: true, dataEmissao: true,
      itens: {
        orderBy: { numeroItem: "asc" },
        select: {
          id: true, numeroItem: true, produtoId: true, descricaoFornecedor: true, quantidade: true, valorUnitario: true, fatorConversao: true,
          produto: { select: { nome: true } }, vinculosPedido: { select: { quantidade: true } },
        },
      },
    },
  });
  if (!nota) return null;
  const conc: NotaConc = {
    id: nota.id, numero: `${nota.numero}/${nota.serie}`, fornecedorId: nota.fornecedorId, dataEmissao: nota.dataEmissao,
    itens: nota.itens.map((i) => {
      const fator = Number(i.fatorConversao) || 1;
      const quantidade = arred4(Number(i.quantidade) * fator);
      return {
        id: i.id, numeroItem: i.numeroItem, produtoId: i.produtoId, produtoNome: i.produto?.nome ?? null, descricao: i.descricaoFornecedor,
        quantidade, valorUnitario: arred4(Number(i.valorUnitario) / fator),
        disponivel: arred4(quantidade - (i.vinculosPedido ?? []).reduce((s, v) => s + Number(v.quantidade), 0)),
      };
    }),
  };
  return { ...conc, status: nota.status };
}

const SELECT_PEDIDO_CONC = {
  id: true, numero: true, status: true, criadoEm: true, fornecedorId: true,
  itens: { orderBy: { id: "asc" }, select: { id: true, produtoId: true, descricao: true, quantidade: true, unidade: true, valorEstimado: true, vinculos: { select: { quantidade: true } } } },
} satisfies Prisma.PedidoCompraInternoSelect;
type PedidoSel = Prisma.PedidoCompraInternoGetPayload<{ select: typeof SELECT_PEDIDO_CONC }>;

const paraConc = (p: PedidoSel): PedidoConc => ({
  id: p.id, numero: p.numero, status: p.status, criadoEm: p.criadoEm, fornecedorId: p.fornecedorId,
  itens: p.itens.map((i) => ({
    id: i.id, produtoId: i.produtoId, descricao: i.descricao, quantidade: Number(i.quantidade), unidade: i.unidade,
    valorEstimado: i.valorEstimado == null ? null : Number(i.valorEstimado),
    recebido: arred4((i.vinculos ?? []).reduce((s, v) => s + Number(v.quantidade), 0)),
  })),
});

/** Pedidos em aberto da empresa que podem ser desta NF (criados até o dia da emissão) */
export async function pedidosCandidatos(db: Db, empresaId: string, nota: Pick<NotaConc, "dataEmissao">): Promise<PedidoConc[]> {
  const pedidos = await db.pedidoCompraInterno.findMany({
    where: { empresaId, status: { in: [...PEDIDO_ABERTO_PARA_NF] }, criadoEm: { lte: new Date(nota.dataEmissao.getTime() + DIA) } },
    select: SELECT_PEDIDO_CONC, orderBy: { criadoEm: "desc" }, take: 200,
  });
  return pedidos.map(paraConc);
}

/** Sugestões para a NF (e o idêntico que vincularia sozinho) — o que a tela mostra */
export async function sugestoesDaNota(empresaId: string, notaId: string, db: Db = prisma): Promise<{ sugestoes: Avaliacao[]; automatico: Avaliacao | null } | null> {
  const nota = await notaParaConciliar(db, empresaId, notaId);
  if (!nota) return null;
  return sugerirPedidos(await pedidosCandidatos(db, empresaId, nota), nota);
}

/** Vínculos da NF, agrupados por pedido (o painel "Pedido de compra" da NF) */
export async function vinculosDaNota(empresaId: string, notaId: string, db: Db = prisma) {
  const vs = await db.pedidoCompraVinculo.findMany({
    where: { empresaId, notaId },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: {
      quantidade: true, valorUnitario: true, automatico: true, criterio: true, criadoEm: true,
      pedido: { select: { id: true, numero: true, status: true } },
      pedidoItem: { select: { id: true, descricao: true, quantidade: true, unidade: true, vinculos: { select: { quantidade: true } } } },
      notaItem: { select: { numeroItem: true, descricaoFornecedor: true } },
    },
  });
  const porPedido = new Map<string, {
    pedidoId: string; numero: string; status: string; automatico: boolean;
    itens: { descricao: string; unidade: string; quantidade: number; pedido: number; recebido: number; valorUnitario: number; notaItem: number; criterio: string }[];
  }>();
  for (const v of vs) {
    const g = porPedido.get(v.pedido.id) ?? { pedidoId: v.pedido.id, numero: v.pedido.numero, status: v.pedido.status, automatico: v.automatico, itens: [] };
    g.automatico = g.automatico && v.automatico;
    g.itens.push({
      descricao: v.pedidoItem.descricao, unidade: v.pedidoItem.unidade, quantidade: Number(v.quantidade), pedido: Number(v.pedidoItem.quantidade),
      recebido: arred4(v.pedidoItem.vinculos.reduce((s, x) => s + Number(x.quantidade), 0)),
      valorUnitario: Number(v.valorUnitario), notaItem: v.notaItem.numeroItem, criterio: v.criterio,
    });
    porPedido.set(v.pedido.id, g);
  }
  return [...porPedido.values()];
}

/** Trava a NF e o pedido (nessa ordem) até o fim da transação: dois "vincular" ao mesmo tempo não dividem a mesma quantidade */
async function travar(tx: Tx, empresaId: string, notaId: string, pedidoId: string) {
  const [n] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM notas_compra WHERE id = ${notaId} AND empresa_id = ${empresaId} FOR UPDATE`;
  if (!n) throw new ErroConciliacao("Nota não encontrada.", 404);
  const [p] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM pedidos_compra_interno WHERE id = ${pedidoId} AND empresa_id = ${empresaId} FOR UPDATE`;
  if (!p) throw new ErroConciliacao("Pedido de compra não encontrado.", 404);
}

/** Recalcula o valor real dos itens tocados e o status do pedido pela cobertura; devolve o status */
async function recalcularPedido(tx: Tx, pedidoId: string, itensTocados: Iterable<string>, anteriores: Map<string, number | null>) {
  for (const itemId of itensTocados) {
    const vs = await tx.pedidoCompraVinculo.findMany({ where: { pedidoItemId: itemId }, select: { quantidade: true, valorUnitario: true } });
    const valor = valorRealDoItem(vs.map((v) => ({ quantidade: Number(v.quantidade), valorUnitario: Number(v.valorUnitario) })), anteriores.get(itemId) ?? null);
    await tx.pedidoCompraItem.update({ where: { id: itemId }, data: { valorReal: valor } });
  }
  const pedido = await tx.pedidoCompraInterno.findUniqueOrThrow({
    where: { id: pedidoId },
    select: { status: true, itens: { select: { quantidade: true, vinculos: { select: { quantidade: true } } } }, eventos: { select: { tipo: true } } },
  });
  // Cancelado fica cancelado (desvincular uma NF de um pedido cancelado não o reabre)
  if (pedido.status === "CANCELADO") return pedido.status;
  const novo = statusPorCobertura(
    pedido.itens.map((i) => ({ quantidade: Number(i.quantidade), recebido: i.vinculos.reduce((s, v) => s + Number(v.quantidade), 0) })),
    statusSemNota(pedido.eventos.map((e) => e.tipo)),
  );
  if (novo !== pedido.status) await tx.pedidoCompraInterno.update({ where: { id: pedidoId }, data: { status: novo as StatusPedido, statusEm: new Date() } });
  return novo;
}

export interface ResultadoVinculo {
  pedidoId: string; numero: string; status: string; automatico: boolean; criados: number;
  itens: { descricao: string; quantidade: number; unidade: string }[];
}

/**
 * Vincula a NF ao pedido, item a item, dentro da transação de quem chama. Vincular de novo não duplica
 * (o que já estava fica; `criados` = 0). `exigirCasamento`: nada casa = erro (tela) ou só não vincula
 * (lançamento com o pedido escolhido, como antes).
 */
export async function vincularNota(tx: Tx, p: {
  empresaId: string; usuarioId: string | null; notaId: string; pedidoId: string; automatico?: boolean; exigirCasamento?: boolean;
}): Promise<ResultadoVinculo | null> {
  await travar(tx, p.empresaId, p.notaId, p.pedidoId);
  const nota = (await notaParaConciliar(tx, p.empresaId, p.notaId))!;
  const sel = await tx.pedidoCompraInterno.findFirstOrThrow({ where: { id: p.pedidoId, empresaId: p.empresaId }, select: SELECT_PEDIDO_CONC });
  const pedido = paraConc(sel);
  if (!(PEDIDO_ABERTO_PARA_NF as readonly string[]).includes(pedido.status)) {
    throw new ErroConciliacao(`O pedido ${pedido.numero} está ${LABEL_STATUS_PEDIDO[pedido.status as StatusPedido] ?? pedido.status}: não recebe NF.`, 409);
  }
  const pares = casarItens(pedido, nota);
  if (!pares.length) {
    const ja = await tx.pedidoCompraVinculo.count({ where: { notaId: p.notaId, pedidoId: p.pedidoId } });
    if (ja) return { pedidoId: pedido.id, numero: pedido.numero, status: pedido.status, automatico: false, criados: 0, itens: [] };
    if (p.exigirCasamento === false) return null;
    throw new ErroConciliacao(`Nenhum item desta NF casa com o que falta no pedido ${pedido.numero}.`, 409);
  }

  // valor real de antes do 1º vínculo de cada item (passa adiante entre vínculos; volta a ele no fim)
  const itensTocados = [...new Set(pares.map((x) => x.pedidoItemId))];
  const anteriores = new Map<string, number | null>();
  for (const itemId of itensTocados) {
    const primeiro = await tx.pedidoCompraVinculo.findFirst({ where: { pedidoItemId: itemId }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }], select: { valorRealAnterior: true } });
    const item = await tx.pedidoCompraItem.findUniqueOrThrow({ where: { id: itemId }, select: { valorReal: true } });
    const v = primeiro ? primeiro.valorRealAnterior : item.valorReal;
    anteriores.set(itemId, v == null ? null : Number(v));
  }
  const criados = await tx.pedidoCompraVinculo.createMany({
    skipDuplicates: true,
    data: pares.map((x) => ({
      empresaId: p.empresaId, pedidoId: pedido.id, pedidoItemId: x.pedidoItemId, notaId: nota.id, notaItemId: x.notaItemId,
      quantidade: x.quantidade, valorUnitario: x.valorUnitario, valorRealAnterior: anteriores.get(x.pedidoItemId),
      criterio: x.criterio, automatico: !!p.automatico, usuarioId: p.usuarioId,
    })),
  });
  const status = await recalcularPedido(tx, pedido.id, itensTocados, anteriores);
  const itemDe = new Map(pedido.itens.map((i) => [i.id, i]));
  const itens = itensTocados.map((id) => ({
    descricao: itemDe.get(id)!.descricao, unidade: itemDe.get(id)!.unidade,
    quantidade: arred4(pares.filter((x) => x.pedidoItemId === id).reduce((s, x) => s + x.quantidade, 0)),
  }));
  if (criados.count) {
    await tx.pedidoCompraInterno.update({ where: { id: pedido.id }, data: { nfVinculadaEm: new Date(), nfVistaEm: null } });
    await tx.notaCompra.updateMany({ where: { id: nota.id, pedidoCompraId: null }, data: { pedidoCompraId: pedido.id } });
    await registrarEventoPedido({
      empresaId: p.empresaId, pedidoId: pedido.id, tipo: "NF_VINCULADA", usuarioId: p.usuarioId,
      detalhe: textoVinculo({ nota: nota.numero, acao: "vinculada", automatico: p.automatico, itens, status }),
    }, tx);
  }
  return { pedidoId: pedido.id, numero: pedido.numero, status, automatico: !!p.automatico, criados: criados.count, itens };
}

/** Desfaz o vínculo da NF com o pedido: apaga os pares, volta o valor real e o status, registra no histórico */
export async function desvincularNota(tx: Tx, p: { empresaId: string; usuarioId: string | null; notaId: string; pedidoId: string }) {
  await travar(tx, p.empresaId, p.notaId, p.pedidoId);
  const vs = await tx.pedidoCompraVinculo.findMany({
    where: { empresaId: p.empresaId, notaId: p.notaId, pedidoId: p.pedidoId },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: { id: true, pedidoItemId: true, quantidade: true, valorRealAnterior: true, pedidoItem: { select: { descricao: true, unidade: true } }, pedido: { select: { numero: true } }, nota: { select: { numero: true, serie: true } } },
  });
  if (!vs.length) throw new ErroConciliacao("Esta NF não está vinculada a este pedido.", 404);
  const anteriores = new Map<string, number | null>();
  for (const v of vs) if (!anteriores.has(v.pedidoItemId)) anteriores.set(v.pedidoItemId, v.valorRealAnterior == null ? null : Number(v.valorRealAnterior));
  await tx.pedidoCompraVinculo.deleteMany({ where: { id: { in: vs.map((v) => v.id) } } });
  const status = await recalcularPedido(tx, p.pedidoId, anteriores.keys(), anteriores);

  // A NF aponta para outro pedido que ainda tenha vínculo com ela (ou para nenhum)
  const outro = await tx.pedidoCompraVinculo.findFirst({ where: { notaId: p.notaId }, select: { pedidoId: true } });
  await tx.notaCompra.updateMany({ where: { id: p.notaId, pedidoCompraId: p.pedidoId }, data: { pedidoCompraId: outro?.pedidoId ?? null } });

  const itens = [...anteriores.keys()].map((id) => {
    const doItem = vs.filter((v) => v.pedidoItemId === id);
    return { descricao: doItem[0].pedidoItem.descricao, unidade: doItem[0].pedidoItem.unidade, quantidade: arred4(doItem.reduce((s, v) => s + Number(v.quantidade), 0)) };
  });
  const nota = `${vs[0].nota.numero}/${vs[0].nota.serie}`;
  await registrarEventoPedido({
    empresaId: p.empresaId, pedidoId: p.pedidoId, tipo: "NF_DESVINCULADA", usuarioId: p.usuarioId,
    detalhe: textoVinculo({ nota, acao: "desvinculada", itens, status }),
  }, tx);
  return { pedidoId: p.pedidoId, numero: vs[0].pedido.numero, status, removidos: vs.length, itens };
}

// ───────────────────────── Aviso ao solicitante ─────────────────────────

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.APP_URL || "").replace(/\/$/, "");
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * Avisa quem pediu (o solicitante) que a NF chegou: o sino acende sozinho (nfVistaEm vazio) e vai um
 * e-mail pelo Resend da empresa. Falha de e-mail não desfaz o vínculo.
 */
export async function avisarSolicitanteNf(pedidoId: string, notaId: string) {
  try {
    const p = await prisma.pedidoCompraInterno.findUnique({
      where: { id: pedidoId },
      select: {
        id: true, empresaId: true, numero: true, status: true,
        solicitante: { select: { email: true, nome: true, ativo: true } },
        empresa: { select: { nome: true, nomeFantasia: true, telefone: true, email: true, site: true, logo: true, endereco: true, cidade: true, estado: true } },
        vinculos: { where: { notaId }, select: { quantidade: true, pedidoItem: { select: { descricao: true, unidade: true } } } },
      },
    });
    const n = await prisma.notaCompra.findUnique({ where: { id: notaId }, select: { numero: true, serie: true, emitenteNome: true, dataEmissao: true } });
    if (!p || !n || !p.solicitante.email || p.solicitante.ativo === false) return { ok: false, erro: "Sem solicitante com e-mail." };
    const status = LABEL_STATUS_PEDIDO[p.status as StatusPedido] ?? p.status;
    const itens = p.vinculos.map((v) => `<li>${esc(v.pedidoItem.descricao)}: ${arred2(Number(v.quantidade)).toLocaleString("pt-BR")} ${esc(v.pedidoItem.unidade)}</li>`).join("");
    const corpo = `<p>Olá, <strong>${esc(p.solicitante.nome)}</strong>.</p>`
      + `<p>Chegou a NF <strong>${esc(n.numero)}/${esc(n.serie)}</strong> de ${esc(n.emitenteNome)} (emitida em ${formatarData(n.dataEmissao)}) para o seu pedido de compra <strong>${esc(p.numero)}</strong>:</p>`
      + `<ul>${itens}</ul><p>O pedido agora está <strong>${esc(status)}</strong>.</p>`;
    const html = montarEmailHtml({
      empresa: { ...p.empresa, nome: p.empresa.nomeFantasia ?? p.empresa.nome },
      corpoHtml: corpo, botaoLabel: "Abrir o pedido", botaoUrl: `${baseUrl()}/compras/pedidos/${p.id}`,
    });
    return await enviarEmailInterno(p.empresaId, p.solicitante.email, `Pedido ${p.numero}: chegou a NF ${n.numero} — ${status}`, html);
  } catch {
    return { ok: false, erro: "Falha ao avisar o solicitante." };
  }
}

/** O solicitante abriu o pedido: o aviso da NF sai do sino dele */
export async function marcarNfVista(pedido: { id: string; solicitanteId: string; nfVinculadaEm: Date | null; nfVistaEm: Date | null }, usuarioId: string, empresaId: string) {
  if (pedido.solicitanteId !== usuarioId || !pedido.nfVinculadaEm || pedido.nfVistaEm) return false;
  const r = await prisma.pedidoCompraInterno.updateMany({ where: { id: pedido.id, empresaId, nfVistaEm: null }, data: { nfVistaEm: new Date() } });
  return r.count === 1;
}
