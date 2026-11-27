import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { visualizacaoDaNota } from "@/lib/compras/notas";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/compras/notas/:id/visualizar — a visualização rápida (gaveta da lista): os dados da nota e a
 * DANFE simplificada lida do XML (`danfe: null` = nota sem XML legível). Estoque › visualizar; empresa da sessão.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const v = await visualizacaoDaNota(guard.session.user!.empresaId, (await params).id);
  if (!v) return NextResponse.json({ erro: "Nota não encontrada" }, { status: 404 });
  return NextResponse.json(v);
}
