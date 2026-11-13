/**
 * DESEMPENHO — servidor: a configuração (ajustes, perfis, regras por vigência, participantes, link
 * da TV), o painel do mês e a ficha do colaborador. Tudo por empresa (`empresaId` em toda consulta).
 *
 * O módulo só existe para a empresa depois que a gestão abre a configuração: é aí que nasce
 * "desempenho_config" — e a data dela é o início da medição.
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  PERFIS_INICIAIS, competenciaAtual, competenciaSeguinte, lerFaixas, regraAgendada, regraVigente, vigenciaDaMudanca,
  type Regra, type TipoPerfil,
} from "./regras";
import { linhaDoColaborador, montarPainel, paraTv, type EquipeDoMes, type GrupoRanking, type LinhaRanking, type Painel, type PainelTv, type ParticipanteDoMes, type PerfilDoMes, type PremiacaoNaTela, type RegraDoMes } from "./painel";
import { medirMes } from "./medicao-server";
import { ErroDesempenho, type Ator } from "./erros";
import { sincronizarPenalidades } from "./penalidades-server";
import type { z } from "zod";
import type { ajustesSchema, participanteSchema, perfilSchema } from "./regras";

export { ErroDesempenho, responder, type Ator } from "./erros";

const ehUnico = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

export const MSG_INATIVO = "O Desempenho ainda não foi configurado nesta empresa.";
export const MSG_PERFIL_NAO_ENCONTRADO = "Perfil não encontrado.";
export const MSG_PERFIL_REPETIDO = "Já existe um perfil com este nome.";
export const MSG_PERFIL_COM_GENTE = "Este perfil tem colaboradores. Mude-os de perfil ou tire-os do Desempenho antes de excluir.";
export const MSG_TIPO_TRAVADO = "O tipo do perfil não muda depois que ele tem regra. Crie outro perfil.";

/* ───────── ativação ───────── */

export const desempenhoAtivo = async (empresaId: string) => !!(await prisma.desempenhoConfig.findUnique({ where: { empresaId }, select: { id: true } }));

/**
 * Garante a configuração da empresa. Na primeira vez cria os ajustes e os quatro perfis iniciais
 * (sem regra: nada vale enquanto a gestão não salvar os pesos e as faixas de cada um).
 */
export async function garantirDesempenho(empresaId: string, agora: Date = new Date()) {
  const existente = await prisma.desempenhoConfig.findUnique({ where: { empresaId } });
  if (existente) return existente;
  try {
    return await prisma.$transaction(async (tx) => {
      // A data de criação é o início da medição: nada anterior a este mês entra na lista "a revisar"
      const config = await tx.desempenhoConfig.create({ data: { empresaId, criadoEm: agora } });
      await tx.desempenhoPerfil.createMany({
        data: PERFIS_INICIAIS.map((p, ordem) => ({ empresaId, nome: p.nome, tipo: p.tipo, ordem })), skipDuplicates: true,
      });
      return config;
    });
  } catch (e) {
    // Duas pessoas abrindo a configuração ao mesmo tempo: a segunda usa a que a primeira criou
    if (ehUnico(e)) return prisma.desempenhoConfig.findUniqueOrThrow({ where: { empresaId } });
    throw e;
  }
}

/* ───────── leitura das regras ───────── */

const SELECT_REGRA = {
  id: true, vigenteDesde: true, pesoPrazo: true, pesoRelatorio: true, pesoAvaliacao: true, exigirFotoAntesDepois: true,
  penalidadeRetorno: true, penalidadeReclamacao: true, metaMinima: true, faixas: true,
} satisfies Prisma.DesempenhoRegraSelect;
type LinhaRegra = Prisma.DesempenhoRegraGetPayload<{ select: typeof SELECT_REGRA }>;

const paraRegra = (r: LinhaRegra): RegraDoMes => ({
  vigenteDesde: r.vigenteDesde, pesoPrazo: r.pesoPrazo, pesoRelatorio: r.pesoRelatorio, pesoAvaliacao: r.pesoAvaliacao,
  exigirFotoAntesDepois: r.exigirFotoAntesDepois, penalidadeRetorno: r.penalidadeRetorno, penalidadeReclamacao: r.penalidadeReclamacao,
  metaMinima: r.metaMinima, faixas: lerFaixas(r.faixas),
});

const ATIVO_NO_QUADRO = { ativo: true, statusColaborador: { not: "INATIVO" } } satisfies Prisma.TecnicoWhereInput;

