// @vitest-environment happy-dom
/**
 * Contas a Receber — RENEGOCIAR, num DOM de verdade (mesmo harness de perda-estorno-ui):
 *  - ⋮ "Renegociar" (apagado com ⓘ sem Financeiro › Perdas ou com o motivo da regra) e "Desfazer
 *    renegociação" (só na renegociação; motivo obrigatório);
 *  - modal: as cobranças do cliente (as que não podem, apagadas com o porquê), juros/multa/desconto, o
 *    total novo, à vista ou parcelado (editor de parcelas), o que vai ao servidor;
 *  - lista: caixas só nas renegociáveis, barra com o total e o motivo (cliente diferente), renegociada
 *    com "—" e selo; gaveta: rastro nos dois sentidos e a composição.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

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
    import("@/components/providers/permissoes-provider"), import("@/components/financeiro/renegociar-modal"),
  ]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear(); avisos.toast.mockClear();
  respostas = {
    "GET /api/cadastros/contas-bancarias": { status: 200, corpo: [{ id: "cb1", nome: "Inter PJ", ativo: true }] },
    "POST /api/contas-receber/": { status: 200, corpo: { ok: true } },
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
const semPerdas = (): Permissoes => { const p = permissoesTotais(); p.financeiro.perdas = false; return p; };
async function montar(el: React.ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  if (caixa?.isConnected) { act(() => root.unmount()); caixa.remove(); }
  document.body.innerHTML = "";
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
const enviados = (metodo: string) => chamadas.filter((c) => c.metodo === metodo);

const base = {
  id: "cr1", numero: "CR-2026-0042", descricao: "Instalação", valor: 1000, dataVencimento: "2026-11-10T00:00:00.000Z",
  status: "ATRASADO", banco: null, clienteId: "c1", clienteNome: "Hospital Santa Luzia", whatsapp: null, email: null,
  interAtivo: true, boletoStatus: null, boletoEmitidoEm: null, boletoVencimento: null, boletoLinhaDigitavel: null, boletoCodigoBarras: null,
  categoriaId: null, categoria: null, formaPagamento: "PIX", observacao: null, centroCustoId: null, contaBancariaId: null, notas: [], valorRecebido: 0,
};
async function menu(conta: Record<string, unknown> = {}, permissoes?: Permissoes) {
  const { ContaReceberAcoes } = await import("@/components/financeiro/conta-receber-acoes");
  await montar(createElement(ContaReceberAcoes, { conta: { ...base, ...conta } as any, clientes: [], onDetalhes: vi.fn() }), permissoes);
  await clicar($("[data-acao=menu]"));
}
const itemMenu = (id: string) => $(`[data-menu-acoes] [data-item="${id}"]`);
const motivo = (id: string) => itemMenu(id)?.getAttribute("title") ?? null;
const desabilitado = (id: string) => itemMenu(id)?.hasAttribute("data-desabilitado") ?? null;
const ids = () => $$("[data-menu-acoes] [data-item]").map((i) => i.getAttribute("data-item"));

async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}

const lista = [
  { id: "cr1", numero: "CR-2026-0042", descricao: "Instalação", status: "ATRASADO", dataVencimento: "2026-11-10T00:00:00.000Z", valor: 1000, recebido: 400, saldo: 600, parcelaNumero: null, parcelaTotal: null, motivo: null },
  { id: "cr2", numero: "CR-2026-0043", descricao: "Manutenção", status: "A_RECEBER", dataVencimento: "2026-11-20T00:00:00.000Z", valor: 500, recebido: 0, saldo: 500, parcelaNumero: null, parcelaTotal: null, motivo: null },
  { id: "cr3", numero: "CR-2026-0044", descricao: "Peças", status: "A_RECEBER", dataVencimento: "2026-12-01T00:00:00.000Z", valor: 300, recebido: 0, saldo: 300, parcelaNumero: null, parcelaTotal: null, motivo: "Cancele o boleto antes: o cliente ainda consegue pagá-lo." },
];

describe("⋮ Renegociar / Desfazer", () => {
  it("Renegociar: liberado na cobrança em aberto; sem a permissão ou com boleto, apagado com o porquê; some na renegociada", async () => {
    await menu();
    expect(desabilitado("renegociar")).toBe(false);
    await menu({}, semPerdas());
    expect(motivo("renegociar")).toBe("Sem permissão: Financeiro › Perdas (peça a um gerente).");
    expect(itemMenu("renegociar")!.querySelector("[data-dica]")).not.toBeNull();
    await menu({ boletoStatus: "EMITIDO" });
    expect(motivo("renegociar")).toBe("Cancele o boleto antes: o cliente ainda consegue pagá-lo.");
    await menu({ status: "RENEGOCIADO", valorRecebido: 400, renegociadaEmNumero: "CR-2026-0050" });
    expect(ids()).toEqual(["detalhes", "editar", "estornar", "recibo", "cancelar", "excluir"]);
    expect(motivo("estornar")).toBe("Conta renegociada: desfaça a renegociação antes de estornar.");
    expect(motivo("cancelar")).toBe("Conta renegociada: desfaça a renegociação antes.");
  });

  it("Desfazer renegociação: só na renegociação; cancelar/excluir apagados mandando desfazer; motivo obrigatório; POST e toast", async () => {
    await menu({ renegociacao: true, lancamentoId: "l1", parcelaNumero: 1, parcelaTotal: 2 });
    expect(desabilitado("desfazer-renegociacao")).toBe(false);
    expect(motivo("cancelar")).toBe("Renegociação: use “Desfazer renegociação”.");
    expect(motivo("excluir")).toBe("Renegociação: use “Desfazer renegociação”.");
    await clicar(itemMenu("desfazer-renegociacao"));
    await clicar($("[data-confirmar-desfazer]"));
    expect(txt($("[data-erro-conta]"))).toBe("Informe o motivo.");
    expect(enviados("POST")).toEqual([]);
    respostas["POST /api/contas-receber/cr1/renegociacao/desfazer"] = { status: 200, corpo: { ok: true, numero: "CR-2026-0050", originais: ["CR-2026-0042", "CR-2026-0043"] } };
    await digitar($('[data-desfazer-renegociacao] textarea'), "Cliente desistiu");
    await clicar($("[data-confirmar-desfazer]"));
    expect(enviados("POST")).toEqual([{ url: "/api/contas-receber/cr1/renegociacao/desfazer", metodo: "POST", corpo: { motivo: "Cliente desistiu" } }]);
    expect(avisos.toast).toHaveBeenCalledWith("Renegociação CR-2026-0050 desfeita: CR-2026-0042, CR-2026-0043 voltaram a receber.", "sucesso");
    // Recusa do servidor (já entrou dinheiro) aparece no modal
    chamadas.length = 0;
    respostas["POST /api/contas-receber/cr1/renegociacao/desfazer"] = { status: 409, corpo: { erro: "Já entrou dinheiro em CR-2026-0050/2: não dá para desfazer." } };
    await menu({ renegociacao: true });
    await clicar(itemMenu("desfazer-renegociacao"));
    await digitar($('[data-desfazer-renegociacao] textarea'), "Cliente desistiu");
    await clicar($("[data-confirmar-desfazer]"));
    expect(txt($("[data-erro-conta]"))).toBe("Já entrou dinheiro em CR-2026-0050/2: não dá para desfazer.");
    // Conta que não é renegociação: sem o item
    await menu();
    expect(itemMenu("desfazer-renegociacao")).toBeNull();
  });
});

describe("modal Renegociar", () => {
  it("lista as cobranças do cliente (a clicada vem marcada; a que não pode, apagada com o porquê); juros/multa/desconto mudam o total; parcelado com o editor; o plano vai ao servidor", async () => {
    respostas["GET /api/contas-receber/renegociar"] = { status: 200, corpo: lista };
    respostas["POST /api/contas-receber/renegociar"] = { status: 201, corpo: { ok: true, id: "n1", numero: "CR-2026-0050", total: 1160 } };
    await menu();
    await clicar(itemMenu("renegociar"));
    expect(chamadas.find((c) => c.url.startsWith("/api/contas-receber/renegociar"))!.url).toBe("/api/contas-receber/renegociar?clienteId=c1");
    expect($<HTMLInputElement>("[data-escolher=cr1]")!.checked).toBe(true);
    expect($<HTMLInputElement>("[data-escolher=cr2]")!.checked).toBe(false);
    expect($<HTMLInputElement>("[data-escolher=cr3]")!.disabled).toBe(true);
    expect(txt($("[data-renegociavel=cr3] [data-motivo-renegociar]"))).toBe("Cancele o boleto antes: o cliente ainda consegue pagá-lo.");
    expect(txt($("[data-resumo-reneg=total]"))).toMatch(/600,00$/);
    await clicar($("[data-escolher=cr2]"));
    await digitar($('input[aria-label="Juros"]'), "50");
    await digitar($('input[aria-label="Multa"]'), "20");
    await digitar($('input[aria-label="Desconto"]'), "10");
    expect($$("[data-resumo-renegociacao] dd").map(txt)).toEqual([
      expect.stringMatching(/1\.100,00/), expect.stringMatching(/^\+ R\$\s?50,00/), expect.stringMatching(/^\+ R\$\s?20,00/), expect.stringMatching(/^− R\$\s?10,00/), expect.stringMatching(/1\.160,00/),
    ]);
    expect(txt($("[data-resumo-reneg=saldo] dt"))).toBe("Saldo de 2 cobranças");
    // Parcelado (padrão): o editor divide o total novo
    await escolher($("[data-qtd-parcelas]"), "2");
    expect($$("[data-parcela-plano] input[type=number]").map((i) => (i as HTMLInputElement).value)).toEqual(["580", "580"]);
    expect(txt($("[data-confirmar-renegociar]"))).toMatch(/^Renegociar R\$\s?1\.160,00$/);
    await clicar($("[data-confirmar-renegociar]"));
    const [post] = enviados("POST");
    expect(post.url).toBe("/api/contas-receber/renegociar");
    expect(post.corpo).toEqual({
      contaIds: ["cr1", "cr2"], juros: 50, multa: 20, desconto: 10,
      parcelas: [{ vencimento: "2026-12-15", valor: 580 }, { vencimento: "2027-01-15", valor: 580 }], formaPagamento: null, observacao: null,
    });
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/^Renegociação CR-2026-0050 criada: R\$\s?1\.160,00 em 2 parcelas\.$/), "sucesso");
  });

  it("à vista: um vencimento com o total; desconto que zera trava; a recusa do servidor aparece", async () => {
    respostas["GET /api/contas-receber/renegociar"] = { status: 200, corpo: lista };
    respostas["POST /api/contas-receber/renegociar"] = { status: 409, corpo: { erro: "CR-2026-0042: Esta conta já foi renegociada." } };
    await menu();
    await clicar(itemMenu("renegociar"));
    await clicar($('[data-condicao-opcao="vista"]'));
    expect($("[data-editor-parcelas]")).toBeNull();
    await digitar($('input[aria-label="Desconto"]'), "600");
    expect(txt($("[data-invalido-renegociacao]"))).toBe("O desconto não pode zerar a renegociação.");
    expect($<HTMLButtonElement>("[data-confirmar-renegociar]")!.disabled).toBe(true);
    await digitar($('input[aria-label="Desconto"]'), "100");
    await escolher($('select[aria-label="Forma de pagamento"]'), "PIX");
    await clicar($("[data-confirmar-renegociar]"));
    expect(enviados("POST")[0].corpo).toMatchObject({ contaIds: ["cr1"], desconto: 100, parcelas: [{ vencimento: "2026-12-15", valor: 500 }], formaPagamento: "PIX" });
    expect(txt($("[data-renegociar] [data-erro-conta]"))).toBe("CR-2026-0042: Esta conta já foi renegociada.");
  });
});

describe("lista e gaveta", () => {
  const resumo = { VENCIDO: { v: 0, q: 0 }, VENCE_HOJE: { v: 0, q: 0 }, A_VENCER: { v: 0, q: 0 }, RECEBIDO: { v: 0, q: 0 }, PERDA: { v: 0, q: 0 }, TOTAL: { v: 0, q: 0 } };
  const props = (contas: Record<string, unknown>[], o: Record<string, unknown> = {}) => ({
    contas: contas.map((c) => ({ ...base, ...c })), clientes: [], categorias: [], interAtivo: false, resumo,
    periodo: { tipo: "todos", mes: "2026-11", de: null, ate: null, rotulo: "Todo o período" },
    total: contas.length, totalFiltrado: 0, abertoFiltrado: 0, pagina: 1, porPagina: 25,
    filtros: { q: "", card: "", clienteId: "", categoria: "", forma: "", banco: "", valorMin: "", valorMax: "", vencDe: "", vencAte: "", status: "", conta: "" },
    ...o,
  });
  const contas = [
    { id: "a", numero: "CR-1", valorRecebido: 400 },
    { id: "b", numero: "CR-2", valor: 500, status: "A_RECEBER" },
    { id: "x", numero: "CR-3", valor: 200, clienteId: "c9", clienteNome: "Outro" },
    { id: "bol", numero: "CR-4", boletoStatus: "EMITIDO" },
    { id: "r", numero: "CR-5", status: "RENEGOCIADO", valorRecebido: 100, renegociadaEmNumero: "CR-9" },
  ];

  it("caixas só nas renegociáveis (e só com a permissão); barra com o que falta; cliente diferente trava com o porquê; mesmo cliente abre o modal com as escolhidas", async () => {
    respostas["GET /api/contas-receber/renegociar"] = { status: 200, corpo: [
      { ...lista[0], id: "a", numero: "CR-1" }, { ...lista[1], id: "b", numero: "CR-2" },
    ] };
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props(contas) as any));
    const caixa = (id: string) => $(`[data-linha-conta=${id}] [data-escolher-conta]`);
    expect(["a", "b", "x", "bol", "r"].map((id) => !!caixa(id))).toEqual([true, true, true, false, false]);
    expect($("[data-barra-renegociar]")).toBeNull();
    await clicar(caixa("a"));
    await clicar(caixa("b"));
    expect(txt($("[data-barra-renegociar]"))).toMatch(/^2 cobranças · falta R\$\s?1\.100,00/);
    await clicar(caixa("x"));
    expect(txt($("[data-motivo-escolha]"))).toBe("Escolha cobranças do mesmo cliente.");
    expect($<HTMLButtonElement>("[data-abrir-renegociar]")!.disabled).toBe(true);
    await clicar(caixa("x"));
    await clicar($("[data-abrir-renegociar]"));
    expect($<HTMLInputElement>("[data-escolher=a]")!.checked).toBe(true);
    expect($<HTMLInputElement>("[data-escolher=b]")!.checked).toBe(true);
    // Sem a permissão: nem caixa nem coluna
    await montar(createElement(ContasReceberView, props(contas) as any), semPerdas());
    expect($("[data-escolher-conta]")).toBeNull();
  });

  it("renegociada na lista: selo, — em aberto com o para-onde-foi, chip do filtro; no celular, 'Renegociada em …'", async () => {
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props(contas, { filtros: { ...props([]).filtros, clienteId: "c1" } }) as any));
    expect(txt($("[data-linha-conta=r] [data-situacao]"))).toBe("Renegociada");
    expect($("[data-linha-conta=r] [data-renegociada]")!.getAttribute("title")).toBe("Renegociada em CR-9");
    expect(txt($("[data-chip-status=RENEGOCIADO]"))).toBe("Renegociada");
    expect(txt($("[data-cartao-conta=r] [data-renegociada-cartao]"))).toMatch(/^Renegociada em CR-9 · recebido R\$\s?100,00$/);
  });

  it("gaveta: a original diz para onde foi (abre a renegociação); a renegociação diz de onde veio e a composição", async () => {
    const det = (extra: Record<string, unknown>) => ({
      id: "a", numero: "CR-1", descricao: "Instalação", valor: 1000, status: "RENEGOCIADO",
      dataVencimento: "2026-11-10T00:00:00.000Z", dataRecebimento: null, criadoEm: "2026-11-01T12:00:00.000Z",
      formaPagamento: "PIX", banco: null, observacao: null, canceladaEm: null, motivoCancelamento: null, categoria: null, categoriaFinanceira: null,
      centroCusto: null, contaBancaria: null, cliente: { id: "c1", nome: "Hospital", cpfCnpj: null }, origem: "MANUAL",
      medicao: null, orcamento: null, contrato: null, ordens: [], itens: [], boleto: null, notas: [], eventos: [],
      valorRecebido: 400, saldo: 0, recebimentos: [], renegociadaEm: null, renegociacao: null, ...extra,
    });
    respostas["GET /api/contas-receber/a"] = { status: 200, corpo: det({ renegociadaEm: { id: "n1", numero: "CR-9", status: "PARCELADO", valor: 1160 } }) };
    respostas["GET /api/contas-receber/n1"] = { status: 200, corpo: det({ id: "n1", numero: "CR-9", status: "PARCELADO" }) };
    respostas["GET /api/contas-receber/p1"] = { status: 200, corpo: det({
      id: "p1", numero: "CR-9/1", status: "A_RECEBER", valorRecebido: 290,
      renegociacao: {
        id: "n1", numero: "CR-9", status: "PARCELADO", total: 1160, saldo: 1100, juros: 50, multa: 20, desconto: 10, recebido: 580,
        composicao: { principal: 550, encargos: 35, desconto: 5 },
        originais: [{ id: "a", numero: "CR-1", saldo: 600, recebido: 400 }, { id: "b", numero: "CR-2", saldo: 500, recebido: 0 }], motivoNaoDesfazer: null,
      },
    }) };
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props([{ id: "a", status: "RENEGOCIADO" }], { filtros: { ...props([]).filtros, conta: "a" } }) as any));
    expect(txt($("[data-detalhe-renegociada]"))).toMatch(/^Saldo renegociado em CR-9\s?Já recebido antes: R\$\s?400,00 \(continua recebido\)\.$/);
    await clicar($("[data-abrir-renegociacao]"));
    expect(chamadas.some((c) => c.url === "/api/contas-receber/n1")).toBe(true);
    await montar(createElement(ContasReceberView, props([{ id: "p1" }], { filtros: { ...props([]).filtros, conta: "p1" } }) as any));
    expect(txt($("[data-detalhe-renegociacao] p"))).toMatch(/^De: CR-1 \(R\$\s?600,00\), CR-2 \(R\$\s?500,00\)$/);
    expect($$("[data-composicao-renegociacao] div").map(txt)).toEqual([
      expect.stringMatching(/^Saldo renegociado\s?R\$\s?1\.100,00$/), expect.stringMatching(/^\+ Juros\s?R\$\s?50,00$/), expect.stringMatching(/^\+ Multa\s?R\$\s?20,00$/),
      expect.stringMatching(/^− Desconto\s?R\$\s?10,00$/), expect.stringMatching(/^Total\s?R\$\s?1\.160,00$/),
    ]);
    expect(txt($("[data-recebido-renegociacao]"))).toMatch(/^Recebido na renegociação: R\$\s?580,00 · R\$\s?35,00 de juros\/multa \(receita financeira\)$/);
    expect($("[data-abrir-original=b]")).not.toBeNull();
  });
});
