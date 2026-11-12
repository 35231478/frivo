import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { formularioCriarSchema as formularioSchema } from "@/lib/formulario-schema";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";

export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const tipoOsId = searchParams.get("tipoOsId");

  const formularios = await prisma.formularioTemplate.findMany({
    where: { empresaId, ativo: true, ...(tipoOsId && { tipoOsId }) },
    include: {
      campos: { where: { ativo: true }, orderBy: { ordem: "asc" } }, // removidos na edição ficam só no histórico
      tipoOs: { select: { id: true, nome: true, cor: true } },
    },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(formularios);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = formularioSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const { campos, tipoOsId, ...resto } = parsed.data;
  try { await validarRefEmpresa("tipoOs", tipoOsId, empresaId, "Tipo de OS"); }
  catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  const formulario = await prisma.formularioTemplate.create({
    data: {
      ...resto,
      empresaId,
      tipoOsId: tipoOsId || null,
      campos: campos ? { create: campos.map(({ id: _id, ...c }) => c) } : undefined,
    },
    include: { campos: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(formulario, { status: 201 });
}
