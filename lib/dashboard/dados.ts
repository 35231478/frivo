/**
 * Consultas do dashboard — uma por bloco, só agregados (count/sum/groupBy) ou listas
 * curtas com `take`. Toda consulta filtra por `empresaId`. "Hoje"/"mês" seguem o fuso
 * de Brasília (lib/fuso), não o do servidor.
 */
import { prisma } from "@/lib/prisma";
import { contarAlertasPrazos } from "@/lib/prazo-server";
import { contarAlertasVeiculos } from "@/lib/veiculo-server";
import { SOLICITACAO_PENDENTE } from "@/lib/solicitacoes";
import { chaveDiaBR, inicioHojeBR, inicioMesBR } from "@/lib/fuso";
import type { BlocoId } from "@/lib/dashboard/blocos";

const OS_FINAIS = ["CONCLUIDA", "CANCELADA"] as const;
const DIA = 864e5;
const nomeCliente = (c: { nome: string; nomeFantasia: string | null } | null) => (c ? c.nomeFantasia || c.nome : "—");
const num = (v: unknown) => Number(v ?? 0);

export async function dadosOperacional(empresaId: string, agora = new Date()) {
  const hoje = inicioHojeBR(agora);
  const amanha = inicioHojeBR(agora, 1);
  const [abertas, agendadasHoje, atrasadas, concluidasMes, emAndamento] = await Promise.all([
    prisma.ordemServico.count({ where: { empresaId, status: { notIn: [...OS_FINAIS] } } }),
    prisma.ordemServico.count({
      where: {
        empresaId, status: { notIn: [...OS_FINAIS] },
        atividades: { some: { dataAgendada: { gte: hoje, lt: amanha }, status: { not: "CANCELADA" } } },
      },
    }),
    prisma.ordemServico.count({ where: { empresaId, status: { notIn: [...OS_FINAIS] }, previsaoConclusao: { lt: agora } } }),
    prisma.ordemServico.count({ where: { empresaId, status: "CONCLUIDA", dataConclusao: { gte: inicioMesBR(agora) } } }),
    prisma.ordemServico.count({ where: { empresaId, status: "EM_ANDAMENTO" } }),
  ]);
  return { abertas, agendadasHoje, atrasadas, concluidasMes, emAndamento };
}

export async function dadosOsDoDia(empresaId: string, agora = new Date()) {
  const hoje = inicioHojeBR(agora);
  const amanha = inicioHojeBR(agora, 1);
  const where = { empresaId, dataAgendada: { gte: hoje, lt: amanha }, status: { not: "CANCELADA" as const } };
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
  const lista = [...linhas.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  return { linhas: lista.slice(0, 8), outros: Math.max(0, lista.length - 8), total: lista.reduce((s, l) => s + l.total, 0) };
}

export async function dadosSolicitacoes(empresaId: string) {
  const where = { empresaId, ...SOLICITACAO_PENDENTE };
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

export async function dadosAgenda(empresaId: string, agora = new Date()) {
  const hoje = inicioHojeBR(agora);
  const fim = inicioHojeBR(agora, 14);
  const where = { empresaId, dataAgendada: { gte: hoje, lt: fim }, status: { not: "CANCELADA" as const }, ordemServico: { status: { not: "CANCELADA" as const } } };
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

export async function dadosComercial(empresaId: string, ver: { contratos: boolean; orcamentos: boolean }, agora = new Date()) {
  const em60 = new Date(agora.getTime() + 60 * DIA);
  const [ativos, vencendo, orcAbertos, orcEnviadosValor] = await Promise.all([
    ver.contratos ? prisma.contrato.count({ where: { empresaId, status: "ATIVO" } }) : null,
    ver.contratos ? prisma.contrato.count({ where: { empresaId, status: "ATIVO", dataFim: { gte: inicioHojeBR(agora), lte: em60 } } }) : null,
    ver.orcamentos ? prisma.orcamento.count({ where: { empresaId, status: { in: ["RASCUNHO", "ENVIADO"] } } }) : null,
    ver.orcamentos ? prisma.orcamento.aggregate({ where: { empresaId, status: "ENVIADO" }, _sum: { totalGeral: true }, _count: { _all: true } }) : null,
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
  const hoje = inicioHojeBR(agora);
  const em7 = inicioHojeBR(agora, 8);
  const mesIni = inicioMesBR(agora);
  const mesFim = inicioMesBR(agora, 1);
  const EM_ABERTO = ["A_RECEBER", "ATRASADO"] as const;
  const [faturado, recebido, aReceber, vencidos, inadimplentes, prox7] = await Promise.all([
    prisma.contaReceber.aggregate({
      where: { empresaId, status: { in: ["A_RECEBER", "ATRASADO", "RECEBIDO"] }, dataVencimento: { gte: mesIni, lt: mesFim } },
      _sum: { valor: true },
    }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: "RECEBIDO", dataRecebimento: { gte: mesIni, lt: mesFim } }, _sum: { valor: true } }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: [...EM_ABERTO] } }, _sum: { valor: true }, _count: { _all: true } }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: [...EM_ABERTO] }, dataVencimento: { lt: hoje } }, _sum: { valor: true }, _count: { _all: true } }),
    prisma.contaReceber.groupBy({ by: ["clienteId"], where: { empresaId, status: { in: [...EM_ABERTO] }, dataVencimento: { lt: hoje } } }),
    prisma.contaReceber.aggregate({ where: { empresaId, status: { in: [...EM_ABERTO] }, dataVencimento: { gte: hoje, lt: em7 } }, _sum: { valor: true }, _count: { _all: true } }),
  ]);
  return {
    faturadoMes: num(faturado._sum.valor),
    recebidoMes: num(recebido._sum.valor),
    aReceber: { valor: num(aReceber._sum.valor), quantidade: aReceber._count._all },
    vencidos: { valor: num(vencidos._sum.valor), quantidade: vencidos._count._all, clientes: inadimplentes.length },
    proximos7: { valor: num(prox7._sum.valor), quantidade: prox7._count._all },
  };
}

