// @vitest-environment happy-dom
/**
 * Notas de compra 2 nas telas, num DOM de verdade (o servidor é um substituto):
 *  - REORDENAR COLUNAS no componente compartilhado (TabelaPro): teclado (setas, Home, End) com o foco
 *    ficando na alça e o aviso para o leitor de tela; arrastar a alça (ponteiro: mouse ou dedo); as fixas
 *    não se movem; grava na preferência do usuário; a ordem do servidor vale ao abrir; "Restaurar padrão";
 *  - a linha com `aoAbrir`: o clique abre nesta tela (a gaveta); Ctrl + clique abre o registro em outra aba;
 *  - a lista de notas: o olho e a linha abrem a gaveta com a DANFE, Baixar PDF/XML e Abrir a nota; nota sem
 *    XML esconde os downloads; erro da API visível; o período diz Emissão ou Entrada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { lerDanfe } from "@/lib/compras/danfe";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: nav.replace, back: () => {} }),
  usePathname: () => "/estoque/notas", useSearchParams: () => new URLSearchParams(nav.qs),
}));

const XML = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4521-frigelar.xml"), "utf8");
let root: Root | undefined;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo?: any }[] = [];
let servidor: Record<string, unknown> = {};
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeEach(() => {
  chamadas.length = 0; servidor = {}; respostas = {}; nav.qs = ""; nav.replace.mockClear();
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith("/api/preferencias/")) {
      const chave = url.replace("/api/preferencias/", "");
      if (metodo === "PUT") servidor[chave] = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ chave, valor: servidor[chave] ?? null }), { status: 200 });
    }
    const r = respostas[url] ?? { status: 404, corpo: { erro: "Nota não encontrada" } };
    return new Response(JSON.stringify(r.corpo), { status: r.status });
  }));
});
afterEach(() => { if (root) act(() => root!.unmount()); caixa?.remove(); root = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null, init: MouseEventInit = {}) => {
  expect(el).not.toBeNull();
  await act(async () => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })); });
  await esperar();
};
const tecla = async (el: Element | null, key: string) => { await act(async () => { el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); }); await esperar(); };
async function montar(elemento: React.ReactElement) {
  if (root) { act(() => root!.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(elemento); });
  await esperar();
}

/* ───────── reordenar colunas (componente compartilhado) ───────── */
const COLUNAS = [
  { id: "sel", titulo: "Selecionar", fixa: true, largura: 36 },
  { id: "a", titulo: "Alfa", largura: 100, obrigatoria: true },
  { id: "b", titulo: "Beta", largura: 100 },
  { id: "c", titulo: "Gama" },
  { id: "d", titulo: "Delta", largura: 80, oculta: true },
  { id: "acoes", titulo: "Ações", fixa: true, largura: 40, semTitulo: true },
];
const LINHAS = [{ id: "r1", celulas: { sel: "x", a: "A1", b: "B1", c: "C1", d: "D1", acoes: "…" } }];
const cabecalhos = () => $$("thead th").map((t) => t.getAttribute("data-coluna"));
const noMenu = () => $$("[data-item-coluna]").map((x) => x.getAttribute("data-item-coluna"));
const ultimoPut = () => chamadas.filter((c) => c.metodo === "PUT").at(-1)?.corpo;

async function tabela(props: Record<string, unknown> = {}) {
  const { TabelaPro } = await import("@/components/listagem/tabela-pro");
  await montar(createElement(TabelaPro, { tela: "teste", colunas: COLUNAS, linhas: LINHAS, ...props } as any));
  await clicar($("[data-colunas-menu]"));
}

