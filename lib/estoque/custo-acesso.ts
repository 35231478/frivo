/**
 * Quem pode ver o CUSTO DE COMPRA dos produtos (último custo de compra) — uma regra só, para o servidor e a tela.
 *
 * O custo de compra já aparece hoje em dois lugares, cada um com a sua permissão:
 *  - Estoque › visualizar: a ficha do produto no Estoque mostra o último custo e o custo de cada entrada;
 *  - Orçamentos › Ver custo e margem: custo, lucro e margem no Editar orçamento (leva B).
 * Quem tem uma delas já vê o dado; quem não tem nenhuma não pode recebê-lo por outra porta
 * (ex.: GET /api/estoque/custos, usado no editor de kit e nos materiais padrão do serviço).
 * Administrador (role ADMIN/SUPER_ADMIN) sempre pode — `pode` já cuida disso.
 */
import { pode, type Acao, type Permissoes } from "@/lib/permissoes";

export type FuncaoPode = (modulo: string, acao: Acao) => boolean;

export function podeVerCustoDeCompra(pode: FuncaoPode): boolean {
  return pode("estoque", "visualizar") || pode("orcamentos", "verCusto");
}

/**
 * A mesma regra para a SESSÃO (servidor): papel TECNICO nunca vê custo (o app do técnico não mostra custo, nem
 * que o perfil tenha alguma permissão de estoque); os demais seguem `podeVerCustoDeCompra`. ADMIN/SUPER_ADMIN: sempre.
 */
export function usuarioVeCustoDeCompra(user: { permissoes?: unknown; role?: string | null } | null | undefined): boolean {
  if (!user || user.role === "TECNICO") return false;
  return podeVerCustoDeCompra((m, a) => pode(user.permissoes as Permissoes, m, a, user.role ?? undefined));
}
