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

/**
 * D2 — o "Manter conectado" do login. No APP DO TÉCNICO (modo técnico) a sessão vale sempre 30 dias: o técnico abre
 * o celular no dia seguinte e a fila sobe sem pedir senha. O escritório segue com a escolha da caixa. "Um aparelho só",
 * inativar e redefinir o acesso continuam derrubando na hora (lib/sessao-ativa: o servidor confere a cada leitura).
 */
export function lembrarNoLogin(marcouManterConectado: boolean, appDoTecnico: boolean): boolean {
  return marcouManterConectado || appDoTecnico;
}
