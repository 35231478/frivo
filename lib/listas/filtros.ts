/**
 * Filtros (where do Prisma) das listas de OS, Clientes, Orçamentos e Contratos — usados pela
 * página da lista E pela ação em massa ("selecionar todos que batem no filtro"), para os dois
 * nunca divergirem. Sempre começam pelo empresaId da sessão.
 */

import { variantesDocumento } from "@/lib/listagem";

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
    // ou abertura no dia selecionado (limites em horário local).
    const [y, m, d] = sp.data.split("-").map(Number);
    if (y && m && d) {
      const inicio = new Date(y, m - 1, d, 0, 0, 0, 0);
      const fim = new Date(y, m - 1, d, 23, 59, 59, 999);
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { atividades: { some: { dataAgendada: { gte: inicio, lte: fim } } } },
            { previsaoConclusao: { gte: inicio, lte: fim } },
            { criadoEm: { gte: inicio, lte: fim } },
          ],
        },
      ];
    }
  } else if (sp.dataInicio || sp.dataFim) {
    where.criadoEm = {};
    if (sp.dataInicio) where.criadoEm.gte = new Date(sp.dataInicio);
    if (sp.dataFim) { const f = new Date(sp.dataFim); f.setHours(23, 59, 59, 999); where.criadoEm.lte = f; }
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

export function whereOrcamentos(empresaId: string, sp: SP) {
  const where: any = { empresaId };
  // Cancelado = orçamento inativado: fica fora da lista padrão (filtre o status ou marque "Mostrar cancelados")
  if (sp.status) where.status = sp.status;
  else if (sp.inativos !== "1") where.status = { not: "CANCELADO" };
  if (sp.tipo) where.tipo = sp.tipo;
  if (sp.clienteId) where.clienteId = sp.clienteId;
  if (sp.dataInicio || sp.dataFim) {
    where.criadoEm = {};
    if (sp.dataInicio) where.criadoEm.gte = new Date(sp.dataInicio);
    if (sp.dataFim) {
      const fim = new Date(sp.dataFim);
      fim.setHours(23, 59, 59, 999);
      where.criadoEm.lte = fim;
    }
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
  const em30 = new Date(agora.getTime() + 30 * 864e5);
  const where: any = { empresaId };
  if (sp.busca) {
    where.OR = [
      { numero: { contains: sp.busca, mode: "insensitive" } },
      { cliente: { nome: { contains: sp.busca, mode: "insensitive" } } },
    ];
  }
  if (sp.frequencia) where.periodicidade = sp.frequencia;
  if (sp.clienteId) where.clienteId = sp.clienteId;
  if (sp.vigenciaInicio) where.dataInicio = { ...(where.dataInicio ?? {}), gte: new Date(sp.vigenciaInicio) };
  if (sp.vigenciaFim) { const f = new Date(sp.vigenciaFim); f.setHours(23, 59, 59, 999); where.dataInicio = { ...(where.dataInicio ?? {}), lte: f }; }
  if (sp.valorMin) where.valorMensal = { ...(where.valorMensal ?? {}), gte: Number(sp.valorMin) };
  if (sp.valorMax) where.valorMensal = { ...(where.valorMensal ?? {}), lte: Number(sp.valorMax) };
  // Filtro de status: valores diretos do enum + computados (VENCIDO/VENCENDO)
  const STATUS_ENUM = ["ATIVO", "SUSPENSO", "ENCERRADO", "CANCELADO", "EM_RENOVACAO", "AGUARDANDO_ASSINATURA"];
  if (sp.status && STATUS_ENUM.includes(sp.status)) where.status = sp.status;
  else if (sp.status === "INATIVO") where.status = { in: ["SUSPENSO", "ENCERRADO", "CANCELADO"] };
  else if (sp.status === "VENCIDO") { where.status = { notIn: ["ENCERRADO", "CANCELADO"] }; where.dataFim = { lt: agora }; }
  else if (sp.status === "VENCENDO") { where.status = "ATIVO"; where.dataFim = { gte: agora, lte: em30 }; }
  return where;
}

/* ───────── Financeiro (UX-4/E4): o filtro roda no BANCO — nada some por corte de fatia ───────── */

/** Condição Prisma de cada status VISUAL das contas a receber (mesma régua de statusVisualReceber). */
export function condStatusVisualReceber(chave: string, agora = new Date()) {
  const hoje = new Date(agora); hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje.getTime() + 864e5);
  switch (chave) {
    // Previsão do contrato (ou conta liberada sem data): não é cobrança vencida
    case "PREVISTO": return { OR: [{ status: "PREVISTO" }, { status: { in: ["A_RECEBER", "ATRASADO"] }, dataVencimento: null }] };
    case "A_VENCER": return { status: "A_RECEBER", dataVencimento: { gte: amanha } };
    case "VENCE_HOJE": return { status: "A_RECEBER", dataVencimento: { gte: hoje, lt: amanha } };
    case "VENCIDO": return { OR: [{ status: "ATRASADO" }, { status: "A_RECEBER", dataVencimento: { lt: hoje } }] };
    case "PAGO": return { status: "RECEBIDO" };
    case "CANCELADO": return { status: "CANCELADO" };
    default: return null;
  }
}

/** Os 4 cartões de resumo de Contas a Receber (sempre sobre o conjunto completo da empresa). */
export function condCardReceber(card: string, agora = new Date()) {
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
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
  const where: any = { empresaId };
  const and: any[] = [];
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
  if (sp.vencDe) where.dataVencimento = { ...(where.dataVencimento ?? {}), gte: new Date(sp.vencDe) };
  if (sp.vencAte) { const f = new Date(sp.vencAte); f.setHours(23, 59, 59, 999); where.dataVencimento = { ...(where.dataVencimento ?? {}), lte: f }; }
  const chips = (sp.status ?? "").split(",").map((s) => condStatusVisualReceber(s, agora)).filter(Boolean);
  if (chips.length) and.push({ OR: chips });
  const card = condCardReceber(sp.card ?? "", agora);
  if (card) and.push(card);
  if (and.length) where.AND = and;
  return where;
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
    if (sp.dataInicio) where.dataVencimento.gte = new Date(sp.dataInicio);
    if (sp.dataFim) { const f = new Date(sp.dataFim); f.setHours(23, 59, 59, 999); where.dataVencimento.lte = f; }
  }
  return where;
}
