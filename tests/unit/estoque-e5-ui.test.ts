// @vitest-environment happy-dom
/**
 * Estoque E5 — a visão INTERNA de material na OS (aba Materiais & Compras): por material, o histórico
 * separado / consumido / devolvido / sobra, com quem e quando, atrás de um toggle por linha; só para material separado;
 * some enquanto se informa o consumo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resumoSeparacao } from "@/lib/estoque/separacao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root;
let caixa: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; });
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function montar(el: ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); }); await esperar();
}

const ITENS = [{ id: "i1", descricao: "Instalação split", materiais: [
  { id: "mTubo", produtoId: "tubo", descricao: "Tubo de cobre 1/4", unidade: "m", quantidade: "5", quantidadeSeparada: "5", quantidadeConsumida: "3", quantidadeDevolvida: "2", estadoSeparacao: "DEVOLVIDO", separadoEm: "2026-11-07T12:00:00.000Z", separadoPor: { nome: "Zé" }, consumidoEm: "2026-11-07T15:00:00.000Z", consumidoPor: { nome: "Carlos" }, devolvidoEm: "2026-11-08T09:00:00.000Z", devolvidoPor: { nome: "Zé do Almoxarifado" }, kitNome: null },
  { id: "mGas", produtoId: "gas", descricao: "Gás R410A", unidade: "kg", quantidade: "2", quantidadeSeparada: "2", quantidadeConsumida: "1.5", quantidadeDevolvida: "0", estadoSeparacao: "CONSUMIDO", separadoEm: "2026-11-07T12:00:00.000Z", separadoPor: { nome: "Zé" }, consumidoEm: "2026-11-07T15:00:00.000Z", consumidoPor: { nome: "Carlos" }, devolvidoEm: null, devolvidoPor: null, kitNome: "Kit instalação" },
  { id: "mCap", produtoId: "cap", descricao: "Capacitor 35uF", unidade: "un", quantidade: "1", quantidadeSeparada: "1", quantidadeConsumida: "0", quantidadeDevolvida: "0", estadoSeparacao: "SEPARADO", separadoEm: "2026-11-07T12:00:00.000Z", separadoPor: { nome: "Zé" }, consumidoEm: null, consumidoPor: null, devolvidoEm: null, devolvidoPor: null, kitNome: null },
  { id: "mFita", produtoId: "fita", descricao: "Fita", unidade: "un", quantidade: "1", quantidadeSeparada: "0", quantidadeConsumida: "0", quantidadeDevolvida: "0", estadoSeparacao: null, separadoEm: null, separadoPor: null, consumidoEm: null, consumidoPor: null, devolvidoEm: null, devolvidoPor: null, kitNome: null },
] }];

describe("E5 — visão interna de material na OS", () => {
  it("o histórico por material abre num toggle e mostra separado / consumido / devolvido / sobra com quem · quando; só para material separado", async () => {
    const { OsSeparacao, materiaisDaOs } = await import("@/components/os/os-separacao");
    const materiais = materiaisDaOs(ITENS);
    await montar(createElement(OsSeparacao, { osId: "os1", materiais, resumo: resumoSeparacao(materiais), podeSeparar: true, podeConsumir: true }));
    expect($("[data-historico-material]")).toBeNull();
    // Fita nunca foi separada: sem histórico
    expect($('[data-material-estado="mFita"] [data-acao="historico-material"]')).toBeNull();
    // Tubo: separado 5 → consumido 3 → devolvido 2, cada um com quem e quando
    await clicar($('[data-material-estado="mTubo"] [data-acao="historico-material"]'));
    const h = $('[data-historico-material="mTubo"]')!;
    expect(txt(h.querySelector("[data-hist-separado]"))).toMatch(/^5 m por Zé · \d{2}\/\d{2}\/\d{4}/);
    expect(txt(h.querySelector("[data-hist-consumido]"))).toMatch(/^3 m por Carlos · /);
    expect(txt(h.querySelector("[data-hist-devolvido]"))).toMatch(/^2 m por Zé do Almoxarifado · /);
    expect(txt(h.querySelector("[data-hist-sobra]"))).toBe("nenhuma");
    expect($('[data-material-estado="mTubo"] [data-acao="historico-material"]')!.getAttribute("aria-expanded")).toBe("true");
    // Gás: consumido 1,5 de 2, sobra 0,5 a devolver, nada devolvido
    await clicar($('[data-material-estado="mGas"] [data-acao="historico-material"]'));
    expect($('[data-historico-material="mTubo"]')).toBeNull(); // um de cada vez
    const g = $('[data-historico-material="mGas"]')!;
    expect(txt(g.querySelector("[data-hist-consumido]"))).toMatch(/^1,5 kg por Carlos/);
    expect(txt(g.querySelector("[data-hist-devolvido]"))).toBe("—");
    expect(txt(g.querySelector("[data-hist-sobra]"))).toBe("0,5 kg a devolver");
    // Capacitor: separado, consumo ainda não informado
    await clicar($('[data-material-estado="mCap"] [data-acao="historico-material"]'));
    const c = $('[data-historico-material="mCap"]')!;
    expect(txt(c.querySelector("[data-hist-consumido]"))).toBe("não informado");
    expect(txt(c.querySelector("[data-hist-sobra]"))).toBe("—");
    // Fechar
    await clicar($('[data-material-estado="mCap"] [data-acao="historico-material"]'));
    expect($("[data-historico-material]")).toBeNull();
    // Enquanto informa o consumo, o histórico não aparece (a linha vira o campo)
    await clicar($('[data-material-estado="mCap"] [data-acao="historico-material"]'));
    await clicar($('[data-acao="informar-consumo"]'));
    expect($("[data-historico-material]")).toBeNull();
    expect($('[data-material-estado="mCap"] [data-acao="historico-material"]')).toBeNull(); // a linha em edição não tem o toggle
    // Nada disto leva custo: a seção é interna, mas mesmo assim não mostra preço de custo
    expect(txt(document.body)).not.toMatch(/custo/i);
  });
});
