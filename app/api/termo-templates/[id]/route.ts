import { rotasItem } from "@/lib/cadastros/rotas";

/** Compatibilidade: /api/cadastros/termos-referencia/[id]. DELETE inativa; PATCH/PUT parciais. */
const r = rotasItem("termos-referencia");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
