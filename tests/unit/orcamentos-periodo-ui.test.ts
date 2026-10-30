// @vitest-environment happy-dom
/**
 * Orçamentos — período + cards de funil (ilha da lista do servidor), num DOM de verdade:
 *  - 5 cards na ordem (Em aberto · Aprovados · Recusados · Vencidos · Total), com R$ e quantidade e ⓘ
 *    FORA do botão; clicar põe o card na URL (sem perder o resto), clicar de novo tira;
 *  - ‹ › trocam o mês pela data de criação (o mês atual sai da URL); "Todo o período";
 *  - "Ver todo o período" do vazio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: nav.replace, back: () => {} }),
  usePathname: () => "/orcamentos", useSearchParams: () => new URLSearchParams(nav.qs),
}));

let root: Root;
let caixa: HTMLDivElement;
beforeEach(() => { nav.replace.mockClear(); nav.qs = ""; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-15T15:00:00.000Z")); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.useRealTimers(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");

const resumo = { EM_ABERTO: { q: 3, v: 750 }, APROVADO: { q: 2, v: 1100 }, RECUSADO: { q: 1, v: 700 }, VENCIDO: { q: 1, v: 800 }, TOTAL: { q: 8, v: 3550 } };
const NOV = { tipo: "mes", mes: "2026-11", de: null, ate: null, rotulo: "Novembro de 2026" } as const;

async function montar(props: Record<string, unknown> = {}, comVazio = false) {
  const { ListaUrl } = await import("@/components/listagem/lista-url");
  const { PeriodoCardsOrcamentos, VerTodoPeriodo } = await import("@/components/orcamento/orcamentos-periodo");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(ListaUrl, { chave: "orcamentos", paramBusca: "busca", qAtual: "", children: [
      createElement(PeriodoCardsOrcamentos, { key: "p", periodo: NOV, resumo, card: "", ...props } as any),
      comVazio ? createElement(VerTodoPeriodo, { key: "v" }) : null,
    ] }));
  });
  await esperar();
}

describe("Orçamentos: período + cards de funil", () => {
  it("5 cards de funil na ordem, R$ + quantidade, ⓘ fora do botão; clicar filtra sem perder a busca, clicar de novo tira", async () => {
    nav.qs = "busca=hospital";
    await montar();
    expect($$("[data-card]").map((c) => c.getAttribute("data-card"))).toEqual(["EM_ABERTO", "APROVADO", "RECUSADO", "VENCIDO", "TOTAL"]);
    expect(txt($("[data-card=EM_ABERTO]"))).toMatch(/^Em aberto.*R\$\s?750,00.*3 orçamentos$/);
    expect(txt($("[data-card=RECUSADO]"))).toMatch(/^Recusados.*R\$\s?700,00.*1 orçamento$/);
    expect($$("[data-card-caixa] [data-dica]")).toHaveLength(5); // cada card com ⓘ…
    expect($("[data-card] [data-dica]")).toBeNull();          // …fora do botão
    await clicar($("[data-card=VENCIDO]"));
    expect(ultimaUrl()).toBe("/orcamentos?busca=hospital&card=VENCIDO");
    act(() => root.unmount()); caixa.remove();
    nav.qs = "busca=hospital&card=VENCIDO";
    await montar({ card: "VENCIDO" });
    expect($("[data-card=VENCIDO]")!.getAttribute("aria-pressed")).toBe("true");
    await clicar($("[data-card=VENCIDO]"));
    expect(ultimaUrl()).toBe("/orcamentos?busca=hospital");
  });

  it("período pela criação: ‹ › (o mês atual sai da URL), todo o período e o ⓘ do período", async () => {
    await montar();
    expect(txt($("[data-mes-rotulo]"))).toBe("Novembro de 2026");
    await clicar($("[data-mes-anterior]"));
    expect(ultimaUrl()).toBe("/orcamentos?mes=2026-10");
    await clicar($("[data-todo-periodo]"));
    expect(ultimaUrl()).toBe("/orcamentos?periodo=todos");
    expect($("[data-periodo] [data-dica]")).not.toBeNull();
  });

  it("vazio: 'Ver todo o período' leva a todo o período", async () => {
    nav.qs = "mes=2026-10&busca=antiga";
    await montar({}, true);
    await clicar($("[data-ver-todo-periodo]"));
    expect(ultimaUrl()).toBe("/orcamentos?busca=antiga&periodo=todos");
  });
});
