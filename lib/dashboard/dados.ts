/**
 * Consultas do dashboard — uma por bloco, só agregados (count/sum/groupBy) ou listas
 * curtas com `take`. Toda consulta filtra por `empresaId`. "Hoje"/"mês" seguem o fuso
 * de Brasília (lib/fuso), não o do servidor.
 */
import { filtroStatusPmoc } from "@/lib/pmoc";
import { avisosAtivos } from "@/lib/pmoc-avisos-server";
import { configPmoc } from "@/lib/pmoc-documento-server";
import { NAO_E_RENEGOCIACAO } from "@/lib/listas/filtros";
import { recebidoNoPeriodo, saldoDoAgregado } from "@/lib/financeiro/parcelas-server";
import { prisma } from "@/lib/prisma";
import { whereOsAtrasada } from "@/lib/os/prazo-execucao";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";
import { SOLICITACAO_PENDENTE } from "@/lib/solicitacoes";
import { chaveDiaBR, hojeDiaCivil, inicioHojeBR, inicioMesBR, inicioMesDiaCivil } from "@/lib/fuso";
import type { BlocoId } from "@/lib/dashboard/blocos";
import { comparaNatural } from "@/lib/utils";
import { DIAS_FORA_DA_FAIXA } from "@/lib/checklist/faixas";
import { comEscopo, filtroOrcamentos, filtroOrdens, type QuemVe } from "@/lib/escopo/proprios";
import type { Prisma } from "@prisma/client";

/** COM-1: "Ver só os próprios" — o escopo das OS / orçamentos de quem vê o painel (vazio = sem limite) */
type EscopoOs = Prisma.OrdemServicoWhereInput;
type EscopoOrc = Prisma.OrcamentoWhereInput;

const OS_FINAIS = ["CONCLUIDA", "CANCELADA"] as const;
const DIA = 864e5;
const nomeCliente = (c: { nome: string; nomeFantasia: string | null } | null) => (c ? c.nomeFantasia || c.nome : "—");
const num = (v: unknown) => Number(v ?? 0);

export async function dadosOperacional(empresaId: string, agora = new Date(), eo: EscopoOs = {}) {
  const hoje = inicioHojeBR(agora);
  const amanha = inicioHojeBR(agora, 1);
  const [abertas, agendadasHoje, atrasadas, concluidasMes, emAndamento] = await Promise.all([
    prisma.ordemServico.count({ where: comEscopo({ empresaId, status: { notIn: [...OS_FINAIS] } }, eo) }),
    prisma.ordemServico.count({
      where: comEscopo({
        empresaId, status: { notIn: [...OS_FINAIS] },
        atividades: { some: { dataAgendada: { gte: hoje, lt: amanha }, status: { not: "CANCELADA" } } },
      }, eo),
    }),
    // a regra única de "atrasada" (lib/os/prazo-execucao.ts): por DIA de Brasília, igual ao calendário e ao sino
    prisma.ordemServico.count({ where: comEscopo({ empresaId, ...whereOsAtrasada(agora) }, eo) }),
    prisma.ordemServico.count({ where: comEscopo({ empresaId, status: "CONCLUIDA", dataConclusao: { gte: inicioMesBR(agora) } }, eo) }),
    prisma.ordemServico.count({ where: comEscopo({ empresaId, status: "EM_ANDAMENTO" }, eo) }),
  ]);
  return { abertas, agendadasHoje, atrasadas, concluidasMes, emAndamento };
}

