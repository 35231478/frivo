import { rotasColecao } from "@/lib/cadastros/rotas";

/** Compatibilidade: /api/cadastros/tabelas-preco. Sem ?ativo devolve todas (ativas e inativas), como sempre. */
const r = rotasColecao("tabelas-preco", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
