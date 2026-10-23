import { prisma } from "@/lib/prisma";
import { gerarNumeroContaReceber, gerarNumeroContaPagar, gerarNumeroMedicao } from "@/lib/utils";
import { calcularVencimento } from "@/lib/medicao-helpers";

/**
 * Cria (de forma idempotente) uma conta a receber a partir de uma medição.
 * Se já existir conta vinculada à medição, retorna a existente.
 */
export async function gerarContaReceberDaMedicao(medicaoId: string) {
  const medicao = await prisma.medicao.findUnique({
    where: { id: medicaoId },
    include: { cliente: { select: { cpfCnpj: true } } },
  });
  if (!medicao) return null;

  // Status da conta acompanha o estágio da medição: se a NF já foi emitida,
  // a conta já está liberada para recebimento (corrige o perfil AUTOMATICO,
  // que cria a medição direto em NF_EMITIDA).
  const status =
    medicao.status === "PAGO" ? "RECEBIDO" :
    medicao.status === "NF_EMITIDA" || medicao.status === "BOLETO_GERADO" ? "A_RECEBER" :
    "PREVISTO";

  // C6/D3: a previsão do contrato JÁ É a conta da medição mensal — promove em vez de criar
  // outra (fim da cobrança em dobro PREVISTO × medição). Quando for uma só, o valor passa a
  // ser o da medição (cobre desconto e adicionais consolidados).
  const vinculadas = await prisma.contaReceber.findMany({
    where: { medicaoId, status: { notIn: ["RECEBIDO", "CANCELADO"] } },
    orderBy: { criadoEm: "asc" },
  });
  if (vinculadas.length > 0) {
    for (const c of vinculadas) {
      await prisma.contaReceber.update({
        where: { id: c.id },
        data: {
          status,
          dataVencimento: medicao.dataVencimento ?? c.dataVencimento,
          ...(vinculadas.length === 1 ? { valor: medicao.valorLiquido } : {}),
        },
      });
    }
    return prisma.contaReceber.findFirst({ where: { medicaoId }, orderBy: { criadoEm: "asc" } });
  }
  const jaRecebida = await prisma.contaReceber.findFirst({ where: { medicaoId } });
  if (jaRecebida) return jaRecebida;

  // Medição mensal de contrato sem conta ligada ainda: ADOTA a previsão da competência
  // (contrato + mês/ano) em vez de criar uma segunda conta para o mesmo mês.
  if (medicao.contratoId && medicao.mes && medicao.ano) {
    const previsao = await prisma.contaReceber.findFirst({
      where: { contratoId: medicao.contratoId, refAno: medicao.ano, refMes: medicao.mes, status: "PREVISTO", medicaoId: null },
    });
    if (previsao) {
      return prisma.contaReceber.update({
        where: { id: previsao.id },
        data: { medicaoId: medicao.id, status, valor: medicao.valorLiquido, dataVencimento: medicao.dataVencimento ?? previsao.dataVencimento },
      });
    }
  }

  const ano = medicao.ano ?? new Date().getFullYear();
  const numero = await proximoNumeroContaReceber(medicao.empresaId, ano);

  return prisma.contaReceber.create({
    data: {
      empresaId: medicao.empresaId,
      clienteId: medicao.clienteId,
      medicaoId: medicao.id,
      contratoId: medicao.contratoId ?? null,
      refMes: medicao.contratoId ? medicao.mes : null,
      refAno: medicao.contratoId ? medicao.ano : null,
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
  // CO3: proposta de CONTRATO assinada não vira conta avulsa — quem fatura o contrato são as
  // previsões mensais criadas quando o contrato é gerado (senão o mesmo dinheiro entra 2×).
  if (orcamento.tipo === "PROPOSTA_CONTRATO") return null;

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
    include: { ordemServico: { include: { cliente: true } }, medicao: { select: { id: true, status: true } } },
  });
  if (!relatorio) return null;
  // F3: relatório COMUM de atividade aprovado NÃO fatura nada (a medição de R$ 0 que ele
  // criava, de tipo mensal, calava o gerar-mes e a mensalidade do mês sumia em silêncio).
  if (relatorio.escopo !== "MEDICAO_COMPLETA") return null;
  const valorFinanceiro = relatorio.valorFinanceiro ? Number(relatorio.valorFinanceiro) : 0;
  if (valorFinanceiro <= 0) return null;
  // Medição VIVA já vinculada → devolve; CANCELADA → cria outra no lugar (F4)
  if (relatorio.medicaoId && relatorio.medicao && relatorio.medicao.status !== "CANCELADA") {
    return prisma.medicao.findUnique({ where: { id: relatorio.medicaoId } });
  }

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
      // Medição de contrato é a mensalidade (MENSAL_FIXO); sem contrato é serviço avulso
      // (ADICIONAL) e NÃO pode calar o gerar-mes da mensalidade do cliente (F3/I25)
      tipo: relatorio.contratoId ? "MENSAL_FIXO" : "ADICIONAL",
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
/**
 * CO2: só contrato ATIVO movimenta o financeiro e a recorrência. Cancelado, vencido,
 * em renovação, aguardando assinatura, suspenso ou encerrado NÃO geram previsão nem OS.
 */
export function contratoGeraFinanceiro(status: string | null | undefined): boolean {
  return status === "ATIVO";
}

/**
 * CO4: competências (mês/ano) cobradas pela vigência. A regra é a do aniversário:
 * um mês de referência conta enquanto o aniversário do início naquele mês for ANTERIOR
 * ao fim — assim "01/01 a 01/01 do ano seguinte" e "01/01 a 31/12" são ambos 12 meses.
 * Vigência indeterminada: 12 meses a partir de hoje.
 */
export function competenciasDoContrato(dataInicio: Date, dataFim: Date | null): { ano: number; mes: number }[] {
  const inicio = new Date(dataInicio);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const fim = dataFim ? new Date(dataFim) : addMonths(hoje, 13); // sem fim: ~12 meses à frente
  const out: { ano: number; mes: number }[] = [];
  for (let k = 0; k < 120; k++) {
    const ref = addMonths(inicio, k); // dia 1 do mês de referência
    const aniversario = diaDoMes(ref.getFullYear(), ref.getMonth(), inicio.getDate());
    if (aniversario >= fim) break;
    out.push({ ano: ref.getFullYear(), mes: ref.getMonth() + 1 });
  }
  return out;
}

/**
 * Gera (de forma idempotente) a previsão de contas a receber de um contrato.
 * D3: a cobrança do contrato é SEMPRE mensal (valor fixo por mês), independente da
 * frequência das visitas (CO1). C6: cada previsão nasce LIGADA ao contrato e à
 * competência (uma por contrato × mês — unique no banco). Só contrato ATIVO gera (CO2).
 * Cria apenas competências de hoje em diante. Retorna a quantidade criada.
 */
export async function gerarPrevisaoContratoContasReceber(contratoId: string): Promise<number> {
  const contrato = await prisma.contrato.findUnique({
    where: { id: contratoId },
    include: { cliente: { select: { cpfCnpj: true } } },
  });
  if (!contrato) return 0;
  const valor = contrato.valorMensal ? Number(contrato.valorMensal) : 0;
  if (valor <= 0) return 0;
  if (!contratoGeraFinanceiro(contrato.status)) return 0;

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diaFat = contrato.diaFaturamento ?? contrato.diaFixoMes ?? contrato.diaVencimento ?? 1;
  const base = `${contrato.descricaoNFSe?.trim() || `Contrato ${contrato.numero}`}`;

  // Categoria "Contrato": ligada por ID quando a empresa tem uma categoria ATIVA com esse nome
  // (mesma regra da migração: nome exato); senão fica só o texto, como sempre foi.
  const catContrato = await prisma.categoriaFinanceira.findFirst({
    where: { empresaId: contrato.empresaId, nome: "Contrato", ativo: true }, orderBy: { criadoEm: "asc" }, select: { id: true },
  });

  let criadas = 0;
  for (const { ano, mes } of competenciasDoContrato(contrato.dataInicio, contrato.dataFim)) {
    const mes0 = mes - 1;
    // Da competência CORRENTE em diante (o mês atual ainda vai ser faturado pelo gerar-mes;
    // meses já passados não nascem)
    if (ano < hoje.getFullYear() || (ano === hoje.getFullYear() && mes0 < hoje.getMonth())) continue;
    const dataFaturamento = diaDoMes(ano, mes0, diaFat);

    // Vencimento
    let venc: Date;
    if (contrato.tipoVencimento === "DIA_FIXO_MES" && contrato.diaFixoMes) {
      venc = diaDoMes(ano, mes0, contrato.diaFixoMes);
    } else {
      venc = addDays(dataFaturamento, contrato.diasAposVencimento ?? 0);
    }
    venc = ajustarFimDeSemana(venc, contrato.ajusteFinsDeSemana);

    const tag = `${ano}${String(mes).padStart(2, "0")}`;
    const numero = `${contrato.numero}/${tag}`;

    // Idempotência: pela competência ligada (C6) e, para dados antigos, pelo numero
    const existente = await prisma.contaReceber.findFirst({
      where: {
        OR: [
          { contratoId: contrato.id, refAno: ano, refMes: mes },
          { empresaId: contrato.empresaId, clienteId: contrato.clienteId, numero },
        ],
      },
      select: { id: true, status: true, medicaoId: true },
    });
    if (existente) {
      // Contrato reativado (CO2): a previsão cancelada no encerramento REVIVE — não nasce
      // uma segunda linha (a competência é única por contrato).
      if (existente.status === "CANCELADO" && !existente.medicaoId) {
        await prisma.contaReceber.update({ where: { id: existente.id }, data: { status: "PREVISTO", valor, dataVencimento: venc } });
        criadas++;
      }
      continue;
    }

    await prisma.contaReceber.create({
      data: {
        empresaId: contrato.empresaId,
        clienteId: contrato.clienteId,
        contratoId: contrato.id,
        refAno: ano,
        refMes: mes,
        numero,
        descricao: `${base} — Ref. ${String(mes).padStart(2, "0")}/${ano}`,
        valor,
        status: "PREVISTO",
        dataVencimento: venc,
        categoria: "Contrato",
        categoriaId: catContrato?.id ?? null,
        clienteCnpj: contrato.cliente?.cpfCnpj ?? null,
      },
    });
    criadas++;
  }

  return criadas;
}

/**
 * CO2: quando o contrato deixa de estar ATIVO (cancelado, encerrado, suspenso, vencido…),
 * a receita fantasma é limpa: cancela as previsões (PREVISTO) ainda não faturadas do
 * contrato e as OS AGENDADAS futuras e intocadas (sem execução e sem financeiro).
 * Nada recebido/faturado é alterado. Retorna o que foi cancelado.
 */
export async function encerrarFinanceiroDoContrato(contratoId: string, motivo = "Contrato deixou de estar ativo", usuarioId?: string) {
  const agora = new Date();
  const previsoes = await prisma.contaReceber.updateMany({
    where: { contratoId, status: "PREVISTO", medicaoId: null },
    data: { status: "CANCELADO", observacao: motivo },
  });

  // OS futuras e intocadas: AGENDADA, nenhuma atividade fora de AGENDADA, nenhuma atividade
  // passada, nada no financeiro (a trava osJaFaturada é por medição viva — aqui basta nenhum item)
  const candidatas = await prisma.ordemServico.findMany({
    where: {
      contratoId,
      status: "AGENDADA",
      medicaoItens: { none: {} },
      atividades: { none: { OR: [{ status: { not: "AGENDADA" } }, { dataAgendada: { lt: agora } }] } },
    },
    select: { id: true },
  });
  for (const os of candidatas) {
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CANCELADA" } });
    if (usuarioId) {
      await prisma.osHistorico.create({
        data: { ordemServicoId: os.id, usuarioId, acao: "OS cancelada", detalhes: motivo },
      });
    }
  }
  return { previsoesCanceladas: previsoes.count, osCanceladas: candidatas.length };
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

/** Nome para comparar fornecedores: minúsculas, sem espaços nas pontas nem repetidos (igual ao SQL). */
export const normalizarNome = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

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
  // Liga ao cadastro quando o nome do item bate com um fornecedor ATIVO da empresa (mesma regra da
  // migração: maiúsculas e espaços não contam); senão fica só o texto, como sempre foi.
  const cadastrado = (await prisma.fornecedor.findMany({ where: { empresaId: pedido.empresaId, ativo: true }, select: { id: true, nome: true, documento: true } }))
    .find((f) => normalizarNome(f.nome) === normalizarNome(fornecedor));
  const ano = new Date().getFullYear();
  const numero = await proximoNumeroContaPagar(pedido.empresaId, ano);

  return prisma.contaPagar.create({
    data: {
      empresaId: pedido.empresaId,
      numero,
      fornecedor: cadastrado?.nome ?? fornecedor,
      fornecedorId: cadastrado?.id ?? null,
      fornecedorCnpj: cadastrado?.documento ?? null,
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

/**
 * Marca como ATRASADO as contas a receber LIBERADAS (A_RECEBER) vencidas. PREVISTO não
 * vira ATRASADO (C6/F5): previsão de contrato ainda não faturada não é cobrança vencida —
 * era isso que marcava o cliente como inadimplente e enchia o portal de "boletos vencidos".
 * Único lugar da regra: dashboard e lista usam esta função.
 */
export async function marcarContasReceberVencidas(empresaId: string) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return prisma.contaReceber.updateMany({
    where: { empresaId, status: "A_RECEBER", dataVencimento: { lt: hoje } },
    data: { status: "ATRASADO" },
  });
}

/** Agregações para o dashboard financeiro: cards do mês, série de 6 meses e alertas. */
export async function resumoFinanceiro(empresaId: string) {
  const agora = new Date();
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59, 999);
  const hojeIni = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);
  const hojeFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59, 999);
  const tresDias = new Date(hojeIni.getTime() - 3 * 86400000);

  // Marca contas vencidas (receber e pagar)
  await marcarContasReceberVencidas(empresaId);
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
