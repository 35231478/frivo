// @vitest-environment happy-dom
/**
 * pj4 — pontas da ficha do cliente (Leva H), na tela:
 *  - H01: sem o financeiro, o cabeçalho não mostra valores ("Inadimplente", sem o valor; nada de "a receber");
 *  - H17: "N contratos ativos" só vira link com Contratos › Visualizar (já filtrando os ativos);
 *  - H06: Consultar CNPJ num cliente que já existe não troca o nome fantasia nem o Simples já preenchidos;
 *  - H19: Consultar sem os 14 dígitos (ou com dígito errado) diz por quê e não consulta;
 *  - H21: trocar PJ → PF depois da consulta destrava o "Nome completo";
 *  - H11: "Cancelar" é link (o aviso de sair sem salvar pergunta); "Salvar e continuar" marca o formulário salvo;
 *  - H10: endereços do cliente novo: Excluir funciona (o principal passa ao próximo) e o nome não vem "Principal";
 *  - H20: "Tornar principal" que falha mostra o erro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[] }));
const avisos = vi.hoisted(() => ({ confirmar: vi.fn(async () => false) }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {}, confirmar: avisos.confirmar }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp, usePathname: () => "/",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: () => {}, refresh: () => {}, back: () => {} }),
}));

let rotas: Record<string, { status?: number; corpo: unknown }> = {};
let chamadas: { metodo: string; url: string }[] = [];
let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string, base: ParentNode = caixa) => base.querySelector(sel) as T | null;
const $$ = (sel: string, base: ParentNode = caixa) => [...base.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); }
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}
async function escolher(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}
const valor = (nome: string) => ($(`[name="${nome}"]`) as HTMLInputElement | null)?.value;

async function render(el: React.ReactElement, permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role, permissoes, children: el })); });
  await flush();
}
async function montar(props: Record<string, unknown>, permissoes?: Permissoes, protegido = false) {
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  const { ProtegerSaida } = await import("@/components/ui/proteger-saida");
  const form = createElement(ClienteForm, props as any);
  await render(protegido ? createElement(ProtegerSaida, { children: form }) : form, permissoes);
}

beforeEach(() => {
  nav.sp = new URLSearchParams(); nav.push = [];
  avisos.confirmar.mockClear();
  rotas = {}; chamadas = [];
  (window as any).happyDOM?.setURL("http://localhost:3000/clientes/cl1/editar");
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ metodo, url });
    const r = rotas[`${metodo} ${url}`];
    return new Response(JSON.stringify(r?.corpo ?? (url.includes("/historico") ? { eventos: [] } : {})), { status: r?.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; });

const CLIENTE: any = {
  id: "cl1", nome: "Hospital Santa Luzia Ltda", nomeFantasia: "Santa Luzia", tipoPessoa: "JURIDICA", cpfCnpj: "11222333000181",
  ativo: true, statusFinanceiro: "ADIMPLENTE", logo: null, cidade: "São Paulo", estado: "SP", optanteSimples: false,
  unidades: [
    { id: "u1", nome: "Matriz", principal: true, ativo: true, logradouro: "Rua das Acácias", numero: "250", cidade: "São Paulo", estado: "SP" },
    { id: "u2", nome: "Anexo", principal: false, ativo: true, logradouro: "Rua dos Ipês", numero: "80", cidade: "São Paulo", estado: "SP" },
  ],
  anexos: [], contatosCliente: [], unidadesInativas: [], contatosInativos: [], _count: { contratos: 2 },
};
const sinais = () => $$("[data-sinal]").map((s) => [s.getAttribute("data-sinal"), txt(s), s.closest("a")?.getAttribute("href") ?? null]);

describe("H01/H17 — cabeçalho pelo perfil", () => {
  it("sem o financeiro nem contratos: \"Inadimplente\" sem valor, sem \"a receber\", contratos sem link", async () => {
    await montar({ initialData: CLIENTE, consulta: true, valorEmAtraso: 2950, totalProximos30Dias: 1200, emAtraso: true }, montarPermissoes({ clientes: ["visualizar"] }));
    expect(sinais()).toEqual([["inadimplente", "Inadimplente", null], ["contratos", "2 contratos ativos", null]]);
    expect(txt(caixa)).not.toContain("R$");
  });
  it("só o \"há atraso\" (a página não manda os valores): \"Inadimplente\"", async () => {
    await montar({ initialData: { ...CLIENTE, _count: { contratos: 0 } }, consulta: true, emAtraso: true }, montarPermissoes({ clientes: ["visualizar"] }));
    expect(sinais()).toEqual([["inadimplente", "Inadimplente", null]]);
  });
  it("com o financeiro e contratos: os valores e o link aos contratos ativos", async () => {
    await montar({ initialData: CLIENTE, consulta: true, valorEmAtraso: 2950, totalProximos30Dias: 1200, emAtraso: true },
      montarPermissoes({ clientes: ["visualizar"], financeiro: ["contasReceber"], contratos: ["visualizar"] }));
    expect(sinais()).toEqual([
      ["inadimplente", "Inadimplente · R$ 2.950,00 em atraso", "/financeiro/contas-receber?clienteId=cl1&card=VENCIDO&periodo=todos"],
      ["contratos", "2 contratos ativos", "/contratos?clienteId=cl1&status=ATIVO"],
      ["aReceber", "A receber em 30 dias · R$ 1.200,00", null],
    ]);
  });
});

describe("Consultar CNPJ", () => {
  const CNPJ = { nome: "Termofrio Engenharia Ltda", nomeFantasia: "Termofrio", optanteSimples: true };
  const simplesMarcado = () => $$("[data-secao-fiscal] [role='radio']").find((b) => b.getAttribute("aria-checked") === "true")?.textContent?.trim();

  it("H06: cliente que já existe mantém o nome fantasia e o Simples já preenchidos", async () => {
    rotas["GET /api/cnpj/11222333000181"] = { corpo: CNPJ };
    await montar({ initialData: CLIENTE });
    await clicar($("[data-consultar-cnpj]"));
    expect(valor("nomeFantasia")).toBe("Santa Luzia");
    if (!$("[data-secao-fiscal]")) await clicar($("[data-secao-fiscal-toggle]"));
    expect(simplesMarcado()).toBe("Não");
  });

  it("H06: com o fantasia vazio e o Simples nunca informado, a consulta preenche", async () => {
    rotas["GET /api/cnpj/11222333000181"] = { corpo: CNPJ };
    await montar({ initialData: { ...CLIENTE, nomeFantasia: "", optanteSimples: null } });
    await clicar($("[data-consultar-cnpj]"));
    expect(valor("nomeFantasia")).toBe("Termofrio");
    expect(simplesMarcado()).toBe("Sim");
  });

  it("H19: sem os 14 dígitos, ou com dígito errado, avisa e não consulta", async () => {
    await montar({});
    await digitar($('input[name="cpfCnpj"]'), "11.222.333/0001");
    await clicar($("[data-consultar-cnpj]"));
    expect(txt($('[role="alert"]'))).toBe("Informe os 14 dígitos do CNPJ.");
    await digitar($('input[name="cpfCnpj"]'), "11.222.333/0001-82");
    await clicar($("[data-consultar-cnpj]"));
    expect(txt($('[role="alert"]'))).toBe("CNPJ inválido: confira os dígitos.");
    expect(chamadas.some((c) => c.url.startsWith("/api/cnpj"))).toBe(false);
  });

  it("H21: trocar para pessoa física depois da consulta destrava o nome", async () => {
    rotas["GET /api/cnpj/11222333000181"] = { corpo: CNPJ };
    await montar({});
    await digitar($('input[name="cpfCnpj"]'), "11.222.333/0001-81");
    await clicar($("[data-consultar-cnpj]"));
    expect(($('input[name="nome"]') as HTMLInputElement).readOnly).toBe(true);
    await escolher($('select[name="tipoPessoa"]'), "FISICA");
    expect(($('input[name="nome"]') as HTMLInputElement).readOnly).toBe(false);
  });
});

describe("H11 — sair sem salvar", () => {
  it("Cancelar com alteração pergunta antes de sair (é link, o aviso vale)", async () => {
    await montar({ initialData: CLIENTE }, undefined, true);
    await digitar($('input[name="nomeFantasia"]'), "Outro nome");
    await clicar($("a[data-cancelar-cliente]"));
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Sair sem salvar?" }));
    expect(nav.push).toEqual([]);
  });

  it("Salvar e continuar: depois de salvo, sair não pergunta (fechar a aba não avisa)", async () => {
    rotas["PUT /api/clientes/cl1"] = { corpo: { id: "cl1" } };
    await montar({ initialData: CLIENTE }, undefined, true);
    await digitar($('input[name="nomeFantasia"]'), "Outro nome");
    const antes = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(antes);
    expect(antes.defaultPrevented).toBe(true);
    await clicar($("[data-salvar-continuar]"));
    expect(chamadas.some((c) => c.metodo === "PUT" && c.url === "/api/clientes/cl1")).toBe(true);
    const depois = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(depois);
    expect(depois.defaultPrevented).toBe(false);
  });
});

describe("H10 — endereços do cliente novo", () => {
  async function montarLocais(iniciais: any[], principalNoCadastro = false) {
    const { UnidadesLocal } = await import("@/components/forms/unidades-local");
    function Caixa() {
      const [us, setUs] = useState(iniciais);
      return createElement(UnidadesLocal, { unidades: us, onChange: setUs, principalNoCadastro });
    }
    await render(createElement(Caixa));
  }
  const u = (id: string, nome: string, principal: boolean) => ({ _tempId: id, nome, principal, logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "", latitude: null, longitude: null, telefone: "", observacoes: "" });
  const lista = () => $$("[data-endereco]").map((li) => [txt($("[data-endereco-nome]", li)), !!$("[data-endereco-principal]", li)]);

  it("o primeiro endereço não vem com o nome \"Principal\" (o servidor já cria o Principal)", async () => {
    await montarLocais([]);
    await clicar($("[data-novo-endereco]"));
    expect((caixa.querySelector('input[placeholder="Ex: Matriz, Filial, Depósito"]') as HTMLInputElement).value).toBe("");
  });

  it("Excluir o principal: sai da lista e o próximo vira o principal", async () => {
    await montarLocais([u("a", "Matriz", true), u("b", "Depósito", false), u("c", "Filial", false)]);
    await clicar($('[data-excluir-endereco="a"]'));
    expect(lista()).toEqual([["Depósito", true], ["Filial", false]]);
    await clicar($('[data-excluir-endereco="b"]'));
    expect(lista()).toEqual([["Filial", true]]);
  });

  it("com o endereço principal no cadastro, Excluir também tira o local que tinha ficado como principal", async () => {
    await montarLocais([u("a", "Matriz", true)], true);
    await clicar($('[data-excluir-endereco="a"]'));
    expect($$("[data-endereco]")).toEqual([]);
  });
});

describe("H20 — Tornar principal que falha", () => {
  it("mostra o erro do servidor (e não troca o principal)", async () => {
    rotas["PUT /api/unidades/u2"] = { status: 400, corpo: { erro: "Endereço inativo não pode ser o principal." } };
    await montar({ initialData: CLIENTE, abaInicial: "enderecos" });
    await clicar($('[data-tornar-principal="u2"]'));
    expect(txt($("[data-erro-enderecos]"))).toBe("Endereço inativo não pode ser o principal.");
    expect($('[data-endereco="u1"] [data-endereco-principal]')).toBeTruthy();
  });
});
