/**
 * Contas a Receber — marcar como perda, reverter/recuperar e estornar recebimento (servidor). A empresa vem
 * sempre de quem chama (sessão). Cada ação roda numa transação com a conta TRANCADA (dois cliques ao mesmo
 * tempo não marcam/estornam duas vezes) e deixa o rastro na linha do tempo (motivo + autor).
 */
import type { FormaPagamento, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { ErroConta, registrarRecebimento } from "@/lib/financeiro/parcelas-server";
import { saldoDaConta } from "@/lib/financeiro/parcelas";
import {
  inicioJanelaPerdas, motivoNaoEstornar, motivoNaoMarcarPerda, motivoNaoReverterPerda, motivoTextoInvalido,
} from "@/lib/financeiro/perda-estorno";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
const travarConta = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM contas_receber WHERE id = ${id} FOR UPDATE`;
const reais = (v: number) => Math.round(v * 100) / 100;

async function contaDaEmpresa(tx: Tx, empresaId: string, id: string) {
  await travarConta(tx, id);
  const c = await tx.contaReceber.findFirst({ where: { id, empresaId, excluidaEm: null } });
  if (!c) throw new ErroConta(404, "Conta não encontrada.");
  return c;
}

/**
 * Marca a cobrança como PERDA: o saldo (valor − recebido) sai do a receber e fica registrado como
 * perdido. O que já entrou continua recebido; a nota fiscal e a medição não mudam (a medição não fica paga).
 */
export async function marcarPerda(tx: Tx, p: { empresaId: string; contaId: string; motivo: string; usuarioId?: string | null }) {
  const invalido = motivoTextoInvalido(p.motivo, "o motivo da perda");
  if (invalido) throw new ErroConta(400, invalido);
  const c = await contaDaEmpresa(tx, p.empresaId, p.contaId);
  const m = motivoNaoMarcarPerda(c);
  if (m) throw new ErroConta(409, m);
  const valorPerda = saldoDaConta(c);
  const motivo = p.motivo.trim().slice(0, 500);
  // Guardado: só vira perda se ainda está como lemos (sem boleto emitido no meio)
  const r = await tx.contaReceber.updateMany({
    where: { id: c.id, status: c.status, valorRecebido: c.valorRecebido, OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }] },
    data: { status: "PERDA", perdaEm: new Date(), motivoPerda: motivo, valorPerda, perdaPorId: p.usuarioId ?? null },
  });
  if (r.count !== 1) throw new ErroConta(409, "A conta mudou enquanto você marcava. Atualize a tela.");
  await tx.contaReceberEvento.create({
    data: {
      empresaId: p.empresaId, contaReceberId: c.id, tipo: "PERDA", usuarioId: p.usuarioId ?? null,
      detalhe: [`Perda de ${formatarMoeda(valorPerda)}`, Number(c.valorRecebido) > 0 ? `já recebido ${formatarMoeda(Number(c.valorRecebido))} continua recebido` : null, motivo].filter(Boolean).join(" · "),
    },
  });
  return { valorPerda };
}

export interface ReversaoPerda {
  empresaId: string; contaId: string; usuarioId?: string | null;
  /** REABRIR: volta a receber. RECUPERAR: o cliente pagou — volta e registra o recebimento */
  modo: "REABRIR" | "RECUPERAR";
  motivo?: string | null;
  recebimento?: { valor?: number; data: Date; formaPagamento?: FormaPagamento | null; contaBancariaId?: string | null } | null;
}

/** Reverter perda: a cobrança volta a receber (o vencido volta a ser vencido); recuperar = + recebimento */
export async function reverterPerda(tx: Tx, p: ReversaoPerda) {
  const c = await contaDaEmpresa(tx, p.empresaId, p.contaId);
  const m = motivoNaoReverterPerda(c);
  if (m) throw new ErroConta(409, m);
  if (p.modo === "RECUPERAR" && !p.recebimento?.data) throw new ErroConta(400, "Informe a data do recebimento.");
  const valorPerda = Number(c.valorPerda ?? 0);
  const r = await tx.contaReceber.updateMany({
    where: { id: c.id, status: "PERDA" },
    // A_RECEBER: a regra única de vencidos (marcarContasReceberVencidas) faz voltar a ATRASADO se já venceu
    data: { status: "A_RECEBER", perdaEm: null, motivoPerda: null, valorPerda: null, perdaPorId: null },
  });
  if (r.count !== 1) throw new ErroConta(409, "A conta mudou enquanto você revertia. Atualize a tela.");
  await tx.contaReceberEvento.create({
    data: {
      empresaId: p.empresaId, contaReceberId: c.id, tipo: "PERDA_REVERTIDA", usuarioId: p.usuarioId ?? null,
      detalhe: [
        `Volta a receber ${formatarMoeda(valorPerda)}`,
        p.modo === "RECUPERAR" ? "cliente pagou (recuperação)" : null,
        (p.motivo ?? "").trim() || null,
      ].filter(Boolean).join(" · "),
    },
  });
  if (p.modo === "RECUPERAR") {
    const rec = await registrarRecebimento(tx, {
      empresaId: p.empresaId, contaId: c.id, valor: p.recebimento!.valor, data: p.recebimento!.data,
      formaPagamento: p.recebimento!.formaPagamento ?? null, contaBancariaId: p.recebimento!.contaBancariaId ?? null,
      origem: "RECUPERACAO", observacao: (p.motivo ?? "").trim() || null, usuarioId: p.usuarioId ?? null,
    });
    return { valorPerda, recebimento: rec };
  }
  return { valorPerda, recebimento: null };
}

/** A medição de onde a cobrança veio (direto ou pelo lançamento da parcela) */
async function medicaoDaCobranca(tx: Tx, c: { medicaoId: string | null; lancamentoId: string | null }) {
  if (c.medicaoId) return c.medicaoId;
  if (!c.lancamentoId) return null;
  const l = await tx.contaReceber.findUnique({ where: { id: c.lancamentoId }, select: { medicaoId: true } });
  return l?.medicaoId ?? null;
}

/**
 * Estorna um recebimento (baixa errada): ele fica no histórico, riscado, com motivo e autor, e sai de todas
 * as somas; o saldo volta a ficar em aberto (a conta recebida volta a "a receber"/"vencida"). Sem
 * `recebimentoId`, estorna a BAIXA ANTIGA (de antes do histórico de recebimentos), gravando-a já estornada.
 * A medição de origem que estava PAGA volta ao passo anterior (NF emitida / boleto gerado / liberada).
 */
export async function estornarRecebimento(tx: Tx, p: { empresaId: string; contaId: string; recebimentoId?: string | null; motivo: string; usuarioId?: string | null }) {
  const invalido = motivoTextoInvalido(p.motivo, "o motivo do estorno");
  if (invalido) throw new ErroConta(400, invalido);
  const motivo = p.motivo.trim().slice(0, 500);
  const c = await contaDaEmpresa(tx, p.empresaId, p.contaId);
  const agora = new Date();
  let valor: number;
  let dataRecebida: Date;

  if (p.recebimentoId) {
    const r = await tx.contaReceberRecebimento.findFirst({ where: { id: p.recebimentoId, contaReceberId: c.id, empresaId: p.empresaId } });
    if (!r) throw new ErroConta(404, "Recebimento não encontrado.");
    const m = motivoNaoEstornar(c, r);
    if (m) throw new ErroConta(409, m);
    // Trava contra estorno duplo (dois cliques, duas abas): só um pedido marca
    const ok = await tx.contaReceberRecebimento.updateMany({
      where: { id: r.id, estornadoEm: null },
      data: { estornadoEm: agora, motivoEstorno: motivo, estornadoPorId: p.usuarioId ?? null },
    });
    if (ok.count !== 1) throw new ErroConta(409, "Este recebimento já foi estornado.");
    valor = Number(r.valor);
    dataRecebida = r.data;
  } else {
    const m = motivoNaoEstornar(c, null);
    if (m) throw new ErroConta(409, m);
    valor = Number(c.valor);
    dataRecebida = c.dataRecebimento ?? c.atualizadoEm;
    // A baixa antiga passa a existir no histórico — já estornada (não entra em soma nenhuma)
    await tx.contaReceberRecebimento.create({
      data: {
        empresaId: p.empresaId, contaReceberId: c.id, valor, data: dataRecebida, formaPagamento: c.formaPagamento,
        contaBancariaId: c.contaBancariaId, origem: "LEGADO", observacao: "Baixa antiga (antes do histórico de recebimentos)",
        estornadoEm: agora, motivoEstorno: motivo, estornadoPorId: p.usuarioId ?? null,
      },
    });
  }

  const recebidoDepois = p.recebimentoId ? reais(Math.max(0, Number(c.valorRecebido) - valor)) : 0;
  const reabre = c.status === "RECEBIDO";
  await tx.contaReceber.update({
    where: { id: c.id },
    data: { valorRecebido: recebidoDepois, ...(reabre && { status: "A_RECEBER", dataRecebimento: null }) },
  });
  const saldo = saldoDaConta({ valor: c.valor, valorRecebido: recebidoDepois, status: reabre ? "A_RECEBER" : c.status });

  // Medição paga por esta cobrança: volta ao passo anterior (a cobrança tem saldo de novo)
  let medicaoReaberta = false;
  const medicaoId = await medicaoDaCobranca(tx, c);
  if (medicaoId) {
    const med = await tx.medicao.findUnique({ where: { id: medicaoId }, select: { status: true, nfNumero: true, boletoUrl: true, avulsa: true } });
    if (med?.status === "PAGO") {
      const anterior = med.boletoUrl ? "BOLETO_GERADO" : med.nfNumero ? "NF_EMITIDA" : med.avulsa ? "PC_RECEBIDO" : "APROVADA";
      await tx.medicao.update({ where: { id: medicaoId }, data: { status: anterior, dataPagamento: null } });
      medicaoReaberta = true;
    }
  }

  await tx.contaReceberEvento.create({
    data: {
      empresaId: p.empresaId, contaReceberId: c.id, tipo: "ESTORNADA", usuarioId: p.usuarioId ?? null,
      detalhe: [
        `Estorno de ${formatarMoeda(valor)} (recebido em ${formatarData(dataRecebida)})`,
        `volta a faltar ${formatarMoeda(saldo)}`,
        medicaoReaberta ? "a fatura/medição deixou de estar paga" : null,
        motivo,
      ].filter(Boolean).join(" · "),
    },
  });
  return { valor, saldo, medicaoReaberta };
}

/** Perdas do cliente nos últimos 12 meses (alerta informativo no cadastro e antes de atender) */
export async function perdasRecentesDoCliente(clienteId: string, empresaId: string, agora = new Date(), db: Db = prisma) {
  const agg = await db.contaReceber.aggregate({
    where: { empresaId, clienteId, status: "PERDA", excluidaEm: null, perdaEm: { gte: inicioJanelaPerdas(agora) } },
    _sum: { valorPerda: true }, _count: true, _max: { perdaEm: true },
  });
  return { qtd: agg._count, valor: reais(Number(agg._sum.valorPerda ?? 0)), ultimaEm: agg._max.perdaEm };
}

/** Perdas marcadas no período (fluxo de caixa "Perdas do mês" e relatório), pela data da marcação */
export async function perdasNoPeriodo(empresaId: string, faixa: { gte: Date; lt?: Date; lte?: Date }, db: Db = prisma) {
  const agg = await db.contaReceber.aggregate({
    where: { empresaId, status: "PERDA", excluidaEm: null, perdaEm: faixa },
    _sum: { valorPerda: true }, _count: true,
  });
  return { valor: reais(Number(agg._sum.valorPerda ?? 0)), qtd: agg._count };
}

/**
 * Relatório "Perdas por período e cliente": as cobranças em perda marcadas no período (pela data da
 * marcação), agrupadas por cliente, e a lista (mais recentes primeiro, até 500).
 */
export async function relatorioPerdas(empresaId: string, faixa: { gte?: Date | null; lt?: Date | null }, db: Db = prisma) {
  const perdaEm = { ...(faixa.gte && { gte: faixa.gte }), ...(faixa.lt && { lt: faixa.lt }) };
  const where: Prisma.ContaReceberWhereInput = { empresaId, status: "PERDA", excluidaEm: null, ...(faixa.gte || faixa.lt ? { perdaEm } : {}) };
  const [linhas, porCliente, total] = await Promise.all([
    db.contaReceber.findMany({
      where, orderBy: [{ perdaEm: "desc" }, { numero: "asc" }], take: 500,
      select: {
        id: true, numero: true, descricao: true, valor: true, valorRecebido: true, valorPerda: true, perdaEm: true, motivoPerda: true, dataVencimento: true,
        clienteId: true, cliente: { select: { nome: true, nomeFantasia: true } }, perdaPor: { select: { nome: true } },
      },
    }),
    db.contaReceber.groupBy({ by: ["clienteId"], where, _sum: { valorPerda: true }, _count: { _all: true }, orderBy: { _sum: { valorPerda: "desc" } } }),
    db.contaReceber.aggregate({ where, _sum: { valorPerda: true }, _count: true }),
  ]);
  const nomes = new Map((await db.cliente.findMany({ where: { id: { in: porCliente.map((g) => g.clienteId) }, empresaId }, select: { id: true, nome: true, nomeFantasia: true } }))
    .map((c) => [c.id, c.nomeFantasia ?? c.nome]));
  return {
    total: { valor: reais(Number(total._sum.valorPerda ?? 0)), qtd: total._count, clientes: porCliente.length },
    clientes: porCliente.map((g) => ({ clienteId: g.clienteId, nome: nomes.get(g.clienteId) ?? "—", qtd: g._count._all, valor: reais(Number(g._sum.valorPerda ?? 0)) })),
    linhas: linhas.map((l) => ({
      id: l.id, numero: l.numero, descricao: l.descricao, cliente: l.cliente.nomeFantasia ?? l.cliente.nome, clienteId: l.clienteId,
      valor: Number(l.valor), recebido: Number(l.valorRecebido), valorPerda: Number(l.valorPerda ?? 0),
      perdaEm: l.perdaEm, motivo: l.motivoPerda, vencimento: l.dataVencimento, por: l.perdaPor?.nome ?? null,
    })),
  };
}
