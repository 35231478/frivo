import { rotasColecao } from "@/lib/cadastros/rotas";

/** Cadastros padronizados (lib/cadastros/registro.ts): listar (?ativo=sim|nao|todos&q=) e criar. */
const r = rotasColecao();
export const GET = r.GET;
export const POST = r.POST;
