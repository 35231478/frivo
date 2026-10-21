import { prisma } from "@/lib/prisma";
import { linkRelatorioAtividade } from "@/lib/relatorio-atividade-link";

/**
 * Linha do tempo de manutenção de um equipamento.
 *
 * Um equipamento aparece num atendimento de duas formas:
 * - OS aberta diretamente para ele (`OrdemServico.equipamentoId`);
 * - atividade de OS que atende vários equipamentos (`AtividadeEquipamento`).
 * Esta função junta as duas fontes (sem duplicar) e anexa, de cada atividade, o que foi registrado
 * para ESTE equipamento: o checklist do tipo (resumo OK/Atenção/Não se aplica), as fotos dele, a
 * observação do técnico e os formulários/fotos preenchidos. Execução gravada aparece aqui sozinha.
 * Etapa 2 (app do técnico): as MEDIÇÕES (número + unidade, como o técnico registrou — sem avaliação),
 * as observações em áudio e os serviços ADICIONAIS feitos neste equipamento.
 */

export interface FormularioResumo {
  nome: string;
  fotos: string[];
  campos: number;
}

export interface ChecklistResumo { ok: number; atencao: number; naoSeAplica: number; total: number; itensAtencao: string[] }
export interface MedicaoHistorico { texto: string; valor: number; unidade: string | null }
export interface AdicionalHistorico { descricao: string; statusCobranca: string; fotos: string[] }

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
  /** Checklist do tipo respondido para este equipamento nesta atividade (null = nada respondido) */
  checklist: ChecklistResumo | null;
  /** Fotos DESTE equipamento nesta atividade (servidas em /api/fotos-atendimento/<id>) */
  fotos: string[];
  /** Observação do técnico sobre este equipamento */
  observacao: string | null;
  /** Medições do checklist (número + unidade) */
  medicoes: MedicaoHistorico[];
  /** Observações em áudio (item + endereço do áudio) */
  audios: { texto: string; url: string }[];
  /** Serviços adicionais feitos NESTE equipamento nesta atividade */
  adicionais: AdicionalHistorico[];
  resumo: string | null;
  os: { id: string; numero: string; status: string };
  atividadeId: string | null;
  /** Link público do relatório da atividade, já com o token (null quando não há atividade). */
  linkRelatorio: string | null;
  formularios: FormularioResumo[];
}

const LIMITE = 200;

