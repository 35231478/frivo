/**
 * O cookie da sessão do painel — puro, sem banco: pode ser importado no middleware (Edge).
 */

/** Cookies da sessão do painel (com prefixo seguro e em pedaços). Não toca no cookie do portal. */
export const COOKIE_SESSAO = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

/** O nome sem o número do pedaço (o Auth.js divide tokens grandes em nome.0, nome.1…) */
export const nomeBaseDaSessao = (nome: string) => nome.replace(/\.\d+$/, "");

/**
 * Os atributos com que o Auth.js grava o cookie da sessão. Apagar ou regravar tem de usar OS MESMOS:
 * o navegador RECUSA um Set-Cookie de nome `__Secure-…` sem `Secure` — o cookie velho fica, o
 * middleware o vê válido e manda /login → /dashboard → /sessao-encerrada → /login em loop
 * (ERR_TOO_MANY_REDIRECTS em produção, onde o nome tem o prefixo).
 */
export function atributosDaSessao(nome: string) {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", secure: nome.startsWith("__Secure-") };
}

type ComCookies = { cookies: { set: (nome: string, valor: string, opcoes: Record<string, unknown>) => unknown } };

/**
 * Apaga na resposta TODOS os cookies da sessão do painel que vieram no pedido — cada pedaço (.0, .1…) e o
 * nome base —, com os atributos do Auth.js. Devolve os nomes apagados. O cookie do portal fica.
 */
export function apagarCookiesDaSessao(res: ComCookies, nomesNoPedido: string[]): string[] {
  const alvo = new Set<string>();
  for (const n of nomesNoPedido) if (COOKIE_SESSAO.test(n)) { alvo.add(n); alvo.add(nomeBaseDaSessao(n)); }
  for (const n of alvo) res.cookies.set(n, "", { ...atributosDaSessao(n), maxAge: 0, expires: new Date(0) });
  return [...alvo].sort();
}

/**
 * Login aberto por /sessao-encerrada (`?sessao=encerrada`): o servidor já recusou esta sessão. O
 * middleware NÃO manda para /dashboard (seria o ciclo de volta) — mostra o login e apaga o cookie de novo.
 * Todo caminho em que o servidor recusa o cookie passa por /sessao-encerrada, que marca a URL: o ciclo
 * para aqui mesmo que o navegador tenha recusado apagar.
 */
export const loginAposEncerrar = (url: URL) => url.pathname === "/login" && url.searchParams.get("sessao") === "encerrada";

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
