import { prisma } from "@/lib/prisma";

/**
 * Linha do tempo de manutenção de um equipamento.
 *
 * Um equipamento aparece num atendimento de duas formas:
 * - OS aberta diretamente para ele (`OrdemServico.equipamentoId`);
 * - atividade de OS que atende vários equipamentos (`AtividadeEquipamento`).
 * Esta função junta as duas fontes (sem duplicar) e anexa os formulários/fotos
 * preenchidos para o equipamento em cada atividade.
 */

export interface FormularioResumo {
  nome: string;
  fotos: string[];
  campos: number;
}

export interface EventoHistorico {
  /** Chave estável (atividade ou OS sem atividade). */
  chave: string;
  data: string; // ISO
  titulo: string;
  tipoServico: { nome: string; cor: string | null } | null;
  tecnico: string | null;
  /** Status da atividade (ou da OS, quando não há atividade). */
  status: string;
  origemStatus: "ATIVIDADE" | "OS";
  /** Equipamento marcado como atendido na atividade (checklist da OS). */
  equipamentoFeito: boolean;
  resumo: string | null;
  os: { id: string; numero: string; status: string };
  atividadeId: string | null;
  formularios: FormularioResumo[];
}

const LIMITE = 200;

export async function carregarHistoricoEquipamento(empresaId: string, equipamentoId: string): Promise<EventoHistorico[]> {
  const [atividades, osSemAtividade, respostas] = await Promise.all([
    prisma.atividadeOs.findMany({
      where: {
        empresaId,
        OR: [
          { ordemServico: { equipamentoId } },
          { equipamentos: { some: { equipamentoId } } },
        ],
      },
      orderBy: { criadoEm: "desc" },
      take: LIMITE,
      select: {
        id: true, titulo: true, status: true, dataAgendada: true, criadoEm: true, resumo: true,
        tipoOs: { select: { nome: true, cor: true } },
        tecnico: { select: { nome: true } },
        ordemServico: { select: { id: true, numero: true, status: true, dataConclusao: true } },
        equipamentos: { where: { equipamentoId }, select: { feito: true, feitoEm: true } },
      },
    }),
    prisma.ordemServico.findMany({
      where: { empresaId, equipamentoId, atividades: { none: {} } },
      orderBy: { criadoEm: "desc" },
      take: LIMITE,
      select: { id: true, numero: true, status: true, descricao: true, criadoEm: true, dataConclusao: true },
    }),
    prisma.respostaFormularioEquipamento.findMany({
      where: { empresaId, equipamentoId },
      select: { atividadeId: true, formularioId: true, arquivoUrl: true, formulario: { select: { nome: true } } },
    }),
  ]);

  // Formulários por atividade: nome, nº de campos respondidos e fotos
  const formsPorAtividade = new Map<string, Map<string, FormularioResumo>>();
  for (const r of respostas) {
    const porForm = formsPorAtividade.get(r.atividadeId) ?? new Map<string, FormularioResumo>();
    const f = porForm.get(r.formularioId) ?? { nome: r.formulario.nome, fotos: [], campos: 0 };
    f.campos += 1;
    if (r.arquivoUrl) f.fotos.push(r.arquivoUrl);
    porForm.set(r.formularioId, f);
    formsPorAtividade.set(r.atividadeId, porForm);
  }

  const eventos: EventoHistorico[] = atividades.map((a) => {
    const vinculo = a.equipamentos[0];
    const concluida = a.status === "CONCLUIDA";
    const data = vinculo?.feitoEm ?? (concluida ? a.ordemServico.dataConclusao : null) ?? a.dataAgendada ?? a.criadoEm;
    return {
      chave: `at-${a.id}`,
      data: data.toISOString(),
      titulo: a.titulo,
      tipoServico: a.tipoOs ? { nome: a.tipoOs.nome, cor: a.tipoOs.cor } : null,
      tecnico: a.tecnico?.nome ?? null,
      status: a.status,
      origemStatus: "ATIVIDADE",
      equipamentoFeito: !!vinculo?.feito,
      resumo: a.resumo ?? null,
      os: { id: a.ordemServico.id, numero: a.ordemServico.numero, status: a.ordemServico.status },
      atividadeId: a.id,
      formularios: [...(formsPorAtividade.get(a.id)?.values() ?? [])],
    };
  });

  for (const o of osSemAtividade) {
    eventos.push({
      chave: `os-${o.id}`,
      data: (o.dataConclusao ?? o.criadoEm).toISOString(),
      titulo: o.descricao,
      tipoServico: null,
      tecnico: null,
      status: o.status,
      origemStatus: "OS",
      equipamentoFeito: false,
      resumo: null,
      os: { id: o.id, numero: o.numero, status: o.status },
      atividadeId: null,
      formularios: [],
    });
  }

  return eventos.sort((a, b) => b.data.localeCompare(a.data));
}
