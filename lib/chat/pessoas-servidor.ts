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
import { ondeMeuDia } from "@/lib/tecnico/dia";
import { marcarConversaLida, marcarLeituraDaPessoa, marcarRespondidas, mensagensDaConversa, ondeConversaDoTecnico, ondeTecnicoVe } from "@/lib/execucao/comentarios";
import { ordenarPessoas, osPadraoDaMensagem, type OsDoDia, type PessoaResumo } from "@/lib/chat/regras";
import type { QuemEscritorio } from "@/lib/chat/servidor";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import { equipamentosDaOs } from "@/lib/os/galeria-server";
import { equipamentoEmAndamento, type EquipamentoFotoTela } from "@/lib/chat/equipamento-foto";

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

/** O filtro da conversa do técnico (o usuário U dele, o técnico T) — mora com a gravação, que confere a citada */
export { ondeConversaDoTecnico };

/** O que esta pessoa do escritório pode ver de uma conversa: a sem OS; com OS, só pela permissão de OS e o escopo. */
export function visivelAoEscritorio(u: QuemEscritorio): Prisma.OsComentarioWhereInput {
  if (!pode(u.permissoes ?? null, "ordens", "visualizar", u.role ?? undefined)) return { ordemServicoId: null };
  // A relação da OS é opcional: "com OS e dentro do escopo" explícito (o filtro vazio do admin não pode virar "sem OS")
  return { OR: [{ ordemServicoId: null }, { AND: [{ ordemServicoId: { not: null } }, { ordemServico: { is: filtroOrdens(u) } }] }] };
}

/** Tudo o que esta pessoa do escritório vê: com OS pela permissão e o escopo de OS; a sem OS, só com "Conversas". */
export function ondeEscritorioVe(u: QuemEscritorio): Prisma.OsComentarioWhereInput {
  return podeConversas(u, "visualizar") ? visivelAoEscritorio(u) : { AND: [visivelAoEscritorio(u), { ordemServicoId: { not: null } }] };
}

/** O que o escritório pode CITAR ao escrever para uma pessoa: a conversa dela, no que ele vê. */
export const citavelNaConversa = (u: QuemEscritorio, p: { usuarioId: string; tecnicoId: string }): Prisma.OsComentarioWhereInput =>
  ({ AND: [ondeConversaDoTecnico(p.usuarioId, p.tecnicoId), visivelAoEscritorio(u)] });

/**
 * As atividades do seletor de OS do chat do app: EXATAMENTE as do "Meu dia" do técnico (`ondeMeuDia`: as dele, como
 * responsável ou na equipe, de hoje ou começadas antes e não terminadas), menos as de OS cancelada (que não recebem
 * mensagem). A regra: se o técnico VÊ a OS no dia dele, conversa sobre ela; se não vê, o chip não aparece. A gravação
 * confere a mesma atribuição (`filtroEscopo`): o que o seletor oferece, o servidor aceita.
 */
export const ondeAtividadesDoDia = (empresaId: string, tecnicoId: string, agora: Date = new Date()): Prisma.AtividadeOsWhereInput => ({
  // Antes: um 2º OR na mesma chave apagava o filtro do técnico, e o seletor mostrava as OS dos outros (recusadas)
  AND: [ondeMeuDia(empresaId, tecnicoId, agora), { ordemServico: { status: { not: "CANCELADA" } } }],
});

/**
 * As OS do técnico no dia (uma por OS; a atividade em andamento dela, se houver). O ponto "em andamento" do seletor vai
 * em UMA OS só — a da atividade iniciada por último —, que também é a OS padrão da mensagem; ela vem primeiro.
 */
