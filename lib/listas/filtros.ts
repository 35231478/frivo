/**
 * Filtros (where do Prisma) das listas de OS, Clientes, Orçamentos e Contratos — usados pela
 * página da lista E pela ação em massa ("selecionar todos que batem no filtro"), para os dois
 * nunca divergirem. Sempre começam pelo empresaId da sessão.
 */

import { variantesDocumento } from "@/lib/listagem";
import { hojeDiaCivil, inicioMesDiaCivil, periodoDiaCivil, periodoInstanteBR } from "@/lib/fuso";
import { whereEtapa } from "@/lib/orcamentos/ciclo";

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
  // Excluída (exclusão lógica) não aparece em lugar nenhum da lista/exportação
  const where: any = { empresaId, excluidaEm: null };
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
  const venc = periodoDiaCivil(sp.vencDe, sp.vencAte);
  if (venc) where.dataVencimento = { ...(where.dataVencimento ?? {}), ...venc };
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
