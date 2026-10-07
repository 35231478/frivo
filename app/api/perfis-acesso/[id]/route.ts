import { rotasItem } from "@/lib/cadastros/rotas";

/** Compatibilidade: /api/cadastros/perfis-acesso/[id]. DELETE agora INATIVA (com as travas), nunca apaga. */
const r = rotasItem("perfis-acesso");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
