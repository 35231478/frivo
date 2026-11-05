// @vitest-environment happy-dom
/**
 * Contas a Pagar no padrão da casa (o mesmo de Contas a Receber), num DOM de verdade:
 *  - período (‹ › sem o mês atual na URL, personalizado, todo o período) e os 5 cards do período
 *    (Vencidos · Vencem hoje · A vencer · Pagos · Total) — clicar filtra, clicar de novo tira;
 *  - desktop em "cara de planilha": Vencimento · Nº/Doc · Fornecedor · Descrição (+ NF) · Categoria ·
 *    Centro de custo · Situação · Valor (R$) · ⋮ — R$ no cabeçalho, número à direita e tabular, colunas fixas;
 *    pago em parte mostra o que falta;
 *  - painel de filtros (status, fornecedor, categoria, centro, origem) aplica tudo de uma vez SEM
 *    perder o período; "Limpar" tira os filtros; vazio no período oferece "Ver todo o período";
 *  - celular: cartões (nada de tabela cortada), com o ⋮.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/financeiro/contas-pagar", useSearchParams: () => new URLSearchParams(nav.qs),
}));

let root: Root;
let caixa: HTMLDivElement;

beforeAll(async () => {
  await Promise.all([import("@/components/financeiro/contas-pagar-view"), import("@/components/providers/permissoes-provider")]);
}, 120_000);
// "Hoje" = 15/11/2026 (só o relógio: o resto do DOM roda normal)
beforeEach(() => { nav.replace.mockClear(); nav.qs = ""; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-15T15:00:00.000Z")); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string, base: ParentNode = document) => base.querySelector(sel) as T | null;
const $$ = (sel: string, base: ParentNode = document) => [...base.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");

const base = {
  id: "cp1", numero: "CP-2026-0101", descricao: "Peças do compressor", valorTotal: 1200, valorPago: 0, saldoRestante: 1200,
  dataVencimento: "2026-11-20T00:00:00.000Z", status: "PENDENTE", categoriaId: null, categoria: null,
  centroCusto: { id: "ccObra", nome: "Obra Shopping Norte", ativo: true },
  fornecedor: { id: "fA", nome: "Elétrica Central", documento: "33444555000166", ativo: true, semCadastro: false },
  temBoleto: false, notaCompra: null, pedidoCompra: null,
};
const resumo = {
  VENCIDO: { v: 800, q: 2 }, VENCE_HOJE: { v: 500, q: 1 }, A_VENCER: { v: 1100, q: 2 }, PAGO: { v: 300, q: 1 }, TOTAL: { v: 3600, q: 6 },
};
const props = (o: Record<string, unknown> = {}) => ({
  contas: [
    base,
    { ...base, id: "cp2", numero: "NF 4521/1-2", descricao: "NF 4521/1 — parcela 2/3", valorTotal: 98765.4, valorPago: 765.4, saldoRestante: 98000,
      status: "PAGO_PARCIAL", dataVencimento: "2026-11-02T00:00:00.000Z", temBoleto: true, notaCompra: { id: "n9", numero: "4521/1" },
      fornecedor: { id: null, nome: "Fornecedor antigo em texto", documento: null, ativo: true, semCadastro: true } },
  ],
  resumo, periodo: { tipo: "mes", mes: "2026-11", de: null, ate: null, rotulo: "Novembro de 2026" },
  filtros: { fornecedor: "", card: "", status: "", fornecedorId: "", categoria: "", centro: "", origem: "" },
  categorias: [], centros: [{ id: "ccObra", nome: "Obra Shopping Norte", ativo: true }, { id: "ccVelho", nome: "Obra encerrada", ativo: false }],
  fornecedores: [{ id: "fA", nome: "Elétrica Central", ativo: true }],
  total: 2, pagina: 1, porPagina: 25, totalFiltrado: 99965.4, totalAberto: 99200, podeImportarNf: true,
  ...o,
});
async function montarTela(o: Record<string, unknown> = {}) {
  if (caixa?.isConnected) { act(() => root.unmount()); caixa.remove(); }
  nav.replace.mockClear();
  const { ContasPagarView } = await import("@/components/financeiro/contas-pagar-view");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(ContasPagarView, props(o) as any) })); });
  await esperar();
}

describe("período + cards do período", () => {
  it("5 cards na ordem, com R$ e quantidade; clicar filtra (card na URL) e clicar de novo tira; ⓘ fora do botão", async () => {
    await montarTela();
    expect($$("[data-card]").map((c) => c.getAttribute("data-card"))).toEqual(["VENCIDO", "VENCE_HOJE", "A_VENCER", "PAGO", "TOTAL"]);
    expect(txt($("[data-card=VENCIDO]"))).toMatch(/^Vencidos.*R\$\s?800,00.*2 contas$/);
    expect(txt($("[data-card=PAGO]"))).toMatch(/^Pagos.*R\$\s?300,00.*1 conta$/);
    expect(txt($("[data-card=TOTAL]"))).toMatch(/^Total do período.*R\$\s?3\.600,00.*6 contas$/);
    expect($("[data-card=A_VENCER] [data-dica]")).toBeNull();
    expect($("[data-card-caixa=A_VENCER] [data-dica]")).not.toBeNull();
    await clicar($("[data-card=VENCIDO]"));
    expect(ultimaUrl()).toBe("/financeiro/contas-pagar?card=VENCIDO");
    await montarTela({ filtros: { ...props().filtros, card: "VENCIDO" } });
    expect($("[data-card=VENCIDO]")!.getAttribute("aria-pressed")).toBe("true");
    await clicar($("[data-card=VENCIDO]"));
    expect(ultimaUrl()).toBe("/financeiro/contas-pagar");
  });

  it("período: ‹ › trocam o mês (o atual sai da URL); todo o período; personalizado", async () => {
    await montarTela();
    expect(txt($("[data-mes-rotulo]"))).toBe("Novembro de 2026");
    await clicar($("[data-mes-anterior]"));
    expect(ultimaUrl()).toBe("/financeiro/contas-pagar?mes=2026-10");
    await clicar($("[data-periodo-menu]"));
    await clicar($("[data-todo-periodo]"));
    expect(ultimaUrl()).toBe("/financeiro/contas-pagar?periodo=todos");
    await clicar($("[data-periodo-menu]"));
    await clicar($("[data-alternar-periodo]"));
    expect($("[data-intervalo]")).not.toBeNull();
  });

  it("vazio no período: mensagem do mês e 'Ver todo o período' (no desktop e no celular)", async () => {
    await montarTela({ contas: [], total: 0, totalFiltrado: 0, totalAberto: 0 });
    expect(txt($("[data-tabela-pagar] [data-lista-vazia] p"))).toBe("Nenhuma conta a pagar em novembro de 2026");
    expect($("[data-cartoes-pagar] [data-ver-todo-periodo]")).not.toBeNull();
    await clicar($("[data-tabela-pagar] [data-ver-todo-periodo]"));
    expect(ultimaUrl()).toBe("/financeiro/contas-pagar?periodo=todos");
    await montarTela({ contas: [], total: 0, periodo: { tipo: "todos", mes: null, de: null, ate: null, rotulo: "Todo o período" } });
    expect($("[data-ver-todo-periodo]")).toBeNull();
  });
});

describe("cara de planilha (desktop) e cartões (celular)", () => {
  it("cabeçalho compacto na ordem pedida; Valor (R$) à direita, tabular e sem 'R$' na célula; colunas fixas", async () => {
    await montarTela();
    const tabela = $("[data-tabela-pagar] table[data-tabela-planilha]")!;
    expect(tabela.className).toContain("text-[13px]");
    expect(tabela.className).toContain("table-fixed");
    expect($$("[data-tabela-pagar] th").map(txt)).toEqual(["Selecionar a página", "Vencimento", "Nº/Doc", "Fornecedor", "Descrição", "Categoria", "Centro de custo", "Situação", "Valor (R$)", "Ações"]);
    const l1 = $("[data-linha-conta=cp1]")!;
    expect(l1.className).toContain("border-surface-linha");
    expect(txt(l1)).toContain("20/11/2026");
    const v = $("[data-valor]", l1)!;
    expect(txt(v)).toBe("1.200,00");
    expect(v.className).toContain("text-right");
    expect(v.className).toContain("tabular-nums");
    expect($<HTMLAnchorElement>("[data-detalhe-conta]", l1)!.getAttribute("href")).toBe("/financeiro/contas-pagar/cp1");
    expect($("[data-fornecedor]", l1)!.getAttribute("title")).toBe("Elétrica Central · 33.444.555/0001-66");
    expect(txt($("[data-centro-custo]", l1))).toBe("Obra Shopping Norte");
    expect(txt($("[data-situacao]", l1))).toBe("A vencer");
  });

  it("vencida e paga em parte: linha destacada, 'Vencido', o que falta embaixo do valor, NF com link e boleto", async () => {
    await montarTela();
    const l2 = $("[data-linha-conta=cp2]")!;
    expect(l2.className).toContain("bg-atrasado-claro");
    expect(txt($("[data-situacao]", l2))).toBe("Vencido 13 dias");
    expect(txt($("[data-valor]", l2))).toBe("98.765,40falta 98.000,00");
    expect(txt($("[data-saldo]", l2))).toBe("falta 98.000,00");
    expect($("[data-saldo]", $("[data-linha-conta=cp1]")!)).toBeNull(); // só no pago em parte
    expect($<HTMLAnchorElement>("[data-origem-conta]", l2)!.getAttribute("href")).toBe("/estoque/notas/n9");
    expect(txt($("[data-origem-conta]", l2))).toBe("NF 4521/1");
    expect($("[data-tem-boleto]", l2)).not.toBeNull();
    expect(txt($("[data-fornecedor]", l2))).toBe("Fornecedor antigo em texto(sem cadastro)");
  });

  it("celular: as mesmas contas em cartões (md:hidden) com valor, situação, vencimento, o que falta e o ⋮", async () => {
    await montarTela();
    expect($("[data-cartoes-pagar]")!.className).toContain("md:hidden");
    expect($("[data-tabela-pagar] table[data-tabela-planilha]")!.closest(".md\\:block")!.className).toContain("hidden md:block");
    expect($$("[data-cartoes-pagar] [data-cartao-conta]").map((e) => e.getAttribute("data-cartao-conta"))).toEqual(["cp1", "cp2"]);
    const c2 = $("[data-cartao-conta=cp2]")!;
    expect(txt(c2)).toContain("R$ 98.765,40");
    expect(txt(c2)).toContain("Vence 02/11/2026");
    expect(txt(c2)).toContain("Falta R$ 98.000,00");
    expect($<HTMLAnchorElement>("a", c2)!.getAttribute("href")).toBe("/financeiro/contas-pagar/cp2");
    expect($("button", c2)).not.toBeNull(); // o ⋮
  });

  it("⋮ único (o mesmo menu de Contas a Receber): o que o status permite; quitada não paga nem edita", async () => {
    await montarTela({ contas: [base, { ...base, id: "cp3", numero: "CP-2026-0103", status: "PAGO_TOTAL", valorPago: 1200, saldoRestante: 0 }] });
    const itens = async (id: string) => {
      await clicar($(`[data-linha-conta=${id}] [data-acao=menu]`));
      const r = $$("[data-menu-acoes] [data-item]").map((e) => e.getAttribute("data-item"));
      await clicar($(`[data-linha-conta=${id}] [data-acao=menu]`)); // fecha
      return r;
    };
    expect(await itens("cp1")).toEqual(["detalhes", "pagar", "historico", "editar", "cancelar"]);
    expect(await itens("cp3")).toEqual(["detalhes", "historico", "cancelar"]);
    await clicar($("[data-linha-conta=cp1] [data-acao=menu]"));
    expect($<HTMLAnchorElement>("[data-menu-acoes] [data-item=detalhes]")!.getAttribute("href")).toBe("/financeiro/contas-pagar/cp1");
    expect($<HTMLAnchorElement>("[data-menu-acoes] [data-item=editar]")!.getAttribute("href")).toBe("/financeiro/contas-pagar/cp1/editar");
  });

  it("rodapé: total do filtro e o que está em aberto", async () => {
    await montarTela();
    expect(txt($("[data-total-filtrado]"))).toMatch(/^Total do filtro: R\$\s?99\.965,40 · Em aberto: R\$\s?99\.200,00$/);
  });
});

describe("busca e painel de filtros", () => {
  it("'Mais filtros': nenhum campo à vista por padrão; escolher 'Centro de custo' no menu mostra o select (inativos marcados) e a escolha vai na hora para a URL sem perder o período; os ativos aparecem sozinhos com o contador; 'Limpar filtros' tira", async () => {
    nav.qs = "mes=2026-10&card=VENCIDO";
    await montarTela();
    expect($("[data-painel-filtros]")).toBeNull(); // nada escolhido, nada ativo
    expect(($("[data-limpar-filtros]") as HTMLButtonElement).disabled).toBe(true); // nada a limpar
    await clicar($("[data-mais-filtros]"));
    expect($$("[data-filtro-opcao]").map(txt)).toEqual(["Status", "Fornecedor", "Categoria", "Centro de custo", "Origem"]);
    await clicar($("[data-filtro-opcao=centro]"));
    expect(txt($("[data-filtro=centro]"))).toContain("Obra encerrada (inativo)");
    await escolher($("[data-filtro=centro]"), "ccObra");
    expect(ultimaUrl()).toBe("/financeiro/contas-pagar?mes=2026-10&card=VENCIDO&centro=ccObra");
    nav.qs = "mes=2026-10&centro=ccObra&origem=NF";
    await montarTela({ filtros: { ...props().filtros, centro: "ccObra", origem: "NF" } });
    expect($$("[data-filtro-caixa]").map((c) => c.getAttribute("data-filtro-caixa"))).toEqual(["centro", "origem"]); // os ativos aparecem sozinhos
    expect(txt($("[data-filtros-ativos]"))).toBe("2");
    expect(($("[data-filtro=centro]") as HTMLSelectElement).value).toBe("ccObra"); // marcado
    await clicar($("[data-limpar-filtros]"));
    expect(ultimaUrl()).toBe("/financeiro/contas-pagar?mes=2026-10");
  });

  it("'Lançar a partir de NF' só para quem pode importar", async () => {
    await montarTela();
    expect($<HTMLAnchorElement>("[data-lancar-nf]")!.getAttribute("href")).toBe("/estoque/notas?de=contas-pagar");
    await montarTela({ podeImportarNf: false });
    expect($("[data-lancar-nf]")).toBeNull();
  });
});

describe("seleção de linhas + painel de totais (Total dos N selecionados)", () => {
  const seis = () => [
    base,                                                                                                                    // 1.200 a vencer (20/11)
    { ...base, id: "cp2", numero: "CP-2", valorTotal: 98765.4, valorPago: 765.4, saldoRestante: 98000, status: "PAGO_PARCIAL", dataVencimento: "2026-11-02T00:00:00.000Z" }, // vencida: falta 98.000
    { ...base, id: "cp3", numero: "CP-3", valorTotal: 500, saldoRestante: 500, status: "VENCIDO", dataVencimento: "2026-11-15T00:00:00.000Z" },           // vence hoje
    { ...base, id: "cp4", numero: "CP-4", valorTotal: 80, valorPago: 80, saldoRestante: 0, status: "PAGO_TOTAL", dataVencimento: "2026-11-01T00:00:00.000Z" }, // paga
    { ...base, id: "cp5", numero: "CP-5", valorTotal: 300, saldoRestante: 300, dataVencimento: "2026-11-25T00:00:00.000Z" },                             // a vencer
    { ...base, id: "cp6", numero: "CP-6", valorTotal: 9999, saldoRestante: 0, status: "CANCELADO", dataVencimento: "2026-11-25T00:00:00.000Z" },          // cancelada: fora do total
  ];
  const painel = () => $("[data-painel-totais]")!;
  const valor = (k: string) => txt($(`[data-painel-linha=${k}] [data-painel-valor]`));
  const qtd = (k: string) => txt($(`[data-painel-linha=${k}] [data-painel-qtd]`));
  const caixaTabela = (id: string) => $(`[data-tabela-pagar] [data-selecao-linha=${id}]`);

  it("sem seleção o rodapé mostra os totais do período (a mesma quebra dos cards); 3 de 6 marcadas: só a soma das três, linha e cartão realçados; recalcula ao desmarcar; a caixa da página marca todas", async () => {
    await montarTela({ contas: seis(), total: 6 });
    expect(painel().getAttribute("data-modo")).toBe("periodo");
    expect(txt($("[data-painel-titulo]"))).toBe("Totais do período");
    expect(txt($("[data-painel-total]"))).toBe("R$ 3.600,00");
    expect($$("[data-painel-linha]").map((l) => l.getAttribute("data-painel-linha"))).toEqual(["VENCIDO", "VENCE_HOJE", "A_VENCER", "PAGO"]);
    expect([valor("VENCIDO"), qtd("VENCIDO"), valor("PAGO"), qtd("PAGO")]).toEqual(["R$ 800,00", "2 contas", "R$ 300,00", "1 conta"]);
    expect($$("[data-selecao-linha]")).toHaveLength(12); // 6 na tabela + 6 nos cartões (a mesma seleção)

    // 3 de 6: a vencida (pelo que falta), a que vence hoje e uma a vencer
    await clicar(caixaTabela("cp2"));
    await clicar(caixaTabela("cp3"));
    await clicar($("[data-cartoes-pagar] [data-selecao-linha=cp5]")); // pelo cartão do celular também
    expect(painel().getAttribute("data-modo")).toBe("selecao");
    expect(txt($("[data-painel-titulo]"))).toBe("Total dos 3 contas selecionadas");
    expect(txt($("[data-painel-subtitulo]"))).toBe("Só do que está marcado");
    expect(txt($("[data-painel-total]"))).toBe("R$ 99.565,40"); // 98.765,40 + 500 + 300
    expect([valor("VENCIDO"), qtd("VENCIDO")]).toEqual(["R$ 98.000,00", "1 conta"]);
    expect([valor("VENCE_HOJE"), qtd("VENCE_HOJE")]).toEqual(["R$ 500,00", "1 conta"]);
    expect([valor("A_VENCER"), qtd("A_VENCER")]).toEqual(["R$ 300,00", "1 conta"]);
    expect([valor("PAGO"), qtd("PAGO")]).toEqual(["R$ 0,00", "0 contas"]);
    // Realce: a linha da planilha e o cartão do celular das marcadas, e só delas
    expect($$("[data-tabela-pagar] tr[data-selecionada]").map((tr) => tr.getAttribute("data-linha-conta"))).toEqual(["cp2", "cp3", "cp5"]);
    expect($$("[data-cartoes-pagar] li[data-selecionada]").map((li) => li.getAttribute("data-cartao-conta"))).toEqual(["cp2", "cp3", "cp5"]);
    expect($("[data-tabela-pagar] [data-linha-conta=cp2]")!.className).toContain("bg-primary-50"); // a vencida marcada fica azul, não vermelha
    expect($("[data-tabela-pagar] [data-linha-conta=cp2]")!.className).not.toMatch(/(^| )bg-atrasado-claro( |$)/);
    expect($("[data-cartoes-pagar] [data-cartao-conta=cp2]")!.className).toContain("bg-primary-50");
    expect($("[data-tabela-pagar] [data-linha-conta=cp1]")!.hasAttribute("data-selecionada")).toBe(false);

    // Desmarca a de hoje: recalcula na hora
    await clicar(caixaTabela("cp3"));
    expect(txt($("[data-painel-titulo]"))).toBe("Total dos 2 contas selecionadas");
    expect(txt($("[data-painel-total]"))).toBe("R$ 99.065,40");
    expect([valor("VENCE_HOJE"), qtd("VENCE_HOJE")]).toEqual(["R$ 0,00", "0 contas"]);

    // A caixa do cabeçalho marca a página toda (a cancelada entra na seleção, mas não no total)
    const pagina = $<HTMLInputElement>("[data-tabela-pagar] [data-selecao-pagina]")!;
    expect(pagina.indeterminate).toBe(true);
    await clicar(pagina);
    expect(txt($("[data-painel-titulo]"))).toBe("Total dos 6 contas selecionadas");
    expect(txt($("[data-painel-total]"))).toBe("R$ 100.845,40"); // 1.200 + 98.765,40 + 500 + 80 + 300
    expect([valor("PAGO"), qtd("PAGO")]).toEqual(["R$ 80,00", "1 conta"]);
    await clicar(pagina);
    expect(painel().getAttribute("data-modo")).toBe("periodo");
    expect($$("[data-selecionada]")).toHaveLength(0);
  });
});
