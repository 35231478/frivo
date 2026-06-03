import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { termoTemplateSchema } from "@/lib/validations";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const termos = await prisma.termoReferenciaTemplate.findMany({
    where: { empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(termos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const parsed = termoTemplateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const termo = await prisma.termoReferenciaTemplate.create({
    data: {
      empresaId,
      nome: parsed.data.nome,
      descricao: parsed.data.descricao || null,
      conteudo: parsed.data.conteudo || "",
    },
  });
  return NextResponse.json(termo, { status: 201 });
}
