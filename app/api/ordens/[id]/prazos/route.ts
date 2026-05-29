import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { osPrazoSchema } from "@/lib/validations";
import { montarEtapas } from "@/lib/prazo-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const prazos = await prisma.osPrazo.findMany({
    where: { ordemServicoId: id },
    include: { etapas: { orderBy: { ordem: "asc" } }, template: { select: { cor: true } } },
    orderBy: { criadoEm: "desc" },
  });
  return NextResponse.json(prazos);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const parsed = osPrazoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const template = await prisma.prazoTemplate.findFirst({
    where: { id: parsed.data.templateId, empresaId },
    include: { etapas: { orderBy: { ordem: "asc" } } },
  });
  if (!template) return NextResponse.json({ erro: "Template inválido" }, { status: 400 });
  if (template.etapas.length === 0) {
    return NextResponse.json({ erro: "Template não possui etapas" }, { status: 400 });
  }

  const etapas = montarEtapas(template.etapas, new Date());

  const prazo = await prisma.osPrazo.create({
    data: {
      ordemServicoId: id,
      templateId: template.id,
      nome: parsed.data.nome?.trim() || template.nome,
      status: "ATIVO",
      etapaAtual: 0,
      etapas: {
        create: etapas.map((e) => ({
          nome: e.nome,
          prazoHoras: e.prazoHoras,
          prazoLimite: e.prazoLimite,
          status: e.status,
          responsavel: e.responsavel,
          canal: e.canal,
          mensagem: e.mensagem,
          ordem: e.ordem,
        })),
      },
    },
    include: { etapas: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(prazo, { status: 201 });
}
