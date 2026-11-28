// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — Clientes › Novo/Editar (o print do Zé): o erro mora no campo.
 *  - CNPJ incompleto + Consultar: o CNPJ ganha borda vermelha, a mensagem logo abaixo (aria-invalid/aria-describedby) e o
 *    foco; a faixa do topo repete o texto (um erro só);
 *  - salvar com mais de um erro: "N campos para corrigir", a aba Dados ganha o ponto vermelho, abre sozinha (estava em
 *    Endereços) e o primeiro campo recebe o foco;
 *  - o erro some assim que a pessoa corrige (sem salvar de novo);
 *  - o erro do servidor (CPF/CNPJ já cadastrado) cai no CNPJ;
 *  - formato ao sair do campo (telefone de cobrança), nunca enquanto digita.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[] }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {} }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp, usePathname: () => "/",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: () => {}, refresh: () => {}, back: () => {} }),
}));

let rotas: Record<string, { status?: number; corpo: unknown }> = {};
let chamadas: { metodo: string; url: string }[] = [];
let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); }
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}
async function sair(el: Element | null) { await act(async () => { el!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await flush(); }
const campo = (nome: string) => $(`input[name="${nome}"]`) as HTMLInputElement;
const mensagemDe = (el: Element) => txt(document.getElementById(el.getAttribute("aria-describedby") ?? "")!);

async function montar(props: Record<string, unknown> = {}) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { ClienteForm } = await import("@/components/forms/cliente-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children: createElement(ClienteForm, props as any) })); });
  await flush();
}

beforeEach(() => {
  nav.sp = new URLSearchParams(); nav.push = []; rotas = {}; chamadas = [];
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ metodo, url });
    const r = rotas[`${metodo} ${url}`];
    return new Response(JSON.stringify(r?.corpo ?? {}), { status: r?.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; });

describe("o print do Zé: CNPJ incompleto", () => {
  it("Consultar: o CNPJ fica marcado (borda vermelha + mensagem abaixo + foco); o rótulo não muda; a faixa repete o texto", async () => {
    await montar();
    await digitar(campo("cpfCnpj"), "11.222.333/0001");
    await clicar($("[data-consultar-cnpj]"));
    const cnpj = campo("cpfCnpj");
    expect(cnpj.getAttribute("aria-invalid")).toBe("true");
    expect(cnpj.className).toContain("border-atrasado");
    expect(mensagemDe(cnpj)).toBe("Informe os 14 dígitos do CNPJ.");
    // a mensagem está DENTRO do campo do CNPJ, logo abaixo do controle
    const bloco = cnpj.closest('[data-campo-nome="cpfCnpj"]')!;
    expect(txt(bloco.querySelector("[data-erro-campo]"))).toBe("Informe os 14 dígitos do CNPJ.");
    expect(bloco.querySelector("label")!.className).not.toContain("atrasado");
    expect(bloco.querySelector("label")!.htmlFor).toBe(cnpj.id);
    expect(document.activeElement).toBe(cnpj);
    expect(txt($("[data-resumo-erros]"))).toBe("Informe os 14 dígitos do CNPJ.");
    expect(chamadas.some((c) => c.url.startsWith("/api/cnpj"))).toBe(false);
  });

  it("o erro some assim que o CNPJ fica certo, sem consultar nem salvar de novo", async () => {
    await montar();
    await digitar(campo("cpfCnpj"), "11.222.333/0001");
    await clicar($("[data-consultar-cnpj]"));
    await digitar(campo("cpfCnpj"), "11.222.333/0001-81");
    expect(campo("cpfCnpj").getAttribute("aria-invalid")).toBeNull();
    expect($("[data-resumo-erros]")).toBeNull();
  });

  it("ao sair do CNPJ incompleto, o formato acusa no campo (enquanto digita, não)", async () => {
    await montar();
    await digitar(campo("cpfCnpj"), "11.222.3");
    expect(campo("cpfCnpj").getAttribute("aria-invalid")).toBeNull();
    await sair(campo("cpfCnpj"));
    expect(campo("cpfCnpj").getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(campo("cpfCnpj"))).toBe("Informe os 14 dígitos do CNPJ.");
  });
});

describe("salvar com erro", () => {
  it("mais de um erro: \"2 campos para corrigir\", a aba Dados ganha o ponto e abre sozinha, o 1º campo recebe o foco", async () => {
    await montar({ abaInicial: "enderecos" });
    const dados = $('[data-aba-painel="geral"]')!;
    expect(dados.className).toContain("hidden");
    await clicar($("[data-salvar-cliente]"));
    const faixa = $("[data-resumo-erros]")!;
    expect(txt(faixa)).toContain("2 campos para corrigir");
    expect([...faixa.querySelectorAll("[data-ir-campo]")].map((b) => b.getAttribute("data-ir-campo"))).toEqual(["cpfCnpj", "nome"]);
    expect(txt($('[data-aba="geral"] [data-erro-aba]'))).toBe("2 erros");
    expect(dados.className).not.toContain("hidden");
    expect(document.activeElement).toBe(campo("cpfCnpj"));
    expect(campo("nome").getAttribute("aria-invalid")).toBe("true");
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
  });

  it("o print do Zé no Salvar: CNPJ incompleto digitado (sem sair do campo) é acusado no CNPJ, com foco, e não envia", async () => {
    await montar();
    await digitar(campo("cpfCnpj"), "11.222.333/0001");
    await digitar(campo("nome"), "Polar Demo Refrigeração");
    await clicar($("[data-salvar-cliente]"));
    expect(campo("cpfCnpj").getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(campo("cpfCnpj"))).toBe("Informe os 14 dígitos do CNPJ.");
    expect(document.activeElement).toBe(campo("cpfCnpj"));
    expect(txt($("[data-resumo-erros]"))).toBe("Informe os 14 dígitos do CNPJ.");
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    // completou certo: some, e o salvar segue
    await digitar(campo("cpfCnpj"), "11.222.333/0001-81");
    expect(campo("cpfCnpj").getAttribute("aria-invalid")).toBeNull();
  });

  it("corrigiu a razão social: o erro dela some na hora (fica só o do CNPJ)", async () => {
    await montar();
    await clicar($("[data-salvar-cliente]"));
    await digitar(campo("nome"), "Polar Demo Refrigeração");
    expect(campo("nome").getAttribute("aria-invalid")).toBeNull();
    expect(campo("cpfCnpj").getAttribute("aria-invalid")).toBe("true");
  });

  it("o servidor recusa o CNPJ já cadastrado: o erro cai no CNPJ, com foco", async () => {
    rotas["POST /api/clientes"] = { status: 409, corpo: { erro: "CPF/CNPJ já cadastrado", campos: { cpfCnpj: "CPF/CNPJ já cadastrado" } } };
    await montar();
    await digitar(campo("cpfCnpj"), "11.222.333/0001-81");
    await digitar(campo("nome"), "Polar Demo Refrigeração");
    await clicar($("[data-salvar-cliente]"));
    expect(chamadas.some((c) => c.metodo === "POST" && c.url === "/api/clientes")).toBe(true);
    const cnpj = campo("cpfCnpj");
    expect(cnpj.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(cnpj)).toBe("CPF/CNPJ já cadastrado");
    expect(document.activeElement).toBe(cnpj);
    expect(txt($("[data-resumo-erros]"))).toBe("CPF/CNPJ já cadastrado");
    expect(nav.push).toEqual([]);
  });

  it("a resposta antiga do zod (detalhes) também cai no campo", async () => {
    rotas["POST /api/clientes"] = { status: 400, corpo: { erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { nome: ["Nome deve ter pelo menos 2 caracteres"] } } } };
    await montar();
    await digitar(campo("cpfCnpj"), "11.222.333/0001-81");
    await digitar(campo("nome"), "Polar");
    await clicar($("[data-salvar-cliente]"));
    expect(campo("nome").getAttribute("aria-invalid")).toBe("true");
    expect(txt($("[data-resumo-erros]"))).toBe("Nome deve ter pelo menos 2 caracteres");
  });

  it("erro que não é de campo (conexão) fica só na faixa, com foco nela", async () => {
    await montar();
    globalThis.fetch = vi.fn(async () => { throw new Error("rede"); }) as any;
    await digitar(campo("cpfCnpj"), "11.222.333/0001-81");
    await digitar(campo("nome"), "Polar Demo Refrigeração");
    await clicar($("[data-salvar-cliente]"));
    expect(txt($("[data-resumo-erros]"))).toBe("Erro de conexão.");
    expect(caixa.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(document.activeElement).toBe($("[data-resumo-erros]"));
  });
});

describe("formato ao sair do campo", () => {
  it("WhatsApp de cobrança incompleto: acusa ao sair; corrigiu, some", async () => {
    await montar();
    const wpp = campo("whatsappFaturamento");
    await digitar(wpp, "(19) 9999");
    expect(wpp.getAttribute("aria-invalid")).toBeNull();
    await sair(wpp);
    expect(wpp.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(wpp)).toBe("Telefone incompleto: informe o DDD e o número.");
    await digitar(wpp, "(19) 99999-8888");
    expect(wpp.getAttribute("aria-invalid")).toBeNull();
  });
});
