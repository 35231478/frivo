// @vitest-environment happy-dom
/**
 * Aba "Atendimento" do cliente (edição): mostra o histórico de ordens de serviço do cliente, com
 * link para cada OS (/ordens/{id}). Busca só quando a aba abre. Vazio → mensagem + "Nova OS".
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
let ordensResp: unknown[] = [];
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); }
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}

async function montar(initialData: any, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ClienteForm, { initialData }) })); });
  await flush();
}

beforeEach(() => {
  nav.sp = new URLSearchParams();
  globalThis.fetch = vi.fn(async (u: any) => {
    const url = String(u);
    const body = url.includes("/api/ordens") ? ordensResp : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); ordensResp = []; });

const CLIENTE: any = {
  id: "cl1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara",
  tipoPessoa: "JURIDICA", cpfCnpj: "11.111.111/0001-11", ativo: true, statusFinanceiro: "ADIMPLENTE",
  logo: null, unidades: [], anexos: [], contatosCliente: [], interacoes: [], _count: { contratos: 0 },
};
const abaAtendimento = () => $$("nav button").find((b) => txt(b) === "Atendimento");

describe("Aba Atendimento do cliente", () => {
  it("lista as OS do cliente com link para cada uma", async () => {
    ordensResp = [
      { id: "os_1", numero: "OS-0001", status: "EM_ANDAMENTO", prioridade: "ALTA", descricao: "Manutenção do chiller", criadoEm: "2026-10-01T12:00:00Z", dataConclusao: null, unidade: { id: "u1", nome: "Matriz" }, responsavel: { id: "t1", nome: "Carlos" } },
      { id: "os_2", numero: "OS-0002", status: "CONCLUIDA", prioridade: "NORMAL", descricao: "Troca de filtro", criadoEm: "2026-09-10T12:00:00Z", dataConclusao: "2026-09-12T12:00:00Z", unidade: null, responsavel: null },
    ];
    await montar(CLIENTE);
    await clicar(abaAtendimento());
    const corpo = caixa.textContent ?? "";
    expect(corpo).toContain("OS-0001");
    expect(corpo).toContain("OS-0002");
    expect(corpo).toContain("Manutenção do chiller");
    // cada OS vira um link para /ordens/{id}
    const hrefs = $$("a").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/ordens/os_1");
    expect(hrefs).toContain("/ordens/os_2");
  });

  it("a busca filtra as OS (por descrição/número/unidade)", async () => {
    ordensResp = [
      { id: "os_1", numero: "OS-0001", status: "EM_ANDAMENTO", prioridade: "ALTA", descricao: "Manutenção do chiller", criadoEm: "2026-10-01T12:00:00Z", dataConclusao: null, unidade: { id: "u1", nome: "Matriz" }, responsavel: { id: "t1", nome: "Carlos" } },
      { id: "os_2", numero: "OS-0002", status: "CONCLUIDA", prioridade: "NORMAL", descricao: "Troca de filtro", criadoEm: "2026-09-10T12:00:00Z", dataConclusao: "2026-09-12T12:00:00Z", unidade: null, responsavel: null },
    ];
    await montar(CLIENTE);
    await clicar(abaAtendimento());
    const campo = $$("input").find((i) => /Número, descrição/.test(i.getAttribute("placeholder") ?? ""));
    await digitar(campo ?? null, "chiller");
    const corpo = caixa.textContent ?? "";
    expect(corpo).toContain("OS-0001");
    expect(corpo).not.toContain("OS-0002");
    // contador reflete o filtro (1 de 2)
    expect(corpo).toContain("1 de 2");
  });

  it("sem OS: mostra mensagem vazia e o atalho Nova OS", async () => {
    ordensResp = [];
    await montar(CLIENTE);
    await clicar(abaAtendimento());
    const corpo = caixa.textContent ?? "";
    expect(corpo).toContain("Nenhuma ordem de serviço para este cliente ainda");
    const nova = $$("a").find((a) => (a.getAttribute("href") ?? "") === "/ordens/nova?clienteId=cl1");
    expect(nova).toBeTruthy();
  });
});
