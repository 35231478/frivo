/**
 * COMENTÁRIOS NA OS (a conversa da OS no CHAT-1) — lado do banco. Regras puras em lib/tecnico/comentarios.ts e
 * lib/chat/regras.ts; a lista de conversas e o tempo real em lib/chat/servidor.ts.
 *  - técnico (fila do app): `comentarDoApp` (idempotente pelo clientId; o contexto da execução garante que a atividade
 *    é dele); o retrato leva `comentariosDaOs`;
 *  - escritório: `comentariosParaEscritorio` (lê e marca como lido), `comentarDoEscritorio` (também idempotente);
 *  - "lida": `marcarConversaLida` — a leitura da pessoa (os_comentarios_lidos) e o ✓✓ das mensagens dos outros;
 *  - sino: `contarComentariosNovos` (OS com comentário do campo depois da última leitura da pessoa).
 * A foto da mensagem vai em os_comentarios_fotos (validada como os anexos da OS; nunca entra no relatório nem no portal).
 */
import { prisma } from "@/lib/prisma";
import { agendarPush, notificarMensagem } from "@/lib/push/eventos";
import { validarDataUrl } from "@/lib/anexos-server";
import { TIPOS_IMAGEM } from "@/lib/anexos";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import {
  DIAS_SINO_COMENTARIOS, FOTO_TAMANHO_MAX, MINIATURA_TAMANHO_MAX, MSG_COMENTARIO_DUPLICADO, osComNovidade, ordenarComentarios,
  type ComentarioTela, type DadosComentario, type OrigemComentario,
} from "@/lib/tecnico/comentarios";
import { MSG_OS_CANCELADA, somenteLeitura } from "@/lib/chat/regras";

type Resultado<T> = { ok: true; status: number; dados: T } | { ok: false; status: number; erro: string };

export const SELECT_MENSAGEM = {
  id: true, clientId: true, texto: true, autorNome: true, origem: true, criadoEm: true, usuarioId: true, lidaEm: true, lidaPorId: true,
  ordemServicoId: true, paraUsuarioId: true,
  atividade: { select: { titulo: true } }, foto: { select: { id: true, miniatura: true } },
  ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
} as const;
type Linha = {
  id: string; clientId: string | null; texto: string; autorNome: string; origem: string; criadoEm: Date; usuarioId: string;
  lidaEm?: Date | null; lidaPorId?: string | null; atividade?: { titulo: string } | null; foto?: { id: string; miniatura: string } | null;
  paraUsuarioId?: string | null;
  ordemServico?: { id: string; numero: string; cliente: { nome: string; nomeFantasia: string | null } | null } | null;
};

/** Como a mensagem sai para a tela. `nomes` traduz quem leu e o destinatário (id → nome). */
export const apresentar = (c: Linha, usuarioId: string, nomes: Map<string, string> = new Map()): ComentarioTela => ({
  id: c.id, clientId: c.clientId, texto: c.texto, autor: c.autorNome, origem: c.origem as OrigemComentario, criadoEm: c.criadoEm.toISOString(), meu: c.usuarioId === usuarioId,
  atividade: c.atividade?.titulo ?? null,
  foto: c.foto ? { id: c.foto.id, miniatura: c.foto.miniatura } : null,
  lida: c.lidaEm ? { por: (c.lidaPorId && nomes.get(c.lidaPorId)) || "Alguém", em: c.lidaEm.toISOString() } : null,
  os: c.ordemServico ? { id: c.ordemServico.id, numero: c.ordemServico.numero, cliente: (c.ordemServico.cliente?.nomeFantasia || c.ordemServico.cliente?.nome || "").trim() } : null,
  para: c.paraUsuarioId ? nomes.get(c.paraUsuarioId) ?? "Técnico" : null,
});

