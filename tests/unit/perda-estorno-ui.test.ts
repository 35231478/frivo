// @vitest-environment happy-dom
/**
 * Contas a Receber — perda + estorno, num DOM de verdade:
 *  - ⋮ "Marcar como perda" (perigo; apagado com ⓘ sem a permissão Financeiro › Perdas ou com o motivo da
 *    regra), "Reverter perda" (só em perda) e "Estornar recebimento" (com recebimento ou baixa antiga);
 *  - modais: perda (quanto vira perda × o que continua recebido; motivo obrigatório), reverter (o cliente
 *    pagou: valor/data/forma — mais que o perdido trava; ou voltar a cobrar), estorno (lista os recebimentos,
 *    o do boleto apagado com o porquê, o único possível já vem escolhido; baixa antiga);
 *  - lista: card Perdas, chip "Perda", link do relatório, "—" em aberto e "Perdido" no celular; gaveta:
 *    caixa da perda, recebimento estornado riscado com quem/quando/por quê;
 *  - relatório Perdas (cards, por cliente, cobranças com link, vazio) e o alerta de 12 meses no cliente.
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
    import("@/components/providers/permissoes-provider"), import("@/components/financeiro/perdas-view"), import("@/components/financeiro/alerta-perdas-cliente"),
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

describe("⋮ Perda e Estorno", () => {
  it("Marcar como perda: liberado na cobrança em aberto; sem a permissão, apagado com o porquê (ⓘ); com boleto, o motivo da regra", async () => {
    await menu({ valorRecebido: 400 });
    expect(desabilitado("perda")).toBe(false);
    expect(itemMenu("perda")!.className).toContain("text-atrasado");
    await menu({ valorRecebido: 400 }, semPerdas());
    expect(desabilitado("perda")).toBe(true);
    expect(motivo("perda")).toBe("Sem permissão: Financeiro › Perdas (peça a um gerente).");
    expect(itemMenu("perda")!.querySelector("[data-dica]")).not.toBeNull();
    await menu({ boletoStatus: "EMITIDO" });
    expect(motivo("perda")).toBe("Cancele o boleto antes: o cliente ainda consegue pagá-lo.");
    // Recebida, cancelada, lançamento parcelado: o item nem aparece
    for (const status of ["RECEBIDO", "CANCELADO", "PARCELADO"]) { await menu({ status }); expect(itemMenu("perda")).toBeNull(); }
  });

  it("em perda: só Reverter perda (e o estorno apagado, com o porquê); nada de receber, parcelar, cobrar, boleto", async () => {
    await menu({ status: "PERDA", valorRecebido: 400, valorPerda: 600, whatsapp: "11999990000", email: "a@b.com" });
    expect(ids()).toEqual(["detalhes", "editar", "reverter-perda", "estornar", "recibo", "cancelar", "excluir"]);
    expect(motivo("estornar")).toBe("Conta em perda: reverta a perda antes de estornar.");
    expect(motivo("cancelar")).toBe("Conta em perda: reverta a perda antes.");
    expect(desabilitado("reverter-perda")).toBe(false);
    await menu({ status: "PERDA", valorPerda: 1000 }, semPerdas());
    expect(motivo("reverter-perda")).toBe("Sem permissão: Financeiro › Perdas (peça a um gerente).");
  });

  it("modal Marcar como perda: mostra o que vira perda e o que continua recebido; sem motivo não envia; com motivo, POST e toast", async () => {
    await menu({ valorRecebido: 400 });
    await clicar(itemMenu("perda"));
    const dds = $$("[data-marcar-perda] dd").map(txt);
    expect(dds).toEqual([expect.stringMatching(/600,00/), expect.stringMatching(/400,00/)]);
    expect($("[data-marcar-perda] [data-dica]")).not.toBeNull();
    await clicar($("[data-confirmar-perda]"));
    expect(txt($("[data-erro-conta]"))).toBe("Informe o motivo da perda.");
    expect(enviados("POST")).toEqual([]);
    await digitar($('textarea[aria-label="Motivo da perda"]'), "  Cliente faliu ");
    await clicar($("[data-confirmar-perda]"));
    expect(enviados("POST")).toEqual([{ url: "/api/contas-receber/cr1/perda", metodo: "POST", corpo: { motivo: "Cliente faliu" } }]);
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/^CR-2026-0042: perda de R\$\s?600,00 registrada\.$/), "sucesso");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("modal Reverter perda: o cliente pagou (padrão, valor = o perdido; mais que isso trava; menos avisa o que fica) ou voltar a cobrar", async () => {
    await menu({ status: "PERDA", valorRecebido: 400, valorPerda: 600 });
    await clicar(itemMenu("reverter-perda"));
    expect($<HTMLInputElement>('[data-modo-reverter="RECUPERAR"]')!.checked).toBe(true);
    expect($<HTMLInputElement>("[data-valor-recuperado]")!.value).toBe("600");
    await digitar($("[data-valor-recuperado]"), "600.01");
    expect(txt($("[data-invalido-recuperacao]"))).toMatch(/^O valor passa do que estava perdido \(R\$\s?600,00\)\.$/);
    expect($<HTMLButtonElement>("[data-confirmar-reverter]")!.disabled).toBe(true);
    await digitar($("[data-valor-recuperado]"), "250");
    expect(txt($("[data-aviso-parcial]"))).toMatch(/^Continuam em aberto R\$\s?350,00\.$/);
    await clicar($("[data-confirmar-reverter]"));
    expect(enviados("POST")).toEqual([{ url: "/api/contas-receber/cr1/perda/reverter", metodo: "POST", corpo: { modo: "RECUPERAR", motivo: null, valor: 250, data: "2026-11-15", formaPagamento: "PIX" } }]);
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/^CR-2026-0042: recuperação de R\$\s?250,00 registrada\.$/), "sucesso");

    chamadas.length = 0;
    await menu({ status: "PERDA", valorPerda: 1000 });
    await clicar(itemMenu("reverter-perda"));
    await clicar($('[data-modo-reverter="REABRIR"]'));
    expect($("[data-valor-recuperado]")).toBeNull();
    expect(txt($("[data-confirmar-reverter]"))).toBe("Voltar a cobrar");
    await digitar($('textarea[aria-label="Comentário"]'), "Prometeu pagar");
    await clicar($("[data-confirmar-reverter]"));
    expect(enviados("POST").map((c) => c.corpo)).toEqual([{ modo: "REABRIR", motivo: "Prometeu pagar" }]);
  });

  it("modal Estornar: lista os recebimentos ativos; o do boleto apagado com o porquê; o único possível já vem escolhido; motivo obrigatório", async () => {
    respostas["GET /api/contas-receber/cr1/recebimentos"] = { status: 200, corpo: [
      { id: "r1", valor: 300, data: "2026-11-05T00:00:00.000Z", origem: "MANUAL", formaPagamento: "PIX", usuario: "Ana", estornadoEm: null },
      { id: "r2", valor: 200, data: "2026-11-08T00:00:00.000Z", origem: "BOLETO", formaPagamento: null, usuario: null, estornadoEm: null },
      { id: "r3", valor: 50, data: "2026-11-01T00:00:00.000Z", origem: "MANUAL", formaPagamento: null, usuario: null, estornadoEm: "2026-11-02T00:00:00.000Z" },
    ] };
    await menu({ valorRecebido: 500 });
    await clicar(itemMenu("estornar"));
    expect($$("[data-opcao-estorno]").map((l) => l.getAttribute("data-opcao-estorno"))).toEqual(["r1", "r2"]);
    expect(txt($("[data-opcao-estorno=r1]"))).toMatch(/^05\/11\/2026\s?R\$\s?300,00\s?Informado à mão · PIX · Ana$/);
    expect(txt($("[data-opcao-estorno=r2] [data-bloqueio-estorno]"))).toBe("Pago pelo boleto no banco: o estorno é com o banco, não aqui.");
    expect($<HTMLInputElement>("[data-opcao-estorno=r2] input")!.disabled).toBe(true);
    expect($<HTMLInputElement>("[data-opcao-estorno=r1] input")!.checked).toBe(true);
    expect(txt($("[data-confirmar-estorno]"))).toMatch(/^Estornar R\$\s?300,00$/);
    await clicar($("[data-confirmar-estorno]"));
    expect(txt($("[data-erro-conta]"))).toBe("Informe o motivo do estorno.");
    expect(enviados("POST")).toEqual([]);
    await digitar($('textarea[aria-label="Motivo do estorno"]'), "Lançado em duplicidade");
    await clicar($("[data-confirmar-estorno]"));
    expect(enviados("POST")).toEqual([{ url: "/api/contas-receber/cr1/recebimentos/estornar", metodo: "POST", corpo: { recebimentoId: "r1", motivo: "Lançado em duplicidade" } }]);
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/^Estorno de R\$\s?300,00 em CR-2026-0042\. O valor volta a faltar\.$/), "sucesso");
  });

  it("modal Estornar: a baixa antiga (recebida antes do histórico) aparece como uma opção e vai sem recebimentoId", async () => {
    respostas["GET /api/contas-receber/cr1/recebimentos"] = { status: 200, corpo: [] };
    await menu({ status: "RECEBIDO", valorRecebido: 0 });
    await clicar(itemMenu("estornar"));
    expect(txt($("[data-opcao-estorno=ANTIGA]"))).toMatch(/^Baixa antiga\s?R\$\s?1\.000,00\s?Recebida antes do histórico de recebimentos\.$/);
    expect($<HTMLInputElement>("[data-opcao-estorno=ANTIGA] input")!.checked).toBe(true);
    await digitar($('textarea[aria-label="Motivo do estorno"]'), "Nunca recebemos");
    await clicar($("[data-confirmar-estorno]"));
    expect(enviados("POST").map((c) => c.corpo)).toEqual([{ motivo: "Nunca recebemos" }]);
  });
});

describe("lista, gaveta, relatório e alerta", () => {
  const resumo = { VENCIDO: { v: 0, q: 0 }, VENCE_HOJE: { v: 0, q: 0 }, A_VENCER: { v: 0, q: 0 }, RECEBIDO: { v: 0, q: 0 }, PERDA: { v: 300, q: 1 }, TOTAL: { v: 500, q: 1 } };
  const props = (contas: Record<string, unknown>[], o: Record<string, unknown> = {}) => ({
    contas: contas.map((c) => ({ ...base, ...c })), clientes: [], categorias: [], interAtivo: false, resumo,
    periodo: { tipo: "todos", mes: "2026-11", de: null, ate: null, rotulo: "Todo o período" },
    total: contas.length, totalFiltrado: 500, abertoFiltrado: 0, pagina: 1, porPagina: 25,
    filtros: { q: "", card: "", clienteId: "", categoria: "", forma: "", banco: "", valorMin: "", valorMax: "", vencDe: "", vencAte: "", status: "", conta: "" },
    ...o,
  });

  it("card Perdas (com ⓘ fora do botão), chip 'Perda' no painel, link do relatório; a linha em perda: selo, — em aberto, 'Perdido' no celular", async () => {
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props([{ status: "PERDA", valor: 500, valorRecebido: 200, valorPerda: 300 }], { filtros: { ...props([]).filtros, clienteId: "c1" } }) as any));
    expect(txt($("[data-card=PERDA]"))).toMatch(/^Perdas\s?R\$\s?300,00\s?1 cobrança$/);
    expect($("[data-card=PERDA] [data-dica]")).toBeNull();
    expect($("[data-card-caixa=PERDA] [data-dica]")).not.toBeNull();
    expect(txt($("[data-chip-status=PERDA]"))).toBe("Perda");
    expect($("[data-link-perdas]")!.getAttribute("href")).toBe("/financeiro/perdas");
    expect(txt($("[data-linha-conta=cr1] [data-situacao]"))).toBe("Perda");
    expect(txt($("[data-linha-conta=cr1] [data-em-aberto]"))).toBe("—");
    expect($("[data-linha-conta=cr1] [data-perdido]")!.getAttribute("title")).toMatch(/^Perdido: R\$\s?300,00$/);
    expect($("[data-linha-conta=cr1] [data-selo-parcial]")).toBeNull();
    expect(txt($("[data-cartao-conta=cr1] [data-perda-cartao]"))).toMatch(/^Perdido R\$\s?300,00 · recebido R\$\s?200,00$/);
  });

  it("gaveta: caixa da perda (quanto, quando, quem, por quê); recebimento estornado riscado com quem/quando/motivo", async () => {
    respostas["GET /api/contas-receber/cr1"] = { status: 200, corpo: {
      id: "cr1", numero: "CR-2026-0042", descricao: "Instalação", valor: 1000, status: "PERDA",
      dataVencimento: "2026-11-10T00:00:00.000Z", dataRecebimento: null, criadoEm: "2026-11-01T12:00:00.000Z",
      formaPagamento: "PIX", banco: null, observacao: null, canceladaEm: null, motivoCancelamento: null, categoria: null, categoriaFinanceira: null,
      centroCusto: null, contaBancaria: null, cliente: { id: "c1", nome: "Hospital", cpfCnpj: null }, origem: "MANUAL",
      medicao: null, orcamento: null, contrato: null, ordens: [], itens: [], boleto: null, notas: [],
      eventos: [{ id: "ev1", tipo: "PERDA", detalhe: "Perda de R$ 600,00", criadoEm: "2026-11-15T15:00:00.000Z", usuario: "Ana" }],
      valorRecebido: 400, saldo: 0,
      recebimentos: [
        { id: "rc1", valor: 400, data: "2026-11-05T00:00:00.000Z", formaPagamento: "PIX", origem: "MANUAL", observacao: null, contaBancaria: null, usuario: "Ana", estornadoEm: null },
        { id: "rc2", valor: 100, data: "2026-11-06T00:00:00.000Z", formaPagamento: null, origem: "MANUAL", observacao: null, contaBancaria: null, usuario: "Ana", estornadoEm: "2026-11-07T13:00:00.000Z", motivoEstorno: "Duplicado", estornadoPor: "Beto" },
      ],
      perda: { valor: 600, em: "2026-11-15T15:00:00.000Z", motivo: "Cliente faliu", por: "Ana" },
    } };
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props([{ status: "PERDA", valorRecebido: 400, valorPerda: 600 }], { filtros: { ...props([]).filtros, conta: "cr1" } }) as any));
    expect(txt($("[data-detalhe-perda]"))).toMatch(/^Perda de R\$\s?600,00 em 15\/11\/2026 por Ana — Cliente faliu\s?Já recebido antes: R\$\s?400,00 \(continua recebido\)\.$/);
    expect($("[data-recebimento=rc1]")!.hasAttribute("data-estornado")).toBe(false);
    expect($("[data-recebimento=rc2]")!.hasAttribute("data-estornado")).toBe(true);
    expect($("[data-recebimento=rc2] p")!.className).toContain("line-through");
    expect($("[data-recebimento=rc2] > span")!.className).toContain("line-through");
    expect($("[data-recebimento=rc1] p")!.className).not.toContain("line-through");
    expect(txt($("[data-recebimento=rc2] [data-estorno-detalhe]"))).toBe("Estornado em 07/11/2026 por Beto — Duplicado");
    expect(txt($("[data-evento=PERDA]"))).toMatch(/^Marcada como perda — Perda de R\$ 600,00/);
  });

  const perdas = {
    periodo: { tipo: "mes", mes: "2026-11", de: null, ate: null, rotulo: "Novembro de 2026" },
    total: { valor: 1500, qtd: 2, clientes: 2 },
    clientes: [{ clienteId: "c3", nome: "Mercado", qtd: 1, valor: 900 }, { clienteId: "c2", nome: "Padaria", qtd: 1, valor: 600 }],
    linhas: [
      { id: "p1", numero: "CR-2026-0101", descricao: "P1", cliente: "Padaria", clienteId: "c2", valor: 700, recebido: 100, valorPerda: 600, perdaEm: "2026-11-15T15:00:00.000Z", motivo: "Faliu", vencimento: null, por: "Beto" },
      { id: "p2", numero: "CR-2026-0102", descricao: "P2", cliente: "Mercado", clienteId: "c3", valor: 900, recebido: 0, valorPerda: 900, perdaEm: "2026-11-14T15:00:00.000Z", motivo: "Sumiu", vencimento: null, por: null },
    ],
  };
  it("relatório Perdas: cards, por cliente (com total), cobranças com link para a gaveta em todo o período; período navega pela URL", async () => {
    const { PerdasView } = await import("@/components/financeiro/perdas-view");
    await montar(createElement(PerdasView, perdas as any));
    expect(txt($("[data-card=valor]"))).toMatch(/^Perdido no período\s?R\$\s?1\.500,00\s?2 cobranças$/);
    expect(txt($("[data-card=maior-cliente]"))).toMatch(/^Maior perda por cliente\s?R\$\s?900,00\s?Mercado · 2 clientes no período$/);
    expect($$("[data-perdas-por-cliente] tr[data-cliente-perda]").map((tr) => $$("td").length && [...tr.querySelectorAll("td")].map(txt))).toEqual([
      ["Mercado", "1", "900,00"], ["Padaria", "1", "600,00"],
    ]);
    expect(txt($("[data-total-perdas]"))).toBe("1.500,00");
    const linha = (id: string) => [...$(`tr[data-linha-perda=${id}]`)!.querySelectorAll("td")].map(txt);
    expect(linha("p1")).toEqual(["15/11/2026", "CR-2026-0101", "PadariaP1", "Faliu", "Beto", "100,00", "600,00"]);
    expect(linha("p2")).toEqual(["14/11/2026", "CR-2026-0102", "MercadoP2", "Sumiu", "—", "—", "900,00"]);
    expect($("tr[data-linha-perda=p1] [data-abrir-conta]")!.getAttribute("href")).toBe("/financeiro/contas-receber?conta=p1&periodo=todos");
    // Celular: um cartão por cobrança, também com link
    expect($("li[data-linha-perda=p2] a")!.getAttribute("href")).toBe("/financeiro/contas-receber?conta=p2&periodo=todos");
    // ⓘ do título fora de link/botão
    expect($("[data-tela-perdas] h1 + [data-dica], [data-tela-perdas] [data-dica]")!.closest("a,button[data-card]")).toBeNull();
    await clicar($("[data-mes-anterior]"));
    expect(String(nav.replace.mock.calls.at(-1)?.[0] ?? nav.push.mock.calls.at(-1)?.[0])).toContain("mes=2026-10");
  });

  it("relatório vazio: diz o mês e oferece todo o período", async () => {
    const { PerdasView } = await import("@/components/financeiro/perdas-view");
    await montar(createElement(PerdasView, { ...perdas, total: { valor: 0, qtd: 0, clientes: 0 }, clientes: [], linhas: [] } as any));
    expect(txt($("[data-lista-vazia] p"))).toBe("Nenhuma perda em novembro de 2026");
    expect($("[data-perdas-lista]")).toBeNull();
    await clicar($("[data-ver-todo-periodo]"));
    expect(String(nav.replace.mock.calls.at(-1)?.[0])).toContain("periodo=todos");
  });

  it("alerta de 12 meses: só com perda; diz quantas, quanto e a última; 'Ver cobranças' só para quem tem Contas a Receber", async () => {
    const { AlertaPerdasCliente } = await import("@/components/financeiro/alerta-perdas-cliente");
    await montar(createElement(AlertaPerdasCliente, { clienteId: "c1", perdas: { qtd: 0, valor: 0, ultimaEm: null } }));
    expect($("[data-alerta-perdas]")).toBeNull();
    await montar(createElement(AlertaPerdasCliente, { clienteId: "c1", perdas: { qtd: 2, valor: 1500, ultimaEm: "2026-11-15T15:00:00.000Z" } }));
    expect(txt($("[data-alerta-perdas]"))).toMatch(/^Cliente com perda nos últimos 12 meses: 2 cobranças · R\$\s?1\.500,00 · última em 15\/11\/2026/);
    expect($("[data-alerta-perdas]")!.getAttribute("role")).toBe("status");
    expect($("[data-ver-perdas-cliente]")!.getAttribute("href")).toBe("/financeiro/contas-receber?clienteId=c1&status=PERDA&periodo=todos");
    expect($("[data-alerta-perdas] [data-dica]")!.closest("a")).toBeNull();
    const semCR = permissoesTotais(); semCR.financeiro.contasReceber = false;
    await montar(createElement(AlertaPerdasCliente, { clienteId: "c1", perdas: { qtd: 1, valor: 50, ultimaEm: null } }), semCR);
    expect(txt($("[data-alerta-perdas]"))).toMatch(/1 cobrança · R\$\s?50,00$/);
    expect($("[data-ver-perdas-cliente]")).toBeNull();
  });
});
