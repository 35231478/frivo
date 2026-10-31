/**
 * Filtros (where do Prisma) das listas de OS, Clientes, Orçamentos e Contratos — usados pela
 * página da lista E pela ação em massa ("selecionar todos que batem no filtro"), para os dois
 * nunca divergirem. Sempre começam pelo empresaId da sessão.
 */

import { variantesDocumento } from "@/lib/listagem";
import { hojeDiaCivil, inicioMesDiaCivil, periodoDiaCivil, periodoInstanteBR } from "@/lib/fuso";
import { whereEtapa } from "@/lib/orcamentos/ciclo";
import { faixaDiaCivil, type Periodo } from "@/lib/periodo";

type SP = Record<string, string | undefined>;

export function whereOrdens(empresaId: string, sp: SP) {
  const statusList = (sp.status ?? "").split(",").filter(Boolean);
  const prioridadeList = (sp.prioridade ?? "").split(",").filter(Boolean);
  const where: any = { empresaId };
  // Sem filtro de status, OS inativadas (CANCELADA) ficam fora; o chip "Cancelada" as mostra
  if (statusList.length) where.status = { in: statusList };
  else where.status = { not: "CANCELADA" };
  if (prioridadeList.length) where.prioridade = { in: prioridadeList };
  if (sp.origem) where.origem = sp.origem;
  if (sp.clienteId) where.clienteId = sp.clienteId;
  if (sp.responsavelId) where.responsavelId = sp.responsavelId;
  if (sp.contratoId) where.contratoId = sp.contratoId;
  if (sp.tipoOsId) where.atividades = { some: { tipoOsId: sp.tipoOsId } };
  if (sp.numero) where.numero = { contains: sp.numero, mode: "insensitive" };
  if (sp.data) {
    // Navegação por dia: mostra OS com atividade agendada, previsão de conclusão
    // ou abertura no dia selecionado — o DIA DE BRASÍLIA (instantes) / o dia gravado (previsão)
    const instante = periodoInstanteBR(sp.data, sp.data);
    const dia = periodoDiaCivil(sp.data, sp.data);
    if (instante && dia) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { atividades: { some: { dataAgendada: instante } } },
            { previsaoConclusao: dia },
            { previsaoConclusao: instante }, // previsão gravada com hora (OS do calendário)
            { criadoEm: instante },
          ],
        },
      ];
    }
  } else if (sp.dataInicio || sp.dataFim) {
    where.criadoEm = periodoInstanteBR(sp.dataInicio, sp.dataFim) ?? {};
  }
  if (sp.busca) {
    where.OR = [
      { numero: { contains: sp.busca, mode: "insensitive" } },
      { chamadoNumero: { contains: sp.busca, mode: "insensitive" } },
      { descricao: { contains: sp.busca, mode: "insensitive" } },
      { cliente: { nome: { contains: sp.busca, mode: "insensitive" } } },
    ];
  }
  return where;
}

/** Clientes: o status financeiro é calculado (não é coluna), então volta à parte para filtrar depois. */
export function whereClientes(empresaId: string, sp: SP) {
  const statusFiltro = (["SEM_HISTORICO", "ADIMPLENTE", "INADIMPLENTE"] as const).find((s) => s === sp.status);
  // Por padrão lista apenas ativos; com "Mostrar inativos" inclui os inativos também.
  const where: any = { empresaId, ...(sp.inativos === "1" ? {} : { ativo: true }) };
  if (sp.busca) {
    where.OR = [
      { nome: { contains: sp.busca, mode: "insensitive" } },
      { nomeFantasia: { contains: sp.busca, mode: "insensitive" } },
      { cpfCnpj: { contains: sp.busca } },
      // CNPJ/CPF são gravados com máscara: "11222333" também acha "11.222.333/0001-81"
      ...variantesDocumento(sp.busca).map((v) => ({ cpfCnpj: { contains: v } })),
    ];
  }
  if (sp.segmento) where.segmento = sp.segmento;
  return { where, statusFiltro };
}

