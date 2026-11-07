import { prisma } from "@/lib/prisma";
import { ErroRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { erroDasLinhas, erroDosItensDoKit, qtd } from "@/lib/estoque/composicao";
import { ultimosCustos } from "@/lib/estoque/custo";

/**
 * Estoque E3.2 — lado do servidor dos kits e da composição do serviço. A conferência pura (produto OU kit,
 * quantidade > 0, sem repetir, override só em produto solto) é a mesma da tela (lib/estoque/composicao);
 * aqui entra o que precisa do banco: os vínculos são da EMPRESA e, quando novos, ativos.
 */

export async function kitMaterialComNome(empresaId: string, nome: string, exceto?: string) {
  return prisma.kitMaterial.findFirst({
    where: { empresaId, nome: { equals: nome.trim(), mode: "insensitive" }, ...(exceto && { id: { not: exceto } }) },
    select: { nome: true, ativo: true },
  });
}

/** Itens do kit prontos para gravar: produtos da empresa (novo precisa estar ativo; o que o kit já tinha fica). */
export async function montarItensKit(itens: { produtoId: string; quantidade: unknown }[], empresaId: string, jaTinha: { produtoId?: unknown }[] = []) {
  const erro = erroDosItensDoKit(itens);
  if (erro) throw new ErroRefEmpresa(erro);
  await validarRefsEmpresa("produto", itens.map((i) => i.produtoId), empresaId, "Produto", { novoAtivo: true, manter: jaTinha.map((i) => i.produtoId as string) });
  return itens.map((i, ordem) => ({ produtoId: i.produtoId, quantidade: qtd(i.quantidade), ordem }));
}

/**
 * Linhas da composição do serviço prontas para gravar: produto solto OU kit, ambos da empresa (novo precisa estar
 * ativo; o que a composição já tinha fica, mesmo inativo). O comportamento efetivo NÃO é gravado: vem da
 * categoria do produto na hora de usar (kit "vivo"); só o override pontual fica na linha.
 */
export async function montarMateriaisServico(
  linhas: { produtoId?: string | null; kitId?: string | null; quantidade: unknown; comportamento?: unknown }[], empresaId: string,
  jaTinha: { produtoId?: unknown; kitId?: unknown }[] = [],
) {
  const erro = erroDasLinhas(linhas);
  if (erro) throw new ErroRefEmpresa(erro);
  await Promise.all([
    validarRefsEmpresa("produto", linhas.map((l) => l.produtoId), empresaId, "Produto", { novoAtivo: true, manter: jaTinha.map((l) => l.produtoId as string) }),
    validarRefsEmpresa("kitMaterial", linhas.map((l) => l.kitId), empresaId, "Kit de material", { novoAtivo: true, manter: jaTinha.map((l) => l.kitId as string) }),
  ]);
  return linhas.map((l, ordem) => ({
    produtoId: l.produtoId || null,
    kitId: l.kitId || null,
    quantidade: qtd(l.quantidade),
    comportamento: l.produtoId && (l.comportamento === "VENDA_A_PARTE" || l.comportamento === "INCLUSO_NO_SERVICO") ? l.comportamento : null,
    ordem,
  }));
}

/** Último custo de compra dos produtos pedidos (só os da empresa), como objeto { produtoId: custo } para a tela. */
export async function custosParaTela(empresaId: string, produtoIds: string[]) {
  const ids = [...new Set(produtoIds.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, 500);
  if (!ids.length) return {};
  const daEmpresa = await prisma.produto.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true } });
  const custos = await ultimosCustos(empresaId, daEmpresa.map((p) => p.id));
  return Object.fromEntries(custos);
}
