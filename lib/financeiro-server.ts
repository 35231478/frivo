import { prisma } from "@/lib/prisma";
import { gerarNumeroContaReceber, gerarNumeroContaPagar, gerarNumeroMedicao } from "@/lib/utils";
import { calcularVencimento } from "@/lib/medicao-helpers";

/**
 * Cria (de forma idempotente) uma conta a receber a partir de uma medição.
 * Se já existir conta vinculada à medição, retorna a existente.
 */
export async function gerarContaReceberDaMedicao(medicaoId: string) {
  const existente = await prisma.contaReceber.findFirst({ where: { medicaoId } });
  if (existente) return existente;

  const medicao = await prisma.medicao.findUnique({
    where: { id: medicaoId },
    include: { cliente: { select: { cpfCnpj: true } } },
  });
  if (!medicao) return null;

  const ano = medicao.ano ?? new Date().getFullYear();
  const numero = await proximoNumeroContaReceber(medicao.empresaId, ano);

  // Status da conta acompanha o estágio da medição: se a NF já foi emitida,
  // a conta já está liberada para recebimento (corrige o perfil AUTOMATICO,
  // que cria a medição direto em NF_EMITIDA).
  const status =
    medicao.status === "PAGO" ? "RECEBIDO" :
    medicao.status === "NF_EMITIDA" || medicao.status === "BOLETO_GERADO" ? "A_RECEBER" :
    "PREVISTO";

  return prisma.contaReceber.create({
    data: {
      empresaId: medicao.empresaId,
      clienteId: medicao.clienteId,
      medicaoId: medicao.id,
      numero,
      descricao: medicao.descricao || `Medição ${medicao.numero}`,
      valor: medicao.valorLiquido,
      status,
      dataVencimento: medicao.dataVencimento,
      clienteCnpj: medicao.cliente?.cpfCnpj ?? null,
    },
  });
}

