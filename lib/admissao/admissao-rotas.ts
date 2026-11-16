/**
 * ADMISSÃO DIGITAL — o que as rotas têm em comum.
 *
 *  - `guardaDoRh`: a permissão "Admissão digital › gerenciar" (401 sem sessão, 403 sem permissão);
 *  - `responderAdmissao`: erro de regra vira resposta com a mensagem, o resto sobe;
 *  - `responderPublico`: o mesmo para o LINK do colaborador, com o limite por IP. Token recusado
 *    (não existe ou venceu) CONTA no limite — é o que impede varrer tokens no escuro; link bom não
 *    conta nada, então quem está preenchendo nunca é barrado pelo próprio trabalho.
 */
import { NextResponse, type NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { conferirBloqueio, ipDaRequisicao, registrarTentativa } from "@/lib/acesso/limite";
import { ErroAdmissao } from "@/lib/admissao/admissao-server";

export const MODULO_ADMISSAO = "admissao";

export interface AtorDoRh { empresaId: string; usuarioId: string }

const SEM_CACHE = { "Cache-Control": "private, no-store" };

/** Quem mexe em admissão precisa de "Admissão digital › gerenciar" — dado sensível de pessoa. */
export async function guardaDoRh(): Promise<{ ator: AtorDoRh; resposta?: undefined } | { ator?: undefined; resposta: NextResponse }> {
  const guard = await exigirPermissao(MODULO_ADMISSAO, "gerenciar");
  if (guard.erro) return { resposta: guard.resposta };
  const { empresaId, id: usuarioId } = guard.session.user;
  return { ator: { empresaId, usuarioId } };
}

/** Erro de regra vira a resposta com a mensagem; o resto sobe. */
export async function responderAdmissao<T>(fazer: () => Promise<T>, status = 200): Promise<NextResponse> {
  try { return NextResponse.json(await fazer(), { status, headers: SEM_CACHE }); }
  catch (e) {
    if (e instanceof ErroAdmissao) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}

/** Token que não serve: 404 (não existe) e 410 (venceu). São estes que contam no limite. */
const TOKEN_RECUSADO = [404, 410];

/**
 * A resposta de uma rota do LINK público, com o limite por IP. A mensagem de um token recusado é
 * sempre a mesma do servidor — nada aqui conta se o token existe ou não.
 */
export async function responderPublico<T>(req: NextRequest, fazer: () => Promise<T>, status = 200): Promise<NextResponse> {
  const alvos = { ip: ipDaRequisicao(req.headers) };
  const bloqueio = await conferirBloqueio("ADMISSAO_PUBLICA", alvos);
  if (bloqueio.bloqueado) {
    return NextResponse.json({ erro: `Muitas tentativas. Tente de novo em ${bloqueio.minutos} min.` }, { status: 429, headers: SEM_CACHE });
  }
  try { return NextResponse.json(await fazer(), { status, headers: SEM_CACHE }); }
  catch (e) {
    if (e instanceof ErroAdmissao) {
      if (TOKEN_RECUSADO.includes(e.status)) await registrarTentativa("ADMISSAO_PUBLICA", alvos);
      return NextResponse.json({ erro: e.message }, { status: e.status, headers: SEM_CACHE });
    }
    throw e;
  }
}

/** O corpo JSON da requisição, ou {} — corpo quebrado não vira 500. */
export async function corpo(req: NextRequest): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

export { ipDaRequisicao };
