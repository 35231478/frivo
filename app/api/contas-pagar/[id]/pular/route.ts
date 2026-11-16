import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroRecorrencia, pularOcorrencia } from "@/lib/financeiro/conta-pagar-recorrencia-server";

/**
 * PULAR uma ocorrência da despesa recorrente: a conta daquele mês é CANCELADA (status, nunca
 * exclusão) e a regra continua valendo — o mês seguinte nasce normalmente. Conta já paga não pula.
 * Exige "Financeiro › Fluxo de caixa".
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  try {
    return NextResponse.json(await pularOcorrencia(guard.session.user.empresaId, id));
  } catch (e) {
    if (e instanceof ErroRecorrencia) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
