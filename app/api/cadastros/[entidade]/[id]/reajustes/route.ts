import { NextRequest, NextResponse } from "next/server";
import { CADASTROS } from "@/lib/cadastros/registro";
import { exigirCadastro } from "@/lib/cadastros/rotas";
import { reajustarTabela, ultimoReajuste } from "@/lib/precos/reajuste-tabela-server";

/**
 * Reajuste em massa da tabela de preço (só /api/cadastros/tabelas-preco/[id]/reajustes; lib/precos/reajuste-tabela):
 *   GET   o último reajuste ainda não desfeito (para o "Desfazer reajuste")      — quem vê a tabela
 *   POST  { tipo: "PERCENTUAL"|"VALOR", valor, itemIds?, motivo, previa }        — quem edita a tabela
 *         previa ≠ false: só a prévia (item, preço atual → novo); previa: false grava os preços e o lote.
 */
type Ctx = { params: Promise<{ entidade: string; id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { entidade, id } = await ctx.params;
  if (entidade !== "tabelas-preco") return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  const g = await exigirCadastro(CADASTROS["tabelas-preco"], "listar");
  if ("resposta" in g) return g.resposta;
  return NextResponse.json({ ultimo: await ultimoReajuste(g.sessao.user.empresaId, id) });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { entidade, id } = await ctx.params;
  if (entidade !== "tabelas-preco") return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  // A mesma permissão de editar a tabela na tela
  const g = await exigirCadastro(CADASTROS["tabelas-preco"], "editar");
  if ("resposta" in g) return g.resposta;
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return NextResponse.json({ erro: "Dados inválidos." }, { status: 400 });
  const r = await reajustarTabela({ empresaId: g.sessao.user.empresaId, usuarioId: g.sessao.user.id, tabelaId: id, corpo });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r, { status: r.previa ? 200 : 201 });
}
