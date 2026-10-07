import { rotasColecao } from "@/lib/cadastros/rotas";

/** Compatibilidade: /api/cadastros/modelos-prazo (traz as etapas). Sem ?ativo devolve todos, como sempre. */
const r = rotasColecao("modelos-prazo", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
