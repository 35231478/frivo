/**
 * DESEMPENHO — a lista "A REVISAR". Retorno e ressalva do cliente são DETECTADOS do que a operação
 * já grava; a reclamação por fora (telefone, WhatsApp) é registrada à mão. Em todos os casos:
 *
 *  - NADA pesa no escore sozinho: o item nasce "A_REVISAR" e só conta depois de alguém marcar
 *    "CONTA", com motivo. "NAO_CONTA" também pede motivo. Dá para voltar atrás.
 *  - NUNCA se penaliza quem REGISTROU o problema: se no serviço anterior o colaborador apontou
 *    atenção no checklist, abriu ocorrência ou serviço adicional naquele equipamento, a OS corretiva
 *    que veio depois não é retorno. OS corretiva nascida de uma ocorrência ou de um orçamento
 *    aprovado também não.
 *  - Ninguém revisa a própria penalidade.
 *
 * A detecção é IDEMPOTENTE: cada fato tem uma chave única por colaborador; rodar de novo não duplica
 * nem mexe no que já foi decidido. Só entram fatos a partir do mês em que a empresa abriu o módulo.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inicioMesBR, instanteBR } from "@/lib/fuso";
import { rotuloDoEquipamento } from "@/lib/pmoc-ocorrencias";
import { competenciaDe, descricaoDaRessalva, origemDoRetorno, type ServicoNoEquipamento, type SituacaoPenalidade, type TipoPenalidade, type decisaoSchema, type reclamacaoSchema } from "./regras";
import { ErroDesempenho, type Ator } from "./erros";
import { competenciasFechadas, exigirMesAberto } from "./fechamento-estado";
import { ITENS_QUE_VALEM } from "./itens-validos";

/** Até quanto tempo para trás a detecção olha (além do início do módulo na empresa) */
export const JANELA_DETECCAO_DIAS = 92;
const DIA_MS = 86_400_000;

export const MSG_PROPRIA = "Não é possível revisar a própria penalidade. Peça a outra pessoa da gestão.";
export const MSG_PENALIDADE_NAO_ENCONTRADA = "Item não encontrado.";
export const MSG_SO_MANUAL = "Só a reclamação registrada à mão pode ser editada ou excluída.";
export const MSG_FORA_DO_DESEMPENHO = "Este colaborador não participa do Desempenho.";
export const MSG_DATA_FUTURA = "A data da reclamação não pode ser no futuro.";
export const MSG_OS_NAO_ENCONTRADA = "OS não encontrada. Confira o número ou deixe em branco.";

const curto = (texto: string, max = 240) => (texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto);

/* ───────── detecção ───────── */

interface Novo { tecnicoId: string; tipo: TipoPenalidade; chave: string; ordemServicoId: string | null; osRetornoId: string | null; equipamentoId: string | null; dataFato: Date; descricao: string }

/** Detecta o que ainda não está na lista e grava como "A_REVISAR". Devolve quantos itens novos entraram. */
export async function sincronizarPenalidades(empresaId: string, agora: Date = new Date()): Promise<number> {
  const config = await prisma.desempenhoConfig.findUnique({ where: { empresaId }, select: { retornoDias: true, criadoEm: true } });
  if (!config) return 0;
  const desde = new Date(Math.max(inicioMesBR(config.criadoEm).getTime(), agora.getTime() - JANELA_DETECCAO_DIAS * DIA_MS));
  const participantes = new Set((await prisma.desempenhoParticipante.findMany({ where: { empresaId }, select: { tecnicoId: true } })).map((p) => p.tecnicoId));
  if (!participantes.size) return 0;

  const novos = [...await ressalvas(empresaId, desde, participantes), ...await retornos(empresaId, desde, config.retornoDias, participantes)];
  if (!novos.length) return 0;
  // Mês fechado não recebe item novo (o escore dele já é definitivo)
  const fechadas = await competenciasFechadas(empresaId);
  const dados = novos.map((n) => ({ empresaId, ...n, competencia: competenciaDe(n.dataFato) })).filter((n) => !fechadas.has(n.competencia));
  if (!dados.length) return 0;
  const { count } = await prisma.desempenhoPenalidade.createMany({ data: dados, skipDuplicates: true });
  return count;
}

