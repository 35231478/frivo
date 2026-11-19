// @vitest-environment happy-dom
/**
 * ANOTAÇÕES INTERNAS — as telas num DOM de verdade:
 *  - FORA DO MODO a ferramenta não põe nada por cima da tela (é a promessa de "sem interferência");
 *  - o modo liga pelo botão e por Alt+A, o véu captura o clique e o balão abre com o alvo certo;
 *  - salvar manda a âncora inteira para a API e NÃO deixa salvar vazio;
 *  - a lista agrupa por tela, filtra por status (descartada só quando pedida) e exporta Markdown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roteador = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() };
const busca = { atual: new URLSearchParams() };
vi.mock("next/navigation", () => ({
  useRouter: () => roteador,
  usePathname: () => "/ordens/cmwbwrppt00037dmturdlfhp7",
  useSearchParams: () => busca.atual,
}));
vi.mock("@/components/ui/avisos", async (original) => ({
  ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true),
}));
// a captura de imagem é um import() dentro do salvar: aqui ela devolve um print pronto
vi.mock("@/lib/anotacoes/print-cliente", () => ({
  capturarPrintDaViewport: vi.fn(async () => ({
    conteudo: "data:image/jpeg;base64,AAAA", largura: 720, altura: 450, printFx: 0.5, printFy: 0.5,
  })),
}));

let raiz: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; init?: RequestInit }[] = [];
const RESPOSTAS: Record<string, unknown> = {};

beforeEach(() => {
  chamadas.length = 0;
  busca.atual = new URLSearchParams();
  for (const k of Object.keys(RESPOSTAS)) delete RESPOSTAS[k];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const chave = Object.keys(RESPOSTAS).find((k) => String(url).startsWith(k));
    const corpo = chave ? RESPOSTAS[chave] : { anotacoes: [] };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  // o happy-dom não tem elementsFromPoint: a ferramenta usa isso para achar o elemento sob o clique
  if (!document.elementsFromPoint) {
    (document as any).elementsFromPoint = () => [];
  }
});
afterEach(() => { act(() => raiz?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)];
const tela = () => (document.body.textContent ?? "").replace(/\s+/g, " ").trim();

/** Digitar como o React entende (o setter nativo + o evento de input) — padrão dos testes da casa. */
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}

async function montar(el: ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); raiz = createRoot(caixa);
  await act(async () => { raiz.render(el); });
  await esperar();
}

/* ═════════ a ferramenta na tela ═════════ */

