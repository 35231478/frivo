/**
 * As chaves VAPID do push, lidas do AMBIENTE a cada uso (não da compilação): VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY e VAPID_SUBJECT (um "mailto:" ou "https:" de contato, exigido pelos serviços de push).
 * Faltando qualquer uma, o push fica DESLIGADO sem erro: o botão de ativar não aparece e o envio não faz
 * nada. As chaves são geradas por `node scripts/gerar-chaves-vapid.mjs` (docs/push-notificacoes.md).
 */
export interface ChavesVapid { publica: string; privada: string; assunto: string }

export function chavesVapid(env: Record<string, string | undefined> = process.env): ChavesVapid | null {
  const publica = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privada = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const assunto = (env.VAPID_SUBJECT ?? "").trim();
  if (!publica || !privada || !/^(mailto:|https:\/\/)/.test(assunto)) return null;
  return { publica, privada, assunto };
}

export const pushLigado = (env?: Record<string, string | undefined>) => chavesVapid(env) !== null;