export async function dadosOsDoDia(empresaId: string, agora = new Date(), eo: EscopoOs = {}) {
  const hoje = inicioHojeBR(agora);
  const amanha = inicioHojeBR(agora, 1);
  const where = { empresaId, dataAgendada: { gte: hoje, lt: amanha }, status: { not: "CANCELADA" as const }, ...(Object.keys(eo).length ? { ordemServico: eo } : {}) };
  const grupos = await prisma.atividadeOs.groupBy({
    by: ["tecnicoId", "equipeId", "status"],
    where,
    _count: { _all: true },
  });
  const tecnicoIds = [...new Set(grupos.map((g) => g.tecnicoId).filter((x): x is string => !!x))];
  const equipeIds = [...new Set(grupos.map((g) => g.equipeId).filter((x): x is string => !!x))];
  const [tecnicos, equipes] = await Promise.all([
    tecnicoIds.length ? prisma.tecnico.findMany({ where: { empresaId, id: { in: tecnicoIds } }, select: { id: true, nome: true } }) : [],
    equipeIds.length ? prisma.equipe.findMany({ where: { empresaId, id: { in: equipeIds } }, select: { id: true, nome: true } }) : [],
  ]);
  const nomeTec = new Map(tecnicos.map((t) => [t.id, t.nome]));
  const nomeEq = new Map(equipes.map((e) => [e.id, e.nome]));

  const linhas = new Map<string, { chave: string; nome: string; equipe: string | null; total: number; concluidas: number; emAndamento: number }>();
  for (const g of grupos) {
    const chave = g.tecnicoId ?? "sem-tecnico";
    const l = linhas.get(chave) ?? {
      chave, nome: g.tecnicoId ? nomeTec.get(g.tecnicoId) ?? "Técnico" : "Sem técnico definido",
      equipe: g.equipeId ? nomeEq.get(g.equipeId) ?? null : null, total: 0, concluidas: 0, emAndamento: 0,
    };
    const n = g._count._all;
    l.total += n;
    if (g.status === "CONCLUIDA") l.concluidas += n;
    if (g.status === "EM_ANDAMENTO") l.emAndamento += n;
    if (!l.equipe && g.equipeId) l.equipe = nomeEq.get(g.equipeId) ?? null;
    linhas.set(chave, l);
  }
  const lista = [...linhas.values()].sort((a, b) => b.total - a.total || comparaNatural(a.nome, b.nome));
  return { linhas: lista.slice(0, 8), outros: Math.max(0, lista.length - 8), total: lista.reduce((s, l) => s + l.total, 0) };
}

export async function dadosSolicitacoes(empresaId: string, eo: EscopoOs = {}) {
  const where = comEscopo({ empresaId, ...SOLICITACAO_PENDENTE } as EscopoOs, eo);
  const [total, recentes] = await Promise.all([
    prisma.ordemServico.count({ where }),
    prisma.ordemServico.findMany({
      where, take: 4, orderBy: { criadoEm: "desc" },
      select: { id: true, numero: true, chamadoNumero: true, descricao: true, prioridade: true, criadoEm: true, cliente: { select: { nome: true, nomeFantasia: true } } },
    }),
  ]);
  return {
    total,
    recentes: recentes.map((o) => ({
      id: o.id, numero: o.chamadoNumero ?? o.numero, cliente: nomeCliente(o.cliente),
      resumo: o.descricao.split("\n")[0].slice(0, 90), prioridade: o.prioridade, criadoEm: o.criadoEm.toISOString(),
    })),
  };
}

export async function dadosAgenda(empresaId: string, agora = new Date(), eo: EscopoOs = {}) {
  const hoje = inicioHojeBR(agora);
  const fim = inicioHojeBR(agora, 14);
  const where = { empresaId, dataAgendada: { gte: hoje, lt: fim }, status: { not: "CANCELADA" as const }, ordemServico: comEscopo({ status: { not: "CANCELADA" as const } } as EscopoOs, eo) };
  const [datas, proximas] = await Promise.all([
    // Só a data de cada atividade (lista curta e limitada) para montar a faixa de 14 dias
    prisma.atividadeOs.findMany({ where, select: { dataAgendada: true }, take: 2000 }),
    prisma.atividadeOs.findMany({
      where: { ...where, dataAgendada: { gte: agora, lt: fim } },
      take: 6, orderBy: { dataAgendada: "asc" },
      select: {
        id: true, titulo: true, dataAgendada: true,
        tecnico: { select: { nome: true } },
        ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
      },
    }),
  ]);
  const porDia = new Map<string, number>();
  for (const d of datas) if (d.dataAgendada) porDia.set(chaveDiaBR(d.dataAgendada), (porDia.get(chaveDiaBR(d.dataAgendada)) ?? 0) + 1);
  const dias = Array.from({ length: 14 }, (_, i) => {
    const inicio = new Date(hoje.getTime() + i * DIA);
    const chave = chaveDiaBR(inicio);
    return { chave, inicio: inicio.toISOString(), total: porDia.get(chave) ?? 0 };
  });
  return {
    dias,
    proximas: proximas.map((a) => ({
      id: a.id, osId: a.ordemServico.id, numero: a.ordemServico.numero, titulo: a.titulo,
      cliente: nomeCliente(a.ordemServico.cliente), tecnico: a.tecnico?.nome ?? null, quando: a.dataAgendada!.toISOString(),
    })),
  };
}

