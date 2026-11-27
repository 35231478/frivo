/**
 * A parte PURA do service worker de push (worker/index.ts usa; os testes também): ler o que chegou e
 * decidir o que mostrar e para onde o toque leva. Sem nada do navegador aqui.
 */
export interface NotificacaoParaMostrar {
  titulo: string;
  opcoes: { body: string; tag: string; icon: string; badge: string; data: { url: string }; actions?: { action: string; title: string }[]; renotify?: boolean };
}

const ICONE = "/icons/icon-192.png";
const PADRAO: NotificacaoParaMostrar = { titulo: "Frivo", opcoes: { body: "Há uma novidade no Frivo.", tag: "frivo", icon: ICONE, badge: ICONE, data: { url: "/" } } };

/** Só caminho INTERNO ("/…", nunca "//host"): o toque nunca leva para fora do Frivo. */
export function urlSegura(url: unknown): string {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") ? url : "/";
}

/** O texto que veio no push (JSON de lib/push/tipos › MensagemPush) → o que o aparelho mostra. Torto: um aviso genérico. */
export function lerPush(texto: string | null | undefined): NotificacaoParaMostrar {
  if (!texto) return PADRAO;
  let m: Record<string, unknown>;
  try { m = JSON.parse(texto); } catch { return PADRAO; }
  if (!m || typeof m !== "object" || typeof m.titulo !== "string") return PADRAO;
  const url = urlSegura(m.url);
  const acao = typeof m.acao === "string" && m.acao.trim() ? m.acao.trim().slice(0, 30) : null;
  return {
    titulo: m.titulo.slice(0, 120),
    opcoes: {
      body: typeof m.corpo === "string" ? m.corpo.slice(0, 300) : "",
      tag: typeof m.tag === "string" && m.tag ? m.tag.slice(0, 120) : "frivo",
      icon: ICONE, badge: ICONE, data: { url }, renotify: true,
      ...(acao ? { actions: [{ action: "abrir", title: acao }] } : {}),
    },
  };
}

/** Qual janela aberta do Frivo reaproveitar ao tocar: a que já está na mesma tela, senão qualquer uma do Frivo. */
export function janelaParaFocar<T extends { url: string }>(janelas: T[], destino: string, origem: string): T | null {
  const alvo = new URL(destino, origem).href;
  return janelas.find((j) => j.url === alvo) ?? janelas.find((j) => j.url.startsWith(origem)) ?? null;
}
