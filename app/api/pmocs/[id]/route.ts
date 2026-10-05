import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { pmocSchema, pendenciasPublicacao } from "@/lib/pmoc";
import { ErroPmoc, SELECT_PMOC, dadosArt, paraData, validarVinculos } from "@/lib/pmoc-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const pmoc = await prisma.pmoc.findFirst({ where: { id, empresaId: guard.session.user!.empresaId }, select: SELECT_PMOC });
  if (!pmoc) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json(pmoc);
}

/** Atualiza a identificação. Publicar exige RT (nome + CREA), nº da ART e ≥1 equipamento. */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.pmoc.findFirst({ where: { id, empresaId }, select: { id: true, ativo: true, clienteId: true, _count: { select: { equipamentos: true } } } });
  if (!existente) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  if (!existente.ativo) return NextResponse.json({ erro: "PMOC inativo: reative antes de editar." }, { status: 409 });

  const parsed = pmocSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const d = parsed.data;
  if (d.clienteId !== existente.clienteId && existente._count.equipamentos > 0)
    return NextResponse.json({ erro: "Para trocar o cliente, remova antes os equipamentos do PMOC (eles pertencem ao cliente atual)." }, { status: 409 });
  if (d.status === "PUBLICADO") {
    const faltam = pendenciasPublicacao(d, existente._count.equipamentos);
    if (faltam.length) return NextResponse.json({ erro: `Para publicar, falta: ${faltam.join(", ")}.` }, { status: 422 });
  }
  try {
    await validarVinculos(empresaId, d);
    await prisma.pmoc.update({
      where: { id },
      data: {
        nome: d.nome, descricao: d.descricao || null, clienteId: d.clienteId, unidadeId: d.unidadeId, status: d.status,
        dataInicio: paraData(d.dataInicio), dataExpiracao: paraData(d.dataExpiracao),
        responsavelTecnicoId: d.responsavelTecnicoId, rtNome: d.rtNome, rtCrea: d.rtCrea, artNumero: d.artNumero,
        ...dadosArt(d),
      },
    });
    return NextResponse.json(await prisma.pmoc.findFirst({ where: { id }, select: SELECT_PMOC }));
  } catch (e) {
    if (e instanceof ErroPmoc) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}

/** Inativa (soft-delete): o PMOC sai da lista padrão; nada é apagado. */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "excluir");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const r = await prisma.pmoc.updateMany({ where: { id, empresaId: guard.session.user!.empresaId }, data: { ativo: false } });
  if (!r.count) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Reativa. Body: { ativo: true }. Exige "editar". */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  if ((await req.json().catch(() => ({})))?.ativo !== true) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });
  const r = await prisma.pmoc.updateMany({ where: { id, empresaId: guard.session.user!.empresaId }, data: { ativo: true } });
  if (!r.count) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
