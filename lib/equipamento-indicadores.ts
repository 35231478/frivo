import { prisma } from "@/lib/prisma";
import { proximasOcorrencias } from "@/lib/recorrencia-helpers";
import { LABELS_PERIODICIDADE } from "@/lib/utils";

/**
 * Indicadores derivados dos dados existentes (sem campos novos no banco).
 */

/**
 * Data do último atendimento de cada equipamento, em lote (para a listagem).
 * Considera: OS concluída aberta para o equipamento (dataConclusao) e o
 * equipamento marcado como atendido numa atividade (AtividadeEquipamento.feitoEm).
 */
export async function ultimosAtendimentos(empresaId: string, ids: string[]): Promise<Map<string, Date>> {
  const mapa = new Map<string, Date>();
  if (ids.length === 0) return mapa;

  const [porOs, porAtividade] = await Promise.all([
    prisma.ordemServico.groupBy({
      by: ["equipamentoId"],
      where: { empresaId, equipamentoId: { in: ids }, status: "CONCLUIDA", dataConclusao: { not: null } },
      _max: { dataConclusao: true },
    }),
    prisma.atividadeEquipamento.groupBy({
      by: ["equipamentoId"],
      where: { equipamentoId: { in: ids }, feito: true, feitoEm: { not: null }, atividade: { empresaId } },
      _max: { feitoEm: true },
    }),
  ]);

  const registrar = (id: string | null, data: Date | null | undefined) => {
    if (!id || !data) return;
    const atual = mapa.get(id);
    if (!atual || data > atual) mapa.set(id, data);
  };
  porOs.forEach((r) => registrar(r.equipamentoId, r._max.dataConclusao));
  porAtividade.forEach((r) => registrar(r.equipamentoId, r._max.feitoEm));
  return mapa;
}

export interface ProximaPrevista {
  data: Date;
  origem: string; // ex.: "Contrato CT-2026-0003 · Mensal"
}

const STATUS_CONTRATO_SEM_RECORRENCIA = ["SUSPENSO", "ENCERRADO", "CANCELADO", "VENCIDO"] as const;

/**
 * Próxima manutenção prevista pela recorrência de contrato do local do equipamento
 * (recorrência por local; senão, recorrência geral de contrato que cobre a unidade).
 * Usa a mesma regra de datas do gerador de OS recorrentes. Retorna null se não houver.
 */
export async function proximaManutencaoPorContrato(empresaId: string, unidadeId: string): Promise<ProximaPrevista | null> {
  const hoje = new Date();
  const candidatas: ProximaPrevista[] = [];

  const [locais, gerais] = await Promise.all([
    prisma.contratoRecorrenciaLocal.findMany({
      where: {
        empresaId, unidadeId, ativa: true, frequencia: { not: null }, dataPrimeiraOs: { not: null },
        contrato: { status: { notIn: [...STATUS_CONTRATO_SEM_RECORRENCIA] } },
      },
      select: {
        frequencia: true, dataPrimeiraOs: true, fimSemana: true,
        contrato: { select: { numero: true, dataFim: true } },
      },
    }),
    prisma.contrato.findMany({
      where: {
        empresaId, recorrencia: true, frequenciaRecorrencia: { not: null },
        status: { notIn: [...STATUS_CONTRATO_SEM_RECORRENCIA] },
        unidades: { some: { unidadeId } },
      },
      select: { numero: true, dataInicio: true, dataFim: true, frequenciaRecorrencia: true, diaRecorrencia: true, fimSemanaRecorrencia: true },
    }),
  ]);

  for (const r of locais) {
    const primeira = new Date(r.dataPrimeiraOs!);
    const [oc] = proximasOcorrencias({
      dataInicio: primeira, dataFim: r.contrato.dataFim, frequencia: r.frequencia,
      diaRecorrencia: primeira.getDate(), fimSemana: r.fimSemana, limite: 1,
      aPartirDe: primeira > hoje ? primeira : hoje,
    });
    if (oc) candidatas.push({ data: oc.data, origem: `Contrato ${r.contrato.numero} · ${LABELS_PERIODICIDADE[r.frequencia!] ?? r.frequencia}` });
  }
  for (const c of gerais) {
    const [oc] = proximasOcorrencias({
      dataInicio: c.dataInicio, dataFim: c.dataFim, frequencia: c.frequenciaRecorrencia,
      diaRecorrencia: c.diaRecorrencia, fimSemana: c.fimSemanaRecorrencia, limite: 1,
    });
    if (oc) candidatas.push({ data: oc.data, origem: `Contrato ${c.numero} · ${LABELS_PERIODICIDADE[c.frequenciaRecorrencia!] ?? c.frequenciaRecorrencia}` });
  }

  candidatas.sort((a, b) => a.data.getTime() - b.data.getTime());
  return candidatas[0] ?? null;
}
