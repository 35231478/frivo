/**
 * Quem vê a área "Empresas (Frivo)" no menu: o mesmo dono do Frivo (role SUPER_ADMIN) da trava das
 * anotações. Módulo próprio para o menu não citar a ferramenta de anotações (que fica fora do menu).
 */
export { ehDonoDoFrivo as veAreaDeEmpresas } from "@/lib/anotacoes/dono";
