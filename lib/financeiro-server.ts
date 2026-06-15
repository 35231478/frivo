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
export async function proximoNumeroContaReceber(empresaId: string, ano: number) {
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
// CONTRATOS → PREVISÃO DE CONTAS A RECEBER
// ─────────────────────────────────────────────

function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function diaDoMes(ano: number, mes0: number, dia: number): Date {
  const ultimo = new Date(ano, mes0 + 1, 0).getDate();
  return new Date(ano, mes0, Math.min(dia, ultimo));
}
/** Ajusta uma data que cai no fim de semana conforme o tratamento escolhido. */
function ajustarFimDeSemana(d: Date, modo: string | null | undefined): Date {
  const wd = d.getDay(); // 0=dom, 6=sáb
  if (modo === "ADIANTAR") { if (wd === 6) return addDays(d, -1); if (wd === 0) return addDays(d, -2); }
  else if (modo === "POSTERGAR") { if (wd === 6) return addDays(d, 2); if (wd === 0) return addDays(d, 1); }
  return d;
}
const PASSO_PERIODICIDADE: Record<string, number> = {
  SEMANAL: 1, QUINZENAL: 1, MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12,
};

/**
 * Gera (de forma idempotente) a previsão de contas a receber de um contrato.
 * Cria uma conta PREVISTO por período de faturamento, apenas para datas futuras
 * (de hoje em diante), até o fim da vigência ou, se indeterminada, +12 meses.
 * Não duplica períodos já gerados (chave: numero "<contrato>/AAAAMM").
 * Retorna a quantidade de contas criadas.
 */
export async function gerarPrevisaoContratoContasReceber(contratoId: string): Promise<number> {
  const contrato = await prisma.contrato.findUnique({
    where: { id: contratoId },
    include: { cliente: { select: { cpfCnpj: true } } },
  });
  if (!contrato) return 0;
  const valor = contrato.valorMensal ? Number(contrato.valorMensal) : 0;
  if (valor <= 0) return 0;
  if (contrato.status === "ENCERRADO" || contrato.status === "SUSPENSO") return 0;

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const inicio = new Date(contrato.dataInicio);
  const fim = contrato.dataFim ? new Date(contrato.dataFim) : addMonths(hoje, 12);
  const passo = PASSO_PERIODICIDADE[contrato.periodicidade] ?? 1;

  const diaFat = contrato.diaFaturamento ?? contrato.diaFixoMes ?? contrato.diaVencimento ?? 1;
  const base = `${contrato.descricaoNFSe?.trim() || `Contrato ${contrato.numero}`}`;

  let criadas = 0;
  for (let k = 0; k < 120; k++) {
    const refMes = addMonths(inicio, k * passo);
    if (refMes > fim) break;
    const ano = refMes.getFullYear();
    const mes0 = refMes.getMonth();

    const dataFaturamento = diaDoMes(ano, mes0, diaFat);
    if (dataFaturamento < hoje) continue; // apenas futuras

    // Vencimento
    let venc: Date;
    if (contrato.tipoVencimento === "DIA_FIXO_MES" && contrato.diaFixoMes) {
      venc = diaDoMes(ano, mes0, contrato.diaFixoMes);
    } else {
      venc = addDays(dataFaturamento, contrato.diasAposVencimento ?? 0);
    }
    venc = ajustarFimDeSemana(venc, contrato.ajusteFinsDeSemana);

    const tag = `${ano}${String(mes0 + 1).padStart(2, "0")}`;
    const numero = `${contrato.numero}/${tag}`;

    const existente = await prisma.contaReceber.findFirst({
      where: { empresaId: contrato.empresaId, clienteId: contrato.clienteId, numero },
      select: { id: true },
    });
    if (existente) continue;

    await prisma.contaReceber.create({
      data: {
        empresaId: contrato.empresaId,
        clienteId: contrato.clienteId,
        numero,
        descricao: `${base} — Ref. ${String(mes0 + 1).padStart(2, "0")}/${ano}`,
        valor,
        status: "PREVISTO",
        dataVencimento: venc,
        categoria: "Contrato",
        clienteCnpj: contrato.cliente?.cpfCnpj ?? null,
      },
    });
    criadas++;
  }

  return criadas;
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
