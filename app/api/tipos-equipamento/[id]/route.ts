import { rotasItem } from "@/lib/cadastros/rotas";

/** Compatibilidade: /api/cadastros/tipos-equipamento/[id]. DELETE inativa (nunca apaga); PATCH/PUT parciais. */
const r = rotasItem("tipos-equipamento");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
