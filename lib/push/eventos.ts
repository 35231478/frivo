/**
 * Os EVENTOS que viram notificação push: cada função carrega o contexto (OS, cliente, data), escolhe quem
 * recebe e chama o envio único (lib/push/servidor › enviarPush). Quem grava chama `agendarPush(() => …)`
 * DEPOIS de gravar: o envio corre depois da resposta (não atrasa a tela) e nunca derruba a gravação.
 *
 * Técnico: só as atividades DELE (responsável ou na composição). Escritório: quem tem a permissão do tipo,
 * fora do modo técnico. Sem as chaves VAPID, tudo isto vira nada (o envio não faz nada).
 *
 * Ligados: atribuição, reagendamento e cancelamento da OS, atividade esquecida (sino e agendador), aceite com
 * ressalva/comentário/nota baixa, chamado do portal, resposta de orçamento, saldo negativo em campo e comentário
 * na OS. PRONTO SEM CHAMADOR (as despesas nascem no PR "App-Campo 2 · PR B"): `notificarDespesa`.
 */
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { whereAtividadesEsquecidas } from "@/lib/execucao/andamento-server";
import { enviarPush, usuariosComAparelho, usuariosDosTecnicos } from "@/lib/push/servidor";
import {
  aceiteMereceAviso, msgAceite, msgComentario, msgDespesa, msgEsquecida, msgEstoqueNegativo, msgOsCancelada, msgOsNova,
  msgOsReagendada, msgRespostaOrcamento, msgSolicitacaoPortal, urlAppAtividade, urlOs,
  type MensagemPush, type QuemRecebe, type SituacaoDespesa,
} from "@/lib/push/tipos";
import { chaveDiaBR, ehDiaCivil } from "@/lib/fuso";

/**
 * Roda o envio depois da resposta (Next `after`); fora de uma requisição (rotina, teste), roda já.
 * Nunca lança.
 */
export function agendarPush(fn: () => Promise<unknown>): void {
  const seguro = () => fn().catch((e) => console.error("[push] evento", (e as Error)?.message));
  try { after(seguro); } catch { void seguro(); }
}

const nomeCliente = (c: { nome: string; nomeFantasia: string | null } | null | undefined) => (c ? c.nomeFantasia || c.nome : null);
/** O técnico (modo técnico) abre a atividade no app; quem está no sistema inteiro abre a OS */
const paraQuem = (q: QuemRecebe, msg: MensagemPush, osId: string): MensagemPush => (q.restrito ? msg : { ...msg, url: urlOs(osId) });
const tecnicosDaAtividade = (a: { tecnicoId: string | null; tecnicosEquipe: { tecnicoId: string }[] }) =>
  [a.tecnicoId, ...a.tecnicosEquipe.map((t) => t.tecnicoId)].filter((x): x is string => !!x);

const SELECT_ATIVIDADE = {
  id: true, titulo: true, status: true, dataAgendada: true, tecnicoId: true, iniciadaEm: true,
  tecnicosEquipe: { select: { tecnicoId: true } },
  ordemServico: { select: { id: true, numero: true, empresaId: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
} satisfies Prisma.AtividadeOsSelect;

/* ───────── Técnico: nova OS, reagendada, cancelada ───────── */

/**
 * Atividade atribuída a técnicos NOVOS nela (quem já estava não recebe de novo). Roda depois da gravação e
 * RELÊ a atividade: só avisa quem está nela agora (transação desfeita ou técnico retirado: nada).
 */
export async function notificarAtribuicao(atividadeId: string, tecnicoIdsNovos: string[]) {
  if (!tecnicoIdsNovos.length) return null;
  const a = await prisma.atividadeOs.findUnique({ where: { id: atividadeId }, select: SELECT_ATIVIDADE });
  if (!a || a.status === "CONCLUIDA" || a.status === "CANCELADA") return null;
  const empresaId = a.ordemServico.empresaId;
  const naAtividade = new Set(tecnicosDaAtividade(a));
  const usuarios = await usuariosDosTecnicos(empresaId, tecnicoIdsNovos.filter((t) => naAtividade.has(t)));
  const msg = msgOsNova({
    atividadeId: a.id, osId: a.ordemServico.id, osNumero: a.ordemServico.numero, cliente: nomeCliente(a.ordemServico.cliente),
    titulo: a.titulo, quando: a.dataAgendada, soDia: !!a.dataAgendada && ehDiaCivil(a.dataAgendada),
  });
  return enviarPush({ empresaId, tipo: "OS_NOVA", alcance: "pessoal", usuarios, chave: `os-nova:${a.id}`, mensagem: (q) => paraQuem(q, msg, a.ordemServico.id) });
}

/** A data/hora de uma atividade mudou: avisa os técnicos dela (uma vez por nova data). */
export async function notificarReagendamento(empresaId: string, atividadeId: string, antes: Date | null) {
  const a = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, empresaId }, select: SELECT_ATIVIDADE });
  if (!a || a.status === "CONCLUIDA" || a.status === "CANCELADA") return null;
  const depois = a.dataAgendada;
  if ((antes?.getTime() ?? null) === (depois?.getTime() ?? null)) return null;
  const usuarios = await usuariosDosTecnicos(empresaId, tecnicosDaAtividade(a));
  const msg = msgOsReagendada({
    atividadeId: a.id, osId: a.ordemServico.id, osNumero: a.ordemServico.numero, cliente: nomeCliente(a.ordemServico.cliente),
    quando: depois, antes, soDia: !!depois && ehDiaCivil(depois),
  });
  return enviarPush({ empresaId, tipo: "OS_REAGENDADA", alcance: "pessoal", usuarios, chave: `reagendada:${a.id}:${depois?.toISOString() ?? "sem-data"}`, mensagem: (q) => paraQuem(q, msg, a.ordemServico.id) });
}

