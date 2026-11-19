/**
 * O gate de MÓDULO nas páginas (Server Components).
 *
 * É a camada do meio das três que guardam um módulo desligado:
 *   1. o menu não mostra o item (components/layout/sidebar › podeVer);
 *   2. a PÁGINA redireciona quem digitou o endereço na mão ou veio de um link antigo — aqui;
 *   3. a API recusa com 403 (lib/permissoes-server › exigirPermissao).
 *
 * Fica na página, e não no middleware, de propósito: o middleware roda no Edge e não fala com o
 * banco, então ele só saberia dos módulos pelo token — que é congelado no login. Com a checagem
 * aqui, desligar um módulo vale na mesma navegação, para todo mundo, sem derrubar sessão.
 * (O sistema já usa esse padrão: `moduloDaRota` devolvendo null significa "a página confere".)
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { temModulo } from "./servidor";

/**
 * Manda para /sem-permissao quem abrir a página de um módulo que a empresa desligou.
 * Devolve a sessão para a página seguir usando (ela já ia chamar `auth()` de qualquer jeito).
 */
export async function exigirModuloNaPagina(modulo: string) {
  const session = await auth();
  if (!session) redirect("/sessao-encerrada");
  const empresaId = (session.user as any).empresaId as string | undefined;
  if (empresaId && !(await temModulo(empresaId, modulo))) {
    redirect(`/sem-permissao?modulo=${encodeURIComponent(modulo)}`);
  }
  return session;
}
