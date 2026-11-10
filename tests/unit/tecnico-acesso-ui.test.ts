// @vitest-environment happy-dom
/**
 * Seção "Acesso ao app" da ficha do colaborador: o toggle libera/bloqueia o login; ao ligar sem login
 * ainda, pede senha inicial (com requisitos) e salva chamando a API de acesso; mostra "Redefinir senha"
 * quando já há login; sem e-mail, o toggle fica travado (o e-mail é a identidade de login).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {} }));

let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const corpo = () => caixa.textContent ?? "";
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); }
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}
async function montar(props: any) {
  const { AcessoAppColaborador } = await import("@/components/forms/acesso-app-colaborador");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(AcessoAppColaborador, props)); });
  await flush();
}
const toggle = () => $$("[role='switch']")[0];
const salvar = () => $("[data-acesso-salvar]");

let chamadas: { url: string; body: any }[] = [];
beforeEach(() => {
  chamadas = [];
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    chamadas.push({ url: String(url), body });
    // devolve o estado "ligado" quando ativa, "desligado" quando desativa
    return new Response(JSON.stringify({ temLogin: true, acessoAtivo: body.acessoAtivo, role: "TECNICO", email: "joao@x.com" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

describe("Acesso ao app na ficha do colaborador", () => {
  it("sem login: ligar o toggle pede senha inicial e salva na API de acesso", async () => {
    await montar({ tecnicoId: "t1", emailSalvo: "joao@x.com", inicial: { temLogin: false, acessoAtivo: false, role: null } });
    expect(corpo()).toContain("Acesso ao app");
    expect(($("[data-acesso-email]") as HTMLInputElement).value).toBe("joao@x.com");
    // sem senha ainda, não dá para salvar nada (sem mudança)
    expect(salvar()?.hasAttribute("disabled")).toBe(true);
    // liga o acesso → aparece o campo de senha
    await clicar(toggle());
    expect($("[data-acesso-senha]")).toBeTruthy();
    expect(corpo()).toContain("Pelo menos 8 caracteres");
    await digitar($("[data-acesso-senha]"), "tecnico-123");
    await clicar(salvar());
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toContain("/api/tecnicos/t1/acesso");
    expect(chamadas[0].body).toEqual({ acessoAtivo: true, senha: "tecnico-123" });
  });

  it("com login ativo: mostra Redefinir senha e permite bloquear o acesso", async () => {
    await montar({ tecnicoId: "t1", emailSalvo: "joao@x.com", inicial: { temLogin: true, acessoAtivo: true, role: "TECNICO" } });
    expect($("[data-acesso-redefinir]")).toBeTruthy();
    // bloquear: desliga o toggle e salva acessoAtivo=false (sem exigir senha)
    await clicar(toggle());
    await clicar(salvar());
    expect(chamadas[0].body).toEqual({ acessoAtivo: false });
  });

  it("sem e-mail: o toggle fica travado (o e-mail é a identidade de login)", async () => {
    await montar({ tecnicoId: "t1", emailSalvo: null, inicial: { temLogin: false, acessoAtivo: false, role: null } });
    expect(toggle().hasAttribute("disabled")).toBe(true);
    expect(corpo()).toContain("não tem e-mail");
  });
});
