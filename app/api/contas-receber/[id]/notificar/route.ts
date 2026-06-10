import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

/** Registra a data/hora da notificação de cobrança (WhatsApp/E-mail). */
export async function POST(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const conta = await prisma.contaReceber.findFirst({ where: { id, empresaId } });
  if (!conta) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const atualizada = await prisma.contaReceber.update({
    where: { id },
    data: { notificacaoEnviadaEm: new Date() },
    select: { id: true, notificacaoEnviadaEm: true },
  });
  return NextResponse.json(atualizada);
}