/** A OS foi cancelada: avisa os técnicos das atividades que ainda não tinham terminado. */
export async function notificarOsCancelada(empresaId: string, osId: string, motivo?: string | null) {
  const atividades = await prisma.atividadeOs.findMany({
    where: { ordemServicoId: osId, empresaId, status: { not: "CONCLUIDA" } }, select: SELECT_ATIVIDADE, orderBy: { dataAgendada: "asc" },
  });
  const enviados = [];
  for (const a of atividades) {
    const usuarios = await usuariosDosTecnicos(empresaId, tecnicosDaAtividade(a));
    const msg = msgOsCancelada({ osNumero: a.ordemServico.numero, cliente: nomeCliente(a.ordemServico.cliente), atividadeId: a.id, motivo });
    // a chave é da OS: quem está em mais de uma atividade dela recebe um aviso só
    enviados.push(await enviarPush({ empresaId, tipo: "OS_CANCELADA", alcance: "pessoal", usuarios, chave: `cancelada:${osId}`, mensagem: (q) => paraQuem(q, msg, osId) }));
  }
  return enviados;
}

/* ───────── Atividade esquecida em andamento (o sino e o agendador conferem; a chave não repete) ───────── */

/** Confere as atividades esquecidas da empresa e avisa: o técnico da atividade e o escritório. */
export async function verificarEsquecidas(empresaId: string, agora: Date = new Date()) {
  const where = await whereAtividadesEsquecidas(empresaId, agora);
  const atividades = await prisma.atividadeOs.findMany({
    where, take: 50, orderBy: [{ iniciadaEm: { sort: "asc", nulls: "first" } }, { dataAgendada: "asc" }],
    select: { ...SELECT_ATIVIDADE, tecnico: { select: { nome: true } } },
  });
  if (!atividades.length) return 0;
  const escritorio = await usuariosComAparelho(empresaId);
  let n = 0;
  for (const a of atividades) {
    const desde = a.iniciadaEm ?? a.dataAgendada ?? agora;
    const chave = `esquecida:${a.id}:${desde.toISOString()}`;
    const base = { osNumero: a.ordemServico.numero, cliente: nomeCliente(a.ordemServico.cliente), desde, tecnico: a.tecnico?.nome ?? null };
    const tecnicos = await usuariosDosTecnicos(empresaId, tecnicosDaAtividade(a));
    await enviarPush({ empresaId, tipo: "ATIVIDADE_ESQUECIDA", alcance: "pessoal", usuarios: tecnicos, chave,
      mensagem: (q) => paraQuem(q, msgEsquecida(base, true, urlAppAtividade(a.id)), a.ordemServico.id) });
    await enviarPush({ empresaId, tipo: "ATIVIDADE_ESQUECIDA", alcance: "escritorio", usuarios: escritorio.filter((u) => !tecnicos.includes(u)), chave,
      mensagem: msgEsquecida(base, false, urlOs(a.ordemServico.id)) });
    n++;
  }
  return n;
}

