/**
 * Contas a Receber — renegociar e desfazer (servidor). A empresa vem sempre de quem chama (sessão). Tudo
 * numa transação com as contas TRANCADAS (em ordem fixa: duas renegociações ao mesmo tempo não se
 * travam nem renegociam a mesma cobrança duas vezes). O rastro fica nos dois sentidos: a original aponta
 * para a renegociação (renegociada_em_id) e as duas linhas do tempo contam o que aconteceu.
 */
import type { FormaPagamento, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { anoBR } from "@/lib/fuso";
import { proximoNumeroContaReceber } from "@/lib/financeiro-server";
import { ErroConta, parcelarConta, travarConta } from "@/lib/financeiro/parcelas-server";
import { saldoDaConta, type ParcelaPlano } from "@/lib/financeiro/parcelas";
import {
  composicaoDoRecebido, descricaoRenegociacao, motivoEncargosInvalidos, motivoNaoDesfazer, motivoNaoRenegociar, motivoPlanoRenegociacao,
  motivoSelecaoInvalida, motivoTextoDesfazer, totalRenegociacao,
} from "@/lib/financeiro/renegociacao";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** A cobrança faz parte de uma renegociação (ela mesma à vista, ou parcela do lançamento dela)? */
export async function ehRenegociacao(db: Db, c: { id: string; lancamentoId: string | null }) {
  return (await db.contaReceber.count({ where: { renegociadaEmId: c.lancamentoId ?? c.id } })) > 0;
}

/** Quantas cobranças cabem numa renegociação */
export const MAX_RENEGOCIAR = 50;

export interface PedidoRenegociar {
  empresaId: string;
  contaIds: string[];
  juros?: number | null; multa?: number | null; desconto?: number | null;
  /** 1 vencimento (à vista) ou as parcelas (a soma é o total novo) */
  plano: ParcelaPlano[];
  formaPagamento?: FormaPagamento | null;
  contaBancariaId?: string | null;
  observacao?: string | null;
  usuarioId?: string | null;
}

const dia = (v: string) => new Date(`${v}T00:00:00.000Z`);

/**
 * Renegocia: nasce a conta nova (o saldo de cada + juros + multa − desconto), à vista ou já parcelada; as
 * originais ficam RENEGOCIADO apontando para ela. O que já foi recebido nas originais fica onde está.
 */
export async function renegociar(tx: Tx, p: PedidoRenegociar) {
  const ids = [...new Set(p.contaIds)].sort();
  if (!ids.length) throw new ErroConta(400, "Escolha pelo menos uma cobrança.");
  if (ids.length > MAX_RENEGOCIAR) throw new ErroConta(400, `No máximo ${MAX_RENEGOCIAR} cobranças por renegociação.`);
  for (const id of ids) await travarConta(tx, id);
  const contas = await tx.contaReceber.findMany({ where: { id: { in: ids }, empresaId: p.empresaId }, orderBy: [{ numero: "asc" }] });
  if (contas.length !== ids.length) throw new ErroConta(404, "Conta não encontrada.");
  const sel = motivoSelecaoInvalida(contas);
  if (sel) throw new ErroConta(409, sel);

  const enc = { juros: p.juros ?? 0, multa: p.multa ?? 0, desconto: p.desconto ?? 0 };
  const saldos = contas.map((c) => saldoDaConta(c));
  const { saldo, total } = totalRenegociacao(saldos, enc);
  const invEnc = motivoEncargosInvalidos(saldo, enc);
  if (invEnc) throw new ErroConta(400, invEnc);
  const invPlano = motivoPlanoRenegociacao(total, p.plano);
  if (invPlano) throw new ErroConta(400, invPlano);

  // O que é igual em todas vai para a conta nova (categoria, centro, conta bancária, forma)
  const base = contas[0];
  const comum = <K extends "categoriaId" | "categoria" | "centroCustoId" | "contaBancariaId" | "formaPagamento" | "banco" | "clienteCnpj">(k: K) =>
    contas.every((c) => c[k] === base[k]) ? base[k] : null;
  const numero = await proximoNumeroContaReceber(p.empresaId, anoBR(), tx);
  const nova = await tx.contaReceber.create({
    data: {
      empresaId: p.empresaId, clienteId: base.clienteId, clienteCnpj: comum("clienteCnpj"),
      numero, descricao: descricaoRenegociacao(contas.map((c) => c.numero)),
      valor: total, status: "A_RECEBER", dataVencimento: dia(p.plano[0].vencimento),
      formaPagamento: p.formaPagamento ?? comum("formaPagamento"),
      contaBancariaId: p.contaBancariaId !== undefined ? p.contaBancariaId : comum("contaBancariaId"),
      banco: p.contaBancariaId !== undefined ? null : comum("banco"),
      categoriaId: comum("categoriaId"), categoria: comum("categoria"), centroCustoId: comum("centroCustoId"),
      observacao: p.observacao?.trim() || null,
      renegJuros: enc.juros, renegMulta: enc.multa, renegDesconto: enc.desconto,
    },
  });

  for (const [k, c] of contas.entries()) {
    // Guardado: só renegocia se ainda está como lemos (sem boleto emitido nem baixa no meio)
    const r = await tx.contaReceber.updateMany({
      where: { id: c.id, status: c.status, valorRecebido: c.valorRecebido, OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }] },
      data: { status: "RENEGOCIADO", renegociadaEmId: nova.id },
    });
    if (r.count !== 1) throw new ErroConta(409, "A conta mudou enquanto você renegociava. Atualize a tela.");
    const rec = Number(c.valorRecebido);
    await tx.contaReceberEvento.create({
      data: {
        empresaId: p.empresaId, contaReceberId: c.id, tipo: "RENEGOCIADA", usuarioId: p.usuarioId ?? null,
        detalhe: [`Saldo de ${formatarMoeda(saldos[k])} renegociado em ${numero}`, rec > 0 ? `já recebido ${formatarMoeda(rec)} continua recebido` : null].filter(Boolean).join(" · "),
      },
    });
  }

  const n = p.plano.length;
  await tx.contaReceberEvento.create({
    data: {
      empresaId: p.empresaId, contaReceberId: nova.id, tipo: "RENEGOCIACAO", usuarioId: p.usuarioId ?? null,
      detalhe: [
        `Saldo ${formatarMoeda(saldo)} de ${contas.map((c, k) => `${c.numero} (${formatarMoeda(saldos[k])})`).join(", ")}`,
        enc.juros > 0 ? `juros ${formatarMoeda(enc.juros)}` : null,
        enc.multa > 0 ? `multa ${formatarMoeda(enc.multa)}` : null,
        enc.desconto > 0 ? `desconto ${formatarMoeda(enc.desconto)}` : null,
        `total ${formatarMoeda(total)}`,
        n > 1 ? `em ${n} parcelas` : `vence ${formatarData(dia(p.plano[0].vencimento))}`,
        p.observacao?.trim() || null,
      ].filter(Boolean).join(" · "),
    },
  });
  const parcelas = n > 1 ? await parcelarConta(tx, { empresaId: p.empresaId, contaId: nova.id, parcelas: p.plano, usuarioId: p.usuarioId }) : [];
  return { id: nova.id, numero, saldo, total, parcelas: parcelas.map((x) => ({ id: x.id, numero: x.numero })) };
}

