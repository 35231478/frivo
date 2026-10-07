import { rotasItem } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: /api/cadastros/modelos-encargos/[id]. DELETE agora INATIVA (antes apagava e os
 * colaboradores voltavam ao padrão do regime sem aviso); o modelo padrão não pode ser inativado.
 */
const r = rotasItem("modelos-encargos");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
