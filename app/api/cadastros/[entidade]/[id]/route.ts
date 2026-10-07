import { rotasItem } from "@/lib/cadastros/rotas";

/** Cadastros padronizados: obter, editar parcial / inativar / reativar (PATCH), inativar (DELETE). */
const r = rotasItem();
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
