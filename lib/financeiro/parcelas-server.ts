/**
 * Contas a Receber — parcelas e recebimentos (servidor). A empresa vem sempre de quem chama (sessão).
 *
 *  - registrarRecebimento: ÚNICO caminho de baixa (manual total/parcial, boleto pago no Inter, pagamento
 *    registrado na medição). Grava o recebimento, soma em valorRecebido e, quando zera o saldo, quita a
 *    conta (e a medição de origem, quando todas as cobranças dela estão quitadas).
 *  - parcelarConta: a conta vira o LANÇAMENTO (PARCELADO) e nascem as parcelas (as cobranças).
 *  - recebidoNoPeriodo: o "recebido" dos painéis — os recebimentos pela data de cada um + as contas
 *    recebidas antigas (de antes dos recebimentos), pelo valor delas.
 */
import type { FormaPagamento, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarMoeda, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { motivoNaoReceber } from "@/lib/financeiro/conta-receber-gestao";
import {
  MAX_PARCELAS, descricaoParcela, motivoNaoParcelar, motivoParcialComBoleto, motivoPlanoInvalido, motivoValorRecebimento, numeroParcela,
  quitaConta, reajustarValores, saldoDaConta, type ParcelaPlano,
} from "@/lib/financeiro/parcelas";

type Db = Prisma.TransactionClient | typeof prisma;

/** O plano de parcelas que a tela manda (as regras de soma/quantidade são as de motivoPlanoInvalido) */
export const planoSchema = z.array(z.object({
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimento inválido"),
  valor: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number()),
})).max(MAX_PARCELAS);

/** Recusa de regra com o status HTTP certo (409 = estado da conta; 400 = dado enviado) */
export class ErroConta extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

export const travarConta = (tx: Prisma.TransactionClient, id: string) => tx.$queryRaw`SELECT id FROM contas_receber WHERE id = ${id} FOR UPDATE`;

/** Contas que são COBRANÇA (o lançamento parcelado fica de fora: o dinheiro está nas parcelas) */
export const SO_COBRANCAS = { status: { not: "PARCELADO" as const } };

/** As cobranças de uma medição: as contas dela + as parcelas do lançamento dela */
export const cobrancasDaMedicao = (medicaoId: string): Prisma.ContaReceberWhereInput => ({
  OR: [{ medicaoId, status: { not: "PARCELADO" } }, { lancamento: { medicaoId } }],
});

export interface NovoRecebimento {
  empresaId: string;
  contaId: string;
  /** Sem valor = o saldo inteiro (baixa total) */
  valor?: number;
  /** Dia do recebimento (dia civil) */
  data: Date;
  formaPagamento?: FormaPagamento | null;
  contaBancariaId?: string | null;
  origem: "MANUAL" | "BOLETO" | "MEDICAO" | "RECUPERACAO";
  /** Comentário (fica no recebimento e na linha do tempo) */
  observacao?: string | null;
  usuarioId?: string | null;
  /** Pago pelo boleto: o boleto passa a PAGO */
  boletoPago?: boolean;
}

/**
 * Baixa (total ou parcial) numa transação, com a conta TRANCADA: dois cliques/webhooks ao mesmo tempo
 * não recebem duas vezes. Recusa (ErroConta) o que a regra não deixa.
 */