/** Status gravado antigo na URL → etapa do ciclo (links antigos continuam funcionando) */
const ETAPA_DO_STATUS: Record<string, string> = { REPROVADO: "RECUSADO", CONVERTIDA: "CONVERTIDO" };

export function whereOrcamentos(empresaId: string, sp: SP, agora = new Date()) {
  const where: any = { empresaId };
  const e: any[] = [];
  // Filtro pela etapa do ciclo (Visualizado/Expirado dependem das datas: lib/orcamentos/ciclo.ts)
  const etapa = sp.status ? ETAPA_DO_STATUS[sp.status] ?? sp.status : "";
  const porEtapa = etapa ? whereEtapa(etapa, hojeDiaCivil(agora)) : null;
  // Cancelado = orçamento inativado: fica fora da lista padrão (filtre o status ou marque "Mostrar cancelados")
  if (porEtapa) e.push(porEtapa);
  else if (sp.inativos !== "1") where.status = { not: "CANCELADO" };
  // Sino: respostas do cliente (aprovou/recusou) que ninguém abriu ainda
  if (sp.resposta === "nova") e.push({ status: { in: ["APROVADO", "REPROVADO"] }, respostaVistaEm: null });
  if (e.length) where.AND = e;
  if (sp.tipo) where.tipo = sp.tipo;
  if (sp.clienteId) where.clienteId = sp.clienteId;
  if (sp.dataInicio || sp.dataFim) {
    where.criadoEm = periodoInstanteBR(sp.dataInicio, sp.dataFim) ?? {};
  }
  if (sp.busca) {
    where.OR = [
      { codigo: { contains: sp.busca, mode: "insensitive" } },
      { nome: { contains: sp.busca, mode: "insensitive" } },
      { cliente: { nome: { contains: sp.busca, mode: "insensitive" } } },
    ];
  }
  return where;
}

export function whereContratos(empresaId: string, sp: SP, agora = new Date()) {
  // Vigência é dia civil: vencido só depois do último dia (em Brasília)
  const hoje = hojeDiaCivil(agora);
  const em30 = hojeDiaCivil(agora, 30);
  const where: any = { empresaId };
  if (sp.busca) {
    where.OR = [
      { numero: { contains: sp.busca, mode: "insensitive" } },
      { cliente: { nome: { contains: sp.busca, mode: "insensitive" } } },
    ];
  }
  if (sp.frequencia) where.periodicidade = sp.frequencia;
  if (sp.clienteId) where.clienteId = sp.clienteId;
  const vigencia = periodoDiaCivil(sp.vigenciaInicio, sp.vigenciaFim);
  if (vigencia) where.dataInicio = vigencia;
  if (sp.valorMin) where.valorMensal = { ...(where.valorMensal ?? {}), gte: Number(sp.valorMin) };
  if (sp.valorMax) where.valorMensal = { ...(where.valorMensal ?? {}), lte: Number(sp.valorMax) };
  // Filtro de status: valores diretos do enum + computados (VENCIDO/VENCENDO)
  const STATUS_ENUM = ["ATIVO", "SUSPENSO", "ENCERRADO", "CANCELADO", "EM_RENOVACAO", "AGUARDANDO_ASSINATURA"];
  if (sp.status && STATUS_ENUM.includes(sp.status)) where.status = sp.status;
  else if (sp.status === "INATIVO") where.status = { in: ["SUSPENSO", "ENCERRADO", "CANCELADO"] };
  else if (sp.status === "VENCIDO") { where.status = { notIn: ["ENCERRADO", "CANCELADO"] }; where.dataFim = { lt: hoje }; }
  else if (sp.status === "VENCENDO") { where.status = "ATIVO"; where.dataFim = { gte: hoje, lte: em30 }; }
  return where;
}

/* ───────── Financeiro (UX-4/E4): o filtro roda no BANCO — nada some por corte de fatia ───────── */

