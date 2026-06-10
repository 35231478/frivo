/**
 * Helper client de notificações push. Estrutura pronta para quando houver chaves
 * VAPID: define NEXT_PUBLIC_VAPID_PUBLIC_KEY no ambiente e o subscribe passa a salvar
 * a subscription do dispositivo em /api/push/subscribe. Sem a chave, faz no-op.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function base64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSuportado(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Solicita permissão de notificações e registra a subscription do dispositivo.
 * Retorna false (no-op) se não houver suporte ou chave VAPID configurada.
 */
export async function solicitarPermissaoEPush(): Promise<boolean> {
  if (!pushSuportado() || !VAPID_PUBLIC_KEY) return false;

  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  const existente = await registration.pushManager.getSubscription();
  const subscription =
    existente ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));

  const json = subscription.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  });
  return res.ok;
}
