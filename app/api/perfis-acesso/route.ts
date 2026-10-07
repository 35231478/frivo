import { rotasColecao } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: mesma implementação de /api/cadastros/perfis-acesso (lib/cadastros + travas em
 * lib/cadastros/especificos.ts). Sem ?ativo devolve todos (ativos e inativos), como antes.
 */
const r = rotasColecao("perfis-acesso", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
