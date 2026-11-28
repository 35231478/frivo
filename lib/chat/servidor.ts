/**
 * CHAT-1 — o chat no banco: a LISTA de conversas (uma por OS) do escritório e do técnico, a conversa aberta e o "mudou
 * algo?" do tempo real. As mensagens em si (gravar, ler, ✓✓, foto) moram em lib/execucao/comentarios — um caminho só.
 *
 * Quem vê o quê:
 *  - escritório: as OS da empresa que a permissão de OS deixa ver, com o "Ver só os próprios" da COM-1 (filtroOrdens);
 *  - técnico: só as OS em que ele tem atividade (responsável ou na equipe da atividade).
 * Tudo filtrado pela empresa da sessão (multiempresa).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { filtroOrdens, type QuemVe } from "@/lib/escopo/proprios";
import { atividadesDoTecnico } from "@/lib/tecnico/escopo";
import { equipamentosDasOsDaConversa, ondeConversaDoTecnico, ondeEscritorioVe, type EquipamentosDasOs } from "@/lib/chat/pessoas-servidor";
import { comentariosDaOs, comentariosParaEscritorio, marcarConversaLida } from "@/lib/execucao/comentarios";
import { ESPERA_NOVIDADES_MS, PASSO_NOVIDADES_MS, marcaNovidades, ordenarConversas, type ConversaResumo } from "@/lib/chat/regras";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

/** Quantas conversas a lista traz (as mais recentes) */
export const LIMITE_CONVERSAS = 100;
/** App do técnico: a OS concluída sem mensagem há mais que isso sai da lista */
export const DIAS_CONVERSA_TECNICO = 30;

export type QuemEscritorio = QuemVe & { id: string; empresaId: string };

const nomeCliente = (c: { nome: string; nomeFantasia: string | null } | null) => (c?.nomeFantasia || c?.nome || "").trim();

/** Busca de OS: nº, cliente (razão social ou fantasia). */
function filtroBusca(busca: string | null | undefined): Prisma.OrdemServicoWhereInput {
  const q = (busca ?? "").trim();
  if (!q) return {};
  const contem = { contains: q, mode: "insensitive" as const };
  return { OR: [{ numero: contem }, { cliente: { nome: contem } }, { cliente: { nomeFantasia: contem } }] };
}

/**
 * O resumo de cada conversa (nº, cliente, técnicos, última mensagem, não lidas de quem vê) — poucas consultas para a
 * lista toda, nunca uma por OS.
 */
export async function resumosDasConversas(empresaId: string, usuarioId: string, osIds: string[]): Promise<ConversaResumo[]> {
  if (!osIds.length) return [];
  const [oss, ultimos, leituras] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId, id: { in: osIds } },
      select: {
        id: true, numero: true, status: true, cliente: { select: { nome: true, nomeFantasia: true } },
        atividades: { select: { tecnico: { select: { nome: true } }, tecnicosEquipe: { select: { tecnico: { select: { nome: true } } } } } },
      },
    }),
    prisma.osComentario.groupBy({ by: ["ordemServicoId"], where: { empresaId, ordemServicoId: { in: osIds } }, _max: { criadoEm: true } }),
    prisma.osComentarioLeitura.findMany({ where: { usuarioId, ordemServicoId: { in: osIds } }, select: { ordemServicoId: true, lidoEm: true } }),
  ]);
  const ultimoEm = new Map(ultimos.filter((u) => u.ordemServicoId).map((u) => [u.ordemServicoId!, u._max.criadoEm!]));
  const lidoEm = new Map(leituras.map((l) => [l.ordemServicoId, l.lidoEm]));
  const comMensagem = [...ultimoEm.keys()];
  const [ultimas, naoLidas] = await Promise.all([
    comMensagem.length ? prisma.osComentario.findMany({
      where: { empresaId, OR: comMensagem.map((id) => ({ ordemServicoId: id, criadoEm: ultimoEm.get(id)! })) },
      orderBy: { criadoEm: "desc" },
      select: { ordemServicoId: true, texto: true, autorNome: true, usuarioId: true, criadoEm: true, foto: { select: { id: true } } },
    }) : [],
    comMensagem.length ? prisma.osComentario.groupBy({
      by: ["ordemServicoId"], _count: { _all: true },
      where: { empresaId, usuarioId: { not: usuarioId }, OR: comMensagem.map((id) => (lidoEm.has(id) ? { ordemServicoId: id, criadoEm: { gt: lidoEm.get(id)! } } : { ordemServicoId: id })) },
    }) : [],
  ]);
  const ultimaDe = new Map<string, (typeof ultimas)[number]>();
  for (const u of ultimas) if (u.ordemServicoId && !ultimaDe.has(u.ordemServicoId)) ultimaDe.set(u.ordemServicoId, u);
  const naoLidasDe = new Map(naoLidas.map((n) => [n.ordemServicoId ?? "", n._count._all]));
  return ordenarConversas(oss.map((os) => {
    const u = ultimaDe.get(os.id);
    const tecnicos = [...new Set(os.atividades.flatMap((a) => [a.tecnico?.nome, ...a.tecnicosEquipe.map((t) => t.tecnico.nome)]).filter((x): x is string => !!x?.trim()))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    return {
      osId: os.id, osNumero: os.numero, cliente: nomeCliente(os.cliente), status: os.status, tecnicos,
      ultima: u ? { texto: u.texto, autor: u.autorNome, criadoEm: u.criadoEm.toISOString(), minha: u.usuarioId === usuarioId, foto: !!u.foto } : null,
      naoLidas: naoLidasDe.get(os.id) ?? 0,
    };
  }));
}

