import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  const formData = await req.formData();
  const file = formData.get("arquivo") as File | null;
  if (!file) return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ erro: "Máximo 5 MB." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const conteudo = `data:${file.type};base64,${buffer.toString("base64")}`;

  const anexo = await prisma.osAnexo.create({
    data: { ordemServicoId: id, nome: file.name, tipo: file.type, tamanho: file.size, conteudo },
    select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true },
  });

  return NextResponse.json(anexo, { status: 201 });
}
