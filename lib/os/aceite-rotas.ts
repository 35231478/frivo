/**
 * ACEITE DO CLIENTE — o que as rotas de /api/ordens/[id]/aceite têm em comum: a permissão em Ordens
 * de serviço, o escopo do técnico do app (só as OS em que ele tem atividade) e a resposta dos erros de regra.
 */
import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";
import { ErroAceite } from "@/lib/os/aceite-server";

export const MSG_OS_FORA_DO_ESCOPO = "Esta OS não está atribuída a você. Fale com o escritório.";

export interface AtorDoAceite { empresaId: string; usuarioId: string; restrito: boolean }

/** Quem pede pode ver (`visualizar`) ou mexer (`editar`) no aceite DESTA OS? */
export async function guardaDoAceite(osId: string, acao: "visualizar" | "editar"): Promise<{ ator: AtorDoAceite; resposta?: undefined } | { ator?: undefined; resposta: NextResponse }> {
  const guard = await exigirPermissao("ordens", acao);
  if (guard.erro) return { resposta: guard.resposta };
  const { empresaId, id: usuarioId } = guard.session.user;
  const escopo = escopoDaSessao(guard.session);
  if (escopo.restrito) {
    const minha = await prisma.atividadeOs.findFirst({ where: { AND: [{ ordemServicoId: osId, empresaId }, filtroEscopo(escopo)] }, select: { id: true } });
    if (!minha) {
      const existe = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true } });
      return { resposta: NextResponse.json({ erro: existe ? MSG_OS_FORA_DO_ESCOPO : "OS não encontrada" }, { status: existe ? 403 : 404 }) };
    }
  }
  return { ator: { empresaId, usuarioId, restrito: escopo.restrito } };
}

/** Erro de regra vira a resposta com a mensagem; o resto sobe */
export async function responderAceite<T>(fazer: () => Promise<T>, status = 200): Promise<NextResponse> {
  try { return NextResponse.json(await fazer(), { status, headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) {
    if (e instanceof ErroAceite) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