/** Próximo número sequencial de conta a receber (CR-AAAA-NNNN) baseado no maior do ano. */
async function proximoNumeroContaReceber(empresaId: string, ano: number) {
  const ultimo = await prisma.contaReceber.findFirst({
    where: { empresaId, numero: { startsWith: `CR-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = ultimo ? Number(ultimo.numero.split("-")[2]) + 1 : 1;
  return gerarNumeroContaReceber(seq, ano);
}

/**
 * Cria (de forma idempotente) uma conta a receber a partir de um orçamento aprovado.
 */
export async function gerarContaReceberDoOrcamento(orcamentoId: string) {
  const existente = await prisma.contaReceber.findFirst({ where: { orcamentoId } });
  if (existente) return existente;

  const orcamento = await prisma.orcamento.findUnique({ where: { id: orcamentoId } });
  if (!orcamento) return null;

  const numero = await proximoNumeroContaReceber(orcamento.empresaId, new Date().getFullYear());

  return prisma.contaReceber.create({
    data: {
      empresaId: orcamento.empresaId,
      clienteId: orcamento.clienteId,
      orcamentoId: orcamento.id,
      numero,
      descricao: `Orçamento ${orcamento.codigo} — ${orcamento.nome}`,
      valor: orcamento.totalGeral,
      status: "PREVISTO",
      dataVencimento: orcamento.validadeEm,
    },
  });
}

/**
 * Cria (de forma idempotente) uma medição financeira a partir de um relatório
 * aprovado. O status segue o perfil de faturamento do cliente:
 * - COM_APROVACAO (perfil 1) → AGUARDANDO_PC
 * - AUTOMATICO (perfil 2)    → NF_EMITIDA (preparado para integração de NF)
 * - FATURA_UNICA (perfil 3)  → RASCUNHO (aguarda agrupamento do mês)
 * - sem perfil               → PC_RECEBIDO (libera NF)
 */
export async function criarMedicaoDeRelatorio(relatorioId: string) {
  const relatorio = await prisma.relatorioOs.findUnique({
    where: { id: relatorioId },
    include: { ordemServico: { include: { cliente: true } } },
  });
  if (!relatorio) return null;
  if (relatorio.medicaoId) return prisma.medicao.findUnique({ where: { id: relatorio.medicaoId } });

  const cliente = relatorio.ordemServico.cliente;
  const perfil = cliente.tipoFaturamento;
  const status =
    perfil === "COM_APROVACAO" ? "AGUARDANDO_PC" :
    perfil === "AUTOMATICO" ? "NF_EMITIDA" :
    perfil === "FATURA_UNICA" ? "RASCUNHO" :
    "PC_RECEBIDO";

  const valor = relatorio.valorFinanceiro ? Number(relatorio.valorFinanceiro) : 0;
  const ultimaMed = await prisma.medicao.findFirst({
    where: { empresaId: relatorio.empresaId, numero: { startsWith: `MED-${relatorio.anoReferencia}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = ultimaMed ? Number(ultimaMed.numero.split("-")[2]) + 1 : 1;
  const numero = gerarNumeroMedicao(seq, relatorio.anoReferencia);
  const vencimento = calcularVencimento(cliente.diaFaturamento, relatorio.mesReferencia, relatorio.anoReferencia);

  const medicao = await prisma.medicao.create({
    data: {
      empresaId: relatorio.empresaId,
      clienteId: relatorio.ordemServico.clienteId,
      contratoId: relatorio.contratoId,
      numero,
      tipo: "MENSAL_FIXO",
      mes: relatorio.mesReferencia,
      ano: relatorio.anoReferencia,
      descricao: `Relatório ${relatorio.numero}`,
      status: status as any,
      valorTotal: valor,
      valorLiquido: valor,
      dataAprovacao: new Date(),
      dataVencimento: vencimento,
      tokenPublico: crypto.randomUUID(),
      itens: {
        create: [{
          tipo: "SERVICO",
          descricao: `Serviço do período — ${relatorio.numero}`,
          quantidade: 1,
          valorUnitario: valor,
          valorTotal: valor,
          ordem: 0,
        }],
      },
    },
  });

  await prisma.relatorioOs.update({ where: { id: relatorioId }, data: { medicaoId: medicao.id } });

  // Gera conta a receber, exceto quando aguarda agrupamento (perfil fatura única)
  if (perfil !== "FATURA_UNICA") {
    await gerarContaReceberDaMedicao(medicao.id);
  }

  return medicao;
}

// ─────────────────────────────────────────────
// CONTAS A PAGAR
// ─────────────────────────────────────────────

/** Próximo número sequencial de conta a pagar (CP-AAAA-NNNN). */
export async function proximoNumeroContaPagar(empresaId: string, ano: number) {
  const ultimo = await prisma.contaPagar.findFirst({
    where: { empresaId, numero: { startsWith: `CP-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = ultimo ? Number(ultimo.numero.split("-")[2]) + 1 : 1;
  return gerarNumeroContaPagar(seq, ano);
}

/** Recalcula valorPago, saldoRestante, status e dataPagamento a partir dos pagamentos. */
export async function recalcularContaPagar(contaPagarId: string) {
  const conta = await prisma.contaPagar.findUnique({
    where: { id: contaPagarId },
    include: { pagamentos: { orderBy: { dataPagamento: "desc" } } },
  });
  if (!conta) return null;
  if (conta.status === "CANCELADO") return conta;

  const valorTotal = Number(conta.valorTotal);
  const valorPago = conta.pagamentos.reduce((s, p) => s + Number(p.valor), 0);
  const saldoRestante = Math.max(0, valorTotal - valorPago);
  const venceu = conta.dataVencimento && new Date(conta.dataVencimento) < new Date();

  let status: "PENDENTE" | "PAGO_PARCIAL" | "PAGO_TOTAL" | "VENCIDO";
  if (saldoRestante <= 0.001) status = "PAGO_TOTAL";
  else if (valorPago > 0) status = "PAGO_PARCIAL";
  else status = venceu ? "VENCIDO" : "PENDENTE";

  return prisma.contaPagar.update({
    where: { id: contaPagarId },
    data: {
      valorPago,
      saldoRestante,
      status,
      dataPagamento: status === "PAGO_TOTAL" ? (conta.pagamentos[0]?.dataPagamento ?? new Date()) : null,
    },
  });
}

/** Cria (idempotente) uma conta a pagar a partir de um pedido de compra interno. */
export async function gerarContaPagarDoPedido(pedidoCompraId: string) {
  const existente = await prisma.contaPagar.findFirst({ where: { pedidoCompraId } });
  if (existente) return existente;

  const pedido = await prisma.pedidoCompraInterno.findUnique({
    where: { id: pedidoCompraId },
    include: { itens: true },
  });
  if (!pedido) return null;

  const valorTotal = pedido.itens.reduce(
    (s, i) => s + Number(i.valorReal ?? i.valorEstimado ?? 0) * Number(i.quantidade ?? 1),
    0,
  );
  const fornecedor = pedido.itens.find((i) => i.fornecedor)?.fornecedor ?? "Fornecedor a definir";
  const ano = new Date().getFullYear();
  const numero = await proximoNumeroContaPagar(pedido.empresaId, ano);

  return prisma.contaPagar.create({
    data: {
      empresaId: pedido.empresaId,
      numero,
      fornecedor,
      descricao: `Pedido de compra ${pedido.numero}`,
      valorTotal,
      valorPago: 0,
      saldoRestante: valorTotal,
      status: "PENDENTE",
      dataVencimento: pedido.prazoNecessario,
      pedidoCompraId: pedido.id,
    },
  });
}

// ─────────────────────────────────────────────
// DASHBOARD FINANCEIRO
// ─────────────────────────────────────────────

/** Agregações para o dashboard financeiro: cards do mês, série de 6 meses e alertas. */
export async function resumoFinanceiro(empresaId: string) {
  const agora = new Date();
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59, 999);
  const hojeIni = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
  const hojeFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59, 999);
  const tresDias = new Date(hojeIni.getTime() - 3 * 86400000);

  // Marca contas vencidas (receber e pagar)
  await prisma.contaReceber.updateMany({
    where: { empresaId, status: { in: ["PREVISTO", "A_RECEBER"] }, dataVencimento: { lt: hojeIni } },
    data: { status: "ATRASADO" },
  });
  await prisma.contaPagar.updateMany({
    where: { empresaId, status: "PENDENTE", dataVencimento: { lt: hojeIni } },
    data: { status: "VENCIDO" },
  });

  const naoRecebido: any[] = ["PREVISTO", "A_RECEBER", "ATRASADO"];
  const naoPago: any[] = ["PENDENTE", "PAGO_PARCIAL", "VENCIDO"];

  const [
    aReceberMes, recebidoMes, vencidoReceber, aPagarMesAgg, pagasVencidas,
    vencemHojeReceber, vencemHojePagar,
  ] = await Promise.all([
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: naoRecebido }, dataVencimento: { gte: inicioMes, lte: fimMes } }, _sum: { valor: true }, _count: true }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: "RECEBIDO", dataRecebimento: { gte: inicioMes, lte: fimMes } }, _sum: { valor: true }, _count: true }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: "ATRASADO" }, _sum: { valor: true }, _count: true }),
    prisma.contaPagar.aggregate({ where: { empresaId, status: { in: naoPago }, dataVencimento: { gte: inicioMes, lte: fimMes } }, _sum: { saldoRestante: true }, _count: true }),
    prisma.contaPagar.aggregate({ where: { empresaId, status: "VENCIDO" }, _sum: { saldoRestante: true }, _count: true }),
    prisma.contaReceber.count({ where: { empresaId, status: { in: naoRecebido }, dataVencimento: { gte: hojeIni, lte: hojeFim } } }),
    prisma.contaPagar.count({ where: { empresaId, status: { in: naoPago }, dataVencimento: { gte: hojeIni, lte: hojeFim } } }),
  ]);

  // Vencidas há +3 dias sem notificação (receber)
  const semNotificacao = await prisma.contaReceber.count({
    where: { empresaId, status: "ATRASADO", dataVencimento: { lt: tresDias }, notificacaoEnviadaEm: null },
  });

  // Série de 6 meses (entradas recebidas x saídas pagas)
  const meses: { mes: string; entradas: number; saidas: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const ini = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const fim = new Date(agora.getFullYear(), agora.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const [ent, sai] = await Promise.all([
      prisma.contaReceber.aggregate({ where: { empresaId, status: "RECEBIDO", dataRecebimento: { gte: ini, lte: fim } }, _sum: { valor: true } }),
      prisma.pagamentoContaPagar.aggregate({ where: { contaPagar: { empresaId }, dataPagamento: { gte: ini, lte: fim } }, _sum: { valor: true } }),
    ]);
    meses.push({
      mes: ini.toLocaleDateString("pt-BR", { month: "short" }),
      entradas: Number(ent._sum.valor ?? 0),
      saidas: Number(sai._sum.valor ?? 0),
    });
  }

  const num = (v: any) => Number(v ?? 0);
  const totalAReceberMes = num(aReceberMes._sum?.valor);
  const totalAPagarMes = num(aPagarMesAgg._sum?.saldoRestante);

  return {
    aReceberMes: { valor: totalAReceberMes, qtd: aReceberMes._count },
    recebidoMes: { valor: num(recebidoMes._sum?.valor), qtd: recebidoMes._count },
    vencidoReceber: { valor: num(vencidoReceber._sum?.valor), qtd: vencidoReceber._count },
    aPagarMes: { valor: totalAPagarMes, qtd: aPagarMesAgg._count },
    pagasVencidas: { valor: num(pagasVencidas._sum?.saldoRestante), qtd: pagasVencidas._count },
    saldoPrevisto: totalAReceberMes - totalAPagarMes,
    meses,
    alertas: {
      vencemHoje: vencemHojeReceber + vencemHojePagar,
      vencemHojeReceber, vencemHojePagar,
      vencidasSemNotificacao: semNotificacao,
    },
  };
}
