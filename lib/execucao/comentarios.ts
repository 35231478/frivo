/**
 * COMENTÁRIOS NA OS — lado do banco. Regras puras em lib/tecnico/comentarios.ts.
 *  - técnico (fila do app): `comentarDoApp` (idempotente pelo clientId; o contexto da execução garante que a atividade
 *    é dele); o retrato leva `comentariosDaOs`;
 *  - escritório (OS › Resumo): `comentariosParaEscritorio` (lê e marca como lido), `comentarDoEscritorio`;
 *  - sino: `contarComentariosNovos` (OS com comentário do campo depois da última leitura da pessoa).
 */
import { prisma } from "@/lib/prisma";
import { agendarPush, notificarComentarioOS } from "@/lib/push/eventos";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import { DIAS_SINO_COMENTARIOS, MSG_COMENTARIO_DUPLICADO, osComNovidade, ordenarComentarios, type ComentarioTela, type DadosComentario, type OrigemComentario } from "@/lib/tecnico/comentarios";

type Resultado<T> = { ok: true; status: number; dados: T } | { ok: false; status: number; erro: string };

const SELECT = { id: true, clientId: true, texto: true, autorNome: true, origem: true, criadoEm: true, usuarioId: true } as const;
type Linha = { id: string; clientId: string | null; texto: string; autorNome: string; origem: string; criadoEm: Date; usuarioId: string };
const apresentar = (c: Linha, usuarioId: string): ComentarioTela => ({
  id: c.id, clientId: c.clientId, texto: c.texto, autor: c.autorNome, origem: c.origem as OrigemComentario, criadoEm: c.criadoEm.toISOString(), meu: c.usuarioId === usuarioId,
});

async function nomeDe(empresaId: string, usuarioId: string) {
  const u = await prisma.usuario.findFirst({ where: { id: usuarioId, empresaId }, select: { nome: true } });
  return (u?.nome ?? "").trim() || "Usuário";
}

/** O técnico comenta pela fila do app. A mesma gravação reenviada não duplica. */
export async function comentarDoApp(ctx: ContextoExecucao, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  const { empresaId, usuarioId } = ctx;
  const osId = ctx.atividade.ordemServico.id;
  const ja = await prisma.osComentario.findUnique({ where: { empresaId_clientId: { empresaId, clientId: d.clientId } }, select: { ...SELECT, ordemServicoId: true } });
  if (ja) {
    if (ja.ordemServicoId !== osId || ja.usuarioId !== usuarioId) return { ok: false, status: 409, erro: MSG_COMENTARIO_DUPLICADO };
    return { ok: true, status: 200, dados: { comentario: apresentar(ja, usuarioId) } };
  }
  // A hora é a do servidor: é ela que ordena a conversa entre o app e o escritório
  try {
    const c = await prisma.osComentario.create({
      data: { empresaId, ordemServicoId: osId, atividadeId: ctx.atividade.id, usuarioId, autorNome: await nomeDe(empresaId, usuarioId), origem: "APP", texto: d.texto.trim(), clientId: d.clientId },
      select: SELECT,
    });
    // Push "Comentário novo na OS": os outros técnicos da OS e o escritório (menos o autor), depois da resposta
    agendarPush(() => notificarComentarioOS(osId, usuarioId, { comentarioId: c.id, texto: c.texto }));
    return { ok: true, status: 201, dados: { comentario: apresentar(c, usuarioId) } };
  } catch (e) {
    // Dois envios simultâneos da mesma gravação: o segundo perde na chave única e devolve o primeiro
    if ((e as { code?: string })?.code === "P2002") {
      const c = await prisma.osComentario.findUnique({ where: { empresaId_clientId: { empresaId, clientId: d.clientId } }, select: SELECT });
      if (c) return { ok: true, status: 200, dados: { comentario: apresentar(c, usuarioId) } };
    }
    throw e;
  }
}

/** Os comentários da OS (para o retrato do app ou o card do escritório). */
export async function comentariosDaOs(empresaId: string, osId: string, usuarioId: string): Promise<ComentarioTela[]> {
  const linhas = await prisma.osComentario.findMany({ where: { empresaId, ordemServicoId: osId }, orderBy: { criadoEm: "asc" }, take: 500, select: SELECT });
  return ordenarComentarios(linhas.map((c) => apresentar(c, usuarioId)));
}

/** Escritório abre a OS: lê os comentários e marca como lido até agora (o sino apaga para esta pessoa). */
export async function comentariosParaEscritorio(empresaId: string, osId: string, usuarioId: string, agora: Date = new Date()): Promise<ComentarioTela[] | null> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true } });
  if (!os) return null;
  const lista = await comentariosDaOs(empresaId, osId, usuarioId);
  await prisma.osComentarioLeitura.upsert({
    where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } },
    create: { usuarioId, ordemServicoId: osId, lidoEm: agora }, update: { lidoEm: agora },
  });
  return lista;
}

/** Escritório responde na OS. */
export async function comentarDoEscritorio(empresaId: string, osId: string, usuarioId: string, texto: string): Promise<ComentarioTela | null> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true } });
  if (!os) return null;
  const c = await prisma.osComentario.create({
    data: { empresaId, ordemServicoId: osId, usuarioId, autorNome: await nomeDe(empresaId, usuarioId), origem: "ESCRITORIO", texto: texto.trim() },
    select: SELECT,
  });
  // Push "Comentário novo na OS": os técnicos da OS e o resto do escritório (menos o autor), depois da resposta
  agendarPush(() => notificarComentarioOS(osId, usuarioId, { comentarioId: c.id, texto: c.texto }));
  // Quem respondeu leu tudo até aqui
  await prisma.osComentarioLeitura.upsert({
    where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } },
    create: { usuarioId, ordemServicoId: osId, lidoEm: c.criadoEm }, update: { lidoEm: c.criadoEm },
  });
  return apresentar(c, usuarioId);
}

/** Sino: OS com comentário do campo que esta pessoa ainda não leu (janela de DIAS_SINO_COMENTARIOS). */
export async function contarComentariosNovos(empresaId: string, usuarioId: string, agora: Date = new Date()): Promise<{ comentariosCampo: number; comentarioCampoOsId: string | null }> {
  const desde = new Date(agora.getTime() - DIAS_SINO_COMENTARIOS * 86_400_000);
  const ultimos = await prisma.osComentario.groupBy({ by: ["ordemServicoId"], where: { empresaId, origem: "APP", criadoEm: { gte: desde } }, _max: { criadoEm: true } });
  if (!ultimos.length) return { comentariosCampo: 0, comentarioCampoOsId: null };
  const lidos = await prisma.osComentarioLeitura.findMany({ where: { usuarioId, ordemServicoId: { in: ultimos.map((u) => u.ordemServicoId) } }, select: { ordemServicoId: true, lidoEm: true } });
  const novas = osComNovidade(new Map(ultimos.map((u) => [u.ordemServicoId, u._max.criadoEm!])), new Map(lidos.map((l) => [l.ordemServicoId, l.lidoEm])));
  return { comentariosCampo: novas.length, comentarioCampoOsId: novas[0] ?? null };
}
