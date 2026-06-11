import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  tipoEquipamentoId: z.string().min(1, "Tipo de equipamento é obrigatório"),
  tipoOsId: z.string().min(1, "Tipo de OS é obrigatório"),
  formularioTemplateId: z.string().min(1, "Formulário é obrigatório"),
});

const incluir = {
  tipoEquipamento: { select: { id: true, nome: true } },
  tipoOs: { select: { id: true, nome: true, cor: true } },
  formularioTemplate: { select: { id: true, nome: true } },
} as const;

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.formTypeMapping.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Vinculação não encontrada" }, { status: 404 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  // Multi-tenant: confirma que os ids são da empresa
  const [te, to, ft] = await Promise.all([
    prisma.tipoEquipamentoCustom.findFirst({ where: { id: parsed.data.tipoEquipamentoId, empresaId }, select: { id: true } }),
    prisma.tipoOs.findFirst({ where: { id: parsed.data.tipoOsId, empresaId }, select: { id: true } }),
    prisma.formularioTemplate.findFirst({ where: { id: parsed.data.formularioTemplateId, empresaId }, select: { id: true } }),
  ]);
  if (!te || !to || !ft) return NextResponse.json({ erro: "Registro não pertence à empresa" }, { status: 400 });

  try {
    const mapping = await prisma.formTypeMapping.update({ where: { id }, data: parsed.data, include: incluir });
    return NextResponse.json(mapping);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { erro: "Já existe um formulário vinculado a essa combinação de tipo de equipamento e tipo de OS." },
        { status: 409 },
      );
    }
    throw e;
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.formTypeMapping.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Vinculação não encontrada" }, { status: 404 });

  await prisma.formTypeMapping.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