/**
 * Ressalva escrita pelo cliente no aceite: um item por aceite e por colaborador que executou a OS —
 * TENHA O CLIENTE DADO NOTA OU NÃO. A nota segue contando só na média da avaliação; a ressalva é o
 * sinal qualitativo à parte (5 estrelas com um problema escrito não some). A descrição leva a nota
 * para quem revisa enxergar as duas coisas juntas. Nota baixa SEM ressalva nunca vira item.
 */
async function ressalvas(empresaId: string, desde: Date, participantes: Set<string>): Promise<Novo[]> {
  const aceites = await prisma.osAceite.findMany({
    where: {
      empresaId, situacao: "CONFIRMADO", confirmadoEm: { gte: desde }, ordemServico: { empresaId, status: { not: "CANCELADA" } },
      ressalva: { not: null },
    },
    select: {
      id: true, ordemServicoId: true, ressalva: true, avaliacao: true, confirmadoEm: true,
      ordemServico: { select: { numero: true, atividades: { where: { status: "CONCLUIDA" }, select: { tecnicoId: true, tecnicosEquipe: { select: { tecnicoId: true } } } } } },
    },
  });
  const novos: Novo[] = [];
  for (const a of aceites) {
    const ressalva = (a.ressalva ?? "").trim();
    if (!ressalva) continue;
    const descricao = curto(descricaoDaRessalva(a.ordemServico.numero, ressalva, a.avaliacao));
    const executores = new Set(a.ordemServico.atividades.flatMap((x) => [x.tecnicoId, ...x.tecnicosEquipe.map((t) => t.tecnicoId)]).filter((x): x is string => !!x));
    for (const tecnicoId of executores) {
      if (!participantes.has(tecnicoId)) continue;
      novos.push({
        tecnicoId, tipo: "RESSALVA", chave: `ACEITE:${a.id}:${tecnicoId}`,
        ordemServicoId: a.ordemServicoId, osRetornoId: null, equipamentoId: null, dataFato: a.confirmadoEm!, descricao,
      });
    }
  }
  return novos;
}

