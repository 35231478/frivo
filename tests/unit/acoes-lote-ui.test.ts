// @vitest-environment happy-dom
/**
 * "Ações em lote" nas listas de Contas a Receber e a Pagar, num DOM de verdade:
 *  - a barra flutuante aparece com a seleção e tem o menu "Ações em lote" (3 ações, só essas);
 *  - cada ação abre o modal com o formulário e o RESUMO antes de confirmar: marcar 5 (1 já
 *    recebida/paga) → "4 serão baixadas (R$ …), 1 ignorada (já recebida)" — pelo saldo;
 *  - confirmar manda UM pedido com os ids marcados e os dados do formulário; o resultado mostra o
 *    que foi feito e o que foi ignorado com o motivo; fechar limpa a seleção e recarrega;
 *  - vencimento: data única / empurrar dias (sem vencimento + dias = ignorada); cancelar exige motivo;
 *  - nada elegível = botão travado; erro do servidor fica no modal e nada some;
 *  - permissão: em Contas a Pagar sem Fluxo de caixa a barra não aparece (a seleção continua);
 *  - celular: marcar pelo cartão abre a mesma barra.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), qs: "", path: "/financeiro/contas-receber" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.qs),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([import("@/components/financeiro/contas-receber-view"), import("@/components/financeiro/contas-pagar-view"), import("@/components/providers/permissoes-provider")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.refresh.mockClear(); nav.qs = "";
  respostas = {
    "GET /api/cadastros/contas-bancarias": { status: 200, corpo: [{ id: "cb1", nome: "Inter PJ", ativo: true }] },
    "GET /api/preferencias/": { status: 200, corpo: { valor: null } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 404, corpo: { erro: "não mapeado" } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-15T15:00:00.000Z")); // "hoje" = 15/11/2026
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
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
async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montar(el: React.ReactElement, permissoes: Permissoes = permissoesTotais()) {
  if (caixa?.isConnected) { act(() => root.unmount()); caixa.remove(); }
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}
const marcar = async (escopo: string, ids: string[]) => { for (const id of ids) await clicar($(`${escopo} [data-selecao-linha=${id}]`)); };
const posts = () => chamadas.filter((c) => c.metodo === "POST");
const abrirAcao = async (acao: string) => { await clicar($("[data-acoes-lote]")); await clicar($(`[data-acao-lote=${acao}]`)); };

/* ───────── Contas a Receber ───────── */
const baseCR = {
  id: "cr1", numero: "CR-1", descricao: "Serviço", valor: 1000, dataVencimento: "2026-11-20T00:00:00.000Z", dataRecebimento: null,
  status: "A_RECEBER", banco: null, clienteId: "c1", clienteNome: "Hospital Santa Luzia", clienteCnpj: null, clienteLogo: null, formaPagamento: null,
  whatsapp: null, email: null, notificacaoEnviadaEm: null, boletoStatus: null, boletoEmitidoEm: null, boletoVencimento: null, boletoLinhaDigitavel: null, boletoCodigoBarras: null,
  categoriaId: null, categoria: null, observacao: null, centroCustoId: null, contaBancariaId: null, notas: [], valorRecebido: 0,
};
const resumoCR = { VENCIDO: { v: 0, q: 0 }, VENCE_HOJE: { v: 0, q: 0 }, A_VENCER: { v: 0, q: 0 }, RECEBIDO: { v: 0, q: 0 }, PERDA: { v: 0, q: 0 }, TOTAL: { v: 0, q: 0 } };
const contasCR = [
  baseCR,
  { ...baseCR, id: "cr2", numero: "CR-2", valor: 500 },
  { ...baseCR, id: "cr3", numero: "CR-3", status: "RECEBIDO", valorRecebido: 1000, dataRecebimento: "2026-11-01T00:00:00.000Z" }, // já recebida
  { ...baseCR, id: "cr4", numero: "CR-4", valor: 800, valorRecebido: 300 },                                                       // recebida em parte: falta 500
  { ...baseCR, id: "cr5", numero: "CR-5", status: "ATRASADO", valor: 0.1, dataVencimento: "2026-10-01T00:00:00.000Z" },
  { ...baseCR, id: "cr6", numero: "CR-6", boletoStatus: "EMITIDO" },
  { ...baseCR, id: "cr7", numero: "CR-7", dataVencimento: null },
];
const propsCR = (o: Record<string, unknown> = {}) => ({
  contas: contasCR, clientes: [], categorias: [], interAtivo: false, resumo: resumoCR,
  periodo: { tipo: "todos", mes: null, de: null, ate: null, rotulo: "Todo o período" },
  total: contasCR.length, totalFiltrado: 0, abertoFiltrado: 0, pagina: 1, porPagina: 25,
  filtros: { q: "", card: "", clienteId: "", categoria: "", forma: "", banco: "", valorMin: "", valorMax: "", vencDe: "", vencAte: "", status: "", conta: "" },
  ...o,
});
async function telaCR(permissoes?: Permissoes) {
  nav.path = "/financeiro/contas-receber";
  const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
  await montar(createElement(ContasReceberView, propsCR() as any), permissoes);
}

