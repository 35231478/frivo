// @vitest-environment happy-dom
/**
 * Painel de pendências nas telas, num DOM de verdade (o servidor é um substituto; as regras estão em
 * pendencias-regras e o banco em pendencias-pg):
 *  - o sino: "Ver pendências de hoje" no topo; OS sem técnico e orçamento vencendo com o destino do catálogo;
 *    as contas do dia nunca no sino; a segunda trava de permissão pela regra do sino;
 *  - a lista de OS: o filtro "Atribuição › Sem técnico" (?tecnico=sem), ativo ao chegar pelo painel;
 *  - a lista de orçamentos: a pílula "Vencem em até N dias" que tira o filtro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { periodoOrdens } from "@/lib/listas/filtros";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), qs: "", caminho: "/x" }));
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: nav.replace, back: () => {} }),
  usePathname: () => nav.caminho, useSearchParams: () => new URLSearchParams(nav.qs),
}));

let root: Root | undefined;
let caixa: HTMLDivElement;
let resposta: Record<string, unknown> = {};
beforeEach(() => {
  nav.replace.mockClear(); nav.qs = ""; nav.caminho = "/x";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { if (root) act(() => root!.unmount()); caixa?.remove(); root = undefined; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");
async function montar(elemento: React.ReactElement) {
  if (root) { act(() => root!.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(elemento); });
  await esperar();
}

/* ───────── o sino ───────── */
describe("sino: o link do painel e os itens novos", () => {
  const BASE = { prazosVencidos: 0, etapasVencendoHoje: 0, pedidosPendentes: 0, atendimentosAtraso: 0, chamadosPortal: 0, checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, boletosPagos: 0, orcamentosRespondidos: 0, nfPedidos: 0, nfPedidoId: null };
  async function sino(alertas: Record<string, unknown>, permissoes: Permissoes = permissoesTotais()) {
    resposta = { ...BASE, ...alertas };
    const { Header } = await import("@/components/layout/header");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const sessao = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes }, expires: "2099-01-01T00:00:00Z" };
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes } as any, createElement(Header, { session: sessao, avatarUrl: null } as any)));
    await clicar($$("button").find((b) => b.querySelector("svg.lucide-bell")) ?? null);
  }
  const link = (rotulo: string) => ($$("[data-sino-menu] a").find((a) => txt(a).startsWith(rotulo)) ?? null) as HTMLAnchorElement | null;

  it("'Ver pendências de hoje' no topo, mesmo sem alerta; o número do sino é o total da API", async () => {
    await sino({ total: 0 });
    expect($("[data-sino-pendencias]")?.getAttribute("href")).toBe("/pendencias");
    expect(txt($("[data-sino-menu]"))).toContain("Nenhum alerta no momento.");
    await sino({ osSemTecnico: 2, osSemTecnicoId: "os1", total: 2 });
    expect($$("[data-sino-menu] a")[0].hasAttribute("data-sino-pendencias")).toBe(true);
    expect(txt($$("button").find((b) => b.querySelector("svg.lucide-bell")) ?? null)).toBe("2");
  });

  it("OS sem técnico e orçamento vencendo: com vários, a lista filtrada; com um só, o registro; zero não aparece", async () => {
    await sino({ osSemTecnico: 3, osSemTecnicoId: "os1", orcamentosVencendo: 2, orcamentoVencendoId: "o1", total: 5 });
    expect([link("OS sem técnico")?.getAttribute("href"), txt(link("OS sem técnico"))]).toEqual(["/ordens?tecnico=sem", "OS sem técnico3"]);
    expect(link("Orçamentos vencendo")?.getAttribute("href")).toBe("/orcamentos?validade=vencendo&periodo=todos");
    await sino({ osSemTecnico: 1, osSemTecnicoId: "os1", orcamentosVencendo: 1, orcamentoVencendoId: "o1", total: 2 });
    expect([link("OS sem técnico")?.getAttribute("href"), link("Orçamentos vencendo")?.getAttribute("href")]).toEqual(["/ordens/os1", "/orcamentos/o1"]);
    await sino({ osSemTecnico: 0, orcamentosVencendo: 0, despesasCampo: 1, total: 1 });
    expect([link("OS sem técnico"), link("Orçamentos vencendo")]).toEqual([null, null]);
  });

  it("as contas do dia nunca aparecem no sino (mesmo que venham na resposta)", async () => {
    await sino({ despesasCampo: 1, foraDoNumero: { contasPagarHoje: 4, contasReceberHoje: 2 }, total: 1 });
    expect(txt($("[data-sino-menu]"))).not.toMatch(/Contas a (pagar|receber)/);
    expect(link("Despesas de campo a aprovar")?.getAttribute("href")).toBe("/financeiro/despesas-campo");
  });

  it("os itens do painel no sino seguem o catálogo; sem a permissão, não aparecem (mesmo que a API mande)", async () => {
    const tudo = { osSemTecnico: 1, osSemTecnicoId: "os1", orcamentosVencendo: 1, orcamentoVencendoId: "o1", despesasCampo: 1, comentariosCampo: 1, comentarioCampoOsId: "os4", atividadesEsquecidas: 1, atividadeEsquecidaOsId: "os5", estoqueNegativoCampo: 1, pmocsVencendo: 1, atendimentosAtraso: 1, total: 8 };
    await sino(tudo);
    expect([link("Comentários novos do campo"), link("Atividades esquecidas em andamento"), link("Saldo negativo por uso em campo"), link("PMOC perto de expirar"), link("OS atrasadas")].map((a) => a?.getAttribute("href")))
      .toEqual(["/ordens/os4#comentarios", "/ordens/os5", "/estoque?situacao=negativo", "/pmoc?status=VENCENDO", "/ordens?prazo=atrasadas"]);
    // só Financeiro: nada de OS, orçamento, estoque nem PMOC
    await sino(tudo, montarPermissoes({ financeiro: ["visualizar", "fluxoCaixa"] } as never));
    expect(["OS sem técnico", "Orçamentos vencendo", "Comentários novos do campo", "Saldo negativo por uso em campo", "PMOC perto de expirar", "OS atrasadas"].map(link)).toEqual([null, null, null, null, null, null]);
    expect(link("Despesas de campo a aprovar")).not.toBeNull();
    // só OS: "OS atrasadas" aparece mesmo com zero, como antes
    await sino({ total: 1, atendimentosAtraso: 0, osSemTecnico: 1, osSemTecnicoId: "os1" }, montarPermissoes({ ordens: ["visualizar"] } as never));
    expect([txt(link("OS atrasadas")), link("OS sem técnico")?.getAttribute("href"), link("Despesas de campo a aprovar")]).toEqual(["OS atrasadas0", "/ordens/os1", null]);
  });

  it("resposta sem os campos novos (versão anterior, no meio de um deploy): nada quebra e nada aparece", async () => {
    await sino({ despesasCampo: 1, total: 1 });
    expect([link("OS sem técnico"), link("Orçamentos vencendo")]).toEqual([null, null]);
    expect(link("Despesas de campo a aprovar")).not.toBeNull();
  });
});

