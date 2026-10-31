// @vitest-environment happy-dom
/**
 * "Gerar medições do mês", num DOM de verdade: o resultado diz quantas saíram e, quando há contrato
 * ativo FORA DA VIGÊNCIA no mês escolhido, diz quais (até 3 nomes) com a explicação na ⓘ.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: () => {}, replace: () => {} }) }));

let root: Root;
let caixa: HTMLDivElement;
let resposta: any;
const corpos: any[] = [];

beforeAll(async () => { await import("@/components/medicao/gerar-medicoes-mes"); }, 120_000);
beforeEach(() => {
  corpos.length = 0;
  globalThis.fetch = vi.fn(async (_u: any, init?: RequestInit) => {
    corpos.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(resposta), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); });

async function gerar() {
  const { GerarMedicoesMes } = await import("@/components/medicao/gerar-medicoes-mes");
  await act(async () => root.render(createElement(GerarMedicoesMes)));
  await act(async () => { [...caixa.querySelectorAll("button")].find((b) => b.textContent?.includes("Gerar medições do mês"))!.click(); });
  expect(caixa.textContent).toContain("contrato ativo e vigente no mês");
  await act(async () => { [...caixa.querySelectorAll("button")].find((b) => b.textContent?.includes("Gerar agora"))!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("Gerar medições do mês", () => {
  it("contratos fora da vigência: quantos, quais (até 3) e a ⓘ explica — fora de qualquer botão", async () => {
    resposta = { ok: true, criadas: 2, ignoradas: 1, foraDaVigencia: ["CT-1", "CT-2", "CT-3", "CT-4"], resultado: [] };
    await gerar();
    expect(caixa.textContent).toContain("2 criada(s), 1 ignorada(s).");
    const linha = caixa.querySelector("[data-fora-vigencia]")!;
    expect(linha.textContent).toContain("4 contratos fora da vigência: CT-1, CT-2, CT-3…");
    const dica = linha.querySelector<HTMLButtonElement>('button[aria-label*="Fora da vigência"]')!;
    expect(dica.parentElement!.closest("button, a")).toBeNull();
    expect(document.getElementById(dica.getAttribute("aria-describedby")!)!.textContent).toContain("não gera mensalidade, mesmo com status Ativo");
    expect(nav.refresh).toHaveBeenCalled();
  });
  it("um só: no singular; nenhum: a linha não aparece", async () => {
    resposta = { ok: true, criadas: 1, ignoradas: 0, foraDaVigencia: ["CT-9"], resultado: [] };
    await gerar();
    expect(caixa.querySelector("[data-fora-vigencia]")!.textContent).toContain("1 contrato fora da vigência: CT-9");
    act(() => root.unmount());
    root = createRoot(caixa);
    resposta = { ok: true, criadas: 1, ignoradas: 0, foraDaVigencia: [], resultado: [] };
    await gerar();
    expect(caixa.querySelector("[data-fora-vigencia]")).toBeNull();
    // Servidor antigo (sem o campo): também não aparece
    act(() => root.unmount());
    root = createRoot(caixa);
    resposta = { ok: true, criadas: 0, ignoradas: 0, resultado: [] };
    await gerar();
    expect(caixa.querySelector("[data-fora-vigencia]")).toBeNull();
  });
});