/** Condição Prisma de cada status VISUAL das contas a receber (mesma régua de statusVisualReceber). */
export function condStatusVisualReceber(chave: string, agora = new Date()) {
  // Vencimento é dia civil: "hoje" pelo calendário de Brasília (vence hoje até a meia-noite BR)
  const hoje = hojeDiaCivil(agora);
  const amanha = hojeDiaCivil(agora, 1);
  switch (chave) {
    // Previsão do contrato (ou conta liberada sem data): não é cobrança vencida
    case "PREVISTO": return { OR: [{ status: "PREVISTO" }, { status: { in: ["A_RECEBER", "ATRASADO"] }, dataVencimento: null }] };
    case "A_VENCER": return { status: "A_RECEBER", dataVencimento: { gte: amanha } };
    case "VENCE_HOJE": return { status: "A_RECEBER", dataVencimento: { gte: hoje, lt: amanha } };
    case "VENCIDO": return { OR: [{ status: "ATRASADO" }, { status: "A_RECEBER", dataVencimento: { lt: hoje } }] };
    case "PAGO": return { status: "RECEBIDO" };
    case "CANCELADO": return { status: "CANCELADO" };
    // Baixa parcial: entrou uma parte e ainda falta (o status continua o do vencimento)
    case "PARCIAL": return { status: { in: ["A_RECEBER", "ATRASADO"] }, valorRecebido: { gt: 0 } };
    default: return null;
  }
}

/** Os 4 cartões de resumo de Contas a Receber (sempre sobre o conjunto completo da empresa). */
export function condCardReceber(card: string, agora = new Date()) {
  const inicioMes = inicioMesDiaCivil(agora);
  switch (card) {
    case "A_RECEBER": return { OR: [condStatusVisualReceber("PREVISTO", agora)!, condStatusVisualReceber("A_VENCER", agora)!] };
    case "VENCIDO": return condStatusVisualReceber("VENCIDO", agora);
    case "VENCE_HOJE": return condStatusVisualReceber("VENCE_HOJE", agora);
    case "RECEBIDO": return { status: "RECEBIDO", dataRecebimento: { gte: inicioMes } };
    default: return null;
  }
}

/** where de Contas a Receber a partir da URL (busca, painel de filtros, chips de status e cartão). */
export function whereContasReceber(empresaId: string, sp: SP, agora = new Date()) {
  // Excluída (exclusão lógica) não aparece em lugar nenhum da lista/exportação; a conta PARCELADA
  // (o lançamento) também não — as cobranças dela são as parcelas, que aparecem cada uma na sua linha
  const where: any = { empresaId, excluidaEm: null };
  const and: any[] = [{ status: { not: "PARCELADO" } }];
  const q = (sp.q ?? "").trim();
  if (q) {
    and.push({
      OR: [
        { numero: { contains: q, mode: "insensitive" } },
        { descricao: { contains: q, mode: "insensitive" } },
        { cliente: { OR: [{ nome: { contains: q, mode: "insensitive" } }, { nomeFantasia: { contains: q, mode: "insensitive" } }] } },
      ],
    });
  }
  if (sp.clienteId) where.clienteId = sp.clienteId;
  if (sp.categoria) where.categoriaId = sp.categoria; // por id: renomear não tira do filtro
  if (sp.forma) where.formaPagamento = sp.forma;
  if (sp.banco) where.banco = { contains: sp.banco, mode: "insensitive" };
  if (sp.valorMin) where.valor = { ...(where.valor ?? {}), gte: Number(sp.valorMin) };
  if (sp.valorMax) where.valor = { ...(where.valor ?? {}), lte: Number(sp.valorMax) };
  const venc = periodoDiaCivil(sp.vencDe, sp.vencAte);
  if (venc) where.dataVencimento = { ...(where.dataVencimento ?? {}), ...venc };
  const chips = (sp.status ?? "").split(",").map((s) => condStatusVisualReceber(s, agora)).filter(Boolean);
  if (chips.length) and.push({ OR: chips });
  const card = condCardReceber(sp.card ?? "", agora);
  if (card) and.push(card);
  if (and.length) where.AND = and;
  return where;
}