// ── Escritório ──────────────────────────────────────────────────────────────────────────────

/** O filtro das OS que esta pessoa do escritório vê (empresa + "Ver só os próprios"). */
const osDoEscritorio = (u: QuemEscritorio): Prisma.OrdemServicoWhereInput => ({ empresaId: u.empresaId, ...filtroOrdens(u) });

/**
 * As conversas do escritório: as OS com mensagem, mais recente primeiro. Com busca, também as OS que batem e ainda não
 * têm conversa (para começar uma).
 */
export async function conversasDoEscritorio(u: QuemEscritorio, op: { busca?: string | null; limite?: number } = {}):
  Promise<{ conversas: ConversaResumo[]; semConversa: { osId: string; osNumero: string; cliente: string }[] }> {
  const ondeOs: Prisma.OrdemServicoWhereInput = { ...osDoEscritorio(u), ...filtroBusca(op.busca) };
  const grupos = await prisma.osComentario.groupBy({
    by: ["ordemServicoId"], where: { empresaId: u.empresaId, ordemServico: ondeOs },
    _max: { criadoEm: true }, orderBy: { _max: { criadoEm: "desc" } }, take: op.limite ?? LIMITE_CONVERSAS,
  });
  const conversas = await resumosDasConversas(u.empresaId, u.id, grupos.map((g) => g.ordemServicoId).filter((x): x is string => !!x));
  const semConversa = (op.busca ?? "").trim()
    ? (await prisma.ordemServico.findMany({
      where: { ...ondeOs, comentarios: { none: {} } }, orderBy: { criadoEm: "desc" }, take: 5,
      select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } },
    })).map((o) => ({ osId: o.id, osNumero: o.numero, cliente: nomeCliente(o.cliente) }))
    : [];
  return { conversas, semConversa };
}

/** A conversa aberta no escritório: o resumo e as mensagens (ler marca como lidas). Fora do escopo: null. */
export async function conversaDoEscritorio(u: QuemEscritorio, osId: string, op: { ate?: string | null } = {}): Promise<{ conversa: ConversaResumo; mensagens: ComentarioTela[]; equipamentosDasOs: EquipamentosDasOs } | null> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, ...osDoEscritorio(u) }, select: { id: true } });
  if (!os) return null;
  // A citação de outra conversa aparece se esta pessoa pode ver a original (senão, "Mensagem indisponível")
  const mensagens = (await comentariosParaEscritorio(u.empresaId, osId, u.id, new Date(), { ate: op.ate, visivel: ondeEscritorioVe(u) })) ?? [];
  const [[conversa], equipamentosDasOs] = await Promise.all([resumosDasConversas(u.empresaId, u.id, [osId]), equipamentosDasOsDaConversa(u.empresaId, [osId])]);
  return { conversa, mensagens, equipamentosDasOs };
}

/** Quantas conversas têm mensagem não lida por esta pessoa (o ícone do topo). */
export async function conversasNaoLidasDoEscritorio(u: QuemEscritorio): Promise<number> {
  const { conversas } = await conversasDoEscritorio(u);
  return conversas.filter((c) => c.naoLidas > 0).length;
}

