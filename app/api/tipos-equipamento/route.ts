import { rotasColecao } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: mesma implementação de /api/cadastros/tipos-equipamento (lib/cadastros). Sem
 * ?ativo devolve todos (ativos e inativos), como sempre devolveu; quem escolhe usa a regra do
 * SeletorCadastro (só ativos para nova escolha, o atual continua visível mesmo inativo).
 */
const r = rotasColecao("tipos-equipamento", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
