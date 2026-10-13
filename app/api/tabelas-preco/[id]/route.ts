import { rotasItem } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: /api/cadastros/tabelas-preco/[id]. Edição PARCIAL (sem `itens` no corpo os preços
 * não mudam); DELETE inativa; os itens novos precisam ser serviços/produtos ativos da empresa.
 */
const r = rotasItem("tabelas-preco");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
