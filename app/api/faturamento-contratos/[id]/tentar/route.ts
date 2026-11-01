import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { retentarExecucao } from "@/lib/faturamento/rotina-contratos-server";

/** "Tentar de novo": zera as tentativas da execução (da empresa da sessão) e processa agora */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const ex = await retentarExecucao(guard.session.user!.empresaId, id);
  if (!ex) return NextResponse.json({ erro: "Esta cobrança não está num estado que dá para tentar de novo." }, { status: 404 });
  return NextResponse.json({ ok: true, execucao: ex });
}
