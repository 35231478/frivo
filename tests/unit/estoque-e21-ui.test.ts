// @vitest-environment happy-dom
/**
 * Estoque E2.1 — a central de lançamento num DOM de verdade (happy-dom), API simulada:
 *  - parcelas: nº de parcelas redistribui o valor da nota; vencimentos todos de uma vez (mensal / a cada
 *    N dias); valor editado → aviso de soma; voltar ao que veio na NF; boleto colado conferido na hora;
 *  - categoria / centro de custo / forma: o que vai no corpo do salvar e do lançar; padrão do fornecedor;
 *  - preço de venda NA LINHA (custo · preço · margem · markup ao vivo) como rascunho, inclusive no
 *    produto novo (nome editável e visível); preço inválido trava;
 *  - sem Financeiro: o financeiro fica só leitura e não vai no corpo;
 *  - importar pelo atalho do Financeiro abre a nota com o "voltar" para Contas a pagar;
 *  - conta a pagar manual: centro de custo e boleto (conferido antes de enviar).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }) }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const CATEGORIAS = [{ id: "catMat", nome: "Materiais e peças", cor: "#0EA5E9", ativo: true }, { id: "catGas", nome: "Gases", cor: "#22C55E", ativo: true }];
const CENTROS = [{ id: "ccObra", nome: "Obra Shopping Norte", ativo: true }, { id: "ccFrota", nome: "Frota", ativo: true }];

// Carrega (compila) os componentes uma vez, fora do tempo de cada teste
beforeAll(async () => {
  await Promise.all([
    import("@/components/compras/conciliacao-nota"), import("@/components/compras/importar-nota"), import("@/components/financeiro/conta-pagar-form"),
  ]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.push.mockClear(); nav.refresh.mockClear();
  respostas = {
    "/api/cadastros/categorias-financeiras": { status: 200, corpo: CATEGORIAS },
    "/api/cadastros/centros-custo": { status: 200, corpo: CENTROS },
    "/api/cadastros/fornecedores": { status: 200, corpo: [{ id: "fA", nome: "Elétrica Central", ativo: true }] },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo });
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
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); // seletores carregam a lista
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const txt = (sel: string) => ($(sel)?.textContent ?? "").replace(/ /g, " ");
const valor = (sel: string) => ($(sel) as HTMLInputElement).value;
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const botao = (t: string) => [...caixa.querySelectorAll("button")].find((b) => b.textContent?.trim().endsWith(t)) as HTMLButtonElement;
async function digitar(el: Element | null, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function sair(el: Element | null) { await act(async () => { (el as HTMLElement).dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); }
async function escolher(el: Element | null, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const ultima = (prefixo: string) => chamadas.filter((c) => c.url.startsWith(prefixo)).at(-1);

const SEM_FISCAL = { ncm: null, cest: null, gtin: null, origemMercadoria: null, unidadeTributavel: null };
const GAS = { id: "pGas", nome: "Gás R410A 11,35 kg", unidade: "un", preco: 950, margemVenda: null, custo: 689.9, fiscal: SEM_FISCAL };
const ITENS = [
  { id: "i1", numeroItem: 1, codigoFornecedor: "R410A-11", descricaoFornecedor: "GAS REFRIGERANTE R410A CILINDRO 11,35KG", unidade: "UN", quantidade: 2, valorUnitario: 689.9, valorTotal: 1379.8, fiscal: SEM_FISCAL, fator: 1, fatorAprendido: null, produto: GAS, aprendido: false },
  { id: "i3", numeroItem: 3, codigoFornecedor: "TUB-14-15", descricaoFornecedor: "TUBO COBRE FLEXIVEL 1/4 ROLO 15M", unidade: "M", quantidade: 15, valorUnitario: 12.3333, valorTotal: 185, fiscal: SEM_FISCAL, fator: 1, fatorAprendido: null, produto: null, aprendido: false },
];
const DUPS = [["001", "2026-11-14"], ["002", "2026-12-14"], ["003", "2027-01-13"]].map(([d, v]) => ({ duplicata: d, vencimento: v, valor: 583.1, boleto: null }));
const FIN = {
  categoriaId: null as string | null, centroCustoId: null as string | null, formaPagamento: "BOLETO", parcelas: DUPS, parcelasNf: DUPS, valorNota: 1749.3,
  pagamentosNf: [{ tPag: "15", descricao: "Boleto bancário", valor: 1749.3, aPrazo: true }], padrao: { categoriaId: null as string | null, centroCustoId: null as string | null }, hoje: "2026-10-20",
};
const BOLETO = "10492006506100010004200997263900989810000021403";

async function central(extra: Record<string, unknown> = {}) {
  const { ConciliacaoNota } = await import("@/components/compras/conciliacao-nota");
  await montar(createElement(ConciliacaoNota, { notaId: "n1", itens: ITENS, pedidos: [], podeLancar: true, financeiro: FIN, podePrecificar: true, ...extra } as any));
}

describe("parcelas", () => {
  it("começa como veio na NF; nº de parcelas redistribui; voltar à NF", async () => {
    await central();
    expect($$("[data-parcela]")).toHaveLength(3);
    expect(txt("[data-origem-parcelas]")).toBe("Como veio na NF (duplicatas).");
    expect(txt("[data-soma-parcelas]")).toBe("Parcelas R$ 1.749,30 · nota R$ 1.749,30");
    expect($("[data-voltar-nf]")).toBeNull();
    await digitar($('input[name="qtdParcelas"]'), "2");
    await sair($('input[name="qtdParcelas"]'));
    expect($$("[data-parcela]")).toHaveLength(2);
    expect([valor('input[name="valor-1"]'), valor('input[name="valor-2"]')]).toEqual(["874,65", "874,65"]);
    expect([valor('input[name="vencimento-1"]'), valor('input[name="vencimento-2"]')]).toEqual(["2026-11-14", "2026-12-14"]);
    expect(txt("[data-origem-parcelas]")).toBe("Parcelas ajustadas aqui (a NF trazia outras).");
    await digitar($('input[name="qtdParcelas"]'), "4");
    await sair($('input[name="qtdParcelas"]'));
    expect($$("[data-parcela]").map((_, k) => valor(`input[name="vencimento-${k + 1}"]`))).toEqual(["2026-11-14", "2026-12-14", "2027-01-14", "2027-02-14"]);
    expect($$("[data-parcela]").map((_, k) => valor(`input[name="valor-${k + 1}"]`))).toEqual(["437,32", "437,32", "437,32", "437,34"]);
    await clicar($("[data-voltar-nf]"));
    expect($$("[data-parcela]")).toHaveLength(3);
    expect(valor('input[name="qtdParcelas"]')).toBe("3");
    expect($$("[data-parcela]")[0].textContent).toContain("dup. 001");
  });

  it("todos os vencimentos de uma vez (mensal ou a cada N dias); valor editado → aviso de soma (não trava)", async () => {
    await central();
    // Campo de data pt-BR (InputData): digita dd/mm/aaaa no campo visível; o ISO vai no campo com nome
    await digitar($('input[aria-label="Primeiro vencimento"]'), "30/11/2026");
    await escolher($('select[name="intervalo"]'), "15");
    await clicar($("[data-aplicar-vencimentos]"));
    expect([1, 2, 3].map((k) => valor(`input[name="vencimento-${k}"]`))).toEqual(["2026-11-30", "2026-12-15", "2026-12-30"]);
    await escolher($('select[name="intervalo"]'), "mensal");
    await clicar($("[data-aplicar-vencimentos]"));
    expect([1, 2, 3].map((k) => valor(`input[name="vencimento-${k}"]`))).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
    await digitar($('input[aria-label="Vencimento da parcela 2"]'), "24/12/2026"); // um só
    await digitar($('input[name="valor-3"]'), "500");
    expect(txt("[data-aviso-soma]")).toBe(" As parcelas somam R$ 1.666,20 e a nota é de R$ 1.749,30 (faltam R$ 83,10). As contas a pagar seguem as parcelas.");
    expect(botao("Confirmar e lançar").disabled).toBe(true); // o tubo ainda não tem produto
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 1 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.financeiro.parcelas).toEqual([
      { duplicata: "001", vencimento: "2026-11-30", valor: 583.1, boleto: null },
      { duplicata: "002", vencimento: "2026-12-24", valor: 583.1, boleto: null },
      { duplicata: "003", vencimento: "2027-01-30", valor: 500, boleto: null },
    ]);
  });

  it("boleto colado: conferido na hora (banco, valor, vencimento; avisa se não bate); inválido trava o salvar com o motivo", async () => {
    await central();
    await digitar($('input[name="boleto-1"]'), "10492.00650 61000.100042 00997.263900 9 89810000021403");
    // colou já formatada: não repete a linha; colado o código de barras, mostra a linha que ele vira
    expect(txt('[data-campo-boleto="boleto-1"] [data-boleto-ok]')).toBe("Caixa (104)· R$ 214,03· vence 10/05/2022");
    await digitar($('input[name="boleto-3"]'), "10499898100000214032006561000100040099726390");
    expect(txt('[data-campo-boleto="boleto-3"] [data-boleto-ok]')).toBe("Caixa (104)· R$ 214,03· vence 10/05/2022· 10492.00650 61000.100042 00997.263900 9 89810000021403");
    await digitar($('input[name="boleto-3"]'), "");
    const avisos = $$('[data-campo-boleto="boleto-1"] [data-boleto-aviso]').map((a) => a.textContent!.replace(/ /g, " "));
    expect(avisos).toEqual(["O boleto é de R$ 214,03 e a parcela, de R$ 583,10: confira se é o boleto certo.", "O boleto vence em 10/05/2022 e a parcela, em 14/11/2026."]);
    await digitar($('input[name="boleto-2"]'), BOLETO.slice(0, 40));
    expect(txt('[data-campo-boleto="boleto-2"] [data-boleto-erro]')).toMatch(/^Boleto incompleto/);
    const antes = chamadas.length;
    await clicar(botao("Salvar rascunho"));
    expect(txt('[role="alert"]:not([data-boleto-erro])')).toMatch(/^Parcela 2: Boleto incompleto/);
    expect(chamadas.length).toBe(antes); // nada foi enviado
    await digitar($('input[name="boleto-2"]'), "");
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 1 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.financeiro.parcelas[0]).toEqual({ duplicata: "001", vencimento: "2026-11-14", valor: 583.1, boleto: BOLETO });
  });
});

describe("categoria, centro de custo e forma", () => {
  it("vêm do rascunho (padrão do fornecedor marcado), mudam e vão no corpo", async () => {
    await central({ financeiro: { ...FIN, categoriaId: "catMat", centroCustoId: "ccObra", padrao: { categoriaId: "catMat", centroCustoId: "ccObra" } } });
    expect(valor('select[name="categoriaId"]')).toBe("catMat");
    expect(valor('select[name="centroCustoId"]')).toBe("ccObra");
    expect($("[data-padrao-categoria]")).not.toBeNull();
    expect($("[data-padrao-centro]")).not.toBeNull();
    expect(txt("[data-pagamento-nf]")).toBe("Na NF: 15 · Boleto bancário · R$ 1.749,30 (a prazo)");
    await escolher($('select[name="centroCustoId"]'), "ccFrota");
    expect($("[data-padrao-centro]")).toBeNull(); // trocou: não é mais o padrão
    await escolher($('select[name="formaPagamento"]'), "PIX");
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 1 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.financeiro).toEqual({ categoriaId: "catMat", centroCustoId: "ccFrota", formaPagamento: "PIX", parcelas: null });
    expect(txt('[role="status"]')).toBe("Rascunho salvo. Faltam 1 item(ns) sem produto.");
  });

  it("sem Financeiro › fluxo de caixa: tudo do financeiro desabilitado e fora do corpo", async () => {
    await central({ podeLancar: false, motivoSemLancar: "Lançar gera conta a pagar." });
    expect(($('select[name="formaPagamento"]') as HTMLSelectElement).disabled).toBe(true);
    expect(($('select[name="categoriaId"]') as HTMLSelectElement).disabled).toBe(true);
    expect(($('input[name="valor-1"]') as HTMLInputElement).disabled).toBe(true);
    expect($('input[name="boleto-1"]')).toBeNull();
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 1 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo).not.toHaveProperty("financeiro");
  });
});

describe("preço de venda na linha", () => {
  it("por margem: custo · preço · margem · markup ao vivo; vai no corpo como rascunho; 'manter' tira", async () => {
    await central();
    const linha = '[data-preco-item="1"]';
    expect(txt(`${linha} [data-situacao-preco]`)).toBe("Preço atual");
    expect([txt(`${linha} [data-custo]`), txt(`${linha} [data-preco]`), txt(`${linha} [data-margem]`), txt(`${linha} [data-markup]`)])
      .toEqual(["R$ 689,90", "R$ 950,00", "27,4%", "37,7%"]);
    await clicar($(`${linha} [data-modo="margem"]`));
    await digitar($(`${linha} input[name="margem"]`), "30");
    expect([txt(`${linha} [data-preco]`), txt(`${linha} [data-margem]`), txt(`${linha} [data-markup]`)]).toEqual(["R$ 985,57", "30,0%", "42,9%"]);
    expect(txt(`${linha} [data-situacao-preco]`)).toBe("Novo preço — vai para o produto ao confirmar e lançar");
    expect($("[data-salvar-preco]")).toBeNull();
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 1 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.itens).toEqual([{ itemId: "i1", produtoId: "pGas", fator: 1, preco: { modo: "margem", margem: 30 } }]);
    expect(chamadas.some((c) => c.url.startsWith("/api/estoque"))).toBe(false); // nada direto no produto
    await clicar($(`${linha} [data-manter-preco]`));
    expect(txt(`${linha} [data-preco]`)).toBe("R$ 950,00");
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.itens[0].preco).toBeNull();
  });

  it("preço inválido trava o salvar com o item; sem permissão de preço o campo não aparece e o preço não vai no corpo", async () => {
    await central();
    await clicar($('[data-preco-item="1"] [data-modo="margem"]'));
    await digitar($('[data-preco-item="1"] input[name="margem"]'), "100");
    expect(txt('[data-preco-item="1"] [role="alert"]')).toBe("A margem sobre a venda precisa ser menor que 100%.");
    await clicar(botao("Salvar rascunho"));
    expect(txt('p[role="alert"].font-medium')).toBe("Item 1: preço de venda inválido — corrija ou mantenha o preço atual.");
    expect(ultima("/api/compras/notas")).toBeUndefined();
    act(() => root.unmount()); caixa.remove();
    await central({ podePrecificar: false });
    expect($('[data-preco-item="1"] [data-preco]')).not.toBeNull(); // vê
    expect($('[data-preco-item="1"] input[name="preco"]')).toBeNull(); // não edita
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 1 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.itens[0]).not.toHaveProperty("preco");
  });

  it("trocar o produto da linha descarta o preço digitado para o anterior (não vai para o outro produto)", async () => {
    const CAP = { id: "pCap", nome: "Capacitor 35uF", unidade: "un", preco: 42, margemVenda: null, custo: 18, fiscal: SEM_FISCAL };
    respostas["/api/compras/produtos"] = { status: 200, corpo: { produtos: [CAP] } };
    await central();
    const linha = '[data-preco-item="1"]';
    await clicar($(`${linha} [data-modo="margem"]`));
    await digitar($(`${linha} input[name="margem"]`), "30");
    expect(txt(`${linha} [data-preco]`)).toBe("R$ 985,57");
    await clicar($('[data-item="1"] button[aria-label="Trocar produto"]'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await digitar($('[data-item="1"] [data-busca-produto]'), "cap");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    await clicar($('[data-opcao-produto="pCap"]'));
    expect(txt(`${linha} [data-situacao-preco]`)).toBe("Preço atual");
    expect(txt(`${linha} [data-preco]`)).toBe("R$ 42,00");
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 1 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.itens[0]).toMatchObject({ itemId: "i1", produtoId: "pCap", preco: null });
  });

  it("produto novo: nome visível e editável na linha (editar o nome não perde o fator); preço da linha vai junto", async () => {
    await central();
    await clicar($('[data-criar-novo="3"]'));
    const nome = $('[data-novo-nome="3"]') as HTMLInputElement;
    expect(nome.value).toBe("TUBO COBRE FLEXIVEL 1/4 ROLO 15M");
    expect(txt('[data-vinculo="novo"]')).toContain("Nome do produto");
    await digitar($('input[name="novo-un-3"]'), "kg");
    await digitar($('[data-fator-item="3"]'), "0,5");
    await digitar(nome, "Tubo de cobre 1/4");
    expect(valor('[data-fator-item="3"]')).toBe("0,5"); // o fator ficou
    expect(txt('[data-preco-item="3"] [data-situacao-preco]')).toBe("Produto novo — sem preço ainda");
    await digitar($('[data-preco-item="3"] input[name="preco"]'), "39,90");
    await digitar(nome, "");
    await clicar(botao("Salvar rascunho"));
    expect(txt('p[role="alert"].font-medium')).toBe("Item 3: dê um nome ao produto novo.");
    await digitar(nome, "Tubo de cobre 1/4");
    respostas["/api/compras/notas/n1/conciliacao"] = { status: 200, corpo: { faltam: 0 } };
    await clicar(botao("Salvar rascunho"));
    expect(ultima("/api/compras/notas/n1/conciliacao")!.corpo.itens[1]).toEqual({ itemId: "i3", novo: { nome: "Tubo de cobre 1/4", unidade: "kg" }, fator: 0.5, preco: { modo: "preco", preco: 39.9 } });
  });
});

describe("atalho e conta a pagar manual", () => {
  it("importar pelo Financeiro abre a nota mantendo o 'voltar' para Contas a pagar", async () => {
    const { ImportarNota } = await import("@/components/compras/importar-nota");
    await montar(createElement(ImportarNota, { de: "contas-pagar" }));
    respostas["/api/compras/notas"] = { status: 201, corpo: { nota: { id: "n9" } } };
    const input = $<HTMLInputElement>("[data-input-xml]")!;
    Object.defineProperty(input, "files", { value: [new File(["<xml/>"], "nota.xml", { type: "text/xml" })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(nav.push).toHaveBeenCalledWith("/estoque/notas/n9?de=contas-pagar");
  });

  it("conta a pagar manual: centro de custo e boleto (conferido na hora e antes de enviar)", async () => {
    const { ContaPagarForm } = await import("@/components/financeiro/conta-pagar-form");
    await montar(createElement(ContaPagarForm, {}));
    await escolher($('[data-seletor-cadastro="fornecedores"]'), "fA");
    await digitar($('input[placeholder="Ex: Compra de peças"]'), "Peças");
    await digitar($('input[type="number"]'), "214.03");
    await escolher($('[data-seletor-cadastro="centros-custo"]'), "ccObra");
    await digitar($('input[name="boleto"]'), BOLETO.slice(0, 46) + "9");
    expect(txt("[data-boleto-erro]")).toMatch(/^Dígito verificador não confere/);
    await clicar(botao("Criar conta a pagar"));
    expect(txt('.bg-atrasado-claro')).toMatch(/Boleto: Dígito verificador não confere/);
    expect(ultima("/api/contas-pagar")).toBeUndefined();
    await digitar($('input[name="boleto"]'), BOLETO);
    expect(txt("[data-boleto-ok]")).toMatch(/^Caixa \(104\)· R\$ 214,03/);
    expect($("[data-boleto-aviso]")).toBeNull(); // valor bate
    respostas["/api/contas-pagar"] = { status: 201, corpo: {} };
    await clicar(botao("Criar conta a pagar"));
    expect(ultima("/api/contas-pagar")!.corpo).toMatchObject({ fornecedorId: "fA", centroCustoId: "ccObra", boleto: BOLETO });
  });

  it("conta a pagar manual sem centro de custo nem boleto: vão null (o contrato da API), não texto vazio", async () => {
    const { ContaPagarForm } = await import("@/components/financeiro/conta-pagar-form");
    await montar(createElement(ContaPagarForm, {}));
    await escolher($('[data-seletor-cadastro="fornecedores"]'), "fA");
    await digitar($('input[placeholder="Ex: Compra de peças"]'), "Peças");
    await digitar($('input[type="number"]'), "214.03");
    respostas["/api/contas-pagar"] = { status: 201, corpo: {} };
    await clicar(botao("Criar conta a pagar"));
    const corpo = ultima("/api/contas-pagar")!.corpo;
    expect(corpo.centroCustoId).toBeNull();
    expect(corpo.boleto).toBeNull();
  });
});
