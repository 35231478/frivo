// @vitest-environment happy-dom
/**
 * PUSH — a tela "Notificações" (components/push/notificacoes-aparelho), no Meu perfil e no app:
 *  - sem as chaves no servidor, não aparece;
 *  - ativar: pede a permissão, inscreve no service worker com a chave do servidor e grava;
 *  - ativo: enviar teste e desativar (cancela no navegador e apaga no servidor);
 *  - bloqueado e navegador sem suporte: o aviso, sem botão;
 *  - iPhone fora da tela de início: a orientação UMA vez (depois, na ⓘ);
 *  - avisos por tipo (liga/desliga grava; recusa volta); aparelhos com Revogar (só no escritório).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn() };
});

let root: Root | null = null, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const esperar = () => act(async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null) => { expect(el, "elemento").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET");
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);

/* ───────── O navegador simulado: permissão, service worker e push ───────── */
const nav = { permissao: "default" as NotificationPermission, pedir: "granted" as NotificationPermission, inscricao: null as any, inscrever: vi.fn(), cancelar: vi.fn() };
function navegador({ suporte = true, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36", instalado = false } = {}) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  (window as any).matchMedia = (q: string) => ({ matches: instalado && q.includes("standalone"), addEventListener() {}, removeEventListener() {} });
  if (!suporte) { delete (window as any).PushManager; delete (window as any).Notification; delete (navigator as any).serviceWorker; return; }
  (window as any).PushManager = function () {};
  (window as any).Notification = { get permission() { return nav.permissao; }, requestPermission: vi.fn(async () => { nav.permissao = nav.pedir; return nav.pedir; }) };
  const pushManager = {
    getSubscription: vi.fn(async () => nav.inscricao),
    subscribe: vi.fn(async (o: any) => {
      nav.inscrever(o);
      nav.inscricao = { endpoint: "https://push.exemplo/este-aparelho-123456789", toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }), unsubscribe: async () => { nav.cancelar(); nav.inscricao = null; return true; } };
      return nav.inscricao;
    }),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve({ pushManager }) }, configurable: true });
}

async function montar(modo: "app" | "escritorio") {
  const { NotificacoesAparelho } = await import("@/components/push/notificacoes-aparelho");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(NotificacoesAparelho, { modo })); });
  await esperar();
}

const TIPOS = [
  { id: "OS_NOVA", rotulo: "Nova OS para você", dica: "…", ligado: true, previsto: false },
  { id: "OS_COMENTARIO", rotulo: "Comentário novo na OS", dica: "Alguém comentou.", ligado: false, previsto: true },
];
const APARELHOS = [
  { id: "s1", aparelho: "Windows · Chrome", desde: "2026-11-20T12:00:00Z", ultimoEnvioEm: null, final: "https://push.exemplo/este-aparelho-123456789".slice(-24) },
  { id: "s2", aparelho: "Android · Chrome", desde: "2026-11-10T12:00:00Z", ultimoEnvioEm: "2026-11-25T12:00:00Z", final: "outro-aparelho-final-xyz" },
];

