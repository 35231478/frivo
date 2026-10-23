// @vitest-environment happy-dom
/**
 * UX-2 "Achar o cliente e agir" (E1 + E5 da auditoria de UX):
 *  - E1: o form de EQUIPAMENTO usa o MESMO seletor de cliente da Nova OS — busca que filtra
 *    de verdade, "+ Novo cliente" com RBAC (clientes.criar) e o criado já selecionado;
 *  - E5: a ficha do cliente tem "Nova OS" e "Novo orçamento" (RBAC ordens/orcamentos.criar,
 *    só cliente ativo), e salvar um cliente NOVO aterrissa na ficha dele (?criado=1 → toast).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[], replace: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp,
  usePathname: () => "/",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: (u: string) => nav.replace.push(u), refresh: () => {}, back: () => {} }),
}));

type Resp = unknown | ((init?: RequestInit) => unknown);
let rotas: Record<string, Resp> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

let root: Root;
let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
async function clicar(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}
async function digitar(el: Element | null, valor: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}
async function montar(el: any, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await flush();
}

const CLIENTES = [
  { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "11.111.111/0001-11" },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `cx${i}`, nome: `Cliente ${i + 1}`, nomeFantasia: null, cpfCnpj: null })),
];

beforeEach(() => {
  nav.sp = new URLSearchParams();
  nav.push = []; nav.replace = [];
  chamadas.length = 0;
  rotas = {
    "GET /api/clientes": CLIENTES,
    "GET /api/tipos-equipamento": [],
    "GET /api/configuracoes": {},
    "GET /api/unidades?clienteId=c1": [{ id: "u1", nome: "Matriz", cidade: "São Paulo", clienteId: "c1" }],
    "POST /api/clientes": { id: "c-novo", nome: "Clínica Vida Nova", nomeFantasia: null },
  };
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    const r = rotas[`${metodo} ${url}`];
    if (r === undefined) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(typeof r === "function" ? (r as any)(init) : r), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  caixa?.remove();
});

/* ───────── E1: form de equipamento ───────── */
describe("E1: equipamento usa o seletor de cliente da Nova OS", () => {
  async function montarEquipamento(permissoes: Permissoes = permissoesTotais()) {
    const { EquipamentoForm } = await import("@/components/forms/equipamento-form");
    await montar(createElement(EquipamentoForm, {}), permissoes);
  }

  it("a busca FILTRA de verdade e escolher o cliente carrega as unidades dele", { timeout: 40000 }, async () => {
    await montarEquipamento();
    // o combobox antigo (que não filtrava) sumiu
    expect($('input[placeholder*="2+ letras"]')).toBeNull();
    // abre o seletor novo
    await clicar($$("button").find((b) => b.textContent!.includes("Selecione o cliente")));
    expect($$("button").filter((b) => b.textContent!.startsWith("Cliente ")).length).toBe(7);
    await digitar($('input[placeholder*="Buscar cliente"]'), "santa");
    const opcoes = $$("button").filter((b) => b.textContent!.includes("Hospital Santa Clara"));
    expect(opcoes.length).toBe(1);
    expect($$("button").filter((b) => b.textContent!.startsWith("Cliente ")).length).toBe(0);
    await clicar(opcoes[0]);
    expect(chamadas.some((c) => c.url === "/api/unidades?clienteId=c1")).toBe(true);
  });

  it("'+ Novo cliente' cria pela API e JÁ seleciona (RBAC: some sem clientes.criar)", { timeout: 40000 }, async () => {
    await montarEquipamento();
    await clicar($$("button").find((b) => b.textContent!.includes("Selecione o cliente")));
    await clicar($$("button").find((b) => b.textContent!.includes("Novo cliente")));
    // mini-cadastro do CLIENTE (o mesmo da Nova OS)
    const dialogo = $('[role="dialog"]')!;
    expect(dialogo.textContent).toContain("CPF / CNPJ");
    const inputs = [...dialogo.querySelectorAll("input")];
    await digitar(inputs[0], "12345678000190"); // CPF/CNPJ
    await digitar(inputs[1], "Clínica Vida Nova"); // Nome / razão social
    await clicar([...dialogo.querySelectorAll("button")].find((b) => b.textContent!.includes("Salvar")));
    expect(chamadas.find((c) => c.metodo === "POST" && c.url === "/api/clientes")?.corpo?.nome).toBe("Clínica Vida Nova");
    // selecionado: o botão do seletor mostra o criado e as unidades dele são buscadas
    expect($$("button").some((b) => b.textContent!.includes("Clínica Vida Nova"))).toBe(true);
    expect(chamadas.some((c) => c.url === "/api/unidades?clienteId=c-novo")).toBe(true);

    // sem clientes.criar: a opção não existe
    await act(async () => root.unmount()); caixa.remove();
    await montarEquipamento(montarPermissoes({ equipamentos: ["visualizar", "criar", "editar"], clientes: ["visualizar"] }));
    await clicar($$("button").find((b) => b.textContent!.includes("Selecione o cliente")));
    expect($$("button").some((b) => b.textContent!.includes("Novo cliente"))).toBe(false);
  });
});