export async function dadosComercial(empresaId: string, ver: { contratos: boolean; orcamentos: boolean }, agora = new Date(), ec: EscopoOrc = {}) {
  const em60 = hojeDiaCivil(agora, 60); // dataFim é dia civil
  const [ativos, vencendo, orcAbertos, orcEnviadosValor] = await Promise.all([
    ver.contratos ? prisma.contrato.count({ where: { empresaId, status: "ATIVO" } }) : null,
    ver.contratos ? prisma.contrato.count({ where: { empresaId, status: "ATIVO", dataFim: { gte: hojeDiaCivil(agora), lte: em60 } } }) : null,
    ver.orcamentos ? prisma.orcamento.count({ where: comEscopo({ empresaId, status: { in: ["RASCUNHO", "ENVIADO"] } } as EscopoOrc, ec) }) : null,
    ver.orcamentos ? prisma.orcamento.aggregate({ where: comEscopo({ empresaId, status: "ENVIADO" } as EscopoOrc, ec), _sum: { totalGeral: true }, _count: { _all: true } }) : null,
  ]);
  return {
    contratosAtivos: ativos,
    contratosVencendo: vencendo,
    orcamentosAbertos: orcAbertos,
    orcamentosEnviados: orcEnviadosValor ? { quantidade: orcEnviadosValor._count._all, valor: num(orcEnviadosValor._sum.totalGeral) } : null,
  };
}

/**
 * Financeiro (contas a receber). "Previsto" de contrato fica de fora dos números de
 * cobrança: é projeção, não título emitido (ver auditoria C6).
 */
export async function dadosFinanceiro(empresaId: string, agora = new Date()) {
  // Vencimento/recebimento são DIAS civis (meia-noite UTC): "hoje" e o mês pelo calendário de
  // Brasília — a conta que vence hoje não entra em "Vencidos" e o dia 1 entra no faturado do mês
  const hoje = hojeDiaCivil(agora);
  const em7 = hojeDiaCivil(agora, 8);
  const mesIni = inicioMesDiaCivil(agora);
  const mesFim = inicioMesDiaCivil(agora, 1);
  const EM_ABERTO = ["A_RECEBER", "ATRASADO"] as const;
  const [faturado, recebido, aReceber, vencidos, inadimplentes, prox7] = await Promise.all([
    prisma.contaReceber.aggregate({
      // Faturado: a perda conta (a receita original não é estornada — a perda é despesa à parte); a
      // renegociada também (a receita é dela) e a renegociação não (seria o mesmo dinheiro de novo)
      where: { empresaId, status: { in: ["A_RECEBER", "ATRASADO", "RECEBIDO", "PERDA", "RENEGOCIADO"] }, dataVencimento: { gte: mesIni, lt: mesFim }, ...NAO_E_RENEGOCIACAO },
      _sum: { valor: true },
    }),
    // Recebido pela data de cada recebimento (parcial ou total) + as recebidas antigas
    recebidoNoPeriodo(empresaId, { gte: mesIni, lt: mesFim }),
    // Em aberto pelo SALDO (a baixa parcial já entrou)
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: [...EM_ABERTO] } }, _sum: { valor: true, valorRecebido: true }, _count: { _all: true } }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: [...EM_ABERTO] }, dataVencimento: { lt: hoje } }, _sum: { valor: true, valorRecebido: true }, _count: { _all: true } }),
    prisma.contaReceber.groupBy({ by: ["clienteId"], where: { empresaId, status: { in: [...EM_ABERTO] }, dataVencimento: { lt: hoje } } }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: [...EM_ABERTO] }, dataVencimento: { gte: hoje, lt: em7 } }, _sum: { valor: true, valorRecebido: true }, _count: { _all: true } }),
  ]);
  return {
    faturadoMes: num(faturado._sum.valor),
    recebidoMes: recebido.valor,
    aReceber: { valor: saldoDoAgregado(aReceber), quantidade: aReceber._count._all },
    vencidos: { valor: saldoDoAgregado(vencidos), quantidade: vencidos._count._all, clientes: inadimplentes.length },
    proximos7: { valor: saldoDoAgregado(prox7), quantidade: prox7._count._all },
  };
}

