import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { equipeSchema } from "@/lib/validations";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { aplicarVeiculosEquipe, planejarVeiculosEquipe, validarPessoasEquipe } from "@/lib/equipe-veiculos";

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
  // Criar equipe exige "Equipes / Colaboradores › gerenciar" (antes bastava estar logado)
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const body = await req.json();
  const parsed = equipeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { membroIds, veiculoId, veiculoIds, confirmarDesvinculo: _c, liderId, ...rest } = parsed.data;
  if (!(await validarPessoasEquipe(empresaId, membroIds, liderId)))
    return NextResponse.json({ erro: "Colaborador inválido." }, { status: 400 });
  let plano;
  try { plano = await planejarVeiculosEquipe(empresaId, null, { veiculoIds, veiculoId }); }
  catch { return NextResponse.json({ erro: "Veículo inválido." }, { status: 400 }); }

  const equipe = await prisma.equipe.create({
    data: {
      ...rest,
      empresaId,
      liderId: liderId || null,
      membros: { connect: membroIds.map((id) => ({ id })) },
    },
  });

  await aplicarVeiculosEquipe(empresaId, equipe.id, plano);

  return NextResponse.json(equipe, { status: 201 });
}
