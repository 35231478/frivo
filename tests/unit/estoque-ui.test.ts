// @vitest-environment happy-dom
/**
 * Estoque E1 — o formulário "Lançar" (Entrada / Ajuste / Inventário) num DOM de verdade (happy-dom),
 * com a API simulada. Prova o que o usuário vê:
 *  - entrada envia a quantidade (e custo) e mostra o saldo novo; a página é atualizada;
 *  - ajuste mostra a diferença antes de lançar, exige motivo e recusa "sem diferença" sem chamar a API;
 *  - inventário envia a contagem;
 *  - saldo negativo volta da API como aviso e aparece em destaque; erro da API aparece no formulário.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {} }) }));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: unknown };
const enviados: { url: string; corpo: any }[] = [];

beforeEach(() => {
  enviados.length = 0;
  refresh.mockClear();
  resposta = { status: 201, corpo: { saldo: 12, aviso: null, movimentacao: {} } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    enviados.push({ url, corpo: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(saldo = 2) {
  const { LancarEstoque } = await import("@/components/estoque/lancar-estoque");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(LancarEstoque, { produto: { id: "p1", nome: "Gás R410A", unidade: "kg", saldo } })); });
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const texto = () => (caixa.textContent ?? "").replace(/\s+/g, " ");
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const botao = (rotulo: string) => [...caixa.querySelectorAll("button")].find((b) => b.textContent?.trim() === rotulo) ?? null;
const aba = (rotulo: string) => [...caixa.querySelectorAll('[role="tab"]')].find((b) => b.textContent === rotulo) ?? null;
async function digitar(nome: string, valor: string) {
  const el = $<HTMLInputElement>(`input[name="${nome}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const enviar = async () => { await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("Lançar estoque", () => {
  it("entrada: envia quantidade e custo, mostra o saldo novo e atualiza a página", async () => {
    await montar(2);
    expect($('[role="dialog"]')).toBeNull();
    await clicar($("[data-lancar]"));
    expect(texto()).toContain("Lançar estoque · Gás R410A");
    expect(texto()).toContain("Saldo atual: 2 kg");
    await digitar("valor", "10");
    await digitar("custo", "45,90");
    await digitar("observacao", "NF 77");
    expect($("[data-previa]")!.textContent).toBe("Lançamento: +10 kg → saldo fica 12 kg");
    await enviar();
    expect(enviados).toEqual([{ url: "/api/estoque/p1/movimentacoes", corpo: { operacao: "ENTRADA", quantidade: 10, custoUnitario: 45.9, observacao: "NF 77" } }]);
    expect($("[data-lancamento-feito]")!.textContent).toContain("Lançado. Saldo agora: 12 kg");
    expect($('[role="alert"]')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ajuste: mostra a diferença, exige motivo, recusa sem diferença (sem chamar a API)", async () => {
    await montar(7);
    await clicar($("[data-lancar]"));
    await clicar(aba("Ajuste"));
    expect(aba("Ajuste")!.getAttribute("aria-selected")).toBe("true");
    await digitar("valor", "4");
    expect($("[data-previa]")!.textContent).toBe("Lançamento: −3 kg → saldo fica 4 kg");
    await enviar();
    expect($('[role="alert"]')!.textContent).toBe("Ajuste exige o motivo (observação).");
    await digitar("valor", "7");
    await digitar("observacao", "conferência");
    await enviar();
    expect($('[role="alert"]')!.textContent).toBe("O saldo já é esse — não há o que ajustar.");
    expect(enviados).toEqual([]);
    await digitar("valor", "4");
    resposta.corpo = { saldo: 4, aviso: null };
    await enviar();
    expect(enviados[0].corpo).toEqual({ operacao: "AJUSTE", novoSaldo: 4, observacao: "conferência" });
  });

  it("inventário: envia a contagem (zero vale)", async () => {
    await montar(3);
    await clicar($("[data-lancar]"));
    await clicar(aba("Inventário"));
    expect($('input[name="custo"]')).toBeNull(); // custo só na entrada
    await digitar("valor", "0");
    expect($("[data-previa]")!.textContent).toBe("Lançamento: −3 kg → saldo fica 0 kg");
    resposta.corpo = { saldo: 0, aviso: null };
    await enviar();
    expect(enviados[0].corpo).toEqual({ operacao: "INVENTARIO", contagem: 0 });
  });

  it("aviso de saldo negativo da API aparece em destaque; erro da API fica no formulário", async () => {
    await montar(-1);
    await clicar($("[data-lancar]"));
    expect($("strong.text-red-600")!.textContent).toBe("-1 kg"); // saldo atual negativo destacado
    await digitar("valor", "0");
    await enviar();
    expect($('[role="alert"]')!.textContent).toBe("A quantidade precisa ser maior que zero.");
    expect(enviados).toEqual([]);
    resposta = { status: 404, corpo: { erro: "Produto não encontrado" } };
    await digitar("valor", "1");
    await enviar();
    expect($('[role="alert"]')!.textContent).toBe("Produto não encontrado");
    expect(refresh).not.toHaveBeenCalled();
    resposta = { status: 201, corpo: { saldo: -0.5, aviso: "Atenção: o saldo ficou negativo (-0,5 kg). O lançamento foi feito; confira as entradas." } };
    await digitar("valor", "0,5");
    await enviar();
    expect($('[role="alert"]')!.textContent).toContain("o saldo ficou negativo (-0,5 kg)");
    // "Lançar outro" volta ao formulário limpo
    await clicar(botao("Lançar outro"));
    expect($<HTMLInputElement>('input[name="valor"]')!.value).toBe("");
  });
});
