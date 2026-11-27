// @vitest-environment happy-dom
/**
 * "Orçamento E — Material × Peça", num DOM de verdade (API simulada):
 *  - no construtor, cada material do serviço tem o botão Material/Peça: trocar vale SÓ neste orçamento (o snapshot
 *    muda; o cadastro do produto não é chamado). Virou Peça: sai do serviço e ganha linha própria com valor; virou
 *    Material: some da tabela de produtos e vai para dentro do serviço; o payload leva o comportamento trocado;
 *  - leitura (orçamento travado, OS): pílula com o termo, sem botão;
 *  - a observação do item fica logo abaixo da descrição (a coluna "Observação" do meio saiu).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";
import { escolherNaBusca } from "../util/busca-select";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: nav.back }),
  usePathname: () => "/orcamentos/novo", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const M = (produtoId: string, descricao: string, quantidade: number, valorVendaUnit: number, comportamento: string, custoUnit: number | null, origem = "SOLTO", kitNome: string | null = null, unidade = "un") =>
  ({ produtoId, descricao, unidade, comportamento, quantidade, quantidadePadrao: quantidade, valorVendaUnit, custoUnit, origem, kitNome });
const MATERIAIS = [
  M("tubo", "Tubo de cobre 1/4", 3, 20, "INCLUSO_NO_SERVICO", 12, "KIT", "Kit instalação", "m"),
  M("filtro", "Filtro secador", 1, 35, "INCLUSO_NO_SERVICO", 20, "KIT", "Kit instalação"),
  M("suporte", "Suporte", 1, 60, "INCLUSO_NO_SERVICO", null),
  M("cap", "Capacitor 35uF", 1, 80, "VENDA_A_PARTE", 45),
];
const BASE = {
  clientes: [{ id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }],
  catalogoServicos: [{ id: "s1", nome: "Instalação split", descricao: null, unidade: "un", valorPadrao: 800, temMateriais: true }, { id: "s2", nome: "Limpeza", descricao: null, unidade: "un", valorPadrao: 150, temMateriais: false }],
  catalogoProdutos: [{ id: "fita", nome: "Fita", descricao: null, unidade: "un", valorPadrao: 15 }, { id: "cap", nome: "Capacitor 35uF", descricao: null, unidade: "un", valorPadrao: 80 }],
  tecnicos: [], termoTemplates: [], clienteIdInicial: "c1",
};
const CATEGORIAS = [{ id: "cPecas", nome: "Peças", comportamento: "VENDA_A_PARTE", ativo: true }, { id: "cMat", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO", ativo: true }, { id: "cOff", nome: "Antiga", comportamento: "INCLUSO_NO_SERVICO", ativo: false }];
const PRODUTOS = [
  { id: "p1", codigo: 1, nome: "Gás R410A", unidade: "kg", ativo: true, categoriaProdutoId: null, categoriaProduto: null, controlaEstoque: true },
  { id: "p2", codigo: 2, nome: "Capacitor", unidade: "un", ativo: true, categoriaProdutoId: "cPecas", categoriaProduto: CATEGORIAS[0], controlaEstoque: true },
];

beforeAll(async () => {
  // Um de cada vez, com os avisos primeiro: importar em paralelo cria duas cópias do módulo
  // simulado e o teste passaria a ler um `toast` que não é o da tela
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/forms/orcamento-form"),
    () => import("@/components/providers/permissoes-provider"),
    () => import("@/components/config/telas/produtos"),
    () => import("@/components/orcamento/orcamento-documento"),
  ]) await m();
}, 120_000);

beforeEach(() => {
  chamadas.length = 0; nav.push.mockClear();
  respostas = {
    "GET /api/clientes/c1/tabela-preco": { status: 200, corpo: null },
    "POST /api/orcamentos": { status: 201, corpo: { id: "o1" } },
    "GET /api/orcamentos/materiais-padrao?servicoId=s1": { status: 200, corpo: { materiais: MATERIAIS } },
    "GET /api/orcamentos/materiais-padrao?produtoId=fita": { status: 200, corpo: { material: { ...M("fita", "Fita", 1, 15, "INCLUSO_NO_SERVICO", null, "AVULSO"), quantidadePadrao: 0 } } },
    "GET /api/cadastros/categorias-produto": { status: 200, corpo: CATEGORIAS },
    "GET /api/cadastros/produtos": { status: 200, corpo: { itens: PRODUTOS, total: 2, pagina: 1, porPagina: 50, contagens: { ativos: 2, inativos: 0, todos: 2 } } },
    "GET /api/preferencias": { status: 200, corpo: { valor: null } },
    "POST /api/acoes-massa": { status: 200, corpo: { resultados: [{ id: "p1", rotulo: "Gás R410A", ok: true, detalhe: "Categoria: Materiais" }, { id: "p2", rotulo: "Capacitor", ok: true, detalhe: "Categoria: Materiais" }], resumo: { total: 2, feitas: 2, naoPuderam: 0 } } },
  };
  vi.stubGlobal("confirm", vi.fn(() => true));
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

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (texto: string) => $$<HTMLButtonElement>("button").find((b) => txt(b) === texto);
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(sel: Element | null | undefined, v: string) {
  expect(sel).toBeTruthy();
  // O seletor de cadastro virou o campo COM BUSCA da casa: aqui o teste faz o que a pessoa
  // faz (abre a lista e clica). O <select> nativo (enum curto) continua sendo setado direto.
  if (!(sel instanceof HTMLSelectElement)) { await escolherNaBusca(sel, v); await esperar(); return; }
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v); sel!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montarForm(props: Record<string, unknown> = {}) {
  const { OrcamentoForm } = await import("@/components/forms/orcamento-form");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OrcamentoForm as any, { mode: "novo", ...BASE, ...props }) })); });
  await esperar();
}
async function adicionar(busca: string, nome: string) {
  await digitar($(`input[placeholder='${busca}']`), nome.slice(0, 5));
  await clicar($$("button").find((b) => b.textContent?.includes(nome)));
}
const linhasServico = () => $$("[aria-label='Serviços'] [data-item-linha]");
const linhasProduto = () => $$("[aria-label='Produtos'] [data-item-linha]");
const campo = (linha: Element, c: string) => linha.querySelector<HTMLInputElement>(`[data-campo='${c}']`)!;
const materialQtd = (produtoId: string) => $(`[data-material='${produtoId}'] [data-qtd-material]`);
async function salvar() {
  await digitar($("input[data-nome-orcamento]"), "Instalação UTI");
  await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await esperar();
  return chamadas.find((c) => c.metodo === "POST" && c.url === "/api/orcamentos")?.corpo;
}

const trocar = (produtoId: string) => $(`[data-material='${produtoId}'] [data-trocar-uso]`);
const comportamento = (produtoId: string) => $(`[data-material='${produtoId}']`)!.getAttribute("data-comportamento-material");
const descricoesProdutos = () => linhasProduto().map((l) => l.querySelector<HTMLInputElement>("input[aria-label='Descrição do item']")?.value);

describe("trocar Material × Peça só neste orçamento", () => {
  it("Material → Peça: sai do serviço e vira linha própria com valor; Peça → Material: some dos produtos; o payload leva a troca; o cadastro não é chamado", async () => {
    await montarForm();
    await adicionar("Pesquisar serviço por nome ou código...", "Instalação split");
    // o botão mostra o Uso atual e diz o que faz
    expect(txt(trocar("suporte"))).toBe("Material");
    expect(trocar("suporte")!.getAttribute("title")).toBe("Trocar para Peça só neste orçamento (o cadastro não muda)");
    expect(txt(trocar("cap"))).toBe("Peça");
    expect(trocar("cap")!.getAttribute("title")).toBe("Trocar para Material só neste orçamento (o cadastro não muda)");
    expect(descricoesProdutos()).toEqual(["Capacitor 35uF"]);
    expect(campo(linhasServico()[0], "total").value).toBe("800,00");

    // Suporte (Material, 1 × 60) vira Peça: linha própria de 60; o serviço fica na base
    await clicar(trocar("suporte"));
    expect(comportamento("suporte")).toBe("VENDA_A_PARTE");
    expect(txt(trocar("suporte"))).toBe("Peça");
    expect(linhasProduto()).toHaveLength(2);
    const suporte = linhasProduto().find((l) => l.querySelector<HTMLInputElement>("input[aria-label='Descrição do item']")?.value === "Suporte")!;
    expect(suporte.getAttribute("data-linha-derivada")).toBe("true");
    expect(txt(suporte.querySelector("[data-campo='total']"))).toMatch(/60,00/);
    expect(campo(linhasServico()[0], "total").value).toBe("800,00");

    // Capacitor (Peça) vira Material: some da tabela de produtos e passa a ir dentro do serviço
    await clicar(trocar("cap"));
    expect(comportamento("cap")).toBe("INCLUSO_NO_SERVICO");
    expect(descricoesProdutos()).toEqual(["Suporte"]);
    expect(campo(linhasServico()[0], "total").value).toBe("800,00");

    const corpo = await salvar();
    expect(corpo.servicos[0].materiais.map((m: any) => [m.produtoId, m.comportamento])).toEqual([
      ["tubo", "INCLUSO_NO_SERVICO"], ["filtro", "INCLUSO_NO_SERVICO"], ["suporte", "VENDA_A_PARTE"], ["cap", "INCLUSO_NO_SERVICO"],
    ]);
    // só neste orçamento: nenhuma gravação no cadastro
    expect(chamadas.filter((c) => c.metodo !== "GET" && c.url.startsWith("/api/cadastros"))).toEqual([]);
  });

  it("peça com quantidade acima do padrão vira Material: o ajuste do serviço passa a contar; e volta", async () => {
    await montarForm();
    await adicionar("Pesquisar serviço por nome ou código...", "Instalação split");
    await digitar(materialQtd("cap"), "2"); // peça 2 × 80 = 160 à parte
    expect(campo(linhasServico()[0], "total").value).toBe("800,00");
    await clicar(trocar("cap")); // Material: (2 − 1) × 80 = +80 no serviço
    expect($("[data-ajuste]")!.getAttribute("data-ajuste")).toBe("80");
    expect(campo(linhasServico()[0], "total").value).toBe("880,00");
    expect(linhasProduto()).toHaveLength(0);
    await clicar(trocar("cap"));
    expect(campo(linhasServico()[0], "total").value).toBe("800,00");
    expect(txt(linhasProduto()[0].querySelector("[data-campo='total']"))).toMatch(/160,00/);
  });

  it("somente leitura: pílula com o termo, sem botão de trocar", async () => {
    const { MateriaisLinha } = await import("@/components/orcamento/materiais-linha");
    const html = renderToStaticMarkup(createElement(MateriaisLinha as any, {
      item: { id: "i1", descricao: "Instalação", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorManual: false, materiais: MATERIAIS.map((m, i) => ({ ...m, id: `m${i}` })) },
      clienteId: "c1", catalogoProdutos: [], onChange: () => {}, somenteLeitura: true, verCusto: true,
    }));
    const d = document.createElement("div"); d.innerHTML = html;
    expect(d.querySelector("[data-trocar-uso]")).toBeNull();
    expect(d.textContent).toContain("Material");
    expect(d.textContent).toContain("Peça");
    expect(d.textContent).not.toMatch(/Incluso no serviço|Venda à parte/);
  });
});

describe("observação do item: logo abaixo da descrição", () => {
  it("sem a coluna 'Observação' no meio; o campo fica na mesma célula, depois da descrição; o texto vai no payload", async () => {
    await montarForm();
    await adicionar("Pesquisar serviço por nome ou código...", "Instalação split");
    expect($$("[aria-label='Serviços'] [role=columnheader]").map(txt)).toEqual(["Descrição", "Qtd", "Unitário", "Total", "Ações"]);
    const linha = linhasServico()[0];
    expect(linha.querySelectorAll(":scope > [role=cell], :scope > label[role=cell]")).toHaveLength(5);
    const descricao = linha.querySelector("input[aria-label='Descrição do item']")!;
    const celula = descricao.closest("[role=cell]")!;
    const abrir = celula.querySelector("[data-abrir-observacao]");
    expect(txt(abrir)).toBe("Observação");
    await clicar(abrir);
    const area = celula.querySelector<HTMLTextAreaElement>("[data-observacao-item] textarea")!;
    expect(area).toBeTruthy();
    expect(descricao.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await digitar(area, "Splits da recepção");
    const corpo = await salvar();
    expect(corpo.servicos[0].observacao).toBe("Splits da recepção");
  });

  it("a linha derivada da peça não tem observação (edita-se nos materiais)", async () => {
    await montarForm();
    await adicionar("Pesquisar serviço por nome ou código...", "Instalação split");
    expect(linhasProduto()[0].getAttribute("data-linha-derivada")).toBe("true");
    expect(linhasProduto()[0].querySelector("[data-abrir-observacao], [data-observacao-item]")).toBeNull();
  });
});
