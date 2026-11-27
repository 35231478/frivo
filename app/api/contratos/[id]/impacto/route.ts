import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { contratoGeraFinanceiro, impactoSaidaDoContrato } from "@/lib/financeiro-server";
import { avisosSaidaContrato } from "@/lib/cadastros/regras-arquivar";

/**
 * GET /api/contratos/[id]/impacto?status=CANCELADO — o que a troca de status faria AGORA, para o modal
 * mostrar antes de confirmar. Só a saída de Ativo mexe em algo (OS agendadas e intocadas e previsões
 * em aberto são canceladas); voltar a Ativo não tem aviso. Nunca bloqueia. Contratos › Editar.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("contratos", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const contrato = await prisma.contrato.findFirst({ where: { id, empresaId: guard.session.user!.empresaId }, select: { id: true } });
  if (!contrato) return NextResponse.json({ erro: "Contrato não encontrado" }, { status: 404 });
  const novo = req.nextUrl.searchParams.get("status") ?? "";
  if (contratoGeraFinanceiro(novo)) return NextResponse.json({ bloqueio: null, avisos: [] });
  return NextResponse.json({ bloqueio: null, avisos: avisosSaidaContrato(await impactoSaidaDoContrato(id)) });
}
