import { rotasColecao } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: mesma implementação de /api/cadastros/servicos (lib/cadastros). Sem ?ativo devolve
 * todos (ativos e inativos), como sempre devolveu; quem escolhe deve usar o SeletorCadastro.
 */
const r = rotasColecao("servicos", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
