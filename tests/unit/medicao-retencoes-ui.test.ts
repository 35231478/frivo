// @vitest-environment happy-dom
/**
 * Retenções da medição, num DOM de verdade:
 *  - nada gravado + serviços "ISS retido" na nota → o ISS aparece marcado (com a alíquota), federais
 *    desmarcados; o usuário confirma salvando (nada vai ao servidor sozinho);
 *  - marcar IR com alíquota mostra cada retenção e o líquido na hora; salvar manda as alíquotas;
 *  - alíquota vazia não vai ao servidor; erro do servidor aparece no card;
 *  - bloqueio (boleto emitido…) e sem permissão: tudo apagado, sem botão.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: () => {} }) }));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast }));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: unknown };
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let Comp: typeof import("@/components/medicao/medicao-retencoes").MedicaoRetencoes;

beforeAll(async () => { ({ MedicaoRetencoes: Comp } = await import("@/components/medicao/medicao-retencoes")); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.refresh.mockClear(); avisos.toast.mockClear();
  resposta = { status: 200, corpo: { ok: true, contaReceber: { id: "cr1", numero: "CR-2026-0001", valor: 935 } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method), corpo: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const SEM_ISS = { marcar: false, aliquota: null, parcial: false };
function montar(props: Partial<Parameters<typeof Comp>[0]> = {}) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  act(() => root.render(createElement(Comp, { medicaoId: "m1", base: 1000, gravadas: {}, sugestaoIss: SEM_ISS, podeEditar: true, bloqueio: null, ...props })));
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T;
const marcar = (k: string) => act(() => { $<HTMLInputElement>(`[data-marcar="${k}"]`).click(); });
function digitar(k: string, valor: string) {
  const el = $<HTMLInputElement>(`[data-aliquota="${k}"]`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const marcadas = () => [...caixa.querySelectorAll<HTMLInputElement>("[data-marcar]")].filter((i) => i.checked).map((i) => i.dataset.marcar);

describe("Retenções da medição", () => {
  it("nada gravado + ISS retido na nota → ISS já marcado com a alíquota; federais desmarcados; nada enviado", () => {
    montar({ sugestaoIss: { marcar: true, aliquota: 5, parcial: false } });
    expect(marcadas()).toEqual(["iss"]);
    expect($<HTMLInputElement>('[data-aliquota="iss"]').value).toBe("5");
    expect($("[data-liquido]").textContent).toMatch(/950,00/);
    expect(chamadas).toHaveLength(0);
    expect($<HTMLButtonElement>("[data-salvar-retencoes]").disabled).toBe(false);
  });

  it("já gravado: mostra o que está gravado (a sugestão não sobrepõe); sem mudança, salvar fica apagado", () => {
    montar({ gravadas: { ir: 1.5 }, sugestaoIss: { marcar: true, aliquota: 5, parcial: false } });
    expect(marcadas()).toEqual(["ir"]);
    expect($<HTMLInputElement>('[data-aliquota="ir"]').value).toBe("1,5");
    expect($<HTMLButtonElement>("[data-salvar-retencoes]").disabled).toBe(true);
  });

  it("marcar IR 1,5% mostra a retenção e o líquido na hora; salvar manda as alíquotas, toast e refresh", async () => {
    montar();
    expect(marcadas()).toEqual([]);
    expect($("[data-liquido]").textContent).toMatch(/1\.000,00/);
    marcar("ir");
    digitar("ir", "1,5");
    expect($('[data-retencao="ir"]').textContent).toMatch(/− R\$\s?15,00/);
    expect($("[data-detalhamento]").textContent).toMatch(/IR− R\$\s?15,00/);
    expect($("[data-liquido]").textContent).toMatch(/985,00/);
    act(() => { $<HTMLButtonElement>("[data-salvar-retencoes]").click(); });
    await esperar();
    expect(chamadas).toEqual([{ url: "/api/medicoes/m1/retencoes", metodo: "PUT", corpo: { iss: null, ir: 1.5, pis: null, cofins: null, csll: null, inss: null } }]);
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/^Retenções salvas\. CR-2026-0001: R\$\s?935,00\.$/));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("marcada sem alíquota não vai ao servidor; erro do servidor aparece no card", async () => {
    montar();
    marcar("pis");
    act(() => { $<HTMLButtonElement>("[data-salvar-retencoes]").click(); });
    await esperar();
    expect(chamadas).toHaveLength(0);
    expect($("[data-erro-retencoes]").textContent).toBe("Informe a alíquota de cada retenção marcada.");

    digitar("pis", "0,65");
    resposta = { status: 409, corpo: { erro: "Boleto emitido: cancele o boleto antes de mudar as retenções." } };
    act(() => { $<HTMLButtonElement>("[data-salvar-retencoes]").click(); });
    await esperar();
    expect($("[data-erro-retencoes]").textContent).toBe("Boleto emitido: cancele o boleto antes de mudar as retenções.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("bloqueio ou sem permissão: caixas apagadas, sem botão; o bloqueio é explicado", () => {
    montar({ gravadas: { iss: 5 }, bloqueio: "Boleto emitido: cancele o boleto para mudar as retenções." });
    expect([...caixa.querySelectorAll<HTMLInputElement>("[data-marcar]")].every((i) => i.disabled)).toBe(true);
    expect($("[data-salvar-retencoes]")).toBeNull();
    expect($("[data-bloqueio-retencoes]").textContent).toContain("Boleto emitido");
    act(() => root.unmount()); caixa.remove();
    montar({ podeEditar: false });
    expect($("[data-salvar-retencoes]")).toBeNull();
    expect($<HTMLInputElement>('[data-marcar="iss"]').disabled).toBe(true);
  });
});
