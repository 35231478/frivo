// @vitest-environment happy-dom
/**
 * Estoque E3.3b — "Itens da OS" (aba Comercial) num DOM de verdade, API simulada:
 *  - serviço do catálogo com composição: o painel "Materiais e peças" aparece (kit explodido), tubo 3→5 ajusta o total
 *    da linha, a peça entra como item PRODUTO derivado só de leitura; o POST leva o snapshot e o total que vale;
 *  - valor manual (badge) e Recalcular; produto do catálogo; linha livre como sempre;
 *  - item que veio do orçamento: só leitura, snapshot à vista (sem edição); peça derivada sem editar/remover;
 *  - totais separados (serviços × peças/produtos); marcar executado como sempre.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const M = (produtoId: string, descricao: string, quantidade: number, venda: number, comportamento: string, custoUnit: number | null, origem = "SOLTO", kitNome: string | null = null) =>
  ({ produtoId, descricao, unidade: "un", comportamento, quantidade, quantidadePadrao: quantidade, valorVendaUnit: venda, custoUnit, origem, kitNome });
const MATERIAIS = [M("tubo", "Tubo de cobre 1/4", 3, 20, "INCLUSO_NO_SERVICO", 12, "KIT", "Kit instalação"), M("suporte", "Suporte", 1, 60, "INCLUSO_NO_SERVICO", null), M("cap", "Capacitor 35uF", 1, 80, "VENDA_A_PARTE", 45)];
const SERVICOS = [{ id: "sInst", nome: "Instalação split", ativo: true }, { id: "sLimp", nome: "Limpeza", ativo: true }];
const PRODUTOS = [{ id: "fita", nome: "Fita", ativo: true }, { id: "cap", nome: "Capacitor 35uF", ativo: true }];
let proximo = 0;

beforeAll(async () => { await import("@/components/os/os-orcamento"); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; proximo = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const u = new URL(url, "http://localhost");
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/api/cadastros/servicos") return json(SERVICOS);
    if (u.pathname === "/api/cadastros/produtos") return json(PRODUTOS);
    if (u.pathname === "/api/ordens/os1/orcamento/catalogo") {
      if (u.searchParams.get("servicoId") === "sInst") return json({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", unidade: "un", valorUnitario: 800, origemPreco: "padrao", materiais: MATERIAIS });
      if (u.searchParams.get("servicoId") === "sLimp") return json({ tipo: "SERVICO", servicoId: "sLimp", descricao: "Limpeza", unidade: "un", valorUnitario: 150, origemPreco: "contrato", materiais: [] });
      if (u.searchParams.get("produtoId") === "fita") return json({ tipo: "PRODUTO", produtoId: "fita", descricao: "Fita", unidade: "un", valorUnitario: 15, origemPreco: "padrao", material: { ...M("fita", "Fita", 1, 15, "INCLUSO_NO_SERVICO", null, "AVULSO"), quantidadePadrao: 0 } });
      return json({ erro: "não mapeado" }, 404);
    }
    const respostaItem = (id: string, status: number) => {
      const pecas = (corpo.materiais ?? []).filter((m: any) => m.comportamento === "VENDA_A_PARTE" && m.quantidade > 0).map((m: any, i: number) => ({ id: `${id}-p${i}`, tipo: "PRODUTO", produtoId: m.produtoId, descricao: m.descricao, quantidade: m.quantidade, valorUnitario: m.valorVendaUnit, valorTotal: m.quantidade * m.valorVendaUnit, executado: false, materialId: `m${i}`, material: { osItemId: id } }));
      const ajuste = (corpo.materiais ?? []).filter((m: any) => m.comportamento !== "VENDA_A_PARTE").reduce((s: number, m: any) => s + (m.quantidade - m.quantidadePadrao) * m.valorVendaUnit, 0);
      const total = corpo.valorTotal ?? corpo.quantidade * corpo.valorUnitario;
      return json({ id, ...corpo, executado: false, valorTotal: total, valorBase: corpo.materiais?.length ? corpo.quantidade * corpo.valorUnitario : null, ajusteMateriais: ajuste, materiais: (corpo.materiais ?? []).map((m: any, i: number) => ({ ...m, id: `m${i}` })), pecas }, status);
    };
    if (u.pathname === "/api/ordens/os1/orcamento" && metodo === "POST") return respostaItem(`i${++proximo}`, 201);
    if (u.pathname.startsWith("/api/ordens/os1/orcamento/") && metodo === "PUT") {
      if (corpo.executado !== undefined) return json({ id: u.pathname.split("/").pop(), ...corpo, executadoEm: new Date().toISOString() });
      return respostaItem(u.pathname.split("/").pop()!, 200);
    }
    if (u.pathname.startsWith("/api/ordens/os1/orcamento/") && metodo === "DELETE") return json({ ok: true });
    return json({ erro: `não mapeado: ${u.pathname}` }, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(sel: Element | null | undefined, v: string) {
  expect(sel).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v); sel!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montar(itens: unknown[] = []) {
  const { OsOrcamento } = await import("@/components/os/os-orcamento");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(OsOrcamento as any, { osId: "os1", itens, clienteId: "c1" })); });
  await esperar(); await esperar();
}
const linhas = () => $$("[data-item-os]");
const salvarItem = () => clicar($('[data-acao="salvar-item"]'));
const posts = () => chamadas.filter((c) => c.metodo === "POST" && c.url === "/api/ordens/os1/orcamento").map((c) => c.corpo);

describe("Itens da OS sem orçamento", () => {
  it("serviço do catálogo com composição: painel (kit explodido), tubo 3→5 = 840, peça derivada só leitura; POST com snapshot e total; totais separados", async () => {
    await montar();
    expect(txt(document.body)).toContain("Nenhum item na OS.");
    await clicar($('[data-acao="novo-servico"]'));
    await escolher($("select[name='servicoId']"), "sInst");
    expect(chamadas.some((c) => c.url === "/api/ordens/os1/orcamento/catalogo?servicoId=sInst")).toBe(true);
    const painel = $("[data-materiais-linha]")!;
    expect(painel.getAttribute("data-total-materiais")).toBe("3");
    expect(txt($("[data-material='tubo']"))).toContain("Kit Kit instalação");
    expect($<HTMLInputElement>("[data-descricao-item]")!.value).toBe("Instalação split");
    expect($<HTMLInputElement>("[data-total-item-edicao]")!.value).toBe("800,00");
    await digitar($("[data-material='tubo'] [data-qtd-material]"), "5");
    expect($("[data-ajuste]")!.getAttribute("data-ajuste")).toBe("40");
    expect($<HTMLInputElement>("[data-total-item-edicao]")!.value).toBe("840,00");
    await salvarItem();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 840, valorManual: false });
    expect(posts()[0].materiais.map((m: any) => [m.produtoId, m.quantidade, m.quantidadePadrao])).toEqual([["tubo", 5, 3], ["suporte", 1, 1], ["cap", 1, 1]]);
    // A lista: serviço 840 + peça derivada 80 (só leitura), totais separados
    expect(linhas().map((l) => [l.getAttribute("data-tipo-item"), l.getAttribute("data-linha-derivada"), txt(l.querySelector("[data-total-item]"))])).toEqual([["SERVICO", null, "Total R$ 840,00"], ["PRODUTO", "true", "Total R$ 80,00"]]);
    expect(txt(linhas()[1].querySelector("[data-peca-de]"))).toBe("Peça · Instalação split");
    expect(linhas()[1].querySelector("button[aria-label^='Editar']")).toBeNull();
    expect(linhas()[1].querySelector("button[aria-label^='Excluir']")).toBeNull();
    expect(txt(linhas()[0].querySelector("[data-com-materiais]"))).toMatch(/3 materiais · ajuste R\$\s?40,00/);
    expect(txt($("[data-total-os]"))).toMatch(/920,00/);
    expect(txt($("[data-total-servicos]"))).toMatch(/840,00/);
    expect(txt($("[data-total-produtos]"))).toMatch(/80,00/);
    // Marcar executado continua igual
    await clicar([...linhas()[0].querySelectorAll("button")].find((b) => txt(b) === "Marcar executado"));
    expect(chamadas.at(-1)).toMatchObject({ metodo: "PUT", url: "/api/ordens/os1/orcamento/i1", corpo: { executado: true } });
    expect(txt(linhas()[0])).toContain("Executado");
  });

  it("valor manual + Recalcular; produto do catálogo vira item PRODUTO; linha livre como sempre; editar um item regrava pelo PUT", async () => {
    await montar();
    await clicar($('[data-acao="novo-servico"]'));
    await escolher($("select[name='servicoId']"), "sInst");
    await digitar($("[data-total-item-edicao]"), "1000");
    expect(txt($("[data-materiais-linha] [data-valor-manual]"))).toMatch(/Valor manual na linha: R\$\s?1\.000,00/);
    await salvarItem();
    expect(posts()[0]).toMatchObject({ valorTotal: 1000, valorManual: true });
    expect(txt(linhas()[0])).toContain("Valor manual");
    // Editar: abre com o unitário base e o painel; Recalcular tira o manual; PUT regrava
    await clicar(linhas()[0].querySelector("button[aria-label^='Editar']"));
    expect($<HTMLInputElement>("[data-unitario-item]")!.value).toBe("800,00");
    await clicar($("[data-recalcular]"));
    await salvarItem();
    const put = chamadas.filter((c) => c.metodo === "PUT").at(-1)!;
    expect(put.url).toBe("/api/ordens/os1/orcamento/i1");
    expect(put.corpo).toMatchObject({ valorManual: false, valorTotal: 800 });
    expect(put.corpo.materiais).toHaveLength(3);
    // Produto do catálogo
    await clicar($('[data-acao="novo-produto"]'));
    await escolher($("select[name='produtoId']"), "fita");
    expect($("[data-materiais-linha]")).toBeNull();
    await digitar($("[data-quantidade-item]"), "3");
    await salvarItem();
    expect(posts().at(-1)).toMatchObject({ tipo: "PRODUTO", produtoId: "fita", descricao: "Fita", quantidade: 3, valorUnitario: 15 });
    expect(posts().at(-1).materiais).toBeUndefined();
    // Linha livre
    await clicar($('[data-acao="novo-livre"]'));
    await digitar($("[data-descricao-item]"), "Deslocamento");
    await digitar($("[data-unitario-item]"), "50");
    await salvarItem();
    expect(posts().at(-1)).toEqual({ tipo: "SERVICO", servicoId: null, produtoId: null, descricao: "Deslocamento", quantidade: 1, valorUnitario: 50 });
    expect(linhas().map((l) => l.getAttribute("data-tipo-item"))).toEqual(["SERVICO", "PRODUTO", "PRODUTO", "SERVICO"]);
    // Remover o serviço tira a peça derivada junto
    await clicar(linhas()[0].querySelector("button[aria-label^='Excluir']"));
    expect(linhas().map((l) => l.getAttribute("data-tipo-item"))).toEqual(["PRODUTO", "SERVICO"]);
  });

  it("item que veio do orçamento: só leitura com o snapshot à vista; item antigo (sem tipo) renderiza como serviço", async () => {
    await montar([
      { id: "a1", descricao: "Instalação split", quantidade: 1, valorUnitario: 840, valorTotal: 840, executado: false, tipo: "SERVICO", orcamentoServicoId: "orcS1", servicoId: "sInst", valorBase: 800, ajusteMateriais: 40, valorManual: false, materiais: MATERIAIS.map((m, i) => ({ ...m, id: `m${i}`, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade })) },
      { id: "a2", descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, executado: false, tipo: "PRODUTO", produtoId: "cap", materialId: "m2", material: { osItemId: "a1" } },
      { id: "velho", descricao: "Item antigo", quantidade: 2, valorUnitario: 100, valorTotal: 200, executado: true },
    ]);
    expect(linhas().map((l) => [l.getAttribute("data-tipo-item"), txt(l.querySelector("[data-total-item]"))])).toEqual([["SERVICO", "Total R$ 840,00"], ["PRODUTO", "Total R$ 80,00"], ["SERVICO", "Total R$ 200,00"]]);
    expect(txt(linhas()[0])).toContain("Do orçamento");
    expect(linhas()[0].querySelector("button[aria-label^='Editar']")).toBeNull();
    expect(linhas()[0].querySelector("button[aria-label^='Excluir']")).toBeNull();
    const painel = linhas()[0].querySelector("[data-materiais-linha]")!;
    expect(painel.getAttribute("data-somente-leitura")).toBe("true");
    expect(painel.getAttribute("data-total-materiais")).toBe("3");
    expect(painel.querySelector("[data-qtd-material]")!.hasAttribute("disabled")).toBe(true);
    expect(painel.querySelector("select[name='material-avulso']")).toBeNull();
    expect(painel.querySelector("button[aria-label^='Tirar']")).toBeNull();
    expect(txt(painel)).toMatch(/Ajuste no serviço: \+R\$\s?40,00/);
    expect(txt(linhas()[1].querySelector("[data-peca-de]"))).toBe("Peça · Instalação split");
    expect(txt(linhas()[2])).toContain("Executado");
    expect(txt($("[data-total-os]"))).toMatch(/1\.120,00/);
  });
});