/** O sino atualiza a cada 2 min por pessoa: no máximo uma conferência a cada 5 min por empresa. */
const ultimaConferencia = new Map<string, number>();
export const INTERVALO_ESQUECIDAS_MS = 5 * 60_000;
export function conferirEsquecidasPeloSino(empresaId: string, agora = Date.now()): boolean {
  const ultima = ultimaConferencia.get(empresaId) ?? 0;
  if (agora - ultima < INTERVALO_ESQUECIDAS_MS) return false;
  ultimaConferencia.set(empresaId, agora);
  agendarPush(() => verificarEsquecidas(empresaId));
  return true;
}

/* ───────── Técnico + escritório: aceite, comentário (pronto), despesa (pronta) ───────── */

/** Os usuários técnicos da OS e a atividade que o app abre (a mais recente: o app só abre por atividade) */
async function tecnicosDaOs(empresaId: string, osId: string): Promise<{ usuarios: string[]; urlApp: string | null }> {
  const atividades = await prisma.atividadeOs.findMany({
    where: { ordemServicoId: osId, empresaId }, orderBy: [{ dataAgendada: { sort: "desc", nulls: "last" } }, { criadoEm: "desc" }],
    select: { id: true, tecnicoId: true, tecnicosEquipe: { select: { tecnicoId: true } } },
  });
  return { usuarios: await usuariosDosTecnicos(empresaId, atividades.flatMap(tecnicosDaAtividade)), urlApp: atividades[0] ? urlAppAtividade(atividades[0].id) : null };
}
/** O técnico abre a atividade no app; o resto, a OS */
const urlPara = (q: QuemRecebe, urlApp: string | null, osId: string) => (q.restrito && urlApp ? urlApp : urlOs(osId));

/** O cliente confirmou com ressalva, comentário ou nota baixa: o técnico da OS e o escritório (menos quem colheu). */
export async function notificarAceite(empresaId: string, osId: string) {
  const aceite = await prisma.osAceite.findFirst({
    where: { ordemServicoId: osId, empresaId, situacao: "CONFIRMADO" },
    select: { avaliacao: true, ressalva: true, avaliacaoComentario: true, colhidoPorId: true, ordemServico: { select: { numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } } },
  });
  if (!aceite) return null;
  const resumo = { osNumero: aceite.ordemServico.numero, cliente: nomeCliente(aceite.ordemServico.cliente), avaliacao: aceite.avaliacao, ressalva: aceite.ressalva, comentario: aceite.avaliacaoComentario };
  if (!aceiteMereceAviso(resumo)) return null;
  const sem = (xs: string[]) => xs.filter((u) => u !== aceite.colhidoPorId);
  const daOs = await tecnicosDaOs(empresaId, osId);
  const tecnicos = sem(daOs.usuarios);
  const chave = `aceite:${osId}`;
  await enviarPush({ empresaId, tipo: "ACEITE", alcance: "pessoal", usuarios: tecnicos, chave, mensagem: (q) => msgAceite(resumo, urlPara(q, daOs.urlApp, osId)) });
  return enviarPush({ empresaId, tipo: "ACEITE", alcance: "escritorio", usuarios: sem(await usuariosComAparelho(empresaId)).filter((u) => !tecnicos.includes(u)), chave, mensagem: msgAceite(resumo, urlOs(osId)) });
}

/**
 * Comentário novo na OS (lib/execucao/comentarios: do app e do escritório). Recebem os técnicos da OS e o
 * escritório (quem vê OS), menos o autor; o mesmo comentário não repete (chave pelo id).
 */
export async function notificarComentarioOS(osId: string, autorId: string, opts: { comentarioId?: string; texto?: string | null } = {}) {
  const os = await prisma.ordemServico.findUnique({ where: { id: osId }, select: { id: true, numero: true, empresaId: true, cliente: { select: { nome: true, nomeFantasia: true } } } });
  if (!os) return null;
  const autor = await prisma.usuario.findFirst({ where: { id: autorId, empresaId: os.empresaId }, select: { nome: true } });
  const sem = (xs: string[]) => xs.filter((u) => u !== autorId);
  const daOs = await tecnicosDaOs(os.empresaId, os.id);
  const tecnicos = sem(daOs.usuarios);
  const base = { osNumero: os.numero, cliente: nomeCliente(os.cliente), autor: autor?.nome ?? null, texto: opts.texto };
  const chave = `comentario:${opts.comentarioId ?? `${os.id}:${autorId}:${Date.now()}`}`;
  await enviarPush({ empresaId: os.empresaId, tipo: "OS_COMENTARIO", alcance: "pessoal", usuarios: tecnicos, chave,
    mensagem: (q) => msgComentario(base, urlPara(q, daOs.urlApp, os.id)) });
  return enviarPush({ empresaId: os.empresaId, tipo: "OS_COMENTARIO", alcance: "escritorio", usuarios: sem(await usuariosComAparelho(os.empresaId)).filter((u) => !tecnicos.includes(u)), chave, mensagem: msgComentario(base, urlOs(os.id)) });
}

