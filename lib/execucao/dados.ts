/**
 * Execução da OS por EQUIPAMENTO — carga do servidor. Para uma atividade: os equipamentos vinculados
 * e, de CADA um, o checklist do tipo dele (itens ativos + os já respondidos que saíram do checklist),
 * as respostas, as fotos (só os ids — a imagem é servida à parte), a observação e o formulário do
 * tipo (tipo de OS × tipo de equipamento), com o que falta para concluir.
 * A empresa SEMPRE vem da sessão de quem chama.
 */
import { prisma } from "@/lib/prisma";
import { ambienteEquipamento, descricaoEquipamento, fabricanteModelo } from "@/lib/equipamento-descricao";
import {
  completo, faltasEquipamento, paraPendencia, verificarConclusao, MSG_SEM_EQUIPAMENTO,
  type EquipamentoParaPendencia, type FaltasEquipamento, type FormularioExecucao, type ItemExecucao, type RespostaItem, type ResultadoConclusao, type StatusItem,
} from "@/lib/execucao/pendencias";

export const STATUS_BLOQUEADOS = ["CONCLUIDA", "CANCELADA"];

export const SELECT_EQUIP_EXECUCAO = {
  id: true, nome: true, tipo: true, marca: true, modelo: true, capacidade: true, localizacao: true, setor: true,
  patrimonio: true, numeroSerie: true, ativo: true, tipoEquipamentoId: true,
  tipoEquipamento: { select: { id: true, nome: true } }, unidade: { select: { nome: true, clienteId: true } },
} as const;

type EquipBanco = {
  id: string; nome: string | null; tipo: string; marca: string; modelo: string; capacidade: string | null;
  localizacao: string | null; setor: string | null; patrimonio: string | null; numeroSerie: string | null; ativo: boolean;
  tipoEquipamentoId: string | null; tipoEquipamento: { id: string; nome: string } | null; unidade: { nome: string; clienteId: string } | null;
};

/** Como o equipamento aparece na execução (o mesmo critério do relatório da OS). */
export function apresentarEquipamento(e: EquipBanco) {
  const amb = ambienteEquipamento(e, null);
  return {
    id: e.id,
    titulo: (e.nome ?? "").trim() || descricaoEquipamento(e),
    descricao: descricaoEquipamento(e),
    fabricante: fabricanteModelo(e),
    tag: (e.patrimonio ?? "").trim() || null,
    numeroSerie: (e.numeroSerie ?? "").trim() || null,
    local: [amb.principal, amb.complemento].filter(Boolean).join(" · ") || null,
    unidade: e.unidade?.nome ?? null,
    ativo: e.ativo,
    tipo: e.tipoEquipamento,
  };
}

export type CampoFormularioTela = { id: string; label: string; tipo: string; obrigatorio: boolean; ordem: number; opcoes: unknown; ativo: boolean };
export interface EquipamentoExecucao {
  vinculoId: string;
  feito: boolean;
  observacao: string | null;
  equipamento: ReturnType<typeof apresentarEquipamento>;
  itens: (ItemExecucao & { ordem: number })[];
  respostas: Record<string, RespostaItem>;
  fotos: { id: string; itemId: string | null; criadoEm: Date }[];
  formulario: (FormularioExecucao & { campos: CampoFormularioTela[] }) | null;
  faltas: FaltasEquipamento;
  completo: boolean;
}
export interface Execucao {
  atividade: { id: string; titulo: string; status: string; tipoOs: { id: string; nome: string; cor: string } | null };
  os: { id: string; numero: string; status: string; clienteId: string; unidadeId: string | null };
  /** Atividade concluída/cancelada: só leitura (reabra para editar) */
  bloqueada: boolean;
  equipamentos: EquipamentoExecucao[];
  conclusao: ResultadoConclusao;
}

