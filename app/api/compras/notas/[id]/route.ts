import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { carregarNota, descartarNota, ErroNota } from "@/lib/compras/notas";
import { lerMotivo } from "@/lib/inativacao-server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/compras/notas/:id — nota da empresa da sessão, com itens e contas geradas */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const nota = await carregarNota(guard.session.user!.empresaId, id);
  if (!nota) return NextResponse.json({ erro: "Nota não encontrada" }, { status: 404 });
  const { xml: _xml, ...semXml } = nota;
  return NextResponse.json(semXml);
}

/**
 * DELETE /api/compras/notas/:id { motivo? } — DESCARTA a nota importada por engano (Importada ou
 * Conciliada): apaga a nota e grava quem descartou, quando e por quê (NotaCompraDescarte). A lançada
 * não se descarta (409): o estorno é pela conta a pagar e pelo ajuste de estoque. Estoque › gerenciar.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const user = guard.session.user!;
  try {
    await descartarNota({ empresaId: user.empresaId, usuarioId: user.id, id, motivo: lerMotivo(await req.json().catch(() => ({}))) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ErroNota) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
