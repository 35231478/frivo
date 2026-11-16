/**
 * MODELOS DE DOCUMENTO — o que as rotas têm em comum.
 *
 *  - `guardaDeDocumentos`: a permissão "Documentos do colaborador › criar" (401 sem sessão, 403
 *    sem permissão), e já diz se quem chamou tem também "› disciplinar" — é essa segunda que
 *    libera advertência e suspensão, para gerar E para ver;
 *  - `responderDocumento`: erro de regra vira resposta com a mensagem, o resto sobe.
 */

import { NextResponse, type NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode, type Permissoes } from "@/lib/permissoes";
import { ErroDocumento } from "@/lib/documentos/documentos-server";

export const MODULO_DOCUMENTOS = "documentos";

export interface AtorDocumentos {
  empresaId: string;
  usuarioId: string;
  /** Tem "Documentos do colaborador › disciplinar" (advertência e suspensão) */
  podeDisciplinar: boolean;
}

const SEM_CACHE = { "Cache-Control": "private, no-store" };

export async function guardaDeDocumentos():
Promise<{ ator: AtorDocumentos; resposta?: undefined } | { ator?: undefined; resposta: NextResponse }> {
  const guard = await exigirPermissao(MODULO_DOCUMENTOS, "criar");
  if (guard.erro) return { resposta: guard.resposta };
  const { empresaId, id: usuarioId, permissoes, role } = guard.session.user;
  return { ator: { empresaId, usuarioId, podeDisciplinar: pode(permissoes as Permissoes, MODULO_DOCUMENTOS, "disciplinar", role) } };
}

/** Erro de regra vira a resposta com a mensagem; o resto sobe. */
export async function responderDocumento<T>(fazer: () => Promise<T>, status = 200): Promise<NextResponse> {
  try { return NextResponse.json(await fazer(), { status, headers: SEM_CACHE }); }
  catch (e) {
    if (e instanceof ErroDocumento) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}

/** O corpo JSON da requisição, ou {} — corpo quebrado não vira 500. */
export async function corpo(req: NextRequest): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}