/* ───────── a tela de configuração ───────── */

export interface PerfilNaConfiguracao {
  id: string; nome: string; tipo: TipoPerfil; ordem: number;
  /** A regra que vale no mês corrente e a mudança já gravada para depois, se houver */
  vigente: RegraDoMes | null;
  agendada: RegraDoMes | null;
  participantes: { tecnicoId: string; nome: string }[];
}
export interface ConfiguracaoDoDesempenho {
  competencia: string; competenciaSeguinte: string;
  ajustes: { retornoDias: number; notaBaixaAte: number; tiposRetorno: string[] };
  tiposOs: { id: string; nome: string; ativo: boolean }[];
  tvToken: string | null;
  perfis: PerfilNaConfiguracao[];
  /** Colaboradores ativos que ainda não estão em nenhum perfil */
  disponiveis: { id: string; nome: string; cargo: string | null }[];
}

export async function configuracaoDoDesempenho(empresaId: string, agora: Date = new Date()): Promise<ConfiguracaoDoDesempenho> {
  const config = await garantirDesempenho(empresaId, agora);
  const competencia = competenciaAtual(agora);
  const [tiposRetorno, tiposOs, perfis, disponiveis] = await Promise.all([
    prisma.desempenhoTipoRetorno.findMany({ where: { empresaId }, select: { tipoOsId: true } }),
    prisma.tipoOs.findMany({ where: { empresaId }, orderBy: { nome: "asc" }, select: { id: true, nome: true, ativo: true } }),
    prisma.desempenhoPerfil.findMany({
      where: { empresaId }, orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      select: {
        id: true, nome: true, tipo: true, ordem: true, regras: { select: SELECT_REGRA },
        participantes: { orderBy: { tecnico: { nome: "asc" } }, select: { tecnicoId: true, tecnico: { select: { nome: true } } } },
      },
    }),
    prisma.tecnico.findMany({
      where: { empresaId, ...ATIVO_NO_QUADRO, desempenhoParticipante: { is: null } },
      orderBy: { nome: "asc" }, select: { id: true, nome: true, cargo: { select: { nome: true } } },
    }),
  ]);
  const marcados = new Set(tiposRetorno.map((t) => t.tipoOsId));
  return {
    competencia, competenciaSeguinte: competenciaSeguinte(competencia),
    ajustes: { retornoDias: config.retornoDias, notaBaixaAte: config.notaBaixaAte, tiposRetorno: [...marcados] },
    // Tipo inativo só aparece se já estava marcado (para poder desmarcar)
    tiposOs: tiposOs.filter((t) => t.ativo || marcados.has(t.id)),
    tvToken: config.tvToken,
    perfis: perfis.map((p) => {
      const vigente = regraVigente(p.regras, competencia);
      const agendada = regraAgendada(p.regras, competencia);
      return {
        id: p.id, nome: p.nome, tipo: p.tipo as TipoPerfil, ordem: p.ordem,
        vigente: vigente ? paraRegra(vigente) : null, agendada: agendada ? paraRegra(agendada) : null,
        participantes: p.participantes.map((x) => ({ tecnicoId: x.tecnicoId, nome: x.tecnico.nome })),
      };
    }),
    disponiveis: disponiveis.map((t) => ({ id: t.id, nome: t.nome, cargo: t.cargo?.nome ?? null })),
  };
}

/* ───────── ajustes gerais ───────── */

export async function salvarAjustes(ator: Ator, d: z.infer<typeof ajustesSchema>) {
  await garantirDesempenho(ator.empresaId);
  const ids = [...new Set(d.tiposRetorno)];
  const validos = ids.length ? await prisma.tipoOs.findMany({ where: { empresaId: ator.empresaId, id: { in: ids } }, select: { id: true } }) : [];
  if (validos.length !== ids.length) throw new ErroDesempenho("Tipo de OS não encontrado.", 404);
  await prisma.$transaction([
    prisma.desempenhoConfig.update({ where: { empresaId: ator.empresaId }, data: { retornoDias: d.retornoDias, notaBaixaAte: d.notaBaixaAte } }),
    prisma.desempenhoTipoRetorno.deleteMany({ where: { empresaId: ator.empresaId, tipoOsId: { notIn: ids } } }),
    prisma.desempenhoTipoRetorno.createMany({ data: ids.map((tipoOsId) => ({ empresaId: ator.empresaId, tipoOsId })), skipDuplicates: true }),
  ]);
  return { ok: true };
}

/* ───────── perfis ───────── */

