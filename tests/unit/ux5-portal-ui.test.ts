// @vitest-environment happy-dom
/**
 * UX-5 "Portal que cobra sozinho" — telas num DOM de verdade:
 *  - C1: a nav do portal mostra "FATURAS" (rótulo leigo) para quem tem verFinanceiro —
 *    e esconde para quem não tem;
 *  - C1: ao DAR acesso novo, as permissões já vêm marcadas (inclusive as faturas); ao
 *    GERENCIAR um acesso antigo, nada muda sozinho (respeita o que está salvo);
 *  - Y13: a tela de entrada do portal tem o link "Esqueci minha senha".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/portal/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

let root: Root; let caixa: HTMLDivElement;
const esperar = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const BRANDING = { empresaNome: "Clima Total", logo: null, cor: "#0EA5E9" };

describe("C1: nav do portal", () => {
  it("'Faturas' aparece com verFinanceiro e some sem", async () => {
    const { PortalShell } = await import("@/components/portal/portal-shell");
    await montar(createElement(PortalShell, {
      contatoNome: "Maria", clienteNome: "Hospital", branding: BRANDING,
      permissoes: { verFinanceiro: true, verOS: true }, children: createElement("div"),
    } as any));
    const links = $$("nav a").map((a) => a.textContent?.trim());
    expect(links).toContain("Faturas");
    expect(links).not.toContain("Financeiro"); // rótulo leigo no lugar do jargão
    expect($<HTMLAnchorElement>('a[href="/portal/financeiro"]')).not.toBeNull();

    await act(async () => root.unmount()); caixa.remove();
    await montar(createElement(PortalShell, {
      contatoNome: "Maria", clienteNome: "Hospital", branding: BRANDING,
      permissoes: { verOS: true }, children: createElement("div"),
    } as any));
    expect($$("nav a").map((a) => a.textContent?.trim())).not.toContain("Faturas");
  });
});

describe("C1: permissão-padrão ao conceder acesso", () => {
  const switches = () => $$("button[role=switch]");
  const estadoDe = (label: string) =>
    switches().find((s) => s.closest("label")?.textContent?.includes(label))?.getAttribute("aria-checked");

  it("acesso NOVO nasce vendo as faturas (e o resto do essencial); aprovar fica desligado", async () => {
    const { PortalAcessoContato } = await import("@/components/forms/portal-acesso-contato");
    await montar(createElement(PortalAcessoContato, {
      clienteId: "c1", contatoId: "ct1", contatoNome: "Maria", emailInicial: "m@x.com",
      temAcesso: false, permissoesIniciais: null,
    } as any));
    await clicar($$("button").find((b) => b.textContent!.includes("Dar acesso ao portal")));
    expect(estadoDe("Ver financeiro")).toBe("true");
    expect(estadoDe("Ver e baixar boletos")).toBe("true");
    expect(estadoDe("Ver valores financeiros")).toBe("true");
    expect(estadoDe("Ver histórico de OS")).toBe("true");
    expect(estadoDe("Aprovar medições")).toBe("false"); // decisão do gestor, nunca padrão
  });

  it("acesso ANTIGO respeita o que está salvo (nada liga sozinho)", async () => {
    const { PortalAcessoContato } = await import("@/components/forms/portal-acesso-contato");
    await montar(createElement(PortalAcessoContato, {
      clienteId: "c1", contatoId: "ct1", contatoNome: "Maria", emailInicial: "m@x.com",
      temAcesso: true, acessoConcedidoEmInicial: "2026-01-01", permissoesIniciais: { verOS: true },
    } as any));
    await clicar($$("button").find((b) => b.textContent!.includes("Gerenciar acesso ao portal")));
    expect(estadoDe("Ver histórico de OS")).toBe("true");
    expect(estadoDe("Ver financeiro")).toBe("false");
  });
});

describe("Y13: tela de entrada", () => {
  it("tem o link 'Esqueci minha senha' apontando para o fluxo do portal", async () => {
    const { PortalLoginForm } = await import("@/components/portal/portal-login-form");
    await montar(createElement(PortalLoginForm));
    const link = $<HTMLAnchorElement>("[data-esqueci-senha]");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/portal/esqueci-senha");
  });
});
