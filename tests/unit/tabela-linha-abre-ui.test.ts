// @vitest-environment happy-dom
/**
 * TabelaPro — a LINHA INTEIRA abre o registro (componente montado de verdade):
 *  - a linha com `href` tem cursor de link, entra no Tab e anuncia o destino (data-abrir); sem `href` nada disso;
 *  - clique em qualquer célula comum abre (roteador); no checkbox, no botão de ações, no link do número, não;
 *  - Ctrl/⌘ + clique e o botão do meio abrem em nova aba (window.open), sem navegar aqui;
 *  - Enter com o foco na linha abre; Enter num campo dentro dela não;
 *  - texto selecionado: não abre;
 *  - sem o roteador do Next em volta (fora do App Router) cai no window.location.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), comRoteador: true }));
vi.mock("next/navigation", () => ({
  useRouter: () => { if (!nav.comRoteador) throw new Error("invariant expected app router to be mounted"); return { push: nav.push, refresh: () => {}, replace: () => {}, back: () => {} }; },
  usePathname: () => "/lista", useSearchParams: () => new URLSearchParams(""),
}));

let root: Root, caixa: HTMLDivElement;
const abertas: string[] = [];
beforeEach(() => {
  nav.push.mockClear(); nav.comRoteador = true; abertas.length = 0;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valor: null }), { status: 200, headers: { "Content-Type": "application/json" } })));
  vi.stubGlobal("open", vi.fn((url: string) => { abertas.push(url); return null; }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const esperar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const COLUNAS = [
  { id: "sel", titulo: "Selecionar", fixa: true, largura: 36 },
  { id: "codigo", titulo: "Código", largura: 100, obrigatoria: true },
  { id: "nome", titulo: "Nome", obrigatoria: true },
  { id: "acoes", titulo: "Ações", fixa: true, largura: 40, semTitulo: true },
];
const cliques: string[] = [];
const LINHAS = [
  { id: "a", href: "/registros/a", celulas: {
    sel: createElement("input", { type: "checkbox", "aria-label": "Selecionar A", onChange: () => cliques.push("checkbox") }),
    codigo: createElement("a", { href: "/registros/a", onClick: (e: Event) => { e.preventDefault(); cliques.push("link"); } }, "A-1"),
    nome: createElement("span", { className: "nome" }, createElement("b", null, "Registro A"), createElement("input", { type: "text", "aria-label": "campo", defaultValue: "" })),
    acoes: createElement("button", { type: "button", onClick: () => cliques.push("acao") }, "⋮"),
  } },
  { id: "b", celulas: { sel: null, codigo: "B-1", nome: "Registro B (só leitura)", acoes: null } },
];

async function montar() {
  const { TabelaPro } = await import("@/components/listagem/tabela-pro");
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(TabelaPro, { tela: "teste-abre", colunas: COLUNAS, linhas: LINHAS } as any)); });
  await esperar();
}
const tr = (id: string) => $(`tr[data-linha="${id}"]`)!;
const celula = (id: string, col: string) => $(`tr[data-linha="${id}"] td[data-celula="${col}"]`)!;
const clicar = async (el: Element, init: MouseEventInit = {}) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })); }); };

describe("TabelaPro — a linha inteira abre o registro", () => {
  it("a linha com href: cursor de link, entra no Tab, anuncia o destino; a linha sem href não", async () => {
    await montar();
    expect(tr("a").getAttribute("data-abrir")).toBe("/registros/a");
    expect(tr("a").getAttribute("tabindex")).toBe("0");
    expect(tr("a").className).toContain("cursor-pointer");
    expect(tr("a").className).toContain("focus-visible:ring");
    expect(tr("b").getAttribute("data-abrir")).toBeNull();
    expect(tr("b").hasAttribute("tabindex")).toBe(false);
    expect(tr("b").className).not.toContain("cursor-pointer");
    // as colunas fixas ficam marcadas para a regra do clique
    expect(celula("a", "sel").hasAttribute("data-fixa")).toBe(true);
    expect(celula("a", "acoes").hasAttribute("data-fixa")).toBe(true);
    expect(celula("a", "nome").hasAttribute("data-fixa")).toBe(false);
  });

  it("clique numa célula comum (ou no texto dentro dela) abre pelo roteador; a linha sem href não faz nada", async () => {
    await montar();
    await clicar(celula("a", "nome"));
    expect(nav.push).toHaveBeenCalledWith("/registros/a");
    nav.push.mockClear();
    await clicar(celula("a", "nome").querySelector("b")!);
    expect(nav.push).toHaveBeenCalledTimes(1);
    nav.push.mockClear();
    await clicar(celula("b", "nome"));
    expect(nav.push).not.toHaveBeenCalled();
    expect(abertas).toEqual([]);
  });

  it("o checkbox, o botão de ações, o link do número e um campo dentro da linha fazem o que fazem — e NÃO abrem", async () => {
    await montar();
    cliques.length = 0;
    await act(async () => { (celula("a", "sel").querySelector("input") as HTMLInputElement).click(); });
    await clicar(celula("a", "acoes").querySelector("button")!);
    await clicar(celula("a", "codigo").querySelector("a")!);
    await clicar(celula("a", "nome").querySelector("input")!);
    // o espaço vazio da coluna fixa também não abre
    await clicar(celula("a", "sel"));
    await clicar(celula("a", "acoes"));
    expect(cliques).toEqual(["checkbox", "acao", "link"]);
    expect(nav.push).not.toHaveBeenCalled();
    expect(abertas).toEqual([]);
  });

  it("Ctrl/⌘ + clique e o botão do meio abrem em NOVA aba, sem navegar aqui; botão direito não abre", async () => {
    await montar();
    await clicar(celula("a", "nome"), { ctrlKey: true });
    await clicar(celula("a", "nome"), { metaKey: true });
    await act(async () => { celula("a", "nome").dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })); });
    expect(abertas).toEqual(["/registros/a", "/registros/a", "/registros/a"]);
    expect(nav.push).not.toHaveBeenCalled();
    await clicar(celula("a", "nome"), { button: 2 });
    // o botão direito também chega como auxclick: é o menu de contexto, não abre
    await act(async () => { celula("a", "nome").dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 })); });
    await act(async () => { celula("a", "acoes").dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })); });
    expect(abertas).toHaveLength(3);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("teclado: Enter com o foco na linha abre (Ctrl+Enter em nova aba); Enter num campo dentro dela é do campo", async () => {
    await montar();
    const linha = tr("a");
    linha.focus();
    expect(document.activeElement).toBe(linha);
    await act(async () => { linha.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(nav.push).toHaveBeenCalledWith("/registros/a");
    nav.push.mockClear();
    await act(async () => { linha.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(abertas).toEqual(["/registros/a"]);
    expect(nav.push).not.toHaveBeenCalled();
    const campo = celula("a", "nome").querySelector("input")!;
    await act(async () => { campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await act(async () => { linha.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("texto selecionado na página (a pessoa estava copiando): o clique não abre", async () => {
    await montar();
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Registro" } as Selection);
    await clicar(celula("a", "nome"));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("fora do App Router (sem roteador) a linha ainda abre, pelo window.location", async () => {
    nav.comRoteador = false;
    await montar();
    const assign = vi.fn();
    const { abrirRegistro } = await import("@/components/listagem/tabela-pro");
    vi.spyOn(window, "location", "get").mockReturnValue({ assign } as unknown as Location);
    abrirRegistro("/registros/a", "mesma-aba", null);
    expect(assign).toHaveBeenCalledWith("/registros/a");
    await clicar(celula("a", "nome"));
    expect(assign).toHaveBeenCalledTimes(2);
    expect(nav.push).not.toHaveBeenCalled();
  });
});