async function perfilDaEmpresa(empresaId: string, id: string) {
  const perfil = await prisma.desempenhoPerfil.findFirst({ where: { id, empresaId }, select: { id: true, nome: true, tipo: true, regras: { select: { vigenteDesde: true } }, _count: { select: { participantes: true } } } });
  if (!perfil) throw new ErroDesempenho(MSG_PERFIL_NAO_ENCONTRADO, 404);
  return perfil;
}

export async function criarPerfil(ator: Ator, d: z.infer<typeof perfilSchema>) {
  await garantirDesempenho(ator.empresaId);
  const ultimo = await prisma.desempenhoPerfil.aggregate({ where: { empresaId: ator.empresaId }, _max: { ordem: true } });
  try {
    const p = await prisma.desempenhoPerfil.create({ data: { empresaId: ator.empresaId, nome: d.nome, tipo: d.tipo, ordem: (ultimo._max.ordem ?? -1) + 1 }, select: { id: true } });
    return { id: p.id };
  } catch (e) { if (ehUnico(e)) throw new ErroDesempenho(MSG_PERFIL_REPETIDO, 409); throw e; }
}

export async function atualizarPerfil(ator: Ator, id: string, d: z.infer<typeof perfilSchema>) {
  const perfil = await perfilDaEmpresa(ator.empresaId, id);
  if (d.tipo !== perfil.tipo && perfil.regras.length) throw new ErroDesempenho(MSG_TIPO_TRAVADO, 409);
  try {
    await prisma.desempenhoPerfil.update({ where: { id }, data: { nome: d.nome, tipo: d.tipo } });
    return { id };
  } catch (e) { if (ehUnico(e)) throw new ErroDesempenho(MSG_PERFIL_REPETIDO, 409); throw e; }
}

export async function excluirPerfil(ator: Ator, id: string) {
  const perfil = await perfilDaEmpresa(ator.empresaId, id);
  if (perfil._count.participantes > 0) throw new ErroDesempenho(MSG_PERFIL_COM_GENTE, 409);
  await prisma.desempenhoPerfil.delete({ where: { id } });
  return { ok: true };
}

/* ───────── regra do perfil (travada no mês) ───────── */

/**
 * Salva a regra do perfil. A PRIMEIRA vale já no mês corrente; qualquer mudança depois é gravada para
 * o mês seguinte (substitui a mudança que já estivesse agendada). A regra em vigor nunca é alterada.
 */
export async function salvarRegra(ator: Ator, perfilId: string, regra: Regra, agora: Date = new Date()): Promise<{ vigenteDesde: string; imediata: boolean }> {
  const perfil = await perfilDaEmpresa(ator.empresaId, perfilId);
  const atual = competenciaAtual(agora);
  const vigenteDesde = vigenciaDaMudanca(perfil.regras, atual);
  const dados = {
    pesoPrazo: regra.pesoPrazo, pesoRelatorio: regra.pesoRelatorio, pesoAvaliacao: regra.pesoAvaliacao, exigirFotoAntesDepois: regra.exigirFotoAntesDepois,
    penalidadeRetorno: regra.penalidadeRetorno, penalidadeReclamacao: regra.penalidadeReclamacao, metaMinima: regra.metaMinima,
    faixas: regra.faixas as unknown as Prisma.InputJsonValue, criadoPorId: ator.usuarioId,
  };
  await prisma.$transaction([
    // Só pode haver UMA mudança agendada: a nova substitui qualquer outra que esteja no futuro
    prisma.desempenhoRegra.deleteMany({ where: { perfilId, vigenteDesde: { gt: atual, not: vigenteDesde } } }),
    prisma.desempenhoRegra.upsert({
      where: { perfilId_vigenteDesde: { perfilId, vigenteDesde } },
      create: { empresaId: ator.empresaId, perfilId, vigenteDesde, ...dados },
      update: dados,
    }),
  ]);
  return { vigenteDesde, imediata: vigenteDesde === atual };
}

/** Desiste da mudança agendada: a regra em vigor continua valendo. */
export async function descartarRegraAgendada(ator: Ator, perfilId: string, agora: Date = new Date()) {
  await perfilDaEmpresa(ator.empresaId, perfilId);
  const { count } = await prisma.desempenhoRegra.deleteMany({ where: { perfilId, empresaId: ator.empresaId, vigenteDesde: { gt: competenciaAtual(agora) } } });
  return { descartadas: count };
}

/* ───────── participantes ───────── */

