// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — portal do cliente:
 *  - entrar: e-mail mal digitado/senha vazia no CAMPO antes de enviar (nada vai ao servidor); e-mail ou senha
 *    errados (a resposta do servidor) continuam na FAIXA;
 *  - esqueci/definir/trocar a senha: cada recusa no campo dela, com foco; some ao corrigir; o erro do servidor
 *    ({ erro, campos }) cai no campo certo;
 *  - novo chamado: descrição curta no campo; a unidade recusada pelo servidor marca o seletor de unidade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp, usePathname: () => "/portal",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: () => {}, refresh: () => {} }),
}));
const acao = vi.hoisted(() => ({ estado: {} as { erro?: string; email?: string }, chamadas: 0 }));
vi.mock("@/app/(portal)/portal/actions", () => ({
  portalLogin: vi.fn(async () => { acao.chamadas++; return acao.estado; }),
  portalLogout: vi.fn(async () => {}),
}));

let rotas: Record<string, { status?: number; json: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let root: Root; let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const faixa = () => ($("[data-resumo-erros]")?.textContent ?? "").trim();
const erroDo = (el: Element | null) => {
  const id = el?.getAttribute("aria-describedby");
  return id ? (id.split(" ").map((i) => document.getElementById(i)).find((p) => p?.hasAttribute("data-erro-campo"))?.textContent ?? null) : null;
};
async function montar(el: React.ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await flush();
}
async function digitar(el: HTMLInputElement | HTMLTextAreaElement | null, valor: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}
async function enviar() {
  await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  nav.sp = new URLSearchParams(); nav.push = [];
  acao.estado = {}; acao.chamadas = 0;
  chamadas.length = 0; rotas = {};
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = rotas[`${metodo} ${url.split("?")[0]}`] ?? { json: {} };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

describe("portal: entrar", () => {
  const montarLogin = async () => { const { PortalLoginForm } = await import("@/components/portal/portal-login-form"); await montar(createElement(PortalLoginForm)); };

  it("e-mail mal digitado e senha vazia: no campo, com foco no 1º; nada vai ao servidor", async () => {
    await montarLogin();
    const email = $<HTMLInputElement>('input[name="email"]')!;
    await digitar(email, "paula@");
    await enviar();
    expect(acao.chamadas).toBe(0);
    expect(erroDo(email)).toBe("E-mail inválido: confira o endereço.");
    expect(erroDo($('input[name="senha"]'))).toBe("Informe a senha.");
    expect(document.activeElement).toBe(email);
    expect(faixa()).toContain("2 campos para corrigir");
    await digitar(email, "paula@clinica.test");
    expect(email.getAttribute("aria-invalid")).toBeNull();
  });

  it("e-mail ou senha errados (resposta do servidor): na FAIXA, sem marcar campo", async () => {
    acao.estado = { erro: "E-mail ou senha inválidos.", email: "paula@clinica.test" };
    await montarLogin();
    await digitar($<HTMLInputElement>('input[name="email"]'), "paula@clinica.test");
    await digitar($<HTMLInputElement>('input[name="senha"]'), "errada-1");
    await enviar();
    expect(acao.chamadas).toBe(1);
    expect(faixa()).toBe("E-mail ou senha inválidos.");
    expect($('input[name="email"]')!.getAttribute("aria-invalid")).toBeNull();
    expect($('input[name="senha"]')!.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("portal: senhas", () => {
  it("esqueci: e-mail inválido no campo; o limite do servidor na faixa", async () => {
    const { PortalEsqueciSenhaForm } = await import("@/components/portal/portal-esqueci-senha-form");
    await montar(createElement(PortalEsqueciSenhaForm));
    const campo = $<HTMLInputElement>('input[type="email"]')!;
    await enviar();
    expect(erroDo(campo)).toBe("Informe um e-mail válido.");
    expect(document.activeElement).toBe(campo);
    await digitar(campo, "paula@clinica.test");
    expect(campo.getAttribute("aria-invalid")).toBeNull();
    rotas["POST /api/portal/esqueci-senha"] = { status: 429, json: { erro: "Muitos pedidos seguidos. Aguarde 30 min e tente de novo." } };
    await enviar();
    expect(faixa()).toBe("Muitos pedidos seguidos. Aguarde 30 min e tente de novo.");
  });

  it("definir pelo link: senha fraca na Nova senha; as duas diferentes na Repita; a regra do servidor no campo `senha`", async () => {
    nav.sp = new URLSearchParams("token=abc.def");
    const { PortalDefinirSenhaForm } = await import("@/components/portal/portal-definir-senha-form");
    await montar(createElement(PortalDefinirSenhaForm));
    const [senha, repetir] = [...caixa.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    await digitar(senha, "abcdefgh");
    await enviar();
    expect(erroDo(senha)).toBe("A senha precisa ter pelo menos um número.");
    await digitar(senha, "Nova-senha9");
    await digitar(repetir, "Nova-senha8");
    await enviar();
    expect(erroDo(repetir)).toBe("As senhas não são iguais.");
    expect(document.activeElement).toBe(repetir);
    await digitar(repetir, "Nova-senha9");
    rotas["POST /api/portal/definir-senha"] = { status: 400, json: { erro: "Senha fraca demais.", campos: { senha: "Senha fraca demais." } } };
    await enviar();
    expect(erroDo(senha)).toBe("Senha fraca demais.");
  });

  it("troca do 1º acesso: a senha recebida errada (servidor) cai na Senha recebida, e a faixa repete", async () => {
    rotas["PATCH /api/portal/senha"] = { status: 400, json: { erro: "Senha recebida incorreta.", campos: { senhaAtual: "Senha recebida incorreta." } } };
    const { PortalTrocarSenhaForm } = await import("@/components/portal/portal-trocar-senha-form");
    await montar(createElement(PortalTrocarSenhaForm, { nome: "Paula Fictícia", email: "paula@clinica.test" }));
    await digitar($("[data-senha-atual]") as HTMLInputElement, "errada-1");
    await digitar($("[data-senha-nova]") as HTMLInputElement, "Nova-senha9");
    await digitar($("[data-senha-confirmar]") as HTMLInputElement, "Nova-senha9");
    await enviar();
    const atual = $("[data-senha-atual]")!;
    expect(erroDo(atual)).toBe("Senha recebida incorreta.");
    expect(document.activeElement).toBe(atual);
    expect(($("[data-erro-troca]")?.textContent ?? "").trim()).toBe("Senha recebida incorreta.");
    await digitar(atual as HTMLInputElement, "Abc23456defg");
    expect(atual.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("portal: novo chamado", () => {
  const montarChamado = async () => {
    const { ChamadoForm } = await import("@/components/portal/chamado-form");
    await montar(createElement(ChamadoForm, { unidades: [{ id: "u1", nome: "Matriz" }], equipamentos: [], tiposProblema: ["Não gela"] }));
  };

  it("descrição curta: no campo, com foco; corrigiu, some", async () => {
    await montarChamado();
    const descricao = caixa.querySelector("textarea")!;
    await digitar(descricao, "ruim");
    await enviar();
    expect(chamadas).toEqual([]);
    expect(descricao.getAttribute("aria-invalid")).toBe("true");
    expect(erroDo(descricao)).toBe("Descreva o problema com mais detalhes.");
    expect(document.activeElement).toBe(descricao);
    await digitar(descricao, "Ar da sala 2 não gela");
    expect(descricao.getAttribute("aria-invalid")).toBeNull();
  });

  it("unidade recusada pelo servidor: marca o seletor da unidade", async () => {
    rotas["POST /api/portal/chamados"] = { status: 400, json: { erro: "Unidade inválida", campos: { unidadeId: "Unidade inválida" } } };
    await montarChamado();
    await digitar(caixa.querySelector("textarea"), "Ar da sala 2 não gela");
    await enviar();
    const seletor = $("[data-unidade] [data-busca-select]") ?? $("[data-unidade]")!.querySelector("button")!;
    expect(seletor.getAttribute("aria-invalid")).toBe("true");
    expect(erroDo(seletor)).toBe("Unidade inválida");
    expect(document.activeElement).toBe(seletor);
  });
});
