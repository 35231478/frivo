import { prisma } from "@/lib/prisma";
import { proximasOcorrencias } from "@/lib/recorrencia-helpers";

/**
 * Gera (idempotente) as OS recorrentes futuras de um contrato, a partir de hoje,
 * dentro da vigência e limitadas a `limite` ocorrências. Cada OS é criada com
 * status AGENDADA, origem RECORRENTE e vinculada ao contrato/cliente — aparecendo
 * no calendário e na listagem de OS. Não duplica períodos já gerados.
 * Retorna a quantidade de OS criadas.
 */
export async function gerarOsRecorrentesContrato(
  contratoId: string,
  usuarioId: string,
  limite = 12,
): Promise<number> {
  const ct = await prisma.contrato.findUnique({
    where: { id: contratoId },
    include: { tipoOsRecorrencia: { select: { id: true, nome: true } } },
  });
  if (!ct) return 0;
  if (!ct.recorrencia || !ct.frequenciaRecorrencia) return 0;
  if (ct.status === "ENCERRADO" || ct.status === "SUSPENSO") return 0;

  const ocorrencias = proximasOcorrencias({
    dataInicio: ct.dataInicio,
    dataFim: ct.dataFim,
    frequencia: ct.frequenciaRecorrencia,
    diaRecorrencia: ct.diaRecorrencia,
    fimSemana: ct.fimSemanaRecorrencia,
    limite,
  });
  if (ocorrencias.length === 0) return 0;

  const tituloTipo = ct.tipoOsRecorrencia?.nome ?? "Atendimento recorrente";
  const seqPorAno = new Map<number, number>();

  async function proximoSeq(ano: number): Promise<number> {
    if (!seqPorAno.has(ano)) {
      const ultima = await prisma.ordemServico.findFirst({
        where: { empresaId: ct!.empresaId, numero: { startsWith: `OS-${ano}-` } },
        orderBy: { numero: "desc" },
        select: { numero: true },
      });
      seqPorAno.set(ano, ultima ? Number(ultima.numero.split("-")[2]) || 0 : 0);
    }
    const proximo = (seqPorAno.get(ano) ?? 0) + 1;
    seqPorAno.set(ano, proximo);
    return proximo;
  }

  let criadas = 0;
  for (const oc of ocorrencias) {
    const jaExiste = await prisma.ordemServico.findFirst({
      where: { empresaId: ct.empresaId, contratoId: ct.id, periodoRecorrencia: oc.periodo, unidadeId: null },
      select: { id: true },
    });
    if (jaExiste) continue;

    const seq = await proximoSeq(oc.ano);
    const numero = `OS-${oc.ano}-${String(seq).padStart(4, "0")}`;

    const os = await prisma.ordemServico.create({
      data: {
        empresaId: ct.empresaId,
        numero,
        clienteId: ct.clienteId,
        contratoId: ct.id,
        criadoPorId: usuarioId,
        status: "AGENDADA",
        origem: "RECORRENTE",
        periodoRecorrencia: oc.periodo,
        prioridade: "NORMAL",
        descricao: `${tituloTipo} — contrato ${ct.numero} (${String(oc.mes).padStart(2, "0")}/${oc.ano})`,
        previsaoConclusao: oc.data,
        atividades: (ct.tipoOsRecorrenciaId || ct.tecnicoRecorrenciaId)
          ? {
              create: {
                empresaId: ct.empresaId,
                tipoOsId: ct.tipoOsRecorrenciaId || null,
                tecnicoId: ct.tecnicoRecorrenciaId || null,
                titulo: tituloTipo,
                status: "AGENDADA",
                dataAgendada: oc.data,
              },
            }
          : undefined,
      },
    });

    await prisma.osHistorico.create({
      data: {
        ordemServicoId: os.id,
        usuarioId,
        acao: "OS recorrente gerada",
        detalhes: `Gerada automaticamente ao salvar o contrato ${ct.numero} (${oc.periodo}).`,
      },
    });

    criadas++;
  }

  return criadas;
}

