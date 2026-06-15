import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const TIPOS_PERMITIDOS = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
];

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const contrato = await prisma.contrato.findFirst({ where: { id, empresaId } });
  if (!contrato) return NextResponse.json({ erro: "Contrato não encontrado" }, { status: 404 });

  const anexos = await prisma.anexoContrato.findMany({
    where: { contratoId: id, empresaId },
    select: { id: true, nome: true, tipo: true, tamanho: true, categoria: true, criadoEm: true },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(anexos);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const contrato = await prisma.contrato.findFirst({ where: { id, empresaId } });
  if (!contrato) return NextResponse.json({ erro: "Contrato não encontrado" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("arquivo") as File | null;
  const categoria = (formData.get("categoria") as string | null) || "ANEXO";

  if (!file) return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  if (!TIPOS_PERMITIDOS.includes(file.type)) {
    return NextResponse.json({ erro: "Tipo de arquivo não permitido. Envie PDF, DOC, XLS ou imagem." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ erro: "Arquivo muito grande. Tamanho máximo: 5 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const conteudo = `data:${file.type};base64,${buffer.toString("base64")}`;

  const anexo = await prisma.anexoContrato.create({
    data: { empresaId, contratoId: id, nome: file.name, tipo: file.type, tamanho: file.size, conteudo, categoria },
    select: { id: true, nome: true, tipo: true, tamanho: true, categoria: true, criadoEm: true },
  });

  return NextResponse.json(anexo, { status: 201 });
}
