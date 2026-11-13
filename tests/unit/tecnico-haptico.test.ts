// @vitest-environment happy-dom
/**
 * App do técnico — vibração leve (haptic) ao tocar na barra inferior (Meu dia · Agenda · Perfil):
 *  - um pulso curtinho (10 ms) por toque, via navigator.vibrate (Android);
 *  - onde o navegador não suporta (iPhone: o WebKit não tem vibração pela web), é um NO-OP silencioso:
 *    nada quebra, nenhum erro, a navegação segue igual;
 *  - o código já tem o encaixe do haptic NATIVO para quando o app for empacotado (Capacitor).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { PULSO_TOQUE_MS, registrarHapticoNativo, toqueLeve } from "@/lib/haptico";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/perfil/perfil-client", () => ({ PerfilClient: () => null }));

/** Liga/desliga o suporte do "navegador" à vibração */
function navegador(vibrate: unknown) {
  if (vibrate === undefined) delete (window.navigator as any).vibrate;
  else Object.defineProperty(window.navigator, "vibrate", { configurable: true, writable: true, value: vibrate });
}
const errosNaoTratados: unknown[] = [];
const aoRejeitar = (e: PromiseRejectionEvent | { reason: unknown }) => { errosNaoTratados.push((e as { reason: unknown }).reason); };

beforeEach(() => { errosNaoTratados.length = 0; registrarHapticoNativo(null); delete (globalThis as any).Capacitor; process.on("unhandledRejection", aoRejeitar as never); });
afterEach(() => { navegador(undefined); registrarHapticoNativo(null); delete (globalThis as any).Capacitor; process.off("unhandledRejection", aoRejeitar as never); vi.restoreAllMocks(); });

