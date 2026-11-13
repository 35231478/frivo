/**
 * DESEMPENHO — a MEDIÇÃO do mês, direto do que a operação já grava (nada é digitado para o escore):
 *
 *  - NO PRAZO: atividades concluídas no mês ("concluida_em"), comparando o dia da conclusão com o
 *    prazo da atividade ou, sem prazo, com o dia agendado;
 *  - RELATÓRIO COMPLETO: por equipamento atendido, a MESMA regra que libera a conclusão no app
 *    (lib/execucao/pendencias) + foto antes e depois — só os itens do checklist que já existiam
 *    quando a atividade foi concluída (item criado depois não torna incompleto um relatório antigo);
 *  - AVALIAÇÃO: as notas do aceite do cliente (lib/os/aceite-server);
 *  - PENALIDADES: só as que a revisão marcou "CONTA" na competência.
 *
 * Uma leitura por mês para a empresa inteira (poucas consultas, sem laço por atividade).
 */
import { prisma } from "@/lib/prisma";
import { completo, faltasEquipamento, paraPendencia, type FormularioExecucao, type ItemExecucao, type RespostaItem, type StatusItem, type TipoResposta } from "@/lib/execucao/pendencias";
import { avaliacoesPorTecnico, osAvaliadas } from "@/lib/os/aceite-server";
import { ITENS_QUE_VALEM } from "./itens-validos";
import { concluidaNoPrazo, ehRetorno, periodoDaCompetencia, temAntesEDepois, type AtividadeMedida, type OsAvaliadaMedida, type PenalidadesQueContam } from "./regras";

export interface MedicaoDoMes {
  competencia: string;
  atividades: AtividadeMedida[];
  /** Média e quantidade de avaliações por colaborador (cada OS avaliada conta uma vez para quem a executou) */
  avaliacoes: Map<string, { media: number; avaliacoes: number }>;
  /** As OS avaliadas, para a visão das equipes de um encarregado */
  avaliadas: OsAvaliadaMedida[];
  penalidades: Map<string, PenalidadesQueContam>;
}

const chave = (...partes: (string | null)[]) => partes.join("|");
const numero = (v: { toNumber(): number } | null) => (v === null ? null : v.toNumber());

export async function medirMes(empresaId: string, competencia: string): Promise<MedicaoDoMes> {
  const periodo = periodoDaCompetencia(competencia);
  const [atividades, porTecnico, avaliadas, contam] = await Promise.all([
    prisma.atividadeOs.findMany({
      where: { empresaId, status: "CONCLUIDA", concluidaEm: { gte: periodo.de, lt: periodo.ate }, ordemServico: { status: { not: "CANCELADA" } } },
      select: {
        id: true, ordemServicoId: true, equipeId: true, tecnicoId: true, tipoOsId: true, prazo: true, dataAgendada: true, concluidaEm: true,
        tecnicosEquipe: { select: { tecnicoId: true } },
      },
    }),
    avaliacoesPorTecnico(empresaId, periodo),
    osAvaliadas(empresaId, periodo),
    prisma.desempenhoPenalidade.groupBy({ by: ["tecnicoId", "tipo"], where: { empresaId, competencia, situacao: "CONTA", ...ITENS_QUE_VALEM }, _count: { _all: true } }),
  ]);

  const penalidades = new Map<string, PenalidadesQueContam>();
  for (const g of contam) {
    const p = penalidades.get(g.tecnicoId) ?? { retornos: 0, reclamacoes: 0 };
    if (ehRetorno(g.tipo)) p.retornos += g._count._all; else p.reclamacoes += g._count._all;
    penalidades.set(g.tecnicoId, p);
  }

  const relatorios = await relatoriosDasAtividades(empresaId, atividades.map((a) => ({ id: a.id, tipoOsId: a.tipoOsId, concluidaEm: a.concluidaEm! })));
  return {
    competencia,
    atividades: atividades.map((a) => ({
      id: a.id, ordemServicoId: a.ordemServicoId, equipeId: a.equipeId,
      executores: [...new Set([a.tecnicoId, ...a.tecnicosEquipe.map((t) => t.tecnicoId)].filter((x): x is string => !!x))],
      noPrazo: concluidaNoPrazo(a),
      equipamentos: relatorios.get(a.id) ?? [],
    })),
    avaliacoes: new Map(porTecnico.map((t) => [t.tecnicoId, { media: t.media, avaliacoes: t.avaliacoes }])),
    avaliadas: avaliadas.map((o) => ({ ordemServicoId: o.ordemServicoId, avaliacao: o.avaliacao, executores: o.executores.map((e) => e.id), equipeIds: o.equipeIds })),
    penalidades,
  };
}

