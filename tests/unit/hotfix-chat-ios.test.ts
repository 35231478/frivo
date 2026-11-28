// @vitest-environment happy-dom
/**
 * HOTFIX do chat no iPhone (PWA instalado) — o que dá para provar sem o aparelho (a geometria de verdade, com a área do
 * relógio e o teclado simulados, é conferida no Chromium: prints em docs/prints/hotfix-chat-ios):
 *  - o teclado: a área visível encolheu E há campo em foco (zoom e barra do navegador não contam);
 *  - a tela Chat ocupa a área VISÍVEL entre o topo e a barra, medidos (não mais a conta fixa que ignorava o topo do
 *    iPhone); com o teclado aberto a barra inferior some e a conversa encosta no teclado; ao fechar, a barra volta;
 *  - todo balão recebido identifica quem escreveu — o nome só se omite numa sequência IMEDIATA do mesmo autor (a etiqueta
 *    de outra OS ou um intervalo escondiam o nome: o "Opa" sem autor do print).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { areaVisivelDe, ehCampoDeTexto, tecladoAberto, TECLADO_MIN_PX } from "@/lib/tecnico/area-visivel";
import { mostraAutor, SEQUENCIA_MS } from "@/lib/chat/regras";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/perfil/perfil-client", () => ({ PerfilClient: () => null }));

describe("o teclado e a área visível (regra pura)", () => {
  it("teclado aberto: a área visível encolheu mais que o limite E há campo de texto em foco", () => {
    expect(tecladoAberto({ alturaJanela: 844, alturaVisivel: 508, focoEmCampo: true })).toBe(true);
    expect(tecladoAberto({ alturaJanela: 844, alturaVisivel: 508, focoEmCampo: false })).toBe(false); // sem foco: não é teclado
    expect(tecladoAberto({ alturaJanela: 844, alturaVisivel: 844 - TECLADO_MIN_PX, focoEmCampo: true })).toBe(false); // barra do navegador
    expect(tecladoAberto({ alturaJanela: 844, alturaVisivel: 400, escala: 2, focoEmCampo: true })).toBe(false); // zoom de pinça
  });

  it("sem visualViewport (navegador antigo): a altura da janela, sem teclado; com ele: a altura e o deslocamento dele", () => {
    expect(areaVisivelDe({ innerHeight: 800 }, true)).toEqual({ altura: 800, deslocamento: 0, teclado: false });
    expect(areaVisivelDe({ innerHeight: 844, visualViewport: { height: 507.6, offsetTop: 120.4, scale: 1 } }, true)).toEqual({ altura: 508, deslocamento: 120, teclado: true });
  });

  it("campo de texto: textarea, input de texto e editável; caixa de seleção e botão não", () => {
    const el = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild!; };
    expect(ehCampoDeTexto(el("<textarea></textarea>"))).toBe(true);
    expect(ehCampoDeTexto(el("<input type='text'>"))).toBe(true);
    expect(ehCampoDeTexto(el("<input type='checkbox'>"))).toBe(false);
    expect(ehCampoDeTexto(el("<button>Ok</button>"))).toBe(false);
    expect(ehCampoDeTexto(null)).toBe(false);
  });
});

const OS_A = { id: "osA", numero: "OS-0101", cliente: "Mercado Exemplo" };
const OS_B = { id: "osB", numero: "OS-0102", cliente: "Padaria Fictícia" };
const msg = (over: Partial<ComentarioTela>): ComentarioTela => ({
  id: "x", clientId: null, texto: "Oi", autor: "Ana Souza", origem: "ESCRITORIO", criadoEm: "2026-11-12T10:00:00.000Z", meu: false, os: OS_A, ...over,
});

describe("quem escreveu: todo balão recebido identifica o autor", () => {
  const agora = new Date("2026-11-12T15:00:00.000Z");
  it("o nome só se omite numa sequência IMEDIATA do mesmo autor (mesma OS, mesmo dia, até 5 minutos)", () => {
    const a = msg({});
    expect(mostraAutor(msg({ criadoEm: "2026-11-12T10:02:00.000Z" }), a, { comEtiquetaOs: true, agora })).toBe(false);
    // o "Opa" do print: mesmo autor, mas depois da etiqueta de OUTRA OS (ou sem OS)
    expect(mostraAutor(msg({ texto: "Opa", os: null, criadoEm: "2026-11-12T10:03:00.000Z" }), a, { comEtiquetaOs: true, agora })).toBe(true);
    expect(mostraAutor(msg({ os: OS_B, criadoEm: "2026-11-12T10:01:00.000Z" }), a, { comEtiquetaOs: true, agora })).toBe(true);
    // horas depois, na mesma OS
    expect(mostraAutor(msg({ criadoEm: new Date(Date.parse(a.criadoEm) + SEQUENCIA_MS + 1000).toISOString() }), a, { comEtiquetaOs: true, agora })).toBe(true);
    // outra pessoa, outro dia, a anterior minha, ou do app × do escritório
    expect(mostraAutor(msg({ autor: "Carlos Lima" }), a, { agora })).toBe(true);
    expect(mostraAutor(msg({ criadoEm: "2026-11-13T10:00:00.000Z" }), a, { agora })).toBe(true);
    expect(mostraAutor(msg({}), msg({ meu: true }), { agora })).toBe(true);
    expect(mostraAutor(msg({ origem: "APP" }), a, { agora })).toBe(true);
    // a primeira e a minha
    expect(mostraAutor(msg({}), undefined, { agora })).toBe(true);
    expect(mostraAutor(msg({ meu: true }), undefined, { agora })).toBe(false);
  });

  it("na tela: o \"Opa\" depois de outra OS mostra \"Ana Souza · escritório\"; a seguida, logo depois, agrupa", async () => {
    const { ConversaChat } = await import("@/components/chat/conversa");
    const caixa = document.body.appendChild(document.createElement("div"));
    const root = createRoot(caixa);
    const hoje = (h: string) => `${new Date().toISOString().slice(0, 10)}T${h}:00.000Z`;
    const lista = [
      msg({ id: "m1", clientId: "m1", texto: "Pode desobstruir.", criadoEm: hoje("10:00") }),
      msg({ id: "m2", clientId: "m2", texto: "Já autorizei com o síndico.", criadoEm: hoje("10:01") }),
      msg({ id: "m3", clientId: "m3", texto: "Opa", os: null, criadoEm: hoje("10:11") }),
    ];
    await act(async () => { root.render(createElement(ConversaChat, { mensagens: lista, mostrarOs: true, onEnviar: async () => null, urlFoto: () => "" })); });
    const autor = (id: string) => (document.querySelector(`[data-mensagem='${id}'] [data-autor]`)?.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(autor("m1")).toBe("Ana Souza · escritório");
    expect(autor("m2")).toBe(""); // sequência imediata: agrupa
    expect(autor("m3")).toBe("Ana Souza · escritório");
    act(() => root.unmount()); caixa.remove();
  });
});

/* ───────── a tela Chat no app (o PWA instalado): a barra inferior e o teclado ───────── */
describe("a tela Chat entre o topo e a barra; com o teclado, a barra some", () => {
  let root: Root | undefined; let caixa: HTMLDivElement | undefined;
  const perfilInicial = { nome: "João Silva", email: "joao@exemplo.test", avatar: null, empresaNome: "Empresa Exemplo", perfilNome: null, cargo: "Técnico" };
  const USUARIO = { id: "uT", nome: "João Silva", email: "joao@exemplo.test", empresaNome: "Empresa Exemplo", podeGravar: true };
  const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
  async function esperarAte(cond: () => boolean, m: string) { for (let i = 0; i < 200; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${m}`); }
  const $ = (s: string) => document.body.querySelector(s) as HTMLElement | null;

  // O "visualViewport" do iPhone: o teclado encolhe a área visível, não a janela
  class Visivel extends EventTarget { height = 844; offsetTop = 0; scale = 1; width = 390; }
  let vv: Visivel;

  beforeAll(async () => { await import("@/components/tecnico/app-tecnico"); }, 120_000);
  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory();
    vv = new Visivel();
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => vv });
    Object.defineProperty(window, "innerHeight", { configurable: true, get: () => 844 });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      const corpo = u.startsWith("/api/tecnico/conversas/novidades") ? { marca: "1.0.0", mudou: false, naoLidas: 0 }
        : u.startsWith("/api/tecnico/conversas") ? { mensagens: [msg({ id: "m1", clientId: "m1", texto: "Bom dia." })], osDoDia: [], osPadrao: null }
          : u.includes("/agenda") ? { tecnico: null, dias: [] } : { tecnico: null, dia: "2026-11-12", atividades: [], anteriores: [] };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    caixa?.remove(); document.body.innerHTML = ""; root = undefined;
    vi.unstubAllGlobals(); delete (window as any).visualViewport;
  });

  async function abrirChat() {
    window.history.replaceState(null, "", "/tecnico?ver=chat");
    const { AppTecnico } = await import("@/components/tecnico/app-tecnico");
    caixa = document.body.appendChild(document.createElement("div")); root = createRoot(caixa);
    await act(async () => { root!.render(createElement(AppTecnico, { usuario: USUARIO as any, config: CONFIG_APP_PADRAO, perfilInicial })); });
    await esperarAte(() => !!$("[data-chat-conversa]") && !!$("[data-texto-mensagem]"), "a conversa");
  }
  const chat = () => $("[data-chat-conversa]")!;

  it("sem teclado: a conversa é uma camada fixa do tamanho visível, entre o topo e a barra MEDIDOS; a barra aparece", async () => {
    await abrirChat();
    expect(chat().className).toContain("fixed");
    expect(chat().style.top).toBe("calc(var(--tec-topo, 0px) + 0px)");
    expect(chat().style.height).toBe("calc(844px - var(--tec-topo, 0px) - var(--tec-barra, 0px))");
    expect($("[data-barra-app]")).not.toBeNull();
    // o topo e a barra são medidos (nada de conta fixa de 8rem)
    expect(document.documentElement.style.getPropertyValue("--tec-topo")).toMatch(/px$/);
    expect(document.documentElement.style.getPropertyValue("--tec-barra")).toMatch(/px$/);
    expect(chat().className).not.toMatch(/100dvh|8rem/);
  });

  it("teclado aberto: a barra some, a conversa encolhe para a área visível (o campo logo acima do teclado); ao fechar, volta", async () => {
    await abrirChat();
    const campo = $("[data-texto-mensagem]") as HTMLTextAreaElement;
    await act(async () => { campo.focus(); vv.height = 508; vv.offsetTop = 0; vv.dispatchEvent(new Event("resize")); });
    await esperar();
    expect($("[data-barra-app]")).toBeNull();
    expect(chat().getAttribute("data-teclado")).toBe("true");
    expect(chat().style.height).toBe("calc(508px - var(--tec-topo, 0px) - var(--tec-barra, 0px))");
    expect(document.documentElement.style.getPropertyValue("--tec-barra")).toBe("0px");
    // o iPhone rola a página ao abrir o teclado: a conversa acompanha a área visível
    await act(async () => { vv.offsetTop = 90; vv.dispatchEvent(new Event("scroll")); });
    await esperar();
    expect(chat().style.top).toBe("calc(var(--tec-topo, 0px) + 90px)");
    // fechou o teclado
    await act(async () => { campo.blur(); vv.height = 844; vv.offsetTop = 0; vv.dispatchEvent(new Event("resize")); });
    await esperar();
    expect($("[data-barra-app]")).not.toBeNull();
    expect(chat().hasAttribute("data-teclado")).toBe(false);
  });

  it("as outras telas também terminam acima da barra (o fim da página usa a altura medida dela)", async () => {
    await abrirChat();
    expect(($("main") as HTMLElement).style.paddingBottom).toBe("calc(var(--tec-barra, 6rem) + 1rem)");
  });
});
