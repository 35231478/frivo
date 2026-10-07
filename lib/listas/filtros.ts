/**
 * Filtros (where do Prisma) das listas de OS, Clientes, Orçamentos e Contratos — usados pela
 * página da lista E pela ação em massa ("selecionar todos que batem no filtro"), para os dois
 * nunca divergirem. Sempre começam pelo empresaId da sessão.
 */

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