/** Os nomes de quem leu e dos destinatários (uma consulta para a conversa toda). */
export async function nomesDeQuemLeu(empresaId: string, linhas: Linha[]): Promise<Map<string, string>> {
  const ids = [...new Set(linhas.flatMap((l) => [l.lidaPorId, l.paraUsuarioId]).filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const us = await prisma.usuario.findMany({ where: { empresaId, id: { in: ids } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, (u.nome ?? "").trim() || "Usuário"]));
}

async function nomeDe(empresaId: string, usuarioId: string) {
  const u = await prisma.usuario.findFirst({ where: { id: usuarioId, empresaId }, select: { nome: true } });
  return (u?.nome ?? "").trim() || "Usuário";
}

/** A foto e a miniatura (já reduzidas no aparelho), conferidas pelo conteúdo como os anexos da OS. */
function validarFoto(d: DadosComentario): { ok: true; foto: { tipo: string; tamanho: number; conteudo: string; miniatura: string } | null } | { ok: false; erro: string } {
  if (!d.foto || !d.miniatura) return { ok: true, foto: null };
  const opts = { tipos: TIPOS_IMAGEM, mensagemTipo: "Envie uma foto (JPG, PNG ou WEBP)." };
  const f = validarDataUrl(d.foto, "foto.jpg", { ...opts, tamanhoMax: FOTO_TAMANHO_MAX });
  if (!f.ok) return f;
  const m = validarDataUrl(d.miniatura, "miniatura.jpg", { ...opts, tamanhoMax: MINIATURA_TAMANHO_MAX });
  if (!m.ok) return m;
  return { ok: true, foto: { tipo: f.arquivo.tipo, tamanho: f.arquivo.tamanho, conteudo: f.arquivo.conteudo, miniatura: m.arquivo.conteudo } };
}

/**
 * Grava a mensagem (com a foto, se houver) — o mesmo caminho para o app e o escritório. A mesma gravação reenviada (o
 * clientId) devolve a primeira; o clientId usado em outra OS ou por outra pessoa é recusado.
 */
async function gravar(a: { empresaId: string; osId: string | null; usuarioId: string; origem: OrigemComentario; atividadeId: string | null; paraUsuarioId?: string | null; d: DadosComentario }):
  Promise<Resultado<{ comentario: ComentarioTela }>> {
  const { empresaId, osId, usuarioId, d } = a;
  const paraUsuarioId = a.paraUsuarioId ?? null;
  const buscar = () => prisma.osComentario.findUnique({ where: { empresaId_clientId: { empresaId, clientId: d.clientId } }, select: { ...SELECT_MENSAGEM, ordemServicoId: true } });
  const ja = await buscar();
  if (ja) {
    if (ja.ordemServicoId !== osId || ja.usuarioId !== usuarioId) return { ok: false, status: 409, erro: MSG_COMENTARIO_DUPLICADO };
    return { ok: true, status: 200, dados: { comentario: apresentar(ja, usuarioId) } };
  }
  if (osId) {
    const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { status: true } });
    if (!os) return { ok: false, status: 404, erro: "OS não encontrada" };
    if (somenteLeitura(os.status)) return { ok: false, status: 409, erro: MSG_OS_CANCELADA };
  }
  const foto = validarFoto(d);
  if (!foto.ok) return { ok: false, status: 400, erro: foto.erro };
  try {
    // A hora é a do servidor: é ela que ordena a conversa entre o app e o escritório
    const c = await prisma.osComentario.create({
      data: {
        empresaId, ordemServicoId: osId, atividadeId: a.atividadeId, usuarioId, autorNome: await nomeDe(empresaId, usuarioId), origem: a.origem,
        texto: d.texto.trim(), clientId: d.clientId, paraUsuarioId,
        ...(foto.foto && { foto: { create: { empresaId, ...foto.foto } } }),
      },
      select: SELECT_MENSAGEM,
    });
    // Push: com OS e sem destinatário, os técnicos da OS e o escritório ligado a ela; para uma pessoa, só ela; do técnico
    // sem OS, o escritório que conversa com ele (menos o autor) — depois da resposta
    agendarPush(() => notificarMensagem({ empresaId, comentarioId: c.id, osId, autorId: usuarioId, paraUsuarioId, origem: a.origem, texto: c.texto || (c.foto ? "Foto" : "") }));
    // Quem escreveu leu tudo até aqui: a OS e a conversa da pessoa (a do técnico; a do destinatário, no escritório)
    if (osId) await marcarConversaLida(empresaId, osId, usuarioId, c.criadoEm);
    const conversa = a.origem === "APP" ? usuarioId : paraUsuarioId;
    if (conversa) await marcarLeituraDaPessoa(usuarioId, conversa, c.criadoEm);
    return { ok: true, status: 201, dados: { comentario: apresentar(c, usuarioId, await nomesDeQuemLeu(empresaId, [c])) } };
  } catch (e) {
    // Dois envios simultâneos da mesma gravação: o segundo perde na chave única e devolve o primeiro
    if ((e as { code?: string })?.code === "P2002") {
      const c = await buscar();
      if (c && c.ordemServicoId === osId && c.usuarioId === usuarioId) return { ok: true, status: 200, dados: { comentario: apresentar(c, usuarioId) } };
    }
    throw e;
  }
}

