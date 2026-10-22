import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { respostaAnexo } from "@/lib/anexos-server";

type Params = { params: Promise<{ id: string; anexoId: string }> };

/** Baixa o anexo (?inline=1 abre no navegador — só imagem comum/PDF; o resto é sempre download). */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "visualizar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoCliente.findFirst({
    where: { id: anexoId, clienteId: id, empresaId },
  });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  // Binário com o tipo decidido pelos BYTES (nosniff + sandbox) — nunca um data URL para a tela abrir
  return respostaAnexo(anexo, req.nextUrl.searchParams.get("inline") === "1");
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoCliente.findFirst({
    where: { id: anexoId, clienteId: id, empresaId },
  });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  await prisma.anexoCliente.delete({ where: { id: anexoId } });
  return NextResponse.json({ ok: true });
}
