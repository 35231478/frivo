/**
 * CHAT-1 — a conversa POR PESSOA no banco (o desenho aprovado pelo Zé): a lista do escritório é de colaboradores e o
 * técnico tem UMA conversa principal, "Escritório". O REGISTRO continua na OS: cada mensagem leva a OS dela (ou nenhuma)
 * e é a mesma linha de os_comentarios — a conversa da pessoa e a da OS são dois FILTROS da mesma fonte.
 *
 * A conversa do técnico T (o usuário U dele) é:
 *  - o que ele escreveu (com ou sem OS);
 *  - o que o escritório escreveu PARA ele (com ou sem OS);
 *  - o que o escritório escreveu numa OS em que ele tem atividade SEM destinatário (= para todos os técnicos da OS,
 *    como sempre foi) — assim as mensagens de antes desta leva já aparecem, sem carga de dados.
 *
 * Quem vê: o escritório com a permissão "Conversas" (o administrador sempre); as mensagens com OS ainda seguem a
 * permissão de OS e o "Ver só os próprios" (COM-1); a sem OS, só "Conversas". O técnico vê só a conversa dele.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { filtroOrdens } from "@/lib/escopo/proprios";
import { atividadesDoTecnico } from "@/lib/tecnico/escopo";
import { inicioHojeBR } from "@/lib/fuso";
import { apresentar, marcarConversaLida, marcarLeituraDaPessoa, nomesDeQuemLeu, SELECT_MENSAGEM } from "@/lib/execucao/comentarios";
import { ordenarPessoas, osPadraoDaMensagem, type OsDoDia, type PessoaResumo } from "@/lib/chat/regras";
import type { QuemEscritorio } from "@/lib/chat/servidor";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

/** Quantas mensagens a conversa da pessoa traz (as mais recentes) */
export const LIMITE_MENSAGENS_PESSOA = 300;

const nomeCliente = (c: { nome: string; nomeFantasia: string | null } | null | undefined) => (c?.nomeFantasia || c?.nome || "").trim();

/** O escritório pode usar as Conversas por pessoa? ("visualizar" para ler, "enviar" para escrever; o admin sempre) */
export const podeConversas = (u: QuemEscritorio, acao: "visualizar" | "enviar") => pode(u.permissoes ?? null, "conversas", acao, u.role ?? undefined);

/** As pessoas com quem o escritório conversa: os técnicos ATIVOS que têm login no app (o mesmo e-mail). */
export async function pessoasDaEmpresa(empresaId: string): Promise<{ usuarioId: string; tecnicoId: string; nome: string; avatar: string | null }[]> {
  const tecnicos = await prisma.tecnico.findMany({ where: { empresaId, ativo: true, email: { not: null } }, select: { id: true, nome: true, email: true }, orderBy: { criadoEm: "asc" } });
  if (!tecnicos.length) return [];
  const usuarios = await prisma.usuario.findMany({
    where: { empresaId, ativo: true, OR: tecnicos.map((t) => ({ email: { equals: t.email!, mode: "insensitive" as const } })) },
    select: { id: true, email: true, avatar: true },
  });
  const porEmail = new Map(usuarios.map((u) => [u.email.trim().toLowerCase(), u]));
  const vistos = new Set<string>();
  return tecnicos.flatMap((t) => {
    const u = porEmail.get((t.email ?? "").trim().toLowerCase());
    if (!u || vistos.has(u.id)) return [];
    vistos.add(u.id);
    return [{ usuarioId: u.id, tecnicoId: t.id, nome: t.nome, avatar: u.avatar ?? null }];
  });
}

/** O filtro da conversa do técnico (o usuário U dele, o técnico T). */
export const ondeConversaDoTecnico = (usuarioId: string, tecnicoId: string): Prisma.OsComentarioWhereInput => ({
  OR: [
    { usuarioId },
    { paraUsuarioId: usuarioId },
    { paraUsuarioId: null, origem: "ESCRITORIO", ordemServico: { atividades: { some: atividadesDoTecnico(tecnicoId) } } },
  ],
});

