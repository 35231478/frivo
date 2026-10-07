import { rotasItem } from "@/lib/cadastros/rotas";

/** Compatibilidade: mesma implementação de /api/cadastros/cargos/[id] (edição parcial; DELETE só inativa). */
const r = rotasItem("cargos");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
