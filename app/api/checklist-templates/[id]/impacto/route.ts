import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { avisosInativarModeloChecklist, motivoNaoInativarModeloChecklist } from "@/lib/cadastros/regras-arquivar";

/**
 * Pré-checagem do modal de inativar modelo de checklist (o botão padrão dos cadastros): o modelo do
 * checklist diário obrigatório bloqueia (a mesma regra do DELETE); os preenchimentos só avisam.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirAlgumaPermissao([["configuracoes", "gerenciar"], ["veiculos", "gerenciar"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const modelo = await prisma.checklistTemplate.findFirst({ where: { id, empresaId }, select: { _count: { select: { preenchidos: true } } } });
  if (!modelo) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { checklistDiarioAtivo: true, checklistDiarioTemplateId: true } });
  return NextResponse.json({ bloqueio: motivoNaoInativarModeloChecklist(id, cfg), avisos: avisosInativarModeloChecklist(modelo._count.preenchidos) });
}