/** O que esta pessoa do escritório pode ver de uma conversa: a sem OS; com OS, só pela permissão de OS e o escopo. */
export function visivelAoEscritorio(u: QuemEscritorio): Prisma.OsComentarioWhereInput {
  if (!pode(u.permissoes ?? null, "ordens", "visualizar", u.role ?? undefined)) return { ordemServicoId: null };
  // A relação da OS é opcional: "com OS e dentro do escopo" explícito (o filtro vazio do admin não pode virar "sem OS")
  return { OR: [{ ordemServicoId: null }, { AND: [{ ordemServicoId: { not: null } }, { ordemServico: { is: filtroOrdens(u) } }] }] };
}

/** As OS do técnico no dia: as atividades de hoje (Brasília) e as em andamento; a em andamento primeiro. */
export async function osDoDiaDoTecnico(empresaId: string, tecnicoId: string, agora: Date = new Date()): Promise<OsDoDia[]> {
  const as = await prisma.atividadeOs.findMany({
    where: {
      ...atividadesDoTecnico(tecnicoId), ordemServico: { empresaId, status: { not: "CANCELADA" } },
      OR: [{ status: "EM_ANDAMENTO" }, { dataAgendada: { gte: inicioHojeBR(agora), lt: inicioHojeBR(agora, 1) } }],
    },
    orderBy: [{ dataAgendada: "asc" }],
    select: { id: true, status: true, ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } } },
  });
  const porOs = new Map<string, OsDoDia>();
  for (const a of as) {
    const ja = porOs.get(a.ordemServico.id);
    const emAndamento = a.status === "EM_ANDAMENTO";
    if (!ja || (emAndamento && !ja.emAndamento)) porOs.set(a.ordemServico.id, { osId: a.ordemServico.id, numero: a.ordemServico.numero, cliente: nomeCliente(a.ordemServico.cliente), emAndamento, atividadeId: a.id });
  }
  return [...porOs.values()].sort((x, y) => Number(y.emAndamento) - Number(x.emAndamento));
}

async function mensagensDe(empresaId: string, onde: Prisma.OsComentarioWhereInput, usuarioId: string): Promise<ComentarioTela[]> {
  const linhas = await prisma.osComentario.findMany({ where: { AND: [{ empresaId }, onde] }, orderBy: { criadoEm: "desc" }, take: LIMITE_MENSAGENS_PESSOA, select: SELECT_MENSAGEM });
  linhas.reverse();
  const nomes = await nomesDeQuemLeu(empresaId, linhas);
  return linhas.map((c) => apresentar(c, usuarioId, nomes));
}

/**
 * Ler a conversa: avança a leitura da pessoa naquela conversa (o contador por pessoa), a das OS que aparecem nela (o
 * sino e a visão por OS) e marca o ✓✓ das mensagens dos outros que ainda não tinham sido lidas.
 */
async function lerConversa(empresaId: string, quemLe: string, conversaUsuarioId: string, onde: Prisma.OsComentarioWhereInput, agora: Date) {
  await marcarLeituraDaPessoa(quemLe, conversaUsuarioId, agora);
  const naoLidas = await prisma.osComentario.findMany({
    where: { AND: [{ empresaId }, onde, { usuarioId: { not: quemLe }, lidaEm: null, criadoEm: { lte: agora } }] }, select: { id: true, ordemServicoId: true },
  });
  if (naoLidas.length) await prisma.osComentario.updateMany({ where: { id: { in: naoLidas.map((m) => m.id) } }, data: { lidaEm: agora, lidaPorId: quemLe } });
  for (const osId of new Set(naoLidas.map((m) => m.ordemServicoId).filter((x): x is string => !!x))) await marcarConversaLida(empresaId, osId, quemLe, agora);
}

// ── Escritório ──────────────────────────────────────────────────────────────────────────────

