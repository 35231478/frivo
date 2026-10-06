import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { equipeSchema } from "@/lib/validations";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { impactoEquipe, anotarInativacao, lerMotivo } from "@/lib/inativacao-server";
import { aplicarVeiculosEquipe, planejarVeiculosEquipe, validarPessoasEquipe } from "@/lib/equipe-veiculos";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const equipe = await prisma.equipe.findFirst({
    where: { id, empresaId },
    include: {
      membros: { select: { id: true, nome: true } },
      veiculos: { select: { id: true } },
    },
  });
  if (!equipe) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  return NextResponse.json(equipe);
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Editar equipe exige "Equipes / Colaboradores › gerenciar" (antes bastava estar logado)
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.equipe.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const body = await req.json();
  const parsed = equipeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { membroIds, veiculoId, veiculoIds, confirmarDesvinculo, liderId, ...rest } = parsed.data;
  // Inativar pelo formulário (status) segue a mesma regra do botão: exige "excluir"
  if (rest.status === "INATIVA" && existente.status !== "INATIVA" && !pode(session.user!.permissoes, "equipes", "excluir", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão para inativar equipes" }, { status: 403 });

  if (!(await validarPessoasEquipe(empresaId, membroIds, liderId)))
    return NextResponse.json({ erro: "Colaborador inválido." }, { status: 400 });

  // Veículos: nunca desvincula sem confirmação explícita
  let plano;
  try { plano = await planejarVeiculosEquipe(empresaId, id, { veiculoIds, veiculoId }); }
  catch { return NextResponse.json({ erro: "Veículo inválido." }, { status: 400 }); }
  if (plano.desvincular.length && !confirmarDesvinculo) {
    return NextResponse.json({
      erro: `Salvar vai desvincular ${plano.desvincular.length === 1 ? "o veículo" : "os veículos"} ${plano.desvincular.map((v) => v.placa).join(", ")} desta equipe. Confirme para continuar.`,
      requerConfirmacao: true, desvincular: plano.desvincular.map((v) => v.placa),
    }, { status: 409 });
  }

  const equipe = await prisma.equipe.update({
    where: { id },
    data: {
      ...rest,
      liderId: liderId || null,
      membros: { set: membroIds.map((mid) => ({ id: mid })) },
    },
  });

  await aplicarVeiculosEquipe(empresaId, id, plano);

  return NextResponse.json(equipe);
}

/**
 * Inativa a equipe — soft-delete (status INATIVA). Membros, líder e veículos ficam
 * vinculados; nada é apagado. Body opcional: { motivo } (vai para as observações).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.equipe.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  if (existente.status === "INATIVA") return NextResponse.json({ ok: true });

  const impacto = await impactoEquipe(id, empresaId);
  if (impacto?.bloqueio) return NextResponse.json({ erro: impacto.bloqueio }, { status: 409 });

  const motivo = lerMotivo(await req.json().catch(() => ({})));
  await prisma.equipe.update({
    where: { id },
    data: { status: "INATIVA", observacoes: anotarInativacao(existente.observacoes, session.user!.name ?? "usuário", motivo) },
  });
  return NextResponse.json({ ok: true });
}

/** Reativa a equipe (status ATIVA). Exige "gerenciar". Body: { ativo: true } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  if ((await req.json().catch(() => ({})))?.ativo !== true) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });

  const existente = await prisma.equipe.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existente) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  await prisma.equipe.update({ where: { id }, data: { status: "ATIVA" } });
  return NextResponse.json({ ok: true });
}