/* ───────── Contas a Receber: período + cards (padrão da casa) ───────── */

/** Os cards do período de Contas a Receber, na ordem da tela */
export const CARDS_PERIODO_RECEBER = ["VENCIDO", "VENCE_HOJE", "A_VENCER", "RECEBIDO", "TOTAL"] as const;
export type CardPeriodoReceber = (typeof CARDS_PERIODO_RECEBER)[number];

/**
 * Condição de cada card (o período já limita o vencimento): Vencidos · Vencem hoje · A vencer
 * (previsões + a vencer, como o antigo "A receber") · Recebidos · Total (tudo menos as canceladas).
 * "A_RECEBER" (links antigos) = A vencer. Parcela é uma cobrança como outra: a vencida conta em
 * "Vencidos"; o lançamento parcelado fica de fora (CARD_SO_COBRANCAS).
 */
export function condCardPeriodoReceber(card: string, agora = new Date()) {
  switch (card) {
    case "VENCIDO": return condStatusVisualReceber("VENCIDO", agora);
    case "VENCE_HOJE": return condStatusVisualReceber("VENCE_HOJE", agora);
    case "A_VENCER": case "A_RECEBER": return { OR: [condStatusVisualReceber("PREVISTO", agora)!, condStatusVisualReceber("A_VENCER", agora)!] };
    case "RECEBIDO": return { status: "RECEBIDO" };
    case "TOTAL": return { status: { not: "CANCELADO" } };
    default: return null;
  }
}

/** Os cards contam só cobranças: o lançamento parcelado (o total dividido) fica de fora */
export const CARD_SO_COBRANCAS = { status: { not: "PARCELADO" } } as const;

/**
 * O que cada card soma: os abertos pelo SALDO (a baixa parcial conta pelo que falta: valor −
 * valorRecebido); "Recebidos" e "Total" pelo valor das contas.
 */
export const CARD_RECEBER_PELO_SALDO: Record<CardPeriodoReceber, boolean> = {
  VENCIDO: true, VENCE_HOJE: true, A_VENCER: true, RECEBIDO: false, TOTAL: false,
};

/** Condição do período sobre o VENCIMENTO (dia civil); todo o período = sem condição */
export function condPeriodoVencimento(p: Periodo) {
  const faixa = faixaDiaCivil(p);
  return faixa ? { dataVencimento: faixa } : null;
}

/**
 * where da LISTA de Contas a Receber (tela e exportação): os filtros da URL (whereContasReceber,
 * sem o card antigo) + o período pelo vencimento + o card do período clicado.
 */
export function whereListaReceber(empresaId: string, sp: SP, periodo: Periodo, agora = new Date()) {
  const base = whereContasReceber(empresaId, { ...sp, card: undefined }, agora);
  const and: object[] = [...(base.AND ?? [])];
  const per = condPeriodoVencimento(periodo);
  if (per) and.push(per);
  const card = condCardPeriodoReceber(sp.card ?? "", agora);
  if (card) and.push(card);
  return { ...base, ...(and.length ? { AND: and } : {}) };
}

/* ───────── Orçamentos: período + cards de funil (o mesmo padrão das telas financeiras) ───────── */

/** Os cards de funil do período de Orçamentos, na ordem da tela */
export const CARDS_PERIODO_ORCAMENTOS = ["EM_ABERTO", "APROVADO", "RECUSADO", "VENCIDO", "TOTAL"] as const;
export type CardPeriodoOrcamentos = (typeof CARDS_PERIODO_ORCAMENTOS)[number];

/**
 * where de um card de funil (a validade é dia civil de Brasília, como no ciclo):
 * Em aberto = enviado ainda na validade (visto ou não); Aprovados inclui os que já viraram contrato;
 * Vencidos = enviado com a validade vencida sem resposta; Total = todos menos os cancelados.
 */