/** O técnico escreve pela fila do app (texto e/ou foto). A mesma gravação reenviada não duplica. */
export async function comentarDoApp(ctx: ContextoExecucao, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  return gravar({ empresaId: ctx.empresaId, osId: ctx.atividade.ordemServico.id, usuarioId: ctx.usuarioId, origem: "APP", atividadeId: ctx.atividade.id, d });
}

/** O técnico escreve SEM OS ("chego em 10 minutos") pela fila do app: só na conversa dele com o escritório. */
export async function comentarSemOsDoApp(ator: { empresaId: string; usuarioId: string }, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  return gravar({ empresaId: ator.empresaId, osId: null, usuarioId: ator.usuarioId, origem: "APP", atividadeId: null, d });
}

/** O escritório escreve para UMA pessoa (a conversa dela), com ou sem OS: só ela recebe; na OS aparece "para Fulano". */
export async function comentarParaPessoa(empresaId: string, usuarioId: string, paraUsuarioId: string, osId: string | null, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  return gravar({ empresaId, osId, usuarioId, origem: "ESCRITORIO", atividadeId: null, paraUsuarioId, d });
}

/** Até quando `usuarioId` leu a conversa do técnico `conversaUsuarioId` (o contador por pessoa). */
export async function marcarLeituraDaPessoa(usuarioId: string, conversaUsuarioId: string, agora: Date = new Date()) {
  await prisma.conversaLeitura.upsert({
    where: { usuarioId_conversaUsuarioId: { usuarioId, conversaUsuarioId } },
    create: { usuarioId, conversaUsuarioId, lidoEm: agora }, update: { lidoEm: agora },
  });
}

/** O escritório escreve na conversa da OS (texto e/ou foto); idempotente pelo clientId como o app. */
export async function comentarDoEscritorio(empresaId: string, osId: string, usuarioId: string, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  return gravar({ empresaId, osId, usuarioId, origem: "ESCRITORIO", atividadeId: null, d });
}

/** As mensagens da OS (para o retrato do app, o card da OS e o chat), mais antiga primeiro. */
export async function comentariosDaOs(empresaId: string, osId: string, usuarioId: string): Promise<ComentarioTela[]> {
  const linhas = await prisma.osComentario.findMany({ where: { empresaId, ordemServicoId: osId }, orderBy: { criadoEm: "asc" }, take: 500, select: SELECT_MENSAGEM });
  const nomes = await nomesDeQuemLeu(empresaId, linhas);
  return ordenarComentarios(linhas.map((c) => apresentar(c, usuarioId, nomes)));
}

/**
 * A pessoa leu a conversa até `agora`: avança a leitura dela (os_comentarios_lidos — o contador de não lidas e o sino)
 * e marca o ✓✓ das mensagens dos OUTROS que ainda não tinham sido lidas por ninguém (a 1ª leitura fica: quem e quando).
 */
