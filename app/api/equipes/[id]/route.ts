import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { caixaNome } from "@/lib/texto/zod";
import { prisma } from "@/lib/prisma";
import { equipeSchema } from "@/lib/validations";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode } from "@/lib/permissoes";
import { impactoEquipe, lerMotivo } from "@/lib/inativacao-server";
import { inativarEquipe, reativarEquipe, statusHttp } from "@/lib/acoes-massa/regras";
import { aplicarVeiculosEquipe, planejarVeiculosEquipe, validarPessoasEquipe } from "@/lib/equipe-veiculos";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  // Exige ver equipes (não só estar logado); id de outra empresa = 404
  const guard = await exigirPermissao("equipes", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
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

  const { membroIds, veiculoId, veiculoIds, confirmarDesvinculo, liderId, status, ...rest } = parsed.data;
  // Status "Inativa" no formulário = inativar pela MESMA função do botão (impacto/bloqueio, motivo,
  // anotação; exige "excluir"); sair de "Inativa" = reativar pela mesma função. O status só muda por elas.
  const u = session.user!;
  const ctxStatus = { empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário", motivo: lerMotivo({ motivo: body?.motivoInativacao }) };
  const virandoInativa = status === "INATIVA" && existente.status !== "INATIVA";
  const saindoDeInativa = status !== undefined && status !== "INATIVA" && existente.status === "INATIVA";
  if (virandoInativa) {
    if (!pode(u.permissoes, "equipes", "excluir", u.role))
      return NextResponse.json({ erro: "Sem permissão para inativar equipes" }, { status: 403 });
    const impacto = await impactoEquipe(id, empresaId);
    if (impacto?.bloqueio) return NextResponse.json({ erro: impacto.bloqueio }, { status: 409 });
  }

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

  if (saindoDeInativa) {
    const r = await reativarEquipe(id, ctxStatus);
    if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: statusHttp(r) });
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

  if (virandoInativa) {
    const r = await inativarEquipe(id, ctxStatus);
    if (!r.ok) return NextResponse.json({ erro: r.motivo }, { status: statusHttp(r) });
    return NextResponse.json({ ...equipe, status: "INATIVA" });
  }
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

  const u = session.user!;
  const motivo = lerMotivo(await req.json().catch(() => ({})));
  // Mesma função do select de status do formulário (lib/acoes-massa/regras.ts)
  const r = await inativarEquipe(id, { empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário", motivo });
  if (!r.ok) return NextResponse.json({ erro: r.codigo === "nao_encontrado" ? "Não encontrada" : r.motivo }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true });
}

const edicaoRapidaSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório").transform(caixaNome).optional(),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida").optional(),
}).strict().refine((d) => Object.keys(d).length > 0, "Nada para alterar");

/** Exige "gerenciar". { ativo: true } reativa a equipe; { nome?, cor? } corrige esses campos. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const corpo = await req.json().catch(() => null);
  if (corpo?.ativo !== true) {
    // Edição parcial pelo "editar no contexto" de um seletor: só o nome e a cor (membros e veículos são da ficha)
    const parsed = edicaoRapidaSchema.safeParse(corpo);
    if (!parsed.success) {
      const campo = parsed.error.issues.find((i) => i.code !== "unrecognized_keys" && i.path.length > 0);
      return NextResponse.json({ erro: campo?.message ?? "Ação inválida" }, { status: 400 });
    }
    const atual = await prisma.equipe.findFirst({ where: { id, empresaId }, select: { id: true } });
    if (!atual) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
    const e = await prisma.equipe.update({ where: { id }, data: parsed.data, select: { id: true, nome: true, cor: true, status: true } });
    return NextResponse.json(e);
  }

  const u = guard.session.user!;
  const r = await reativarEquipe(id, { empresaId, usuarioId: u.id, usuarioNome: u.name ?? "usuário" });
  if (!r.ok) return NextResponse.json({ erro: r.codigo === "nao_encontrado" ? "Não encontrada" : r.motivo }, { status: statusHttp(r) });
  return NextResponse.json({ ok: true });
}