export async function definirParticipante(ator: Ator, d: z.infer<typeof participanteSchema>) {
  const [tecnico, perfil] = await Promise.all([
    prisma.tecnico.findFirst({ where: { id: d.tecnicoId, empresaId: ator.empresaId }, select: { id: true } }),
    prisma.desempenhoPerfil.findFirst({ where: { id: d.perfilId, empresaId: ator.empresaId }, select: { id: true } }),
  ]);
  if (!tecnico) throw new ErroDesempenho("Colaborador não encontrado.", 404);
  if (!perfil) throw new ErroDesempenho(MSG_PERFIL_NAO_ENCONTRADO, 404);
  await prisma.desempenhoParticipante.upsert({
    where: { tecnicoId: d.tecnicoId },
    create: { empresaId: ator.empresaId, tecnicoId: d.tecnicoId, perfilId: d.perfilId },
    update: { perfilId: d.perfilId },
  });
  return { ok: true };
}

export async function removerParticipante(ator: Ator, tecnicoId: string) {
  const { count } = await prisma.desempenhoParticipante.deleteMany({ where: { tecnicoId, empresaId: ator.empresaId } });
  if (!count) throw new ErroDesempenho("Este colaborador não está no Desempenho.", 404);
  return { ok: true };
}

/* ───────── link do modo TV ───────── */

export async function gerarLinkTv(ator: Ator) {
  await garantirDesempenho(ator.empresaId);
  const tvToken = randomBytes(24).toString("base64url");
  await prisma.desempenhoConfig.update({ where: { empresaId: ator.empresaId }, data: { tvToken } });
  return { tvToken };
}

export async function desligarLinkTv(ator: Ator) {
  await prisma.desempenhoConfig.updateMany({ where: { empresaId: ator.empresaId }, data: { tvToken: null } });
  return { tvToken: null };
}

/* ───────── painel do mês ───────── */

async function basesDoMes(empresaId: string, competencia: string): Promise<{ perfis: PerfilDoMes[]; participantes: ParticipanteDoMes[]; equipes: EquipeDoMes[] }> {
  const [perfis, participantes, equipes] = await Promise.all([
    prisma.desempenhoPerfil.findMany({ where: { empresaId }, select: { id: true, nome: true, tipo: true, ordem: true, regras: { select: SELECT_REGRA } } }),
    prisma.desempenhoParticipante.findMany({ where: { empresaId }, select: { tecnicoId: true, perfilId: true, tecnico: { select: { nome: true } } } }),
    prisma.equipe.findMany({
      where: { empresaId, status: "ATIVA" },
      select: { id: true, nome: true, cor: true, liderId: true, lider: { select: { nome: true } }, membros: { select: { id: true } } },
    }),
  ]);
  return {
    perfis: perfis.map((p) => {
      const regra = regraVigente(p.regras, competencia);
      return { id: p.id, nome: p.nome, tipo: p.tipo as TipoPerfil, ordem: p.ordem, regra: regra ? paraRegra(regra) : null };
    }),
    participantes: participantes.map((p) => ({ tecnicoId: p.tecnicoId, nome: p.tecnico.nome, perfilId: p.perfilId })),
    equipes: equipes.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor, liderId: e.liderId, lider: e.lider?.nome ?? null, membros: e.membros.map((m) => m.id) })),
  };
}

export async function premiacoesDoMes(empresaId: string, competencia: string): Promise<PremiacaoNaTela[]> {
  const linhas = await prisma.desempenhoPremiacao.findMany({
    where: { empresaId, competencia }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: { id: true, titulo: true, descricao: true, perfil: { select: { nome: true } } },
  });
  if (!linhas.length) return [];
  // Só QUAIS têm imagem (a imagem em si é servida à parte)
  const comImagem = new Set((await prisma.desempenhoPremiacao.findMany({ where: { empresaId, competencia, imagem: { not: null } }, select: { id: true } })).map((p) => p.id));
  return linhas.map((p) => ({ id: p.id, titulo: p.titulo, descricao: p.descricao, perfil: p.perfil?.nome ?? null, temImagem: comImagem.has(p.id) }));
}

export interface PainelDoMes extends Painel {
  ativo: true;
  premiacoes: PremiacaoNaTela[];
  /** Itens esperando a revisão (de qualquer mês) */
  aRevisar: number;
  /** Colaboradores ativos fora de qualquer perfil (não entram no ranking) */
  semPerfil: number;
}

