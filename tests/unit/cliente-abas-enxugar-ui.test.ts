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

async function montar(initialData: any, permissoes: Permissoes = permissoesTotais(), extra: Record<string, unknown> = {}) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ClienteForm, { initialData, ...extra }) }));
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

// Leva H (mudança intencional): "Dados gerais" virou "Dados"; os locais de atendimento ganharam a aba
// Endereços; "Relacionamento" (interações manuais + satisfação) virou o Histórico automático.
const LABELS_ABAS = ["Dados", "Endereços", "Histórico", "Atendimento", "Comunicação", "Portal", "Anexos"];

describe("Abas do cliente", () => {
  it("as abas são exatamente as previstas, com Atendimento e Anexos por último", async () => {
    await montar(CLIENTE);
    const nav = caixa.querySelector("[data-abas-cliente]")!;
    const botoes = [...nav.querySelectorAll("button")].map((b) => txt(b));
    expect(botoes).toEqual(LABELS_ABAS);
    // Anexos é a última aba
    expect(botoes[botoes.length - 1]).toBe("Anexos");
    // as abas removidas não existem mais como aba
    for (const removida of ["Faturamento", "Contratos", "Relacionamento"]) {
      expect(botoes.some((b) => b === removida)).toBe(false);
    }
    // "Anexos e mídia" virou só "Anexos"
    expect(botoes).not.toContain("Anexos e mídia");
  });

  it("Dados concentra as seções: Identificação, Endereço principal, Contatos, Comercial e Observações", async () => {
    await montar(CLIENTE);
    // os cabeçalhos de seção são <h3> (FormSection); conferir pelo heading, não só pelo texto solto
    const headings = $$("h3").map((e) => txt(e));
    for (const sec of ["Identificação", "Endereço principal", "Contatos", "Comercial", "Observações"]) {
      expect(headings.includes(sec), `faltou a seção ${sec}`).toBe(true);
    }
    // O endereço principal vem logo depois da identificação (o Consultar preenche os dois juntos)
    expect(headings.indexOf("Identificação")).toBeLessThan(headings.indexOf("Endereço principal"));
    expect(headings.indexOf("Endereço principal")).toBeLessThan(headings.indexOf("Contatos"));
    // Os outros endereços (locais de atendimento) ficam na aba Endereços, não em Dados
    expect(headings).toContain("Locais de atendimento");
    expect(caixa.querySelector('[data-aba="enderecos"]')).toBeTruthy();
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

  it("na ficha, o sinal de contratos no cabeçalho é link para os contratos do cliente", async () => {
    // Leva H: os sinais (contratos, a receber, inadimplente) ficam na consulta; a edição é só cancelar/salvar
    await montar(CLIENTE, permissoesTotais(), { consulta: true });
    const link = [...caixa.querySelectorAll("a")].find((a) => (a.getAttribute("href") ?? "").includes("/contratos?clienteId="));
    expect(link).toBeTruthy();
    // pj4 (H17, mudança intencional): o link já filtra os contratos ATIVOS (e só aparece com Contratos › Visualizar)
    expect(link!.getAttribute("href")).toBe("/contratos?clienteId=cl1&status=ATIVO");
  });
});
