// @vitest-environment happy-dom
/**
 * Lista de OS na barra enxuta (componente real num DOM de verdade): o período substitui a navegação
 * por dia (por padrão todo o período, com as setas desligadas); os atalhos de teclado continuam
 * (← › período, T = hoje); busca "Pesquisar no período selecionado"; "Mais filtros" recolhe os chips
 * de status/prioridade e os demais filtros; "Limpar filtros" zera tudo menos o período.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { periodoOrdens } from "@/lib/listas/filtros";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: nav.replace, back: () => {} }),
  usePathname: () => "/ordens", useSearchParams: () => new URLSearchParams(nav.qs),
}));

let root: Root;
let caixa: HTMLDivElement;
const AGORA = new Date("2026-11-04T01:30:00.000Z"); // terça 03/11/2026 em Brasília
beforeEach(() => { nav.replace.mockClear(); nav.qs = ""; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AGORA); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const tecla = async (key: string) => { await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }); await esperar(); };
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");

async function montar(qs = "") {
  nav.qs = qs;
  if (root) { act(() => root.unmount()); caixa.remove(); } // dois "montar" no mesmo teste: um de cada vez
  const [{ OrdensListaClient }, { PermissoesProvider }, { periodoTela }] = await Promise.all([
    import("@/components/ordens/ordens-lista-client"), import("@/components/providers/permissoes-provider"), import("@/components/listagem/periodo-cards"),
  ]);
  const periodo = periodoTela(periodoOrdens(Object.fromEntries(new URLSearchParams(qs).entries()), AGORA));
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children:
      createElement(OrdensListaClient as any, { ordens: [], total: 0, pagina: 1, porPagina: 50, periodo, opcoes: { clientes: [], usuarios: [], tiposOs: [], contratos: [] } }),
    }));
  });
  await esperar();
}

describe("lista de OS: barra enxuta", () => {
  it("por padrão todo o período (setas desligadas); T vai para hoje; ← › andam o dia; a barra tem a busca e 'Mais filtros' fechado", async () => {
    await montar();
    expect(txt($("[data-mes-rotulo]"))).toBe("Todo o período");
    expect($<HTMLButtonElement>("[data-mes-anterior]")!.disabled).toBe(true);
    expect($<HTMLInputElement>("[data-busca]")!.placeholder).toBe("Pesquisar no período selecionado");
    expect($("[data-painel-filtros]")).toBeNull();
    await tecla("t");
    expect(ultimaUrl()).toBe("/ordens?periodo=hoje");
    await montar("periodo=hoje");
    expect(txt($("[data-mes-rotulo]"))).toBe("Hoje, 03/11/2026");
    await tecla("ArrowRight");
    expect(ultimaUrl()).toBe("/ordens?periodo=hoje&ref=2026-11-04");
    await tecla("ArrowLeft");
    expect(ultimaUrl()).toBe("/ordens?periodo=hoje&ref=2026-11-02");
  });

  it("'Mais filtros' abre os chips de status/prioridade e os demais filtros; 'Limpar filtros' zera os filtros e a busca, não o período", async () => {
    await montar("periodo=semana&status=ABERTA,AGENDADA&busca=split&clienteId=c1");
    expect(txt($("[data-filtros-ativos]"))).toBe("2"); // status + clienteId (a busca não conta)
    await clicar($("[data-mais-filtros]"));
    const chips = $$("[data-painel-filtros] button[aria-pressed]");
    expect(chips.length).toBeGreaterThan(8);
    expect(chips.filter((c) => c.getAttribute("aria-pressed") === "true").map(txt)).toEqual(["Aberta", "Agendada"]);
    await clicar(chips.find((c) => txt(c) === "Agendada")!);
    expect(ultimaUrl()).toBe("/ordens?periodo=semana&status=ABERTA&busca=split&clienteId=c1");
    await clicar($("[data-limpar-filtros]"));
    expect(ultimaUrl()).toBe("/ordens?periodo=semana");
  });
});
