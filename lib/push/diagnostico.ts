/**
 * HOTFIX push — ler a RESPOSTA do serviço de push (FCM do Chrome/Android, Apple, Mozilla, Microsoft) por aparelho.
 * Puro: o envio, a rota de diagnóstico e os testes usam as mesmas funções. Nada aqui guarda ou devolve a chave VAPID:
 * só a IMPRESSÃO dela (sha-256, 12 caracteres) para comparar a do navegador com a do servidor.
 */
import { createECDH, createHash } from "node:crypto";

/** A impressão da chave pública (base64url): o bastante para comparar, sem revelar a chave */
export function impressaoDaChave(chavePublica: string | null | undefined): string | null {
  const t = (chavePublica ?? "").trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return t ? createHash("sha256").update(t).digest("hex").slice(0, 12) : null;
}

const deBase64Url = (t: string) => Buffer.from(t.trim().replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * A chave PRIVADA gera a PÚBLICA? (par VAPID trocado, colado pela metade ou de pares diferentes = todo envio recusado
 * com 403). Só responde sim/não: nenhuma das duas sai daqui.
 */
export function chavesCoerentes(publica: string, privada: string): boolean {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(deBase64Url(privada));
    return ecdh.getPublicKey().equals(deBase64Url(publica));
  } catch {
    return false;
  }
}

/** O serviço de push do aparelho, pelo endereço (o resto do endpoint é segredo do aparelho e não sai daqui) */
export function servicoDoEndpoint(endpoint: string): string {
  let host = "";
  try { host = new URL(endpoint).host; } catch { return "desconhecido"; }
  if (/(^|\.)fcm\.googleapis\.com$|(^|\.)android\.googleapis\.com$/.test(host)) return "Google (Chrome/Android)";
  if (/(^|\.)push\.apple\.com$/.test(host)) return "Apple (iPhone/Safari)";
  if (/(^|\.)push\.services\.mozilla\.com$/.test(host)) return "Mozilla (Firefox)";
  if (/(^|\.)notify\.windows\.com$/.test(host)) return "Microsoft (Edge)";
  return host || "desconhecido";
}

/** Os sinais, no corpo da recusa, de que a inscrição foi feita com OUTRA chave VAPID (ela nunca vai funcionar) */
const CHAVE_ERRADA = /VapidPkHashMismatch|BadJwtToken|InvalidJwtToken|invalid JWT|do not correspond|credentials.*(?:mismatch|do not)|BadWebPushTopic|invalid.*vapid|vapid.*invalid|ExpiredJwtToken|BadAuthorizationHeader/i;

export type Situacao = "ok" | "inscricao_morta" | "chave_diferente" | "recusado" | "temporario";

export interface RespostaServico { status: number | null; corpo?: string | null }

/**
 * Como tratar a resposta:
 *  - 2xx: aceito;
 *  - 404/410: a inscrição expirou ou foi revogada → apagar;
 *  - 400/401/403 com sinal de chave VAPID diferente → apagar (o app reinscreve com a chave atual ao abrir);
 *  - 413, outros 4xx: recusado (o aviso não sai, a inscrição fica);
 *  - 429, 5xx, sem resposta (rede): temporário (conta como falha; depois de várias, sai).
 */
export function situacaoDaResposta(r: RespostaServico): Situacao {
  const s = r.status;
  if (s !== null && s >= 200 && s < 300) return "ok";
  if (s === 404 || s === 410) return "inscricao_morta";
  if ((s === 400 || s === 401 || s === 403) && CHAVE_ERRADA.test(r.corpo ?? "")) return "chave_diferente";
  if (s === 401 || s === 403) return "chave_diferente";
  if (s === null || s === 429 || s >= 500) return "temporario";
  return "recusado";
}

/** Apagar a inscrição? (ela não vai funcionar nunca mais) */
export const apagarInscricao = (s: Situacao) => s === "inscricao_morta" || s === "chave_diferente";

/** O motivo em português, curto, para o diagnóstico e o registro do envio (sem endpoint, sem chave) */
export function motivoDaResposta(r: RespostaServico): string {
  const s = situacaoDaResposta(r);
  if (s === "ok") return "Aceito pelo serviço de push.";
  if (s === "inscricao_morta") return "A inscrição expirou ou foi desativada neste aparelho. Ative de novo no aparelho.";
  if (s === "chave_diferente") return "A inscrição foi feita com outra chave VAPID (ou a chave do servidor está errada). O aparelho precisa ativar de novo: o app faz isso sozinho ao abrir.";
  if (r.status === 413) return "Mensagem grande demais para o serviço de push.";
  if (r.status === 429) return "O serviço de push pediu para esperar (muitos envios).";
  if (s === "temporario") return r.status === null ? "Sem resposta do serviço de push (rede)." : `Erro temporário no serviço de push (${r.status}).`;
  return `Recusado pelo serviço de push (${r.status}).`;
}

/** Um trecho seguro do corpo da recusa (sem quebras, curto) */
export const trechoDoCorpo = (corpo: string | null | undefined) => (corpo ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;

export interface ResultadoAparelho {
  aparelho: string;
  servico: string;
  ok: boolean;
  status: number | null;
  situacao: Situacao;
  motivo: string;
  /** O que o serviço respondeu (trecho), para o diagnóstico */
  detalhe: string | null;
  removido: boolean;
}
