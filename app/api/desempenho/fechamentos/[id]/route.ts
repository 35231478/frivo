import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { MSG_FECHAMENTO_NAO_ENCONTRADO, folhaDoFechamento } from "@/lib/desempenho/fechamento-server";

/** A folha de bônus de um fechamento (o vigente ou um do histórico), só leitura. "Desempenho › Gerenciar". */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const folha = await folhaDoFechamento(guard.session.user.empresaId, (await params).id);
  if (!folha) return NextResponse.json({ erro: MSG_FECHAMENTO_NAO_ENCONTRADO }, { status: 404 });
  return NextResponse.json(folha, { headers: { "Cache-Control": "private, no-store" } });
}