export async function dadosEquipamentos(empresaId: string, agora = new Date()) {
  const hoje = hojeDiaCivil(agora); // garantia é dia civil: a que vence hoje ainda é vigente
  const em60 = hojeDiaCivil(agora, 60);
  const [total, garantiaVencendo, garantiaVigente, semQr, foraDaFaixa] = await Promise.all([
    prisma.equipamento.count({ where: { empresaId, ativo: true } }),
    prisma.equipamento.count({ where: { empresaId, ativo: true, garantiaAte: { gte: hoje, lte: em60 } } }),
    prisma.equipamento.count({ where: { empresaId, ativo: true, garantiaAte: { gte: hoje } } }),
    prisma.equipamento.count({ where: { empresaId, ativo: true, qrcode: null } }),
    medicoesForaDaFaixa(empresaId, agora),
  ]);
  return { total, garantiaVencendo, garantiaVigente, semQr, foraDaFaixa };
}


/**
 * Medições fora da faixa esperada (app ou escritório) nos últimos 30 dias: quantos equipamentos e as 3 leituras
 * mais recentes, cada uma com a OS (o gestor abre a OS e decide).
 */
export async function medicoesForaDaFaixa(empresaId: string, agora = new Date()) {
  const desde = new Date(agora.getTime() - DIAS_FORA_DA_FAIXA * 86_400_000);
  const where = { empresaId, foraDaFaixa: true, respondidoEm: { gte: desde }, equipamento: { ativo: true } };
  const [porEquipamento, ultimas] = await Promise.all([
    prisma.checklistResposta.groupBy({ by: ["equipamentoId"], where, _count: { _all: true } }),
    prisma.checklistResposta.findMany({
      where, orderBy: { respondidoEm: "desc" }, take: 3,
      select: {
        id: true, textoItem: true, valor: true, unidade: true, faixaMin: true, faixaMax: true,
        equipamento: { select: { nome: true, modelo: true } }, atividade: { select: { ordemServico: { select: { id: true, numero: true, chamadoNumero: true } } } },
      },
    }),
  ]);
  const n = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());
  return {
    equipamentos: porEquipamento.length,
    ultimas: ultimas.map((r) => ({
      id: r.id, equipamento: r.equipamento.nome || r.equipamento.modelo || "Equipamento", item: r.textoItem,
      valor: n(r.valor), unidade: r.unidade, faixa: { min: n(r.faixaMin), max: n(r.faixaMax) },
      os: { id: r.atividade.ordemServico.id, numero: r.atividade.ordemServico.chamadoNumero ?? r.atividade.ordemServico.numero },
    })),
  };
}