/** A conta da renegociação (à vista ou o lançamento) a partir de qualquer cobrança dela */
async function raizDaRenegociacao(tx: Tx, empresaId: string, contaId: string) {
  await travarConta(tx, contaId);
  const c = await tx.contaReceber.findFirst({ where: { id: contaId, empresaId }, select: { id: true, lancamentoId: true } });
  if (!c) throw new ErroConta(404, "Conta não encontrada.");
  const raizId = c.lancamentoId ?? c.id;
  if (raizId !== c.id) await travarConta(tx, raizId);
  const raiz = await tx.contaReceber.findFirst({ where: { id: raizId, empresaId } });
  const originais = await tx.contaReceber.findMany({ where: { renegociadaEmId: raizId, empresaId }, orderBy: [{ numero: "asc" }] });
  if (!raiz || !originais.length) throw new ErroConta(409, "Esta conta não é uma renegociação.");
  return { raiz, originais };
}

/**
 * Desfaz a renegociação: só enquanto nenhuma cobrança nova teve dinheiro, boleto, perda ou outra
 * renegociação. A conta nova (e as parcelas) é cancelada com o motivo; as originais voltam a receber.
 */
export async function desfazerRenegociacao(tx: Tx, p: { empresaId: string; contaId: string; motivo: string; usuarioId?: string | null }) {
  const inv = motivoTextoDesfazer(p.motivo);
  if (inv) throw new ErroConta(400, inv);
  const motivo = p.motivo.trim().slice(0, 500);
  const { raiz, originais } = await raizDaRenegociacao(tx, p.empresaId, p.contaId);
  for (const o of [...originais].sort((a, b) => a.id.localeCompare(b.id))) await travarConta(tx, o.id);
  const cobrancas = raiz.status === "PARCELADO"
    ? await tx.contaReceber.findMany({ where: { lancamentoId: raiz.id, excluidaEm: null }, orderBy: { parcelaNumero: "asc" } })
    : [raiz];
  for (const c of cobrancas) if (c.id !== raiz.id) await travarConta(tx, c.id);
  const m = motivoNaoDesfazer(raiz, cobrancas);
  if (m) throw new ErroConta(409, m);

  const agora = new Date();
  const texto = `Renegociação desfeita: ${motivo}`;
  const cancelar = cobrancas.some((c) => c.id === raiz.id) ? cobrancas : [...cobrancas, raiz];
  for (const c of cancelar) {
    await tx.contaReceber.update({ where: { id: c.id }, data: { status: "CANCELADO", canceladaEm: agora, motivoCancelamento: texto } });
    if (c.id !== raiz.id) await tx.contaReceberEvento.create({ data: { empresaId: p.empresaId, contaReceberId: c.id, tipo: "CANCELADA", detalhe: texto, usuarioId: p.usuarioId ?? null } });
  }
  for (const o of originais) {
    // A_RECEBER: a regra única de vencidos (marcarContasReceberVencidas) faz voltar a ATRASADO se já venceu
    const r = await tx.contaReceber.updateMany({ where: { id: o.id, status: "RENEGOCIADO" }, data: { status: "A_RECEBER", renegociadaEmId: null } });
    if (r.count !== 1) throw new ErroConta(409, "A conta mudou enquanto você desfazia. Atualize a tela.");
    await tx.contaReceberEvento.create({
      data: { empresaId: p.empresaId, contaReceberId: o.id, tipo: "RENEGOCIACAO_DESFEITA", usuarioId: p.usuarioId ?? null, detalhe: `Volta a receber ${formatarMoeda(saldoDaConta({ ...o, status: "A_RECEBER" }))}: ${raiz.numero} foi desfeita · ${motivo}` },
    });
  }
  await tx.contaReceberEvento.create({
    data: { empresaId: p.empresaId, contaReceberId: raiz.id, tipo: "RENEGOCIACAO_DESFEITA", usuarioId: p.usuarioId ?? null, detalhe: `${originais.map((o) => o.numero).join(", ")} voltaram a receber · ${motivo}` },
  });
  return { raizId: raiz.id, numero: raiz.numero, originais: originais.map((o) => o.numero) };
}

