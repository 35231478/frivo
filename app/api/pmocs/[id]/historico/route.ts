import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { historicoDoPlano } from "@/lib/pmoc-documento-server";

/** A linha do tempo do plano: envios ao cliente, avisos de vencimento, ART e publicação. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const historico = await historicoDoPlano(id, guard.session.user!.empresaId);
  if (!historico) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json({ historico });
}
