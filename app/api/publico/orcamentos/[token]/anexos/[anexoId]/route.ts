import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaAnexo } from "@/lib/anexos-server";

type Params = { params: Promise<{ token: string; anexoId: string }> };

/**
 * Anexo da proposta no link público (quem tem o link do orçamento vê os anexos dele). O token é o
 * do orçamento; o anexo precisa ser DELE. Tipo servido pelos bytes, com nosniff/CSP (respostaAnexo).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { token, anexoId } = await params;
  const anexo = await prisma.orcamentoAnexo.findFirst({
    where: { id: anexoId, orcamento: { tokenPublico: token, status: { not: "CANCELADO" } } },
    select: { nome: true, conteudo: true },
  });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });
  return respostaAnexo(anexo, req.nextUrl.searchParams.get("inline") === "1");
}