// ── Técnico ─────────────────────────────────────────────────────────────────────────────────

/** As OS do técnico que têm conversa: onde ele tem atividade e a OS está aberta, ou houve mensagem nos últimos dias. */
async function osDoTecnico(empresaId: string, tecnicoId: string, agora: Date): Promise<Map<string, string[]>> {
  const desde = new Date(agora.getTime() - DIAS_CONVERSA_TECNICO * 86_400_000);
  const atividades = await prisma.atividadeOs.findMany({
    where: {
      ...atividadesDoTecnico(tecnicoId),
      ordemServico: { empresaId, OR: [{ status: { notIn: ["CONCLUIDA", "CANCELADA"] } }, { comentarios: { some: { criadoEm: { gte: desde } } } }] },
    },
    orderBy: [{ dataAgendada: "desc" }, { criadoEm: "desc" }],
    take: 300,
    select: { id: true, ordemServicoId: true },
  });
  const porOs = new Map<string, string[]>();
  for (const a of atividades) porOs.set(a.ordemServicoId, [...(porOs.get(a.ordemServicoId) ?? []), a.id]);
  return porOs;
}

// ── Tempo real ──────────────────────────────────────────────────────────────────────────────

/** A marca atual de um conjunto de conversas para esta pessoa (mensagem mais nova, ✓✓ mais novo, a leitura dela). */
export async function marcaAtual(onde: Prisma.OsComentarioWhereInput, usuarioId: string): Promise<string> {
  const [a, minhaOs, minhaPessoa] = await Promise.all([
    prisma.osComentario.aggregate({ where: onde, _max: { criadoEm: true, lidaEm: true } }),
    prisma.osComentarioLeitura.aggregate({ where: { usuarioId }, _max: { lidoEm: true } }),
    prisma.conversaLeitura.aggregate({ where: { usuarioId }, _max: { lidoEm: true } }),
  ]);
  // A minha leitura mais nova, pela OS ou pela conversa da pessoa
  const os = minhaOs._max.lidoEm?.getTime() ?? 0;
  const pessoa = minhaPessoa._max.lidoEm?.getTime() ?? 0;
  return marcaNovidades(a._max.criadoEm, a._max.lidaEm, os || pessoa ? new Date(Math.max(os, pessoa)) : null);
}

/** Onde olhar: o escritório olha a empresa toda (só diz "mudou"; quem lê depois filtra); o técnico, as OS dele. */
export const ondeNovidadesEscritorio = (empresaId: string): Prisma.OsComentarioWhereInput => ({ empresaId });
/** O técnico olha a conversa dele com o escritório (com e sem OS) e as OS dele (o que se escreve dentro delas). */
export async function ondeNovidadesTecnico(empresaId: string, tecnicoId: string, usuarioId: string, agora: Date = new Date()): Promise<Prisma.OsComentarioWhereInput> {
  return { empresaId, OR: [ondeConversaDoTecnico(usuarioId, tecnicoId), { ordemServicoId: { in: [...(await osDoTecnico(empresaId, tecnicoId, agora)).keys()] } }] };
}

export interface OpcoesEspera { esperaMs?: number; passoMs?: number; dormir?: (ms: number) => Promise<void>; agora?: () => number; cancelado?: () => boolean }

/**
 * O long-polling: devolve na hora se a marca já é outra; senão olha a cada `passoMs` até `esperaMs` e devolve a marca
 * (igual = nada mudou; o aparelho pergunta de novo). Sem `desde`, só devolve a marca atual.
 */
export async function esperarNovidades(ler: () => Promise<string>, desde: string | null, op: OpcoesEspera = {}): Promise<{ marca: string; mudou: boolean }> {
  const esperaMs = op.esperaMs ?? ESPERA_NOVIDADES_MS;
  const passoMs = op.passoMs ?? PASSO_NOVIDADES_MS;
  const dormir = op.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = op.agora ?? Date.now;
  const fim = agora() + esperaMs;
  let marca = await ler();
  if (!desde || marca !== desde) return { marca, mudou: !!desde };
  while (agora() + passoMs <= fim && !op.cancelado?.()) {
    await dormir(passoMs);
    marca = await ler();
    if (marca !== desde) return { marca, mudou: true };
  }
  return { marca, mudou: false };
}