/** As cobranças do cliente que aparecem para escolher (as que não podem vêm com o porquê) */
export async function renegociaveisDoCliente(empresaId: string, clienteId: string, db: Db = prisma) {
  const contas = await db.contaReceber.findMany({
    where: { empresaId, clienteId, excluidaEm: null, status: { in: ["A_RECEBER", "ATRASADO", "PERDA", "PREVISTO"] } },
    select: {
      id: true, numero: true, descricao: true, valor: true, valorRecebido: true, status: true, boletoStatus: true,
      dataVencimento: true, parcelaNumero: true, parcelaTotal: true, clienteId: true,
    },
    orderBy: [{ dataVencimento: "asc" }, { numero: "asc" }],
    take: 200,
  });
  return contas.map((c) => ({
    id: c.id, numero: c.numero, descricao: c.descricao, status: c.status, dataVencimento: c.dataVencimento?.toISOString() ?? null,
    valor: Number(c.valor), recebido: Number(c.valorRecebido), saldo: saldoDaConta(c), parcelaNumero: c.parcelaNumero, parcelaTotal: c.parcelaTotal,
    motivo: motivoNaoRenegociar(c),
  }));
}

/** Gaveta: de onde veio a renegociação, encargos, quanto já entrou e se dá para desfazer */
export async function detalheDaRenegociacao(db: Db, conta: { id: string; lancamentoId: string | null; renegociadaEmId: string | null }) {
  const raizId = conta.lancamentoId ?? conta.id;
  const originais = await db.contaReceber.findMany({
    where: { renegociadaEmId: raizId }, select: { id: true, numero: true, valor: true, valorRecebido: true, status: true }, orderBy: { numero: "asc" },
  });
  const renegociadaEm = conta.renegociadaEmId
    ? await db.contaReceber.findUnique({ where: { id: conta.renegociadaEmId }, select: { id: true, numero: true, status: true, valor: true } })
    : null;
  if (!originais.length) return { renegociadaEm: renegociadaEm ? { ...renegociadaEm, valor: Number(renegociadaEm.valor) } : null, renegociacao: null };
  const raiz = await db.contaReceber.findUnique({ where: { id: raizId } });
  if (!raiz) return { renegociadaEm: null, renegociacao: null };
  const cobrancas = raiz.status === "PARCELADO"
    ? await db.contaReceber.findMany({ where: { lancamentoId: raiz.id, excluidaEm: null }, select: { numero: true, status: true, valorRecebido: true, boletoStatus: true } })
    : [raiz];
  const juros = Number(raiz.renegJuros ?? 0), multa = Number(raiz.renegMulta ?? 0), desconto = Number(raiz.renegDesconto ?? 0);
  const total = Number(raiz.valor);
  const saldo = Math.round((total - juros - multa + desconto) * 100) / 100;
  const recebido = Math.round(cobrancas.reduce((s, c) => s + Number(c.valorRecebido ?? 0), 0) * 100) / 100;
  return {
    renegociadaEm: renegociadaEm ? { ...renegociadaEm, valor: Number(renegociadaEm.valor) } : null,
    renegociacao: {
      id: raiz.id, numero: raiz.numero, status: raiz.status, total, saldo, juros, multa, desconto, recebido,
      composicao: composicaoDoRecebido({ saldo, juros, multa, desconto }, recebido),
      originais: originais.map((o) => ({ id: o.id, numero: o.numero, saldo: Math.round((Number(o.valor) - Number(o.valorRecebido)) * 100) / 100, recebido: Number(o.valorRecebido) })),
      motivoNaoDesfazer: motivoNaoDesfazer(raiz, cobrancas),
    },
  };
}
