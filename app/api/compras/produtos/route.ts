import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { ranquearSugestoes } from "@/lib/listagem";
import { ultimosCustos } from "@/lib/estoque/custo";

/**
 * GET /api/compras/produtos?q=gas (ou o código: ?q=15) — produtos ATIVOS da empresa da sessão para o de-para da nota
 * (id, nome, unidade, saldo, preço de venda, margem alvo e último custo de compra — para a tela
 * avisar se o custo mudou; os ~8 que mais combinam). Estoque › gerenciar.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ produtos: [] });
  const empresaId = guard.session.user!.empresaId;
  const achados = await prisma.produto.findMany({
    where: { empresaId, ativo: true, OR: [
      { nome: { contains: q, mode: "insensitive" } }, { descricao: { contains: q, mode: "insensitive" } },
      ...(/^\d{1,9}$/.test(q) ? [{ codigo: Number(q) }] : []),
    ] },
    select: { id: true, codigo: true, nome: true, unidade: true, saldo: true, valorPadrao: true, margemVenda: true, ncm: true, cest: true, gtin: true, origemMercadoria: true, unidadeTributavel: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 50,
  });
  const ranqueados = ranquearSugestoes(achados.map((p) => ({ ...p, rotulo: p.nome, detalhe: p.codigo == null ? null : String(p.codigo) })), q, 8);
  const custos = await ultimosCustos(empresaId, ranqueados.map((p) => p.id));
  return NextResponse.json({
    produtos: ranqueados.map((p) => ({
      id: p.id, codigo: p.codigo, nome: p.nome, unidade: p.unidade, saldo: Number(p.saldo),
      preco: p.valorPadrao == null ? null : Number(p.valorPadrao), margemVenda: p.margemVenda == null ? null : Number(p.margemVenda),
      custo: custos.get(p.id) ?? null,
      fiscal: { ncm: p.ncm, cest: p.cest, gtin: p.gtin, origemMercadoria: p.origemMercadoria, unidadeTributavel: p.unidadeTributavel },
    })),
  });
}