/**
 * A lista POR PESSOA do escritório: cada técnico com login, a última mensagem da conversa (que esta pessoa pode ver), a
 * hora e as não lidas (o que o técnico mandou depois da última leitura de quem vê). Não lidas primeiro; depois a mais
 * recente. Busca por nome, nº de OS e cliente (das mensagens da conversa).
 */
export async function pessoasDoEscritorio(u: QuemEscritorio, op: { busca?: string | null } = {}): Promise<PessoaResumo[]> {
  const pessoas = await pessoasDaEmpresa(u.empresaId);
  if (!pessoas.length) return [];
  const visivel = visivelAoEscritorio(u);
  const leituras = new Map((await prisma.conversaLeitura.findMany({ where: { usuarioId: u.id, conversaUsuarioId: { in: pessoas.map((p) => p.usuarioId) } }, select: { conversaUsuarioId: true, lidoEm: true } }))
    .map((l) => [l.conversaUsuarioId, l.lidoEm]));
  const q = (op.busca ?? "").trim();
  const contem = { contains: q, mode: "insensitive" as const };
  const lista = await Promise.all(pessoas.map(async (p): Promise<PessoaResumo | null> => {
    const onde: Prisma.OsComentarioWhereInput = { AND: [{ empresaId: u.empresaId }, ondeConversaDoTecnico(p.usuarioId, p.tecnicoId), visivel] };
    if (q && !p.nome.toLowerCase().includes(q.toLowerCase())) {
      const achou = await prisma.osComentario.findFirst({
        where: { AND: [onde, { ordemServico: { OR: [{ numero: contem }, { cliente: { nome: contem } }, { cliente: { nomeFantasia: contem } }] } }] }, select: { id: true },
      });
      if (!achou) return null;
    }
    const lido = leituras.get(p.usuarioId);
    const [ultima, naoLidas] = await Promise.all([
      prisma.osComentario.findFirst({ where: onde, orderBy: { criadoEm: "desc" }, select: { texto: true, autorNome: true, usuarioId: true, criadoEm: true, foto: { select: { id: true } }, ordemServico: { select: { numero: true } } } }),
      prisma.osComentario.count({ where: { AND: [onde, { usuarioId: p.usuarioId }, ...(lido ? [{ criadoEm: { gt: lido } }] : [])] } }),
    ]);
    return {
      usuarioId: p.usuarioId, tecnicoId: p.tecnicoId, nome: p.nome, avatar: p.avatar, naoLidas,
      ultima: ultima ? { texto: ultima.texto, autor: ultima.autorNome, criadoEm: ultima.criadoEm.toISOString(), minha: ultima.usuarioId === u.id, foto: !!ultima.foto, osNumero: ultima.ordemServico?.numero ?? null } : null,
    };
  }));
  return ordenarPessoas(lista.filter((x): x is PessoaResumo => !!x));
}

/** A conversa do escritório com um técnico: as mensagens (que esta pessoa pode ver), as OS dele no dia e a OS padrão. */
export async function conversaComPessoa(u: QuemEscritorio, usuarioIdTecnico: string, agora: Date = new Date()):
  Promise<{ pessoa: { usuarioId: string; nome: string; avatar: string | null }; mensagens: ComentarioTela[]; osDoDia: OsDoDia[]; osPadrao: string | null } | null> {
  const p = (await pessoasDaEmpresa(u.empresaId)).find((x) => x.usuarioId === usuarioIdTecnico);
  if (!p) return null;
  const onde: Prisma.OsComentarioWhereInput = { AND: [ondeConversaDoTecnico(p.usuarioId, p.tecnicoId), visivelAoEscritorio(u)] };
  await lerConversa(u.empresaId, u.id, p.usuarioId, onde, agora);
  const [mensagens, osDoDia] = await Promise.all([mensagensDe(u.empresaId, onde, u.id), osDoDiaDoTecnico(u.empresaId, p.tecnicoId, agora)]);
  // O seletor mostra só as OS que esta pessoa do escritório pode ver ("Ver só os próprios")
  const veOs = pode(u.permissoes ?? null, "ordens", "visualizar", u.role ?? undefined);
  const visiveis = veOs && osDoDia.length ? new Set((await prisma.ordemServico.findMany({ where: { id: { in: osDoDia.map((o) => o.osId) }, empresaId: u.empresaId, ...filtroOrdens(u) }, select: { id: true } })).map((o) => o.id)) : new Set<string>();
  const doDia = osDoDia.filter((o) => visiveis.has(o.osId)).map(({ atividadeId: _a, ...o }) => o);
  return { pessoa: { usuarioId: p.usuarioId, nome: p.nome, avatar: p.avatar }, mensagens, osDoDia: doDia, osPadrao: osPadraoDaMensagem({ osDoDia: doDia, mensagens, agora }) };
}

