// @vitest-environment happy-dom
/**
 * Estoque E3.1 — as telas num DOM de verdade (happy-dom), API simulada:
 *  - Produtos: coluna "Categoria" (nome + pílula do comportamento; sem categoria = "Sem categoria" +
 *    "Incluso no serviço (padrão)"), filtro por categoria no topo (Todas / Sem categoria / as cadastradas,
 *    na URL e na consulta à API), e o seletor de categoria no formulário (vai como categoriaProdutoId);
 *  - Categorias de produto: lista com a pílula do comportamento e o uso; formulário com o select do
 *    comportamento (obrigatório) e o ⓘ fora de botão.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: () => {}, back: () => {} }),
  usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams(nav.qs),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const CATEGORIAS = [
  { id: "cPecas", nome: "Peças de reposição", comportamento: "VENDA_A_PARTE", ativo: true, _count: { produtos: 1 } },
  { id: "cMat", nome: "Materiais de instalação/consumo", comportamento: "INCLUSO_NO_SERVICO", ativo: true, _count: { produtos: 0 } },
  { id: "cVelha", nome: "Antiga", comportamento: "VENDA_A_PARTE", ativo: false, _count: { produtos: 0 } },
];
const PRODUTOS = [
  { id: "p1", codigo: 1, nome: "Compressor 1/4", unidade: "un", valorPadrao: 890, estoqueMinimo: 2, ativo: true, controlaEstoque: true, categoriaProdutoId: "cPecas", categoriaProduto: { id: "cPecas", nome: "Peças de reposição", comportamento: "VENDA_A_PARTE", ativo: true } },
  { id: "p2", codigo: 2, nome: "Fita aluminizada", unidade: "un", valorPadrao: 12.5, estoqueMinimo: null, ativo: true, controlaEstoque: true, categoriaProdutoId: null, categoriaProduto: null },
];
let produtosLista = PRODUTOS;

beforeAll(async () => {
  await Promise.all([import("@/components/config/telas/produtos"), import("@/components/cadastros/telas/categorias-produto"), import("@/components/providers/permissoes-provider")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.qs = ""; nav.replace.mockClear(); produtosLista = PRODUTOS;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const u = new URL(url, "http://localhost");
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    if (u.pathname.startsWith("/api/preferencias/")) return json({ valor: null });
    if (u.pathname === "/api/cadastros/categorias-produto") {
      if (metodo === "POST") return json({ id: "cNova", ...corpo, ativo: true }, 201);
      const ativos = u.searchParams.get("ativo") === "todos" ? CATEGORIAS : CATEGORIAS.filter((c) => c.ativo);
      return u.searchParams.has("pagina") ? json({ itens: ativos, total: ativos.length, pagina: 1, porPagina: 50, contagens: { ativos: 2, inativos: 1, todos: 3 } }) : json(ativos);
    }
    if (u.pathname === "/api/cadastros/produtos") {
      if (metodo === "POST") return json({ id: "pNovo", ...corpo, ativo: true, categoriaProduto: CATEGORIAS.find((c) => c.id === corpo.categoriaProdutoId) ?? null }, 201);
      const cat = u.searchParams.get("categoria");
      const itens = !cat ? produtosLista : cat === "sem" ? produtosLista.filter((p) => !p.categoriaProdutoId) : produtosLista.filter((p) => p.categoriaProdutoId === cat);
      return json({ itens, total: itens.length, pagina: 1, porPagina: 50, contagens: { ativos: itens.length, inativos: 0, todos: itens.length } });
    }
    if (u.pathname.startsWith("/api/cadastros/produtos/") && metodo === "PATCH") return json({ ...PRODUTOS[0], ...corpo });
    return json({ erro: "não mapeado" }, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: React.ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar(); await esperar();
}
const ultimaLista = () => chamadas.filter((c) => c.url.startsWith("/api/cadastros/produtos?") && c.metodo === "GET").at(-1)!.url;

describe("Produtos", () => {
  it("coluna Categoria: nome + pílula; sem categoria = 'Sem categoria' + 'Incluso no serviço' (padrão)", async () => {
    const { TelaProdutos } = await import("@/components/config/telas/produtos");
    await montar(createElement(TelaProdutos));
    expect($$("[data-cadastro=produtos] thead th").map(txt)).toContain("Categoria");
    const linhas = $$("[data-cadastro=produtos] tbody tr");
    expect(linhas).toHaveLength(2);
    const cel = (i: number) => linhas[i].querySelector("[data-categoria-produto]")!;
    expect(cel(0).getAttribute("data-categoria-produto")).toBe("sim");
    expect(txt(cel(0))).toBe("Peças de reposição Venda à parte");
    expect(cel(0).querySelector("[data-comportamento]")!.getAttribute("data-comportamento")).toBe("VENDA_A_PARTE");
    expect(cel(1).getAttribute("data-categoria-produto")).toBe("nao");
    expect(txt(cel(1))).toBe("Sem categoria Incluso no serviço (padrão)");
    expect(cel(1).querySelector("[data-comportamento]")!.getAttribute("data-comportamento")).toBe("INCLUSO_NO_SERVICO");
  });

  it("filtro por categoria: Todas / Sem categoria / as cadastradas (a inativa não entra como escolha nova); escolher vai para a URL e para a consulta", async () => {
    const { TelaProdutos } = await import("@/components/config/telas/produtos");
    await montar(createElement(TelaProdutos));
    const sel = $<HTMLSelectElement>("[data-filtro-vinculo=categoria]")!;
    expect(sel).not.toBeNull();
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([["", "Todas"], ["sem", "Sem categoria"], ["cPecas", "Peças de reposição"], ["cMat", "Materiais de instalação/consumo"]]);
    expect(ultimaLista()).not.toContain("categoria=");
    await escolher(sel, "cPecas");
    expect(nav.replace).toHaveBeenLastCalledWith("/configuracoes?categoria=cPecas", { scroll: false });
    // A URL manda na lista: com ?categoria=sem só os sem categoria
    nav.qs = "categoria=sem";
    act(() => root.unmount()); caixa.remove();
    await montar(createElement(TelaProdutos));
    expect(ultimaLista()).toContain("categoria=sem");
    expect($$("[data-cadastro=produtos] tbody tr").map((l) => txt(l.querySelector("[data-codigo]")))).toEqual(["2"]);
    expect($<HTMLSelectElement>("[data-filtro-vinculo=categoria]")!.value).toBe("sem");
    await escolher($("[data-filtro-vinculo=categoria]"), "");
    expect(nav.replace).toHaveBeenLastCalledWith("/configuracoes", { scroll: false });
  });

  it("formulário: o seletor de categoria (Sem categoria / ativas) vai no corpo como categoriaProdutoId; o ⓘ explica o padrão", async () => {
    const { TelaProdutos } = await import("@/components/config/telas/produtos");
    await montar(createElement(TelaProdutos));
    await clicar($("[data-acao=novo-cadastro]"));
    const sel = $<HTMLSelectElement>('select[name="categoriaProdutoId"]')!;
    expect(sel).not.toBeNull();
    const opcoes = [...sel.options].map((o) => o.textContent ?? "");
    expect(opcoes.slice(0, 3)).toEqual(["Sem categoria", "Peças de reposição", "Materiais de instalação/consumo"]);
    expect(opcoes[3]).toMatch(/^[+＋] Nov/); // cadastro rápido inline (Princípio 1)
    expect(opcoes).toHaveLength(4); // a inativa não é escolha nova
    expect(document.body.textContent).toContain("Sem categoria, é tratado como incluso no serviço");
    await digitar($('input[id]:not([type=checkbox])'), "Válvula de expansão");
    await escolher(sel, "cMat");
    await clicar([...document.querySelectorAll("button")].find((b) => txt(b) === "Adicionar") ?? null);
    const post = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/cadastros/produtos")!;
    expect(post.corpo).toMatchObject({ nome: "Válvula de expansão", categoriaProdutoId: "cMat", controlaEstoque: "true" });
  });
});

describe("Categorias de produto", () => {
  it("lista: nome, pílula do comportamento e uso; formulário com o select do comportamento (obrigatório) e o ⓘ fora de botão", async () => {
    const { CategoriasProdutoTela } = await import("@/components/cadastros/telas/categorias-produto");
    await montar(createElement(CategoriasProdutoTela));
    expect($$("[data-cadastro=categorias-produto] thead th").map(txt).filter((t) => t !== "Selecionar a página").slice(0, 3)).toEqual(["Categoria", "Faturamento", "Produtos"]);
    const linhas = $$("[data-cadastro=categorias-produto] tbody tr");
    expect(txt(linhas[0])).toMatch(/^Peças de reposição\s*Venda à parte\s*1 produto\(s\)/);
    expect(txt(linhas[1])).toMatch(/^Materiais de instalação\/consumo\s*Incluso no serviço\s*—/);
    expect(linhas[0].querySelector("[data-comportamento]")!.getAttribute("data-comportamento")).toBe("VENDA_A_PARTE");
    await clicar($("[data-acao=novo-cadastro]"));
    const sel = $<HTMLSelectElement>('select[id]')!;
    expect([...sel.options].map((o) => o.value)).toEqual(["VENDA_A_PARTE", "INCLUSO_NO_SERVICO"]);
    expect([...sel.options][0].textContent).toMatch(/^Venda à parte — Peça de reposição/);
    expect($("[data-dica]")!.parentElement!.closest("button, a")).toBeNull(); // ⓘ do campo fora de qualquer botão
    await digitar($('input[id]'), "Consumíveis");
    await escolher(sel, "INCLUSO_NO_SERVICO");
    await clicar([...document.querySelectorAll("button")].find((b) => txt(b) === "Adicionar") ?? null);
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ nome: "Consumíveis", comportamento: "INCLUSO_NO_SERVICO" });
  });
});
