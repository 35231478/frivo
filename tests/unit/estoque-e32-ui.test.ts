// @vitest-environment happy-dom
/**
 * Estoque E3.2 — as telas num DOM de verdade (happy-dom), API simulada:
 *  - Kits de material: lista com itens, custo de referência (com "sem custo") e uso; editor próprio com os itens
 *    (produto + quantidade, pílula do comportamento, custo) que grava `itens` pela rota genérica;
 *  - Serviço › seção "Materiais padrão": carrega a composição sem contar como mudança (salvar sem mexer não manda
 *    `materiais`); adicionar material/kit manda o JSON; o kit aparece aberto nos itens (kit vivo) × quantidade;
 *    override por linha; resumo do custo dos inclusos (só informativo); serviço sem composição = aviso neutro.
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

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const CAT_PECA = { id: "cPecas", nome: "Peças", comportamento: "VENDA_A_PARTE" };
const CAT_MAT = { id: "cMat", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO" };
const PRODUTOS = [
  { id: "p1", codigo: 1, nome: "Gás R410A", unidade: "kg", ativo: true, categoriaProdutoId: "cMat", categoriaProduto: CAT_MAT },
  { id: "p2", codigo: 2, nome: "Capacitor", unidade: "un", ativo: true, categoriaProdutoId: "cPecas", categoriaProduto: CAT_PECA },
  { id: "p3", codigo: 3, nome: "Suporte", unidade: "un", ativo: true, categoriaProdutoId: null, categoriaProduto: null },
];
const KITS = [
  { id: "k1", nome: "Kit instalação", descricao: null, ativo: true, _count: { servicoMateriais: 2 }, custoReferencia: { total: 25, semCusto: ["p3"] },
    itens: [{ produtoId: "p1", quantidade: "0.5", produto: PRODUTOS[0] }, { produtoId: "p3", quantidade: "2", produto: PRODUTOS[2] }] },
  { id: "k2", nome: "Kit vazio", descricao: null, ativo: true, _count: { servicoMateriais: 0 }, custoReferencia: { total: 0, semCusto: [] }, itens: [] },
];
const SERVICOS = [
  { id: "s1", codigo: "INST01", nome: "Instalação split", unidade: "un", valorPadrao: 350, ativo: true, _count: { materiais: 2 } },
  { id: "s2", codigo: "LIMP01", nome: "Limpeza", unidade: "un", valorPadrao: 150, ativo: true, _count: { materiais: 0 } },
];
const COMPOSICAO_S1 = [
  { produtoId: "p2", kitId: null, quantidade: "1", comportamento: null, produto: PRODUTOS[1], kit: null },
  { produtoId: null, kitId: "k1", quantidade: "2", comportamento: null, produto: null, kit: { id: "k1", nome: "Kit instalação", ativo: true, itens: KITS[0].itens } },
];
const CUSTOS = { p1: 50, p2: 30 };

beforeAll(async () => {
  await Promise.all([import("@/components/config/telas/kits-material"), import("@/components/config/telas/servicos"), import("@/components/providers/permissoes-provider")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.qs = ""; nav.replace.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const u = new URL(url, "http://localhost");
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    const pagina = (itens: unknown[]) => json({ itens, total: itens.length, pagina: 1, porPagina: 50, contagens: { ativos: itens.length, inativos: 0, todos: itens.length } });
    if (u.pathname.startsWith("/api/preferencias/") || u.pathname === "/api/fiscal/apoio-servico") return json({ valor: null, cnaeEmpresa: null, issEmpresa: null, servicos: [] });
    if (u.pathname === "/api/estoque/custos") return json({ custos: CUSTOS });
    if (u.pathname === "/api/cadastros/produtos") return u.searchParams.has("pagina") ? pagina(PRODUTOS) : json(PRODUTOS);
    if (u.pathname === "/api/cadastros/categorias-produto") return json([CAT_PECA, CAT_MAT]);
    if (u.pathname === "/api/cadastros/kits-material") {
      if (metodo === "POST") return json({ id: "kNovo", ...corpo, ativo: true, itens: [] }, 201);
      return u.searchParams.has("pagina") ? pagina(KITS) : json(KITS);
    }
    if (u.pathname === "/api/cadastros/kits-material/k1") return metodo === "PATCH" ? json({ ...KITS[0], ...corpo }) : json(KITS[0]);
    if (u.pathname === "/api/cadastros/servicos") {
      if (metodo === "POST") return json({ id: "sNovo", ...corpo, ativo: true, _count: { materiais: 0 } }, 201);
      return u.searchParams.has("pagina") ? pagina(SERVICOS) : json(SERVICOS);
    }
    if (u.pathname === "/api/cadastros/servicos/s1") return metodo === "PATCH" ? json({ ...SERVICOS[0], ...corpo, materiais: COMPOSICAO_S1 }) : json({ ...SERVICOS[0], materiais: COMPOSICAO_S1 });
    if (u.pathname === "/api/cadastros/servicos/s2") return metodo === "PATCH" ? json({ ...SERVICOS[1], ...corpo, materiais: [] }) : json({ ...SERVICOS[1], materiais: [] });
    return json({ erro: `não mapeado: ${u.pathname}` }, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (rotulo: string | RegExp) => [...document.querySelectorAll("button")].find((b) => (typeof rotulo === "string" ? txt(b) === rotulo : rotulo.test(txt(b)))) ?? null;
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
const gravacoes = (entidade: string) => chamadas.filter((c) => c.url.startsWith(`/api/cadastros/${entidade}`) && (c.metodo === "POST" || c.metodo === "PATCH"));

describe("Kits de material", () => {
  it("lista: itens, custo de referência (com 'sem custo' honesto) e uso; o ⓘ da tela explica o kit vivo", async () => {
    const { TelaKitsMaterial } = await import("@/components/config/telas/kits-material");
    await montar(createElement(TelaKitsMaterial));
    expect($$("[data-cadastro=kits-material] thead th").map(txt)).toEqual(expect.arrayContaining(["Kit", "Itens", "Custo ref.", "Serviços"]));
    const linhas = $$("[data-cadastro=kits-material] tbody tr");
    expect(linhas).toHaveLength(2);
    expect(txt(linhas[0])).toContain("2 itens");
    expect(txt(linhas[0])).toContain("2 serviço(s)");
    const custo = linhas[0].querySelector("[data-custo-kit]")!;
    expect(custo.getAttribute("data-custo-kit")).toBe("25");
    expect(txt(custo)).toMatch(/R\$\s?25,00 \(1 sem custo\)/);
    expect(txt(linhas[1])).toContain("—"); // kit vazio: sem itens, sem custo
    expect(document.body.textContent).toContain("Alterar o kit atualiza todos os serviços que o usam");
  });

  it("editor: itens com produto + quantidade (pílula do comportamento e custo); grava nome + itens pela rota genérica; a conferência pura barra quantidade zero", async () => {
    const { TelaKitsMaterial } = await import("@/components/config/telas/kits-material");
    await montar(createElement(TelaKitsMaterial));
    await clicar($("[data-acao=novo-cadastro]"));
    expect($("[data-editor-kit]")).not.toBeNull();
    expect($$("[data-item-kit]")).toHaveLength(0);
    await clicar($("[data-acao=add-item-kit]"));
    await clicar($("[data-acao=add-item-kit]"));
    expect($$("[data-item-kit]")).toHaveLength(2);
    const selects = $$("[data-item-kit] select[name=produtoId]") as unknown as HTMLSelectElement[];
    // Produtos ativos da empresa; sem "+ Novo" (semCriar)
    expect([...selects[0].options].map((o) => o.textContent)).toEqual(["Selecione…", "1 · Gás R410A", "2 · Capacitor", "3 · Suporte"]);
    await escolher(selects[0], "p1"); await digitar($$("[data-quantidade-item]")[0], "0,5");
    await escolher(selects[1], "p2"); await digitar($$("[data-quantidade-item]")[1], "0");
    // Pílulas pela categoria e custo × quantidade (p1 50 × 0,5 = 25)
    expect($$("[data-item-kit] [data-comportamento]").map((e) => e.getAttribute("data-comportamento"))).toEqual(["INCLUSO_NO_SERVICO", "VENDA_A_PARTE"]);
    expect(txt($$("[data-item-kit]")[0])).toMatch(/R\$\s?25,00/);
    expect($("[data-custo-kit]")!.getAttribute("data-custo-kit")).toBe("25");
    await digitar($('[data-editor-kit] input[maxlength="120"]'), "Kit teste");
    await clicar(botao("Criar"));
    expect(txt($("[role=alert]"))).toMatch(/maior que zero/);
    expect(gravacoes("kits-material")).toHaveLength(0);
    await digitar($$("[data-quantidade-item]")[1], "2");
    await clicar(botao("Criar"));
    expect(gravacoes("kits-material").map((c) => [c.metodo, c.corpo])).toEqual([["POST", { nome: "Kit teste", descricao: null, itens: [{ produtoId: "p1", quantidade: "0,5" }, { produtoId: "p2", quantidade: "2" }] }]]);
    // Editar um kit existente: carrega os itens do registro único e manda só o que está na tela
    await clicar($$('button[aria-label^="Editar"]')[0]);
    expect(chamadas.some((c) => c.url === "/api/cadastros/kits-material/k1")).toBe(true);
    expect($$("[data-item-kit]")).toHaveLength(2);
    await clicar($$('[data-item-kit] button[aria-label^="Tirar"]')[1]);
    await clicar(botao("Salvar"));
    expect(gravacoes("kits-material").at(-1)).toMatchObject({ metodo: "PATCH", url: "/api/cadastros/kits-material/k1", corpo: { nome: "Kit instalação", itens: [{ produtoId: "p1", quantidade: "0.5" }] } });
  });
});

describe("Serviço › Materiais padrão", () => {
  const abrirServico = async (i: number) => {
    const { TelaServicos } = await import("@/components/config/telas/servicos");
    await montar(createElement(TelaServicos));
    await clicar($$('button[aria-label^="Editar"]')[i]);
    await esperar();
  };

  it("lista: coluna Materiais (contagem); seção carrega a composição com o kit aberto × quantidade e o resumo do custo dos inclusos; salvar sem mexer NÃO manda `materiais`", async () => {
    await abrirServico(0);
    expect($$("[data-cadastro=servicos] thead th").map(txt)).toContain("Materiais");
    expect($$("[data-cadastro=servicos] tbody tr").map((l) => txt(l.querySelector("[data-materiais]")) || "—")).toEqual(["2 linhas", "—"]);
    const secao = $("[data-secao-materiais]")!;
    expect(secao).not.toBeNull();
    expect(secao.getAttribute("data-linhas")).toBe("2");
    const linhas = $$("[data-linha-material]");
    expect(linhas.map((l) => l.getAttribute("data-linha-material"))).toEqual(["produto", "kit"]);
    // Produto solto: pela categoria (peça = venda à parte)
    expect($<HTMLSelectElement>('[data-linha-material=produto] select[name=comportamento]')!.value).toBe("");
    expect(txt($('[data-linha-material=produto] select[name=comportamento] option[value=""]'))).toBe("Pela categoria (Venda à parte)");
    expect(linhas[0].querySelector("[data-comportamento]")!.getAttribute("data-comportamento")).toBe("VENDA_A_PARTE");
    // Kit aberto: itens × 2 kits, com a pílula pela categoria de cada produto e o custo
    const itensKit = $$("[data-itens-do-kit] [data-kit-item]");
    expect(itensKit.map(txt)).toEqual([expect.stringMatching(/^Gás R410A 1 kg Incluso no serviço R\$\s?50,00$/), expect.stringMatching(/^Suporte 4 un Incluso no serviço sem custo de compra$/)]);
    // Resumo: inclusos = gás 1 kg × 50 = 50 (suporte sem custo); à parte = capacitor 1 × 30
    const resumo = $("[data-resumo-custo]")!;
    expect(resumo.getAttribute("data-inclusos")).toBe("50");
    expect(resumo.getAttribute("data-a-parte")).toBe("30");
    expect(txt(resumo)).toMatch(/Custo dos materiais inclusos: R\$\s?50,00/);
    expect(txt(resumo)).toMatch(/Peças cobradas à parte: R\$\s?30,00 \(1 item\)/);
    expect(txt(resumo)).toContain("1 produto sem custo de compra");
    expect(resumo.querySelector("[data-dica]")!.closest("button, a")).toBe(resumo.querySelector("[data-dica]")); // o ⓘ é o próprio botão, não está dentro de outro
    // Salvar sem mexer em nada: o formulário não manda `materiais` (nem fecha por "nada mudou" com a composição)
    await digitar($('input[value="Instalação split"]'), "Instalação split 12k");
    await clicar(botao("Salvar"));
    expect(gravacoes("servicos")).toEqual([{ url: "/api/cadastros/servicos/s1", metodo: "PATCH", corpo: { nome: "Instalação split 12k" } }]);
  });

  it("adicionar material e kit manda o JSON em `materiais`; override por linha; tirar linha; serviço novo sem composição manda materiais vazio", async () => {
    await abrirServico(1);
    expect($("[data-sem-materiais]")).not.toBeNull();
    expect($("[data-resumo-custo]")).toBeNull();
    await clicar($("[data-acao=add-material]"));
    await escolher($('[data-linha-material=produto] select[name=produtoId]'), "p1");
    await digitar($('[data-linha-material=produto] [data-quantidade-material]'), "1,5");
    await escolher($('[data-linha-material=produto] select[name=comportamento]'), "VENDA_A_PARTE");
    await clicar($("[data-acao=add-kit]"));
    const selKit = $<HTMLSelectElement>('[data-linha-material=kit] select[name=kitId]')!;
    expect([...selKit.options].map((o) => o.textContent)).toEqual(["Selecione…", "Kit instalação", "Kit vazio"]);
    await escolher(selKit, "k1");
    expect($$("[data-itens-do-kit] [data-kit-item]")).toHaveLength(2);
    // Resumo: o gás com override vira "à parte" (1,5 × 50 = 75); o kit × 1: gás 0,5 × 50 = 25 incluso
    const resumo = $("[data-resumo-custo]")!;
    expect(resumo.getAttribute("data-a-parte")).toBe("75");
    expect(resumo.getAttribute("data-inclusos")).toBe("25");
    await clicar(botao("Salvar"));
    const corpo = gravacoes("servicos").at(-1)!.corpo;
    expect(Object.keys(corpo)).toEqual(["materiais"]);
    expect(JSON.parse(corpo.materiais)).toEqual([
      { produtoId: "p1", kitId: null, quantidade: "1,5", comportamento: "VENDA_A_PARTE" },
      { produtoId: null, kitId: "k1", quantidade: "1", comportamento: null },
    ]);
    // Tirar as duas linhas e salvar manda [] (limpa a composição)
    await clicar($$('button[aria-label^="Editar"]')[1]);
    await esperar();
    await clicar($("[data-acao=add-material]"));
    await clicar($('[data-linha-material] button[aria-label^="Tirar"]'));
    expect($("[data-sem-materiais]")).not.toBeNull();
    await clicar(botao("Salvar"));
    expect(JSON.parse(gravacoes("servicos").at(-1)!.corpo.materiais)).toEqual([]);
    // Serviço novo sem mexer na seção: `materiais` vai vazio (o servidor entende como lista vazia)
    await clicar($("[data-acao=novo-cadastro]"));
    await digitar($('input[placeholder="Ex: Manutenção Preventiva"]'), "Higienização");
    await clicar(botao("Salvar"));
    expect(gravacoes("servicos").at(-1)).toMatchObject({ metodo: "POST", corpo: { nome: "Higienização", materiais: "" } });
  });
});
