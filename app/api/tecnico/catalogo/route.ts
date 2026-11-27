import { NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import type { ProdutoCatalogo } from "@/lib/tecnico/materiais";

/** Quantos produtos vão para o aparelho (o catálogo de uma empresa de climatização cabe folgado) */
const LIMITE_CATALOGO = 5000;

/**
 * O CATÁLOGO de produtos para o app do técnico registrar o material usado — fica guardado no aparelho, para a
 * busca funcionar sem sinal. Só identificação: código, nome e unidade. NUNCA preço, custo, margem ou saldo
 * (o técnico não vê custo; o select abaixo é a garantia). Quem grava a execução (OS › Editar ou Concluir).
 */
export async function GET() {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const produtos: ProdutoCatalogo[] = await prisma.produto.findMany({
    where: { empresaId: guard.session.user.empresaId, ativo: true },
    orderBy: { nome: "asc" },
    take: LIMITE_CATALOGO,
    select: { id: true, codigo: true, nome: true, unidade: true },
  });
  return NextResponse.json({ produtos }, { headers: { "Cache-Control": "private, no-store" } });
}
