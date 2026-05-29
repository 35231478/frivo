import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const usuarios = await prisma.usuario.findMany({
    where: { empresaId: session.user!.empresaId, ativo: true },
    select: { id: true, nome: true, role: true, telefone: true },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(usuarios);
}
