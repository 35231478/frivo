import { rotasColecao } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: mesma implementação de /api/cadastros/tipos-problema (lib/cadastros) — uma regra só.
 * Ler: qualquer usuário logado; gravar exige Configurações › gerenciar. Sem ?ativo devolve todos.
 */
const r = rotasColecao("tipos-problema", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