export async function registrarRecebimento(tx: Prisma.TransactionClient, p: NovoRecebimento) {
  await travarConta(tx, p.contaId);
  const conta = await tx.contaReceber.findFirst({
    where: { id: p.contaId, empresaId: p.empresaId, excluidaEm: null },
    include: { contaBancaria: { select: { nome: true } } },
  });
  if (!conta) throw new ErroConta(404, "Conta não encontrada.");
  const m = motivoNaoReceber(conta);
  if (m) throw new ErroConta(409, m);

  const saldoAntes = saldoDaConta(conta);
  const valor = p.valor ?? saldoAntes;
  const invalido = motivoValorRecebimento(conta, valor);
  if (invalido) throw new ErroConta(400, invalido);
  if (p.origem === "MANUAL" || p.origem === "RECUPERACAO") {
    const comBoleto = motivoParcialComBoleto(conta, valor);
    if (comBoleto) throw new ErroConta(409, comBoleto);
  }
  const quitou = quitaConta(conta, valor);
  const recebidoDepois = Math.round((Number(conta.valorRecebido) + valor) * 100) / 100;
  const saldoDepois = Math.round((saldoAntes - valor) * 100) / 100;

  const recebimento = await tx.contaReceberRecebimento.create({
    data: {
      empresaId: p.empresaId, contaReceberId: conta.id, valor, data: p.data,
      formaPagamento: p.formaPagamento ?? null, contaBancariaId: p.contaBancariaId ?? conta.contaBancariaId ?? null,
      origem: p.origem, observacao: p.observacao ?? null, usuarioId: p.usuarioId ?? null,
    },
    include: { contaBancaria: { select: { nome: true } } },
  });
  await tx.contaReceber.update({
    where: { id: conta.id },
    data: {
      valorRecebido: recebidoDepois,
      ...(quitou && { status: "RECEBIDO", dataRecebimento: p.data, ...(p.formaPagamento ? { formaPagamento: p.formaPagamento } : {}) }),
      ...(p.boletoPago && { boletoStatus: "PAGO" }),
    },
  });

  const origemTexto = p.origem === "BOLETO" ? "Boleto pago no Banco Inter" : p.origem === "MEDICAO" ? "Pagamento registrado na fatura/medição"
    : p.origem === "RECUPERACAO" ? "Recuperação de perda" : null;
  await tx.contaReceberEvento.create({
    data: {
      empresaId: p.empresaId, contaReceberId: conta.id, usuarioId: p.usuarioId ?? null,
      tipo: quitou ? "RECEBIDA" : "RECEBIMENTO_PARCIAL",
      detalhe: [
        `${formatarMoeda(valor)} em ${formatarData(p.data)}`,
        quitou ? (Number(conta.valorRecebido) > 0 ? "quitou a conta" : null) : `em aberto ${formatarMoeda(saldoDepois)}`,
        p.formaPagamento ? LABELS_FORMA_PAGAMENTO[p.formaPagamento] : null,
        recebimento.contaBancaria?.nome ?? conta.contaBancaria?.nome ?? conta.banco,
        origemTexto,
        p.observacao || null,
      ].filter(Boolean).join(" · "),
    },
  });

  if (quitou) await quitarOrigem(tx, conta, p);
  return { recebimentoId: recebimento.id, valor, quitou, saldo: saldoDepois };
}

/** Profundidade máxima seguindo renegociação de renegociação (defesa contra ciclo) */
const MAX_CADEIA = 10;
type CobrancaQuitacao = { status: string; renegociadaEmId: string | null };

/** Quitada de vez: recebida, cancelada, ou renegociada numa renegociação que já foi quitada */
async function cobrancaQuitada(tx: Prisma.TransactionClient, c: CobrancaQuitacao, prof = 0): Promise<boolean> {
  if (c.status === "RECEBIDO" || c.status === "CANCELADO") return true;
  if (c.status === "RENEGOCIADO" && c.renegociadaEmId && prof < MAX_CADEIA) return renegociacaoQuitada(tx, c.renegociadaEmId, prof + 1);
  return false;
}

/** A renegociação (conta à vista ou lançamento parcelado) está quitada? Desfeita (cancelada) não quita nada */
export async function renegociacaoQuitada(tx: Prisma.TransactionClient, id: string, prof = 0): Promise<boolean> {
  const r = await tx.contaReceber.findUnique({ where: { id }, select: { status: true, renegociadaEmId: true } });
  if (!r || r.status === "CANCELADO") return false;
  if (r.status !== "PARCELADO") return cobrancaQuitada(tx, r, prof);
  const ps = await tx.contaReceber.findMany({ where: { lancamentoId: id, excluidaEm: null }, select: { status: true, renegociadaEmId: true } });
  if (!ps.length) return false;
  for (const x of ps) if (!(await cobrancaQuitada(tx, x, prof))) return false;
  return true;
}