/** Retorno: OS corretiva no mesmo equipamento até N dias depois do último serviço — de quem fez esse serviço. */
async function retornos(empresaId: string, desde: Date, dias: number, participantes: Set<string>): Promise<Novo[]> {
  const tipos = (await prisma.desempenhoTipoRetorno.findMany({ where: { empresaId }, select: { tipoOsId: true } })).map((t) => t.tipoOsId);
  if (!tipos.length) return [];
  const corretivas = await prisma.atividadeOs.findMany({
    where: {
      empresaId, tipoOsId: { in: tipos }, status: { not: "CANCELADA" },
      // OS nascida de ocorrência registrada ou de orçamento aprovado é serviço previsto, não retorno
      ordemServico: { empresaId, status: { not: "CANCELADA" }, criadoEm: { gte: desde }, orcamentoOrigemId: null, pmocOcorrenciasCorretivas: { none: {} } },
    },
    select: { ordemServico: { select: { id: true, numero: true, criadoEm: true, equipamentoId: true } }, equipamentos: { select: { equipamentoId: true } } },
  });
  // Uma entrada por (OS corretiva, equipamento)
  const alvos = new Map<string, { os: { id: string; numero: string; criadoEm: Date }; equipamentoId: string }>();
  for (const c of corretivas) {
    for (const equipamentoId of [c.ordemServico.equipamentoId, ...c.equipamentos.map((e) => e.equipamentoId)]) {
      if (equipamentoId) alvos.set(`${c.ordemServico.id}:${equipamentoId}`, { os: c.ordemServico, equipamentoId });
    }
  }
  if (!alvos.size) return [];

  const equipamentoIds = [...new Set([...alvos.values()].map((a) => a.equipamentoId))];
  const servicos = await prisma.atividadeEquipamento.findMany({
    where: {
      equipamentoId: { in: equipamentoIds }, feito: true, feitoEm: { gte: new Date(desde.getTime() - dias * DIA_MS) },
      atividade: { empresaId, status: "CONCLUIDA", ordemServico: { status: { not: "CANCELADA" } } },
    },
    select: {
      equipamentoId: true, feitoEm: true, atividadeId: true,
      equipamento: { select: { nome: true, marca: true, modelo: true, patrimonio: true } },
      atividade: { select: { ordemServicoId: true, tecnicoId: true, tecnicosEquipe: { select: { tecnicoId: true } }, ordemServico: { select: { numero: true } } } },
    },
  });
  const porEquipamento = new Map<string, typeof servicos>();
  for (const s of servicos) porEquipamento.set(s.equipamentoId, [...(porEquipamento.get(s.equipamentoId) ?? []), s]);

  // Para cada OS corretiva, o serviço de onde ela "volta"
  const candidatos: { alvo: { os: { id: string; numero: string; criadoEm: Date }; equipamentoId: string }; origem: (typeof servicos)[number] }[] = [];
  for (const alvo of alvos.values()) {
    const lista = porEquipamento.get(alvo.equipamentoId) ?? [];
    const pura: (ServicoNoEquipamento & { i: number })[] = lista.map((s, i) => ({ atividadeId: s.atividadeId, ordemServicoId: s.atividade.ordemServicoId, feitoEm: s.feitoEm!, i }));
    const origem = origemDoRetorno(pura, { ordemServicoId: alvo.os.id, abertaEm: alvo.os.criadoEm }, dias) as (ServicoNoEquipamento & { i: number }) | null;
    if (origem) candidatos.push({ alvo, origem: lista[origem.i] });
  }
  if (!candidatos.length) return [];

  // Quem REGISTROU o problema no serviço anterior não é penalizado pelo retorno
  const atividadeIds = [...new Set(candidatos.map((c) => c.origem.atividadeId))];
  const osIds = [...new Set(candidatos.map((c) => c.origem.atividade.ordemServicoId))];
  const [atencoes, ocorrencias, adicionais] = await Promise.all([
    prisma.checklistResposta.findMany({ where: { atividadeId: { in: atividadeIds }, status: "ATENCAO" }, select: { atividadeId: true, equipamentoId: true } }),
    prisma.pmocOcorrencia.findMany({
      where: { empresaId, ativo: true, OR: [{ atividadeId: { in: atividadeIds } }, { ordemServicoId: { in: osIds } }] },
      select: { atividadeId: true, ordemServicoId: true, equipamentoId: true },
    }),
    prisma.servicoAdicional.findMany({ where: { empresaId, atividadeId: { in: atividadeIds } }, select: { atividadeId: true, equipamentoId: true } }),
  ]);
  const registrou = (c: (typeof candidatos)[number]) => {
    const { atividadeId, equipamentoId } = c.origem;
    const doEquipamento = (x: { equipamentoId: string | null }) => !x.equipamentoId || x.equipamentoId === equipamentoId;
    return atencoes.some((r) => r.atividadeId === atividadeId && r.equipamentoId === equipamentoId)
      || ocorrencias.some((o) => (o.atividadeId === atividadeId || o.ordemServicoId === c.origem.atividade.ordemServicoId) && doEquipamento(o))
      || adicionais.some((s) => s.atividadeId === atividadeId && doEquipamento(s));
  };

  const novos: Novo[] = [];
  for (const c of candidatos) {
    if (registrou(c)) continue;
    const { alvo, origem } = c;
    const diasDepois = Math.max(0, Math.round((alvo.os.criadoEm.getTime() - origem.feitoEm!.getTime()) / DIA_MS));
    const descricao = curto(`${alvo.os.numero} (corretiva) aberta ${diasDepois === 1 ? "1 dia" : `${diasDepois} dias`} depois do serviço da ${origem.atividade.ordemServico.numero} em ${rotuloDoEquipamento(origem.equipamento)}`);
    const executores = new Set([origem.atividade.tecnicoId, ...origem.atividade.tecnicosEquipe.map((t) => t.tecnicoId)].filter((x): x is string => !!x));
    for (const tecnicoId of executores) {
      if (!participantes.has(tecnicoId)) continue;
      novos.push({
        tecnicoId, tipo: "RETORNO", chave: `RETORNO:${alvo.os.id}:${alvo.equipamentoId}:${tecnicoId}`,
        ordemServicoId: origem.atividade.ordemServicoId, osRetornoId: alvo.os.id, equipamentoId: alvo.equipamentoId, dataFato: alvo.os.criadoEm, descricao,
      });
    }
  }
  return novos;
}

/* ───────── a lista ───────── */

const SELECT_PENALIDADE = {
  id: true, tipo: true, situacao: true, descricao: true, dataFato: true, competencia: true, motivo: true, revisadoEm: true, criadoEm: true,
  tecnico: { select: { id: true, nome: true } },
  ordemServico: { select: { id: true, numero: true } },
  osRetorno: { select: { id: true, numero: true } },
  revisadoPor: { select: { nome: true } },
  criadoPor: { select: { nome: true } },
} satisfies Prisma.DesempenhoPenalidadeSelect;
type Linha = Prisma.DesempenhoPenalidadeGetPayload<{ select: typeof SELECT_PENALIDADE }>;

