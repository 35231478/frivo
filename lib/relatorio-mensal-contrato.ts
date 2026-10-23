import { prisma } from "@/lib/prisma";

/**
 * D1 — Relatório mensal consolidado do contrato: a medição mensal leva junto, para o
 * cliente, (a) os relatórios das OS do contrato concluídas no mês (a preventiva completa,
 * com aparelhos, fotos e descrições), (b) o resumo das DEMAIS movimentações do mês —
 * serviço, equipamentos, quantidades, valores (quando cobrados) e o nº da OS para
 * acompanhar no portal — e (c) a data da próxima manutenção agendada do contrato.
 */

export interface LinhaResumoOs {
  descricao: string;
  quantidade: number;
  /** null = serviço sem cobrança (incluso no contrato / cortesia) */
  valorUnitario: number | null;
  valorTotal: number | null;
}

export interface ResumoOsDoMes {
  numero: string;          // nº da OS (ou do chamado) para buscar no portal
  descricao: string | null;
  dataConclusao: Date | null;
  equipamentos: string[];  // nomes dos equipamentos atendidos
  linhas: LinhaResumoOs[];
  relatorioToken: string | null; // relatório completo da OS, quando existir
}

export interface RelatorioMensalContrato {
  contratoNumero: string;
  valorMensal: number | null;
  mes: number;
  ano: number;
  /** tokens dos relatórios completos do mês (embutidos no documento, preventiva primeiro) */
  relatoriosDoMes: string[];
  ossDoMes: ResumoOsDoMes[];
  proximaPreventiva: { data: Date; tipo: string | null } | null;
}

export async function dadosRelatorioMensalContrato(medicaoId: string): Promise<RelatorioMensalContrato | null> {
  const med = await prisma.medicao.findUnique({
    where: { id: medicaoId },
    select: { id: true, empresaId: true, contratoId: true, mes: true, ano: true },
  });
  if (!med?.contratoId || !med.mes || !med.ano) return null;

  const contrato = await prisma.contrato.findUnique({
    where: { id: med.contratoId },
    select: { numero: true, valorMensal: true },
  });
  if (!contrato) return null;

  const inicioMes = new Date(med.ano, med.mes - 1, 1);
  const fimMes = new Date(med.ano, med.mes, 0, 23, 59, 59, 999);

  const oss = await prisma.ordemServico.findMany({
    where: { empresaId: med.empresaId, contratoId: med.contratoId, status: "CONCLUIDA", dataConclusao: { gte: inicioMes, lte: fimMes } },
    orderBy: { dataConclusao: "asc" },
    include: {
      itensOrcamento: { where: { executado: true }, orderBy: { id: "asc" } },
      servicosAdicionais: { orderBy: { criadoEm: "asc" } },
      relatorios: {
        where: { escopo: { in: ["GERAL", "MEDICAO_COMPLETA"] } },
        orderBy: { criadoEm: "desc" },
        select: { tokenPublico: true },
        take: 1,
      },
      atividades: {
        select: { equipamentos: { select: { equipamento: { select: { nome: true, marca: true, modelo: true } } } } },
      },
    },
  });

  const ossDoMes: ResumoOsDoMes[] = oss.map((os) => {
    const equipamentos = Array.from(new Set(
      os.atividades
        .flatMap((a) => a.equipamentos.map((e) => e.equipamento ? (e.equipamento.nome || `${e.equipamento.marca} ${e.equipamento.modelo}`.trim()) : ""))
        .filter(Boolean),
    ));
    const linhas: LinhaResumoOs[] = [
      ...os.itensOrcamento.map((it) => ({
        descricao: it.descricao,
        quantidade: Number(it.quantidade),
        valorUnitario: Number(it.valorUnitario),
        valorTotal: Number(it.valorTotal),
      })),
      // Todos os serviços do mês aparecem; o valor só aparece quando há cobrança (D1)
      ...os.servicosAdicionais
        .map((a) => ({
          descricao: `Serviço adicional — ${a.descricao}`,
          quantidade: 1,
          valorUnitario: a.statusCobranca === "COBRAR" && a.valor ? Number(a.valor) : null,
          valorTotal: a.statusCobranca === "COBRAR" && a.valor ? Number(a.valor) : null,
        })),
    ];
    return {
      numero: os.chamadoNumero ?? os.numero,
      descricao: os.descricao,
      dataConclusao: os.dataConclusao,
      equipamentos,
      linhas,
      relatorioToken: os.relatorios[0]?.tokenPublico ?? null,
    };
  });

  // Próxima manutenção do contrato pelos agendamentos (D1)
  const proxima = await prisma.atividadeOs.findFirst({
    where: {
      ordemServico: { contratoId: med.contratoId, status: { in: ["AGENDADA", "EM_ANDAMENTO"] } },
      status: "AGENDADA",
      dataAgendada: { gte: new Date() },
    },
    orderBy: { dataAgendada: "asc" },
    select: { dataAgendada: true, tipoOs: { select: { nome: true } } },
  });

  return {
    contratoNumero: contrato.numero,
    valorMensal: contrato.valorMensal ? Number(contrato.valorMensal) : null,
    mes: med.mes,
    ano: med.ano,
    relatoriosDoMes: ossDoMes.map((o) => o.relatorioToken).filter((t): t is string => !!t).slice(0, 3),
    ossDoMes,
    proximaPreventiva: proxima?.dataAgendada ? { data: proxima.dataAgendada, tipo: proxima.tipoOs?.nome ?? null } : null,
  };
}