export async function osDoDiaDoTecnico(empresaId: string, tecnicoId: string, agora: Date = new Date()): Promise<OsDoDia[]> {
  const as = await prisma.atividadeOs.findMany({
    where: ondeAtividadesDoDia(empresaId, tecnicoId, agora),
    orderBy: [{ dataAgendada: "asc" }, { criadoEm: "asc" }],
    select: { id: true, status: true, iniciadaEm: true, ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } } },
  });
  // A atividade em andamento iniciada por último: a única com o ponto
  const atual = as.filter((a) => a.status === "EM_ANDAMENTO").sort((x, y) => (y.iniciadaEm?.getTime() ?? 0) - (x.iniciadaEm?.getTime() ?? 0))[0]?.id ?? null;
  const porOs = new Map<string, OsDoDia & { status: string }>();
  for (const a of as) {
    const ja = porOs.get(a.ordemServico.id);
    const emAndamento = a.id === atual;
    // Na mesma OS, a atividade em andamento vale mais que a agendada (é por ela que a mensagem sobe)
    const melhor = !ja || emAndamento || (a.status === "EM_ANDAMENTO" && !ja.emAndamento && ja.status !== "EM_ANDAMENTO");
    if (melhor) porOs.set(a.ordemServico.id, { osId: a.ordemServico.id, numero: a.ordemServico.numero, cliente: nomeCliente(a.ordemServico.cliente), emAndamento, atividadeId: a.id, status: a.status });
  }
  return [...porOs.values()].sort((x, y) => Number(y.emAndamento) - Number(x.emAndamento)).map(({ status: _s, ...o }) => o);
}


/**
 * Ler a conversa: avança a leitura da pessoa naquela conversa (o contador por pessoa), a das OS que aparecem nela (o
 * sino e a visão por OS) e marca o ✓✓ das mensagens dos outros que ainda não tinham sido lidas.
 */
