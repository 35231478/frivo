import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { equipeSchema } from "@/lib/validations";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";

export async function GET(req: NextRequest) {
  // Equipes são lidas pela tela de equipes/veículos e pelo seletor de técnicos da OS
  const guard = await exigirAlgumaPermissao([["equipes", "visualizar"], ["veiculos", "visualizar"], ["ordens", "editar"], ["ordens", "criar"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  // ?resumo=1: só o necessário para o seletor da OS (sem avatares em base64)
  if (req.nextUrl.searchParams.get("resumo") === "1") {
    const equipes = await prisma.equipe.findMany({
      where: { empresaId, status: "ATIVA" },
      select: { id: true, nome: true, cor: true, liderId: true, membros: { where: { ativo: true }, select: { id: true } } },
      orderBy: { nome: "asc" },
    });
    return NextResponse.json(equipes.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor, liderId: e.liderId, membroIds: e.membros.map((m) => m.id) })));
  }

  const equipes = await prisma.equipe.findMany({
    where: { empresaId },
    include: {
      lider: { select: { id: true, nome: true, avatar: true } },
      membros: { select: { id: true, nome: true, avatar: true } },
      veiculos: { select: { id: true, placa: true, modelo: true } },
    },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(equipes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = equipeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { membroIds, veiculoId, liderId, ...rest } = parsed.data;

  const equipe = await prisma.equipe.create({
    data: {
      ...rest,
      empresaId,
      liderId: liderId || null,
      membros: { connect: membroIds.map((id) => ({ id })) },
    },
  });

  if (veiculoId) {
    await prisma.veiculo.updateMany({ where: { id: veiculoId, empresaId }, data: { equipeId: equipe.id } });
  }

  return NextResponse.json(equipe, { status: 201 });
}