beforeAll(async () => { await import("@/components/push/notificacoes-aparelho"); }, 120_000);
beforeEach(async () => {
  chamadas.length = 0;
  nav.permissao = "default"; nav.pedir = "granted"; nav.inscricao = null; nav.inscrever.mockClear(); nav.cancelar.mockClear();
  try { localStorage.clear(); } catch { /* */ }
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  respostas = {
    "GET /api/push/chave": { status: 200, corpo: { ligado: true, chave: "BChaveFicticia" } },
    "GET /api/push/preferencias": { status: 200, corpo: TIPOS },
    "GET /api/push/aparelhos": { status: 200, corpo: APARELHOS },
    "POST /api/push/subscribe": { status: 201, corpo: { ok: true } },
    "DELETE /api/push/subscribe": { status: 200, corpo: { ok: true } },
    "POST /api/push/teste": { status: 200, corpo: { ok: true, aparelhos: 1 } },
    "PUT /api/push/preferencias": { status: 200, corpo: { ok: true } },
    "DELETE /api/push/aparelhos/s2": { status: 200, corpo: { ok: true } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const r = respostas[`${metodo} ${url}`] ?? { status: 404, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  navegador();
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("ligado ou não", () => {
  it("sem as chaves no servidor, o bloco não aparece (nem consulta o resto)", async () => {
    respostas["GET /api/push/chave"] = { status: 200, corpo: { ligado: false, chave: null } };
    await montar("escritorio");
    expect($("[data-notificacoes-aparelho]")).toBeNull();
    expect(chamadas.map((c) => c.url)).toEqual(["/api/push/chave"]);
  });
});

describe("ativar e desativar", () => {
  it("ativar: pede a permissão, inscreve com a chave do servidor e grava este aparelho", async () => {
    await montar("escritorio");
    expect($("[data-notificacoes-aparelho]")!.getAttribute("data-notificacoes-aparelho")).toBe("inativo");
    await clicar($("[data-ativar-push]"));
    expect((window as any).Notification.requestPermission).toHaveBeenCalled();
    const chave = nav.inscrever.mock.calls[0][0].applicationServerKey as Uint8Array;
    expect(nav.inscrever.mock.calls[0][0].userVisibleOnly).toBe(true);
    expect([...chave]).toEqual([...Uint8Array.from(atob("BChaveFicticia=="), (c) => c.charCodeAt(0))]);
    expect(gravacoes()).toEqual([{ url: "/api/push/subscribe", metodo: "POST", corpo: { endpoint: "https://push.exemplo/este-aparelho-123456789", keys: { p256dh: "p", auth: "a" }, userAgent: navigator.userAgent } }]);
    expect(await toasts()).toEqual([["Notificações ativadas neste aparelho.", "sucesso"]]);
    expect($("[data-push-ativo]")).toBeTruthy();
    // a lista marca este aparelho
    expect(txt($('[data-aparelho="s1"]'))).toContain("(este aparelho)");
    expect(txt($('[data-aparelho="s2"]'))).not.toContain("(este aparelho)");
  });

  it("a pessoa nega no aparelho: nada é gravado e a tela diz por quê", async () => {
    nav.pedir = "denied";
    await montar("app");
    await clicar($("[data-ativar-push]"));
    expect(gravacoes()).toEqual([]);
    expect(txt($("[data-push-erro]"))).toBe("As notificações foram bloqueadas neste aparelho.");
  });

  it("o servidor recusa a inscrição: o motivo aparece, sem aviso de sucesso", async () => {
    respostas["POST /api/push/subscribe"] = { status: 409, corpo: { erro: "As notificações ainda não foram ligadas no servidor." } };
    await montar("app");
    await clicar($("[data-ativar-push]"));
    expect(txt($("[data-push-erro]"))).toBe("As notificações ainda não foram ligadas no servidor.");
    expect(await toasts()).toEqual([]);
  });

  it("ativo: Enviar teste chama a rota; Desativar cancela no navegador e apaga no servidor", async () => {
    nav.permissao = "granted";
    nav.inscricao = { endpoint: "https://push.exemplo/este-aparelho-123456789", toJSON: () => ({}), unsubscribe: async () => { nav.cancelar(); return true; } };
    await montar("app");
    expect($("[data-ativar-push]")).toBeNull();
    await clicar($("[data-testar-push]"));
    expect(gravacoes()).toEqual([{ url: "/api/push/teste", metodo: "POST", corpo: null }]);
    respostas["POST /api/push/teste"] = { status: 409, corpo: { erro: "Nenhum aparelho recebeu. Ative as notificações neste aparelho." } };
    await clicar($("[data-testar-push]"));
    expect(txt($("[data-push-erro]"))).toContain("Nenhum aparelho recebeu");
    chamadas.length = 0;
    await clicar($("[data-desativar-push]"));
    expect(gravacoes()).toEqual([{ url: "/api/push/subscribe", metodo: "DELETE", corpo: { endpoint: "https://push.exemplo/este-aparelho-123456789" } }]);
    expect(nav.cancelar).toHaveBeenCalled();
  });
});

describe("os estados sem botão", () => {
  it("bloqueado no aparelho: o aviso (o caminho na ⓘ), sem botão de ativar", async () => {
    nav.permissao = "denied";
    await montar("escritorio");
    expect($("[data-push-bloqueado]")).toBeTruthy();
    expect($("[data-ativar-push]")).toBeNull();
  });
  it("navegador sem suporte: diz que não recebe", async () => {
    navegador({ suporte: false });
    await montar("escritorio");
    expect(txt($("[data-push-sem-suporte]"))).toBe("Este navegador não recebe notificações.");
  });
  it("iPhone no Safari: a orientação de instalar aparece uma vez; depois, só a linha curta com a ⓘ", async () => {
    navegador({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1" });
    await montar("app");
    expect(txt($("[data-orientacao-iphone]"))).toContain("Compartilhar › Adicionar à Tela de Início");
    expect($("[data-ativar-push]")).toBeNull();
    await clicar($('[data-orientacao-iphone] button[aria-label="Entendi"]'));
    expect($("[data-orientacao-iphone]")).toBeNull();
    expect(txt($("[data-push-iphone]"))).toBe("Instale o Frivo na tela de início para receber.");
    // reabrir a tela: não mostra de novo
    await act(async () => root?.unmount()); caixa.remove();
    await montar("app");
    expect($("[data-orientacao-iphone]")).toBeNull();
  });
  it("iPhone com o Frivo instalado na tela de início: ativa normalmente", async () => {
    navegador({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", instalado: true });
    await montar("app");
    expect($("[data-push-iphone]")).toBeNull();
    expect($("[data-ativar-push]")).toBeTruthy();
  });
});

describe("avisos por tipo e aparelhos", () => {
  it("no app os avisos ficam recolhidos; trocar um grava só ele; recusado, volta", async () => {
    await montar("app");
    expect($("[data-tipos-push]")).toBeNull();
    expect($("[data-aparelhos-push]")).toBeNull(); // a lista de aparelhos é só no escritório
    await clicar($("[data-ver-tipos]"));
    const sw = (id: string) => $(`[data-tipo-push="${id}"] [role="switch"]`)!;
    expect(sw("OS_COMENTARIO").getAttribute("aria-checked")).toBe("false");
    await clicar(sw("OS_COMENTARIO"));
    expect(gravacoes()).toEqual([{ url: "/api/push/preferencias", metodo: "PUT", corpo: { OS_COMENTARIO: true } }]);
    expect(sw("OS_COMENTARIO").getAttribute("aria-checked")).toBe("true");
    respostas["PUT /api/push/preferencias"] = { status: 500, corpo: {} };
    await clicar(sw("OS_NOVA"));
    expect(sw("OS_NOVA").getAttribute("aria-checked")).toBe("true"); // voltou
    expect((await toasts()).at(-1)).toEqual(["Não foi possível salvar a preferência.", "erro"]);
  });
  it("no escritório: os avisos à vista e os aparelhos com Revogar", async () => {
    await montar("escritorio");
    expect($$("[data-tipo-push]").map((e) => e.getAttribute("data-tipo-push"))).toEqual(["OS_NOVA", "OS_COMENTARIO"]);
    expect(txt($('[data-aparelho="s2"]'))).toContain("Android · Chrome");
    expect(txt($('[data-aparelho="s2"]'))).toContain("último aviso 25/11/2026");
    respostas["GET /api/push/aparelhos"] = { status: 200, corpo: [APARELHOS[0]] };
    await clicar($('[data-revogar-aparelho="s2"]'));
    expect(gravacoes()).toEqual([{ url: "/api/push/aparelhos/s2", metodo: "DELETE", corpo: null }]);
    expect(await toasts()).toEqual([["Android · Chrome: não recebe mais notificações.", "sucesso"]]);
    expect($('[data-aparelho="s2"]')).toBeNull();
  });
});
