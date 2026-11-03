// @vitest-environment happy-dom
/**
 * Barra enxuta das listas (padrão da casa) num DOM de verdade:
 *  - seletor de período compacto: ‹ › andam a unidade do atalho; o menu tem os 8 atalhos na ordem;
 *    "Todo o período" só onde a tela permite e some as setas; "Período personalizado" abre de/até + Aplicar;
 *    só mês (competência) não tem menu;
 *  - BarraFiltros: painel "Mais filtros" fechado por padrão, contador dos ativos, "Limpar filtros" zera os
 *    filtros do painel e a busca (o período fica) e desliga quando não há nada a limpar; extras à direita.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { lerPeriodo } from "@/lib/periodo";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/lista", useSearchParams: () => new URLSearchParams(nav.qs),
}));

let root: Root;
let caixa: HTMLDivElement;
const navegar = vi.fn();
const AGORA = new Date("2026-11-04T01:30:00.000Z"); // terça 03/11/2026 em Brasília
beforeEach(() => { navegar.mockClear(); nav.qs = ""; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AGORA); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const ultimo = () => navegar.mock.calls.at(-1)?.[0];

async function montar(el: ReactNode) {
  if (root) { act(() => root.unmount()); caixa.remove(); } // vários "montar" no mesmo teste: um de cada vez
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
async function barraPeriodo(sp: Record<string, string>, props: Record<string, unknown> = {}) {
  const { BarraPeriodo, periodoTela } = await import("@/components/listagem/periodo-cards");
  const p = lerPeriodo(sp, AGORA, { permitirTodos: true, padrao: (props.padrao as "mes" | "todos") ?? "mes" });
  await montar(createElement(BarraPeriodo, { periodo: periodoTela(p), navegar, permitirTodos: true, ...props } as any));
}
const LIMPO = { mes: null, de: null, ate: null, periodo: null, ref: null };

describe("seletor de período", () => {
  it("este mês: rótulo + atalho; ‹ › trocam o mês (o atual sai da URL); o menu tem os 8 atalhos na ordem e marca o atual", async () => {
    await barraPeriodo({});
    expect(txt($("[data-mes-rotulo]"))).toBe("Novembro de 2026");
    expect($("[data-periodo-menu]")!.getAttribute("data-periodo-atalho")).toBe("Este mês");
    await clicar($("[data-mes-anterior]"));
    expect(ultimo()).toEqual({ ...LIMPO, mes: "2026-10" });
    expect($("[data-periodo-opcoes]")).toBeNull(); // fechado
    await clicar($("[data-periodo-menu]"));
    expect($$("[data-periodo-opcao]").map((b) => txt(b))).toEqual(["Hoje", "Esta semana", "Este mês", "Este ano", "Últimos 30 dias", "Últimos 12 meses", "Todo o período", "Período personalizado"]);
    expect($("[data-periodo-opcao=mes]")!.closest("[role=option]")!.getAttribute("aria-selected")).toBe("true");
    await clicar($("[data-periodo-opcao=semana]"));
    expect(ultimo()).toEqual({ ...LIMPO, periodo: "semana" });
    expect($("[data-periodo-opcoes]")).toBeNull(); // escolher fecha
  });

  it("mês navegado avisa no title; hoje/semana/ano andam a unidade certa pelas setas", async () => {
    await barraPeriodo({ mes: "2026-09" });
    expect($("[data-periodo-menu]")!.getAttribute("data-periodo-atalho")).toBe("Este mês (navegado)");
    await barraPeriodo({ periodo: "hoje" });
    expect(txt($("[data-mes-rotulo]"))).toBe("Hoje, 03/11/2026");
    await clicar($("[data-mes-seguinte]"));
    expect(ultimo()).toEqual({ ...LIMPO, periodo: "hoje", ref: "2026-11-04" });
    await barraPeriodo({ periodo: "semana", ref: "2026-10-26" });
    expect(txt($("[data-mes-rotulo]"))).toBe("26/10/2026 a 01/11/2026");
    await clicar($("[data-mes-seguinte]"));
    expect(ultimo()).toEqual({ ...LIMPO, periodo: "semana", ref: null }); // voltou à semana de hoje
    await barraPeriodo({ periodo: "ano" });
    await clicar($("[data-mes-anterior]"));
    expect(ultimo()).toEqual({ ...LIMPO, periodo: "ano", ref: "2025-01-01" });
  });

  it("todo o período: sem setas; o menu só mostra 'Todo o período' onde a tela permite", async () => {
    await barraPeriodo({ periodo: "todos" });
    expect(txt($("[data-mes-rotulo]"))).toBe("Todo o período");
    expect($<HTMLButtonElement>("[data-mes-anterior]")!.disabled).toBe(true);
    expect($<HTMLButtonElement>("[data-mes-seguinte]")!.disabled).toBe(true);
    await clicar($("[data-periodo-menu]"));
    expect($("[data-todo-periodo]")).not.toBeNull();
    await barraPeriodo({}, { permitirTodos: false });
    await clicar($("[data-periodo-menu]"));
    expect($("[data-todo-periodo]")).toBeNull();
    expect($$("[data-periodo-opcao]")).toHaveLength(7);
  });

  it("período personalizado: de/até dentro do menu, Aplicar só com uma data; intervalo fechado anda o próprio tamanho", async () => {
    await barraPeriodo({});
    await clicar($("[data-periodo-menu]"));
    await clicar($("[data-alternar-periodo]"));
    const campos = $$("[data-intervalo] [data-input-data]") as HTMLInputElement[];
    expect(campos).toHaveLength(2);
    expect($<HTMLButtonElement>("[data-aplicar-intervalo]")!.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campos[0], "01/11/2026");
      campos[0].dispatchEvent(new Event("input", { bubbles: true }));
      campos[0].dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await esperar();
    await clicar($("[data-aplicar-intervalo]"));
    expect(ultimo()).toEqual({ ...LIMPO, de: "2026-11-01", ate: null });
    await barraPeriodo({ de: "2026-11-01", ate: "2026-11-10" });
    expect(txt($("[data-periodo-rotulo]"))).toBe("01/11/2026 a 10/11/2026");
    expect($("[data-periodo-menu]")!.getAttribute("data-periodo-atalho")).toBe("Período personalizado");
    await clicar($("[data-mes-seguinte]"));
    expect(ultimo()).toEqual({ ...LIMPO, de: "2026-11-11", ate: "2026-11-20" });
  });

  it("só mês (competência): setas e rótulo, sem menu", async () => {
    await barraPeriodo({}, { somenteMes: true });
    expect(txt($("[data-mes-rotulo]"))).toBe("Novembro de 2026");
    await clicar($("[data-periodo-menu]"));
    expect($("[data-periodo-opcoes]")).toBeNull();
    await clicar($("[data-mes-seguinte]"));
    expect(ultimo()).toEqual({ ...LIMPO, mes: "2026-12" });
  });
});

describe("BarraFiltros", () => {
  async function barra(qs: string, children = true) {
    nav.qs = qs;
    const { BarraFiltros, CampoFiltro } = await import("@/components/listagem/barra-filtros");
    await montar(createElement(BarraFiltros, {
      periodo: createElement("span", { "data-slot-periodo": true }, "período"),
      busca: createElement("input", { "data-slot-busca": true, placeholder: "Pesquisar no período selecionado" }),
      paramsFiltros: ["status", "clienteId"], paramBusca: "q", navegar,
      extras: createElement("button", { "data-slot-extra": true }, "Exportar"),
      children: children ? createElement(CampoFiltro, { label: "Status" }, createElement("select", { "data-filtro": "status" })) : undefined,
    } as any));
  }
  it("tudo numa linha: período, busca, 'Mais filtros' (painel fechado por padrão), 'Limpar filtros' desligado sem nada a limpar, extras", async () => {
    await barra("");
    expect($("[data-slot-periodo]")).not.toBeNull();
    expect($("[data-slot-busca]")).not.toBeNull();
    expect($("[data-slot-extra]")).not.toBeNull();
    expect($("[data-painel-filtros]")).toBeNull();
    expect($("[data-filtros-ativos]")).toBeNull();
    expect($<HTMLButtonElement>("[data-limpar-filtros]")!.disabled).toBe(true);
    await clicar($("[data-mais-filtros]"));
    expect($("[data-painel-filtros] [data-filtro=status]")).not.toBeNull();
    expect($("[data-mais-filtros]")!.getAttribute("aria-expanded")).toBe("true");
    await clicar($("[data-mais-filtros]"));
    expect($("[data-painel-filtros]")).toBeNull();
  });
  it("com filtros na URL: continua fechado, o botão conta os ativos (a busca e o período não contam); 'Limpar filtros' zera filtros + busca e deixa o período", async () => {
    await barra("mes=2026-10&status=ABERTA&clienteId=c1&q=hospital&pagina=3");
    expect($("[data-painel-filtros]")).toBeNull();
    expect(txt($("[data-filtros-ativos]"))).toBe("2");
    expect($<HTMLButtonElement>("[data-limpar-filtros]")!.disabled).toBe(false);
    await clicar($("[data-limpar-filtros]"));
    expect(ultimo()).toEqual({ status: null, clienteId: null, q: null });
  });
  it("só a busca ativa também libera o 'Limpar filtros'; sem painel não há botão 'Mais filtros'", async () => {
    await barra("q=x", false);
    expect($("[data-mais-filtros]")).toBeNull();
    expect($<HTMLButtonElement>("[data-limpar-filtros]")!.disabled).toBe(false);
  });
});
