import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { MSG_FECHAMENTO_NAO_ENCONTRADO, csvDoFechamento } from "@/lib/desempenho/fechamento-server";

/** A folha de bônus em CSV, para o financeiro pagar. Só de mês fechado. "Desempenho › Gerenciar". */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const csv = await csvDoFechamento(guard.session.user.empresaId, (await params).id);
  if (!csv) return NextResponse.json({ erro: MSG_FECHAMENTO_NAO_ENCONTRADO }, { status: 404 });
  return new NextResponse(csv.conteudo, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${csv.arquivo}"`, "Cache-Control": "private, no-store" },
  });
}
