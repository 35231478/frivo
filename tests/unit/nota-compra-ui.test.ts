// @vitest-environment happy-dom
/**
 * Estoque E2 — telas num DOM de verdade (happy-dom), API simulada:
 *  - upload: manda o arquivo; sucesso abre a nota; nota repetida mostra o aviso com o link; PDF recusado;
 *  - conciliação: aprendido já vinculado; buscar e escolher produto; criar novo (nome editável);
 *    unidade diferente pede o fator; "criar para todos"; o corpo enviado para lançar (com o fator);
 *    botão travado sem vínculo/fator/permissão. (Conversão, preço e aviso de custo: estoque-e2-ajuste-ui.test.ts)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {} }) }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  chamadas.length = 0;
  nav.push.mockClear(); nav.refresh.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo });
    const r = Object.entries(respostas).find(([k]) => url.startsWith(k))?.[1] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const passar = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
async function digitar(el: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function escolherArquivo(f: File) {
  const input = $<HTMLInputElement>("[data-input-xml]")!;
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await passar(0);
}

describe("upload do XML", () => {
  it("envia o arquivo e abre a nota importada", async () => {
    const { ImportarNota } = await import("@/components/compras/importar-nota");
    await montar(createElement(ImportarNota));
    respostas["/api/compras/notas"] = { status: 201, corpo: { nota: { id: "n1", status: "IMPORTADA" } } };
    await escolherArquivo(new File(["<nfeProc/>"], "35261011222333000181550010000045211000045217-nfe.xml", { type: "text/xml" }));
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].metodo).toBe("POST");
    expect((chamadas[0].corpo as FormData).get("xml")).toBeInstanceOf(File);
    expect(nav.push).toHaveBeenCalledWith("/estoque/notas/n1");
  });

  it("nota repetida: aviso com link para a que já existe; PDF é recusado sem enviar", async () => {
    const { ImportarNota } = await import("@/components/compras/importar-nota");
    await montar(createElement(ImportarNota));
    respostas["/api/compras/notas"] = { status: 409, corpo: { erro: "Esta NF já foi importada em 15/10/2026 (NF 4521 · FRIGELAR · Lançada). Nada foi lançado de novo.", notaId: "n0" } };
    await escolherArquivo(new File(["<x/>"], "nfe.xml", { type: "text/xml" }));
    expect($('[role="alert"]')!.textContent).toContain("Esta NF já foi importada em 15/10/2026");
    expect($('[role="alert"] a')!.getAttribute("href")).toBe("/estoque/notas/n0");
    expect(nav.push).not.toHaveBeenCalled();
    chamadas.length = 0;
    await escolherArquivo(new File(["%PDF"], "danfe.pdf", { type: "application/pdf" }));
    expect($('[role="alert"]')!.textContent).toBe("Envie o arquivo .xml da NF-e (não o PDF/DANFE).");
    expect(chamadas).toEqual([]);
  });
});

const SEM_FISCAL = { ncm: null, cest: null, gtin: null, origemMercadoria: null, unidadeTributavel: null };
const produto = (id: string, nome: string, unidade: string) => ({ id, nome, unidade, preco: null, margemVenda: null, custo: null, fiscal: SEM_FISCAL });
const ITENS = [
  { id: "i1", numeroItem: 1, codigoFornecedor: "R410A-11", descricaoFornecedor: "GAS R410A 11,35KG", unidade: "UN", quantidade: 2, valorUnitario: 689.9, valorTotal: 1379.8, fiscal: { ...SEM_FISCAL, ncm: "29037990" }, fator: 1, fatorAprendido: { unidade: "UN", fator: 1 }, produto: produto("pGas", "Gás R410A", "un"), aprendido: true },
  { id: "i2", numeroItem: 2, codigoFornecedor: "CAP-35UF", descricaoFornecedor: "CAPACITOR 35UF 440V", unidade: "PC", quantidade: 10, valorUnitario: 18.45, valorTotal: 184.5, fiscal: SEM_FISCAL, fator: 1, fatorAprendido: null, produto: null, aprendido: false },
  { id: "i3", numeroItem: 3, codigoFornecedor: "TUB-14-15", descricaoFornecedor: "TUBO COBRE 1/4", unidade: "M", quantidade: 15, valorUnitario: 12.3333, valorTotal: 185, fiscal: SEM_FISCAL, fator: 1, fatorAprendido: null, produto: null, aprendido: false },
];
const props = (extra: Record<string, unknown> = {}) => ({
  notaId: "n1", itens: ITENS, pedidos: [{ id: "ped1", numero: "PC-0312" }], podeLancar: true,
  parcelas: [{ numero: "001", vencimento: "14/11/2026", valor: 583.1 }, { numero: "002", vencimento: "14/12/2026", valor: 583.1 }, { numero: "003", vencimento: "13/01/2027", valor: 583.1 }],
  ...extra,
});
const botao = (t: string) => [...caixa.querySelectorAll("button")].find((b) => b.textContent?.trim().endsWith(t)) as HTMLButtonElement;

describe("conciliação (de-para)", () => {
  it("aprendido já vinculado; busca + escolhe; cria novo; unidade diferente pede o fator; lança com o corpo certo", async () => {
    const { ConciliacaoNota } = await import("@/components/compras/conciliacao-nota");
    await montar(createElement(ConciliacaoNota, props()));
    expect($("[data-vinculados]")!.textContent).toBe("1");
    expect($('[data-item="1"] [data-aprendido]')).not.toBeNull();
    expect(($('[data-fator-item="1"]') as HTMLInputElement).disabled).toBe(true); // UN × un: 1, travado
    expect(($('[data-fator-item="1"]') as HTMLInputElement).value).toBe("1");
    expect(botao("Confirmar e lançar").disabled).toBe(true); // faltam 2
    const parcelas = $$("[data-parcelas] li").map((l) => l.textContent ?? "");
    expect(parcelas).toHaveLength(3);
    ["Parcela 1/3 · vence 14/11/2026", "Parcela 2/3 · vence 14/12/2026", "Parcela 3/3 · vence 13/01/2027"].forEach((t, k) => {
      expect(parcelas[k]).toContain(t);
      expect(parcelas[k]).toMatch(/583,10$/);
    });

    // 1 letra não busca
    const n0 = chamadas.length;
    await digitar($('[data-item="2"] [data-busca-produto]') as HTMLInputElement, "c");
    await passar(400);
    expect(chamadas.length).toBe(n0);
    // item 2: busca "cap" (debounce) e escolhe o produto do cadastro
    respostas["/api/compras/produtos"] = { status: 200, corpo: { produtos: [{ ...produto("pCap", "Capacitor 35uF", "un"), saldo: 3 }] } };
    await digitar($('[data-item="2"] [data-busca-produto]') as HTMLInputElement, "cap");
    await passar(300);
    expect(chamadas.at(-1)!.url).toBe("/api/compras/produtos?q=cap");
    await clicar($('[data-opcao-produto="pCap"]'));
    expect($('[data-item="2"] [data-vinculo]')!.getAttribute("data-vinculo")).toBe("existente");
    // PC × un: o fator vem em branco e a pessoa informa (sem ele, não conta como vinculado)
    expect(($('[data-fator-item="2"]') as HTMLInputElement).value).toBe("");
    expect($('[data-item="2"] [data-falta-fator]')!.textContent).toBe("Informe quantos un vêm em 1 PC.");
    expect($("[data-vinculados]")!.textContent).toBe("1");
    await digitar($('[data-fator-item="2"]') as HTMLInputElement, "1");
    expect($('[data-item="2"] [data-entra]')!.textContent).toMatch(/Entra 10 un · custo R\$\s18,45\/un/);

    // item 3: produto novo com o nome da nota, editado
    await clicar($('[data-criar-novo="3"]'));
    const nome = $('input[name="novo-nome-3"]') as HTMLInputElement;
    expect(nome.value).toBe("TUBO COBRE 1/4");
    expect(($('input[name="novo-un-3"]') as HTMLInputElement).value).toBe("M");
    await digitar(nome, "Tubo de cobre 1/4");
    expect($("[data-vinculados]")!.textContent).toBe("3");

    await act(async () => {
      const sel = $("[data-pedido]") as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "ped1");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    respostas["/api/compras/notas/n1/lancar"] = { status: 201, corpo: { entradas: [], contas: [] } };
    await clicar(botao("Confirmar e lançar"));
    expect(chamadas.at(-1)).toEqual({ url: "/api/compras/notas/n1/lancar", metodo: "POST", corpo: {
      itens: [{ itemId: "i1", produtoId: "pGas", fator: 1 }, { itemId: "i2", produtoId: "pCap", fator: 1 }, { itemId: "i3", novo: { nome: "Tubo de cobre 1/4", unidade: "M" }, fator: 1 }],
      pedidoCompraId: "ped1",
    } });
    expect($('[role="status"]')!.textContent).toBe("Nota lançada.");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("salvar vínculos parcial; 'criar para todos'; trocar volta a pendente; erro da API aparece", async () => {
    const { ConciliacaoNota } = await import("@/components/compras/conciliacao-nota");
    await montar(createElement(ConciliacaoNota, props()));
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { status: "IMPORTADA", faltam: 2 } };
    await clicar(botao("Salvar vínculos"));
    expect(chamadas.at(-1)).toEqual({ url: "/api/compras/notas/n1/conciliacao", metodo: "PUT", corpo: { itens: [{ itemId: "i1", produtoId: "pGas", fator: 1 }] } });
    expect($('[role="status"]')!.textContent).toBe("Vínculos salvos. Faltam 2 item(ns).");
    await clicar($("[data-criar-todos]"));
    expect($$('[data-vinculo="novo"]')).toHaveLength(2);
    expect($("[data-criar-todos]")).toBeNull();
    await clicar($('[data-item="1"] button[aria-label="Trocar produto"]'));
    expect($('[data-item="1"] [data-vinculo]')!.getAttribute("data-vinculo")).toBe("pendente");
    expect(botao("Confirmar e lançar").disabled).toBe(true);
    await clicar($('[data-criar-novo="1"]'));
    nav.refresh.mockClear(); // o "Salvar vínculos" acima atualizou a página (certo); daqui em diante, não
    respostas["/api/compras/notas/n1/lancar"] = { status: 409, corpo: { erro: "Esta nota já foi lançada: o estoque e as contas não são lançados de novo." } };
    await clicar(botao("Confirmar e lançar"));
    expect($('[role="alert"]')!.textContent).toBe("Esta nota já foi lançada: o estoque e as contas não são lançados de novo.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("sem Financeiro: lançar travado com o motivo; sem pedidos, sem o seletor", async () => {
    const { ConciliacaoNota } = await import("@/components/compras/conciliacao-nota");
    await montar(createElement(ConciliacaoNota, props({ podeLancar: false, motivoSemLancar: "Lançar gera conta a pagar: precisa de Financeiro › fluxo de caixa.", pedidos: [], itens: ITENS.map((i) => ({ ...i, produto: produto("p", "P", i.unidade) })) })));
    expect($("[data-vinculados]")!.textContent).toBe("3");
    expect(botao("Confirmar e lançar").disabled).toBe(true);
    expect($("[data-sem-lancar]")!.textContent).toContain("Financeiro › fluxo de caixa");
    expect($("[data-pedido]")).toBeNull();
    expect(botao("Salvar vínculos").disabled).toBe(false);
  });
});
