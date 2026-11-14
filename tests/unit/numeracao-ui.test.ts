// @vitest-environment happy-dom
/**
 * Configurações › Numeração de documentos (components/config/numeracao-client) montada de verdade:
 *  - uma linha por tipo com o maior já usado, o próximo e o exemplo ao vivo;
 *  - a trava do mínimo NA TELA: abaixo do maior usado o botão trava e o aviso diz o mínimo;
 *  - salvar manda { tipo, proximo } para a rota e mostra o exemplo que voltou;
 *  - 409 do servidor (outro documento nasceu enquanto isso) vira a mensagem dele e o mínimo novo;
 *  - sem permissão de gerenciar: campos desligados, sem botão e o aviso de somente leitura.
 *
 * Leva 3 da padronização: a tela passou para o padrão de lista (TabelaPro + cartões no celular) e a
 * confirmação do salvar virou toast; o erro continua na própria linha.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NumeracaoTela } from "@/lib/numeracao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: unknown }[] = [];
let resposta: { status: number; corpo: unknown } = { status: 200, corpo: {} };

beforeEach(async () => {
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
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
/** O que foi para a rota da numeração (a tabela também lê e grava a preferência de colunas do usuário) */
const naRota = () => chamadas.filter((c) => !c.url.startsWith("/api/preferencias"));
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => c[0]);

const INICIAL: NumeracaoTela[] = [
  { tipo: "orcamento", rotulo: "Orçamento", prefixo: "ORC", dica: "d", maiorUsado: 3357, proximo: 3358, configurado: false, exemplo: "ORC-3358" },
  { tipo: "os", rotulo: "Ordem de serviço", prefixo: "OS", dica: "d", maiorUsado: 0, proximo: 1, configurado: false, exemplo: "OS-1" },
  { tipo: "contrato", rotulo: "Contrato", prefixo: "CT", dica: "d", maiorUsado: 10, proximo: 500, configurado: true, exemplo: "CT-500" },
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
    expect(txt(linha("contrato").querySelector("[data-exemplo]"))).toBe("CT-500");
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
    expect(txt(linha("orcamento").querySelector("[data-exemplo]"))).toBe("ORC-4000");
    await digitar(campo, "abc");
    expect(txt(linha("orcamento").querySelector('[data-msg="aviso"]'))).toBe("Informe um número inteiro.");
    expect(txt(linha("orcamento").querySelector("[data-exemplo]"))).toBe("—");
    expect(naRota()).toHaveLength(0);
  });

  it("salvar: PUT { tipo, proximo } na rota; o exemplo que volta vira a confirmação; a linha passa a 'configurada'", async () => {
    await montar();
    resposta = { status: 200, corpo: { tipo: "orcamento", proximo: 4000, exemplo: "ORC-4000" } };
    await digitar(linha("orcamento").querySelector("[data-proximo]") as HTMLInputElement, "4000");
    await clicar(linha("orcamento").querySelector("[data-salvar]"));
    expect(naRota()).toEqual([{ url: "/api/configuracoes/numeracao", metodo: "PUT", corpo: { tipo: "orcamento", proximo: 4000 } }]);
    expect(await toasts()).toEqual(["Numeração salva: o próximo orçamento sai como ORC-4000."]);
    expect(linha("orcamento").querySelector("[data-msg]")).toBeNull();
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
    expect(naRota()).toHaveLength(0);
    expect(txt(linha("orcamento").querySelector('[data-msg="erro"]'))).toBe("O mínimo permitido é 3358 (o maior já usado é 3357).");
  });

  it("sem Configurações › gerenciar: campos desligados, sem botão Salvar e o aviso de somente leitura", async () => {
    await montar(false);
    expect($$("[data-proximo]").every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect($("[data-salvar]")).toBeNull();
    expect(txt($("[data-somente-leitura]"))).toBe("Somente leitura: requer a permissão Configurações › gerenciar.");
    await montar(true);
    expect($("[data-somente-leitura]")).toBeNull();
    expect($$("[data-numeracao-tipo] [data-salvar]")).toHaveLength(3);
  });

  it("padrão de lista: a tabela (desktop) e um cartão por documento (celular), com o mesmo campo e o mesmo salvar", async () => {
    await montar();
    expect($("[data-tabela-pro='config-numeracao']")).not.toBeNull();
    const cartoes = $$("[data-cartoes] [data-cartao]");
    expect(cartoes.map((c) => c.getAttribute("data-cartao"))).toEqual(["orcamento", "os", "contrato"]);
    // digitar no cartão vale para a linha (é o mesmo estado) e salva pela mesma rota
    resposta = { status: 200, corpo: { tipo: "os", proximo: 70, exemplo: "OS-70" } };
    await digitar(cartoes[1].querySelector("[data-proximo]") as HTMLInputElement, "70");
    expect((linha("os").querySelector("[data-proximo]") as HTMLInputElement).value).toBe("70");
    await clicar(cartoes[1].querySelector("[data-salvar]"));
    expect(naRota()).toEqual([{ url: "/api/configuracoes/numeracao", metodo: "PUT", corpo: { tipo: "os", proximo: 70 } }]);
    expect(await toasts()).toEqual(["Numeração salva: o próximo ordem de serviço sai como OS-70."]);
  });
});
