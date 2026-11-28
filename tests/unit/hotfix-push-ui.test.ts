// @vitest-environment happy-dom
/**
 * HOTFIX push + comentários — nas telas e no navegador:
 *  - OS › Comentários: atualiza sozinho a cada 20 s com a aba visível (e ao voltar para ela), não com a aba escondida;
 *    a marca da atividade e o "novo"; o erro aparece como erro (antes virava "Nenhum comentário");
 *  - o navegador: inscrição feita com OUTRA chave é refeita (sem pedir permissão de novo) e gravada com a chave;
 *    sem permissão dada, nada; push desligado no servidor, nada;
 *  - o convite do escritório: aparece para quem não ativou; Ativar; "Agora não" some por 14 dias.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/ui/avisos", () => ({ toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/ui/sino", () => ({ atualizarSino: vi.fn() }));

let root: Root | undefined;
let chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};
beforeEach(() => {
  chamadas = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; try { localStorage.clear(); sessionStorage.clear(); } catch { /* ok */ } });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function montar(el: React.ReactElement) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(el); });
  await esperar();
}

const COMENTARIOS = [
  { id: "k1", clientId: null, texto: "Leve a escada", autor: "Ana", origem: "ESCRITORIO", criadoEm: "2026-11-28T02:27:00Z", meu: true, atividade: null, novo: false },
  { id: "k2", clientId: "c1", texto: "Falta a peça", autor: "Carlos", origem: "APP", criadoEm: "2026-11-28T02:30:00Z", meu: false, atividade: "Limpeza dos splits", novo: true },
];

describe("OS › Conversa no escritório (CHAT-1: a mesma conversa da tela Conversas, com tempo real no lugar dos 20 s)", () => {
  const CONVERSA = { osId: "os1", osNumero: "OS-1", cliente: "Cliente", status: "AGENDADA", tecnicos: ["Carlos"], ultima: null, naoLidas: 0 };

  it("mostra os do app com a marca da atividade e o 'novo'; a mensagem minha à direita", async () => {
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: CONVERSA, mensagens: COMENTARIOS } };
    const { ComentariosOs } = await import("@/components/os/comentarios-os");
    await montar(createElement(ComentariosOs, { osId: "os1", podeResponder: true }));
    expect($$("[data-mensagem]").map((li) => li.getAttribute("data-origem"))).toEqual(["ESCRITORIO", "APP"]);
    expect(txt($("[data-origem='APP'] [data-autor]"))).toBe("Carlos · Limpeza dos splits");
    expect($("[data-origem='APP']")!.hasAttribute("data-nova")).toBe(true);
    expect($("[data-origem='ESCRITORIO']")!.hasAttribute("data-minha")).toBe(true);
  });

  it("o erro da leitura aparece como erro (não como 'Nenhuma mensagem')", async () => {
    respostas["GET /api/conversas/os1"] = { status: 403, corpo: { erro: "Sem permissão" } };
    const { ComentariosOs } = await import("@/components/os/comentarios-os");
    await montar(createElement(ComentariosOs, { osId: "os1", podeResponder: false }));
    expect(txt($("[data-mensagens] [role='alert']"))).toBe("Sem permissão");
    expect($("[data-sem-mensagens]")).toBeNull();
  });

  it("resposta de erro que ainda traz uma lista (cache, proxy): vale o status — é erro, a lista não é usada", async () => {
    respostas["GET /api/conversas/os1"] = { status: 502, corpo: { erro: "Falha temporária", conversa: CONVERSA, mensagens: [] } };
    const { ComentariosOs } = await import("@/components/os/comentarios-os");
    await montar(createElement(ComentariosOs, { osId: "os1", podeResponder: false }));
    expect(txt($("[data-mensagens] [role='alert']"))).toBe("Falha temporária");
  });
});

/* ───────── o navegador ───────── */

