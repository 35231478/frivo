import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("logo") as File | null;

  if (!file) {
    return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ erro: "Envie apenas imagens (PNG, JPG, WEBP)." }, { status: 400 });
  }

  if (file.size > MAX_LOGO_SIZE) {
    return NextResponse.json({ erro: "Imagem muito grande. Tamanho máximo: 2 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const logo = `data:${file.type};base64,${buffer.toString("base64")}`;

  await prisma.cliente.update({ where: { id }, data: { logo } });

  return NextResponse.json({ logo });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  await prisma.cliente.update({ where: { id }, data: { logo: null } });
  return NextResponse.json({ ok: true });
}
