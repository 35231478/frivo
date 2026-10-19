import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { lancamentoManualSchema, mensagemLancamento, valorDoLancamento } from "@/lib/estoque/regras";
import { ErroEstoque, movimentar } from "@/lib/estoque/servidor";

type Params = { params: Promise<{ produtoId: string }> };

/**
 * POST /api/estoque/:produtoId/movimentacoes — lançamento manual:
 *   { operacao: "ENTRADA", quantidade, custoUnitario?, observacao? }
 *   { operacao: "AJUSTE", novoSaldo, observacao }        (motivo obrigatório)
 *   { operacao: "INVENTARIO", contagem, observacao? }
 * Grava o lançamento e o saldo juntos. Saldo negativo não bloqueia: volta em `aviso`.
 * Empresa e usuário vêm da sessão (o corpo não aceita outros campos).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { produtoId } = await params;
  const user = guard.session.user!;

  const parsed = lancamentoManualSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: mensagemLancamento(parsed.error) }, { status: 400 });
  const l = parsed.data;

  try {
    const r = await movimentar({
      empresaId: user.empresaId, produtoId, usuarioId: user.id,
      operacao: l.operacao, valor: valorDoLancamento(l),
      custoUnitario: l.operacao === "ENTRADA" ? l.custoUnitario ?? null : null,
      observacao: l.observacao ?? null,
    });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    const ref = respostaRefEmpresa(e);
    if (ref) return NextResponse.json({ erro: "Produto não encontrado" }, { status: 404 });
    if (e instanceof ErroEstoque) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }
}