/* ───────── E5: ficha do cliente ───────── */
const CLIENTE_FICHA: any = {
  id: "cl1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara",
  tipoPessoa: "JURIDICA", cpfCnpj: "11.111.111/0001-11", ativo: true, statusFinanceiro: "ADIMPLENTE",
  unidades: [], anexos: [], contatosCliente: [], interacoes: [], _count: { contratos: 1 },
};

describe("E5: ficha do cliente com 'Nova OS'/'Novo orçamento' e pós-salvar na ficha", () => {
  async function montarCliente(permissoes: Permissoes = permissoesTotais(), initialData?: any) {
    const { ClienteForm } = await import("@/components/forms/cliente-form");
    await montar(createElement(ClienteForm, { initialData }), permissoes);
  }

  it("atalhos no cabeçalho com os links certos; RBAC; só cliente ativo; não aparecem no 'novo'", { timeout: 40000 }, async () => {
    await montarCliente(permissoesTotais(), CLIENTE_FICHA);
    expect($<HTMLAnchorElement>("[data-nova-os]")!.getAttribute("href")).toBe("/ordens/nova?clienteId=cl1");
    expect($<HTMLAnchorElement>("[data-novo-orcamento]")!.getAttribute("href")).toBe("/orcamentos/novo?clienteId=cl1");
    await act(async () => root.unmount()); caixa.remove();

    // sem ordens.criar / orcamentos.criar: atalhos somem (a ficha continua)
    await montarCliente(montarPermissoes({ clientes: ["visualizar", "editar"] }), CLIENTE_FICHA);
    expect($("[data-nova-os]")).toBeNull();
    expect($("[data-novo-orcamento]")).toBeNull();
    await act(async () => root.unmount()); caixa.remove();

    // cliente inativo: sem atalhos (não se abre OS para inativo)
    await montarCliente(permissoesTotais(), { ...CLIENTE_FICHA, ativo: false });
    expect($("[data-nova-os]")).toBeNull();
    await act(async () => root.unmount()); caixa.remove();

    // cadastro novo (sem id ainda): sem atalhos
    await montarCliente(permissoesTotais(), undefined);
    expect($("[data-nova-os]")).toBeNull();
  });

  it("salvar um cliente NOVO aterrissa na ficha dele (?criado=1)", { timeout: 40000 }, async () => {
    rotas["POST /api/clientes"] = { id: "c-novo" };
    await montarCliente();
    await digitar($('input[name="cpfCnpj"]'), "12.345.678/0001-90");
    await digitar($('input[name="nome"]'), "Clínica Vida Nova");
    await clicar($$("button").find((b) => b.textContent!.trim() === "Salvar"));
    expect(chamadas.some((c) => c.metodo === "POST" && c.url === "/api/clientes")).toBe(true);
    expect(nav.push).toEqual(["/clientes/c-novo/editar?criado=1"]);
  });

  it("chegando com ?criado=1: toast de sucesso e a URL é limpa", { timeout: 40000 }, async () => {
    nav.sp = new URLSearchParams("criado=1");
    await montarCliente(permissoesTotais(), CLIENTE_FICHA);
    expect(caixa.textContent).toContain("Cliente cadastrado com sucesso!");
    expect(nav.replace).toEqual(["/clientes/cl1/editar"]);
  });
});