const CHAVE = "BChaveDoServidorAtual00A";
const OUTRA = "BChaveAntigaDeOutroAmbAA";
const bytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
function navegador(o: { permissao: NotificationPermission; chaveDaInscricao?: string | null }) {
  const nav = { inscrita: o.chaveDaInscricao === undefined ? null : o.chaveDaInscricao, cancelou: 0, novas: 0 };
  const inscricao = (k: string | null) => k === null ? null : ({
    endpoint: `https://fcm.googleapis.com/fcm/send/aparelho-${k.slice(0, 6)}`, options: { applicationServerKey: bytes(k).buffer },
    toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }), unsubscribe: async () => { nav.cancelou++; nav.inscrita = null; return true; },
  });
  const pushManager = {
    getSubscription: async () => inscricao(nav.inscrita),
    subscribe: async (op: { applicationServerKey: Uint8Array }) => { nav.novas++; nav.inscrita = btoa(String.fromCharCode(...op.applicationServerKey)); return inscricao(nav.inscrita); },
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  (window as any).PushManager = function PushManager() { /* existe */ };
  (window as any).Notification = { permission: o.permissao, requestPermission: vi.fn(async () => o.permissao) };
  return nav;
}

describe("o navegador refaz a inscrição feita com outra chave", () => {
  beforeEach(() => { respostas["GET /api/push/chave"] = { status: 200, corpo: { ligado: true, chave: CHAVE } }; respostas["POST /api/push/subscribe"] = { status: 201, corpo: { ok: true } }; });

  it("a mesma chave? compara a chave com que o navegador se inscreveu", async () => {
    const { mesmaChave, bytesParaBase64Url } = await import("@/lib/push");
    expect(bytesParaBase64Url(bytes(CHAVE))).toBe(CHAVE);
    expect(bytesParaBase64Url(null)).toBeNull();
    expect(mesmaChave({ options: { applicationServerKey: bytes(CHAVE).buffer } }, CHAVE)).toBe(true);
    expect(mesmaChave({ options: { applicationServerKey: bytes(OUTRA).buffer } }, CHAVE)).toBe(false);
    expect(mesmaChave({ options: {} }, CHAVE)).toBe(false);
    expect(mesmaChave(null, CHAVE)).toBe(false);
  });

  it("com a permissão dada e inscrição de OUTRA chave: cancela, inscreve de novo com a atual (sem pedir permissão) e grava com a chave", async () => {
    const nav = navegador({ permissao: "granted", chaveDaInscricao: OUTRA });
    const { sincronizarAparelho } = await import("@/lib/push");
    expect(await sincronizarAparelho()).toBe("sincronizado");
    expect([nav.cancelou, nav.novas, nav.inscrita]).toEqual([1, 1, CHAVE]);
    expect((window as any).Notification.requestPermission).not.toHaveBeenCalled();
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect([post.url, post.corpo.chave, post.corpo.endpoint]).toEqual(["/api/push/subscribe", CHAVE, `https://fcm.googleapis.com/fcm/send/aparelho-${CHAVE.slice(0, 6)}`]);
  });

  it("inscrição já com a chave atual: só regrava no servidor (devolve a que ele apagou)", async () => {
    const nav = navegador({ permissao: "granted", chaveDaInscricao: CHAVE });
    const { sincronizarAparelho } = await import("@/lib/push");
    expect(await sincronizarAparelho()).toBe("sincronizado");
    expect([nav.cancelou, nav.novas]).toEqual([0, 0]);
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(1);
  });

  it("sem a permissão dada: nada (só o botão Ativar pede); servidor sem chave: nada", async () => {
    navegador({ permissao: "default", chaveDaInscricao: null });
    const { sincronizarAparelho } = await import("@/lib/push");
    expect(await sincronizarAparelho()).toBe("sem-permissao");
    expect(chamadas).toEqual([]);
    navegador({ permissao: "granted", chaveDaInscricao: CHAVE });
    respostas["GET /api/push/chave"] = { status: 200, corpo: { ligado: false } };
    expect(await sincronizarAparelho()).toBe("desligado");
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
  });

  it("o servidor recusa (409 reinscrever): devolve 'falhou' (a próxima abertura tenta de novo)", async () => {
    navegador({ permissao: "granted", chaveDaInscricao: CHAVE });
    respostas["POST /api/push/subscribe"] = { status: 409, corpo: { reinscrever: true } };
    const { sincronizarAparelho } = await import("@/lib/push");
    expect(await sincronizarAparelho()).toBe("falhou");
  });

  it("o estado 'ativo' só com a chave atual (a de outra chave aparece como inativa, para ativar de novo)", async () => {
    navegador({ permissao: "granted", chaveDaInscricao: OUTRA });
    const { estadoDoAparelho } = await import("@/lib/push");
    expect((await estadoDoAparelho()).situacao).toBe("inativo");
    navegador({ permissao: "granted", chaveDaInscricao: CHAVE });
    expect((await estadoDoAparelho()).situacao).toBe("ativo");
  });

  it("SincronizarPush roda uma vez por aba", async () => {
    navegador({ permissao: "granted", chaveDaInscricao: CHAVE });
    const { SincronizarPush } = await import("@/components/push/sincronizar-push");
    await montar(createElement(SincronizarPush));
    await esperar(); await esperar();
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(1);
    act(() => root!.unmount()); root = undefined;
    await montar(createElement(SincronizarPush));
    await esperar();
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(1);
  });
});