/* ───────── a lista de OS ───────── */
describe("lista de OS: filtro 'Atribuição › Sem técnico'", () => {
  async function lista(qs = "") {
    nav.qs = qs; nav.caminho = "/ordens";
    const [{ OrdensListaClient }, { PermissoesProvider }, { periodoTela }, { SelecaoMassaProvider }] = await Promise.all([
      import("@/components/ordens/ordens-lista-client"), import("@/components/providers/permissoes-provider"), import("@/lib/periodo"), import("@/components/acoes-massa/selecao"),
    ]);
    const periodo = periodoTela(periodoOrdens(Object.fromEntries(new URLSearchParams(qs).entries())));
    await montar(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children:
      createElement(SelecaoMassaProvider as any, { entidade: "ordens", idsPagina: [], total: 0, children:
        createElement(OrdensListaClient as any, { ordens: [], total: 0, pagina: 1, porPagina: 50, periodo, opcoes: { clientes: [], usuarios: [], tiposOs: [], contratos: [] } }),
      }),
    } as any));
  }

  it("escolher 'Sem técnico' vai para a URL; chegando pelo painel, o filtro já está ligado e 'Limpar filtros' o tira", async () => {
    await lista();
    await clicar($("[data-mais-filtros]"));
    await clicar($("[data-filtro-opcao=tecnico]"));
    const sel = $<HTMLSelectElement>("select[aria-label='Atribuição']")!;
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([["", "Todas"], ["sem", "Sem técnico"]]);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "sem"); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    expect(ultimaUrl()).toBe("/ordens?tecnico=sem");
    await lista("tecnico=sem");
    expect(txt($("[data-filtros-ativos]"))).toBe("1");
    expect($$("[data-filtro-caixa]").map((c) => c.getAttribute("data-filtro-caixa"))).toEqual(["tecnico"]);
    expect($<HTMLSelectElement>("select[aria-label='Atribuição']")!.value).toBe("sem");
    await clicar($("[data-limpar-filtros]"));
    expect(new URLSearchParams(ultimaUrl().split("?")[1] ?? "").get("tecnico")).toBeNull();
  });
});

/* ───────── a lista de orçamentos ───────── */
describe("lista de orçamentos: a pílula do filtro 'vencendo'", () => {
  const resumo = { EM_ABERTO: { q: 0, v: 0 }, APROVADO: { q: 0, v: 0 }, RECUSADO: { q: 0, v: 0 }, VENCIDO: { q: 0, v: 0 }, TOTAL: { q: 0, v: 0 } };
  const TODOS = { tipo: "todos", mes: null, de: null, ate: null, rotulo: "Todo o período" } as const;
  async function cartoes(props: Record<string, unknown>) {
    nav.caminho = "/orcamentos";
    const { ListaUrl } = await import("@/components/listagem/lista-url");
    const { PeriodoCardsOrcamentos } = await import("@/components/orcamento/orcamentos-periodo");
    await montar(createElement(ListaUrl, { chave: "orcamentos", paramBusca: "busca", qAtual: "", children:
      createElement(PeriodoCardsOrcamentos, { periodo: TODOS, resumo, card: "", ...props } as any) } as any));
  }

  it("com o filtro: 'Vencem em até N dias' (o prazo da empresa) e o × volta à lista sem ele; sem o filtro, nada", async () => {
    await cartoes({ diasVencendo: 5 });
    const p = $("[data-filtro-vencendo]");
    expect(txt(p)).toBe("Vencem em até 5 dias Limpar filtro");
    expect(p?.getAttribute("href")).toBe("/orcamentos?periodo=todos");
    await cartoes({});
    expect($("[data-filtro-vencendo]")).toBeNull();
    // a pílula das respostas do sino continua a mesma
    await cartoes({ resposta: "nova" });
    expect(txt($("[data-filtro-resposta]"))).toBe("Respostas novas do cliente Limpar filtro");
  });
});