/**
 * Gera (idempotente) as OS recorrentes por LOCAL coberto do contrato. Cada local
 * com recorrência ativa tem sua própria frequência/tipo/responsável/data inicial.
 * As OS criadas levam o unidadeId (endereço), status AGENDADA e origem RECORRENTE.
 * Idempotência por (contratoId + unidadeId + período). Retorna a qtd criada.
 */
export async function gerarOsRecorrentesLocais(
  contratoId: string,
  usuarioId: string,
  limite = 12,
): Promise<number> {
  const ct = await prisma.contrato.findUnique({
    where: { id: contratoId },
    include: { recorrenciasLocais: true },
  });
  if (!ct) return 0;
  if (ct.status === "ENCERRADO" || ct.status === "SUSPENSO" || ct.status === "CANCELADO") return 0;

  const ativos = ct.recorrenciasLocais.filter((r) => r.ativa && r.frequencia && r.dataPrimeiraOs);
  if (ativos.length === 0) return 0;

  // Nomes dos tipos de OS para o título da atividade
  const tipoIds = [...new Set(ativos.map((r) => r.tipoOsId).filter(Boolean))] as string[];
  const tipos = tipoIds.length
    ? await prisma.tipoOs.findMany({ where: { id: { in: tipoIds } }, select: { id: true, nome: true } })
    : [];
  const tipoNome = new Map(tipos.map((t) => [t.id, t.nome]));

  const seqPorAno = new Map<number, number>();
  async function proximoSeq(ano: number): Promise<number> {
    if (!seqPorAno.has(ano)) {
      const ultima = await prisma.ordemServico.findFirst({
        where: { empresaId: ct!.empresaId, numero: { startsWith: `OS-${ano}-` } },
        orderBy: { numero: "desc" },
        select: { numero: true },
      });
      seqPorAno.set(ano, ultima ? Number(ultima.numero.split("-")[2]) || 0 : 0);
    }
    const proximo = (seqPorAno.get(ano) ?? 0) + 1;
    seqPorAno.set(ano, proximo);
    return proximo;
  }

  let criadas = 0;
  for (const r of ativos) {
    const primeira = new Date(r.dataPrimeiraOs!);
    const ocorrencias = proximasOcorrencias({
      dataInicio: primeira,
      dataFim: ct.dataFim,
      frequencia: r.frequencia,
      diaRecorrencia: primeira.getDate(),
      fimSemana: r.fimSemana,
      limite,
      aPartirDe: primeira,
    });
    const titulo = (r.tipoOsId && tipoNome.get(r.tipoOsId)) || "Atendimento recorrente";

    for (const oc of ocorrencias) {
      const periodo = `L:${r.unidadeId}:${oc.periodo}`;
      const jaExiste = await prisma.ordemServico.findFirst({
        where: { empresaId: ct.empresaId, contratoId: ct.id, unidadeId: r.unidadeId, periodoRecorrencia: periodo },
        select: { id: true },
      });
      if (jaExiste) continue;

      const seq = await proximoSeq(oc.ano);
      const numero = `OS-${oc.ano}-${String(seq).padStart(4, "0")}`;

      const os = await prisma.ordemServico.create({
        data: {
          empresaId: ct.empresaId,
          numero,
          clienteId: ct.clienteId,
          contratoId: ct.id,
          unidadeId: r.unidadeId,
          criadoPorId: usuarioId,
          status: "AGENDADA",
          origem: "RECORRENTE",
          periodoRecorrencia: periodo,
          prioridade: "NORMAL",
          descricao: `${titulo} — contrato ${ct.numero} (${String(oc.mes).padStart(2, "0")}/${oc.ano})`,
          previsaoConclusao: oc.data,
          atividades: (r.tipoOsId || r.tecnicoId)
            ? {
                create: {
                  empresaId: ct.empresaId,
                  tipoOsId: r.tipoOsId || null,
                  tecnicoId: r.tecnicoId || null,
                  titulo,
                  status: "AGENDADA",
                  dataAgendada: oc.data,
                },
              }
            : undefined,
        },
      });

      await prisma.osHistorico.create({
        data: {
          ordemServicoId: os.id,
          usuarioId,
          acao: "OS recorrente gerada",
          detalhes: `Gerada automaticamente do contrato ${ct.numero} (local) (${oc.periodo}).`,
        },
      });

      criadas++;
    }
  }

  return criadas;
}
