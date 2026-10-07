import { rotasItem } from "@/lib/cadastros/rotas";

/**
 * Compatibilidade: /api/cadastros/usuarios/[id] (lib/cadastros + travas em lib/cadastros/especificos.ts:
 * ninguém altera o próprio perfil, nem inativa a si mesmo ou o último administrador, e quem não é
 * administrador não mexe em quem tem mais acesso nem atribui perfil com acessos que não tem).
 */
const r = rotasItem("usuarios");
export const GET = r.GET;
export const PATCH = r.PATCH;
export const PUT = r.PUT;
export const DELETE = r.DELETE;
