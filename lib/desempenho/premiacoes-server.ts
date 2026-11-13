/**
 * DESEMPENHO — PREMIAÇÃO DO MÊS: o brinde em disputa (texto + imagem), por empresa e competência.
 * Sem perfil = disputa de todos; com perfil = só daquele. A imagem (já comprimida no navegador) fica
 * no banco e é servida à parte — a lista só diz se há imagem.
 */
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { premiacaoSchema } from "./regras";
import { ErroDesempenho, type Ator } from "./erros";
import { garantirDesempenho } from "./servidor";

export const MSG_PREMIACAO_NAO_ENCONTRADA = "Premiação não encontrada.";

export interface PremiacaoNaLista { id: string; competencia: string; titulo: string; descricao: string | null; perfilId: string | null; perfil: string | null; temImagem: boolean }

/** As premiações da empresa (de um mês, ou todas), da mais recente para a mais antiga. */
export async function listarPremiacoes(empresaId: string, competencia?: string | null): Promise<PremiacaoNaLista[]> {
  const where = { empresaId, ...(competencia && { competencia }) };
  const [linhas, comImagem] = await Promise.all([
    prisma.desempenhoPremiacao.findMany({
      where, orderBy: [{ competencia: "desc" }, { criadoEm: "asc" }, { id: "asc" }], take: 200,
      select: { id: true, competencia: true, titulo: true, descricao: true, perfilId: true, perfil: { select: { nome: true } } },
    }),
    // Só QUAIS têm imagem
    prisma.desempenhoPremiacao.findMany({ where: { ...where, imagem: { not: null } }, select: { id: true } }),
  ]);
  const ids = new Set(comImagem.map((p) => p.id));
  return linhas.map((p) => ({ id: p.id, competencia: p.competencia, titulo: p.titulo, descricao: p.descricao, perfilId: p.perfilId, perfil: p.perfil?.nome ?? null, temImagem: ids.has(p.id) }));
}

async function perfilValido(empresaId: string, perfilId: string | null) {
  if (!perfilId) return;
  if (!(await prisma.desempenhoPerfil.findFirst({ where: { id: perfilId, empresaId }, select: { id: true } }))) throw new ErroDesempenho("Perfil não encontrado.", 404);
}

export async function criarPremiacao(ator: Ator, d: z.infer<typeof premiacaoSchema>) {
  await garantirDesempenho(ator.empresaId);
  await perfilValido(ator.empresaId, d.perfilId);
  const p = await prisma.desempenhoPremiacao.create({
    data: { empresaId: ator.empresaId, competencia: d.competencia, titulo: d.titulo, descricao: d.descricao, perfilId: d.perfilId, imagem: d.imagem ?? null, criadoPorId: ator.usuarioId },
    select: { id: true },
  });
  return { id: p.id };
}

export async function atualizarPremiacao(ator: Ator, id: string, d: z.infer<typeof premiacaoSchema>) {
  if (!(await prisma.desempenhoPremiacao.findFirst({ where: { id, empresaId: ator.empresaId }, select: { id: true } }))) throw new ErroDesempenho(MSG_PREMIACAO_NAO_ENCONTRADA, 404);
  await perfilValido(ator.empresaId, d.perfilId);
  await prisma.desempenhoPremiacao.update({
    where: { id },
    // imagem: undefined = fica como está; null = tira; texto = troca
    data: { competencia: d.competencia, titulo: d.titulo, descricao: d.descricao, perfilId: d.perfilId, ...(d.imagem !== undefined && { imagem: d.imagem }) },
  });
  return { id };
}

export async function excluirPremiacao(ator: Ator, id: string) {
  const { count } = await prisma.desempenhoPremiacao.deleteMany({ where: { id, empresaId: ator.empresaId } });
  if (!count) throw new ErroDesempenho(MSG_PREMIACAO_NAO_ENCONTRADA, 404);
  return { ok: true };
}

/** A imagem do brinde (data URL), só da empresa pedida. */
export async function imagemDaPremiacao(empresaId: string, id: string): Promise<string | null> {
  const p = await prisma.desempenhoPremiacao.findFirst({ where: { id, empresaId }, select: { imagem: true } });
  return p?.imagem ?? null;
}

/** Data URL → bytes e tipo, para responder como imagem. */
export function bytesDaImagem(dataUrl: string): { tipo: string; bytes: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  return m ? { tipo: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}
