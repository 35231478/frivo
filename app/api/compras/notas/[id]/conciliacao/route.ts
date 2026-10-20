import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode, type Permissoes } from "@/lib/permissoes";
import { ErroRefEmpresa } from "@/lib/ref-empresa";
import { conciliar, ErroNota } from "@/lib/compras/notas";
import { conciliacaoSchema, mensagemZod } from "@/lib/compras/validacao";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/compras/notas/:id/conciliacao — "Salvar rascunho" da central de lançamento:
 *   { itens: [{ itemId, produtoId | novo: { nome, unidade? }, fator?, preco? }], financeiro?: { categoriaId?, centroCustoId?, formaPagamento?, parcelas? } }
 * Estoque › gerenciar. Preço de venda na linha: + Configurações › gerenciar. Financeiro: + Financeiro › fluxo de caixa.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const { id } = await params;
  const parsed = conciliacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: mensagemZod(parsed.error) }, { status: 400 });
  const permissoes = user.permissoes as Permissoes;
  try {
    return NextResponse.json(await conciliar({
      empresaId: user.empresaId, notaId: id, escolhas: parsed.data.itens, financeiro: parsed.data.financeiro,
      podePrecificar: pode(permissoes, "configuracoes", "gerenciar", user.role),
      podeFinanceiro: pode(permissoes, "financeiro", "fluxoCaixa", user.role),
    }));
  } catch (e) {
    if (e instanceof ErroNota) return NextResponse.json({ erro: e.message, ...e.extra }, { status: e.status });
    if (e instanceof ErroRefEmpresa) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }
}
