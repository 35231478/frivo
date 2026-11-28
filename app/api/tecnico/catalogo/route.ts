import { NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { temModulo } from "@/lib/modulos/servidor";
import type { ProdutoCatalogo } from "@/lib/tecnico/materiais";

/** Quantos produtos vão para o aparelho (o catálogo de uma empresa de climatização cabe folgado) */
const LIMITE_CATALOGO = 5000;

/**
 * O CATÁLOGO de produtos para o app do técnico registrar o material usado — fica guardado no aparelho, para a
 * busca funcionar sem sinal. Código, nome, unidade e (D5) o SALDO do estoque — para o técnico ver, ao escolher, se
 * vai ficar negativo. NUNCA preço, custo ou margem (o select abaixo é a garantia). Produto que não controla estoque,
 * ou empresa com o Estoque desligado: saldo null (não há o que avisar). Quem grava a execução (OS › Editar ou Concluir).
 */
export async function GET() {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;
  const [linhas, comEstoque] = await Promise.all([
    prisma.produto.findMany({
      where: { empresaId, ativo: true },
      orderBy: { nome: "asc" },
      take: LIMITE_CATALOGO,
      select: { id: true, codigo: true, nome: true, unidade: true, saldo: true, controlaEstoque: true },
    }),
    temModulo(empresaId, "estoque"),
  ]);
  const produtos: ProdutoCatalogo[] = linhas.map(({ saldo, controlaEstoque, ...p }) => ({ ...p, saldo: comEstoque && controlaEstoque ? Number(saldo) : null }));
  return NextResponse.json({ produtos }, { headers: { "Cache-Control": "private, no-store" } });
}