describe("A ferramenta não interfere fora do modo, e marca o ponto dentro dele", () => {
  async function ferramenta() {
    const { AnotacoesFerramenta } = await import("@/components/anotacoes/ferramenta");
    await montar(createElement(AnotacoesFerramenta));
  }

  it("FORA DO MODO: só o botão existe — nenhum véu, nenhum pin, nada por cima da tela", async () => {
    await ferramenta();
    expect($("[data-anotacoes-botao]")).toBeTruthy();
    expect($("[data-anotacoes-veu]")).toBeNull();
    expect($("[data-anotacoes-barra]")).toBeNull();
    expect($("[data-anotacoes-balao]")).toBeNull();
    expect($$("[data-anotacoes-pin]")).toHaveLength(0);
    // e nem consultou a API: no caminho normal a ferramenta é inerte
    expect(chamadas).toHaveLength(0);
  });

  it("o botão liga o modo: o véu e a barra aparecem, e a tela é consultada", async () => {
    await ferramenta();
    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-botao]")!.click(); });
    await esperar();
    expect($("[data-anotacoes-veu]")).toBeTruthy();
    expect($("[data-anotacoes-barra]")).toBeTruthy();
    expect(tela()).toContain("Clique no ponto que quer anotar");
    // a tela normalizada vai na consulta (agrupa por tela, não por registro)
    expect(chamadas[0].url).toContain("tela=%2Fordens%2F%3Aid");
  });

  it("Alt+A liga e desliga o modo", async () => {
    await ferramenta();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", altKey: true })); });
    await esperar();
    expect($("[data-anotacoes-veu]")).toBeTruthy();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", altKey: true })); });
    await esperar();
    expect($("[data-anotacoes-veu]")).toBeNull();
  });

  /**
   * Regressão vista no navegador: o botão ficava num z ABAIXO do véu, então clicar em "Anotando"
   * não saía do modo — marcava um ponto em cima do que estivesse ali. E ficava no canto de baixo
   * da esquerda, onde mora a logo do Frivo no rodapé da barra lateral.
   */
  it("dentro do modo o botão fica ACIMA do véu: clicar nele SAI, não marca ponto", async () => {
    await ferramenta();
    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-botao]")!.click(); });
    await esperar();

    const z = (el: Element | null) => Number(String(el?.className ?? "").match(/z-\[?(\d+)\]?/)?.[1] ?? NaN);
    const zBotao = z($("[data-anotacoes-botao]"));
    expect(zBotao).toBeGreaterThan(z($("[data-anotacoes-veu]")));
    // …e abaixo da barra, que manda enquanto o modo está ligado
    expect(zBotao).toBeLessThan(z($("[data-anotacoes-barra]")));

    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-botao]")!.click(); });
    await esperar();
    expect($("[data-anotacoes-veu]")).toBeNull();
    expect($("[data-anotacoes-balao]")).toBeNull();
  });

  it("o botão não pousa no canto da logo do Frivo", async () => {
    await ferramenta();
    const classe = String($("[data-anotacoes-botao]")!.className);
    expect(classe).toMatch(/\bright-/);
    expect(classe).not.toMatch(/\bleft-/);
  });

  it("clicar no véu abre o balão com o ALVO identificado, e salvar manda a âncora inteira", async () => {
    // a tela por baixo: um marco semântico de verdade, como os que o sistema já tem
    const fundo = document.createElement("section");
    fundo.setAttribute("data-secao", "materiais");
    fundo.innerHTML = '<ul><li><span>Gás</span></li><li><button type="button">Separar</button></li></ul>';
    document.body.appendChild(fundo);
    const botaoDaTela = fundo.querySelector("button")!;
    (document as any).elementsFromPoint = () => [botaoDaTela];

    await ferramenta();
    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-botao]")!.click(); });
    await esperar();
    await act(async () => { $<HTMLElement>("[data-anotacoes-veu]")!.click(); });
    await esperar();

    expect($("[data-anotacoes-balao]")).toBeTruthy();
    expect($("[data-anotacoes-alvo]")!.textContent).toBe("Separar");
    expect(tela()).toContain("Print do momento guardado");

    // vazio não salva
    expect($<HTMLButtonElement>("[data-anotacoes-salvar]")!.disabled).toBe(true);

    await digitar($("[data-anotacoes-texto]"), "Esse atalho está escondido");
    expect($<HTMLButtonElement>("[data-anotacoes-salvar]")!.disabled).toBe(false);
    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-salvar]")!.click(); });
    await esperar();

    const post = chamadas.find((c) => c.init?.method === "POST");
    expect(post).toBeTruthy();
    const corpo = JSON.parse(String(post!.init!.body));
    expect(corpo).toMatchObject({
      tela: "/ordens/:id",
      ancora: "data-secao=materiais",
      caminho: "ul>li:nth-of-type(2)>button",
      rotulo: "Separar",
      texto: "Esse atalho está escondido",
    });
    expect(corpo.print).toMatchObject({ largura: 720, altura: 450 });
    fundo.remove();
  });

  it("Esc fecha o balão sem salvar", async () => {
    const fundo = document.createElement("div");
    fundo.setAttribute("data-secao", "x");
    document.body.appendChild(fundo);
    (document as any).elementsFromPoint = () => [fundo];
    await ferramenta();
    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-botao]")!.click(); });
    await esperar();
    await act(async () => { $<HTMLElement>("[data-anotacoes-veu]")!.click(); });
    await esperar();
    expect($("[data-anotacoes-balao]")).toBeTruthy();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await esperar();
    expect($("[data-anotacoes-balao]")).toBeNull();
    expect(chamadas.some((c) => c.init?.method === "POST")).toBe(false);
    fundo.remove();
  });

  it("os pins da tela aparecem no modo — e a anotação de âncora PERDIDA não vira pin errado", async () => {
    RESPOSTAS["/api/anotacoes"] = {
      anotacoes: [
        { id: "a1", texto: "No lugar", status: "aberta", ancora: "data-secao=materiais", ancoraIndice: 0, caminho: null, rotulo: null, papel: null, fx: 0.5, fy: 0.5, x: 0, y: 0, viewportW: 1440 },
        { id: "a2", texto: "Órfã", status: "aberta", ancora: "data-secao=sumiu", ancoraIndice: 0, caminho: null, rotulo: "Nada igual", papel: "button", fx: 0.5, fy: 0.5, x: 0, y: 0, viewportW: 1440 },
      ],
    };
    const fundo = document.createElement("section");
    fundo.setAttribute("data-secao", "materiais");
    document.body.appendChild(fundo);

    await ferramenta();
    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-botao]")!.click(); });
    await esperar();

    expect($('[data-anotacoes-pin="a1"]')).toBeTruthy();
    expect($('[data-anotacoes-pin="a1"]')!.getAttribute("data-precisao")).toBe("exata");
    // a órfã NÃO ganha pin: ela vive na lista, com o print — nunca num lugar inventado
    expect($('[data-anotacoes-pin="a2"]')).toBeNull();
    fundo.remove();
  });
});