export async function carregarHistoricoEquipamento(empresaId: string, equipamentoId: string): Promise<EventoHistorico[]> {
  const [atividades, osSemAtividade, respostas, checklist, fotos, audios, adicionais] = await Promise.all([
    prisma.atividadeOs.findMany({
      where: {
        empresaId,
        OR: [
          { ordemServico: { equipamentoId } },
          { equipamentos: { some: { equipamentoId } } },
          { servicosAdicionais: { some: { equipamentoId } } },
        ],
      },
      orderBy: { criadoEm: "desc" },
      take: LIMITE,
      select: {
        id: true, titulo: true, status: true, dataAgendada: true, criadoEm: true, resumo: true, tokenRelatorio: true,
        tipoOs: { select: { nome: true, cor: true } },
        tecnico: { select: { nome: true } },
        ordemServico: { select: { id: true, numero: true, status: true, dataConclusao: true } },
        equipamentos: { where: { equipamentoId }, select: { feito: true, feitoEm: true, observacao: true } },
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
    prisma.checklistResposta.findMany({
      where: { empresaId, equipamentoId, OR: [{ status: { not: null } }, { valor: { not: null } }] },
      select: { atividadeId: true, status: true, textoItem: true, valor: true, unidade: true, item: { select: { ordem: true } } },
    }),
    prisma.fotoAtendimento.findMany({ where: { empresaId, equipamentoId }, orderBy: { criadoEm: "asc" }, select: { id: true, atividadeId: true, momento: true } }),
    prisma.checklistResposta.findMany({ where: { empresaId, equipamentoId, audioUrl: { not: null } }, select: { id: true, atividadeId: true, textoItem: true } }),
    prisma.servicoAdicional.findMany({
      where: { empresaId, equipamentoId },
      orderBy: { criadoEm: "asc" },
      select: { atividadeId: true, descricao: true, statusCobranca: true, fotos: { orderBy: { criadoEm: "asc" }, select: { id: true } } },
    }),
  ]);

  // Checklist do tipo por atividade: contagem e os itens em "Atenção" (o que pede acompanhamento)
  const checklistPorAtividade = new Map<string, ChecklistResumo>();
  const medicoesPorAtividade = new Map<string, MedicaoHistorico[]>();
  for (const r of [...checklist].sort((a, b) => (a.item?.ordem ?? 0) - (b.item?.ordem ?? 0))) {
    if (r.valor !== null && !r.status) {
      medicoesPorAtividade.set(r.atividadeId, [...(medicoesPorAtividade.get(r.atividadeId) ?? []), { texto: r.textoItem, valor: r.valor.toNumber(), unidade: r.unidade }]);
      continue;
    }
    const c = checklistPorAtividade.get(r.atividadeId) ?? { ok: 0, atencao: 0, naoSeAplica: 0, total: 0, itensAtencao: [] };
    c.total += 1;
    if (r.status === "OK") c.ok += 1;
    else if (r.status === "ATENCAO") { c.atencao += 1; c.itensAtencao.push(r.textoItem); }
    else if (r.status === "NAO_SE_APLICA") c.naoSeAplica += 1;
    checklistPorAtividade.set(r.atividadeId, c);
  }
  const fotosPorAtividade = new Map<string, string[]>();
  // Antes do serviço primeiro, depois do serviço por último
  const ordem = { ANTES: 0, DEPOIS: 2 } as const;
  for (const f of [...fotos].map((f, i) => ({ f, i })).sort((a, b) => (a.f.momento ? ordem[a.f.momento] : 1) - (b.f.momento ? ordem[b.f.momento] : 1) || a.i - b.i).map((x) => x.f))
    fotosPorAtividade.set(f.atividadeId, [...(fotosPorAtividade.get(f.atividadeId) ?? []), `/api/fotos-atendimento/${f.id}`]);
  const audiosPorAtividade = new Map<string, { texto: string; url: string }[]>();
  for (const a of audios) audiosPorAtividade.set(a.atividadeId, [...(audiosPorAtividade.get(a.atividadeId) ?? []), { texto: a.textoItem, url: `/api/checklist-respostas/${a.id}/audio` }]);
  const adicionaisPorAtividade = new Map<string, AdicionalHistorico[]>();
  for (const s of adicionais) adicionaisPorAtividade.set(s.atividadeId, [...(adicionaisPorAtividade.get(s.atividadeId) ?? []), {
    descricao: s.descricao, statusCobranca: s.statusCobranca, fotos: s.fotos.map((f) => `/api/servicos-adicionais/fotos/${f.id}`),
  }]);

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
      checklist: checklistPorAtividade.get(a.id) ?? null,
      fotos: fotosPorAtividade.get(a.id) ?? [],
      observacao: (vinculo?.observacao ?? "").trim() || null,
      medicoes: medicoesPorAtividade.get(a.id) ?? [],
      audios: audiosPorAtividade.get(a.id) ?? [],
      adicionais: adicionaisPorAtividade.get(a.id) ?? [],
      resumo: a.resumo ?? null,
      os: { id: a.ordemServico.id, numero: a.ordemServico.numero, status: a.ordemServico.status },
      atividadeId: a.id,
      linkRelatorio: linkRelatorioAtividade(a),
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
      checklist: null,
      fotos: [],
      observacao: null,
      medicoes: [],
      audios: [],
      adicionais: [],
      resumo: null,
      os: { id: o.id, numero: o.numero, status: o.status },
      atividadeId: null,
      linkRelatorio: null,
      formularios: [],
    });
  }

  return eventos.sort((a, b) => b.data.localeCompare(a.data));
}
