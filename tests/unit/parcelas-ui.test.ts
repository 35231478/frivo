// @vitest-environment happy-dom
/**
 * Contas a Receber — parcelas + baixa parcial, num DOM de verdade:
 *  - ⋮ "Parcelar" (apagado com ⓘ do motivo na parcela, com boleto, com recebimento) e o editor de
 *    parcelas (N× iguais com os centavos na 1ª, soma × total, linha editável, POST do plano);
 *  - "Informar recebimento" com valor: o que falta vem preenchido; menos = recebimento PARCIAL (aviso,
 *    botão e toast dizem quanto fica em aberto); mais que o saldo / parcial com boleto: recusa na tela;
 *  - lista: coluna "Em aberto (R$)", selo "Parcial", chip "Recebido em parte", total em aberto do filtro;
 *    celular: "Recebido · falta"; gaveta: valor recebido × em aberto, parcelas (a atual marcada, as irmãs
 *    abrem na mesma gaveta) e recebimentos;
 *  - Nova cobrança "À vista / Parcelado"; "Faturar" à vista ou em N×; vínculo "Parcela n/N".
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/financeiro/contas-receber", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([
    import("@/components/financeiro/conta-receber-acoes"), import("@/components/financeiro/contas-receber-view"),
    import("@/components/providers/permissoes-provider"), import("@/components/financeiro/cobranca-form"), import("@/components/faturamento/botao-faturar"),
  ]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear(); nav.push.mockClear(); avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  respostas = {
    "GET /api/cadastros/contas-bancarias": { status: 200, corpo: [{ id: "cb1", nome: "Inter PJ", ativo: true }] },
    "GET /api/cadastros/centros-custo": { status: 200, corpo: [] },
    "GET /api/cadastros/categorias-financeiras": { status: 200, corpo: [] },
    "POST /api/contas-receber/": { status: 201, corpo: { ok: true } },
    "GET /api/clientes": { status: 200, corpo: [{ id: "c1", nome: "Hospital Santa Luzia" }] },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T15:00:00.000Z"));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: React.ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  if (caixa?.isConnected) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
const enviados = (metodo: string) => chamadas.filter((c) => c.metodo === metodo);

const base = {
  id: "cr1", numero: "CR-2026-0042", descricao: "Instalação", valor: 1000, dataVencimento: "2026-12-10T00:00:00.000Z",
  status: "A_RECEBER", banco: null, clienteId: "c1", clienteNome: "Hospital Santa Luzia", whatsapp: null, email: null,
  interAtivo: true, boletoStatus: null, boletoEmitidoEm: null, boletoVencimento: null, boletoLinhaDigitavel: null, boletoCodigoBarras: null,
  categoriaId: null, categoria: null, formaPagamento: null, observacao: null, centroCustoId: null, contaBancariaId: null, notas: [], valorRecebido: 0,
};
async function menu(conta: Record<string, unknown> = {}) {
  const { ContaReceberAcoes } = await import("@/components/financeiro/conta-receber-acoes");
  await montar(createElement(ContaReceberAcoes, { conta: { ...base, ...conta } as any, clientes: [], onDetalhes: vi.fn() }));
  await clicar($("[data-acao=menu]"));
}
const itemMenu = (id: string) => $(`[data-menu-acoes] [data-item="${id}"]`);
const motivo = (id: string) => itemMenu(id)?.getAttribute("title") ?? null;

describe("⋮ Parcelar", () => {
  it("apagado com o motivo: parcela, boleto emitido, recebimento parcial; some na quitada", async () => {
    await menu({ lancamentoId: "l1", parcelaNumero: 2, parcelaTotal: 3 });
    expect(motivo("parcelar")).toBe("Esta já é uma parcela.");
    await menu({ boletoStatus: "EMITIDO" });
    expect(motivo("parcelar")).toBe("Cancele o boleto antes de parcelar (cada parcela terá o seu).");
    await menu({ valorRecebido: 100 });
    expect(motivo("parcelar")).toBe("Já tem recebimento: não dá mais para parcelar.");
    expect(itemMenu("parcelar")!.querySelector("[data-dica]")).not.toBeNull();
    await menu({ status: "RECEBIDO" });
    expect(itemMenu("parcelar")).toBeNull();
  });

  it("editor: 3× iguais (centavos na 1ª) a partir do vencimento; muda para 2×; linha editada que não fecha a soma trava; o plano vai ao servidor", async () => {
    await menu();
    await clicar(itemMenu("parcelar"));
    const linhas = () => $$("[data-parcela-plano]").map((tr) => [txt(tr.querySelector("td")), tr.querySelector<HTMLInputElement>('input[type="number"]')!.value]);
    expect(linhas()).toEqual([["1/3", "333.34"], ["2/3", "333.33"], ["3/3", "333.33"]]);
    expect(txt($("[data-soma-parcelas]"))).toMatch(/^R\$\s?1\.000,00 de R\$\s?1\.000,00$/);
    await escolher($("[data-qtd-parcelas]"), "2");
    expect(linhas()).toEqual([["1/2", "500"], ["2/2", "500"]]);
    await digitar($('input[aria-label="Valor da parcela 2"]'), "499");
    expect(txt($("[data-motivo-plano]"))).toMatch(/^A soma das parcelas \(R\$\s?999,00\) tem que ser igual ao valor da conta/);
    expect($<HTMLButtonElement>("[data-confirmar-parcelar]")!.disabled).toBe(true);
    await digitar($('input[aria-label="Valor da parcela 2"]'), "500");
    expect($("[data-motivo-plano]")).toBeNull();
    await clicar($("[data-confirmar-parcelar]"));
    const [post] = enviados("POST");
    expect(post.url).toBe("/api/contas-receber/cr1/parcelar");
    expect(post.corpo).toEqual({ parcelas: [{ vencimento: "2026-12-10", valor: 500 }, { vencimento: "2027-01-10", valor: 500 }] });
    expect(avisos.toast).toHaveBeenCalledWith("CR-2026-0042 dividida em 2 parcelas.", "sucesso");
  });
});

describe("Informar recebimento: total ou parcial", () => {
  it("conta já recebida em parte: mostra conta/recebido/falta; o que falta vem preenchido; menos = PARCIAL com aviso e toast", async () => {
    await menu({ valorRecebido: 400 });
    await clicar(itemMenu("receber"));
    expect($$("[data-resumo-baixa] dd").map(txt)).toEqual([expect.stringMatching(/1\.000,00/), expect.stringMatching(/400,00/), expect.stringMatching(/600,00/)]);
    expect($<HTMLInputElement>("[data-valor-recebido]")!.value).toBe("600");
    await digitar($("[data-valor-recebido]"), "250");
    expect(txt($("[data-aviso-parcial]"))).toMatch(/^Recebimento parcial: continuam em aberto R\$\s?350,00\.$/);
    expect(txt($("[data-confirmar-recebimento]"))).toBe("Confirmar recebimento parcial");
    await clicar($("[data-confirmar-recebimento]"));
    const [post] = enviados("POST");
    expect(post.url).toBe("/api/contas-receber/cr1/recebimentos");
    expect(post.corpo).toMatchObject({ valor: 250 });
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/^Recebimento parcial de R\$\s?250,00 em CR-2026-0042\. Falta R\$\s?350,00\.$/), "sucesso");
  });

  it("mais que o saldo, ou parte com boleto emitido: o motivo aparece e nada vai ao servidor", async () => {
    await menu({ valorRecebido: 400 });
    await clicar(itemMenu("receber"));
    await digitar($("[data-valor-recebido]"), "600.01");
    expect(txt($("[data-invalido-baixa]"))).toMatch(/^O valor passa do que falta receber \(R\$\s?600,00\)\.$/);
    expect($<HTMLButtonElement>("[data-confirmar-recebimento]")!.disabled).toBe(true);
    await menu({ boletoStatus: "EMITIDO" });
    await clicar(itemMenu("receber"));
    await digitar($("[data-valor-recebido]"), "100");
    expect(txt($("[data-invalido-baixa]"))).toBe("Boleto emitido: cancele o boleto para receber só uma parte.");
    await digitar($("[data-valor-recebido]"), "1000"); // a baixa total por fora continua livre
    expect($("[data-invalido-baixa]")).toBeNull();
    expect(enviados("POST")).toEqual([]);
  });
});

describe("lista, celular e gaveta", () => {
  const props = (contas: Record<string, unknown>[]) => ({
    contas: contas.map((c) => ({ ...base, ...c })), clientes: [], categorias: [], interAtivo: true,
    resumo: { VENCIDO: { v: 0, q: 0 }, VENCE_HOJE: { v: 0, q: 0 }, A_VENCER: { v: 600, q: 1 }, RECEBIDO: { v: 0, q: 0 }, PERDA: { v: 0, q: 0 }, TOTAL: { v: 1000, q: 1 } },
    periodo: { tipo: "todos", mes: "2026-11", de: null, ate: null, rotulo: "Todo o período" },
    total: contas.length, totalFiltrado: 1500, abertoFiltrado: 1100, pagina: 1, porPagina: 25,
    filtros: { q: "", card: "", clienteId: "", categoria: "", forma: "", banco: "", valorMin: "", valorMax: "", vencDe: "", vencAte: "", status: "", conta: "" },
  });

  it("coluna 'Em aberto (R$)': saldo na parcial (com selo Parcial), igual ao valor sem baixa, — na cancelada; total em aberto; cartão do celular", async () => {
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props([
      { valorRecebido: 400 },
      { id: "cr2", numero: "CR-2026-0042/2", valor: 500, lancamentoId: "l1", parcelaNumero: 2, parcelaTotal: 3 },
      { id: "cr3", numero: "CR-2026-0050", valor: 80, status: "CANCELADO" },
    ]) as any));
    const aberto = (id: string) => txt($(`[data-linha-conta=${id}] [data-em-aberto]`));
    expect([aberto("cr1"), aberto("cr2"), aberto("cr3")]).toEqual(["600,00", "500,00", "—"]);
    expect($("[data-linha-conta=cr1] [data-selo-parcial]")).not.toBeNull();
    expect($("[data-linha-conta=cr2] [data-selo-parcial]")).toBeNull();
    expect(txt($("[data-aberto-filtrado]"))).toMatch(/1\.100,00/);
    expect(txt($("[data-cartao-conta=cr1] [data-parcial-cartao]"))).toMatch(/^Recebido R\$\s?400,00 · falta R\$\s?600,00$/);
  });

  it("filtro 'Recebido em parte' no painel de status", async () => {
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, { ...props([{}]), filtros: { ...props([]).filtros, clienteId: "c1" } } as any));
    expect(txt($("[data-chip-status=PARCIAL]"))).toBe("Recebido em parte");
  });

  it("gaveta: recebido × em aberto, parcelas (a atual marcada; a irmã abre na mesma gaveta) e recebimentos", async () => {
    const detalhe = (id: string, n: number) => ({
      id, numero: `CR-2026-0042/${n}`, descricao: `Instalação — parcela ${n}/3`, valor: 333.33, status: "A_RECEBER",
      dataVencimento: "2026-12-10T00:00:00.000Z", dataRecebimento: null, criadoEm: "2026-11-01T12:00:00.000Z",
      formaPagamento: "PIX", banco: null, observacao: null, canceladaEm: null, motivoCancelamento: null, categoria: null, categoriaFinanceira: null,
      centroCusto: null, contaBancaria: null, cliente: { id: "c1", nome: "Hospital", cpfCnpj: null }, origem: "MANUAL",
      medicao: null, orcamento: null, contrato: null, ordens: [], itens: [], boleto: null, notas: [], eventos: [],
      valorRecebido: n === 2 ? 100 : 0, saldo: n === 2 ? 233.33 : 333.33,
      recebimentos: n === 2 ? [{ id: "rc1", valor: 100, data: "2026-11-10T00:00:00.000Z", formaPagamento: "PIX", origem: "MANUAL", observacao: null, contaBancaria: "Inter PJ", usuario: "Ana" }] : [],
      parcelaNumero: n, parcelaTotal: 3, lancamentoId: "l1", lancamento: { id: "l1", numero: "CR-2026-0042", valor: 1000 },
      parcelas: [1, 2, 3].map((k) => ({ id: `p${k}`, numero: `CR-2026-0042/${k}`, valor: k === 1 ? 333.34 : 333.33, status: "A_RECEBER", dataVencimento: `2026-1${k}-10T00:00:00.000Z`.replace("2026-13", "2027-01"), parcelaNumero: k, parcelaTotal: 3, boletoStatus: null, valorRecebido: 0, saldo: 0 })),
    });
    respostas["GET /api/contas-receber/p2"] = { status: 200, corpo: detalhe("p2", 2) };
    respostas["GET /api/contas-receber/p3"] = { status: 200, corpo: detalhe("p3", 3) };
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, { ...props([{ id: "p2" }]), filtros: { ...props([]).filtros, conta: "p2" } } as any));
    expect(txt($("[data-detalhe-parcial]"))).toMatch(/^Valor recebido\s?R\$\s?100,00\s?Valor em aberto\s?R\$\s?233,33$/);
    expect(txt($("[data-detalhes-conta] h3"))).toBeTruthy();
    expect(txt($("[data-detalhe-parcelas]")?.closest("section")?.querySelector("h3") ?? null)).toMatch(/^Parcelas de CR-2026-0042 · total R\$\s?1\.000,00$/);
    expect($("[data-parcela-detalhe='2']")!.getAttribute("aria-current")).toBe("true");
    expect($("[data-parcela-detalhe='2'] button")).toBeNull();
    expect(txt($("[data-recebimento=rc1]"))).toMatch(/^10\/11\/2026 · Informado à mão.*PIX · Inter PJ · Ana.*100,00$/);
    await clicar($("[data-parcela-detalhe='3'] button"));
    expect(chamadas.some((c) => c.url === "/api/contas-receber/p3")).toBe(true);
    expect($("[data-detalhes-conta=p3]")).not.toBeNull();
  });
});

describe("Nova cobrança e Faturar", () => {
  it("Nova cobrança: À vista / Parcelado; parcelado esconde o vencimento único e pede o valor antes; com valor, o editor aparece", async () => {
    const { CobrancaForm } = await import("@/components/financeiro/cobranca-form");
    await montar(createElement(CobrancaForm));
    expect($('[data-condicao-opcao="vista"]')!.getAttribute("aria-checked")).toBe("true");
    expect($('input[aria-label="Primeiro vencimento"]')).toBeNull();
    await clicar($('[data-condicao-opcao="parcelado"]'));
    expect(txt($("[data-parcelar-sem-valor]"))).toBe("Informe o valor para dividir em parcelas.");
    await digitar($('input[placeholder="0,00"]'), "900");
    expect($$("[data-parcela-plano]")).toHaveLength(3);
    expect($("#rotulo-condicao [data-dica]")).not.toBeNull();
  });

  it("Faturar: à vista não manda corpo; em 3× a confirmação diz e o corpo leva a quantidade; aviso do servidor vira toast informativo", async () => {
    const { BotaoFaturar } = await import("@/components/faturamento/botao-faturar");
    respostas["POST /api/orcamentos/"] = { status: 201, corpo: { id: "m9", numero: "MED-2026-0012", rotulo: "Fatura 2026-0012", jaExistia: false, parcelas: 3 } };
    await montar(createElement(BotaoFaturar, { url: "/api/orcamentos/orc1/faturar", origem: "orçamento", fatura: null, valor: 3000, itens: 1, podeFaturar: true, podeVer: true }));
    expect(txt($("[data-faturar-parcelas] option"))).toBe("À vista");
    await escolher($("[data-faturar-parcelas]"), "3");
    await clicar($("[data-faturar]"));
    expect((avisos.confirmar.mock.calls[0][0] as any).mensagem).toMatch(/, em 3 parcelas mensais \(a 1ª no vencimento da fatura\)\.$/);
    expect(enviados("POST")[0].corpo).toEqual({ parcelamento: { quantidade: 3 } });
    expect(avisos.toast).toHaveBeenCalledWith("Fatura 2026-0012 criada em 3 parcelas.", "sucesso");

    avisos.toast.mockClear(); chamadas.length = 0;
    respostas["POST /api/orcamentos/"] = { status: 201, corpo: { id: "m9", numero: "MED-2026-0012", rotulo: "Fatura 2026-0012", jaExistia: false } };
    await montar(createElement(BotaoFaturar, { url: "/api/orcamentos/orc1/faturar", origem: "orçamento", fatura: null, valor: 3000, itens: 1, podeFaturar: true, podeVer: true }));
    await clicar($("[data-faturar]"));
    expect(enviados("POST")[0].corpo).toBeNull();
    expect(avisos.toast).toHaveBeenCalledWith("Fatura 2026-0012 criada.", "sucesso");
    avisos.toast.mockClear(); chamadas.length = 0;
    respostas["POST /api/orcamentos/"] = { status: 201, corpo: { id: "m9", numero: "MED-2026-0012", rotulo: "Fatura 2026-0012", jaExistia: false, avisoParcelas: "Fatura criada sem parcelar: X" } };
    await escolher($("[data-faturar-parcelas]"), "2");
    await clicar($("[data-faturar]"));
    expect(avisos.toast).toHaveBeenCalledWith("Fatura criada sem parcelar: X", "info");
  });

  it("vínculo do outro lado: 'Parcela 2/3: CR-…/2' com o que entrou e o que falta", async () => {
    const { ContasReceberVinculadas } = await import("@/components/financeiro/contas-receber-vinculadas");
    await montar(createElement(ContasReceberVinculadas, { podeAbrir: true, contas: [
      { id: "p2", numero: "CR-2026-0042/2", valor: 500, status: "A_RECEBER", dataVencimento: "2026-12-10T00:00:00.000Z", valorRecebido: 200, parcelaNumero: 2, parcelaTotal: 3 },
    ] }));
    expect(txt($("[data-conta-vinculada=p2] p"))).toMatch(/^Parcela 2\/3: CR-2026-0042\/2 \(R\$\s?500,00 · A vencer · recebido R\$\s?200,00, falta R\$\s?300,00\)$/);
  });
});
