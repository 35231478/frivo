// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — o orçamento (components/forms/orcamento-form + a tabela de itens), num DOM de verdade:
 *  - sem cliente e sem itens: cada erro no seu lugar (cliente marcado; a lista de serviços, junto da busca), a faixa
 *    é o resumo ("2 campos para corrigir") e o foco vai para o cliente (o 1º na tela); nada vai ao servidor;
 *  - a célula da tabela de itens com erro fica marcada (aria-invalid + a mensagem embaixo da linha) e some ao corrigir;
 *  - o erro do servidor por linha ("servicos.N.quantidade") cai na linha certa da TELA, mesmo com linha em branco antes;
 *  - o motivo do preço de tabela pedido pelo servidor cai no campo do motivo.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: () => {}, back: vi.fn() }),
  usePathname: () => "/orcamentos/novo", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const BASE = {
  clientes: [{ id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }],
  catalogoServicos: [{ id: "s1", nome: "Limpeza de split", descricao: null, unidade: "UN", valorPadrao: 500 }],
  catalogoProdutos: [{ id: "p1", nome: "Capacitor 35uF", descricao: null, unidade: "UN", valorPadrao: 50 }],
  tecnicos: [], termoTemplates: [],
};

beforeAll(async () => {
  await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  respostas = { "GET /api/clientes/c1/tabela-preco": { status: 200, corpo: null }, "POST /api/orcamentos": { status: 201, corpo: { id: "o1" } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function montar(props: Record<string, unknown> = {}) {
  const [{ OrcamentoForm }, { PermissoesProvider }] = await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider")]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OrcamentoForm as any, { mode: "novo", ...BASE, ...props }) }));
  });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 40)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function adicionar(nome: string) {
  await digitar($("input[placeholder='Pesquisar serviço por nome ou código...']"), nome.slice(0, 5));
  await clicar($$("button").find((b) => b.textContent?.includes(nome)));
}
const enviar = async () => { await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await esperar(); };
const posts = () => chamadas.filter((c) => c.metodo === "POST" && c.url === "/api/orcamentos");
const erroDoCampo = (nome: string) => $(`[data-campo-nome="${nome}"]`)?.querySelector("[data-erro-campo]")?.textContent ?? null;
const linhas = () => $$("[data-item-linha]");
const celula = (linha: Element, c: string) => linha.querySelector<HTMLInputElement>(`[data-campo='${c}']`)!;

describe("orçamento: cada erro no seu campo", () => {
  it("sem cliente e sem itens: o cliente e a lista de serviços marcados, a faixa resume e o foco vai ao cliente; nada vai ao servidor", async () => {
    await montar();
    await enviar();
    expect(posts()).toEqual([]);
    expect(erroDoCampo("clienteId")).toBe("Selecione um cliente.");
    expect(erroDoCampo("servicos")).toBe("Adicione ao menos um serviço ou produto.");
    const faixa = $("[data-resumo-erros]")!;
    expect(faixa.textContent).toContain("2 campos para corrigir");
    expect($$("[data-resumo-erros] [data-ir-campo]").map((b) => b.textContent)).toEqual(["Cliente", "Serviços"]);
    // o gatilho do seletor de cliente fica marcado e recebe o foco (o 1º erro na tela)
    const gatilho = $<HTMLButtonElement>('[data-campo-nome="clienteId"] button[aria-invalid="true"]')!;
    expect(gatilho).toBeTruthy();
    expect(document.activeElement).toBe(gatilho);
    // a busca de serviços também fica marcada e descrita pela mensagem
    const busca = $<HTMLInputElement>("input[placeholder='Pesquisar serviço por nome ou código...']")!;
    expect(busca.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(busca.getAttribute("aria-describedby")!)!.textContent).toBe("Adicione ao menos um serviço ou produto.");
  });

  it("entrou um item: o erro da lista some na hora (sem esperar o próximo salvar)", async () => {
    await montar({ clienteIdInicial: "c1" });
    await enviar();
    expect(erroDoCampo("servicos")).toBe("Adicione ao menos um serviço ou produto.");
    await adicionar("Limpeza de split");
    expect(erroDoCampo("servicos")).toBeNull();
    expect($("[data-resumo-erros]")).toBeNull();
  });

  it("célula da tabela: quantidade zerada marca a célula da linha, com a mensagem embaixo da linha; some ao corrigir", async () => {
    await montar({ clienteIdInicial: "c1" });
    await adicionar("Limpeza de split");
    await digitar(celula(linhas()[0], "quantidade"), "0");
    await enviar();
    expect(posts()).toEqual([]);
    const qtd = celula(linhas()[0], "quantidade");
    expect(qtd.getAttribute("aria-invalid")).toBe("true");
    expect(qtd.className).toContain("border-atrasado");
    expect(document.getElementById(qtd.getAttribute("aria-describedby")!)!.textContent).toBe("Qtd: Quantidade maior que zero.");
    expect(document.activeElement).toBe(qtd);
    await digitar(qtd, "2");
    expect(celula(linhas()[0], "quantidade").getAttribute("aria-invalid")).toBeNull();
    expect($("[data-erros-linha]")).toBeNull();
  });
});

describe("orçamento: o erro do servidor no campo certo", () => {
  it("\"servicos.0.descricao\" do servidor volta para a linha certa da tela (a linha em branco não foi ao servidor)", async () => {
    respostas["POST /api/orcamentos"] = { status: 400, corpo: { erro: "Dados inválidos", campos: { "servicos.0.valorUnitario": "Valor não pode ser negativo" } } };
    await montar({ clienteIdInicial: "c1" });
    await clicar($$("button").find((b) => b.textContent?.includes("Linha em branco"))); // linha 0 da tela: em branco, não vai
    await adicionar("Limpeza de split");                                                // linha 1 da tela = linha 0 do servidor
    await enviar();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].corpo.servicos).toHaveLength(1);
    expect(celula(linhas()[0], "unitario").getAttribute("aria-invalid")).toBeNull();
    expect(celula(linhas()[1], "unitario").getAttribute("aria-invalid")).toBe("true");
    // um erro só: a faixa repete a frase (sem o "Dados inválidos" genérico)
    expect($("[data-resumo-erros]")!.textContent).toBe("Valor não pode ser negativo");
    expect(document.activeElement).toBe(celula(linhas()[1], "unitario"));
  });

  it("o servidor pediu o motivo do preço de tabela: o campo do motivo aparece marcado", async () => {
    respostas["POST /api/orcamentos"] = { status: 400, corpo: { erro: "Informe o motivo da alteração do preço de tabela (Limpeza de split).", precoTabela: true, campos: { motivoPrecoTabela: "Informe o motivo da alteração do preço de tabela (Limpeza de split)." } } };
    await montar({ clienteIdInicial: "c1" });
    await adicionar("Limpeza de split");
    await enviar();
    expect(erroDoCampo("motivoPrecoTabela")).toBe("Informe o motivo da alteração do preço de tabela (Limpeza de split).");
    const motivo = $<HTMLInputElement>('[data-campo-nome="motivoPrecoTabela"] input')!;
    expect(motivo.getAttribute("aria-invalid")).toBe("true");
  });

  it("erro que não é de campo nenhum (OS de outro cliente) fica na faixa", async () => {
    respostas["POST /api/orcamentos"] = { status: 400, corpo: { erro: "Uma ou mais ordens de serviço são inválidas ou não pertencem a este cliente" } };
    await montar({ clienteIdInicial: "c1" });
    await adicionar("Limpeza de split");
    await enviar();
    expect($("[data-resumo-erros]")!.textContent).toBe("Uma ou mais ordens de serviço são inválidas ou não pertencem a este cliente");
    expect($$("[data-campo-com-erro]")).toEqual([]);
  });
});
