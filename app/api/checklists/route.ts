import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checklistPreenchidoSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const veiculoId = searchParams.get("veiculoId");

  const checklists = await prisma.checklistPreenchido.findMany({
    where: { empresaId, ...(veiculoId && { veiculoId }) },
    include: {
      veiculo: { select: { placa: true, modelo: true } },
      colaborador: { select: { nome: true } },
      template: { select: { nome: true } },
      _count: { select: { itens: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });

  return NextResponse.json(checklists);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = checklistPreenchidoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { veiculoId, templateId, observacaoGeral, itens } = parsed.data;
  const colaboradorId = (body.colaboradorId as string) || null;

  const veiculo = await prisma.veiculo.findFirst({ where: { id: veiculoId, empresaId } });
  if (!veiculo) return NextResponse.json({ erro: "Veículo não encontrado" }, { status: 404 });

  const temAlerta = itens.some((i) => i.alerta);
  const status = temAlerta ? "COM_ALERTAS" : "CONCLUIDO";

  const checklist = await prisma.checklistPreenchido.create({
    data: {
      empresaId,
      veiculoId,
      templateId,
      colaboradorId,
      status,
      observacaoGeral: observacaoGeral || null,
      itens: {
        create: itens.map((i) => ({
          itemTemplateId: i.itemTemplateId,
          valor: i.valor || null,
          foto: i.foto || null,
          alerta: i.alerta,
        })),
      },
    },
  });

  return NextResponse.json({ ...checklist, temAlerta }, { status: 201 });
}
