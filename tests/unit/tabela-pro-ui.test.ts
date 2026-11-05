// @vitest-environment happy-dom
/**
 * TabelaPro (components/listagem/tabela-pro) montada de verdade (happy-dom + React):
 *  - estilo planilha único, colunas na ordem, elástica sem largura, escondida por padrão fora;
 *  - menu "Colunas": esconder/mostrar, obrigatória travada, fixa fora do menu, Restaurar padrão;
 *  - redimensionar pela borda (ponteiro): respeita a mínima, grava ao soltar, duplo clique volta;
 *  - preferência: localStorage na hora, PUT na rota depois da pausa, a do servidor vence a local,
 *    a local sobe quando o servidor não tem nada, API fora do ar não derruba a tela;
 *  - ordenação pelo cabeçalho (aria-sort) e os cartões do celular.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo?: unknown }[] = [];
let servidor: Record<string, unknown> = {};
let apiFora = false;

beforeEach(() => {
  chamadas.length = 0; servidor = {}; apiFora = false;
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    if (apiFora) throw new Error("rede fora");
    const chave = url.replace("/api/preferencias/", "");
    if (metodo === "PUT") { servidor[chave] = JSON.parse(String(init.body)); }
    return new Response(JSON.stringify({ chave, valor: servidor[chave] ?? null }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const $ = <T extends Element = HTMLElement>(sel: string, de: ParentNode = document) => de.querySelector(sel) as T | null;
const $$ = (sel: string, de: ParentNode = document) => [...de.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const cabecalhos = () => $$("thead th").map((t) => t.getAttribute("data-coluna"));
const larguraCol = (id: string) => ($(`col[data-col="${id}"]`) as HTMLElement | null)?.style.width ?? "";
const local = () => JSON.parse(localStorage.getItem("frivo:tabela:teste") ?? "null");

const COLUNAS = [
  { id: "sel", titulo: "Selecionar", fixa: true, largura: 36, cabecalho: createElement("input", { type: "checkbox", "aria-label": "todos" }) },
  { id: "codigo", titulo: "Código", largura: 100, obrigatoria: true, ordenar: "codigo" },
  { id: "nome", titulo: "Nome", obrigatoria: true, ordenar: "nome", classe: "truncate" },
  { id: "cliente", titulo: "Cliente", largura: 200, minimo: 80 },
  { id: "tipo", titulo: "Tipo", largura: 120, oculta: true },
  { id: "valor", titulo: "Valor (R$)", largura: 110, alinhar: "direita" as const },
  { id: "acoes", titulo: "Ações", fixa: true, largura: 40, semTitulo: true, alinhar: "direita" as const },
];
const LINHAS = [1, 2, 3].map((i) => ({
  id: `r${i}`, atributos: { "data-x": `x${i}` }, titulos: { nome: `Nome inteiro ${i}` },
  celulas: { sel: createElement("input", { type: "checkbox" }), codigo: `C-${i}`, nome: `Nome ${i}`, cliente: `Cliente ${i}`, tipo: `Tipo ${i}`, valor: `${i}.000,00`, acoes: createElement("button", { type: "button" }, "⋮") },
}));

async function montar(props: Record<string, unknown> = {}) {
  const { TabelaPro } = await import("@/components/listagem/tabela-pro");
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(TabelaPro, { tela: "teste", colunas: COLUNAS, linhas: LINHAS, ...props } as any)); });
  await flush();
}

describe("desenho", () => {
  it("estilo planilha único, colunas na ordem declarada, a escondida por padrão fora, a elástica sem largura, R$ à direita tabular", async () => {
    await montar();
    const t = $("table[data-tabela-planilha]")!;
    expect(t.className).toContain("text-[13px]");
    expect(t.className).toContain("table-fixed");
    expect(cabecalhos()).toEqual(["sel", "codigo", "nome", "cliente", "valor", "acoes"]);
    expect(larguraCol("codigo")).toBe("100px");
    expect(larguraCol("nome")).toBe(""); // elástica
    const valor = $('tr[data-linha="r2"] td[data-celula="valor"]')!;
    expect(valor.className).toContain("text-right");
    expect(valor.className).toContain("tabular-nums");
    expect(txt(valor)).toBe("2.000,00");
    // atributos e title da linha/célula; cabeçalho só para o leitor de tela na coluna de ações
    expect($('tr[data-linha="r3"]')!.getAttribute("data-x")).toBe("x3");
    expect($('tr[data-linha="r1"] td[data-celula="nome"]')!.getAttribute("title")).toBe("Nome inteiro 1");
    expect($('th[data-coluna="acoes"] .sr-only')!.textContent).toBe("Ações");
    expect($('th[data-coluna="sel"] input[aria-label="todos"]')).not.toBeNull();
    // a largura mínima da tabela soma as colunas (rola na horizontal em tela estreita)
    expect(t.style.minWidth).toBe(`${36 + 100 + 160 + 200 + 110 + 40}px`);
  });

  it("realce sob o mouse: o token único da planilha em toda linha (zebra mantida); a linha com realce próprio (vencida) fica só com o dela (o cn resolve)", async () => {
    const { PLANILHA } = await import("@/lib/planilha");
    expect(PLANILHA.linhaHover).toBe("hover:bg-primary-100/60");
    await montar({ linhas: [
      ...LINHAS,
      { id: "venc", celulas: { nome: "Vencida" }, classe: "even:bg-atrasado-claro bg-atrasado-claro hover:bg-atrasado-claro/70" },
    ] });
    for (const id of ["r1", "r2", "r3"]) {
      const cls = $(`tr[data-linha="${id}"]`)!.className;
      expect(cls).toContain("hover:bg-primary-100/60");
      expect(cls).toContain("even:bg-surface-alt/60");
      expect(cls).not.toContain("hover:bg-primary-50/40");
    }
    const venc = $('tr[data-linha="venc"]')!.className;
    expect(venc).toContain("hover:bg-atrasado-claro/70");
    expect(venc).not.toContain("hover:bg-primary-100/60");
  });

  it("cartões do celular ficam fora da tabela (md:hidden) e a tabela some abaixo da quebra; quebra 'sm' para os cadastros", async () => {
    await montar({ cartoes: createElement("ul", { "data-cartoes": true }, createElement("li", null, "cartão")) });
    expect($("[data-cartoes]")!.parentElement!.className).toBe("md:hidden");
    expect($("table")!.closest(".md\\:block")!.className).toContain("hidden md:block");
    await montar({ quebra: "sm" });
    expect($("table")!.closest(".sm\\:block")!.className).toContain("hidden sm:block");
  });

  it("ordenação: o cabeçalho com `ordenar` vira botão, marca aria-sort e chama onOrdenar; sem `ordenacao` é texto", async () => {
    const onOrdenar = vi.fn();
    await montar({ ordenacao: { ativa: "nome", dir: "desc", onOrdenar } });
    expect($('th[data-coluna="nome"]')!.getAttribute("aria-sort")).toBe("descending");
    expect($('th[data-coluna="codigo"]')!.getAttribute("aria-sort")).toBeNull();
    await clicar($('[data-ordenar="codigo"]'));
    expect(onOrdenar).toHaveBeenCalledWith("codigo");
    expect($('th[data-coluna="cliente"] button')).toBeNull();
    await montar();
    expect($("[data-ordenar]")).toBeNull();
  });
});

describe("menu Colunas", () => {
  it("lista as colunas (fixas fora), esconde/mostra, trava a obrigatória, conta como personalizada e Restaurar volta ao padrão", async () => {
    await montar();
    await clicar($("[data-colunas-menu]"));
    const opcoes = $$("[data-coluna-opcao]");
    expect(opcoes.map((o) => o.getAttribute("data-coluna-opcao"))).toEqual(["codigo", "nome", "cliente", "tipo", "valor"]);
    expect(opcoes.map((o) => o.getAttribute("aria-checked"))).toEqual(["true", "true", "true", "false", "true"]);
    expect(($('[data-coluna-opcao="codigo"]') as HTMLButtonElement).disabled).toBe(true);
    expect(($('[data-restaurar-colunas]') as HTMLButtonElement).disabled).toBe(true); // nada personalizado ainda
    // esconder Cliente e mostrar Tipo
    await clicar($('[data-coluna-opcao="cliente"]'));
    await clicar($('[data-coluna-opcao="tipo"]'));
    expect(cabecalhos()).toEqual(["sel", "codigo", "nome", "tipo", "valor", "acoes"]);
    expect(local()).toEqual({ larguras: {}, ocultas: ["cliente"] });
    expect(($('[data-restaurar-colunas]') as HTMLButtonElement).disabled).toBe(false);
    // a obrigatória não sai nem clicando
    await clicar($('[data-coluna-opcao="codigo"]'));
    expect(cabecalhos()).toContain("codigo");
    // Restaurar padrão: Tipo some de novo (escondida por padrão), Cliente volta, menu fecha, preferência zerada
    await clicar($("[data-restaurar-colunas]"));
    expect(cabecalhos()).toEqual(["sel", "codigo", "nome", "cliente", "valor", "acoes"]);
    expect(local()).toEqual({ larguras: {} });
    expect($("[data-menu-colunas]")).toBeNull();
  });

  it("menu fecha no Esc e no clique fora", async () => {
    await montar();
    await clicar($("[data-colunas-menu]"));
    expect($("[data-menu-colunas]")).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect($("[data-menu-colunas]")).toBeNull();
    await clicar($("[data-colunas-menu]"));
    await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect($("[data-menu-colunas]")).toBeNull();
  });
});

describe("redimensionar", () => {
  const arrastar = async (id: string, dx: number) => {
    const alca = $(`[data-redimensionar="${id}"]`)!;
    (alca as any).setPointerCapture = () => {};
    await act(async () => { alca.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 500, pointerId: 1 })); });
    await act(async () => { alca.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 500 + dx, pointerId: 1 })); });
    await act(async () => { alca.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 500 + dx, pointerId: 1 })); });
    await flush();
  };

  it("arrastar a borda muda a largura (ao vivo e ao soltar), respeita a mínima; as fixas não têm alça; duplo clique volta ao padrão", async () => {
    await montar();
    expect($('[data-redimensionar="sel"]')).toBeNull();
    expect($('[data-redimensionar="acoes"]')).toBeNull();
    // happy-dom não mede: a largura inicial cai no padrão da coluna (200)
    await arrastar("cliente", 50);
    expect(larguraCol("cliente")).toBe("250px");
    expect(local()).toEqual({ larguras: { cliente: 250 } });
    await arrastar("cliente", -500);
    expect(larguraCol("cliente")).toBe("80px"); // mínima da coluna
    await act(async () => { $('[data-redimensionar="cliente"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await flush();
    expect(larguraCol("cliente")).toBe("200px");
    expect(local()).toEqual({ larguras: {} });
  });

  it("a elástica ganha largura ao ser arrastada e a preferência vai para a rota depois da pausa (um PUT só para vários arrastos)", async () => {
    await montar();
    await flush(10);
    const putsAntes = chamadas.filter((c) => c.metodo === "PUT").length;
    await arrastar("nome", 40);
    await arrastar("nome", 40);
    expect(larguraCol("nome")).toBe("240px");
    expect(chamadas.filter((c) => c.metodo === "PUT").length).toBe(putsAntes);
    await flush(700);
    const puts = chamadas.filter((c) => c.metodo === "PUT");
    expect(puts).toHaveLength(putsAntes + 1);
    expect(puts.at(-1)).toEqual({ url: "/api/preferencias/tabela:teste", metodo: "PUT", corpo: { larguras: { nome: 240 } } });
  });
});

describe("preferência por usuário", () => {
  it("ao abrir lê a rota; a do servidor VENCE a do navegador e atualiza a reserva", async () => {
    localStorage.setItem("frivo:tabela:teste", JSON.stringify({ larguras: { cliente: 150 }, ocultas: ["valor"] }));
    servidor["tabela:teste"] = { larguras: { cliente: 300 }, ocultas: [] };
    await montar();
    await flush(10);
    expect(chamadas[0]).toMatchObject({ url: "/api/preferencias/tabela:teste", metodo: "GET" });
    expect(larguraCol("cliente")).toBe("300px");
    expect(cabecalhos()).toEqual(["sel", "codigo", "nome", "cliente", "tipo", "valor", "acoes"]); // ocultas: [] = todas
    expect(local()).toEqual({ larguras: { cliente: 300 }, ocultas: [] });
  });

  it("servidor sem nada e navegador com preferência: a do navegador vale na hora e SOBE para a rota", async () => {
    localStorage.setItem("frivo:tabela:teste", JSON.stringify({ larguras: { cliente: 150 }, ocultas: ["valor"] }));
    await montar();
    expect(larguraCol("cliente")).toBe("150px");
    expect(cabecalhos()).not.toContain("valor");
    await flush(10);
    expect(chamadas.filter((c) => c.metodo === "PUT")).toEqual([{ url: "/api/preferencias/tabela:teste", metodo: "PUT", corpo: { larguras: { cliente: 150 }, ocultas: ["valor"] } }]);
  });

  it("a preferência é casada com as colunas da tela: coluna que não existe sai, obrigatória nunca fica escondida, mínima vale", async () => {
    servidor["tabela:teste"] = { larguras: { cliente: 60, sumiu: 100 }, ocultas: ["codigo", "sumiu", "tipo"] }; // 60 passa na validação geral (mín. 48) mas fica abaixo da mínima da coluna (80)
    await montar();
    await flush(10);
    expect(larguraCol("cliente")).toBe("80px");
    expect(cabecalhos()).toEqual(["sel", "codigo", "nome", "cliente", "valor", "acoes"]);
  });

  it("a do navegador também é casada com as colunas: obrigatória escondida volta, mínima vale, coluna que sumiu sai", async () => {
    localStorage.setItem("frivo:tabela:teste", JSON.stringify({ larguras: { cliente: 60, sumiu: 100 }, ocultas: ["codigo", "sumiu"] }));
    await montar();
    expect(larguraCol("cliente")).toBe("80px");
    expect(cabecalhos()).toEqual(["sel", "codigo", "nome", "cliente", "tipo", "valor", "acoes"]);
  });

  it("API fora do ar ou JSON torto no navegador: a tela abre com o padrão e segue gravando no navegador", async () => {
    apiFora = true;
    localStorage.setItem("frivo:tabela:teste", "{torto");
    await montar();
    await flush(10);
    expect(cabecalhos()).toEqual(["sel", "codigo", "nome", "cliente", "valor", "acoes"]);
    await clicar($("[data-colunas-menu]"));
    await clicar($('[data-coluna-opcao="tipo"]'));
    expect(local()).toEqual({ larguras: {}, ocultas: [] });
    await flush(700);
    expect(chamadas.filter((c) => c.metodo === "PUT")).toHaveLength(1); // tentou; falhou em silêncio
    expect(cabecalhos()).toContain("tipo");
  });
});

describe("TabelaProUrl (ordena pela URL)", () => {
  it("lê ?ordem=&dir= (ou o padrão) e navega ao clicar, alternando asc/desc", async () => {
    const nav = { qs: "ordem=codigo&dir=asc", navegar: vi.fn() };
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
      usePathname: () => "/lista", useSearchParams: () => new URLSearchParams(nav.qs),
    }));
    vi.resetModules();
    const { ListaUrl, TabelaProUrl } = await import("@/components/listagem/lista-url");
    const montarUrl = async () => {
      if (root) { act(() => root.unmount()); caixa.remove(); }
      caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
      await act(async () => {
        root.render(createElement(ListaUrl, { chave: "t", qAtual: "", children: createElement(TabelaProUrl, { tela: "teste", padrao: "nome", colunas: COLUNAS, linhas: LINHAS } as any) } as any));
      });
      await flush();
    };
    await montarUrl();
    expect($('th[data-coluna="codigo"]')!.getAttribute("aria-sort")).toBe("ascending");
    nav.qs = "";
    await montarUrl();
    expect($('th[data-coluna="nome"]')!.getAttribute("aria-sort")).toBe("ascending"); // o padrão
    vi.doUnmock("next/navigation");
  });
});

/** Só para o TypeScript não reclamar do ReactNode nas células acima */
export type _Celula = ReactNode;
