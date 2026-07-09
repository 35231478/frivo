import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// Lista onde este formulário está vinculado (tipo de equipamento + tipo de OS + flags).
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const form = await prisma.formularioTemplate.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!form) return NextResponse.json({ erro: "Formulário não encontrado" }, { status: 404 });

  const vinculos = await prisma.formTypeMapping.findMany({
    where: { empresaId, formularioTemplateId: id },
    include: {
      tipoEquipamento: { select: { id: true, nome: true } },
      tipoOs: { select: { id: true, nome: true, cor: true } },
    },
    orderBy: [{ tipoEquipamento: { nome: "asc" } }, { tipoOs: { nome: "asc" } }],
  });

  return NextResponse.json(
    vinculos.map((v) => ({
      id: v.id,
      tipoEquipamento: v.tipoEquipamento,
      tipoOs: v.tipoOs,
      obrigatorioConcluir: v.obrigatorioConcluir,
      obrigatorioImpedimento: v.obrigatorioImpedimento,
    })),
  );
}