export interface EventoDespesa {
  empresaId: string;
  despesaId: string;
  situacao: SituacaoDespesa;
  /** Quem lançou a despesa (o técnico) */
  autorUsuarioId: string;
  descricao?: string | null;
  valor?: number | null;
  motivo?: string | null;
  /** Para onde o toque leva (a tela da despesa) */
  url: string;
}

/**
 * Despesa de campo — PRONTA, ainda sem chamador: as despesas nascem no PR "App-Campo 2 · PR B".
 * ENVIADA → o escritório que aprova (Financeiro › Fluxo de caixa), menos o autor; APROVADA/RECUSADA → o autor.
 */
export async function notificarDespesa(e: EventoDespesa) {
  const chave = `despesa:${e.despesaId}:${e.situacao}`;
  if (e.situacao === "ENVIADA") {
    const autor = await prisma.usuario.findFirst({ where: { id: e.autorUsuarioId, empresaId: e.empresaId }, select: { nome: true } });
    const usuarios = (await usuariosComAparelho(e.empresaId)).filter((u) => u !== e.autorUsuarioId);
    return enviarPush({ empresaId: e.empresaId, tipo: "DESPESA", alcance: "escritorio", usuarios, chave, mensagem: msgDespesa({ ...e, autor: autor?.nome }, e.url) });
  }
  return enviarPush({ empresaId: e.empresaId, tipo: "DESPESA", alcance: "pessoal", usuarios: [e.autorUsuarioId], chave, mensagem: msgDespesa(e, e.url) });
}

/* ───────── Escritório: chamado do portal, resposta de orçamento, saldo negativo ───────── */

export async function notificarSolicitacaoPortal(empresaId: string, osId: string) {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true, numero: true, chamadoNumero: true, descricao: true, cliente: { select: { nome: true, nomeFantasia: true } } } });
  if (!os) return null;
  return enviarPush({ empresaId, tipo: "SOLICITACAO_PORTAL", alcance: "escritorio", usuarios: await usuariosComAparelho(empresaId), chave: `portal:${os.id}`,
    mensagem: msgSolicitacaoPortal({ osId: os.id, osNumero: os.chamadoNumero ?? os.numero, cliente: nomeCliente(os.cliente), descricao: os.descricao }) });
}

export async function notificarRespostaOrcamento(empresaId: string, orcamentoId: string) {
  const o = await prisma.orcamento.findFirst({ where: { id: orcamentoId, empresaId }, select: { id: true, codigo: true, status: true, cliente: { select: { nome: true, nomeFantasia: true } } } });
  if (!o || (o.status !== "APROVADO" && o.status !== "REPROVADO")) return null;
  return enviarPush({ empresaId, tipo: "ORCAMENTO_RESPOSTA", alcance: "escritorio", usuarios: await usuariosComAparelho(empresaId), chave: `orcamento:${o.id}:${o.status}`,
    mensagem: msgRespostaOrcamento({ id: o.id, codigo: o.codigo, cliente: nomeCliente(o.cliente), aprovado: o.status === "APROVADO" }) });
}

/** O material lançado em campo deixou o produto negativo: um aviso por produto por dia. */
export async function notificarEstoqueNegativo(empresaId: string, produtoId: string, osNumero?: string | null, agora: Date = new Date()) {
  const p = await prisma.produto.findFirst({ where: { id: produtoId, empresaId }, select: { id: true, nome: true, saldo: true, unidade: true } });
  if (!p || Number(p.saldo) >= 0) return null;
  return enviarPush({ empresaId, tipo: "ESTOQUE_NEGATIVO", alcance: "escritorio", usuarios: await usuariosComAparelho(empresaId), chave: `estoque-negativo:${p.id}:${chaveDiaBR(agora)}`,
    mensagem: msgEstoqueNegativo({ produto: p.nome, saldo: Number(p.saldo), unidade: p.unidade, osNumero }) });
}
