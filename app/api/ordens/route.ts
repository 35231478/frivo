import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const osCreateSchema = z.object({
  clienteId: z.string().min(1),
  unidadeId: z.string().optional(),
  contratoId: z.string().optional(),
  prioridade: z.string().default("NORMAL"),
  descricao: z.string().min(5),
  previsaoConclusao: z.string().optional(),
  observacoes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const prioridade = searchParams.get("prioridade");
  const clienteId = searchParams.get("clienteId");
  const origem = searchParams.get("origem");
  const busca = searchParams.get("busca") ?? "";

  const where: any = { empresaId };
  if (status) where.status = status;
  if (prioridade) where.prioridade = prioridade;
  if (clienteId) where.clienteId = clienteId;
  if (origem) where.origem = origem;
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { descricao: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const ordens = await prisma.ordemServico.findMany({
    where,
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      unidade: { select: { id: true, nome: true } },
      responsavel: { select: { id: true, nome: true } },
      _count: { select: { atividades: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });

  return NextResponse.json(ordens);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json();
  const parsed = osCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const ano = new Date().getFullYear();
  const ultimaOs = await prisma.ordemServico.findFirst({
    where: { empresaId, numero: { startsWith: `OS-${ano}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const seq = (ultimaOs ? Number(ultimaOs.numero.split("-")[2]) : 0) + 1;
  const numero = `OS-${ano}-${String(seq).padStart(4, "0")}`;

  const os = await prisma.ordemServico.create({
    data: {
      empresaId,
      numero,
      clienteId: parsed.data.clienteId,
      unidadeId: parsed.data.unidadeId || null,
      contratoId: parsed.data.contratoId || null,
      responsavelId: usuarioId,
      criadoPorId: usuarioId,
      prioridade: parsed.data.prioridade as any,
      status: "ABERTA",
      descricao: parsed.data.descricao,
      previsaoConclusao: parsed.data.previsaoConclusao ? new Date(parsed.data.previsaoConclusao) : null,
      observacoes: parsed.data.observacoes || null,
    },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: os.id, usuarioId, acao: "OS criada", detalhes: `Ordem de serviço ${numero} criada.` },
  });

  return NextResponse.json(os, { status: 201 });
}
