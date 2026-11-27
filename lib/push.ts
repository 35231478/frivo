/**
 * Push no NAVEGADOR (cliente): o estado deste aparelho, ativar e desativar. A chave pública vem do servidor
 * (/api/push/chave, lida do ambiente na hora); sem as chaves no servidor, `ligadoNoServidor` é false e a tela
 * nem oferece ativar. Ativar = pedir a permissão do aparelho, inscrever no service worker e gravar a inscrição.
 */
import { precisaInstalarNoIphone } from "@/lib/push/tipos";

export function pushSuportado(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** O app está aberto como app instalado (tela de início), não na aba do navegador */
export function appInstalado(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function base64ParaBytes(base64: string): Uint8Array {
  const b64 = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from([...atob(b64)].map((c) => c.charCodeAt(0)));
}

export type EstadoPush =
  | { situacao: "desligado" }            // o servidor não tem as chaves: nada a oferecer
  | { situacao: "sem-suporte" }          // navegador antigo
  | { situacao: "instalar-iphone" }      // iPhone fora da tela de início: só a orientação
  | { situacao: "bloqueado" }            // a pessoa negou a permissão no aparelho
  | { situacao: "inativo"; chave: string }
  | { situacao: "ativo"; chave: string; endpoint: string };

export async function chaveDoServidor(): Promise<string | null> {
  const r = await fetch("/api/push/chave", { cache: "no-store" }).catch(() => null);
  const d = r?.ok ? await r.json().catch(() => null) : null;
  return d?.ligado && typeof d.chave === "string" ? d.chave : null;
}

/** O service worker pronto, sem esperar para sempre (em desenvolvimento ele fica desligado) */
async function registro(ms = 8000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export async function estadoDoAparelho(): Promise<EstadoPush> {
  const chave = await chaveDoServidor();
  if (!chave) return { situacao: "desligado" };
  if (precisaInstalarNoIphone(typeof navigator !== "undefined" ? navigator.userAgent : "", appInstalado())) return { situacao: "instalar-iphone" };
  if (!pushSuportado()) return { situacao: "sem-suporte" };
  if (Notification.permission === "denied") return { situacao: "bloqueado" };
  const reg = await registro(3000);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? { situacao: "ativo", chave, endpoint: sub.endpoint } : { situacao: "inativo", chave };
}

/** Pede a permissão e inscreve ESTE aparelho. Devolve o erro em texto (para a tela) ou null. */
export async function ativarNesteAparelho(chave: string): Promise<string | null> {
  if (!pushSuportado()) return "Este navegador não recebe notificações.";
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return permissao === "denied" ? "As notificações foram bloqueadas neste aparelho." : "A permissão não foi dada.";
  const reg = await registro();
  if (!reg) return "O serviço do app ainda não está ativo neste aparelho. Recarregue a página e tente de novo.";
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ParaBytes(chave) as BufferSource });
  const json = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys, userAgent: navigator.userAgent }),
  }).catch(() => null);
  if (!res?.ok) return (await res?.json().catch(() => null))?.erro ?? "Não foi possível ativar. Tente de novo.";
  return null;
}

/** Desliga ESTE aparelho: cancela a inscrição no navegador e apaga no servidor. */
export async function desativarNesteAparelho(): Promise<void> {
  const reg = pushSuportado() ? await registro(3000) : null;
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
  await sub.unsubscribe().catch(() => false);
}

/** Compat do banner de instalação: depois de instalar, já oferece as notificações (sem chave no servidor, nada). */
export async function solicitarPermissaoEPush(): Promise<boolean> {
  const chave = await chaveDoServidor();
  if (!chave) return false;
  return (await ativarNesteAparelho(chave)) === null;
}
