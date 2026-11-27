// @vitest-environment happy-dom
/**
 * "Orçamento E2 — regra de materiais por empresa", num DOM de verdade (API simulada), nos DOIS modos:
 *  - Configurações › Orçamento, bloco Materiais: "Como os materiais entram na cobrança" (Incluso | Cobrado à parte),
 *    o padrão vem Incluso; a escolha vai no PUT; "Mostrar a lista de materiais ao cliente" só no Incluso;
 *  - construtor: com "Cobrado à parte" o serviço fica na base e cada material vira linha própria com o preço de venda
 *    (pílula "Material · serviço"), somando no total; com "Incluso" fica como no Orçamento E; a troca Material ⇄ Peça
 *    continua valendo; o orçamento já criado usa a regra com que nasceu (não a da empresa de hoje);
 *  - documento: com "Cobrado à parte" os materiais saem como linhas com valor, e a lista "dentro do serviço" some.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: nav.back }),
  usePathname: () => "/orcamentos/novo", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast, confirmar: vi.fn(async () => true) }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const M = (produtoId: string, descricao: string, quantidade: number, valorVendaUnit: number, comportamento: string, custoUnit: number | null) =>
  ({ produtoId, descricao, unidade: "un", comportamento, quantidade, quantidadePadrao: quantidade, valorVendaUnit, custoUnit, origem: "SOLTO", kitNome: null });
// Tubo 3 × 20 = 60, suporte 1 × 60 (Material); capacitor 1 × 80 (Peça)
const MATERIAIS = [M("tubo", "Tubo de cobre", 3, 20, "INCLUSO_NO_SERVICO", 12), M("suporte", "Suporte", 1, 60, "INCLUSO_NO_SERVICO", null), M("cap", "Capacitor 35uF", 1, 80, "VENDA_A_PARTE", 45)];
const BASE = {
  clientes: [{ id: "c1", nome: "Padaria Fictícia Ltda", nomeFantasia: "Padaria Fictícia" }],
  catalogoServicos: [{ id: "s1", nome: "Instalação split", descricao: null, unidade: "un", valorPadrao: 800, temMateriais: true }],
  catalogoProdutos: [], tecnicos: [], termoTemplates: [], clienteIdInicial: "c1",
};

beforeAll(async () => {
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/forms/orcamento-form"),
    () => import("@/components/providers/permissoes-provider"),
    () => import("@/components/config/orcamento-padroes-client"),
    () => import("@/components/orcamento/orcamento-documento"),
  ]) await m();
}, 120_000);

beforeEach(() => {
  chamadas.length = 0; avisos.toast.mockClear();
  respostas = {
    "GET /api/clientes/c1/tabela-preco": { status: 200, corpo: null },
    "POST /api/orcamentos": { status: 201, corpo: { id: "o1" } },
    "GET /api/orcamentos/materiais-padrao?servicoId=s1": { status: 200, corpo: { materiais: MATERIAIS } },
    "PUT /api/configuracoes": { status: 200, corpo: { ok: true } },
    "GET /api/preferencias": { status: 200, corpo: { valor: null } },
  };
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
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}

describe("Configurações › Orçamento — bloco Materiais", () => {
  const INICIAL = { orcamentoValidadeDias: 10, orcamentoGarantiaServico: null, orcamentoGarantiaPecas: null, orcamentoNaoIncluso: null, orcamentoNormas: [] };
  async function tela(inicial: Record<string, unknown> = {}, podeEditar = true) {
    const { OrcamentoPadroesClient } = await import("@/components/config/orcamento-padroes-client");
    await montar(createElement(OrcamentoPadroesClient, { inicial: { ...INICIAL, ...inicial } as any, podeEditar }));
  }
  const opcao = (c: string) => $<HTMLInputElement>(`[data-opcao-cobranca='${c}'] input[type=radio]`)!;
  const salvar = async () => { await clicar($("[data-salvar-padroes-orcamento]")); return chamadas.find((c) => c.metodo === "PUT")!.corpo; };

  it("as duas opções com os termos fixos; sem escolha gravada vem Incluso, com a lista ao cliente visível", async () => {
    await tela();
    const bloco = $("[data-padroes-materiais]")!;
    expect(txt(bloco)).toContain("Como os materiais entram na cobrança");
    expect($$("[data-opcao-cobranca]").map((o) => [txt(o.querySelector("span")), txt(o.querySelector("span + span"))])).toEqual([
      ["Incluso no serviço", "Dentro do serviço, sem valor para o cliente."],
      ["Cobrado à parte", "Em linha própria, com valor, somando no total."],
    ]);
    expect(opcao("INCLUSO").checked).toBe(true);
    expect($("[data-padrao-mostrar-materiais]")).not.toBeNull();
    expect(txt($("[data-padrao-mostrar-materiais]"))).toContain("Mostrar a lista de materiais ao cliente");
    // a explicação fica no ⓘ, não em parágrafo na tela
    expect(txt(bloco)).not.toMatch(/Vale para os orçamentos/);
  });

  it("trocar para Cobrado à parte: a lista ao cliente some (não se aplica) e a escolha vai no PUT, sem o campo antigo com outro sentido", async () => {
    await tela();
    await act(async () => { opcao("A_PARTE").click(); }); await esperar();
    expect($("[data-cobranca-materiais]")!.getAttribute("data-cobranca-materiais")).toBe("A_PARTE");
    expect($("[data-padrao-mostrar-materiais]")).toBeNull();
    const corpo = await salvar();
    expect(corpo.orcamentoCobrancaMateriais).toBe("A_PARTE");
    expect(corpo).not.toHaveProperty("orcamentoMostrarValoresMateriais");
    expect(avisos.toast).toHaveBeenCalled();
  });

  it("empresa que já cobra à parte abre marcada; voltar para Incluso grava INCLUSO", async () => {
    await tela({ orcamentoCobrancaMateriais: "A_PARTE" });
    expect(opcao("A_PARTE").checked).toBe(true);
    await act(async () => { opcao("INCLUSO").click(); }); await esperar();
    expect((await salvar()).orcamentoCobrancaMateriais).toBe("INCLUSO");
  });

  it("sem Configurações › gerenciar: as opções ficam travadas", async () => {
    await tela({ orcamentoCobrancaMateriais: "A_PARTE" }, false);
    expect(opcao("A_PARTE").disabled).toBe(true);
    expect(opcao("INCLUSO").disabled).toBe(true);
    expect($("[data-salvar-padroes-orcamento]")).toBeNull();
  });
});

describe("Construtor do orçamento nos dois modos", () => {
  async function form(props: Record<string, unknown>) {
    const { OrcamentoForm } = await import("@/components/forms/orcamento-form");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OrcamentoForm as any, { mode: "novo", ...BASE, ...props }) }));
  }
  async function adicionarServico() {
    await digitar($("input[placeholder='Pesquisar serviço por nome ou código...']"), "Insta");
    await clicar($$("button").find((b) => b.textContent?.includes("Instalação split")));
  }
  const linhasServico = () => $$("[aria-label='Serviços'] [data-item-linha]");
  const linhasProduto = () => $$("[aria-label='Produtos'] [data-item-linha]");
  const totalServico = () => linhasServico()[0].querySelector<HTMLInputElement>("[data-campo='total']")!.value;
  const produtos = () => linhasProduto().map((l) => [
    l.querySelector<HTMLInputElement>("input[aria-label='Descrição do item']")?.value,
    l.querySelector("[data-derivada-uso]")?.getAttribute("data-derivada-uso"),
    txt(l.querySelector("[data-campo='total']")),
  ]);
  async function salvar() {
    await digitar($("input[data-nome-orcamento]"), "Instalação loja");
    await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await esperar();
    return chamadas.find((c) => c.metodo === "POST" && c.url === "/api/orcamentos")?.corpo;
  }

  it("Cobrado à parte: serviço na base; cada material vira linha com o preço de venda (pílula Material) e soma no total", async () => {
    await form({ padroes: { cobrancaMateriais: "A_PARTE" } });
    await adicionarServico();
    await digitar($("[data-material='tubo'] [data-qtd-material]"), "5"); // acima do padrão: no à parte não mexe no serviço
    expect(totalServico()).toBe("800,00");
    expect(produtos()).toEqual([
      ["Tubo de cobre", "MATERIAL", expect.stringMatching(/100,00/)],
      ["Suporte", "MATERIAL", expect.stringMatching(/60,00/)],
      ["Capacitor 35uF", "PECA", expect.stringMatching(/80,00/)],
    ]);
    expect(txt(linhasProduto()[0].querySelector("[data-derivada-uso]"))).toMatch(/^Material · /);
    expect($("[data-material='tubo'] [data-a-parte]")).not.toBeNull();
    expect($("[data-resumo-a-parte]")!.getAttribute("data-resumo-a-parte")).toBe("3");
    expect(txt($("[data-resumo-a-parte]"))).toMatch(/3 itens vão como linha de produto/);
    const corpo = await salvar();
    expect(corpo.servicos[0].valorTotal).toBe(800);
    // os materiais continuam Material no snapshot (estoque, separação e custo)
    expect(corpo.servicos[0].materiais.map((m: any) => [m.produtoId, m.comportamento])).toEqual([["tubo", "INCLUSO_NO_SERVICO"], ["suporte", "INCLUSO_NO_SERVICO"], ["cap", "VENDA_A_PARTE"]]);
  });

  it("Incluso: como no Orçamento E — o Material ajusta o serviço e só a Peça vira linha", async () => {
    await form({ padroes: { cobrancaMateriais: "INCLUSO" } });
    await adicionarServico();
    await digitar($("[data-material='tubo'] [data-qtd-material]"), "5");
    expect(totalServico()).toBe("840,00");
    expect(produtos()).toEqual([["Capacitor 35uF", "PECA", expect.stringMatching(/80,00/)]]);
    expect($("[data-material='tubo'] [data-a-parte]")).toBeNull();
  });

  it("sem regra informada (empresa antiga) = Incluso", async () => {
    await form({});
    await adicionarServico();
    expect(produtos().map((p) => p[0])).toEqual(["Capacitor 35uF"]);
  });

  it("à parte, a troca Material ⇄ Peça continua valendo: muda o rótulo da linha, não a cobrança", async () => {
    await form({ padroes: { cobrancaMateriais: "A_PARTE" } });
    await adicionarServico();
    await clicar($("[data-material='suporte'] [data-trocar-uso]"));
    expect(produtos()).toEqual([
      ["Tubo de cobre", "MATERIAL", expect.stringMatching(/60,00/)],
      ["Suporte", "PECA", expect.stringMatching(/60,00/)],
      ["Capacitor 35uF", "PECA", expect.stringMatching(/80,00/)],
    ]);
    expect(totalServico()).toBe("800,00");
  });

  it("orçamento já criado: vale a regra com que nasceu, não a da empresa de hoje", async () => {
    const inicial = {
      id: "o9", nome: "Antigo", clienteId: "c1", status: "RASCUNHO", cobrancaMateriais: "INCLUSO",
      servicos: [{ descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, materiais: MATERIAIS.map((m, i) => ({ ...m, id: `m${i}` })) }],
      produtos: [], descontoServicos: 0, descontoProdutos: 0,
    };
    await form({ mode: "editar", inicial, padroes: { cobrancaMateriais: "A_PARTE" } });
    expect(produtos().map((p) => p[0])).toEqual(["Capacitor 35uF"]);
  });
});

describe("Documento (link e PDF do cliente) nos dois modos", () => {
  const SERVICO = {
    descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800,
    materiais: [
      { descricao: "Tubo de cobre", unidade: "un", quantidade: 3, valorVendaUnit: 20, comportamento: "INCLUSO_NO_SERVICO", ordem: 0 },
      { descricao: "Capacitor 35uF", unidade: "un", quantidade: 1, valorVendaUnit: 80, comportamento: "VENDA_A_PARTE", ordem: 1 },
    ],
  };
  const LINHA = (descricao: string, total: number, materialId: string) => ({ descricao, quantidade: 1, valorUnitario: total, valorTotal: total, materialId });
  const BASE_DOC = { codigo: "ORC-1", nome: "Instalação", status: "ENVIADO", criadoEm: "2026-11-26T12:00:00Z", empresaId: "e1", servicos: [SERVICO], ordensServico: [], mostrarMateriais: true };
  async function html(extra: Record<string, unknown>) {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const d = document.createElement("div");
    d.innerHTML = renderToStaticMarkup(createElement(OrcamentoDocumento as any, { orcamento: { ...BASE_DOC, ...extra }, empresa: { nome: "Clima Fictícia", cnpj: "12345678000190" }, cliente: { nome: "Padaria", cpfCnpj: "1" }, versao: "cliente" }));
    return d;
  }

  it("Cobrado à parte: os materiais são linhas com valor em Produtos e a lista dentro do serviço some", async () => {
    const d = await html({ cobrancaMateriais: "A_PARTE", produtos: [LINHA("Tubo de cobre", 60, "m0"), LINHA("Capacitor 35uF", 80, "m1")], totalServicos: 800, totalProdutos: 140, totalGeral: 940 });
    expect(d.querySelector("[data-materiais-servico]")).toBeNull();
    const produtos = [...d.querySelectorAll("[data-grupo-documento='produtos'] [data-linha-item]")].map((l) => txt(l));
    expect(produtos[0]).toMatch(/Tubo de cobre.*60,00/);
    expect(txt(d)).toMatch(/940,00/);
  });

  it("Incluso: lista dentro do serviço, sem valor", async () => {
    const d = await html({ cobrancaMateriais: "INCLUSO", produtos: [LINHA("Capacitor 35uF", 80, "m1")], totalServicos: 800, totalProdutos: 80, totalGeral: 880 });
    expect(txt(d.querySelector("[data-materiais-servico]"))).toContain("Tubo de cobre");
    expect(txt(d.querySelector("[data-materiais-servico]"))).not.toMatch(/R\$|60,00/);
  });
});
