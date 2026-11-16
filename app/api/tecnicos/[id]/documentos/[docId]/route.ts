import { NextRequest, NextResponse } from "next/server";
import { respostaAnexo } from "@/lib/anexos-server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroDocumento, alterarDocumento, arquivoDoDocumento, excluirDocumento } from "@/lib/colaborador/documentos-server";

type Params = { params: Promise<{ id: string; docId: string }> };

function responder(e: unknown): NextResponse {
  if (e instanceof ErroDocumento) return NextResponse.json({ erro: e.message }, { status: e.status });
  throw e;
}

/**
 * Baixa o arquivo. O tipo sai dos BYTES e a resposta leva `nosniff` e sandbox — um HTML guardado
 * como "documento" nunca executa no navegador de quem baixa.
 *
 * `?ver=1` abre na aba (PDF e imagem); sem isso, baixa.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id, docId } = await params;
  try {
    const a = await arquivoDoDocumento(docId, id, guard.session.user!.empresaId);
    return respostaAnexo(a, req.nextUrl.searchParams.get("ver") === "1");
  } catch (e) { return responder(e); }
}

/** Corrige a gaveta, o nome ou a validade. O arquivo não se troca por aqui. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id, docId } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const doc = await alterarDocumento(docId, id, guard.session.user!.empresaId, {
      categoria: body?.categoria, nome: body?.nome, dataVencimento: body?.dataVencimento,
    });
    return NextResponse.json({ documento: doc });
  } catch (e) { return responder(e); }
}

/**
 * Exclui COM RASTRO. Permissão mais alta ("Equipes / Colaboradores › excluir"): é a mesma de
 * inativar e de apagar o colaborador — tirar o contrato de alguém da ficha não é um clique de
 * quem só edita cadastro.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "excluir");
  if (guard.erro) return guard.resposta;
  const { id, docId } = await params;
  try {
    await excluirDocumento(docId, id, guard.session.user!.empresaId, { usuarioId: guard.session.user!.id });
    return NextResponse.json({ ok: true });
  } catch (e) { return responder(e); }
}