/** PMOC: planos vigentes e os avisos de vencimento em aberto (os que ainda não tiveram ciência) */
export async function dadosPmoc(empresaId: string, agora = new Date()) {
  const [vigentes, avisos, { diasAviso }] = await Promise.all([
    prisma.pmoc.count({ where: { empresaId, ativo: true, ...filtroStatusPmoc("VIGENTE", agora) } }),
    avisosAtivos(empresaId, agora),
    configPmoc(empresaId),
  ]);
  return {
    vigentes, diasAviso,
    vencendo: avisos.filter((a) => a.tipo === "VENCENDO").length,
    expirados: avisos.filter((a) => a.tipo === "EXPIRADO").length,
    // os mais urgentes primeiro: expirados, depois os que expiram antes
    avisos: [...avisos].sort((a, b) => (a.tipo === b.tipo ? a.dataExpiracao.localeCompare(b.dataExpiracao) : a.tipo === "EXPIRADO" ? -1 : 1)).slice(0, 5)
      .map((a) => ({ id: a.pmocId, nome: a.nome, cliente: a.cliente, tipo: a.tipo, texto: a.texto })),
  };
}

export const dadosFrota = (empresaId: string) => contarAlertasVeiculos(empresaId);

export async function dadosPrazos(empresaId: string, comCompras: boolean, eo: EscopoOs = {}) {
  const a = await contarAlertasPrazos(empresaId, eo);
  return {
    prazosVencidos: a.prazosVencidos,
    etapasVencendoHoje: a.etapasVencendoHoje,
    pedidosPendentes: comCompras ? a.pedidosPendentes : null,
  };
}

export type DadosBloco = {
  operacional: Awaited<ReturnType<typeof dadosOperacional>>;
  "os-do-dia": Awaited<ReturnType<typeof dadosOsDoDia>>;
  solicitacoes: Awaited<ReturnType<typeof dadosSolicitacoes>>;
  agenda: Awaited<ReturnType<typeof dadosAgenda>>;
  comercial: Awaited<ReturnType<typeof dadosComercial>>;
  financeiro: Awaited<ReturnType<typeof dadosFinanceiro>>;
  equipamentos: Awaited<ReturnType<typeof dadosEquipamentos>>;
  pmoc: Awaited<ReturnType<typeof dadosPmoc>>;
  frota: Awaited<ReturnType<typeof dadosFrota>>;
  prazos: Awaited<ReturnType<typeof dadosPrazos>>;
};

export interface ContextoUsuario { empresaId: string; podeVer: (modulo: string, acao?: string) => boolean; /** COM-1: quem vê ("Ver só os próprios") */ quem?: QuemVe }

/** Carrega só os blocos pedidos; um bloco que falha não derruba o dashboard. */
export async function carregarBlocos(ids: BlocoId[], ctx: ContextoUsuario, agora = new Date()) {
  const { empresaId, podeVer } = ctx;
  const eo = filtroOrdens(ctx.quem), ec = filtroOrcamentos(ctx.quem);
  const carregadores: { [K in BlocoId]: () => Promise<DadosBloco[K]> } = {
    operacional: () => dadosOperacional(empresaId, agora, eo),
    "os-do-dia": () => dadosOsDoDia(empresaId, agora, eo),
    solicitacoes: () => dadosSolicitacoes(empresaId, eo),
    agenda: () => dadosAgenda(empresaId, agora, eo),
    comercial: () => dadosComercial(empresaId, { contratos: podeVer("contratos"), orcamentos: podeVer("orcamentos") }, agora, ec),
    financeiro: () => dadosFinanceiro(empresaId, agora),
    equipamentos: () => dadosEquipamentos(empresaId, agora),
    pmoc: () => dadosPmoc(empresaId, agora),
    frota: () => dadosFrota(empresaId),
    prazos: () => dadosPrazos(empresaId, podeVer("compras"), eo),
  };
  const resultados = await Promise.allSettled(ids.map((id) => carregadores[id]()));
  const dados: Partial<{ [K in BlocoId]: DadosBloco[K] | { erro: true } }> = {};
  ids.forEach((id, i) => {
    const r = resultados[i];
    if (r.status === "fulfilled") (dados as any)[id] = r.value;
    else {
      console.error(`[dashboard] falha ao carregar bloco ${id}:`, r.reason);
      (dados as any)[id] = { erro: true };
    }
  });
  return dados;
}
