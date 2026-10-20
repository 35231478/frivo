// @vitest-environment happy-dom
/**
 * Estoque E2 — ajuste, telas num DOM de verdade (happy-dom), API simulada:
 *  - painel de preço: custo · preço · margem (sobre a venda) · markup (sobre o custo) AO VIVO; por margem
 *    30% com custo 100 → R$ 142,86 / 42,9%; preço fixo recalcula; o que vai para a API; limites;
 *  - conciliação: "1 UN = [13,6] kg" com o fator aprendido; mudar o fator muda o que entra e o custo;
 *    aviso "o custo mudou" (só aviso); "Ajustar preço" abre o painel com o custo DESTA nota; o fator vai
 *    no corpo do lançamento; sem fator (unidades diferentes) não lança.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: nav.refresh, replace: () => {} }) }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : null });
    const r = Object.entries(respostas).find(([k]) => url.startsWith(k))?.[1] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const txt = (sel: string) => ($(sel)?.textContent ?? "").replace(/ /g, " ");
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const botao = (t: string) => [...caixa.querySelectorAll("button")].find((b) => b.textContent?.trim().endsWith(t)) as HTMLButtonElement;

describe("painel de preço de venda", () => {
  const painel = async (extra: Record<string, unknown> = {}) => {
    const { PrecoVenda } = await import("@/components/estoque/preco-venda");
    await montar(createElement(PrecoVenda, { produtoId: "pGas", unidade: "kg", custo: 100, preco: null, margemVenda: null, podeEditar: true, ...extra }));
  };

  it("por margem: 30% sobre a venda com custo R$ 100 → preço R$ 142,86, margem 30,0%, markup 42,9% (ao vivo)", async () => {
    await painel();
    await clicar($('[data-modo="margem"]'));
    expect(txt("[data-custo]")).toBe("R$ 100,00");
    await digitar($('input[name="margem"]'), "30");
    expect(txt("[data-preco]")).toBe("R$ 142,86");
    expect(txt("[data-margem]")).toBe("30,0%");
    expect(txt("[data-markup]")).toBe("42,9%");
    respostas["/api/estoque/pGas/preco"] = { status: 200, corpo: { preco: 142.86, margemVenda: 30 } };
    await clicar($("[data-salvar-preco]"));
    expect(chamadas.at(-1)).toEqual({ url: "/api/estoque/pGas/preco", metodo: "PUT", corpo: { modo: "margem", margem: 30, custoBase: 100 } });
    expect(txt('[role="status"]')).toContain("Preço salvo: R$ 142,86.");
    expect(txt("[data-preco-salvo]")).toContain("definido por margem de 30,0% sobre a venda");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("preço fixo recalcula a margem e o markup exibidos; vai para a API como preço", async () => {
    await painel({ preco: 142.86, margemVenda: 30 });
    expect(($('input[name="margem"]') as HTMLInputElement).value).toBe("30"); // abre no modo em que foi salvo
    await clicar($('[data-modo="preco"]'));
    await digitar($('input[name="preco"]'), "150");
    expect(txt("[data-preco]")).toBe("R$ 150,00");
    expect(txt("[data-margem]")).toBe("33,3%");
    expect(txt("[data-markup]")).toBe("50,0%");
    await digitar($('input[name="preco"]'), "1.200,50");
    expect(txt("[data-preco]")).toBe("R$ 1.200,50");
    await digitar($('input[name="preco"]'), "150");
    respostas["/api/estoque/pGas/preco"] = { status: 200, corpo: { preco: 150, margemVenda: null } };
    await clicar($("[data-salvar-preco]"));
    expect(chamadas.at(-1)!.corpo).toEqual({ modo: "preco", preco: 150 });
    expect(txt("[data-preco-salvo]")).toContain("preço fixo");
  });

  it("margem de 100% ou mais: aviso e não salva; sem custo, só preço fixo; quem não pode editar só vê", async () => {
    await painel();
    await clicar($('[data-modo="margem"]'));
    await digitar($('input[name="margem"]'), "100");
    expect(txt('[role="alert"]')).toBe("A margem sobre a venda precisa ser menor que 100%.");
    expect(($("[data-salvar-preco]") as HTMLButtonElement).disabled).toBe(true);
    act(() => root.unmount()); caixa.remove();
    await painel({ custo: null });
    expect(($('[data-modo="margem"]') as HTMLButtonElement).disabled).toBe(true);
    expect(txt("[data-custo]")).toBe("—");
    expect(txt("[data-markup]")).toBe("—");
    act(() => root.unmount()); caixa.remove();
    await painel({ preco: 120, podeEditar: false });
    expect($("[data-salvar-preco]")).toBeNull();
    expect(txt("[data-margem]")).toBe("16,7%");
  });
});

const SEM_FISCAL = { ncm: null, cest: null, gtin: null, origemMercadoria: null, unidadeTributavel: null };
const GAS = { id: "pGas", nome: "Gás R404A", unidade: "kg", preco: 142.86, margemVenda: 30, custo: 100, fiscal: { ...SEM_FISCAL, ncm: "29037990" } };
const ITEM_GAS = {
  id: "i1", numeroItem: 1, codigoFornecedor: "R404A-136", descricaoFornecedor: "GAS REFRIGERANTE R404A CILINDRO 13,6KG",
  unidade: "UN", quantidade: 2, valorUnitario: 1428, valorTotal: 2856,
  fiscal: { ...SEM_FISCAL, ncm: "38247800", cest: "0100100", origemMercadoria: "1", unidadeTributavel: "KG" },
  fator: 13.6, fatorAprendido: { unidade: "UN", fator: 13.6 }, produto: GAS, aprendido: true,
};
const conciliacao = async (itens: (typeof ITEM_GAS | Record<string, unknown>)[] = [ITEM_GAS], extra: Record<string, unknown> = {}) => {
  const { ConciliacaoNota } = await import("@/components/compras/conciliacao-nota");
  await montar(createElement(ConciliacaoNota, { notaId: "n2", itens: itens as Parameters<typeof ConciliacaoNota>[0]["itens"], pedidos: [], podeLancar: true, parcelas: [{ numero: "001", vencimento: "19/11/2026", valor: 2856 }], podePrecificar: true, ...extra }));
};

describe("conciliação: conversão, aviso de custo e preço", () => {
  it("fator aprendido pré-preenchido; muda o fator → muda o que entra e o custo por kg", async () => {
    await conciliacao();
    expect(($('[data-fator-item="1"]') as HTMLInputElement).value).toBe("13,6");
    expect($("[data-fator-aprendido]")).not.toBeNull();
    expect(txt('[data-item="1"] [data-entra]')).toBe("Entra 27,2 kg · custo R$ 105,00/kg");
    await digitar($('[data-fator-item="1"]'), "12,5");
    expect($("[data-fator-aprendido]")).toBeNull(); // mudou: não é mais o aprendido
    expect(txt('[data-item="1"] [data-entra]')).toBe("Entra 25 kg · custo R$ 114,24/kg");
    await digitar($('[data-fator-item="1"]'), "");
    expect(txt('[data-item="1"] [data-falta-fator]')).toBe("Informe quantos kg vêm em 1 UN.");
    expect(botao("Confirmar e lançar").disabled).toBe(true);
    await digitar($('[data-fator-item="1"]'), "13.6");
    respostas["/api/compras/notas/n2/lancar"] = { status: 201, corpo: {} };
    await clicar(botao("Confirmar e lançar"));
    expect(chamadas.at(-1)).toEqual({ url: "/api/compras/notas/n2/lancar", metodo: "POST", corpo: { itens: [{ itemId: "i1", produtoId: "pGas", fator: 13.6 }], pedidoCompraId: null } });
  });

  it("custo mudou: só aviso (com a margem que o preço dá agora); ajustar preço abre o painel com o custo DESTA nota", async () => {
    await conciliacao();
    expect(txt('[data-aviso-custo="1"]')).toBe(" O custo mudou: era R$ 100,00/kg, nesta nota R$ 105,00/kg (+5,0%). Seu preço atual (R$ 142,86) dá 26,5% de margem agora (antes 30,0%). Para manter 30,0%, o preço seria R$ 150,00. O preço não foi alterado.");
    expect(txt('[data-preco-item="1"]')).toContain("margem com o custo desta nota: 26,5%");
    expect($("[data-preco-venda]")).toBeNull();
    expect(chamadas).toEqual([]); // nada foi gravado
    await clicar($('[data-ajustar-preco="1"]'));
    expect(txt("[data-custo]")).toBe("R$ 105,00");
    expect(txt("[data-preco-venda] [data-margem]")).toBe("30,0%"); // por margem: 30% sobre o custo novo
    expect(txt("[data-preco-venda] [data-preco]")).toBe("R$ 150,00");
    respostas["/api/estoque/pGas/preco"] = { status: 200, corpo: { preco: 150, margemVenda: 30 } };
    await clicar($("[data-salvar-preco]"));
    expect(chamadas.at(-1)).toEqual({ url: "/api/estoque/pGas/preco", metodo: "PUT", corpo: { modo: "margem", margem: 30, custoBase: 105 } });
  });

  it("sem permissão de preço: vê o aviso, mas não o 'Ajustar preço'; diferença fiscal aparece", async () => {
    await conciliacao([ITEM_GAS], { podePrecificar: false });
    expect($('[data-aviso-custo="1"]')).not.toBeNull();
    expect($("[data-ajustar-preco]")).toBeNull();
    expect(txt("[data-divergencia-fiscal]")).toBe("NCM: cadastro 29037990 · nota 38247800 (fica o do cadastro)");
    expect(txt('[data-fiscal="1"]')).toContain("Fiscal da nota: NCM 3824.78.00 · CEST 0100100 · origem 1 · un. trib. KG");
  });

  it("produto escolhido com a mesma unidade: fator 1 travado; com outra, começa em branco", async () => {
    respostas["/api/compras/produtos"] = { status: 200, corpo: { produtos: [{ ...GAS, id: "pUn", nome: "Gás (cilindro)", unidade: "un" }, GAS] } };
    await conciliacao([{ ...ITEM_GAS, produto: null, aprendido: false, fatorAprendido: null, fator: 1 }]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await digitar($("[data-busca-produto]"), "gás");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    await clicar($('[data-opcao-produto="pUn"]'));
    expect(($('[data-fator-item="1"]') as HTMLInputElement).disabled).toBe(true);
    expect(txt('[data-item="1"] [data-entra]')).toBe("Entra 2 un · custo R$ 1.428,00/un");
    await clicar($('button[aria-label="Trocar produto"]'));
    await clicar($('[data-criar-novo="1"]'));
    await digitar($('input[name="novo-un-1"]'), "kg");
    expect(($('[data-fator-item="1"]') as HTMLInputElement).value).toBe("");
    await digitar($('[data-fator-item="1"]'), "13,6");
    expect(txt('[data-item="1"] [data-entra]')).toBe("Entra 27,2 kg · custo R$ 105,00/kg");
    expect(txt('[data-item="1"]')).toContain("O preço de venda do produto novo pode ser definido depois de lançar");
  });
});
