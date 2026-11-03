// @vitest-environment happy-dom
/**
 * Configurações › Numeração de documentos (components/config/numeracao-client) montada de verdade:
 *  - uma linha por tipo com o maior já usado, o próximo e o exemplo ao vivo;
 *  - a trava do mínimo NA TELA: abaixo do maior usado o botão trava e o aviso diz o mínimo;
 *  - salvar manda { tipo, proximo } para a rota e mostra o exemplo que voltou;
 *  - 409 do servidor (outro documento nasceu enquanto isso) vira a mensagem dele e o mínimo novo;
 *  - sem permissão de gerenciar: campos desligados e sem botão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NumeracaoTela } from "@/lib/numeracao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: unknown }[] = [];
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: {} };

beforeEach(() => {
  chamadas.length = 0;
  resposta = { status: 200, corpo: {} };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const linha = (tipo: string) => $(`[data-numeracao-tipo="${tipo}"]`)!;

const INICIAL: NumeracaoTela[] = [
  { tipo: "orcamento", rotulo: "Orçamento", prefixo: "ORC", dica: "d", maiorUsado: 3357, proximo: 3358, configurado: false, exemplo: "ORC-2026-3358" },
  { tipo: "os", rotulo: "Ordem de serviço", prefixo: "OS", dica: "d", maiorUsado: 0, proximo: 1, configurado: false, exemplo: "OS-2026-0001" },
  { tipo: "contrato", rotulo: "Contrato", prefixo: "CT", dica: "d", maiorUsado: 10, proximo: 500, configurado: true, exemplo: "CT-2026-500" },
];

async function montar(podeEditar = true) {
  const { NumeracaoClient } = await import("@/components/config/numeracao-client");
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(NumeracaoClient, { inicial: INICIAL, podeEditar })); });
  await esperar();
}

describe("Numeração de documentos", () => {
  it("uma linha por tipo: maior usado, próximo no campo, exemplo ao vivo e o botão travado enquanto nada mudou", async () => {
    await montar();
    expect($$("[data-numeracao-tipo]").map((l) => l.getAttribute("data-numeracao-tipo"))).toEqual(["orcamento", "os", "contrato"]);
    expect(txt(linha("orcamento").querySelector("[data-maior-usado]"))).toBe("3.357");
    expect(txt(linha("os").querySelector("[data-maior-usado]"))).toBe("—");
    expect((linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement).value).toBe("3358");
    expect((linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement).min).toBe("3358");
    expect(txt(linha("contrato").querySelector("[data-exemplo]"))).toMatch(/^CT-\d{4}-500$/);
    expect((linha("orcamento").querySelector("[data-salvar]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("trava do mínimo na tela: abaixo do maior usado o aviso diz o mínimo e o botão fica travado; no mínimo libera e o exemplo acompanha", async () => {
    await montar();
    const campo = linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement;
    await digitar(campo, "3357");
    expect(txt(linha("orcamento").querySelector('[data-msg="aviso"]'))).toBe("O mínimo permitido é 3358 (o maior já usado é 3357).");
    expect((linha("orcamento").querySelector("[data-salvar]") as HTMLButtonElement).disabled).toBe(true);
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    await digitar(campo, "4000");
    expect(linha("orcamento").querySelector('[data-msg="aviso"]')).toBeNull();
    expect((linha("orcamento").querySelector("[data-salvar]") as HTMLButtonElement).disabled).toBe(false);
    expect(txt(linha("orcamento").querySelector("[data-exemplo]"))).toMatch(/^ORC-\d{4}-4000$/);
    await digitar(campo, "abc");
    expect(txt(linha("orcamento").querySelector('[data-msg="aviso"]'))).toBe("Informe um número inteiro.");
    expect(txt(linha("orcamento").querySelector("[data-exemplo]"))).toBe("—");
    expect(chamadas).toHaveLength(0);
  });

  it("salvar: PUT { tipo, proximo } na rota; o exemplo que volta vira a confirmação; a linha passa a 'configurada'", async () => {
    await montar();
    resposta = { status: 200, corpo: { tipo: "orcamento", proximo: 4000, exemplo: "ORC-2026-4000" } };
    await digitar(linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement, "4000");
    await clicar(linha("orcamento").querySelector("[data-salvar]"));
    expect(chamadas).toEqual([{ url: "/api/configuracoes/numeracao", metodo: "PUT", corpo: { tipo: "orcamento", proximo: 4000 } }]);
    expect(txt(linha("orcamento").querySelector('[data-msg="ok"]'))).toBe("Salvo. O próximo orçamento sai como ORC-2026-4000.");
    expect((linha("orcamento").querySelector("[data-salvar]") as HTMLButtonElement).disabled).toBe(true); // nada pendente
  });

  it("409 do servidor: mostra a mensagem dele e passa a usar o mínimo novo (outro documento nasceu enquanto isso)", async () => {
    await montar();
    resposta = { status: 409, corpo: { erro: "O próximo número de orçamento precisa ser pelo menos 4100: o maior já usado é 4099.", minimo: 4100 } };
    await digitar(linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement, "4000");
    await clicar(linha("orcamento").querySelector("[data-salvar]"));
    expect(txt(linha("orcamento").querySelector('[data-msg="erro"]'))).toBe("O próximo número de orçamento precisa ser pelo menos 4100: o maior já usado é 4099.");
    expect(txt(linha("orcamento").querySelector("[data-maior-usado]"))).toBe("4.099");
    await digitar(linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement, "4050");
    expect(txt(linha("orcamento").querySelector('[data-msg="aviso"]'))).toBe("O mínimo permitido é 4100 (o maior já usado é 4099).");
  });

  it("Enter no campo salva; sem conexão vira aviso", async () => {
    await montar();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede"); }));
    const campo = linha("os").querySelector("[data-proximo]") as HTMLInputElement;
    await digitar(campo, "20000");
    await act(async () => { campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await esperar();
    expect(txt(linha("os").querySelector('[data-msg="erro"]'))).toBe("Sem conexão. Tente de novo.");
  });

  it("Enter abaixo do mínimo NÃO salva: nada vai para a rota e a linha mostra o erro", async () => {
    await montar();
    const campo = linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement;
    await digitar(campo, "3357");
    await act(async () => { campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await esperar();
    expect(chamadas).toHaveLength(0);
    expect(txt(linha("orcamento").querySelector('[data-msg="erro"]'))).toBe("O mínimo permitido é 3358 (o maior já usado é 3357).");
  });

  it("sem Configurações › gerenciar: campos desligados e sem botão Salvar", async () => {
    await montar(false);
    expect($$("[data-proximo]").every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect($("[data-salvar]")).toBeNull();
  });
});