/** Por atividade, cada equipamento ATENDIDO: o relatório dele está completo (regra do app)? Tem foto antes e depois? */
async function relatoriosDasAtividades(
  empresaId: string, atividades: { id: string; tipoOsId: string | null; concluidaEm: Date }[],
): Promise<Map<string, { completo: boolean; antesEDepois: boolean }[]>> {
  const saida = new Map<string, { completo: boolean; antesEDepois: boolean }[]>();
  const ids = atividades.map((a) => a.id);
  if (!ids.length) return saida;
  const vinculos = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId: { in: ids }, feito: true },
    select: { atividadeId: true, equipamento: { select: { id: true, tipoEquipamentoId: true } } },
  });
  if (!vinculos.length) return saida;
  const tipoIds = [...new Set(vinculos.map((v) => v.equipamento.tipoEquipamentoId).filter((x): x is string => !!x))];
  const tipoOsIds = [...new Set(atividades.map((a) => a.tipoOsId).filter((x): x is string => !!x))];

  const [itens, respostas, comAudio, fotos, mappings, respForm, comArquivo] = await Promise.all([
    tipoIds.length ? prisma.checklistTipoItem.findMany({
      where: { tipoEquipamentoId: { in: tipoIds }, ativo: true },
      select: { id: true, tipoEquipamentoId: true, texto: true, pedirFoto: true, pedirObservacao: true, ativo: true, tipoResposta: true, unidade: true, criadoEm: true },
    }) : Promise.resolve([]),
    prisma.checklistResposta.findMany({
      where: { atividadeId: { in: ids } },
      select: { id: true, atividadeId: true, equipamentoId: true, itemId: true, status: true, observacao: true, valor: true, unidade: true },
    }),
    // Só QUAIS respostas têm áudio (o áudio em si não é lido)
    prisma.checklistResposta.findMany({ where: { atividadeId: { in: ids }, audioUrl: { not: null } }, select: { id: true } }),
    prisma.fotoAtendimento.findMany({ where: { atividadeId: { in: ids } }, select: { atividadeId: true, equipamentoId: true, itemId: true, momento: true } }),
    tipoIds.length && tipoOsIds.length ? prisma.formTypeMapping.findMany({
      where: { empresaId, tipoOsId: { in: tipoOsIds }, tipoEquipamentoId: { in: tipoIds }, obrigatorioConcluir: true, formularioTemplate: { ativo: true } },
      select: {
        tipoOsId: true, tipoEquipamentoId: true,
        formularioTemplate: { select: { id: true, nome: true, campos: { where: { ativo: true }, select: { id: true, label: true, tipo: true, ativo: true } } } },
      },
    }) : Promise.resolve([]),
    prisma.respostaFormularioEquipamento.findMany({
      where: { atividadeId: { in: ids } },
      select: { atividadeId: true, equipamentoId: true, formularioId: true, campoId: true, resposta: true },
    }),
    // Só QUAIS campos têm arquivo (o arquivo em si não é lido)
    prisma.respostaFormularioEquipamento.findMany({
      where: { atividadeId: { in: ids }, arquivoUrl: { not: null } },
      select: { atividadeId: true, equipamentoId: true, formularioId: true, campoId: true },
    }),
  ]);

  const audios = new Set(comAudio.map((r) => r.id));
  const arquivos = new Set(comArquivo.map((r) => chave(r.atividadeId, r.equipamentoId, r.formularioId, r.campoId)));
  const itensDoTipo = new Map<string, typeof itens>();
  for (const i of itens) itensDoTipo.set(i.tipoEquipamentoId, [...(itensDoTipo.get(i.tipoEquipamentoId) ?? []), i]);
  const respostasDe = new Map<string, typeof respostas>();
  for (const r of respostas) { const k = chave(r.atividadeId, r.equipamentoId); respostasDe.set(k, [...(respostasDe.get(k) ?? []), r]); }
  const fotosDe = new Map<string, typeof fotos>();
  for (const f of fotos) { const k = chave(f.atividadeId, f.equipamentoId); fotosDe.set(k, [...(fotosDe.get(k) ?? []), f]); }
  const formDe = new Map(mappings.map((m) => [chave(m.tipoOsId, m.tipoEquipamentoId), m.formularioTemplate]));
  const respFormDe = new Map<string, typeof respForm>();
  for (const r of respForm) { const k = chave(r.atividadeId, r.equipamentoId, r.formularioId); respFormDe.set(k, [...(respFormDe.get(k) ?? []), r]); }
  const atividadeDe = new Map(atividades.map((a) => [a.id, a]));

  for (const v of vinculos) {
    const a = atividadeDe.get(v.atividadeId)!;
    const e = v.equipamento;
    // Só o que o checklist do tipo já pedia quando a atividade foi concluída
    const itensDaEpoca: ItemExecucao[] = (e.tipoEquipamentoId ? itensDoTipo.get(e.tipoEquipamentoId) ?? [] : [])
      .filter((i) => i.criadoEm.getTime() <= a.concluidaEm.getTime())
      .map((i) => ({ id: i.id, texto: i.texto, pedirFoto: i.pedirFoto, pedirObservacao: i.pedirObservacao, ativo: i.ativo, tipoResposta: i.tipoResposta as TipoResposta, unidade: i.unidade }));
    const resp: Record<string, RespostaItem> = Object.fromEntries((respostasDe.get(chave(a.id, e.id)) ?? []).map((r) => [r.itemId, {
      status: (r.status as StatusItem | null) ?? null, observacao: r.observacao, valor: numero(r.valor), unidade: r.unidade, audio: audios.has(r.id),
    }]));
    const minhasFotos = fotosDe.get(chave(a.id, e.id)) ?? [];
    const modelo = a.tipoOsId && e.tipoEquipamentoId ? formDe.get(chave(a.tipoOsId, e.tipoEquipamentoId)) : undefined;
    const formulario: FormularioExecucao | null = modelo ? {
      id: modelo.id, nome: modelo.nome, obrigatorioConcluir: true, campos: modelo.campos,
      respostas: Object.fromEntries(modelo.campos.map((c) => {
        const r = (respFormDe.get(chave(a.id, e.id, modelo.id)) ?? []).find((x) => x.campoId === c.id);
        return [c.id, { resposta: r?.resposta ?? null, arquivoUrl: arquivos.has(chave(a.id, e.id, modelo.id, c.id)) ? "arquivo" : null }];
      })),
    } : null;
    const entrada = paraPendencia({ feito: true, equipamento: { id: e.id, titulo: "", tag: null, local: null }, itens: itensDaEpoca, respostas: resp, fotos: minhasFotos, formulario });
    saida.set(a.id, [...(saida.get(a.id) ?? []), { completo: completo(faltasEquipamento(entrada)), antesEDepois: temAntesEDepois(minhasFotos) }]);
  }
  return saida;
}