/* ═════════ a lista ═════════ */

describe("Minhas anotações: agrupa por tela, filtra por status e exporta", () => {
  const LINHAS = [
    { id: "a1", tela: "/ordens/:id?aba=materiais", rota: "/ordens/os1?aba=materiais", tituloTela: "OS-1001", rotulo: "Separar", texto: "Atalho escondido", status: "aberta", criadoEm: "2027-01-20T12:00:00.000Z", temPrint: true },
    { id: "a2", tela: "/ordens/:id?aba=materiais", rota: "/ordens/os1?aba=materiais", tituloTela: "OS-1001", rotulo: null, texto: "Faltou o total", status: "feita", criadoEm: "2027-01-21T12:00:00.000Z", temPrint: false },
    { id: "a3", tela: "/equipamentos", rota: "/equipamentos", tituloTela: "Equipamentos", rotulo: "Sem QR", texto: "Chip confuso", status: "descartada", criadoEm: "2027-01-22T12:00:00.000Z", temPrint: false },
  ];

  async function lista() {
    const { AnotacoesLista } = await import("@/components/anotacoes/anotacoes-lista");
    await montar(createElement(AnotacoesLista as any, { anotacoes: LINHAS }));
  }

  it("abre no filtro 'aberta' e mostra a contagem de cada status", async () => {
    await lista();
    expect($('[data-filtro-status="aberta"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(tela()).toContain("Aberta (1)");
    expect(tela()).toContain("Feita (1)");
    expect(tela()).toContain("Descartada (1)");
    expect($$("[data-anotacao]")).toHaveLength(1);
    expect(tela()).toContain("Atalho escondido");
  });

  it("agrupa por TELA e mostra o título da tela com a chave normalizada", async () => {
    await lista();
    await act(async () => { $<HTMLButtonElement>('[data-filtro-status="todas"]')!.click(); });
    await esperar();
    expect($$("[data-grupo-tela]")).toHaveLength(2);
    expect($('[data-grupo-tela="/ordens/:id?aba=materiais"]')).toBeTruthy();
    expect(tela()).toContain("OS-1001");
    expect(tela()).toContain("/ordens/:id?aba=materiais");
  });

  it("a descartada só aparece quando pedida", async () => {
    await lista();
    expect(tela()).not.toContain("Chip confuso");
    await act(async () => { $<HTMLButtonElement>('[data-filtro-status="descartada"]')!.click(); });
    await esperar();
    expect(tela()).toContain("Chip confuso");
  });

  it("o link leva de volta à tela com o pin destacado; o print abre pela rota própria", async () => {
    await lista();
    expect($("[data-ir-para-tela]")!.getAttribute("href")).toBe("/ordens/os1?aba=materiais&anotacao=a1");
    expect($("[data-ver-print]")!.getAttribute("href")).toBe("/api/anotacoes/a1/print");
  });

  it("marcar como feita manda o PATCH e pede o refresh da tela", async () => {
    await lista();
    await act(async () => { $<HTMLButtonElement>("[data-marcar-feita]")!.click(); });
    await esperar();
    const patch = chamadas.find((c) => c.init?.method === "PATCH");
    expect(patch!.url).toBe("/api/anotacoes/a1");
    expect(JSON.parse(String(patch!.init!.body))).toEqual({ status: "feita" });
    expect(roteador.refresh).toHaveBeenCalled();
  });

  it("excluir pergunta antes e manda o DELETE", async () => {
    await lista();
    await act(async () => { $<HTMLButtonElement>("[data-excluir]")!.click(); });
    await esperar();
    const { confirmar } = await import("@/components/ui/avisos");
    expect(confirmar).toHaveBeenCalled();
    expect(chamadas.find((c) => c.init?.method === "DELETE")!.url).toBe("/api/anotacoes/a1");
  });

  it("copiar põe o Markdown na área de transferência, agrupado e sem o print", async () => {
    const escrito: string[] = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (t: string) => { escrito.push(t); } } });
    await lista();
    await act(async () => { $<HTMLButtonElement>('[data-filtro-status="todas"]')!.click(); });
    await esperar();
    await act(async () => { $<HTMLButtonElement>("[data-anotacoes-copiar]")!.click(); });
    await esperar();
    expect(escrito).toHaveLength(1);
    expect(escrito[0]).toContain("## OS-1001 — `/ordens/:id?aba=materiais`");
    expect(escrito[0]).toContain("- [ ] **Separar** — Atalho escondido");
    expect(escrito[0]).toContain("- [x] Faltou o total");
    expect(escrito[0]).not.toContain("data:image");
  });
});
