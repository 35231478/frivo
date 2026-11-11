/**
 * Retorno tátil (haptic) do app do técnico: um pulso curtinho ao tocar, para o dedo "sentir" o toque.
 * É sempre um NO-OP silencioso onde não há suporte — nunca lança erro nem atrasa o toque.
 *
 * Três caminhos, nesta ordem:
 *  1. haptic NATIVO registrado pelo app de loja (`registrarHapticoNativo`) — ainda não existe: é o
 *     encaixe para quando o app for empacotado (Capacitor);
 *  2. o plugin de Haptics do Capacitor, se a página estiver rodando dentro do app nativo e o plugin
 *     estiver instalado (`window.Capacitor.Plugins.Haptics`) — também para o empacotamento;
 *  3. `navigator.vibrate` (Android, no navegador e no PWA instalado).
 *
 * iPhone: todos os navegadores do iOS usam o motor do Safari (WebKit), que não tem vibração pela web.
 * Lá, hoje, nada acontece (sem erro); o haptic chega pelo caminho 1 ou 2 quando houver app de loja.
 */

/** Duração do pulso do toque (ms): curto de propósito — é para sentir, não para vibrar */
export const PULSO_TOQUE_MS = 10;

type HapticoNativo = () => void | Promise<unknown>;
let nativo: HapticoNativo | null = null;

/**
 * O app de loja registra aqui o haptic nativo (ex.: `() => Haptics.impact({ style: ImpactStyle.Light })`).
 * `null` volta ao comportamento da web.
 */
export function registrarHapticoNativo(fn: HapticoNativo | null): void {
  nativo = fn;
}

interface PonteCapacitor {
  isNativePlatform?: () => boolean;
  Plugins?: { Haptics?: { impact?: (o: { style: string }) => Promise<unknown> } };
}

/** O plugin oficial de Haptics do Capacitor, quando a página roda dentro do app nativo. */
function hapticoDoCapacitor(): HapticoNativo | null {
  const cap = (globalThis as { Capacitor?: PonteCapacitor }).Capacitor;
  const haptics = cap?.Plugins?.Haptics;
  if (!cap?.isNativePlatform?.() || typeof haptics?.impact !== "function") return null;
  return () => haptics.impact!({ style: "LIGHT" });
}

/** Pulso leve do toque. Sem suporte (ou com qualquer falha) não faz nada. */
export function toqueLeve(): void {
  try {
    const doApp = nativo ?? hapticoDoCapacitor();
    if (doApp) {
      // Falha do lado nativo (assíncrona ou não) nunca chega à tela
      void Promise.resolve(doApp()).catch(() => undefined);
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(PULSO_TOQUE_MS);
  } catch {
    /* sem suporte ou bloqueado pelo navegador: silêncio */
  }
}
