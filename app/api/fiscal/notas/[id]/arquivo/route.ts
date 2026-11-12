import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { arquivoNota, ErroEmissao } from "@/lib/nfse/emissao-server";

type Params = { params: Promise<{ id: string }> };

/**
 * PDF (DANFSE) ou XML da nota autorizada: buscado no PlugNotas pelo servidor, com o token, e
 * repassado aqui (o endereço deles exige o token, que nunca vai para o navegador).
 * Fiscal, Medições ou Contas a receber; empresa da sessão.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["financeiro", "fiscal"], ["financeiro", "medicoes"], ["financeiro", "contasReceber"]]);
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const tipo = req.nextUrl.searchParams.get("tipo") === "xml" ? "xml" : "pdf";
  try {
    const a = await arquivoNota(guard.session.user!.empresaId, id, tipo);
    return new NextResponse(Buffer.from(a.bytes), {
      headers: {
        "Content-Type": a.contentType,
        "Content-Disposition": `${tipo === "pdf" ? "inline" : "attachment"}; filename="${a.nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ErroEmissao) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
