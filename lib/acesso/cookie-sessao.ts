/**
 * O cookie da sessão do painel — puro, sem banco: pode ser importado no middleware (Edge).
 */

/** Cookies da sessão do painel (com prefixo seguro e em pedaços). Não toca no cookie do portal. */
export const COOKIE_SESSAO = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

/**
 * Tira da resposta do MIDDLEWARE as linhas Set-Cookie da sessão do painel (as outras ficam).
 *
 * O Auth.js, no middleware, regrava o cookie da sessão em TODA resposta com o token que a requisição
 * trouxe. Quando o runtime Node grava um cookie novo (o acesso atualizado em /api/auth/session, a
 * senha trocada no perfil), as requisições que já tinham saído com o cookie antigo — o prefetch dos
 * links do menu, a busca dos alertas — voltam depois e gravam o ANTIGO por cima. Visto no navegador:
 * o acesso concedido "voltava atrás" de vez em quando.
 *
 * Sem isso, quem grava o cookie da sessão é só o runtime Node: o login, a saída e /api/auth/session
 * (que o painel chama ao navegar e ao voltar para a aba — components/acesso/sincronizar-acesso —, o
 * que também renova os 30 dias de "Manter conectado").
 */
export function semCookieDaSessao<R extends Response>(res: R): R {
  const todos = res.headers.getSetCookie();
  const outros = todos.filter((c) => !COOKIE_SESSAO.test(c.slice(0, c.indexOf("=")).trim()));
  if (outros.length === todos.length) return res;
  res.headers.delete("set-cookie");
  for (const c of outros) res.headers.append("set-cookie", c);
  return res;
}
