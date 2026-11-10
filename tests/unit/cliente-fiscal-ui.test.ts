// @vitest-environment happy-dom
/**
 * Seção "Informações fiscais" no cadastro de cliente: avançada, recolhida por padrão (progressive
 * disclosure). Concentra o fiscal — a Inscrição estadual saiu de Identificação para cá. A consulta
 * de CNPJ, quando traz a opção pelo Simples, preenche o "Optante pelo Simples" e abre a seção.
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

let rotas: Record<string, unknown> = {};
let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); }
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}
async function montar(permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ClienteForm, {}) })); });
  await flush();
}

const toggleFiscal = () => $('[data-secao-fiscal-toggle]');
const corpo = () => caixa.textContent ?? "";

beforeEach(() => {
  nav.sp = new URLSearchParams();
  rotas = {};
  globalThis.fetch = vi.fn(async (u: any) => {
    const r = rotas[`GET ${String(u)}`];
    return new Response(JSON.stringify(r ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

describe("Informações fiscais no cadastro de cliente", () => {
  it("recolhida por padrão; abre e mostra os campos (IE migrou para cá)", async () => {
    await montar();
    expect(toggleFiscal()).toBeTruthy();
    // recolhida: os campos não estão no DOM
    expect($("[data-secao-fiscal]")).toBeFalsy();
    expect(corpo()).not.toContain("Optante pelo Simples Nacional");
    // abre
    await clicar(toggleFiscal());
    expect($("[data-secao-fiscal]")).toBeTruthy();
    const c = corpo();
    expect(c).toContain("Optante pelo Simples Nacional");
    expect(c).toContain("Indicador de Inscrição estadual");
    expect(c).toContain("Inscrição estadual");
    expect(c).toContain("Inscrição municipal");
    expect(c).toContain("Inscrição SUFRAMA");
    // o campo IE existe dentro da seção fiscal (saiu de Identificação)
    expect($('[data-secao-fiscal] input[name="inscricaoEstadual"]')).toBeTruthy();
  });

  it("Consultar CNPJ com opção pelo Simples preenche o Optante e abre a seção", async () => {
    rotas = { "GET /api/cnpj/11222333000181": { nome: "Termofrio Ltda", optanteSimples: true } };
    await montar();
    expect($("[data-secao-fiscal]")).toBeFalsy(); // começa recolhida
    await digitar($('input[name="cpfCnpj"]'), "11.222.333/0001-81");
    await clicar($$("button").find((b) => b.textContent!.includes("Consultar")));
    // a consulta abre a seção e marca "Sim"
    expect($("[data-secao-fiscal]")).toBeTruthy();
    const sim = $$("[data-secao-fiscal] [role='radio']").find((b) => b.textContent!.trim() === "Sim");
    expect(sim?.getAttribute("aria-checked")).toBe("true");
  });
});