describe("toqueLeve: o pulso", () => {
  it("é curtinho — 10 ms — e usa navigator.vibrate quando o navegador tem", () => {
    const vibrate = vi.fn(() => true); navegador(vibrate);
    expect(PULSO_TOQUE_MS).toBe(10);
    toqueLeve();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("navegador SEM vibração (iPhone/WebKit, desktop): não faz nada e não lança", () => {
    navegador(undefined);
    expect("vibrate" in window.navigator).toBe(false);
    expect(() => toqueLeve()).not.toThrow();
    navegador(null); // propriedade existe mas não é função
    expect(() => toqueLeve()).not.toThrow();
  });

  it("vibração bloqueada ou com erro no navegador: engole em silêncio (nem erro, nem aviso no console)", () => {
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    navegador(() => { throw new DOMException("bloqueado", "NotAllowedError"); });
    expect(() => toqueLeve()).not.toThrow();
    navegador(() => false); // o navegador recusou (ex.: sem interação do usuário)
    expect(() => toqueLeve()).not.toThrow();
    expect(console_).not.toHaveBeenCalled();
    expect(aviso).not.toHaveBeenCalled();
  });

  it("sem `navigator` (render no servidor): também é no-op", () => {
    vi.stubGlobal("navigator", undefined);
    try { expect(() => toqueLeve()).not.toThrow(); } finally { vi.unstubAllGlobals(); }
  });
});

describe("pronto para o haptic nativo (app de loja / Capacitor)", () => {
  it("haptic nativo registrado tem prioridade: usa o nativo e NÃO a vibração da web", () => {
    const vibrate = vi.fn(); navegador(vibrate);
    const nativo = vi.fn();
    registrarHapticoNativo(nativo);
    toqueLeve();
    expect(nativo).toHaveBeenCalledTimes(1);
    expect(vibrate).not.toHaveBeenCalled();
    registrarHapticoNativo(null); // desregistrado: volta à web
    toqueLeve();
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("dentro do app nativo com o plugin de Haptics do Capacitor: impacto LEVE, sem precisar registrar nada", () => {
    const vibrate = vi.fn(); navegador(vibrate);
    const impact = vi.fn(async () => undefined);
    (globalThis as any).Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { impact } } };
    toqueLeve();
    expect(impact).toHaveBeenCalledWith({ style: "LIGHT" });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("Capacitor presente mas rodando na WEB (ou sem o plugin): continua na vibração da web", () => {
    const vibrate = vi.fn(); navegador(vibrate);
    const impact = vi.fn();
    (globalThis as any).Capacitor = { isNativePlatform: () => false, Plugins: { Haptics: { impact } } };
    toqueLeve();
    (globalThis as any).Capacitor = { isNativePlatform: () => true, Plugins: {} };
    toqueLeve();
    expect(impact).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("falha do lado nativo (na hora ou depois, numa promessa): nunca chega à tela", async () => {
    registrarHapticoNativo(() => { throw new Error("plugin ausente"); });
    expect(() => toqueLeve()).not.toThrow();
    registrarHapticoNativo(() => Promise.reject(new Error("aparelho sem motor de vibração")));
    expect(() => toqueLeve()).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(errosNaoTratados).toEqual([]);
  });
});

/* ───────── a barra inferior do app ───────── */
describe("barra inferior do app: Meu dia · Agenda · Perfil", () => {
  let root: Root; let caixa: HTMLDivElement;
  const perfilInicial = { nome: "João Silva", email: "joao@clima.com", avatar: null, empresaNome: "Clima Total", perfilNome: null, cargo: "Técnico" };
  const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
  const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
  async function esperarAte(cond: () => boolean, msg: string) { for (let i = 0; i < 120; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
  const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
  const nav = (ver: string) => $<HTMLButtonElement>(`[data-nav="${ver}"]`)!;
  const tocar = async (ver: string) => { await act(async () => { nav(ver).click(); }); await esperar(); };
  const vista = () => $("[data-vista]")?.getAttribute("data-vista");

  beforeAll(async () => { await import("@/components/tecnico/app-tecnico"); }, 120_000);
  beforeEach(async () => {
    (globalThis as any).indexedDB = new IDBFactory();
    // Servidor simulado: "Meu dia" e "Agenda" vazios (cada um no seu formato)
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      JSON.stringify(String(url).includes("/agenda") ? { tecnico: null, dias: [] } : { tecnico: null, dia: "2026-12-05", atividades: [], anteriores: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
  });
  afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); document.body.innerHTML = ""; root = undefined as unknown as Root; vi.unstubAllGlobals(); });

  async function abrirApp(usuario: Record<string, unknown> = USUARIO, endereco = "/tecnico") {
    window.history.replaceState(null, "", endereco);
    const { AppTecnico } = await import("@/components/tecnico/app-tecnico");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(AppTecnico, { usuario: usuario as any, config: CONFIG_APP_PADRAO, perfilInicial })); });
    await esperarAte(() => !!$("[data-nav]"), "app carregado");
  }

  it("'Desempenho' só entra na barra de quem PARTICIPA do Desempenho (antes do Perfil); os outros continuam com três botões", async () => {
    const botoes = () => [...document.body.querySelectorAll("[data-nav]")].map((b) => b.getAttribute("data-nav"));
    await abrirApp();
    expect(botoes()).toEqual(["dia", "agenda", "perfil"]);
    expect(nav("dia").parentElement!.className).toContain("grid-cols-3");
    act(() => root.unmount()); caixa.remove();
    await abrirApp({ ...USUARIO, desempenho: true });
    expect(botoes()).toEqual(["dia", "agenda", "desempenho", "perfil"]);
    expect(nav("dia").parentElement!.className).toContain("grid-cols-4");
    expect(nav("desempenho").textContent).toBe("Desempenho");
    expect(nav("desempenho").className).toContain("touch-target");
    await tocar("desempenho");
    expect(window.location.search).toBe("?ver=desempenho");
    expect(nav("desempenho").getAttribute("aria-current")).toBe("page");
    await esperarAte(() => !!$("[data-desempenho-tecnico]"), "vista Desempenho");
    expect((globalThis.fetch as any).mock.calls.some(([u]: [string]) => String(u).startsWith("/api/tecnico/desempenho?mes="))).toBe(true);
  });

  it("cada toque dá UM pulso de 10 ms e leva à vista — nos três botões, com alvo de 44 px", async () => {
    const vibrate = vi.fn(() => true); navegador(vibrate);
    await abrirApp();
    expect(vibrate).not.toHaveBeenCalled(); // abrir o app não vibra: só o toque
    for (const [ver, esperada, busca] of [["agenda", "agenda", "?ver=agenda"], ["perfil", "perfil", "?ver=perfil"], ["dia", "dia", ""]] as const) {
      vibrate.mockClear();
      expect(nav(ver).className).toContain("touch-target");
      await tocar(ver);
      expect(vibrate.mock.calls, ver).toEqual([[10]]);
      await esperarAte(() => vista() === esperada, `vista ${esperada}`);
      expect(window.location.search).toBe(busca);
      expect(nav(ver).getAttribute("aria-current")).toBe("page");
    }
  });

  it("tocar na aba em que já se está também responde ao dedo (um pulso), sem mudar de vista", async () => {
    const vibrate = vi.fn(() => true); navegador(vibrate);
    await abrirApp();
    await tocar("dia");
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vista()).toBe("dia");
  });

  it("navegador sem vibração (iPhone): a barra funciona igual, sem erro", async () => {
    navegador(undefined);
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    await abrirApp();
    await tocar("perfil");
    await esperarAte(() => vista() === "perfil", "perfil");
    await tocar("agenda");
    await esperarAte(() => vista() === "agenda", "agenda");
    expect(erros).not.toHaveBeenCalled();
  });

  it("vibração que lança erro no navegador: o toque ainda navega", async () => {
    navegador(() => { throw new Error("bloqueado"); });
    await abrirApp();
    await tocar("perfil");
    await esperarAte(() => vista() === "perfil", "perfil");
  });

  it("só a barra inferior vibra: o atalho do topo (foto → Perfil) não", async () => {
    const vibrate = vi.fn(() => true); navegador(vibrate);
    await abrirApp();
    await act(async () => { $<HTMLButtonElement>("[data-avatar-topo]")!.click(); });
    await esperarAte(() => vista() === "perfil", "perfil");
    expect(vibrate).not.toHaveBeenCalled();
  });
});
