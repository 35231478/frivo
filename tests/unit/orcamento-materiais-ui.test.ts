// @vitest-environment happy-dom
/**
 * Estoque E3.3 — materiais e peças no construtor de orçamento, num DOM de verdade (API simulada):
 *  - serviço com composição entra com o painel "Materiais e peças" (kit explodido em itens; pílula pela categoria;
 *    custo interno só no painel);
 *  - mudar a quantidade de um material incluso ajusta a linha do serviço (tubo 3→5 = +40) e o subtotal; a peça
 *    aparece na tabela de produtos como linha derivada (só leitura), cobrada à parte; o payload leva o snapshot,
 *    o total que vale e NÃO manda a peça como produto;
 *  - valor manual na linha (badge + "Recalcular"); tirar material da composição = "não usado" (abate); avulso;
 *  - serviço sem composição ganha o painel sob demanda; o documento do cliente não mostra material nenhum;
 *  - "Definir categoria" em massa na tela de Produtos: botão, formulário (Escolha… / Sem categoria / ativas) e o lote.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

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
  await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider"), import("@/components/config/telas/produtos"), import("@/components/orcamento/orcamento-documento")]);
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
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v); sel!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montarForm(props: Record<string, unknown> = {}) {
  const [{ OrcamentoForm }, { PermissoesProvider }] = await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider")]);
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

describe("materiais e peças no construtor", () => {
  it("serviço com composição entra com o painel (kit explodido, pílulas, custo interno); tubo 3→5 ajusta a linha (+40); a peça vira linha de produto derivada; o payload leva o snapshot e não manda a peça", async () => {
    await montarForm();
    await adicionar("Buscar serviço por nome ou código...", "Instalação split");
    expect(chamadas.some((c) => c.url === "/api/orcamentos/materiais-padrao?servicoId=s1&clienteId=c1")).toBe(true);
    const painel = $("[data-materiais-linha]")!;
    expect(painel).not.toBeNull();
    expect(painel.getAttribute("data-total-materiais")).toBe("4");
    expect($$("[data-material]").map((m) => [m.getAttribute("data-material"), m.getAttribute("data-comportamento-material")])).toEqual([["tubo", "INCLUSO_NO_SERVICO"], ["filtro", "INCLUSO_NO_SERVICO"], ["suporte", "INCLUSO_NO_SERVICO"], ["cap", "VENDA_A_PARTE"]]);
    expect(txt($("[data-material='tubo']"))).toContain("Kit Kit instalação");
    expect(txt($("[data-material='tubo']"))).toMatch(/custo R\$\s?36,00/); // 3 × 12 — só no painel interno
    expect(txt($("[data-material='suporte']"))).toContain("sem custo");
    // No padrão: linha vale a base (800); a peça já aparece como produto derivado (1 × 80)
    expect(campo(linhasServico()[0], "total").value).toBe("800,00");
    expect(linhasProduto().map((l) => [l.getAttribute("data-linha-derivada"), txt(l.querySelector("[data-peca-de]")), txt(l.querySelector("[data-campo='total']"))])).toEqual([["true", "Peça · Instalação split", "R$ 80,00"]]);
    expect(linhasProduto()[0].querySelector("button[aria-label^='Remover']")).toBeNull();
    // Tubo 3 → 5: +2 × 20 = +40 na linha do serviço
    await digitar(materialQtd("tubo"), "5");
    expect($("[data-ajuste]")!.getAttribute("data-ajuste")).toBe("40");
    expect(txt($("[data-material='tubo'] [data-diferenca]"))).toMatch(/\+R\$\s?40,00/);
    expect(campo(linhasServico()[0], "total").value).toBe("840,00");
    expect(txt($("[aria-label='Serviços']")!.closest("div")!.parentElement!.querySelector("[data-subtotal-grupo]"))).toMatch(/840,00/);
    // Peça 1 → 2: a linha de produto derivada acompanha; o serviço não muda
    await digitar(materialQtd("cap"), "2");
    expect(txt(linhasProduto()[0].querySelector("[data-campo='total']"))).toMatch(/160,00/);
    expect(campo(linhasServico()[0], "total").value).toBe("840,00");
    expect(txt($("[data-resumo-materiais]"))).toMatch(/1 peça vai como linha de produto, cobrada à parte: R\$\s?160,00/);
    expect(txt($("[data-resumo-materiais]"))).toMatch(/Custo interno .*: R\$\s?170,00 · 1 sem custo/); // tubo 5 × 12 + filtro 20 + cap 2 × 45; suporte sem custo
    const corpo = await salvar();
    expect(corpo.servicos).toHaveLength(1);
    expect(corpo.servicos[0]).toMatchObject({ catalogoId: "s1", valorUnitario: 800, valorTotal: 840, valorManual: false });
    expect(corpo.servicos[0].materiais.map((m: any) => [m.produtoId, m.quantidade, m.quantidadePadrao, m.valorVendaUnit, m.custoUnit, m.origem])).toEqual([["tubo", 5, 3, 20, 12, "KIT"], ["filtro", 1, 1, 35, 20, "KIT"], ["suporte", 1, 1, 60, null, "SOLTO"], ["cap", 2, 1, 80, 45, "SOLTO"]]);
    expect(corpo.produtos).toEqual([]);
  });

  it("valor manual na linha (badge + Recalcular); 'tirar' material da composição = não usado (abate 60); avulso entra integral; serviço sem composição ganha o painel sob demanda", async () => {
    await montarForm();
    await adicionar("Buscar serviço por nome ou código...", "Instalação split");
    await digitar(materialQtd("tubo"), "5");
    // Total digitado na mão
    await digitar(campo(linhasServico()[0], "total"), "1000");
    expect(linhasServico()[0].getAttribute("data-valor-manual")).toBe("true");
    expect(txt(linhasServico()[0])).toContain("Valor manual");
    expect(txt($("[data-materiais-linha] [data-valor-manual]"))).toMatch(/Valor manual na linha: R\$\s?1\.000,00/);
    await clicar($("[data-recalcular]"));
    expect(linhasServico()[0].getAttribute("data-valor-manual")).toBeNull();
    expect(campo(linhasServico()[0], "total").value).toBe("840,00");
    // Tirar o suporte (padrão 1 × 60): fica "não usado" e abate: +40 − 60 = −20 → 780
    await clicar($("[data-material='suporte'] button[aria-label^='Tirar']"));
    expect($("[data-material='suporte']")!.getAttribute("data-nao-usado")).toBe("true");
    expect($("[data-ajuste]")!.getAttribute("data-ajuste")).toBe("-20");
    expect(campo(linhasServico()[0], "total").value).toBe("780,00");
    await clicar($("[data-material='suporte'] button[aria-label^='Voltar a usar']"));
    expect($("[data-ajuste]")!.getAttribute("data-ajuste")).toBe("40");
    // Avulso (padrão 0): entra integral (1 × 15) e some de vez ao tirar
    await escolher($("select[name='material-avulso']"), "fita");
    expect($("[data-materiais-linha]")!.getAttribute("data-total-materiais")).toBe("5");
    expect(txt($("[data-material='fita']"))).toContain("Avulso");
    expect($("[data-ajuste]")!.getAttribute("data-ajuste")).toBe("55");
    await clicar($("[data-material='fita'] button[aria-label^='Tirar']"));
    expect($("[data-materiais-linha]")!.getAttribute("data-total-materiais")).toBe("4");
    // Serviço sem composição: nada é buscado; "+ Materiais e peças" abre o painel vazio
    await adicionar("Buscar serviço por nome ou código...", "Limpeza");
    expect(chamadas.filter((c) => c.url.includes("materiais-padrao?servicoId=")).map((c) => c.url)).toEqual(["/api/orcamentos/materiais-padrao?servicoId=s1&clienteId=c1"]);
    expect($$("[data-materiais-linha]")).toHaveLength(1);
    await clicar($("[data-adicionar-materiais]"));
    expect($$("[data-materiais-linha]")).toHaveLength(2);
    expect($$("[data-materiais-linha]")[1].getAttribute("data-total-materiais")).toBe("0");
  });

  it("edição: as linhas gravadas abrem com o painel e a peça derivada; o documento do cliente mostra só o serviço ajustado e a peça (nenhum material, nenhum custo)", async () => {
    const materiais = MATERIAIS.map((m, i) => ({ ...m, id: `m${i}`, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade }));
    await montarForm({ mode: "editar", inicial: {
      id: "o1", nome: "Instalação UTI", codigo: "ORC-1", clienteId: "c1", descontoServicos: 0, tipoDescontoServicos: "VALOR", descontoProdutos: 0, tipoDescontoProdutos: "VALOR", issAliquota: 0,
      servicos: [{ id: "ls1", catalogoId: "s1", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 840, valorManual: false, materiais }],
      produtos: [], ordensServicoIds: [],
    } });
    expect($("[data-materiais-linha]")!.getAttribute("data-total-materiais")).toBe("4");
    expect(campo(linhasServico()[0], "total").value).toBe("840,00");
    expect(linhasProduto().map((l) => l.getAttribute("data-linha-derivada"))).toEqual(["true"]);
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const html = renderToStaticMarkup(createElement(OrcamentoDocumento as any, {
      versao: "cliente",
      orcamento: { codigo: "ORC-1", nome: "Instalação UTI", status: "ENVIADO", criadoEm: new Date(), totalServicos: 840, totalProdutos: 80, totalGeral: 920,
        servicos: [{ descricao: "Instalação split", quantidade: 1, valorUnitario: 840, valorTotal: 840, valorBase: 800, ajusteMateriais: 40, materiais }],
        produtos: [{ descricao: "Capacitor 35uF", quantidade: 1, valorUnitario: 80, valorTotal: 80, materialId: "m3" }] },
      empresa: { nome: "Clima Total", cnpj: "12345678000190" }, cliente: { nome: "Hospital", cpfCnpj: "22101333000111" },
    }));
    const texto = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(texto).toMatch(/Instalação split.*840,00/);
    expect(texto).toMatch(/Capacitor 35uF.*80,00/);
    expect(texto).toMatch(/920,00/);
    expect(texto).not.toMatch(/Tubo|Filtro secador|Suporte|custo|material|ajuste/i);
  });
});

describe("'Definir categoria' em massa (tela de Produtos)", () => {
  async function montarProdutos(permissoes: Permissoes) {
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const { TelaProdutos } = await import("@/components/config/telas/produtos");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(TelaProdutos) })); });
    await esperar(); await esperar();
  }
  const selecionar = async (...nomes: string[]) => { for (const n of nomes) await clicar($(`input[aria-label="Selecionar ${n}"]`)); };
  const botaoDefinir = () => $<HTMLButtonElement>('[data-acao-massa="definir-categoria"]');
  const confirmar = () => $<HTMLButtonElement>('[data-acao="confirmar-massa"]')!;

  it("botão só com Configurações › gerenciar; o modal exige escolher (Escolha… / Sem categoria / ativas); o lote leva categoriaProdutoId; 'Sem categoria' manda null", async () => {
    await montarProdutos(montarPermissoes({ configuracoes: ["visualizar"] }));
    // Sem "gerenciar" não há ação em massa nenhuma nos produtos (nem a seleção aparece)
    const caixaSel = $('input[aria-label="Selecionar Gás R410A"]');
    if (caixaSel) await clicar(caixaSel);
    expect(botaoDefinir()).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montarProdutos(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }));
    await selecionar("Gás R410A", "Capacitor");
    await clicar(botaoDefinir());
    expect($("[data-modal-massa]")).not.toBeNull();
    expect(txt($("[data-modal-massa]"))).toContain("Definir categoria 2 produtos");
    const sel = $<HTMLSelectElement>("[data-form-definir-categoria] select[name='categoriaProdutoId']")!;
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([["__", "Escolha…"], ["", "Sem categoria (tirar a categoria)"], ["cPecas", "Peças — Venda à parte"], ["cMat", "Materiais — Incluso no serviço"]]);
    expect(confirmar().disabled).toBe(true);
    await escolher(sel, "cMat");
    expect(confirmar().disabled).toBe(false);
    await clicar(confirmar());
    const lote = chamadas.find((c) => c.url === "/api/acoes-massa")!.corpo;
    expect(lote).toMatchObject({ entidade: "produtos", acao: "definir-categoria", ids: ["p1", "p2"], dados: { categoriaProdutoId: "cMat" } });
    expect(txt($("[data-modal-massa]"))).toMatch(/2 atualizados/);
    // "Sem categoria" manda null
    await clicar($("[data-modal-massa] button[aria-label='Fechar']"));
    await selecionar("Gás R410A");
    await clicar(botaoDefinir());
    await escolher($("[data-form-definir-categoria] select[name='categoriaProdutoId']"), "");
    await clicar(confirmar());
    expect(chamadas.filter((c) => c.url === "/api/acoes-massa").at(-1)!.corpo.dados).toEqual({ categoriaProdutoId: null });
  });
});
