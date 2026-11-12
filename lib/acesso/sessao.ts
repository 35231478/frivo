/**
 * Duração da sessão ("Manter conectado"). Sem imports: roda também no middleware (Edge).
 *  - marcado: 30 dias, renovados a cada uso — o mesmo de antes desta mudança;
 *  - desmarcado: 1 dia contado do LOGIN; depois disso o servidor recusa o token, mesmo com uso.
 * Token emitido antes desta mudança (sem a marca `lembrar`) segue a regra antiga (30 dias).
 */
export const SESSAO_LONGA_SEG = 30 * 24 * 60 * 60;
export const SESSAO_CURTA_MS = 24 * 60 * 60 * 1000;

export function sessaoCurtaVencida(token: { lembrar?: unknown; loginEm?: unknown }, agora = Date.now()): boolean {
  if (token.lembrar !== false) return false;
  const loginEm = Number(token.loginEm);
  return !Number.isFinite(loginEm) || agora - loginEm > SESSAO_CURTA_MS;
}