export interface PenalidadeNaLista {
  id: string; tipo: TipoPenalidade; situacao: SituacaoPenalidade; descricao: string | null; dataFato: string; competencia: string;
  motivo: string | null; revisadoEm: string | null; revisadoPor: string | null; criadoPor: string | null;
  tecnico: { id: string; nome: string };
  ordemServico: { id: string; numero: string } | null;
  osRetorno: { id: string; numero: string } | null;
  /** Registrada à mão (pode ser editada e excluída); as detectadas não */
  manual: boolean;
  /** O mês em que pesa está fechado: não dá para decidir, editar nem excluir sem reabrir */
  mesFechado: boolean;
}

const serializar = (p: Linha, fechadas: Set<string> = new Set()): PenalidadeNaLista => ({
  id: p.id, tipo: p.tipo as TipoPenalidade, situacao: p.situacao as SituacaoPenalidade, descricao: p.descricao, dataFato: p.dataFato.toISOString(),
  competencia: p.competencia, motivo: p.motivo, revisadoEm: p.revisadoEm?.toISOString() ?? null, revisadoPor: p.revisadoPor?.nome ?? null,
  criadoPor: p.criadoPor?.nome ?? null, tecnico: p.tecnico, ordemServico: p.ordemServico, osRetorno: p.osRetorno, manual: p.tipo === "RECLAMACAO", mesFechado: fechadas.has(p.competencia),
});

export interface ListaDePenalidades {
  itens: PenalidadeNaLista[];
  /** Quantos esperam a revisão, nos meses abertos */
  aRevisar: number;
  /** Quem pode receber uma reclamação registrada à mão: os participantes */
  colaboradores: { id: string; nome: string }[];
}

/** A lista (detecta o que falta antes de listar). `situacao` vazio = todas. Mais recentes primeiro. */
export async function listarPenalidades(empresaId: string, filtro: { situacao?: string | null; competencia?: string | null } = {}, agora: Date = new Date()): Promise<ListaDePenalidades> {
  await sincronizarPenalidades(empresaId, agora);
  const fechadas = await competenciasFechadas(empresaId);
  const [itens, aRevisar, colaboradores] = await Promise.all([
    prisma.desempenhoPenalidade.findMany({
      where: { empresaId, ...ITENS_QUE_VALEM, ...(filtro.situacao && { situacao: filtro.situacao }), ...(filtro.competencia && { competencia: filtro.competencia }) },
      orderBy: [{ dataFato: "desc" }, { id: "desc" }], take: 300, select: SELECT_PENALIDADE,
    }),
    contarARevisar(empresaId, fechadas),
    prisma.desempenhoParticipante.findMany({ where: { empresaId }, orderBy: { tecnico: { nome: "asc" } }, select: { tecnico: { select: { id: true, nome: true } } } }),
  ]);
  return { itens: itens.map((i) => serializar(i, fechadas)), aRevisar, colaboradores: colaboradores.map((c) => c.tecnico) };
}

/** Quantos itens válidos esperam a revisão nos meses ABERTOS (mês fechado não se revisa mais). */
export async function contarARevisar(empresaId: string, fechadas?: Set<string>): Promise<number> {
  const meses = [...(fechadas ?? await competenciasFechadas(empresaId))];
  return prisma.desempenhoPenalidade.count({ where: { empresaId, situacao: "A_REVISAR", ...ITENS_QUE_VALEM, ...(meses.length && { competencia: { notIn: meses } }) } });
}

/* ───────── a revisão ───────── */

export interface Revisor extends Ator { /** O colaborador ligado ao usuário que revisa (ninguém revisa a si mesmo) */ tecnicoId: string | null }

async function penalidadeDaEmpresa(empresaId: string, id: string) {
  const p = await prisma.desempenhoPenalidade.findFirst({ where: { id, empresaId, ...ITENS_QUE_VALEM }, select: { id: true, tipo: true, tecnicoId: true, competencia: true } });
  if (!p) throw new ErroDesempenho(MSG_PENALIDADE_NAO_ENCONTRADA, 404);
  // Mês fechado: a decisão, a edição e a exclusão ficam travadas até alguém reabrir o mês
  await exigirMesAberto(empresaId, p.competencia);
  return p;
}

