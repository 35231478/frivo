// @vitest-environment happy-dom
/**
 * COM-1 — a marca "Ver só os próprios" no editor de perfil de acesso: aparece em Orçamentos e em OS com a explicação
 * de que LIMITA; o "Selecionar tudo" da seção não a liga (marcar tudo nunca restringe sem querer); dá para ligar à mão.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

let root: Root | null = null, caixa: HTMLDivElement | null = null;
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); root = null; caixa = null; });

async function abrir() {
  const { EditorPerfil } = await import("@/components/cadastros/editores/editor-perfil");
  const item = { id: "p1", nome: "Comercial", tipo: "PERSONALIZADO", cor: "#8B5CF6", descricao: "", permissoes: montarPermissoes({ orcamentos: ["visualizar"] }) };
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(EditorPerfil, { item, aberto: true, onFechar: () => {}, onSalvo: () => {} } as any)); });
}
const chave = (rotulo: string) => document.body.querySelector<HTMLButtonElement>(`[role='switch'][aria-label='${rotulo}']`);
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); };

describe("editor de perfil › Ver só os próprios", () => {
  it("aparece em Orçamentos e em OS, com a explicação de que limita", async () => {
    await abrir();
    expect(chave("Orçamentos: Ver só os próprios")).toBeTruthy();
    expect(chave("Ordens de serviço: Ver só os próprios")).toBeTruthy();
    const rotulos = [...document.body.querySelectorAll("[data-acao-restritiva]")];
    expect(rotulos).toHaveLength(2);
    expect(rotulos[0].getAttribute("title")).toMatch(/^Limita: vê só os orçamentos em que é o vendedor/);
  });

  it("'Selecionar tudo' liga o resto e deixa a marca DESLIGADA; ligar à mão funciona", async () => {
    await abrir();
    // O "Selecionar tudo" da seção de Orçamentos
    const botoes = [...document.body.querySelectorAll("button")].filter((b) => b.textContent === "Selecionar tudo");
    for (const b of botoes) await clicar(b);
    expect(chave("Orçamentos: Aprovar")!.getAttribute("aria-checked")).toBe("true");
    expect(chave("Orçamentos: Ver só os próprios")!.getAttribute("aria-checked")).toBe("false");
    expect(chave("Ordens de serviço: Ver só os próprios")!.getAttribute("aria-checked")).toBe("false");
    await clicar(chave("Orçamentos: Ver só os próprios"));
    expect(chave("Orçamentos: Ver só os próprios")!.getAttribute("aria-checked")).toBe("true");
  });
});
