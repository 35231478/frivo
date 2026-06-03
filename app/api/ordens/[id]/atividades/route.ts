import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const atividadeSchema = z.object({
  titulo: z.string().min(1),
  tipoOsId: z.string().optional(),
  tecnicoId: z.string().optional(),
  dataAgendada: z.string().optional(),
  duracaoMin: z.number().optional(),
  observacao: z.string().optional(),
  status: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: "Ordem de serviço não encontrada" }, { status: 404 });

  const body = await req.json();
  const parsed = atividadeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const atividade = await prisma.atividadeOs.create({
    data: {
      empresaId,
      ordemServicoId: id,
      titulo: parsed.data.titulo,
      tipoOsId: parsed.data.tipoOsId || null,
      tecnicoId: parsed.data.tecnicoId || null,
      dataAgendada: parsed.data.dataAgendada ? new Date(parsed.data.dataAgendada) : null,
      duracaoMin: parsed.data.duracaoMin ?? null,
      observacao: parsed.data.observacao || null,
    },
    include: {
      tipoOs: { select: { id: true, nome: true, cor: true } },
      tecnico: { select: { id: true, nome: true } },
    },
  });

  await prisma.osHistorico.create({
    data: {
      ordemServicoId: id, usuarioId: session.user!.id,
      acao: "Atividade adicionada", detalhes: parsed.data.titulo,
    },
  });

  return NextResponse.json(atividade, { status: 201 });
}
