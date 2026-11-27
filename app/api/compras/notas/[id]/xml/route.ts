import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { xmlDaNota } from "@/lib/compras/notas";
import { nomeArquivoNota } from "@/lib/compras/danfe-texto";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/compras/notas/:id/xml — o XML da NF-e como foi importado (Baixar XML). Nota sem XML de NF-e
 * legível: 404. Estoque › visualizar; empresa da sessão.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const n = await xmlDaNota(guard.session.user!.empresaId, (await params).id);
  if (!n) return NextResponse.json({ erro: "Esta nota não tem o XML da NF-e." }, { status: 404 });
  return new NextResponse(n.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeArquivoNota(n.chave, "xml")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
