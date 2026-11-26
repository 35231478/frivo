// @vitest-environment happy-dom
/**
 * Orçamento, leva B — o Editar orçamento num DOM de verdade:
 *  - com "Ver custo e margem": cada produto mostra disponível, custo, lucro e margem; o capacitor que passa do estoque
 *    avisa "faltam"; materiais mostram "Disp." e o custo; no fim, o resumo de custo, lucro bruto e margem;
 *  - SEM a permissão: disponível sim; nenhum custo, lucro, margem, "Custo interno" ou resumo — e o salvar não manda custo;
 *  - Estoque desligado (a rota diz estoque=false): nada de "Disponível", a tela segue normal;
 *  - "Sem ISS" e "Anexos da proposta": o porquê foi para o ⓘ (sem parágrafo explicativo na tela).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/o1/editar", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const MATERIAIS = [
  { id: "m1", produtoId: "tubo", descricao: "Tubo de cobre", unidade: "m", comportamento: "INCLUSO_NO_SERVICO", quantidade: 3, quantidadePadrao: 3, valorVendaUnit: 0, custoUnit: 12, origem: "SOLTO", kitNome: null },
  { id: "m2", produtoId: "fita", descricao: "Fita à mão", unidade: "un", comportamento: "INCLUSO_NO_SERVICO", quantidade: 1, quantidadePadrao: 1, valorVendaUnit: 0, custoUnit: null, origem: "SOLTO", kitNome: null },
];
const semCusto = (ms: typeof MATERIAIS) => ms.map(({ custoUnit: _c, ...m }) => m);
const inicial = (materiais: unknown[]) => ({
  id: "o1", nome: "Climatização", codigo: "ORC-0001", clienteId: "c1", tipo: "SERVICO", descricao: null, observacao: null,
  validadeEm: null, prazoExecucao: null, formaPagamento: null, garantiaServico: null, garantiaPecas: null, naoIncluso: null, normas: [],
  unidadeId: null, contatoClienteId: null, descontoServicos: 0, tipoDescontoServicos: "VALOR", descontoProdutos: 0, tipoDescontoProdutos: "VALOR",
  issAliquota: 0, proposta: {},
  servicos: [{ id: "s1", catalogoId: "sInst", descricao: "Instalação", quantidade: 1, valorUnitario: 400, valorTotal: 400, observacao: null, valorManual: false, materiais }],
  produtos: [
    { id: "p1", catalogoId: "filtro", descricao: "Filtro G4", quantidade: 4, valorUnitario: 89.9, valorTotal: 359.6, observacao: null },
    { id: "p2", catalogoId: "cap", descricao: "Capacitor 35uF", quantidade: 2, valorUnitario: 30, valorTotal: 60, observacao: null },
  ],
  ordensServicoIds: [], osPreCarregadas: [],
});
const BASE = {
  mode: "editar",
  clientes: [{ id: "c1", nome: "Hospital" }],
  catalogoServicos: [{ id: "sInst", nome: "Instalação", descricao: null, unidade: "UN", valorPadrao: 400, temMateriais: true }],
  catalogoProdutos: [
    { id: "filtro", nome: "Filtro G4", descricao: null, unidade: "un", valorPadrao: 89.9 },
    { id: "cap", nome: "Capacitor 35uF", descricao: null, unidade: "un", valorPadrao: 30 },
  ],
  tecnicos: [], termoTemplates: [], issAliquota: 0, iaDisponivel: false,
  padroes: { validadeDias: 15, garantiaServico: "", garantiaPecas: "", naoIncluso: "", normas: [], responsavelTecnicoId: null },
};
const SITUACAO_ADMIN = {
  estoque: true, verCusto: true,
  produtos: {
    filtro: { unidade: "un", disponivel: 4, custo: 38.5 }, cap: { unidade: "un", disponivel: -1, custo: 21 },
    tubo: { unidade: "m", disponivel: 30, custo: 12 }, fita: { unidade: "un", disponivel: null, custo: null },
  },
};
const SITUACAO_VENDEDOR = {
  estoque: true, verCusto: false,
  produtos: { filtro: { unidade: "un", disponivel: 4 }, cap: { unidade: "un", disponivel: -1 }, tubo: { unidade: "m", disponivel: 30 }, fita: { unidade: "un", disponivel: null } },
};

beforeAll(async () => {
  await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider"), import("@/components/orcamento/totais-bloco")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  respostas = { "PUT /api/orcamentos/o1": { status: 200, corpo: { id: "o1" } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const texto = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();

async function montar(permissoes: Permissoes, situacao: unknown, materiais: unknown[]) {
  respostas["GET /api/orcamentos/situacao-produtos"] = { status: 200, corpo: situacao };
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { OrcamentoForm } = await import("@/components/forms/orcamento-form");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OrcamentoForm as any, { ...BASE, inicial: inicial(materiais) }) }));
  });
  await esperar(320); // a situação chega depois de uma pequena espera (debounce)
}
const VENDEDOR = () => montarPermissoes({ orcamentos: ["visualizar", "criar", "editar"] });

describe("Editar orçamento — estoque e margem", () => {
  it("pede a situação dos produtos do orçamento (produtos e materiais) uma vez", async () => {
    await montar(permissoesTotais(), SITUACAO_ADMIN, MATERIAIS);
    const pedidos = chamadas.filter((c) => c.url.startsWith("/api/orcamentos/situacao-produtos"));
    expect(pedidos).toHaveLength(1);
    expect(decodeURIComponent(pedidos[0].url.split("ids=")[1]).split(",").sort()).toEqual(["cap", "filtro", "fita", "tubo"]);
  });

  it("com a permissão: disponível, custo, lucro e margem por produto; 'faltam' no que passa do estoque; resumo no fim", async () => {
    await montar(permissoesTotais(), SITUACAO_ADMIN, MATERIAIS);
    const linhas = $$("[data-info-produto]").map((e) => e.textContent!.replace(/\s+/g, " "));
    expect(linhas[0]).toMatch(/Disponível 4 un.*Custo R\$\s?154,00.*Lucro R\$\s?205,60.*Margem 57,2%/);
    expect(linhas[1]).toMatch(/Disponível -1 un · faltam 3.*Custo R\$\s?42,00.*Lucro R\$\s?18,00.*Margem 30,0%/);
    expect($$("[data-falta]").map((e) => e.getAttribute("data-falta"))).toEqual(["3"]);
    // Filtro: 4 pedidos, 4 disponíveis = cobre (sem aviso)
    expect($$("[data-info-produto]")[0].querySelector("[data-falta]")).toBeNull();
    // Materiais: disponível compacto e o custo
    expect(texto("[data-materiais-linha]")).toMatch(/Disp\. 30 m/);
    expect($$("[data-custo-material]").length).toBeGreaterThan(0);
    expect($("[data-custo-interno]")).toBeTruthy();
    // Resumo: venda 400 + 419,60 = 819,60; custo 36 (tubo) + 154 + 42 = 232; fita sem custo
    expect($("[data-valor='custo-total']")!.textContent).toMatch(/232,00/);
    expect($("[data-valor='lucro-total']")!.textContent).toMatch(/587,60/);
    expect($("[data-valor='margem-total']")!.textContent).toBe("71,7%");
    expect($("[data-itens-sem-custo]")!.getAttribute("data-itens-sem-custo")).toBe("1");
  });

  it("SEM a permissão: disponível sim, mas nenhum custo, lucro, margem, custo interno ou resumo; o salvar não manda custo", async () => {
    await montar(VENDEDOR(), SITUACAO_VENDEDOR, semCusto(MATERIAIS));
    const form = ($("form")?.textContent ?? "").replace(/\s+/g, " ");
    expect(form).toMatch(/Disponível 4 un/);
    expect(form).toMatch(/faltam 3/);
    expect(form).not.toMatch(/Custo|Lucro|Margem|sem custo/);
    expect($("[data-resumo-margem]")).toBeNull();
    expect($("[data-custo-material]")).toBeNull();
    expect($("[data-custo-interno]")).toBeNull();
    expect($("[data-custo-linha]")).toBeNull();
    // Salvar: o payload não carrega custo nenhum (o servidor decide)
    const botao = [...document.querySelectorAll("button[type='submit']")].at(-1) as HTMLButtonElement;
    await act(async () => { botao.click(); });
    await esperar(50);
    const put = chamadas.find((c) => c.metodo === "PUT");
    expect(put).toBeTruthy();
    // O formulário normaliza o material (a chave vai como null): nenhum VALOR de custo sai do navegador — e o servidor
    // ignora o que vier (testado em orcamento-estoque-margem-pg)
    const custos = put!.corpo.servicos.flatMap((s: any) => s.materiais.map((m: any) => m.custoUnit));
    expect(custos).toEqual([null, null]);
    expect(JSON.stringify(put!.corpo)).not.toMatch(/"custoUnit":\d/);
  });

  it("a permissão no perfil manda, mesmo que a rota diga verCusto=true por engano (e vice-versa)", async () => {
    await montar(VENDEDOR(), SITUACAO_ADMIN, MATERIAIS);
    expect($("[data-resumo-margem]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montar(permissoesTotais(), { ...SITUACAO_VENDEDOR }, MATERIAIS);
    expect($("[data-resumo-margem]")).toBeNull(); // o servidor disse que não: não mostra
  });

  it("Estoque desligado: nenhum 'Disponível' (a tela segue normal, com custo e margem para quem pode)", async () => {
    const { produtos } = SITUACAO_ADMIN;
    const semDisp = Object.fromEntries(Object.entries(produtos).map(([k, { disponivel: _d, ...v }]) => [k, v]));
    await montar(permissoesTotais(), { estoque: false, verCusto: true, produtos: semDisp }, MATERIAIS);
    expect(($("form")?.textContent ?? "")).not.toMatch(/Disponível|Disp\./);
    expect($("[data-disponivel]")).toBeNull();
    expect($("[data-resumo-margem]")).toBeTruthy();
  });

  it("a rota falhou: a tela não quebra e não mostra nada de estoque ou margem", async () => {
    respostas["GET /api/orcamentos/situacao-produtos"] = { status: 500, corpo: { erro: "x" } };
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const { OrcamentoForm } = await import("@/components/forms/orcamento-form");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OrcamentoForm as any, { ...BASE, inicial: inicial(MATERIAIS) }) })); });
    await esperar(320);
    expect($("[data-info-produto]")).toBeNull();
    expect($("[data-resumo-margem]")).toBeNull();
    expect($("[role='table'][aria-label='Produtos']")).toBeTruthy();
  });
});

describe("despoluição: o porquê vai para o ⓘ", () => {
  it("'Sem ISS' é curto e a explicação fica no ⓘ", async () => {
    const { TotaisBloco } = await import("@/components/orcamento/totais-bloco");
    const { calcularOrcamento } = await import("@/lib/orcamentos/calculo");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    const totais = calcularOrcamento({ servicos: [{ quantidade: 1, valorUnitario: 100 }], produtos: [], issAliquota: 0 } as any);
    const d = { valor: 0, tipo: "VALOR" } as any;
    await act(async () => { root.render(createElement(TotaisBloco, { totais, descontoServicos: d, descontoProdutos: d, onDescontoServicos: () => {}, onDescontoProdutos: () => {} })); });
    const semIss = $("[data-sem-iss]")!;
    expect(semIss.textContent!.trim()).toBe("Sem ISS");
    expect(semIss.querySelector("button, [role='button'], [aria-label]")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/alíquota 0% em Configurações\)/);
  });
});

describe("custo de compra no editor de kit e nos materiais do serviço (lib/estoque/custo-acesso)", () => {
  async function montarComposicao(permissoes: Permissoes) {
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const { useCustosProdutos, CustoDoMaterial, ResumoCustoMateriais } = await import("@/components/estoque/composicao");
    function Harness() {
      const { custos } = useCustosProdutos(["tubo"]);
      return createElement("div", { "data-harness": custos ? "com" : "sem" },
        createElement(CustoDoMaterial, { produtoId: "tubo", quantidade: 2, custos }),
        createElement(ResumoCustoMateriais, { materiais: [{ produtoId: "tubo", quantidade: 2, comportamento: "INCLUSO_NO_SERVICO" }] as any, custos }));
    }
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(Harness) })); });
    await esperar(20);
  }
  const pedidosCustos = () => chamadas.filter((c) => c.url.startsWith("/api/estoque/custos"));

  it("sem Estoque › visualizar nem Orçamentos › ver custo: nem pede ao servidor, e nenhum custo aparece", async () => {
    await montarComposicao(montarPermissoes({ configuracoes: ["gerenciar"] }));
    expect(pedidosCustos()).toHaveLength(0);
    expect($("[data-harness]")!.getAttribute("data-harness")).toBe("sem");
    expect($("[data-resumo-custo]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/R\$|sem custo/);
  });

  it("com Estoque › visualizar (ou ver custo): busca e mostra o custo", async () => {
    respostas["GET /api/estoque/custos"] = { status: 200, corpo: { custos: { tubo: 12 } } };
    await montarComposicao(montarPermissoes({ configuracoes: ["gerenciar"], estoque: ["visualizar"] }));
    expect(pedidosCustos()).toHaveLength(1);
    expect($("[data-resumo-custo]")!.getAttribute("data-inclusos")).toBe("24");
    act(() => root.unmount()); caixa.remove(); chamadas.length = 0;
    await montarComposicao(montarPermissoes({ orcamentos: ["verCusto"] }));
    expect(pedidosCustos()).toHaveLength(1);
    expect($("[data-resumo-custo]")).toBeTruthy();
  });

  it("o servidor negou (403): a tela não mostra custo nenhum", async () => {
    respostas["GET /api/estoque/custos"] = { status: 403, corpo: { erro: "Sem permissão para ver custo de compra" } };
    await montarComposicao(montarPermissoes({ estoque: ["visualizar"] }));
    expect($("[data-harness]")!.getAttribute("data-harness")).toBe("sem");
    expect($("[data-resumo-custo]")).toBeNull();
  });
});
