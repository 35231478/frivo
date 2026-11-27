/**
 * Service worker do Frivo: a parte do PUSH. O next-pwa embute este arquivo no sw.js gerado (customWorkerSrc,
 * padrão "worker"). A lógica fica pura em lib/push/sw.ts; aqui só os eventos do navegador.
 *  - push: mostra a notificação (título, texto, ação "Abrir OS");
 *  - toque: foca a janela do Frivo que já está aberta (e navega para o destino) ou abre uma nova;
 *  - pushsubscriptionchange: o navegador trocou a inscrição sozinho — reinscreve com a mesma chave.
 */
import { janelaParaFocar, lerPush, urlSegura } from "../lib/push/sw";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sw = self as any;

sw.addEventListener("push", (event: any) => {
  const n = lerPush(event.data ? event.data.text() : null);
  event.waitUntil(sw.registration.showNotification(n.titulo, n.opcoes));
});

sw.addEventListener("notificationclick", (event: any) => {
  event.notification.close();
  const destino = urlSegura(event.notification.data?.url);
  event.waitUntil((async () => {
    const janelas = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
    const janela: any = janelaParaFocar(janelas as { url: string }[], destino, sw.location.origin);
    if (janela) {
      await janela.focus();
      if (janela.url !== new URL(destino, sw.location.origin).href && "navigate" in janela) await janela.navigate(destino).catch(() => null);
      return;
    }
    await sw.clients.openWindow(destino);
  })());
});

sw.addEventListener("pushsubscriptionchange", (event: any) => {
  event.waitUntil((async () => {
    const chave = event.oldSubscription?.options?.applicationServerKey;
    if (!chave) return;
    const nova = await sw.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
    const json = nova.toJSON();
    await fetch("/api/push/subscribe", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ endpoint: nova.endpoint, keys: json.keys, userAgent: navigator.userAgent }),
    });
  })());
});
