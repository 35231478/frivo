import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { registrarEventoCR } from "@/lib/financeiro/conta-receber-server";

type Params = { params: Promise<{ id: string }> };

/** Registra a data/hora da notificação de cobrança (WhatsApp/E-mail). */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const conta = await prisma.contaReceber.findFirst({ where: { id, empresaId, excluidaEm: null } });
  if (!conta) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const atualizada = await prisma.contaReceber.update({
    where: { id },
    data: { notificacaoEnviadaEm: new Date() },
    select: { id: true, notificacaoEnviadaEm: true },
  });
  const canal = (await req.json().catch(() => ({})))?.canal;
  await registrarEventoCR({
    empresaId, contaReceberId: id, tipo: "COBRANCA_ENVIADA", usuarioId: guard.session.user.id,
    detalhe: canal === "whatsapp" ? "WhatsApp" : canal === "email" ? "E-mail" : null,
  });
  return NextResponse.json(atualizada);
}
