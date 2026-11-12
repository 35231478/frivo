import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { ultimosCustos } from "@/lib/estoque/custo";
import { arred2, margemSobreVenda, markupSobreCusto, precoPorMargem, precoVendaSchema } from "@/lib/estoque/preco";

type Params = { params: Promise<{ produtoId: string }> };

/**
 * PUT /api/estoque/:produtoId/preco — define o preço de venda do produto:
 *   { modo: "margem", margem, custoBase } → preço = custoBase ÷ (1 − margem%), guarda a margem alvo;
 *   { modo: "preco", preco }              → preço fixo (a margem alvo fica vazia).
 * `custoBase` é o custo que a pessoa está vendo (o último, ou o da nota que está conciliando).
 * Mesma permissão do cadastro de produtos (onde o preço já era editado): Configurações › gerenciar.
 * Produto de outra empresa = 404. Só muda quando alguém pede: nada aqui roda sozinho.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { produtoId } = await params;
  const parsed = precoVendaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });

  const produto = await prisma.produto.findFirst({ where: { id: produtoId, empresaId }, select: { id: true } });
  if (!produto) return NextResponse.json({ erro: "Produto não encontrado" }, { status: 404 });

  const d = parsed.data;
  const preco = d.modo === "margem" ? precoPorMargem(d.custoBase, d.margem) : arred2(d.preco);
  if (preco == null || !(preco > 0)) return NextResponse.json({ erro: "Não deu para calcular o preço por essa margem." }, { status: 400 });
  const margemVenda = d.modo === "margem" ? arred2(d.margem) : null;
  await prisma.produto.update({ where: { id: produtoId, empresaId }, data: { valorPadrao: preco, margemVenda } });

  const custo = d.modo === "margem" ? d.custoBase : (await ultimosCustos(empresaId, [produtoId])).get(produtoId) ?? null;
  return NextResponse.json({ preco, margemVenda, custo, margem: margemSobreVenda(preco, custo), markup: markupSobreCusto(preco, custo) });
}