describe("Contas a Receber", () => {
  it("barra com a seleção: contagem + 'falta', menu 'Ações em lote' com as 3 ações (só elas); some ao limpar", async () => {
    await telaCR();
    expect($("[data-barra-selecao]")).toBeNull();
    await marcar("[data-tabela-receber]", ["cr1", "cr2"]);
    expect(txt($("[data-barra-contagem]"))).toBe("2 cobranças · falta R$ 1.500,00");
    expect($("[data-menu-lote]")).toBeNull();
    await clicar($("[data-acoes-lote]"));
    expect($$("[data-menu-lote] [data-acao-lote]").map((b) => [b.getAttribute("data-acao-lote"), txt(b)])).toEqual([
      ["baixar", "Dar como recebido"], ["vencimento", "Editar vencimento"], ["cancelar", "Cancelar cobranças"],
    ]);
    expect($("[data-acoes-lote]")!.getAttribute("aria-expanded")).toBe("true");
    await clicar($("[data-limpar-escolha]"));
    expect($("[data-barra-selecao]")).toBeNull();
    expect($$("[data-selecionada]")).toHaveLength(0);
  });

  it("dar como recebido: 5 marcadas (1 já recebida) → resumo '4 serão baixadas (R$ 2.000,10), 1 ignorada'; confirma com data/forma/conta; resultado; fechar limpa e recarrega", async () => {
    respostas["POST /api/contas-receber/lote"] = { status: 200, corpo: {
      ok: true, total: 2000.1, resumo: { pedidas: 5, feitas: 4, ignoradas: 1 },
      feitas: [{ id: "cr1", numero: "CR-1", detalhe: "R$ 1.000,00 em 15/11/2026" }, { id: "cr2", numero: "CR-2", detalhe: "R$ 500,00 em 15/11/2026" }, { id: "cr4", numero: "CR-4", detalhe: "R$ 500,00 em 15/11/2026" }, { id: "cr5", numero: "CR-5", detalhe: "R$ 0,10 em 15/11/2026" }],
      ignoradas: [{ id: "cr3", numero: "CR-3", motivo: "Esta conta já foi recebida." }],
    } };
    await telaCR();
    await marcar("[data-tabela-receber]", ["cr1", "cr2", "cr3", "cr4", "cr5"]);
    await abrirAcao("baixar");
    expect(txt($('[role="dialog"] h3'))).toBe("Dar como recebido — 5 cobranças");
    expect($("[data-form-lote=baixar]")).not.toBeNull();
    expect(txt($("[data-resumo-lote] > p"))).toBe("4 serão baixadas (R$ 2.000,10), 1 ignorada (1 já foi recebida)");
    expect($$("[data-resumo-lote] [data-ignorada]").map((l) => txt(l))).toEqual(["CR-3 Esta conta já foi recebida."]);
    expect($<HTMLInputElement>('[data-form-lote] input[aria-label="Data"]')!.value).toBe("15/11/2026"); // padrão: hoje
    expect(txt($("[data-confirmar-lote]"))).toBe("Dar como recebido (4)");
    await escolher($("[data-forma-lote]"), "PIX");
    await escolher($('select[name="contaBancariaId"]'), "cb1");
    await clicar($("[data-confirmar-lote]"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe("/api/contas-receber/lote");
    expect(posts()[0].corpo).toEqual({ acao: "baixar", ids: ["cr1", "cr2", "cr3", "cr4", "cr5"], data: "2026-11-15", formaPagamento: "PIX", contaBancariaId: "cb1" });
    expect(txt($("[data-resultado-lote] [data-feitas]"))).toBe("4 baixadas · R$ 2.000,10");
    expect(txt($("[data-resultado-lote] [data-ignoradas-n]"))).toBe("1 ignorada");
    expect($$("[data-resultado-lote] [data-feitas-lista] li").map(txt)).toEqual(["CR-1 · R$ 1.000,00 em 15/11/2026", "CR-2 · R$ 500,00 em 15/11/2026", "CR-4 · R$ 500,00 em 15/11/2026", "CR-5 · R$ 0,10 em 15/11/2026"]);
    expect(txt($("[data-resultado-lote] [data-ignorada=cr3]"))).toBe("CR-3 Esta conta já foi recebida.");
    expect(nav.refresh).not.toHaveBeenCalled();
    await clicar($("[data-fechar-lote]"));
    expect($('[role="dialog"]')).toBeNull();
    expect($("[data-barra-selecao]")).toBeNull(); // seleção limpa
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("alterar vencimento: data única (todas, menos recebida e boleto) ou empurrar dias (a sem vencimento também fica de fora); o pedido leva o modo", async () => {
    respostas["POST /api/contas-receber/lote"] = { status: 200, corpo: { ok: true, total: 0, resumo: { pedidas: 4, feitas: 2, ignoradas: 2 }, feitas: [], ignoradas: [] } };
    await telaCR();
    await marcar("[data-tabela-receber]", ["cr1", "cr3", "cr6", "cr7"]);
    await abrirAcao("vencimento");
    expect($<HTMLInputElement>("[data-modo-venc=data]")!.checked).toBe(true);
    expect(txt($("[data-resumo-lote] > p"))).toBe("2 serão alteradas, 2 ignoradas (1 recebida · 1 boleto emitido: cancele o boleto para mudar)");
    expect($<HTMLButtonElement>("[data-confirmar-lote]")!.disabled).toBe(false);
    await clicar($("[data-confirmar-lote]")); // sem a data: erro no modal, nada enviado
    expect(txt($("[data-erro-lote]"))).toBe("Informe a nova data de vencimento.");
    expect(posts()).toHaveLength(0);
    await clicar($("[data-modo-venc=dias]"));
    expect($<HTMLInputElement>("[data-dias-lote]")!.value).toBe("30");
    expect(txt($("[data-resumo-lote] > p"))).toBe("1 será alterada, 3 ignoradas (1 recebida · 1 boleto emitido: cancele o boleto para mudar · 1 sem vencimento: escolha uma data única)");
    await digitar($("[data-dias-lote]"), "0");
    await clicar($("[data-confirmar-lote]"));
    expect(txt($("[data-erro-lote]"))).toContain("Informe quantos dias");
    await digitar($("[data-dias-lote]"), "-7");
    await clicar($("[data-confirmar-lote]"));
    expect(posts()[0].corpo).toEqual({ acao: "vencimento", ids: ["cr1", "cr3", "cr6", "cr7"], vencimento: { modo: "dias", dias: -7 } });
    expect($("[data-resultado-lote]")).not.toBeNull();
  });

  it("cancelar: texto claro (cancelamento, não exclusão), motivo obrigatório, botão vermelho; erro do servidor fica no modal e a seleção não some", async () => {
    respostas["POST /api/contas-receber/lote"] = { status: 500, corpo: { erro: "Não foi possível concluir: nada foi alterado. Tente de novo." } };
    await telaCR();
    await marcar("[data-tabela-receber]", ["cr1", "cr3", "cr4"]);
    await abrirAcao("cancelar");
    expect(txt($("[data-form-lote=cancelar] > p"))).toContain("é cancelamento, não exclusão");
    expect(txt($("[data-resumo-lote] > p"))).toBe("1 será cancelada, 2 ignoradas (1 recebida não pode ser cancelada · 1 já tem recebimento parcial: não pode ser cancelada)");
    await clicar($("[data-confirmar-lote]"));
    expect(txt($("[data-erro-lote]"))).toBe("Informe o motivo do cancelamento.");
    await digitar($("[data-motivo-lote]"), "Duplicada");
    await clicar($("[data-confirmar-lote]"));
    expect(posts()[0].corpo).toEqual({ acao: "cancelar", ids: ["cr1", "cr3", "cr4"], motivo: "Duplicada" });
    expect(txt($("[data-erro-lote]"))).toBe("Não foi possível concluir: nada foi alterado. Tente de novo.");
    expect($("[data-resultado-lote]")).toBeNull();
    expect($$("[data-tabela-receber] tr[data-selecionada]")).toHaveLength(3);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("nada elegível: resumo em aviso e botão travado; com 'Perdas' a barra também tem Renegociar, sem ela só o lote", async () => {
    await telaCR();
    await marcar("[data-tabela-receber]", ["cr3"]);
    expect($("[data-abrir-renegociar]")).not.toBeNull();
    await abrirAcao("baixar");
    expect(txt($("[data-resumo-lote] > p"))).toBe("0 serão baixadas, 1 ignorada (1 já foi recebida)");
    expect($<HTMLButtonElement>("[data-confirmar-lote]")!.disabled).toBe(true);
    const semPerdas = permissoesTotais(); semPerdas.financeiro.perdas = false;
    await telaCR(semPerdas);
    await marcar("[data-cartoes-receber]", ["cr1"]); // pelo cartão do celular
    expect($("[data-barra-selecao]")).not.toBeNull();
    expect($("[data-acoes-lote]")).not.toBeNull();
    expect($("[data-abrir-renegociar]")).toBeNull();
  });
});

/* ───────── Contas a Pagar ───────── */
const baseCP = {
  id: "cp1", numero: "CP-1", descricao: "Peças", valorTotal: 1000, valorPago: 0, saldoRestante: 1000, dataVencimento: "2026-11-20T00:00:00.000Z", status: "PENDENTE",
  categoriaId: null, categoria: null, centroCusto: null, fornecedor: { id: "f1", nome: "Elétrica Central", documento: null, ativo: true, semCadastro: false },
  temBoleto: false, notaCompra: null, pedidoCompra: null,
};
const contasCP = [
  baseCP,
  { ...baseCP, id: "cp2", numero: "CP-2", valorTotal: 250.5, saldoRestante: 250.5, status: "VENCIDO", dataVencimento: "2026-10-01T00:00:00.000Z" },
  { ...baseCP, id: "cp3", numero: "CP-3", status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 },          // já paga
  { ...baseCP, id: "cp4", numero: "CP-4", status: "PAGO_PARCIAL", valorPago: 400, saldoRestante: 600 },        // falta 600
  { ...baseCP, id: "cp5", numero: "CP-5", status: "CANCELADO", saldoRestante: 0 },
];
const propsCP = () => ({
  contas: contasCP, resumo: { VENCIDO: { v: 0, q: 0 }, VENCE_HOJE: { v: 0, q: 0 }, A_VENCER: { v: 0, q: 0 }, PAGO: { v: 0, q: 0 }, TOTAL: { v: 0, q: 0 } },
  periodo: { tipo: "todos", mes: null, de: null, ate: null, rotulo: "Todo o período" },
  filtros: { fornecedor: "", card: "", status: "", fornecedorId: "", categoria: "", centro: "", origem: "" },
  categorias: [], centros: [], fornecedores: [], total: contasCP.length, pagina: 1, porPagina: 25, totalFiltrado: 0, totalAberto: 0, podeImportarNf: false,
});
async function telaCP(permissoes?: Permissoes) {
  nav.path = "/financeiro/contas-pagar";
  const { ContasPagarView } = await import("@/components/financeiro/contas-pagar-view");
  await montar(createElement(ContasPagarView, propsCP() as any), permissoes);
}

describe("Contas a Pagar", () => {
  it("dar como pago: 5 marcadas (1 paga, 1 cancelada) → 3 pelo saldo (R$ 1.850,50); o pedido leva data, forma e banco", async () => {
    respostas["POST /api/contas-pagar/lote"] = { status: 200, corpo: {
      ok: true, total: 1850.5, resumo: { pedidas: 5, feitas: 3, ignoradas: 2 },
      feitas: [{ id: "cp1", numero: "CP-1", detalhe: "R$ 1.000,00 em 15/11/2026" }, { id: "cp2", numero: "CP-2", detalhe: "R$ 250,50 em 15/11/2026" }, { id: "cp4", numero: "CP-4", detalhe: "R$ 600,00 em 15/11/2026" }],
      ignoradas: [{ id: "cp3", numero: "CP-3", motivo: "Esta conta já foi paga." }, { id: "cp5", numero: "CP-5", motivo: "Conta cancelada não recebe baixa." }],
    } };
    await telaCP();
    await marcar("[data-tabela-pagar]", ["cp1", "cp2", "cp3", "cp4", "cp5"]);
    expect(txt($("[data-barra-contagem]"))).toBe("5 contas · falta R$ 1.850,50");
    await abrirAcao("baixar");
    expect(txt($('[role="dialog"] h3'))).toBe("Dar como pago — 5 contas");
    expect(txt($("[data-resumo-lote] > p"))).toBe("3 serão baixadas (R$ 1.850,50), 2 ignoradas (1 já foi paga · 1 cancelada não recebe baixa)");
    expect($('select[name="contaBancariaId"]')).toBeNull(); // a pagar: banco em texto
    await escolher($("[data-forma-lote]"), "TRANSFERENCIA");
    await digitar($("[data-banco-lote]"), "Itaú");
    await clicar($("[data-confirmar-lote]"));
    expect(posts()[0].url).toBe("/api/contas-pagar/lote");
    expect(posts()[0].corpo).toEqual({ acao: "baixar", ids: ["cp1", "cp2", "cp3", "cp4", "cp5"], data: "2026-11-15", formaPagamento: "TRANSFERENCIA", banco: "Itaú" });
    expect(txt($("[data-resultado-lote] [data-feitas]"))).toBe("3 baixadas · R$ 1.850,50");
    expect($$("[data-resultado-lote] [data-ignorada]").map(txt)).toEqual(["CP-3 Esta conta já foi paga.", "CP-5 Conta cancelada não recebe baixa."]);
    await clicar($("[data-fechar-lote]"));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect($("[data-barra-selecao]")).toBeNull();
  });

  it("cancelar: paga, com pagamento lançado e cancelada ficam de fora; vencimento: data única; sem a permissão de Fluxo de caixa não há barra (a seleção e o painel continuam)", async () => {
    respostas["POST /api/contas-pagar/lote"] = { status: 200, corpo: { ok: true, total: 0, resumo: { pedidas: 5, feitas: 2, ignoradas: 3 }, feitas: [{ id: "cp1", numero: "CP-1", detalhe: "Cancelada" }, { id: "cp2", numero: "CP-2", detalhe: "Cancelada" }], ignoradas: [] } };
    await telaCP();
    await marcar("[data-cartoes-pagar]", ["cp1", "cp2", "cp3", "cp4", "cp5"]); // pelos cartões do celular
    await abrirAcao("cancelar");
    expect(txt($("[data-resumo-lote] > p"))).toBe("2 serão canceladas, 3 ignoradas (1 paga não pode ser cancelada · 1 já tem pagamento lançado: cancele pela tela da conta, conferindo o histórico · 1 já está cancelada)");
    await digitar($("[data-motivo-lote]"), "Fornecedor cancelou");
    await clicar($("[data-confirmar-lote]"));
    expect(posts()[0].corpo).toMatchObject({ acao: "cancelar", motivo: "Fornecedor cancelou" });
    expect(txt($("[data-resultado-lote] [data-feitas]"))).toBe("2 canceladas");
    await clicar($("[data-fechar-lote]"));
    expect($("[data-barra-selecao]")).toBeNull(); // fez algo: a seleção limpa
    await marcar("[data-tabela-pagar]", ["cp1", "cp3"]);
    await abrirAcao("vencimento");
    expect(txt($("[data-resumo-lote] > p"))).toBe("1 será alterada, 1 ignorada (1 paga)");
    await digitar($('[data-form-lote] input[aria-label="Nova data de vencimento"]'), "10/12/2026");
    await clicar($("[data-confirmar-lote]"));
    expect(posts().at(-1)!.corpo).toEqual({ acao: "vencimento", ids: ["cp1", "cp3"], vencimento: { modo: "data", data: "2026-12-10" } });

    const semFluxo = permissoesTotais(); semFluxo.financeiro.fluxoCaixa = false;
    await telaCP(semFluxo);
    await marcar("[data-tabela-pagar]", ["cp1"]);
    expect($("[data-tabela-pagar] tr[data-selecionada]")).not.toBeNull();
    expect($("[data-painel-totais]")!.getAttribute("data-modo")).toBe("selecao");
    expect($("[data-barra-selecao]")).toBeNull();
    expect($("[data-espaco-barra]")).toBeNull();
  });
});
