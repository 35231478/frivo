import { NextRequest, NextResponse } from "next/server";
import { MSG_FORA_DO_ESCOPO, pedidoVisivel } from "@/lib/escopo/proprios-server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { respostaAnexo } from "@/lib/anexos-server";

/** O PDF ou a foto do pedido do cliente (?inline=1 abre no navegador) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  // COM-1: "Ver só os próprios" — pedido que cobre OS/orçamento de outro vendedor não existe para a pessoa
  // COM-1.1: o anexo do pedido compartilhado é visto por quem tem alguma OS/orçamento nele (como a gaveta)
  if (!(await pedidoVisivel(session.user, id))) return NextResponse.json({ erro: MSG_FORA_DO_ESCOPO }, { status: 404 });
  const p = await prisma.pedidoCliente.findFirst({ where: { id, empresaId: session.user.empresaId }, select: { anexo: true, anexoNome: true } });
  if (!p?.anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });
  return respostaAnexo({ nome: p.anexoNome ?? "pedido", conteudo: p.anexo }, req.nextUrl.searchParams.get("inline") === "1");
}