describe("o convite do escritório", () => {
  beforeEach(() => { respostas["GET /api/push/chave"] = { status: 200, corpo: { ligado: true, chave: CHAVE } }; respostas["POST /api/push/subscribe"] = { status: 201, corpo: { ok: true } }; });

  it("aparece para quem ainda não ativou neste computador; Ativar pede a permissão, inscreve e confirma", async () => {
    navegador({ permissao: "default", chaveDaInscricao: null });
    (window as any).Notification.requestPermission = vi.fn(async () => { (window as any).Notification.permission = "granted"; return "granted"; });
    const { ConviteNotificacoes } = await import("@/components/push/convite-notificacoes");
    await montar(createElement(ConviteNotificacoes));
    await esperar();
    expect($("[data-convite-push]")).toBeTruthy();
    await act(async () => { $("[data-convite-push-ativar]")!.click(); });
    await esperar(); await esperar();
    expect((window as any).Notification.requestPermission).toHaveBeenCalled();
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo.chave).toBe(CHAVE);
    expect(txt($("[data-convite-push-ok]"))).toBe("Notificações ativadas neste computador.");
  });

  it("'Agora não' some e não volta por 14 dias; já ativo ou push desligado: não aparece", async () => {
    navegador({ permissao: "default", chaveDaInscricao: null });
    const { ConviteNotificacoes } = await import("@/components/push/convite-notificacoes");
    await montar(createElement(ConviteNotificacoes));
    await esperar();
    await act(async () => { $("[data-convite-push-adiar]")!.click(); });
    expect($("[data-convite-push]")).toBeNull();
    act(() => root!.unmount()); root = undefined;
    await montar(createElement(ConviteNotificacoes));
    await esperar();
    expect($("[data-convite-push]")).toBeNull();
    localStorage.clear();
    act(() => root!.unmount()); root = undefined;
    navegador({ permissao: "granted", chaveDaInscricao: CHAVE });
    await montar(createElement(ConviteNotificacoes));
    await esperar();
    expect($("[data-convite-push]")).toBeNull();
    act(() => root!.unmount()); root = undefined;
    respostas["GET /api/push/chave"] = { status: 200, corpo: { ligado: false } };
    navegador({ permissao: "default", chaveDaInscricao: null });
    await montar(createElement(ConviteNotificacoes));
    await esperar();
    expect($("[data-convite-push]")).toBeNull();
  });
});