describe("reordenar colunas: o componente compartilhado das tabelas", () => {
  it("teclado: setas, Home e End movem a coluna; o foco fica na alça; o leitor de tela ouve a posição; as fixas não se movem", async () => {
    await tabela();
    expect(noMenu()).toEqual(["a", "b", "c", "d"]); // as fixas não entram no menu
    expect(cabecalhos()).toEqual(["sel", "a", "b", "c", "acoes"]);
    await tecla($('[data-mover-coluna="b"]'), "ArrowUp");
    expect(cabecalhos()).toEqual(["sel", "b", "a", "c", "acoes"]);
    expect(noMenu()).toEqual(["b", "a", "c", "d"]);
    expect(document.activeElement?.getAttribute("data-mover-coluna")).toBe("b");
    expect(txt($("[data-aviso-colunas]"))).toBe("Beta: posição 1 de 4.");
    await tecla($('[data-mover-coluna="b"]'), "ArrowUp"); // já é a primeira: nada muda
    expect(noMenu()).toEqual(["b", "a", "c", "d"]);
    await tecla($('[data-mover-coluna="b"]'), "End");
    expect(noMenu()).toEqual(["a", "c", "d", "b"]);
    await tecla($('[data-mover-coluna="d"]'), "Home");
    expect(noMenu()).toEqual(["d", "a", "c", "b"]);
    await tecla($('[data-mover-coluna="a"]'), "ArrowDown");
    expect(noMenu()).toEqual(["d", "c", "a", "b"]);
    // a escondida (Delta) muda de lugar mas segue escondida; as fixas nas pontas
    expect(cabecalhos()).toEqual(["sel", "c", "a", "b", "acoes"]);
    // outra tecla não mexe
    await tecla($('[data-mover-coluna="a"]'), "x");
    expect(noMenu()).toEqual(["d", "c", "a", "b"]);
    // grava na preferência do usuário (depois da pausa) e no navegador na hora
    expect(JSON.parse(localStorage.getItem("frivo:tabela:teste")!).ordem).toEqual(["d", "c", "a", "b"]);
    await esperar(700);
    expect(ultimoPut()).toEqual({ larguras: {}, ordem: ["d", "c", "a", "b"] });
  });

  it("arrastar a alça (mouse ou dedo): a ordem prevista enquanto arrasta, gravada ao soltar; soltar no mesmo lugar não grava", async () => {
    await tabela();
    // as linhas do menu, empilhadas de 40 em 40 px
    $$("[data-item-coluna]").forEach((el, i) => { el.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40, left: 0, right: 200, width: 200, x: 0, y: i * 40, toJSON: () => ({}) }); });
    const alca = $('[data-mover-coluna="a"]')!;
    const ponteiro = (tipo: string, y: number) => act(async () => { alca.dispatchEvent(new PointerEvent(tipo, { bubbles: true, clientY: y, pointerId: 1, pointerType: "touch", button: 0 })); });
    await ponteiro("pointerdown", 20);
    await ponteiro("pointermove", 60); // no meio da Beta (40-80): ainda não passou dela
    expect(cabecalhos()).toEqual(["sel", "a", "b", "c", "acoes"]);
    await ponteiro("pointermove", 105); // passou do meio da Gama (80-120): vai depois dela
    expect($('[data-item-coluna="a"]')!.className).toContain("ring-1"); // destaque de quem está sendo arrastado
    expect(cabecalhos()).toEqual(["sel", "b", "c", "a", "acoes"]); // a prévia já mostra a nova ordem
    await ponteiro("pointerup", 105);
    await esperar();
    expect(noMenu()).toEqual(["b", "c", "a", "d"]);
    expect(txt($("[data-aviso-colunas]"))).toBe("Alfa: posição 3 de 4.");
    await esperar(700);
    expect(ultimoPut()).toEqual({ larguras: {}, ordem: ["b", "c", "a", "d"] });
    const puts = chamadas.filter((c) => c.metodo === "PUT").length;
    // arrastar e soltar sem mudar de lugar: nada é gravado
    const b = $('[data-mover-coluna="b"]')!;
    await act(async () => { b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: 10, pointerId: 2, pointerType: "mouse", button: 0 })); });
    await act(async () => { b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientY: 10, pointerId: 2 })); });
    await esperar(700);
    expect(chamadas.filter((c) => c.metodo === "PUT").length).toBe(puts);
    // botão direito do mouse não arrasta
    await act(async () => { b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: 10, pointerId: 3, pointerType: "mouse", button: 2 })); });
    expect($('[data-item-coluna="b"]')!.className).not.toContain("ring-1");
  });

  it("a ordem guardada no servidor vale ao abrir; Restaurar padrão volta a ordem da tela", async () => {
    servidor["tabela:teste"] = { larguras: {}, ordem: ["c", "b", "a"] };
    await tabela();
    expect(cabecalhos()).toEqual(["sel", "c", "b", "a", "acoes"]);
    expect($("[data-colunas-menu]")!.className).toContain("bg-primary-50"); // personalizada
    await clicar($("[data-restaurar-colunas]"));
    expect(cabecalhos()).toEqual(["sel", "a", "b", "c", "acoes"]);
    await esperar(700);
    expect(ultimoPut()).toEqual({ larguras: {} });
  });

  it("linha com aoAbrir: clique e Enter abrem nesta tela; Ctrl + clique abre o registro em outra aba", async () => {
    const aoAbrir = vi.fn();
    const abrir = vi.spyOn(window, "open").mockImplementation(() => null);
    const { TabelaPro } = await import("@/components/listagem/tabela-pro");
    await montar(createElement(TabelaPro, { tela: "teste", colunas: COLUNAS, linhas: [{ ...LINHAS[0], href: "/registro/r1", aoAbrir }] } as any));
    const linha = $('tr[data-linha="r1"]')!;
    await clicar(linha.querySelector('td[data-celula="b"]'));
    expect(aoAbrir).toHaveBeenCalledTimes(1);
    await tecla(linha, "Enter");
    expect(aoAbrir).toHaveBeenCalledTimes(2);
    await clicar(linha.querySelector('td[data-celula="b"]'), { ctrlKey: true });
    expect(abrir).toHaveBeenCalledWith("/registro/r1", "_blank", "noopener");
    expect(aoAbrir).toHaveBeenCalledTimes(2);
    abrir.mockRestore();
  });
});

