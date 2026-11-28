import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPortalSession } from "@/lib/auth-portal";
import { MSG_TROCA_PENDENTE_PORTAL } from "@/lib/portal/senha-provisoria";
import { respostaAnexo } from "@/lib/anexos-server";

/**
 * O arquivo que o próprio cliente enviou pelo portal (PDF ou foto do pedido de compra). Só da empresa E do cliente
 * da sessão, e só o que veio do portal: o id de outro cliente (ou um pedido lançado pelo escritório) dá 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await getPortalSession({ comTroca: true });
  if (!sessao?.user) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (sessao.user.trocarSenha) return NextResponse.json({ erro: MSG_TROCA_PENDENTE_PORTAL }, { status: 403 });
  const { id } = await params;
  const p = await prisma.pedidoCliente.findFirst({
    where: { id, empresaId: sessao.user.empresaId, clienteId: sessao.user.clienteId, origem: "PORTAL" },
    select: { anexo: true, anexoNome: true },
  });
  if (!p?.anexo) return NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 });
  return respostaAnexo({ nome: p.anexoNome ?? "pedido", conteudo: p.anexo }, req.nextUrl.searchParams.get("inline") === "1");
}
