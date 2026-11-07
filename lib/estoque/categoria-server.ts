import { prisma } from "@/lib/prisma";
import { CATEGORIAS_PADRAO } from "@/lib/estoque/categoria";

/**
 * Seed idempotente das categorias de produto do Zé, POR EMPRESA: roda antes de listar o cadastro
 * (e antes do seletor do produto carregar). Empresa que já tem alguma categoria (mesmo inativa ou
 * renomeada) não ganha nada — assim rodar 2× não duplica e a decisão do usuário é respeitada.
 * O SQL da leva faz o mesmo para as empresas que já existem no banco.
 */
export async function garantirCategoriasProdutoPadrao(empresaId: string) {
  const existe = await prisma.categoriaProduto.count({ where: { empresaId } });
  if (existe > 0) return 0;
  const r = await prisma.categoriaProduto.createMany({
    data: CATEGORIAS_PADRAO.map((c) => ({ empresaId, nome: c.nome, comportamento: c.comportamento, ativo: true })),
    skipDuplicates: true,
  });
  return r.count;
}

export async function categoriaProdutoComNome(empresaId: string, nome: string, exceto?: string) {
  return prisma.categoriaProduto.findFirst({
    where: { empresaId, nome: { equals: nome.trim(), mode: "insensitive" }, ...(exceto && { id: { not: exceto } }) },
    select: { nome: true, ativo: true },
  });
}