/* ───────── a lista de notas e a gaveta ───────── */
const NOTA = {
  id: "n1", numero: "4521", serie: "1", chave: "35261011222333000181550010000045211000045217", emissao: "2026-10-15T13:30:00.000Z", entrada: null,
  fornecedor: "Polo Norte Distribuidora", cnpj: "11222333000181", itens: 3, valorTotal: 1749.3,
  valores: { produtos: 1749.3, frete: 0, desconto: 0, icms: 314.87, icmsSt: 0, ipi: 0 }, pedido: { id: "pc1", numero: "PC-2026-0007" }, lancadoPor: "Bruno", status: "IMPORTADA",
};
const SEM_XML = { ...NOTA, id: "n2", numero: "9999", valores: null, pedido: null, lancadoPor: null };
const visualizacao = (comXml: boolean, id = "n1") => ({
  nota: { id, numero: comXml ? "4521" : "9999", serie: "1", chave: NOTA.chave, emissao: NOTA.emissao, entrada: null, fornecedor: NOTA.fornecedor, cnpj: NOTA.cnpj,
    valorTotal: 1749.3, status: "IMPORTADA", pedido: comXml ? { id: "pc1", numero: "PC-2026-0007" } : null,
    itens: [{ numero: 1, codigo: "X", descricao: "Gás R410A", unidade: "UN", quantidade: 2, valorUnitario: 10, valorTotal: 20 }] },
  danfe: comXml ? JSON.parse(JSON.stringify(lerDanfe(XML))) : null,
});
const TODOS = { tipo: "todos", mes: null, de: null, ate: null, rotulo: "Todo o período" } as const;

async function lista(props: Record<string, unknown> = {}) {
  const [{ ListaUrl }, { NotasLista }] = await Promise.all([import("@/components/listagem/lista-url"), import("@/components/compras/notas-lista")]);
  await montar(createElement(ListaUrl, { chave: "notas-compra", paramBusca: "q", qAtual: "", children:
    createElement(NotasLista, { notas: [NOTA, SEM_XML], periodo: TODOS, doFinanceiro: false, vazio: null, paginacao: null, ...props } as any) } as any));
}

