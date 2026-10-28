import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { carregarEmitente, ErroFiscal, testarEmitente } from "@/lib/nfse/emitente-server";

/** POST /api/fiscal/emitente/testar — confere no PlugNotas se o emitente da empresa da sessão está válido. Financeiro › Fiscal. */
export async function POST() {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  try {
    const r = await testarEmitente(empresaId);
    return NextResponse.json({ ...r, emitente: await carregarEmitente(empresaId) }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    if (e instanceof ErroFiscal) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
