import { rotasItem } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: /api/cadastros/modelos-prazo/[id]. Edição PARCIAL (sem `etapas` as etapas não
 * mudam); DELETE inativa. Prazos já abertos nas OS têm cópia das etapas e não mudam.
 */
const r = rotasItem("modelos-prazo");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
