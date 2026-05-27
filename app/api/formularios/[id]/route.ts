import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TipoCampo } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { campos, tipoOsId, ...resto } = body;

  const atualizado = await prisma.$transaction(async (tx) => {
    if (campos) {
      await tx.formularioCampo.deleteMany({ where: { formularioId: id } });
    }
    return tx.formularioTemplate.update({
      where: { id },
      data: {
        ...resto,
        tipoOsId: tipoOsId || null,
        ...(campos && {
          campos: {
            create: campos.map((c: any) => ({
              label: c.label,
              tipo: c.tipo as TipoCampo,
              obrigatorio: c.obrigatorio ?? false,
              ordem: c.ordem ?? 0,
              opcoes: c.opcoes ?? null,
            })),
          },
        }),
      },
      include: {
        campos: { orderBy: { ordem: "asc" } },
        tipoOs: { select: { id: true, nome: true, cor: true } },
      },
    });
  });

  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  await prisma.formularioTemplate.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
