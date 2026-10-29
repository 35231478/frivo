import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { consultarNota, ErroEmissao } from "@/lib/nfse/emissao-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Atualiza a situação da nota no PlugNotas (a tela chama sozinha enquanto a nota processa).
 * Fiscal ou Medições; empresa da sessão; no máximo uma consulta a cada 5 s por nota.
 */
export async function POST(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["financeiro", "fiscal"], ["financeiro", "medicoes"]]);
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const { id } = await params;
  try {
    const n = await consultarNota({ id: user.id, empresaId: user.empresaId }, id);
    return NextResponse.json({ id: n.id, status: n.status, numero: n.numero, codigoVerificacao: n.codigoVerificacao, motivo: n.motivo });
  } catch (e) {
    if (e instanceof ErroEmissao) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
