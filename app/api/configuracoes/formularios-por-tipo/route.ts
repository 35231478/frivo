import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

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

// Garante que os três ids pertencem à empresa da sessão (isolamento multi-tenant)
async function validarPertinencia(empresaId: string, d: z.infer<typeof schema>) {
  const [te, to, ft] = await Promise.all([
    prisma.tipoEquipamentoCustom.findFirst({ where: { id: d.tipoEquipamentoId, empresaId }, select: { id: true } }),
    prisma.tipoOs.findFirst({ where: { id: d.tipoOsId, empresaId }, select: { id: true } }),
    prisma.formularioTemplate.findFirst({ where: { id: d.formularioTemplateId, empresaId }, select: { id: true } }),
  ]);
  return Boolean(te && to && ft);
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const mappings = await prisma.formTypeMapping.findMany({
    where: { empresaId: session.user!.empresaId },
    include: incluir,
    orderBy: [{ tipoEquipamento: { nome: "asc" } }, { tipoOs: { nome: "asc" } }],
  });
  return NextResponse.json(mappings);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  if (!(await validarPertinencia(empresaId, parsed.data))) {
    return NextResponse.json({ erro: "Registro não pertence à empresa" }, { status: 400 });
  }

  try {
    const mapping = await prisma.formTypeMapping.create({
      data: { ...parsed.data, empresaId },
      include: incluir,
    });
    return NextResponse.json(mapping, { status: 201 });
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