/**
 * Conta quitada → a medição de origem fica PAGA quando TODAS as cobranças dela estão quitadas (conta
 * direta: ela mesma; parcela: todas as parcelas do lançamento). Renegociada conta como quitada quando a
 * renegociação dela foi quitada; e quitar uma renegociação quita a origem de cada cobrança renegociada
 * (a medição de origem fica PAGA quando a renegociação é quitada — inclusive renegociação de renegociação).
 */
async function quitarOrigem(tx: Prisma.TransactionClient, conta: { id: string; medicaoId: string | null; lancamentoId: string | null }, p: NovoRecebimento, prof = 0) {
  let medicaoId = conta.medicaoId;
  if (conta.lancamentoId) {
    medicaoId = null;
    const lanc = await tx.contaReceber.findUnique({ where: { id: conta.lancamentoId }, select: { medicaoId: true } });
    if (lanc?.medicaoId) {
      const parcelas = await tx.contaReceber.findMany({ where: { lancamentoId: conta.lancamentoId, excluidaEm: null }, select: { status: true, renegociadaEmId: true } });
      let todas = true;
      for (const x of parcelas) if (!(await cobrancaQuitada(tx, x))) { todas = false; break; }
      if (todas) medicaoId = lanc.medicaoId;
    }
  }
  if (medicaoId) {
    await tx.medicao.updateMany({
      where: { id: medicaoId, status: { notIn: ["PAGO", "CANCELADA"] } },
      data: { status: "PAGO", dataPagamento: p.data, ...(p.formaPagamento ? { formaPagamento: p.formaPagamento } : {}) },
    });
  }
  // Esta cobrança é (parte de) uma renegociação: quitada a renegociação inteira, as originais seguem
  const raiz = conta.lancamentoId ?? conta.id;
  if (prof >= MAX_CADEIA) return;
  const originais = await tx.contaReceber.findMany({ where: { renegociadaEmId: raiz, status: "RENEGOCIADO" }, select: { id: true, medicaoId: true, lancamentoId: true } });
  if (!originais.length || !(await renegociacaoQuitada(tx, raiz))) return;
  for (const o of originais) await quitarOrigem(tx, o, p, prof + 1);
}

/** Faixa de datas (dia civil): gte/lte ou gte/lt */
type Faixa = { gte: Date; lte?: Date; lt?: Date };

/**
 * Recebido no período (painel, dashboard): cada recebimento pela data dele + as contas RECEBIDAS
 * antigas (sem recebimento gravado, valorRecebido 0) pelo valor e pela data de recebimento.
 */
export async function recebidoNoPeriodo(empresaId: string, faixa: Faixa, db: Db = prisma) {
  const [rec, antigas] = await Promise.all([
    // Estornado não entrou (baixa errada desfeita)
    db.contaReceberRecebimento.aggregate({ where: { empresaId, data: faixa, estornadoEm: null }, _sum: { valor: true }, _count: true }),
    db.contaReceber.aggregate({ where: { empresaId, status: "RECEBIDO", valorRecebido: 0, dataRecebimento: faixa }, _sum: { valor: true }, _count: true }),
  ]);
  return {
    valor: Math.round((Number(rec._sum.valor ?? 0) + Number(antigas._sum.valor ?? 0)) * 100) / 100,
    qtd: rec._count + antigas._count,
  };
}

/** Soma "em aberto" de um aggregate com _sum de valor e valorRecebido */
export const saldoDoAgregado = (a: { _sum?: { valor?: unknown; valorRecebido?: unknown } | null }) =>
  Math.round((Number(a._sum?.valor ?? 0) - Number(a._sum?.valorRecebido ?? 0)) * 100) / 100;

export interface PedidoParcelar { empresaId: string; contaId: string; parcelas: ParcelaPlano[]; usuarioId?: string | null }

/**
 * Divide a conta em parcelas (com a conta TRANCADA). A conta vira o lançamento (PARCELADO); cada
 * parcela herda cliente, categoria, centro de custo, forma e conta bancária, e ganha vencimento/valor
 * próprios. Devolve as parcelas criadas.
 */
