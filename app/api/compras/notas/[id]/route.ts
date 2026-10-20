import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { carregarNota } from "@/lib/compras/notas";

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