/** "Conta" / "não conta" (com motivo) ou de volta para "a revisar". Fica gravado quem decidiu e quando. */
export async function decidirPenalidade(revisor: Revisor, id: string, d: z.infer<typeof decisaoSchema>, agora: Date = new Date()): Promise<PenalidadeNaLista> {
  const p = await penalidadeDaEmpresa(revisor.empresaId, id);
  if (revisor.tecnicoId && revisor.tecnicoId === p.tecnicoId) throw new ErroDesempenho(MSG_PROPRIA, 403);
  const decidido = d.situacao !== "A_REVISAR";
  const linha = await prisma.desempenhoPenalidade.update({
    where: { id },
    data: { situacao: d.situacao, motivo: d.motivo, revisadoPorId: decidido ? revisor.usuarioId : null, revisadoEm: decidido ? agora : null },
    select: SELECT_PENALIDADE,
  });
  return serializar(linha);
}

/* ───────── reclamação registrada à mão ───────── */

async function dadosDaReclamacao(empresaId: string, d: z.infer<typeof reclamacaoSchema>, agora: Date) {
  const participante = await prisma.desempenhoParticipante.findFirst({ where: { tecnicoId: d.tecnicoId, empresaId }, select: { id: true } });
  if (!participante) throw new ErroDesempenho(MSG_FORA_DO_DESEMPENHO, 404);
  const [ano, mes, dia] = d.data.split("-").map(Number);
  const dataFato = instanteBR(ano, mes - 1, dia, 12);
  if (Number.isNaN(dataFato.getTime())) throw new ErroDesempenho("Informe a data da reclamação.");
  if (dataFato.getTime() > agora.getTime() + DIA_MS / 2) throw new ErroDesempenho(MSG_DATA_FUTURA);
  let ordemServicoId: string | null = null;
  if (d.osNumero) {
    const os = await prisma.ordemServico.findFirst({ where: { empresaId, numero: { equals: d.osNumero, mode: "insensitive" } }, select: { id: true } });
    if (!os) throw new ErroDesempenho(MSG_OS_NAO_ENCONTRADA, 404);
    ordemServicoId = os.id;
  }
  await exigirMesAberto(empresaId, d.data.slice(0, 7));
  return { tecnicoId: d.tecnicoId, dataFato, competencia: d.data.slice(0, 7), descricao: d.descricao, ordemServicoId };
}

/** Registra a reclamação. Nasce "A_REVISAR" como tudo: registrar não é penalizar. */
export async function registrarReclamacao(ator: Ator, d: z.infer<typeof reclamacaoSchema>, agora: Date = new Date()): Promise<PenalidadeNaLista> {
  const dados = await dadosDaReclamacao(ator.empresaId, d, agora);
  const linha = await prisma.desempenhoPenalidade.create({
    data: { empresaId: ator.empresaId, tipo: "RECLAMACAO", chave: `MANUAL:${randomUUID()}`, criadoPorId: ator.usuarioId, ...dados },
    select: SELECT_PENALIDADE,
  });
  return serializar(linha);
}

/** Corrige a reclamação registrada à mão. Mudou o fato: a decisão anterior cai e ela volta para "a revisar". */
export async function atualizarReclamacao(ator: Ator, id: string, d: z.infer<typeof reclamacaoSchema>, agora: Date = new Date()): Promise<PenalidadeNaLista> {
  const p = await penalidadeDaEmpresa(ator.empresaId, id);
  if (p.tipo !== "RECLAMACAO") throw new ErroDesempenho(MSG_SO_MANUAL, 409);
  const dados = await dadosDaReclamacao(ator.empresaId, d, agora);
  const linha = await prisma.desempenhoPenalidade.update({
    where: { id }, data: { ...dados, situacao: "A_REVISAR", motivo: null, revisadoPorId: null, revisadoEm: null }, select: SELECT_PENALIDADE,
  });
  return serializar(linha);
}

export async function excluirReclamacao(ator: Ator, id: string) {
  const p = await penalidadeDaEmpresa(ator.empresaId, id);
  if (p.tipo !== "RECLAMACAO") throw new ErroDesempenho(MSG_SO_MANUAL, 409);
  await prisma.desempenhoPenalidade.delete({ where: { id } });
  return { ok: true };
}
