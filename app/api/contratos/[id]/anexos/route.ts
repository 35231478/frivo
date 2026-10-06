import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validarArquivoUpload } from "@/lib/anexos-server";

type Params = { params: Promise<{ id: string }> };

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
  // Tipo decidido pelo conteúdo (não pelo que o navegador declara)
  const v = await validarArquivoUpload(file);
  if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400 });
  const { nome, tipo, tamanho, conteudo } = v.arquivo;

  const anexo = await prisma.anexoContrato.create({
    data: { empresaId, contratoId: id, nome, tipo, tamanho, conteudo, categoria },
    select: { id: true, nome: true, tipo: true, tamanho: true, categoria: true, criadoEm: true },
  });

  return NextResponse.json(anexo, { status: 201 });
}