export async function parcelarConta(tx: Prisma.TransactionClient, p: PedidoParcelar) {
  await travarConta(tx, p.contaId);
  const conta = await tx.contaReceber.findFirst({ where: { id: p.contaId, empresaId: p.empresaId } });
  if (!conta) throw new ErroConta(404, "Conta não encontrada.");
  const m = motivoNaoParcelar(conta);
  if (m) throw new ErroConta(409, m);
  const total = Number(conta.valor);
  const invalido = motivoPlanoInvalido(total, p.parcelas);
  if (invalido) throw new ErroConta(400, invalido);
  const n = p.parcelas.length;

  const virou = await tx.contaReceber.updateMany({
    where: { id: conta.id, status: conta.status, valorRecebido: 0, lancamentoId: null, OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }] },
    data: { status: "PARCELADO", parcelaTotal: n },
  });
  if (virou.count !== 1) throw new ErroConta(409, "A conta mudou enquanto você parcelava. Atualize a tela.");

  // Parcela vencida vira ATRASADO pela regra única (marcarContasReceberVencidas)
  const status = conta.status === "PREVISTO" ? "PREVISTO" : "A_RECEBER";
  const criadas = [];
  for (const [k, parc] of p.parcelas.entries()) {
    const i = k + 1;
    const nova = await tx.contaReceber.create({
      data: {
        empresaId: conta.empresaId, clienteId: conta.clienteId, clienteCnpj: conta.clienteCnpj,
        numero: numeroParcela(conta.numero, i), descricao: descricaoParcela(conta.descricao, i, n),
        valor: parc.valor, status, dataVencimento: new Date(`${parc.vencimento}T00:00:00.000Z`),
        formaPagamento: conta.formaPagamento, banco: conta.banco, contaBancariaId: conta.contaBancariaId,
        categoriaId: conta.categoriaId, categoria: conta.categoria, centroCustoId: conta.centroCustoId,
        lancamentoId: conta.id, parcelaNumero: i, parcelaTotal: n,
      },
    });
    await tx.contaReceberEvento.create({
      data: { empresaId: conta.empresaId, contaReceberId: nova.id, tipo: "CRIADA", usuarioId: p.usuarioId ?? null, detalhe: `Parcela ${i}/${n} de ${conta.numero}` },
    });
    criadas.push(nova);
  }
  await tx.contaReceberEvento.create({
    data: {
      empresaId: conta.empresaId, contaReceberId: conta.id, tipo: "PARCELADA", usuarioId: p.usuarioId ?? null,
      detalhe: `${formatarMoeda(total)} em ${n} parcelas: ` + p.parcelas.map((x, k) => `${k + 1}/${n} ${formatarMoeda(x.valor)} vence ${formatarData(`${x.vencimento}T00:00:00.000Z`)}`).join(" · "),
    },
  });
  return criadas;
}

/**
 * O total do lançamento mudou (retenções da fatura, valor da medição): reajusta as parcelas na mesma
 * proporção. Só enquanto nenhuma parcela teve recebimento, boleto emitido ou foi cancelada; senão
 * devolve o motivo e não mexe em nada.
 */
