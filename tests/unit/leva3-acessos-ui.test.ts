// @vitest-environment happy-dom
/**
 * Leva 3 — telas (DOM): o menu inferior do celular e os atalhos do sino seguem o RBAC (T1/I3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PermissoesProvider } from "@/components/providers/permissoes-provider";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

let caixa: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

describe("I3 — menu inferior do celular filtrado por permissão", () => {
  it("técnico de campo sem 'clientes' não vê o atalho Clientes; admin vê os 4", async () => {
    const { MobileBottomNav } = await import("@/components/layout/mobile-bottom-nav");

    root = createRoot(caixa);
    await act(async () => {
      root.render(createElement(PermissoesProvider, {
        role: "OPERADOR",
        permissoes: montarPermissoes({ ordens: ["visualizar"], calendario: ["visualizar"] }),
      } as any, createElement(MobileBottomNav)));
    });
    let labels = Array.from(caixa.querySelectorAll("a span")).map((s) => s.textContent);
    expect(labels).toContain("OS");
    expect(labels).not.toContain("Clientes");

    await act(async () => {
      root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais() } as any, createElement(MobileBottomNav)));
    });
    labels = Array.from(caixa.querySelectorAll("a span")).map((s) => s.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Início", "OS", "Agenda", "Clientes"]));
  });
});

describe("T1 — atalhos do sino filtrados por permissão", () => {
  it("técnico não vê 'Compras pendentes' nem 'Boletos pagos hoje', mesmo com a API devolvendo números", async () => {
    const { Header } = await import("@/components/layout/header");
    const alertas = {
      prazosVencidos: 2, etapasVencendoHoje: 1, pedidosPendentes: 7, atendimentosAtraso: 1, chamadosPortal: 1,
      checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, boletosPagos: 9, total: 21,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(alertas), { status: 200, headers: { "content-type": "application/json" } })));

    const sessaoTecnico = {
      user: { id: "u1", name: "João", email: "j@x.com", empresaId: "e1", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar"] }) },
      expires: "2099-01-01T00:00:00Z",
    } as any;

    root = createRoot(caixa);
    await act(async () => {
      root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: sessaoTecnico.user.permissoes } as any,
        createElement(Header, { session: sessaoTecnico, avatarUrl: null } as any)));
    });
    await flush();

    // Abre o sino (botão com o badge de alertas)
    const botaoSino = Array.from(caixa.querySelectorAll("button")).find((b) => b.querySelector("svg.lucide-bell"));
    expect(botaoSino).toBeTruthy();
    await act(async () => { (botaoSino as HTMLButtonElement).click(); });
    await flush();

    expect(caixa.textContent).toContain("Prazos vencidos");
    expect(caixa.textContent).not.toContain("Compras pendentes");
    expect(caixa.textContent).not.toContain("Boletos pagos hoje");
  });
});