export function condCardPeriodoOrcamentos(card: string, agora = new Date()) {
  const hoje = hojeDiaCivil(agora);
  switch (card) {
    case "EM_ABERTO": return { status: "ENVIADO", OR: [{ validadeEm: null }, { validadeEm: { gte: hoje } }] };
    case "APROVADO": return { status: { in: ["APROVADO", "CONVERTIDA"] } };
    case "RECUSADO": return { status: "REPROVADO" };
    case "VENCIDO": return { status: "ENVIADO", validadeEm: { lt: hoje } };
    case "TOTAL": return { status: { not: "CANCELADO" } };
    default: return null;
  }
}

/** O período sobre um INSTANTE (data de criação): [gte, lt) do relógio de Brasília; todo o período (sem limites) = null */
export function condPeriodoCriacao(p: Periodo) {
  if (!p.gte && !p.lt) return null;
  return { criadoEm: { ...(p.gte && { gte: p.gte }), ...(p.lt && { lt: p.lt }) } };
}

/**
 * where da LISTA de Orçamentos: os filtros da URL (whereOrcamentos, sem as datas antigas do painel —
 * o período faz esse papel) + o período pela data de criação + o card de funil clicado.
 */
export function whereListaOrcamentos(empresaId: string, sp: SP, periodo: Periodo, agora = new Date()) {
  const base = whereOrcamentos(empresaId, { ...sp, dataInicio: undefined, dataFim: undefined }, agora);
  const and: object[] = [...(base.AND ?? [])];
  const per = condPeriodoCriacao(periodo);
  if (per) and.push(per);
  const card = condCardPeriodoOrcamentos(sp.card ?? "", agora);
  if (card) and.push(card);
  return { ...base, ...(and.length ? { AND: and } : {}) };
}

/* ───────── Contas a Pagar: período + cards (o mesmo padrão de Contas a Receber) ───────── */

/** Os cards do período de Contas a Pagar, na ordem da tela */
export const CARDS_PERIODO_PAGAR = ["VENCIDO", "VENCE_HOJE", "A_VENCER", "PAGO", "TOTAL"] as const;
export type CardPeriodoPagar = (typeof CARDS_PERIODO_PAGAR)[number];

/** Conta a pagar ainda devendo algo (o "pago parcial" entra aqui, pelo saldo) */
const PAGAR_ABERTA = ["PENDENTE", "PAGO_PARCIAL", "VENCIDO"];

/**
 * O que cada card soma: abertos pelo SALDO RESTANTE (o pago parcial conta pelo que falta),
 * "Pagos" pelo VALOR PAGO e o "Total" pelo valor das contas do período.
 */
export const CAMPO_CARD_PAGAR: Record<CardPeriodoPagar, "saldoRestante" | "valorPago" | "valorTotal"> = {
  VENCIDO: "saldoRestante", VENCE_HOJE: "saldoRestante", A_VENCER: "saldoRestante", PAGO: "valorPago", TOTAL: "valorTotal",
};

/** where de um card do período de Contas a Pagar (vencimento é dia civil de Brasília) */
export function condCardPeriodoPagar(card: string, agora = new Date()) {
  const hoje = hojeDiaCivil(agora);
  const amanha = hojeDiaCivil(agora, 1);
  switch (card) {
    case "VENCIDO": return { status: { in: PAGAR_ABERTA }, dataVencimento: { lt: hoje } };
    case "VENCE_HOJE": return { status: { in: PAGAR_ABERTA }, dataVencimento: { gte: hoje, lt: amanha } };
    // Sem vencimento ainda não venceu: fica em "A vencer"
    case "A_VENCER": return { status: { in: PAGAR_ABERTA }, OR: [{ dataVencimento: { gte: amanha } }, { dataVencimento: null }] };
    case "PAGO": return { status: "PAGO_TOTAL" };
    case "TOTAL": return { status: { not: "CANCELADO" } };
    default: return null;
  }
}

/**
 * where da LISTA de Contas a Pagar: os filtros da URL (whereContasPagar, sem as datas antigas do
 * painel — o período faz esse papel) + o período pelo vencimento + o card do período clicado.
 */