export async function reajustarParcelas(tx: Prisma.TransactionClient, p: { empresaId: string; lancamentoId: string; novoTotal: number; usuarioId?: string | null; motivo: string }): Promise<string | null> {
  const lanc = await tx.contaReceber.findFirst({ where: { id: p.lancamentoId, empresaId: p.empresaId, status: "PARCELADO" }, select: { id: true, valor: true } });
  if (!lanc) return "Conta parcelada não encontrada.";
  const parcelas = await tx.contaReceber.findMany({ where: { lancamentoId: lanc.id, excluidaEm: null }, orderBy: { parcelaNumero: "asc" } });
  if (parcelas.some((x) => x.status === "RECEBIDO" || Number(x.valorRecebido) > 0)) return "Parcela com recebimento: o valor das parcelas não muda mais.";
  if (parcelas.some((x) => x.boletoStatus === "EMITIDO")) return "Parcela com boleto emitido: cancele o boleto antes.";
  if (parcelas.some((x) => x.status === "CANCELADO")) return "Parcela cancelada: o valor das parcelas não muda mais.";
  if (parcelas.some((x) => x.status === "PERDA")) return "Parcela em perda: o valor das parcelas não muda mais.";
  if (parcelas.some((x) => x.status === "RENEGOCIADO")) return "Parcela renegociada: o valor das parcelas não muda mais.";
  if (Number(lanc.valor) === p.novoTotal) return null;
  const novos = reajustarValores(parcelas.map((x) => Number(x.valor)), p.novoTotal);
  if (novos.some((v) => !(v > 0))) return "O valor novo não dá para dividir nas parcelas.";
  for (const [k, x] of parcelas.entries()) await tx.contaReceber.update({ where: { id: x.id }, data: { valor: novos[k] } });
  await tx.contaReceber.update({ where: { id: lanc.id }, data: { valor: p.novoTotal } });
  await tx.contaReceberEvento.create({
    data: {
      empresaId: p.empresaId, contaReceberId: lanc.id, tipo: "REAJUSTADA", usuarioId: p.usuarioId ?? null,
      detalhe: `${p.motivo}: ${formatarMoeda(Number(lanc.valor))} → ${formatarMoeda(p.novoTotal)} (${novos.map((v, k) => `${k + 1}/${parcelas.length} ${formatarMoeda(v)}`).join(" · ")})`,
    },
  });
  return null;
}

/**
 * Cobranças de uma medição que impedem cancelá-la (o dinheiro já se mexeu): parcela recebida (total ou
 * parte), com boleto emitido, em perda ou renegociada, ou conta direta com recebimento parcial, em perda ou renegociada.
 */
export function cobrancasQueTravamMedicao(medicaoId: string, db: Db = prisma) {
  return db.contaReceber.findMany({
    where: {
      excluidaEm: null,
      OR: [
        { lancamento: { medicaoId }, OR: [{ status: "RECEBIDO" }, { status: "PERDA" }, { status: "RENEGOCIADO" }, { valorRecebido: { gt: 0 } }, { boletoStatus: "EMITIDO" }] },
        { medicaoId, status: { notIn: ["RECEBIDO", "CANCELADO", "PARCELADO"] }, OR: [{ valorRecebido: { gt: 0 } }, { status: "PERDA" }, { status: "RENEGOCIADO" }] },
      ],
    },
    select: { numero: true },
    orderBy: { numero: "asc" },
  });
}

/** Desfaz o parcelamento (medição cancelada): as parcelas em aberto são canceladas, com evento */
export async function cancelarParcelas(db: Db, p: { lancamentoId: string; empresaId: string; motivo: string; usuarioId?: string | null }) {
  const abertas = await db.contaReceber.findMany({
    where: { lancamentoId: p.lancamentoId, excluidaEm: null, status: { notIn: ["RECEBIDO", "CANCELADO"] } },
    select: { id: true },
  });
  for (const a of abertas) {
    const r = await db.contaReceber.updateMany({
      where: { id: a.id, status: { notIn: ["RECEBIDO", "CANCELADO"] } },
      data: { status: "CANCELADO", canceladaEm: new Date(), motivoCancelamento: p.motivo },
    });
    if (r.count) await db.contaReceberEvento.create({ data: { empresaId: p.empresaId, contaReceberId: a.id, tipo: "CANCELADA", detalhe: p.motivo, usuarioId: p.usuarioId ?? null } });
  }
  await db.contaReceber.update({ where: { id: p.lancamentoId }, data: { parcelaTotal: null } });
  return abertas.length;
}

/** NF emitida: as cobranças previstas da medição (contas e parcelas) ficam liberadas para receber */
export function liberarCobrancasDaMedicao(medicaoId: string, db: Db = prisma) {
  return db.contaReceber.updateMany({ where: { ...cobrancasDaMedicao(medicaoId), status: "PREVISTO" }, data: { status: "A_RECEBER" } });
}