export async function marcarConversaLida(empresaId: string, osId: string, usuarioId: string, agora: Date = new Date()) {
  // Só avança a leitura quando chegou mensagem desde a última: reler sem novidade não muda nada (a marca do tempo real
  // inclui a leitura de quem pergunta — avançar sempre faria a tela reler em laço)
  const antes = await prisma.osComentarioLeitura.findUnique({ where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } }, select: { lidoEm: true } });
  const novidade = !antes || !!(await prisma.osComentario.findFirst({ where: { empresaId, ordemServicoId: osId, criadoEm: { gt: antes.lidoEm, lte: agora } }, select: { id: true } }));
  if (novidade) {
    await prisma.osComentarioLeitura.upsert({
      where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } },
      create: { usuarioId, ordemServicoId: osId, lidoEm: agora },
      update: { lidoEm: agora },
    });
  }
  // O ✓✓ só toca o que ainda não foi lido por ninguém: sem nada a marcar, não muda nada
  await prisma.osComentario.updateMany({
    where: { empresaId, ordemServicoId: osId, usuarioId: { not: usuarioId }, lidaEm: null, criadoEm: { lte: agora } },
    data: { lidaEm: agora, lidaPorId: usuarioId },
  });
}

/** Escritório abre a conversa: lê as mensagens e marca como lidas até agora (o sino e o contador apagam para esta pessoa). */
export async function comentariosParaEscritorio(empresaId: string, osId: string, usuarioId: string, agora: Date = new Date()): Promise<ComentarioTela[] | null> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true } });
  if (!os) return null;
  const leitura = await prisma.osComentarioLeitura.findUnique({ where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } }, select: { lidoEm: true } });
  // "novo": de outra pessoa, depois da última vez que esta pessoa leu (nunca leu: todos os dos outros)
  const desde = leitura?.lidoEm?.toISOString() ?? null;
  await marcarConversaLida(empresaId, osId, usuarioId, agora);
  // TODAS as mensagens da OS, de todas as atividades (a do app vem com a atividade de onde foi escrita), já com o ✓✓
  const todos = await comentariosDaOs(empresaId, osId, usuarioId);
  return todos.map((c) => ({ ...c, novo: !c.meu && (!desde || c.criadoEm > desde) }));
}

/** A foto inteira de uma mensagem (para ampliar), só de OS da empresa. Quem pode ver a conversa é conferido na rota. */
export async function fotoDaMensagem(empresaId: string, fotoId: string): Promise<{ comentarioId: string; conteudo: string } | null> {
  const f = await prisma.osComentarioFoto.findFirst({ where: { id: fotoId, empresaId }, select: { conteudo: true, comentario: { select: { id: true } } } });
  return f ? { comentarioId: f.comentario.id, conteudo: f.conteudo } : null;
}

/** Sino: OS com comentário do campo que esta pessoa ainda não leu (janela de DIAS_SINO_COMENTARIOS). */
export async function contarComentariosNovos(empresaId: string, usuarioId: string, agora: Date = new Date()): Promise<{ comentariosCampo: number; comentarioCampoOsId: string | null }> {
  const desde = new Date(agora.getTime() - DIAS_SINO_COMENTARIOS * 86_400_000);
  const grupos = await prisma.osComentario.groupBy({ by: ["ordemServicoId"], where: { empresaId, origem: "APP", ordemServicoId: { not: null }, criadoEm: { gte: desde } }, _max: { criadoEm: true } });
  const ultimos = grupos.filter((u): u is typeof u & { ordemServicoId: string } => !!u.ordemServicoId);
  if (!ultimos.length) return { comentariosCampo: 0, comentarioCampoOsId: null };
  const lidos = await prisma.osComentarioLeitura.findMany({ where: { usuarioId, ordemServicoId: { in: ultimos.map((u) => u.ordemServicoId) } }, select: { ordemServicoId: true, lidoEm: true } });
  const novas = osComNovidade(new Map(ultimos.map((u) => [u.ordemServicoId, u._max.criadoEm!])), new Map(lidos.map((l) => [l.ordemServicoId, l.lidoEm])));
  return { comentariosCampo: novas.length, comentarioCampoOsId: novas[0] ?? null };
}
