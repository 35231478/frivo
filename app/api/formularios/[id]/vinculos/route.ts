import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

// Lista onde este formulário está vinculado (tipo de equipamento + tipo de OS + flags).
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const form = await prisma.formularioTemplate.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!form) return NextResponse.json({ erro: "Formulário não encontrado" }, { status: 404 });

  const vinculos = await prisma.formTypeMapping.findMany({
    where: { empresaId, formularioTemplateId: id },
    include: {
      tipoEquipamento: { select: { id: true, nome: true } },
      tipoOs: { select: { id: true, nome: true, cor: true } },
    },
    orderBy: [{ tipoEquipamento: { nome: "asc" } }, { tipoOs: { nome: "asc" } }],
  });

  return NextResponse.json(
    vinculos.map((v) => ({
      id: v.id,
      tipoEquipamento: v.tipoEquipamento,
      tipoOs: v.tipoOs,
      obrigatorioConcluir: v.obrigatorioConcluir,
      obrigatorioImpedimento: v.obrigatorioImpedimento,
    })),
  );
}
