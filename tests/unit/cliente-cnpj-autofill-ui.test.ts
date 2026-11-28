// @vitest-environment happy-dom
/**
 * Consulta de CNPJ no cadastro de cliente NOVO: a mesma resposta já traz o endereço completo e o
 * contato — e eles são aproveitados (sem 2ª chamada ao ViaCEP). Leva H: o endereço vai para os CAMPOS do
 * endereço principal (não vira card); um contato preenchido; não duplica contato já existente.
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

const CNPJ_RESP = {
  nome: "Termofrio Engenharia Ltda", nomeFantasia: "Termofrio", email: "contato@termofrio.com",
  telefone: "(62) 3333-4444", endereco: "Avenida Central", numero: "1000", complemento: "Sala 2",
  bairro: "Setor Central", cidade: "Goiânia", estado: "GO", cep: "74000-000",
};

beforeEach(() => {
  nav.sp = new URLSearchParams();
  rotas = { "GET /api/cnpj/11222333000181": CNPJ_RESP };
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const r = rotas[`${metodo} ${String(u)}`];
    return new Response(JSON.stringify(r ?? (metodo === "GET" ? {} : {})), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

async function consultar() {
  await digitar($('input[name="cpfCnpj"]'), "11.222.333/0001-81");
  await clicar($$("button").find((b) => b.textContent!.includes("Consultar")));
}

// Selos "Principal" dos contatos (fora a frase da aba Endereços que avisa do local "Principal" automático)
const contarPrincipais = () => {
  const aviso = caixa.querySelector("[data-principal-automatico]")?.textContent ?? "";
  return (((caixa.textContent ?? "").replace(aviso, "")).match(/Principal/g) ?? []).length;
};
const valor = (nome: string) => ($(`[name="${nome}"]`) as HTMLInputElement | null)?.value;

describe("Autofill do CNPJ no cliente novo", () => {
  it("Consultar preenche razão social, o endereço principal (em campos) e um contato", async () => {
    await montar();
    expect(contarPrincipais()).toBe(0); // nada ainda
    await consultar();
    const corpo = caixa.textContent ?? "";
    // razão social preenchida
    expect(($('input[name="nome"]') as HTMLInputElement).value).toBe("Termofrio Engenharia Ltda");
    // Leva H (mudança intencional): o endereço da consulta vai para os campos do endereço principal — não
    // vira card "Matriz" nem local; ao salvar, o servidor cria o local "Principal" com ele
    expect([valor("cep"), valor("endereco"), valor("numero"), valor("complemento"), valor("bairro"), valor("cidade"), valor("estado")])
      .toEqual(["74000-000", "Avenida Central", "1000", "Sala 2", "Setor Central", "Goiânia", "GO"]);
    expect(corpo).not.toContain("Matriz");
    expect(caixa.querySelector("[data-endereco]")).toBeNull();
    expect(caixa.querySelector("[data-principal-automatico]")).toBeTruthy();
    // só o contato principal da consulta → 1 selo "Principal"
    expect(contarPrincipais()).toBe(1);
    // e o contato leva o nome da consulta (card colapsado mostra o nome + selo Principal)
    const botaoContato = $$("button").find((b) => /Termofrio Engenharia Ltda/.test(b.textContent ?? ""));
    expect(botaoContato).toBeTruthy();
    // consulta silenciosa: sem aviso de sucesso, sem linha verde da Receita Federal, sem dica sob o CNPJ
    expect(caixa.querySelector("[data-cnpj-encontrado]")).toBeFalsy();
    expect(corpo).not.toContain("Dados encontrados na Receita Federal");
    expect(corpo).not.toContain("Receita Federal:");
    expect(corpo).not.toContain("clique em Consultar para preencher");
    // status financeiro só no cabeçalho — não repete numa seção de Dados gerais
    expect(corpo).not.toContain("Calculado automaticamente pelas contas a receber");
  });

  it("não duplica: consultar duas vezes não cria contato repetido", async () => {
    await montar();
    await consultar();
    expect(contarPrincipais()).toBe(1);
    await consultar();
    // 2ª consulta: contato de mesmo e-mail já existe → nada novo
    expect(contarPrincipais()).toBe(1);
  });
});
