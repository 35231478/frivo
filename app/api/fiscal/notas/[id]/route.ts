import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { detalheNota } from "@/lib/nfse/central-server";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/fiscal/notas/{id} — o detalhe da nota para a gaveta da tela "Notas fiscais"
 * (dados fiscais, itens, discriminação e histórico). Financeiro › Fiscal; empresa da sessão
 * (id de outra empresa = 404). Abrir tira o resultado da nota do sino.
 */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const nota = await detalheNota(guard.session.user!.empresaId, id);
  if (!nota) return NextResponse.json({ erro: "Nota não encontrada." }, { status: 404 });
  return NextResponse.json(nota);
}
