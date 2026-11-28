import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroNota, restaurarNotaDescartada } from "@/lib/compras/notas";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/compras/notas/descartes/:id/restaurar — RESTAURA a nota descartada: reimporta pelo XML
 * guardado no descarte (o mesmo caminho da importação) e marca quem restaurou e quando. A mesma
 * permissão de descartar: Estoque › gerenciar. 201 = a nota voltou (como na importação); 409 = descarte
 * antigo sem XML, já restaurado ou nota já importada de novo; 404 = de outra empresa.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  try {
    const r = await restaurarNotaDescartada({ empresaId: user.empresaId, usuarioId: user.id, descarteId: (await params).id });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof ErroNota) return NextResponse.json({ erro: e.message, ...e.extra }, { status: e.status });
    throw e;
  }
}
