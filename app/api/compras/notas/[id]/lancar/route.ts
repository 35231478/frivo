import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode, type Permissoes } from "@/lib/permissoes";
import { ErroRefEmpresa } from "@/lib/ref-empresa";
import { ErroEstoque } from "@/lib/estoque/servidor";
import { ErroNota, lancarNota } from "@/lib/compras/notas";
import { lancarSchema, mensagemZod } from "@/lib/compras/validacao";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/compras/notas/:id/lancar { itens?, pedidoCompraId?, financeiro? } — entrada no estoque + contas a pagar,
 * numa transação só. Precisa de Estoque › gerenciar (entrada) E Financeiro › fluxo de caixa (gera conta a pagar).
 * Preço de venda definido na linha: só é aplicado por quem tem Configurações › gerenciar.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  if (!pode(user.permissoes as Permissoes, "financeiro", "fluxoCaixa", user.role))
    return NextResponse.json({ erro: "Lançar a nota gera conta a pagar: precisa também de Financeiro › fluxo de caixa." }, { status: 403 });
  const { id } = await params;
  const parsed = lancarSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: mensagemZod(parsed.error) }, { status: 400 });
  try {
    const r = await lancarNota({
      empresaId: user.empresaId, usuarioId: user.id, notaId: id, escolhas: parsed.data.itens ?? [], pedidoCompraId: parsed.data.pedidoCompraId ?? null,
      financeiro: parsed.data.financeiro, podePrecificar: pode(user.permissoes as Permissoes, "configuracoes", "gerenciar", user.role),
    });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof ErroNota) return NextResponse.json({ erro: e.message, ...e.extra }, { status: e.status });
    if (e instanceof ErroEstoque || e instanceof ErroRefEmpresa) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }
}
