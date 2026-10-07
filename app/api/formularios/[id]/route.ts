import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { Prisma } from "@prisma/client";
import { formularioEditarSchema } from "@/lib/formulario-schema";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { mesmoConteudo, planejarFilhos } from "@/lib/sincronizar-filhos";

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

  // Campos: atualiza os existentes, cria os novos e INATIVA os removidos (nunca apaga — as
  // respostas de atividades antigas apontam para eles e o histórico tem que continuar inteiro).
  // Campo JÁ respondido cuja pergunta/tipo/opções mudou ganha nova versão (o antigo fica inativo).
  const plano = campos
    ? planejarFilhos(
      await prisma.formularioCampo.findMany({
        where: { formularioId: id },
        select: { id: true, ativo: true, label: true, tipo: true, opcoes: true, _count: { select: { respostas: true, respostasEquipamento: true } } },
      }),
      campos,
      {
        versionar: (e, c) => e._count.respostas + e._count.respostasEquipamento > 0
          && (e.label !== c.label || e.tipo !== c.tipo || !mesmoConteudo(e.opcoes, c.opcoes)),
      },
    )
    : null;
  if (plano?.invalidos.length) return NextResponse.json({ erro: "Campo inválido (não pertence a este formulário)." }, { status: 400 });
  const dadosCampo = (c: NonNullable<typeof campos>[number]) => ({
    label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio ?? false, ordem: c.ordem ?? 0,
    opcoes: c.opcoes ?? Prisma.DbNull,
  });

  const atualizado = await prisma.$transaction(async (tx) => {
    if (plano) {
      if (plano.inativar.length) await tx.formularioCampo.updateMany({ where: { id: { in: plano.inativar }, formularioId: id }, data: { ativo: false } });
      for (const c of plano.atualizar) await tx.formularioCampo.update({ where: { id: c.id }, data: { ...dadosCampo(c), ativo: true } });
      for (const c of plano.criar) await tx.formularioCampo.create({ data: { ...dadosCampo(c), formularioId: id, ativo: true } });
    }
    return tx.formularioTemplate.update({
      where: { id },
      data: {
        ...Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined)),
        ...(tipoOsId !== undefined && { tipoOsId: tipoOsId || null }),
      },
      include: {
        campos: { where: { ativo: true }, orderBy: { ordem: "asc" } },
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
