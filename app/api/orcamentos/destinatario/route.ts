import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";

/**
 * Opções do "Para:" do orçamento: as unidades e os contatos ativos do cliente (empresa da sessão).
 * Protegida pela permissão de ORÇAMENTOS (quem monta orçamento escolhe o destinatário sem precisar
 * de acesso ao cadastro de clientes). Só o necessário para escolher — sem dados de acesso ao portal.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("orcamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const clienteId = req.nextUrl.searchParams.get("clienteId") ?? "";
  if (!clienteId) return NextResponse.json({ unidades: [], contatos: [] });

  const [unidades, contatos] = await Promise.all([
    prisma.unidade.findMany({
      where: { empresaId, clienteId, ativo: true },
      select: { id: true, nome: true, principal: true, cidade: true, estado: true },
      orderBy: [{ principal: "desc" }, { nome: "asc" }],
    }),
    prisma.contatoCliente.findMany({
      where: { empresaId, clienteId, ativo: true },
      select: { id: true, nome: true, cargo: true, principal: true, email: true },
      orderBy: [{ principal: "desc" }, { nome: "asc" }],
    }),
  ]);
  return NextResponse.json({ unidades, contatos }, { headers: { "Cache-Control": "private, no-store" } });
}
