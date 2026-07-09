import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

type Params = { params: Promise<{ id: string; mappingId: string }> };

const schema = z.object({
  tipoOsId: z.string().min(1).optional(),
  obrigatorioConcluir: z.boolean().optional(),
  obrigatorioImpedimento: z.boolean().optional(),
});

const incluir = {
  tipoOs: { select: { id: true, nome: true, cor: true } },
  formularioTemplate: { select: { id: true, nome: true, _count: { select: { campos: true } } } },
} as const;

function serializar(m: Prisma.FormTypeMappingGetPayload<{ include: typeof incluir }>) {
  return {
    id: m.id,
    formularioTemplateId: m.formularioTemplateId,
    tipoOsId: m.tipoOsId,
    obrigatorioConcluir: m.obrigatorioConcluir,
    obrigatorioImpedimento: m.obrigatorioImpedimento,
    formulario: { id: m.formularioTemplate.id, nome: m.formularioTemplate.nome, qtdPerguntas: m.formularioTemplate._count.campos },
    tipoOs: m.tipoOs,
  };
}

// Atualiza o tipo de OS e/ou os flags de obrigatoriedade de um vínculo.
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, mappingId } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.formTypeMapping.findFirst({ where: { id: mappingId, tipoEquipamentoId: id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Vínculo não encontrado" }, { status: 404 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  if (d.tipoOsId) {
    const to = await prisma.tipoOs.findFirst({ where: { id: d.tipoOsId, empresaId }, select: { id: true } });
    if (!to) return NextResponse.json({ erro: "Tipo de OS não pertence à empresa" }, { status: 400 });
  }

  try {
    const mapping = await prisma.formTypeMapping.update({
      where: { id: mappingId },
      data: {
        ...(d.tipoOsId !== undefined ? { tipoOsId: d.tipoOsId } : {}),
        ...(d.obrigatorioConcluir !== undefined ? { obrigatorioConcluir: d.obrigatorioConcluir } : {}),
        ...(d.obrigatorioImpedimento !== undefined ? { obrigatorioImpedimento: d.obrigatorioImpedimento } : {}),
      },
      include: incluir,
    });
    return NextResponse.json(serializar(mapping));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { erro: "Este tipo de equipamento já tem um formulário vinculado para esse tipo de OS." },
        { status: 409 },
      );
    }
    throw e;
  }
}

// Remove o vínculo do formulário com o tipo de equipamento.
export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, mappingId } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.formTypeMapping.findFirst({ where: { id: mappingId, tipoEquipamentoId: id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Vínculo não encontrado" }, { status: 404 });

  await prisma.formTypeMapping.delete({ where: { id: mappingId } });
  return NextResponse.json({ ok: true });
}