/** Quantas pessoas têm mensagem por ler para quem vê (o ícone do topo, na visão por pessoa). */
export async function pessoasNaoLidas(u: QuemEscritorio): Promise<number> {
  return (await pessoasDoEscritorio(u)).filter((p) => p.naoLidas > 0).length;
}

// ── Técnico (a conversa "Escritório") ───────────────────────────────────────────────────────

/** A conversa do técnico com o escritório (lê e marca como lida), as OS dele no dia e a OS padrão. */
export async function conversaDoTecnicoComEscritorio(empresaId: string, usuarioId: string, tecnicoId: string, agora: Date = new Date()):
  Promise<{ mensagens: ComentarioTela[]; osDoDia: OsDoDia[]; osPadrao: string | null }> {
  const onde = ondeConversaDoTecnico(usuarioId, tecnicoId);
  await lerConversa(empresaId, usuarioId, usuarioId, onde, agora);
  const [mensagens, osDoDia] = await Promise.all([mensagensDe(empresaId, onde, usuarioId), osDoDiaDoTecnico(empresaId, tecnicoId, agora)]);
  return { mensagens, osDoDia, osPadrao: osPadraoDaMensagem({ osDoDia, mensagens, agora }) };
}

/** Quantas mensagens do escritório o técnico ainda não leu (o contador do Chat na barra do app). */
export async function naoLidasDoTecnico(empresaId: string, usuarioId: string, tecnicoId: string): Promise<number> {
  const lido = (await prisma.conversaLeitura.findUnique({ where: { usuarioId_conversaUsuarioId: { usuarioId, conversaUsuarioId: usuarioId } }, select: { lidoEm: true } }))?.lidoEm;
  return prisma.osComentario.count({ where: { AND: [{ empresaId }, ondeConversaDoTecnico(usuarioId, tecnicoId), { usuarioId: { not: usuarioId } }, ...(lido ? [{ criadoEm: { gt: lido } }] : [])] } });
}

// ── Quem pode ver uma mensagem (a foto inteira) ─────────────────────────────────────────────

/** O escritório vê esta mensagem? (sem OS: precisa de "Conversas"; com OS: permissão e escopo de OS) */
export async function escritorioVeMensagem(u: QuemEscritorio, comentarioId: string): Promise<boolean> {
  const m = await prisma.osComentario.findFirst({ where: { AND: [{ id: comentarioId, empresaId: u.empresaId }, visivelAoEscritorio(u)] }, select: { ordemServicoId: true } });
  if (!m) return false;
  return m.ordemServicoId ? true : podeConversas(u, "visualizar");
}

/** O técnico vê esta mensagem? (a conversa dele, ou uma OS em que tem atividade) */
export async function tecnicoVeMensagem(empresaId: string, usuarioId: string, tecnicoId: string, comentarioId: string): Promise<boolean> {
  return !!(await prisma.osComentario.findFirst({
    where: { AND: [{ id: comentarioId, empresaId }, { OR: [ondeConversaDoTecnico(usuarioId, tecnicoId), { ordemServico: { atividades: { some: atividadesDoTecnico(tecnicoId) } } }] }] }, select: { id: true },
  }));
}
