/**
 * O que o middleware faz com um pedido SEM sessão (cookie vencido ou apagado).
 *
 * - API do app do técnico: 401 em JSON. O app guarda a fila no aparelho e mostra "Entre de novo"; um
 *   redirecionamento para o /login chegaria ao app como HTML 200, que ele não entende (e a fila ficava parada sem
 *   aviso). As outras APIs continuam como estavam.
 * - Página do app do técnico: o login, com o motivo (o técnico entende por que voltou para lá e que nada se perdeu).
 * - O resto: o login, sem motivo.
 */
export type SemSessao = { tipo: "api" } | { tipo: "login"; motivo: "expirou" | null };

export const MSG_SESSAO_EXPIRADA_API = "Sua sessão expirou. Entre de novo: o que está no aparelho continua guardado.";
/** O aviso do login quando o app do técnico perdeu a sessão */
export const MSG_SESSAO_EXPIRADA = "Sua sessão expirou. Entre de novo: o que você fez sem sinal continua guardado no aparelho e sobe depois.";

const doApp = (p: string) => p === "/tecnico" || p.startsWith("/tecnico/");

export function semSessao(pathname: string): SemSessao {
  if (pathname.startsWith("/api/tecnico/")) return { tipo: "api" };
  return { tipo: "login", motivo: doApp(pathname) ? "expirou" : null };
}
