// @vitest-environment happy-dom
/**
 * O sino lido na tela (o servidor é um substituto; a regra está em sino-lidos e o banco em pendencias-pg):
 *  - o toque fecha o sino, o número cai na hora e a marca vai para /api/alertas/lidos com a assinatura;
 *  - o aviso lido fica na lista, apagado, com o porquê no tooltip; tocar de novo não grava outra vez;
 *  - com tudo lido, a lista continua (não vira "Nenhum alerta");
 *  - os destinos: chamados do portal nas solicitações pendentes, compras só as abertas, veículos em
 *    manutenção, a resposta de orçamento única abre o orçamento, e os links de OS com todo o período.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: () => {}, replace: vi.fn(), back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(""),
}));

let root: Root | undefined;
let resposta: Record<string, unknown> = {};
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

const BASE = { prazosVencidos: 0, etapasVencendoHoje: 0, pedidosPendentes: 0, atendimentosAtraso: 0, chamadosPortal: 0, checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, boletosPagos: 0, orcamentosRespondidos: 0, nfPedidos: 0, nfPedidoId: null };
async function sino(alertas: Record<string, unknown>, permissoes: Permissoes = permissoesTotais()) {
  resposta = { ...BASE, lidos: [], ...alertas };
  const { Header } = await import("@/components/layout/header");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const sessao = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes }, expires: "2099-01-01T00:00:00Z" };
  if (root) act(() => root!.unmount());
  document.body.innerHTML = "";
  const caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes } as any, createElement(Header, { session: sessao, avatarUrl: null } as any))); });
  await esperar();
  await abrirSino();
}
const botaoSino = () => $$("button").find((b) => b.querySelector("svg.lucide-bell")) ?? null;
const abrirSino = () => clicar(botaoSino());
const numero = () => txt(botaoSino());
const link = (rotulo: string) => ($$("[data-sino-menu] a").find((a) => txt(a).startsWith(rotulo)) ?? null) as HTMLAnchorElement | null;
const gravacoes = () => (vi.mocked(fetch).mock.calls as any[]).filter(([u]) => u === "/api/alertas/lidos").map(([, init]) => ({ ...JSON.parse(init.body), keepalive: init.keepalive, method: init.method }));
// o clique no link: o happy-dom não navega; o que importa é o onClick
const tocar = async (rotulo: string) => {
  const a = link(rotulo); expect(a).not.toBeNull();
  await act(async () => { a!.addEventListener("click", (e) => e.preventDefault(), { once: true }); a!.click(); });
  await esperar();
};

describe("sino: o toque marca como lido", () => {
  it("o número cai na hora, o sino fecha e a marca vai com a assinatura (keepalive)", async () => {
    await sino({ osSemTecnico: 3, osSemTecnicoId: "os1", prazosVencidos: 2, total: 5, totalGeral: 5 });
    expect(numero()).toBe("5");
    await tocar("OS sem técnico");
    expect(numero()).toBe("2");
    expect($("[data-sino-menu]")).toBeNull();
    expect(gravacoes()).toEqual([{ campo: "osSemTecnico", assinatura: "3:os1", keepalive: true, method: "POST" }]);
    // reabrindo: o lido apagado, com o porquê no tooltip; o outro, normal
    await abrirSino();
    expect(link("OS sem técnico")?.getAttribute("data-sino-item")).toBe("lido");
    expect(link("OS sem técnico")?.getAttribute("title")).toBe("Lido hoje. Volta a contar se chegar um novo ou no dia seguinte, se ainda estiver pendente.");
    expect(link("Etapas com prazo vencidas")?.getAttribute("data-sino-item")).toBe("novo");
    expect(link("Etapas com prazo vencidas")?.hasAttribute("title")).toBe(false);
    // tocar de novo no lido não grava outra vez nem mexe no número
    await tocar("OS sem técnico");
    expect([numero(), gravacoes().length]).toEqual(["2", 1]);
    // tocar no último: o número some, mas a lista continua (os dois lidos)
    await abrirSino(); await tocar("Etapas com prazo vencidas");
    expect(numero()).toBe("");
    await abrirSino();
    expect(txt($("[data-sino-menu]"))).not.toContain("Nenhum alerta");
    expect($$("[data-sino-item=lido]")).toHaveLength(2);
    expect(gravacoes().map((g) => [g.campo, g.assinatura])).toEqual([["osSemTecnico", "3:os1"], ["prazosVencidos", "2:"]]);
  });

  it("o que o servidor já deu por lido chega apagado e fora do número; aviso zerado não grava nada", async () => {
    await sino({ pedidosPendentes: 4, chamadosPortal: 1, total: 1, totalGeral: 5, lidos: ["pedidosPendentes"] });
    expect(numero()).toBe("1");
    expect(link("Compras pendentes")?.getAttribute("data-sino-item")).toBe("lido");
    expect(link("Chamados do portal")?.getAttribute("data-sino-item")).toBe("novo");
    expect(link("Checklists pendentes")?.getAttribute("data-sino-item")).toBe("zero");
    await tocar("Checklists pendentes");
    expect([numero(), gravacoes()]).toEqual(["1", []]);
  });

  it("sem nada de pé: 'Nenhum alerta no momento.'", async () => {
    await sino({ total: 0, totalGeral: 0 });
    expect(txt($("[data-sino-menu]"))).toContain("Nenhum alerta no momento.");
  });
});

describe("sino: cada aviso leva ao item certo", () => {
  it("chamados do portal, compras, veículos em manutenção e prazo de atendimento", async () => {
    await sino({ chamadosPortal: 2, pedidosPendentes: 3, veiculosManutencao: 1, atendimentoEstourado: 1, atendimentoVencendo: 1, total: 8, totalGeral: 8 });
    expect(link("Chamados do portal")?.getAttribute("href")).toBe("/ordens?origem=PORTAL_CLIENTE&status=AGUARDANDO_ATENDIMENTO&periodo=todos");
    expect(link("Compras pendentes")?.getAttribute("href")).toBe("/compras/pedidos?abertos=1");
    expect(link("Veículos em manutenção")?.getAttribute("href")).toBe("/veiculos?status=manutencao");
    expect(link("Prazo de atendimento estourado")?.getAttribute("href")).toBe("/ordens?atendimento=estourado&periodo=todos");
    expect(link("Prazo de atendimento vencendo")?.getAttribute("href")).toBe("/ordens?atendimento=vencendo&periodo=todos");
  });
  it("resposta de orçamento: uma só abre o orçamento; várias, ou sem o id, a lista", async () => {
    await sino({ orcamentosRespondidos: 1, orcamentoRespondidoId: "orc7", total: 1, totalGeral: 1 });
    expect(link("Respostas de orçamentos")?.getAttribute("href")).toBe("/orcamentos/orc7");
    await sino({ orcamentosRespondidos: 2, orcamentoRespondidoId: "orc7", total: 2, totalGeral: 2 });
    expect(link("Respostas de orçamentos")?.getAttribute("href")).toBe("/orcamentos?resposta=nova&periodo=todos");
    await sino({ orcamentosRespondidos: 1, orcamentoRespondidoId: null, total: 1, totalGeral: 1 });
    expect(link("Respostas de orçamentos")?.getAttribute("href")).toBe("/orcamentos?resposta=nova&periodo=todos");
  });
  it("sem permissão, o aviso não aparece", async () => {
    await sino({ pedidosPendentes: 3, total: 3, totalGeral: 3 }, montarPermissoes({ ordens: ["visualizar"] }));
    expect(link("Compras pendentes")).toBeNull();
  });
});
