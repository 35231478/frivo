import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { modeloEncargosSchema } from "@/lib/folha/validacao";
import { garantirModelosPadrao, listarModelos } from "@/lib/folha/server";

/** Modelos de encargos da empresa. Só "Financeiro › Custo de pessoal". */

export async function GET() {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  await garantirModelosPadrao(empresaId);
  return NextResponse.json(await listarModelos(empresaId));
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const parsed = modeloEncargosSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const d = parsed.data;
  if (await prisma.modeloEncargos.findFirst({ where: { empresaId, nome: d.nome }, select: { id: true } }))
    return NextResponse.json({ erro: "Já existe um modelo com esse nome" }, { status: 409 });

  const criado = await prisma.$transaction(async (tx) => {
    // Um padrão por regime
    if (d.padrao) await tx.modeloEncargos.updateMany({ where: { empresaId, regime: d.regime }, data: { padrao: false } });
    return tx.modeloEncargos.create({ data: { empresaId, nome: d.nome, regime: d.regime, padrao: d.padrao, itens: d.itens } });
  });
  return NextResponse.json(criado, { status: 201 });
}
