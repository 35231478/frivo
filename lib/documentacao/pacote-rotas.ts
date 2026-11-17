/**
 * DOCUMENTAÇÃO DA EQUIPE — o que as rotas têm em comum.
 *
 *  - `guardaDeEnvio`: a permissão "Documentos do colaborador › enviar ao cliente" (401 sem sessão,
 *    403 sem permissão). É ação própria: gerar um documento na ficha não dá o direito de mandar a
 *    documentação da equipe para fora da empresa;
 *  - `responderEnvio`: erro de regra vira resposta com a mensagem (e o detalhe — a lista do que
 *    venceu ou falta —, que é o que a tela mostra); o resto sobe;
 *  - `responderLink`: o mesmo para o LINK do cliente, com o limite por IP. Só token recusado conta
 *    no limite: quem tem o link bom baixa à vontade, e varrer tokens no escuro não vai longe.
 */

import { NextResponse, type NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { conferirBloqueio, ipDaRequisicao, registrarTentativa } from "@/lib/acesso/limite";
import { ErroDocumentacao, type Ator, type Origem } from "@/lib/documentacao/pacote-server";

export const MODULO_DOCUMENTACAO = "documentos";
export const ACAO_ENVIAR = "enviar";

const SEM_CACHE = { "Cache-Control": "private, no-store" };

export async function guardaDeEnvio(): Promise<{ ator: Ator; resposta?: undefined } | { ator?: undefined; resposta: NextResponse }> {
  const guard = await exigirPermissao(MODULO_DOCUMENTACAO, ACAO_ENVIAR);
  if (guard.erro) return { resposta: guard.resposta };
  const { empresaId, id: usuarioId } = guard.session.user;
  return { ator: { empresaId, usuarioId } };
}

const corpoDoErro = (e: ErroDocumentacao) => (e.detalhe === undefined ? { erro: e.message } : { erro: e.message, detalhe: e.detalhe });

/** Erro de regra vira a resposta com a mensagem; o resto sobe. */
export async function responderEnvio<T>(fazer: () => Promise<T>, status = 200): Promise<NextResponse> {
  try { return NextResponse.json(await fazer(), { status, headers: SEM_CACHE }); }
  catch (e) {
    if (e instanceof ErroDocumentacao) return NextResponse.json(corpoDoErro(e), { status: e.status, headers: SEM_CACHE });
    throw e;
  }
}

/** De onde veio a requisição — vai para a linha do tempo do envio. */
export const origemDa = (req: NextRequest): Origem => ({
  ip: ipDaRequisicao(req.headers),
  userAgent: req.headers.get("user-agent"),
});

/** Token que não serve: 404 (não existe) e 410 (expirou ou foi revogado). São estes que contam. */
const TOKEN_RECUSADO = [404, 410];

/**
 * Roda uma ação do LINK público com o limite por IP. `fazer` devolve a resposta pronta (JSON ou
 * arquivo); o erro de regra vira JSON com a mensagem — sempre a mesma para link que não serve.
 */
export async function responderLink(req: NextRequest, fazer: () => Promise<Response>): Promise<Response> {
  const alvos = { ip: ipDaRequisicao(req.headers) };
  const bloqueio = await conferirBloqueio("DOCUMENTACAO_PUBLICA", alvos);
  if (bloqueio.bloqueado) {
    return NextResponse.json({ erro: `Muitas tentativas. Tente de novo em ${bloqueio.minutos} min.` }, { status: 429, headers: SEM_CACHE });
  }
  try { return await fazer(); }
  catch (e) {
    if (e instanceof ErroDocumentacao) {
      if (TOKEN_RECUSADO.includes(e.status)) await registrarTentativa("DOCUMENTACAO_PUBLICA", alvos);
      return NextResponse.json({ erro: e.message }, { status: e.status, headers: SEM_CACHE });
    }
    throw e;
  }
}

export const jsonSemCache = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: SEM_CACHE });

/** O corpo JSON da requisição, ou {} — corpo quebrado não vira 500. */
export async function corpo(req: NextRequest): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}
