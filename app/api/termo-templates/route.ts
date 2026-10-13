import { rotasColecao } from "@/lib/cadastros/rotas";

/** Compatibilidade: /api/cadastros/termos-referencia. Sem ?ativo devolve todos, como sempre. */
const r = rotasColecao("termos-referencia", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
