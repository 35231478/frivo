import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { ranquearSugestoes } from "@/lib/listagem";

/**
 * GET /api/compras/produtos?q=gas — produtos ATIVOS da empresa da sessão para o de-para da nota
 * (id, nome, unidade, saldo; os ~8 que mais combinam). Estoque › gerenciar.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ produtos: [] });
  const achados = await prisma.produto.findMany({
    where: { empresaId: guard.session.user!.empresaId, ativo: true, OR: [{ nome: { contains: q, mode: "insensitive" } }, { descricao: { contains: q, mode: "insensitive" } }] },
    select: { id: true, nome: true, unidade: true, saldo: true }, orderBy: [{ nome: "asc" }, { id: "asc" }], take: 50,
  });
  const ranqueados = ranquearSugestoes(achados.map((p) => ({ ...p, rotulo: p.nome })), q, 8);
  return NextResponse.json({ produtos: ranqueados.map((p) => ({ id: p.id, nome: p.nome, unidade: p.unidade, saldo: Number(p.saldo) })) });
}
