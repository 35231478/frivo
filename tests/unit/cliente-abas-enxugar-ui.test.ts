// @vitest-environment happy-dom
/**
 * Enxugamento das abas do Cliente: de 9 para 5 (Dados gerais, Comunicação, Anexos, Portal,
 * Relacionamento). Dados gerais concentra, em seções: Dados básicos, Logomarca, Contatos, Endereços
 * e Tabela de preços. As abas Contatos, Endereços, Faturamento e Contratos saem; o perfil de
 * faturamento (tipo/dia/condição) deixa a UI do cliente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ sp: new URLSearchParams() }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  toast: () => {},
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp,
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}));

let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

async function montar(initialData: any, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ClienteForm, { initialData }) }));
  });
  await flush();
}

beforeEach(() => {
  nav.sp = new URLSearchParams();
  globalThis.fetch = vi.fn(async () =>
    new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

const CLIENTE: any = {
  id: "cl1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara",
  tipoPessoa: "JURIDICA", cpfCnpj: "11.111.111/0001-11", ativo: true, statusFinanceiro: "ADIMPLENTE",
  logo: null, unidades: [], anexos: [], contatosCliente: [], interacoes: [], _count: { contratos: 1 },
};

const LABELS_ABAS = ["Dados gerais", "Comunicação", "Anexos", "Portal", "Relacionamento"];

describe("Abas do cliente enxugadas para 5", () => {
  it("as abas são exatamente as 5 previstas (Contatos, Endereços, Faturamento e Contratos saíram)", async () => {
    await montar(CLIENTE);
    const nav = caixa.querySelector("nav")!;
    const botoes = [...nav.querySelectorAll("button")].map((b) => txt(b));
    expect(botoes).toEqual(LABELS_ABAS);
    // as abas removidas não existem mais como aba
    for (const removida of ["Faturamento", "Contratos"]) {
      expect(botoes.some((b) => b === removida)).toBe(false);
    }
    // "Anexos e mídia" virou só "Anexos"
    expect(botoes).not.toContain("Anexos e mídia");
  });

  it("Dados gerais concentra as seções: básicos, logo, contatos, endereços e tabela de preços", async () => {
    await montar(CLIENTE);
    // os cabeçalhos de seção são <h3> (FormSection); conferir pelo heading, não só pelo texto solto
    const headings = $$("h3").map((e) => txt(e));
    for (const sec of ["Dados básicos", "Logomarca", "Contatos do cliente", "Endereços do cliente", "Tabela de preços"]) {
      expect(headings.includes(sec), `faltou a seção ${sec}`).toBe(true);
    }
  });

  it("o perfil de faturamento saiu da UI (sem tipo/dia/condição de faturamento)", async () => {
    await montar(CLIENTE);
    const corpo = caixa.textContent ?? "";
    expect(corpo).not.toContain("Tipo de faturamento");
    expect(corpo).not.toContain("Dia de faturamento");
    expect(corpo).not.toContain("Condição de pagamento");
    expect(corpo).not.toContain("Perfil de faturamento");
    // mas a tabela de preços continua (migrada para Dados gerais)
    expect(corpo).toContain("Tabela de preços");
  });

  it("a badge de contratos no cabeçalho vira link para os contratos do cliente", async () => {
    await montar(CLIENTE);
    const link = [...caixa.querySelectorAll("a")].find((a) => (a.getAttribute("href") ?? "").includes("/contratos?clienteId="));
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/contratos?clienteId=cl1");
  });
});
