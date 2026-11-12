import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { darCienciaDoAviso } from "@/lib/pmoc-avisos-server";

/**
 * Ciência do aviso de vencimento do plano: tira o aviso do sino e do dashboard de todos e fica no
 * histórico. Exige "PMOC › Editar" (é uma decisão sobre o plano, não só uma leitura).
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const tipo = await darCienciaDoAviso(id, guard.session.user!.empresaId, guard.session.user!.id);
  if (!tipo) return NextResponse.json({ erro: "Este PMOC não tem aviso de vencimento." }, { status: 404 });
  return NextResponse.json({ ok: true, tipo });
}