export async function carregarExecucao(empresaId: string, osId: string, atividadeId: string): Promise<Execucao | null> {
  const atividade = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: osId, empresaId },
    select: {
      id: true, titulo: true, status: true, tipoOsId: true, tipoOs: { select: { id: true, nome: true, cor: true } },
      ordemServico: { select: { id: true, numero: true, status: true, clienteId: true, unidadeId: true } },
    },
  });
  if (!atividade) return null;

  const vinculos = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId },
    orderBy: { criadoEm: "asc" },
    select: { id: true, feito: true, observacao: true, equipamento: { select: SELECT_EQUIP_EXECUCAO } },
  });
  const tipoIds = [...new Set(vinculos.map((v) => v.equipamento.tipoEquipamentoId).filter((x): x is string => !!x))];

  const [itensAtivos, respostas, fotos, mappings, respForm] = await Promise.all([
    tipoIds.length ? prisma.checklistTipoItem.findMany({
      where: { tipoEquipamentoId: { in: tipoIds }, ativo: true },
      orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
      select: { id: true, tipoEquipamentoId: true, texto: true, pedirFoto: true, pedirObservacao: true, ativo: true, ordem: true },
    }) : Promise.resolve([]),
    prisma.checklistResposta.findMany({
      where: { atividadeId },
      select: {
        equipamentoId: true, itemId: true, status: true, observacao: true, textoItem: true,
        item: { select: { id: true, tipoEquipamentoId: true, pedirFoto: true, pedirObservacao: true, ativo: true, ordem: true } },
      },
    }),
    prisma.fotoAtendimento.findMany({ where: { atividadeId }, orderBy: { criadoEm: "asc" }, select: { id: true, equipamentoId: true, itemId: true, criadoEm: true } }),
    atividade.tipoOsId && tipoIds.length ? prisma.formTypeMapping.findMany({
      where: { empresaId, tipoOsId: atividade.tipoOsId, tipoEquipamentoId: { in: tipoIds } },
      select: {
        tipoEquipamentoId: true, obrigatorioConcluir: true,
        formularioTemplate: {
          select: {
            id: true, nome: true, ativo: true,
            // Campos ativos + os removidos que JÁ têm resposta nesta atividade (o registro não some)
            campos: {
              where: { OR: [{ ativo: true }, { respostasEquipamento: { some: { atividadeId } } }] },
              orderBy: { ordem: "asc" },
              select: { id: true, label: true, tipo: true, obrigatorio: true, ordem: true, opcoes: true, ativo: true },
            },
          },
        },
      },
    }) : Promise.resolve([]),
    prisma.respostaFormularioEquipamento.findMany({
      where: { atividadeId },
      select: { equipamentoId: true, formularioId: true, campoId: true, resposta: true, arquivoUrl: true },
    }),
  ]);

  const formsRespondidos = new Set(respForm.map((r) => r.formularioId));
  const formPorTipo = new Map(mappings
    // Formulário inativo: some de quem ainda não respondeu; quem já respondeu continua vendo, sem exigir
    .filter((m) => m.formularioTemplate.ativo || formsRespondidos.has(m.formularioTemplate.id))
    .map((m) => [m.tipoEquipamentoId, m]));

  const paraConclusao: EquipamentoParaPendencia[] = [];
  const equipamentos: EquipamentoExecucao[] = vinculos.map((v) => {
    const e = v.equipamento;
    const minhas = respostas.filter((r) => r.equipamentoId === e.id);
    const ativosDoTipo = itensAtivos.filter((i) => i.tipoEquipamentoId === e.tipoEquipamentoId);
    const ids = new Set(ativosDoTipo.map((i) => i.id));
    // Itens respondidos que não estão mais no checklist do tipo (removidos, ou o tipo mudou): ficam à mostra, sem exigir
    const antigos = minhas.filter((r) => !ids.has(r.itemId)).map((r) => ({
      id: r.itemId, texto: r.textoItem, pedirFoto: r.item.pedirFoto, pedirObservacao: r.item.pedirObservacao, ativo: false, ordem: 10_000 + r.item.ordem,
    }));
    const itens = [...ativosDoTipo.map(({ tipoEquipamentoId: _t, ...i }) => i), ...antigos];
    const resp: Record<string, RespostaItem> = Object.fromEntries(minhas.map((r) => [r.itemId, { status: (r.status as StatusItem | null) ?? null, observacao: r.observacao }]));
    const minhasFotos = fotos.filter((f) => f.equipamentoId === e.id).map(({ equipamentoId: _e, ...f }) => f);

    const m = e.tipoEquipamentoId ? formPorTipo.get(e.tipoEquipamentoId) : undefined;
    const formulario = m ? {
      id: m.formularioTemplate.id,
      nome: m.formularioTemplate.nome,
      obrigatorioConcluir: m.obrigatorioConcluir && m.formularioTemplate.ativo,
      campos: m.formularioTemplate.campos.map((c) => (c.ativo ? c : { ...c, obrigatorio: false })),
      respostas: Object.fromEntries(respForm.filter((r) => r.equipamentoId === e.id && r.formularioId === m.formularioTemplate.id)
        .map((r) => [r.campoId, { resposta: r.resposta, arquivoUrl: r.arquivoUrl }])),
    } : null;

    const equipamento = apresentarEquipamento(e);
    const entrada = paraPendencia({ feito: v.feito, equipamento, itens, respostas: resp, fotos: minhasFotos, formulario });
    paraConclusao.push(entrada);
    const faltas = faltasEquipamento(entrada);
    return { vinculoId: v.id, feito: v.feito, observacao: v.observacao, equipamento, itens, respostas: resp, fotos: minhasFotos, formulario, faltas, completo: completo(faltas) };
  });
  const conclusao = verificarConclusao(paraConclusao);

  return {
    atividade: { id: atividade.id, titulo: atividade.titulo, status: atividade.status, tipoOs: atividade.tipoOs },
    os: atividade.ordemServico,
    bloqueada: STATUS_BLOQUEADOS.includes(atividade.status),
    equipamentos,
    conclusao,
  };
}

/**
 * Pode concluir a OS? Junta as atividades (menos as canceladas): precisa de pelo menos 1 equipamento
 * atendido na OS e de todos os atendidos completos. Mensagem já diz a atividade de cada pendência.
 */
export async function verificarConclusaoOs(empresaId: string, osId: string): Promise<{ ok: boolean; mensagem: string | null; pendencias: { atividade: string; pendencias: ResultadoConclusao["pendencias"] }[] }> {
  const atividades = await prisma.atividadeOs.findMany({
    where: { ordemServicoId: osId, empresaId, status: { not: "CANCELADA" } },
    orderBy: { criadoEm: "asc" }, select: { id: true, titulo: true },
  });
  const execs = (await Promise.all(atividades.map((a) => carregarExecucao(empresaId, osId, a.id)))).filter((x): x is Execucao => !!x);
  const atendidos = execs.reduce((n, x) => n + x.conclusao.atendidos, 0);
  if (!atendidos) return { ok: false, mensagem: MSG_SEM_EQUIPAMENTO, pendencias: [] };
  const pendencias = execs.filter((x) => x.conclusao.pendencias.length).map((x) => ({ atividade: x.atividade.titulo, pendencias: x.conclusao.pendencias }));
  if (!pendencias.length) return { ok: true, mensagem: null, pendencias };
  const linhas = execs.filter((x) => x.conclusao.pendencias.length).map((x) => `Atividade “${x.atividade.titulo}”: ${x.conclusao.mensagem!.replace(/^Para concluir, falta: /, "").replace(/\.$/, "")}`);
  return { ok: false, mensagem: `Para concluir a OS, falta: ${linhas.join(" | ")}.`, pendencias };
}
