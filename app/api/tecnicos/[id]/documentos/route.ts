import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroDocumento, anexarDocumento, documentosDoColaborador } from "@/lib/colaborador/documentos-server";

type Params = { params: Promise<{ id: string }> };

/** O erro de regra vira resposta; o resto sobe (e vira 500 com log), como no resto da casa. */
function responder(e: unknown): NextResponse {
  if (e instanceof ErroDocumento) return NextResponse.json({ erro: e.message }, { status: e.status });
  throw e;
}

/**
 * Os documentos da ficha de um colaborador.
 *
 * Mesma permissão da ficha completa ("Equipes / Colaboradores › gerenciar"): quem não pode ver
 * CPF e RG do colaborador também não pode ver os papéis dele.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  try {
    return NextResponse.json({ documentos: await documentosDoColaborador(id, guard.session.user!.empresaId) });
  } catch (e) { return responder(e); }
}

/** Anexa um arquivo à ficha. Fica registrado quem anexou. */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const doc = await anexarDocumento(
      id, guard.session.user!.empresaId,
      { categoria: body?.categoria, nome: body?.nome, arquivoUrl: body?.arquivoUrl, dataVencimento: body?.dataVencimento },
      { usuarioId: guard.session.user!.id },
    );
    return NextResponse.json({ documento: doc }, { status: 201 });
  } catch (e) { return responder(e); }
}
