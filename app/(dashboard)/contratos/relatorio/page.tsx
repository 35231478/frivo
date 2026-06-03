import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { intervaloMeses, ehOcorrencia, dataAgendadaRecorrencia } from "@/lib/recorrencia-helpers";
import { RelatorioContratosClient } from "@/components/contratos/relatorio-contratos-client";

export const metadata: Metadata = { title: "Relatório de Contratos" };

type StatusMes = "CONCLUIDO" | "EM_ANDAMENTO" | "PENDENTE" | "ATRASADO";

export default async function RelatorioContratosPage({ searchParams }: { searchParams: Promise<{ mes?: string; ano?: string }> }) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const agora = new Date();
  const mes = Number(sp.mes) || agora.getMonth() + 1;
  const ano = Number(sp.ano) || agora.getFullYear();
  const inicioMes = new Date(ano, mes - 1, 1, 0, 0, 0);
  const fimMes = new Date(ano, mes, 0, 23, 59, 59);
  const periodo = `${ano}-${String(mes).padStart(2, "0")}`;

  // Contratos ativos com recorrência de OS habilitada cuja vigência cobre o mês
  const contratos = await prisma.contrato.findMany({
    where: { empresaId, status: "ATIVO", recorrencia: true, dataInicio: { lte: fimMes }, OR: [{ dataFim: null }, { dataFim: { gte: inicioMes } }] },
    include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
  });

  // Apenas os que têm ocorrência neste mês conforme a frequência de recorrência de OS
  const doMes = contratos.filter((c) => ehOcorrencia(c.dataInicio, ano, mes, intervaloMeses(c.frequenciaRecorrencia ?? c.periodicidade)));
  const ids = doMes.map((c) => c.id);

  // OS do mês desses contratos (recorrente por período ou previsão dentro do mês)
  const ossMes = ids.length
    ? await prisma.ordemServico.findMany({
        where: {
          empresaId, contratoId: { in: ids },
          OR: [{ periodoRecorrencia: periodo }, { previsaoConclusao: { gte: inicioMes, lte: fimMes } }],
        },
        include: { responsavel: { select: { id: true, nome: true } } },
        orderBy: { criadoEm: "desc" },
      })
    : [];
  const osPorContrato = new Map<string, (typeof ossMes)[number]>();
  for (const os of ossMes) {
    if (!os.contratoId) continue;
    const existente = osPorContrato.get(os.contratoId);
    // prefere a OS marcada com o período recorrente
    if (!existente || os.periodoRecorrencia === periodo) osPorContrato.set(os.contratoId, os);
  }

  // Última manutenção concluída por contrato
  const ultimas = ids.length
    ? await prisma.ordemServico.groupBy({ by: ["contratoId"], where: { empresaId, contratoId: { in: ids }, status: "CONCLUIDA" }, _max: { dataConclusao: true } })
    : [];
  const ultimaPorContrato = new Map(ultimas.map((u) => [u.contratoId!, u._max.dataConclusao]));

  const itens = doMes.map((c) => {
    const os = osPorContrato.get(c.id) ?? null;
    const agendada = dataAgendadaRecorrencia(ano, mes, (c as any).diaRecorrencia ?? c.diaVencimento ?? 1, (c as any).fimSemanaRecorrencia);
    let statusMes: StatusMes;
    let progresso: number;
    if (os) {
      if (os.status === "CONCLUIDA") { statusMes = "CONCLUIDO"; progresso = 100; }
      else if (os.previsaoConclusao && os.previsaoConclusao < agora) { statusMes = "ATRASADO"; progresso = 50; }
      else { statusMes = "EM_ANDAMENTO"; progresso = 50; }
    } else {
      if (agendada < agora) { statusMes = "ATRASADO"; progresso = 0; }
      else { statusMes = "PENDENTE"; progresso = 0; }
    }
    const ultima = ultimaPorContrato.get(c.id);
    return {
      contratoId: c.id, numero: c.numero, cliente: c.cliente.nomeFantasia ?? c.cliente.nome, clienteId: c.cliente.id,
      periodicidade: c.periodicidade, valorMensal: c.valorMensal ? Number(c.valorMensal) : null,
      statusMes, progresso,
      dataAgendada: agendada.toISOString(),
      os: os ? { id: os.id, numero: os.numero, status: os.status, previsaoConclusao: os.previsaoConclusao?.toISOString() ?? null, tecnicoId: os.responsavel?.id ?? null, tecnicoNome: os.responsavel?.nome ?? null } : null,
      ultimaManutencao: ultima ? ultima.toISOString() : null,
    };
  });

  const tecnicos = await prisma.usuario.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } });

  return (
    <RelatorioContratosClient
      mes={mes} ano={ano}
      itens={itens}
      tecnicos={tecnicos.map((t) => ({ value: t.id, label: t.nome }))}
      clientes={[...new Map(doMes.map((c) => [c.cliente.id, { value: c.cliente.id, label: c.cliente.nomeFantasia ?? c.cliente.nome }])).values()]}
    />
  );
}
