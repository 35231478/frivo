import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  formularioTemplateId: z.string().min(1, "Formulário é obrigatório"),
  tipoOsId: z.string().min(1, "Tipo de OS é obrigatório"),
  obrigatorioConcluir: z.boolean().optional().default(false),
  obrigatorioImpedimento: z.boolean().optional().default(false),
});

const incluir = {
  tipoOs: { select: { id: true, nome: true, cor: true } },
  formularioTemplate: { select: { id: true, nome: true, _count: { select: { campos: true } } } },
} as const;

// Serializa um mapping para o formato consumido pela aba Formulários do equipamento.
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

// Lista os formulários vinculados a um tipo de equipamento.
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const equip = await prisma.tipoEquipamentoCustom.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!equip) return NextResponse.json({ erro: "Tipo de equipamento não encontrado" }, { status: 404 });

  const mappings = await prisma.formTypeMapping.findMany({
    where: { empresaId, tipoEquipamentoId: id },
    include: incluir,
    orderBy: { criadoEm: "asc" },
  });
  return NextResponse.json(mappings.map(serializar));
}

// Vincula um formulário (para um tipo de OS) ao tipo de equipamento.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const equip = await prisma.tipoEquipamentoCustom.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!equip) return NextResponse.json({ erro: "Tipo de equipamento não encontrado" }, { status: 404 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const d = parsed.data;

  // Isolamento multi-tenant: os dois ids devem pertencer à empresa
  const [to, ft] = await Promise.all([
    prisma.tipoOs.findFirst({ where: { id: d.tipoOsId, empresaId }, select: { id: true } }),
    prisma.formularioTemplate.findFirst({ where: { id: d.formularioTemplateId, empresaId }, select: { id: true } }),
  ]);
  if (!to || !ft) return NextResponse.json({ erro: "Registro não pertence à empresa" }, { status: 400 });

  try {
    const mapping = await prisma.formTypeMapping.create({
      data: {
        empresaId,
        tipoEquipamentoId: id,
        tipoOsId: d.tipoOsId,
        formularioTemplateId: d.formularioTemplateId,
        obrigatorioConcluir: d.obrigatorioConcluir,
        obrigatorioImpedimento: d.obrigatorioImpedimento,
      },
      include: incluir,
    });
    return NextResponse.json(serializar(mapping), { status: 201 });
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