describe("lista de notas: a visualização rápida", () => {
  it("o olho abre a gaveta com a DANFE: emitente, chave, itens, totais; Baixar PDF, Baixar XML e Abrir a nota", async () => {
    respostas["/api/compras/notas/n1/visualizar"] = { status: 200, corpo: visualizacao(true) };
    await lista();
    expect($("[data-gaveta-nota]")).toBeNull();
    await clicar($('table [data-ver-nota="4521"]'));
    await esperar();
    const g = $("[data-gaveta-nota]")!;
    expect(g.getAttribute("data-gaveta-nota")).toBe("n1");
    expect($("[data-danfe]")).not.toBeNull();
    expect(txt($("[data-danfe-emitente]"))).toBe("FRIGELAR COMERCIO E DISTRIBUICAO S.A.");
    expect(txt($("[data-danfe-chave]"))).toBe("3526 1011 2223 3300 0181 5500 1000 0045 2110 0004 5217");
    expect($$("[data-danfe-item]").length).toBe(3);
    expect(txt($("[data-danfe-totais]"))).toContain("Total da notaR$ 1.749,30");
    expect(txt($("[data-danfe-totais]"))).toContain("ICMSR$ 314,87");
    expect($("[data-copiar='Copiar chave']")).not.toBeNull();
    expect($("[data-baixar-pdf]")!.getAttribute("href")).toBe("/api/compras/notas/n1/danfe");
    expect($("[data-baixar-xml]")!.getAttribute("href")).toBe("/api/compras/notas/n1/xml");
    expect($("[data-baixar-pdf]")!.hasAttribute("download")).toBe(true);
    expect($("[data-abrir-nota]")!.getAttribute("href")).toBe("/estoque/notas/n1");
    expect($("[data-pedido-nota]")!.getAttribute("href")).toBe("/compras/pedidos/pc1");
  });

  it("clicar na linha também abre a gaveta (sem sair da tela); o link da NF continua indo para a nota", async () => {
    respostas["/api/compras/notas/n1/visualizar"] = { status: 200, corpo: visualizacao(true) };
    await lista();
    await clicar($('tr[data-linha="n1"] td[data-celula="fornecedor"]'));
    await esperar();
    expect($("[data-gaveta-nota]")?.getAttribute("data-gaveta-nota")).toBe("n1");
    expect(nav.push).not.toHaveBeenCalled();
    expect($('tr[data-linha="n1"] td[data-celula="nf"] a')!.getAttribute("href")).toBe("/estoque/notas/n1");
  });

  it("nota sem XML: o aviso, os dados que existem e só 'Abrir a nota' (sem Baixar PDF/XML)", async () => {
    respostas["/api/compras/notas/n2/visualizar"] = { status: 200, corpo: visualizacao(false, "n2") };
    await lista();
    await clicar($('table [data-ver-nota="9999"]'));
    await esperar();
    expect($("[data-sem-xml]")).not.toBeNull();
    expect(txt($("[data-sem-xml] [role='status']"))).toBe("Esta nota não tem o XML da NF-e: a DANFE e os downloads não estão disponíveis.");
    expect([$("[data-baixar-pdf]"), $("[data-baixar-xml]"), $("[data-danfe]")]).toEqual([null, null, null]);
    expect($("[data-abrir-nota]")!.getAttribute("href")).toBe("/estoque/notas/n2");
  });

  it("erro da API aparece na gaveta; vindo de Contas a pagar, o link da nota leva o retorno", async () => {
    await lista({ doFinanceiro: true });
    await clicar($('table [data-ver-nota="4521"]'));
    await esperar();
    expect(txt($("[data-gaveta-nota] [role='alert']"))).toBe("Nota não encontrada");
    expect($("[data-abrir-nota]")!.getAttribute("href")).toBe("/estoque/notas/n1?de=contas-pagar");
  });

  it("colunas novas: valores do XML, pedido com link, quem lançou; sem XML, travessão", async () => {
    servidor["tabela:notas-compra"] = { larguras: {}, ocultas: [] };
    await lista();
    const cel = (linha: string, col: string) => $(`tr[data-linha="${linha}"] td[data-celula="${col}"]`);
    expect(txt(cel("n1", "icms"))).toBe("314,87");
    expect(txt(cel("n1", "produtos"))).toBe("1.749,30");
    expect(cel("n1", "pedido")!.querySelector("a")!.getAttribute("href")).toBe("/compras/pedidos/pc1");
    expect(txt(cel("n1", "lancadoPor"))).toBe("Bruno");
    expect(txt(cel("n1", "cnpj"))).toBe("11.222.333/0001-81");
    expect(txt(cel("n2", "icms"))).toBe("—");
    expect(txt(cel("n2", "pedido"))).toBe("—");
    expect(cel("n1", "chave")!.querySelector("[data-copiar]")).not.toBeNull();
  });

  it("o período diz qual data: Emissão (padrão) ou Entrada (?data=entrada)", async () => {
    await lista();
    expect(document.body.textContent).toContain("Emissão");
    nav.qs = "data=entrada";
    await lista();
    expect(document.body.textContent).toContain("Entrada");
  });
});
