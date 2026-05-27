import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("logo") as File | null;
  if (!file || !file.type.startsWith("image/")) {
    return NextResponse.json({ erro: "Envie apenas imagens." }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ erro: "Imagem muito grande. Máx: 2 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const logo = `data:${file.type};base64,${buffer.toString("base64")}`;

  await prisma.empresa.update({ where: { id: session.user!.empresaId }, data: { logo } });
  return NextResponse.json({ logo });
}

export async function DELETE() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  await prisma.empresa.update({ where: { id: session.user!.empresaId }, data: { logo: null } });
  return NextResponse.json({ ok: true });
}
