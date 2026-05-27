import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { TipoCampo } from "@prisma/client";

const campoSchema = z.object({
  label: z.string().min(1),
  tipo: z.nativeEnum(TipoCampo),
  obrigatorio: z.boolean().default(false),
  ordem: z.number().default(0),
  opcoes: z.any().optional(),
});

const formularioSchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  tipoOsId: z.string().optional().nullable(),
  campos: z.array(campoSchema).optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const tipoOsId = searchParams.get("tipoOsId");

  const formularios = await prisma.formularioTemplate.findMany({
    where: { empresaId, ativo: true, ...(tipoOsId && { tipoOsId }) },
    include: {
      campos: { orderBy: { ordem: "asc" } },
      tipoOs: { select: { id: true, nome: true, cor: true } },
    },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(formularios);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = formularioSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const { campos, tipoOsId, ...resto } = parsed.data;
  const formulario = await prisma.formularioTemplate.create({
    data: {
      ...resto,
      empresaId,
      tipoOsId: tipoOsId || null,
      campos: campos ? { create: campos } : undefined,
    },
    include: { campos: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(formulario, { status: 201 });
}