export function whereListaPagar(empresaId: string, sp: SP, periodo: Periodo, agora = new Date()) {
  const base = whereContasPagar(empresaId, { ...sp, dataInicio: undefined, dataFim: undefined });
  const and: object[] = [];
  const per = condPeriodoVencimento(periodo);
  if (per) and.push(per);
  const card = condCardPeriodoPagar(sp.card ?? "", agora);
  if (card) and.push(card);
  return { ...base, ...(and.length ? { AND: and } : {}) };
}

/** where de Contas a Pagar a partir da URL (os mesmos filtros que a tela já tinha). */
export function whereContasPagar(empresaId: string, sp: SP) {
  const where: any = { empresaId };
  if (sp.status) where.status = sp.status;
  // Busca por texto: no nome do cadastro ligado, no texto antigo, na descrição e no número
  if (sp.fornecedor) where.OR = [
    { fornecedorCadastro: { nome: { contains: sp.fornecedor, mode: "insensitive" } } },
    { fornecedor: { contains: sp.fornecedor, mode: "insensitive" } },
    { descricao: { contains: sp.fornecedor, mode: "insensitive" } },
    { numero: { contains: sp.fornecedor, mode: "insensitive" } },
  ];
  if (sp.fornecedorId) where.fornecedorId = sp.fornecedorId;
  if (sp.categoria) where.categoriaId = sp.categoria;
  if (sp.centro) where.centroCustoId = sp.centro;
  if (sp.origem === "PEDIDO") where.pedidoCompraId = { not: null };
  else if (sp.origem === "NF") where.notaCompraId = { not: null };
  else if (sp.origem === "MANUAL") { where.pedidoCompraId = null; where.notaCompraId = null; }
  if (sp.dataInicio || sp.dataFim) {
    where.dataVencimento = {};
    Object.assign(where.dataVencimento, periodoDiaCivil(sp.dataInicio, sp.dataFim) ?? {});
  }
  return where;
}

/** Status que a lista de pedidos de compra filtra (os legados entram junto do equivalente novo) */
const STATUS_PEDIDO_FILTRO: Record<string, string[]> = {
  SOLICITADO: ["SOLICITADO"], COTANDO: ["COTANDO", "COMPRADO"], PARCIAL: ["PARCIAL"],
  CONCLUIDO: ["CONCLUIDO", "ENTREGUE"], CANCELADO: ["CANCELADO"],
};

/**
 * Lista central de Compras: status (os legados junto do equivalente), comprador, origem (OS,
 * orçamento, avulso), "abertos" (nem concluído nem cancelado) e a busca no número, nos itens, no
 * fornecedor, na OS/orçamento de origem e no motivo.
 */
export function wherePedidosCompra(empresaId: string, sp: SP) {
  const where: any = { empresaId };
  const and: any[] = [];
  if (sp.status && STATUS_PEDIDO_FILTRO[sp.status]) where.status = { in: STATUS_PEDIDO_FILTRO[sp.status] };
  else if (sp.abertos === "1") where.status = { in: ["SOLICITADO", "COTANDO", "COMPRADO", "PARCIAL"] };
  if (sp.compradorId) where.compradorId = sp.compradorId;
  if (sp.origem === "OS") and.push({ OR: [{ ordemServicoId: { not: null } }, { orcamento: { ordensServico: { some: {} } } }] });
  else if (sp.origem === "ORCAMENTO") and.push({ ordemServicoId: null, orcamentoId: { not: null }, orcamento: { ordensServico: { none: {} } } });
  else if (sp.origem === "AVULSO") and.push({ ordemServicoId: null, orcamentoId: null });
  const q = sp.q?.trim();
  if (q) {
    const c = { contains: q, mode: "insensitive" };
    and.push({ OR: [
      { numero: c }, { motivo: c }, { observacao: c },
      { itens: { some: { descricao: c } } },
      { fornecedor: { nome: c } },
      { ordemServico: { numero: c } },
      { orcamento: { codigo: c } },
    ] });
  }
  if (and.length) where.AND = and;
  return where;
}
