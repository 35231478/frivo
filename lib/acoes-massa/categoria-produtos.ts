import { prisma } from "@/lib/prisma";
import { CADASTROS } from "@/lib/cadastros/registro";
import { editarCadastro } from "@/lib/cadastros/servidor";
import { falha, ok, type CodigoFalha, type ContextoItem, type ResultadoItem } from "@/lib/acoes-massa/regras";

const CODIGO: Record<number, CodigoFalha> = { 400: "invalido", 403: "sem_permissao", 404: "nao_encontrado", 409: "bloqueado" };

/**
 * "Definir categoria" (produtos, em massa — E3.3 bônus): o formulário manda { categoriaProdutoId } (vazio = tirar a
 * categoria). Validado UMA vez aqui; cada produto passa pela MESMA edição da rota individual
 * (/api/cadastros/produtos/[id]): categoria da empresa e ativa, permissão do cadastro, empresa da sessão.
 */
export function prepararDefinirCategoria(entrada: Record<string, unknown>): { ok: true; dados: Record<string, unknown> } | { ok: false; erro: string } {
  const estranhos = Object.keys(entrada).filter((k) => k !== "categoriaProdutoId");
  if (estranhos.length) return { ok: false, erro: `Campo não permitido: ${estranhos.join(", ")}.` };
  const v = entrada.categoriaProdutoId;
  if (v === undefined) return { ok: false, erro: "Escolha a categoria (ou “Sem categoria”)." };
  if (v !== null && (typeof v !== "string" || v.length > 40)) return { ok: false, erro: "Categoria de produto inválida." };
  return { ok: true, dados: { categoriaProdutoId: typeof v === "string" && v.trim() ? v.trim() : null } };
}

export async function definirCategoriaProduto(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const atual = await prisma.produto.findFirst({ where: { id, empresaId: ctx.empresaId }, select: { categoriaProdutoId: true } });
  if (!atual) return falha("nao_encontrado", "Não encontrado (ou de outra empresa)");
  const nova = (ctx.dados?.categoriaProdutoId as string | null | undefined) ?? null;
  if ((atual.categoriaProdutoId ?? null) === nova) return ok("Já estava assim");
  const r = await editarCadastro(CADASTROS.produtos, {
    id: ctx.usuarioId, nome: ctx.usuarioNome, empresaId: ctx.empresaId, role: ctx.role, permissoes: ctx.permissoes ?? {},
  }, id, { categoriaProdutoId: nova });
  if (!r.ok) return falha(CODIGO[r.status] ?? "erro", r.erro);
  const nome = (r.item as { categoriaProduto?: { nome?: string } | null }).categoriaProduto?.nome;
  return ok(nova ? `Categoria: ${nome ?? "definida"}` : "Sem categoria");
}
