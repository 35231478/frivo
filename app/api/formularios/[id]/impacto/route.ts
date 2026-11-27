import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { avisosInativarFormulario } from "@/lib/cadastros/regras-arquivar";

/** Pré-checagem do modal de inativar formulário: em quantas combinações ele é usado (só avisa). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const form = await prisma.formularioTemplate.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!form) return NextResponse.json({ erro: "Formulário não encontrado" }, { status: 404 });
  const vinculos = await prisma.formTypeMapping.count({ where: { empresaId, formularioTemplateId: id } });
  return NextResponse.json({ bloqueio: null, avisos: avisosInativarFormulario(vinculos) });
}