async function painel(empresaId: string, competencia: string, comValores: boolean): Promise<Painel> {
  const [bases, medicao] = await Promise.all([basesDoMes(empresaId, competencia), medirMes(empresaId, competencia)]);
  return montarPainel({ competencia, ...bases, medicao }, comValores);
}

export async function painelDoMes(empresaId: string, competencia: string, comValores: boolean): Promise<PainelDoMes | { ativo: false }> {
  if (!(await desempenhoAtivo(empresaId))) return { ativo: false };
  // Detecta o que ainda não entrou na lista "a revisar" (só cria itens A_REVISAR: nada muda no escore)
  await sincronizarPenalidades(empresaId);
  const [p, premiacoes, aRevisar, semPerfil] = await Promise.all([
    painel(empresaId, competencia, comValores),
    premiacoesDoMes(empresaId, competencia),
    prisma.desempenhoPenalidade.count({ where: { empresaId, situacao: "A_REVISAR" } }),
    prisma.tecnico.count({ where: { empresaId, ...ATIVO_NO_QUADRO, desempenhoParticipante: { is: null } } }),
  ]);
  return { ativo: true, ...p, premiacoes, aRevisar, semPerfil };
}

/* ───────── ficha do colaborador ───────── */

export interface PenalidadeNaFicha { id: string; tipo: string; situacao: string; descricao: string | null; dataFato: string; motivo: string | null }
export interface FichaDoColaborador {
  competencia: string;
  tecnico: { id: string; nome: string };
  perfil: GrupoRanking["perfil"];
  regra: GrupoRanking["regra"];
  linha: LinhaRanking;
  /** Quantos disputam no mesmo perfil */
  participantes: number;
  penalidades: PenalidadeNaFicha[];
  premiacoes: PremiacaoNaTela[];
}

/**
 * A ficha de um colaborador no mês. `comValores`: a gestão ou o próprio colaborador. null = não
 * participa do Desempenho (ou não é da empresa). As penalidades listadas são só as dele.
 */
export async function fichaDoColaborador(empresaId: string, tecnicoId: string, competencia: string, comValores: boolean): Promise<FichaDoColaborador | null> {
  await sincronizarPenalidades(empresaId);
  const achado = linhaDoColaborador(await painel(empresaId, competencia, comValores), tecnicoId);
  if (!achado) return null;
  const [penalidades, premiacoes] = await Promise.all([
    prisma.desempenhoPenalidade.findMany({
      where: { empresaId, tecnicoId, competencia }, orderBy: [{ dataFato: "asc" }, { id: "asc" }],
      select: { id: true, tipo: true, situacao: true, descricao: true, dataFato: true, motivo: true },
    }),
    premiacoesDoMes(empresaId, competencia),
  ]);
  return {
    competencia, tecnico: { id: achado.linha.tecnicoId, nome: achado.linha.nome }, perfil: achado.grupo.perfil, regra: achado.grupo.regra,
    linha: achado.linha, participantes: achado.participantes,
    penalidades: penalidades.map((p) => ({ ...p, dataFato: p.dataFato.toISOString() })),
    // O prêmio que ele disputa: os de todos os perfis e os do perfil dele
    premiacoes: premiacoes.filter((p) => !p.perfil || p.perfil === achado.grupo.perfil.nome),
  };
}

/* ───────── modo TV (sem login: o token é a chave) ───────── */

export async function painelDaTv(token: string, agora: Date = new Date()): Promise<PainelTv | null> {
  if (!token || token.length < 20) return null;
  const config = await prisma.desempenhoConfig.findUnique({ where: { tvToken: token }, select: { empresaId: true, empresa: { select: { nome: true, nomeFantasia: true } } } });
  if (!config) return null;
  const competencia = competenciaAtual(agora);
  const [p, premiacoes] = await Promise.all([painel(config.empresaId, competencia, false), premiacoesDoMes(config.empresaId, competencia)]);
  return paraTv(p, { empresa: config.empresa.nomeFantasia?.trim() || config.empresa.nome, premiacoes, agora });
}

/** A imagem de um brinde para a TV: só com o token da empresa dona da premiação. */
export async function imagemDaTv(token: string, premiacaoId: string): Promise<string | null> {
  if (!token || token.length < 20) return null;
  const config = await prisma.desempenhoConfig.findUnique({ where: { tvToken: token }, select: { empresaId: true } });
  if (!config) return null;
  const p = await prisma.desempenhoPremiacao.findFirst({ where: { id: premiacaoId, empresaId: config.empresaId }, select: { imagem: true } });
  return p?.imagem ?? null;
}
