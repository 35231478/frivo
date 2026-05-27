import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const empresaId = session.user!.empresaId;

  let config = await prisma.configuracao.findUnique({ where: { empresaId } });

  if (!config) {
    config = await prisma.configuracao.create({
      data: { empresaId },
    });
  }

  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const role = session.user!.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ erro: "Apenas administradores podem alterar configurações." }, { status: 403 });
  }

  const empresaId = session.user!.empresaId;
  const body = await req.json();

  const { id, empresaId: _, ...dados } = body;

  const config = await prisma.configuracao.upsert({
    where: { empresaId },
    create: { empresaId, ...dados },
    update: dados,
  });

  return NextResponse.json(config);
}
