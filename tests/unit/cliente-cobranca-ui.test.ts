// @vitest-environment happy-dom
/**
 * Seção "Cobrança e faturamento" no cadastro de cliente (aba Dados gerais): e-mails de cobrança
 * (tags), WhatsApp de cobrança e as preferências (boleto único mensal, exige PC antes da NF, agrupa
 * adicionais). O campo de e-mails confirma com Enter/vírgula e remove pelo "x" do chip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ sp: new URLSearchParams() }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {} }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp, usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}));

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
async function tecla(el: Element | null, key: string) {
  expect(el).toBeTruthy();
  await act(async () => { el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
  await flush();
}
async function montar(permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ClienteForm, {}) })); });
  await flush();
}

beforeEach(() => {
  nav.sp = new URLSearchParams();
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

describe("Cobrança e faturamento no cadastro de cliente", () => {
  it("mostra os campos de cobrança e as preferências na aba Dados gerais", async () => {
    await montar();
    const c = corpo();
    expect(c).toContain("Cobrança e faturamento");
    expect(c).toContain("E-mails de cobrança");
    expect(c).toContain("WhatsApp de cobrança");
    expect(c).toContain("Boleto único mensal");
    expect(c).toContain("Exige pedido de compra antes da NF");
    expect(c).toContain("Agrupa adicionais na fatura");
    expect($("[data-emails-input] input[type='email']")).toBeTruthy();
    expect($('input[name="whatsappFaturamento"]')).toBeTruthy();
  });

  it("e-mails de cobrança: adiciona com Enter e remove pelo x do chip", async () => {
    await montar();
    const input = $("[data-emails-input] input[type='email']");
    await digitar(input, "financeiro@alfa.com.br");
    await tecla(input, "Enter");
    expect($('[data-chip="financeiro@alfa.com.br"]')).toBeTruthy();

    // segundo e-mail por vírgula
    await digitar(input, "fiscal@alfa.com.br");
    await tecla(input, ",");
    expect($('[data-chip="fiscal@alfa.com.br"]')).toBeTruthy();

    // e-mail inválido não vira chip e mostra o aviso
    await digitar(input, "sem-arroba");
    await tecla(input, "Enter");
    expect($('[data-chip="sem-arroba"]')).toBeFalsy();
    expect(corpo()).toContain("E-mail inválido");

    // remove o primeiro pelo "x"
    await clicar($('[data-chip="financeiro@alfa.com.br"] button'));
    expect($('[data-chip="financeiro@alfa.com.br"]')).toBeFalsy();
    expect($('[data-chip="fiscal@alfa.com.br"]')).toBeTruthy();
  });

  it("as preferências de cobrança são toggles (role switch)", async () => {
    await montar();
    const porRotulo = (txt: string) => $$("[role='switch']").find((s) => {
      const id = s.getAttribute("aria-labelledby");
      return id ? (document.getElementById(id)?.textContent ?? "").includes(txt) : false;
    });
    const boleto = porRotulo("Boleto único mensal");
    expect(boleto).toBeTruthy();
    expect(boleto!.getAttribute("aria-checked")).toBe("false");
    await clicar(boleto);
    expect(boleto!.getAttribute("aria-checked")).toBe("true");
  });
});
