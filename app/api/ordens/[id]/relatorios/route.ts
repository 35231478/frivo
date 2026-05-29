import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { relatorioSchema } from "@/lib/validations";
import { gerarNumeroRelatorio } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const relatorios = await prisma.relatorioOs.findMany({
    where: { empresaId, ordemServicoId: id },
    orderBy: { criadoEm: "desc" },
  });
  return NextResponse.json(relatorios);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    select: { id: true, contratoId: true },
  });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const parsed = relatorioSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const seq = (await prisma.relatorioOs.count({ where: { empresaId } })) + 1;
  const numero = gerarNumeroRelatorio(seq, data.anoReferencia);

  const relatorio = await prisma.relatorioOs.create({
    data: {
      empresaId,
      ordemServicoId: id,
      contratoId: os.contratoId,
      numero,
      tipo: data.tipo,
      mesReferencia: data.mesReferencia,
      anoReferencia: data.anoReferencia,
      valorFinanceiro: data.valorFinanceiro ?? null,
      observacao: data.observacao ?? null,
      status: "RASCUNHO",
      tokenPublico: crypto.randomUUID(),
    },
  });

  return NextResponse.json(relatorio, { status: 201 });
}
