import { rotasColecao } from "@/lib/cadastros/rotas";

/** Compatibilidade: /api/cadastros/modelos-encargos (Financeiro › Custo de pessoal). Sem ?ativo devolve todos. */
const r = rotasColecao("modelos-encargos", { ativoPadrao: "todos" });
export const GET = r.GET;
export const POST = r.POST;