async function lerConversa(empresaId: string, quemLe: string, conversaUsuarioId: string, onde: Prisma.OsComentarioWhereInput, agora: Date) {
  // O que o outro lado já respondeu (também as de antes de "responder é ler") fica lido por quem respondeu
  await marcarRespondidas(empresaId, onde);
  // Só avança a leitura quando chegou mensagem desde a última (reler sem novidade não muda a marca do tempo real)
  const antes = (await prisma.conversaLeitura.findUnique({ where: { usuarioId_conversaUsuarioId: { usuarioId: quemLe, conversaUsuarioId } }, select: { lidoEm: true } }))?.lidoEm;
  const novidade = !antes || !!(await prisma.osComentario.findFirst({ where: { AND: [{ empresaId }, onde, { criadoEm: { gt: antes, lte: agora } }] }, select: { id: true } }));
  if (novidade) await marcarLeituraDaPessoa(quemLe, conversaUsuarioId, agora);
  // O ✓✓: só o que dos outros ainda não foi lido por ninguém (sem nada a marcar, não muda nada)
  const semLeitura = await prisma.osComentario.findMany({ where: { AND: [{ empresaId }, onde, { usuarioId: { not: quemLe }, lidaEm: null, criadoEm: { lte: agora } }] }, select: { id: true } });
  if (semLeitura.length) await prisma.osComentario.updateMany({ where: { id: { in: semLeitura.map((m) => m.id) } }, data: { lidaEm: agora, lidaPorId: quemLe } });
  // A leitura das OS que chegaram nesta conversa desde a última vez (o sino e a visão por OS ficam coerentes)
  if (novidade) {
    const oss = await prisma.osComentario.findMany({ where: { AND: [{ empresaId }, onde, { ordemServicoId: { not: null }, criadoEm: { ...(antes && { gt: antes }), lte: agora } }] }, select: { ordemServicoId: true }, distinct: ["ordemServicoId"] });
    for (const o of oss) if (o.ordemServicoId) await marcarConversaLida(empresaId, o.ordemServicoId, quemLe, agora);
  }
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
export async function conversaComPessoa(u: QuemEscritorio, usuarioIdTecnico: string, agora: Date = new Date(), op: { ate?: string | null } = {}):
  Promise<{ pessoa: { usuarioId: string; nome: string; avatar: string | null }; mensagens: ComentarioTela[]; osDoDia: OsDoDia[]; osPadrao: string | null; equipamentosDasOs: EquipamentosDasOs } | null> {
  const p = (await pessoasDaEmpresa(u.empresaId)).find((x) => x.usuarioId === usuarioIdTecnico);
  if (!p) return null;
  const onde = citavelNaConversa(u, p);
  await lerConversa(u.empresaId, u.id, p.usuarioId, onde, agora);
  const [mensagens, osDoDia] = await Promise.all([
    mensagensDaConversa(u.empresaId, onde, u.id, { limite: LIMITE_MENSAGENS_PESSOA, ate: op.ate, visivel: ondeEscritorioVe(u) }),
    osDoDiaDoTecnico(u.empresaId, p.tecnicoId, agora),
  ]);
  // O seletor mostra só as OS que esta pessoa do escritório pode ver ("Ver só os próprios")
  const veOs = pode(u.permissoes ?? null, "ordens", "visualizar", u.role ?? undefined);
  const visiveis = veOs && osDoDia.length ? new Set((await prisma.ordemServico.findMany({ where: { id: { in: osDoDia.map((o) => o.osId) }, empresaId: u.empresaId, ...filtroOrdens(u) }, select: { id: true } })).map((o) => o.id)) : new Set<string>();
  const doDia = osDoDia.filter((o) => visiveis.has(o.osId)).map(({ atividadeId: _a, ...o }) => o);
  const equipamentos = await equipamentosDasOsDaConversa(u.empresaId, [...mensagens.map((m) => m.os?.id), ...doDia.map((o) => o.osId)]);
  return { pessoa: { usuarioId: p.usuarioId, nome: p.nome, avatar: p.avatar }, mensagens, osDoDia: doDia, osPadrao: osPadraoDaMensagem({ osDoDia: doDia, mensagens, agora }), equipamentosDasOs: equipamentos };
}

/** Quantas pessoas têm mensagem por ler para quem vê (o ícone do topo, na visão por pessoa). */
export async function pessoasNaoLidas(u: QuemEscritorio): Promise<number> {
  return (await pessoasDoEscritorio(u)).filter((p) => p.naoLidas > 0).length;
}

// ── Técnico (a conversa "Escritório") ───────────────────────────────────────────────────────

/** A conversa do técnico com o escritório (lê e marca como lida), as OS dele no dia e a OS padrão. */
export async function conversaDoTecnicoComEscritorio(empresaId: string, usuarioId: string, tecnicoId: string, agora: Date = new Date(), op: { ate?: string | null } = {}):
  Promise<{ mensagens: ComentarioTela[]; osDoDia: OsDoDia[]; osPadrao: string | null; atividadesDasOs: OsDoDia[]; equipamentosDasOs: EquipamentosDasOs }> {
  const onde = ondeConversaDoTecnico(usuarioId, tecnicoId);
  await lerConversa(empresaId, usuarioId, usuarioId, onde, agora);
  const [mensagens, osDoDia] = await Promise.all([
    mensagensDaConversa(empresaId, onde, usuarioId, { limite: LIMITE_MENSAGENS_PESSOA, ate: op.ate, visivel: ondeTecnicoVe(usuarioId, tecnicoId) }),
    osDoDiaDoTecnico(empresaId, tecnicoId, agora),
  ]);
  const [deOutrosDias, equipamentos] = await Promise.all([
    atividadesDasOs(empresaId, tecnicoId, mensagens, osDoDia),
    equipamentosDasOsDaConversa(empresaId, [...mensagens.map((m) => m.os?.id), ...osDoDia.map((o) => o.osId)], tecnicoId),
  ]);
  return { mensagens, osDoDia, osPadrao: osPadraoDaMensagem({ osDoDia, mensagens, agora }), atividadesDasOs: deOutrosDias, equipamentosDasOs: equipamentos };
}

/**
 * Responder herda a OS da citada — também de uma OS de outro dia. A fila do app sobe pela atividade do técnico; aqui
 * vai a atividade dele em cada OS que aparece na conversa (e que não está nas do dia), a mais recente.
 */
async function atividadesDasOs(empresaId: string, tecnicoId: string, mensagens: ComentarioTela[], osDoDia: OsDoDia[]): Promise<OsDoDia[]> {
  const doDia = new Set(osDoDia.map((o) => o.osId));
  const ids = [...new Set(mensagens.map((m) => m.os?.id).filter((x): x is string => !!x && !doDia.has(x)))];
  if (!ids.length) return [];
  const as = await prisma.atividadeOs.findMany({
    where: { ...atividadesDoTecnico(tecnicoId), ordemServicoId: { in: ids }, ordemServico: { empresaId, status: { not: "CANCELADA" } } },
    orderBy: [{ dataAgendada: "desc" }, { criadoEm: "desc" }],
    select: { id: true, ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } } },
  });
  const porOs = new Map<string, OsDoDia>();
  for (const a of as) if (!porOs.has(a.ordemServico.id)) porOs.set(a.ordemServico.id, { osId: a.ordemServico.id, numero: a.ordemServico.numero, cliente: nomeCliente(a.ordemServico.cliente), emAndamento: false, atividadeId: a.id });
  return [...porOs.values()];
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
  return !!(await prisma.osComentario.findFirst({ where: { AND: [{ id: comentarioId, empresaId }, ondeTecnicoVe(usuarioId, tecnicoId)] }, select: { id: true } }));
}

