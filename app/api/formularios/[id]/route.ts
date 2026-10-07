import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { TipoCampo } from "@prisma/client";
import { formularioEditarSchema } from "@/lib/formulario-schema";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.formularioTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Formulário não encontrado" }, { status: 404 });

  // Só os campos do formulário (empresaId e afins do corpo são descartados) e edição parcial
  const parsed = formularioEditarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const { campos, tipoOsId, ...resto } = parsed.data;
  try { await validarRefEmpresa("tipoOs", tipoOsId, empresaId, "Tipo de OS"); }
  catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const atualizado = await prisma.$transaction(async (tx) => {
    if (campos) {
      await tx.formularioCampo.deleteMany({ where: { formularioId: id } });
    }
    return tx.formularioTemplate.update({
      where: { id },
      data: {
        ...Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined)),
        ...(tipoOsId !== undefined && { tipoOsId: tipoOsId || null }),
        ...(campos && {
          campos: {
            create: campos.map((c) => ({
              label: c.label,
              tipo: c.tipo as TipoCampo,
              obrigatorio: c.obrigatorio ?? false,
              ordem: c.ordem ?? 0,
              opcoes: c.opcoes ?? null,
            })),
          },
        }),
      },
      include: {
        campos: { orderBy: { ordem: "asc" } },
        tipoOs: { select: { id: true, nome: true, cor: true } },
      },
    });
  });

  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const existente = await prisma.formularioTemplate.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Formulário não encontrado" }, { status: 404 });

  await prisma.formularioTemplate.update({ where: { id }, data: { ativo: false } });
  return NextResponse.json({ ok: true });
}
