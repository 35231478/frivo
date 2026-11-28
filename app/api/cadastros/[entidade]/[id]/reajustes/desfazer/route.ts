import { NextRequest, NextResponse } from "next/server";
import { CADASTROS } from "@/lib/cadastros/registro";
import { exigirCadastro } from "@/lib/cadastros/rotas";
import { desfazerReajuste } from "@/lib/precos/reajuste-tabela-server";

/**
 * Desfazer o último reajuste ainda não desfeito da tabela de preço (lib/precos/reajuste-tabela):
 *   POST { previa?: boolean } — previa: true devolve o plano (os itens que voltam e os que ficam); sem ela, desfaz.
 * Quem edita a tabela.
 */
type Ctx = { params: Promise<{ entidade: string; id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { entidade, id } = await ctx.params;
  if (entidade !== "tabelas-preco") return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  const g = await exigirCadastro(CADASTROS["tabelas-preco"], "editar");
  if ("resposta" in g) return g.resposta;
  const corpo = await req.json().catch(() => ({}));
  const r = await desfazerReajuste({ empresaId: g.sessao.user.empresaId, usuarioId: g.sessao.user.id, tabelaId: id, previa: corpo?.previa === true });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}