// ── CHAT-1.1: os equipamentos das OS da conversa (a foto se vincula a um deles) ───────────────────

/** Por OS: os equipamentos dela (o mesmo critério e os mesmos nomes da galeria da OS) e, para o técnico, o da atividade em andamento. */
export type EquipamentosDasOs = Record<string, { equipamentos: EquipamentoFotoTela[]; emAndamento: string | null }>;

/** As OS das mensagens e do dia (até 40): uma consulta por OS, em paralelo. `tecnicoId`: o equipamento em andamento dele. */
export async function equipamentosDasOsDaConversa(empresaId: string, osIds: (string | null | undefined)[], tecnicoId?: string | null): Promise<EquipamentosDasOs> {
  const ids = [...new Set(osIds.filter((x): x is string => !!x))].slice(0, 40);
  const pares = await Promise.all(ids.map(async (osId) => {
    const [eqs, andamento] = await Promise.all([
      equipamentosDaOs(empresaId, osId),
      tecnicoId ? prisma.atividadeEquipamento.findMany({
        where: { atividade: { ordemServicoId: osId, empresaId, status: "EM_ANDAMENTO", ...atividadesDoTecnico(tecnicoId) } }, select: { equipamentoId: true, feito: true },
      }) : Promise.resolve([]),
    ]);
    return [osId, { equipamentos: eqs.map((e) => ({ id: e.id, titulo: e.titulo, detalhe: e.detalhe })), emAndamento: equipamentoEmAndamento(andamento) }] as const;
  }));
  return Object.fromEntries(pares);
}

// ── Responder é ler ──────────────────────────────────────────────────────────────────────────────

/**
 * Quem responde leu a conversa até aqui: o ✓✓ das mensagens do outro lado (e a leitura da conversa). Sem isto, quem já
 * estava com a conversa aberta e respondia deixava as mensagens do técnico só com ✓ (a conversa só marcava ao abrir).
 * O escritório marca só o que ele pode ver da conversa da pessoa.
 */
export async function lerAoResponderEscritorio(u: QuemEscritorio, usuarioIdTecnico: string, agora: Date = new Date()) {
  const p = (await pessoasDaEmpresa(u.empresaId)).find((x) => x.usuarioId === usuarioIdTecnico);
  if (p) await lerConversa(u.empresaId, u.id, p.usuarioId, { AND: [ondeConversaDoTecnico(p.usuarioId, p.tecnicoId), visivelAoEscritorio(u)] }, agora);
}

/** O técnico respondeu (pelo app): leu a conversa dele com o escritório até aqui. */
export async function lerAoResponderTecnico(empresaId: string, usuarioId: string, tecnicoId: string | null | undefined, agora: Date = new Date()) {
  if (tecnicoId) await lerConversa(empresaId, usuarioId, usuarioId, ondeConversaDoTecnico(usuarioId, tecnicoId), agora);
}