export async function dadosEquipamentos(empresaId: string, agora = new Date()) {
  const hoje = inicioHojeBR(agora);
  const em60 = new Date(agora.getTime() + 60 * DIA);
  const [total, garantiaVencendo, garantiaVigente, semQr] = await Promise.all([
    prisma.equipamento.count({ where: { empresaId, ativo: true } }),
    prisma.equipamento.count({ where: { empresaId, ativo: true, garantiaAte: { gte: hoje, lte: em60 } } }),
    prisma.equipamento.count({ where: { empresaId, ativo: true, garantiaAte: { gte: hoje } } }),
    prisma.equipamento.count({ where: { empresaId, ativo: true, qrcode: null } }),
  ]);
  return { total, garantiaVencendo, garantiaVigente, semQr };
}

export const dadosFrota = (empresaId: string) => contarAlertasVeiculos(empresaId);

export async function dadosPrazos(empresaId: string, comCompras: boolean) {
  const a = await contarAlertasPrazos(empresaId);
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
  frota: Awaited<ReturnType<typeof dadosFrota>>;
  prazos: Awaited<ReturnType<typeof dadosPrazos>>;
};

export interface ContextoUsuario { empresaId: string; podeVer: (modulo: string, acao?: string) => boolean }

/** Carrega só os blocos pedidos; um bloco que falha não derruba o dashboard. */
export async function carregarBlocos(ids: BlocoId[], ctx: ContextoUsuario, agora = new Date()) {
  const { empresaId, podeVer } = ctx;
  const carregadores: { [K in BlocoId]: () => Promise<DadosBloco[K]> } = {
    operacional: () => dadosOperacional(empresaId, agora),
    "os-do-dia": () => dadosOsDoDia(empresaId, agora),
    solicitacoes: () => dadosSolicitacoes(empresaId),
    agenda: () => dadosAgenda(empresaId, agora),
    comercial: () => dadosComercial(empresaId, { contratos: podeVer("contratos"), orcamentos: podeVer("orcamentos") }, agora),
    financeiro: () => dadosFinanceiro(empresaId, agora),
    equipamentos: () => dadosEquipamentos(empresaId, agora),
    frota: () => dadosFrota(empresaId),
    prazos: () => dadosPrazos(empresaId, podeVer("financeiro")),
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
