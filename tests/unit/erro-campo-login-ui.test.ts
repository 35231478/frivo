// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — login e senha do escritório (e do app do técnico, que usa o mesmo Meu perfil):
 *  - login: e-mail mal digitado/senha curta ficam no CAMPO (borda, mensagem abaixo, aria) com foco no 1º;
 *    e-mail ou senha errados continuam na FAIXA (não diz qual, para não revelar se a conta existe);
 *  - esqueci minha senha: e-mail inválido no campo; some ao corrigir; o limite do servidor na faixa;
 *  - definir senha / troca obrigatória / Meu perfil › Segurança: senha fraca na nova, confirmação diferente
 *    na confirmação, e o erro do servidor ("Senha atual incorreta.", { campos }) cai no campo certo.
 *  - as rotas devolvem { erro, campos } sem perder o `erro` de sempre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";

const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp,
  usePathname: () => "/login",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: () => {}, refresh: () => {} }),
}));
const auth = vi.hoisted(() => ({ resultado: {} as any, chamadas: [] as any[] }));
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(async (...a: any[]) => { auth.chamadas.push(a); return auth.resultado; }),
  signOut: vi.fn(), useSession: () => ({ update: async () => {} }),
}));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<typeof import("@/components/ui/avisos")>()), toast: () => {} }));

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
async function digitar(el: HTMLInputElement | null, valor: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}
const sair = async (el: Element | null) => { await act(async () => { el!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); };
async function enviar() {
  await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); };

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  nav.sp = new URLSearchParams(); nav.push = [];
  auth.resultado = { ok: true }; auth.chamadas = [];
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

describe("login", () => {
  const montarLogin = async () => { const { LoginForm } = await import("@/components/auth/login-form"); await montar(createElement(LoginForm)); };
  const email = () => $<HTMLInputElement>('input[type="email"]')!;
  const senha = () => $<HTMLInputElement>('input[autocomplete="current-password"]')!;

  it("e-mail mal digitado e senha curta: cada um no seu campo, com foco no 1º; nada vai ao servidor", async () => {
    await montarLogin();
    await digitar(email(), "ana@");
    await digitar(senha(), "123");
    await enviar();
    expect(auth.chamadas).toEqual([]);
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(erroDo(email())).toBe("E-mail inválido");
    expect(senha().getAttribute("aria-invalid")).toBe("true");
    expect(erroDo(senha())).toBe("Senha deve ter pelo menos 6 caracteres");
    expect(document.activeElement).toBe(email());
    // o rótulo aponta para o campo (o "Esqueci minha senha" fica fora dele)
    expect(caixa.querySelector<HTMLLabelElement>(`label[for="${senha().id}"]`)?.textContent).toBe("Senha");
    expect($('a[href="/esqueci-senha"]')).toBeTruthy();
  });

  it("corrigiu, o erro some sem esperar o próximo Entrar", async () => {
    await montarLogin();
    await digitar(email(), "ana@");
    await digitar(senha(), "Senha-antiga1");
    await enviar();
    expect(email().getAttribute("aria-invalid")).toBe("true");
    await digitar(email(), "ana@x.com");
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(erroDo(email())).toBeNull();
  });

  it("e-mail ou senha errados: continua na FAIXA (não marca um campo, não diz qual errou)", async () => {
    await montarLogin();
    await digitar(email(), "ana@x.com");
    await digitar(senha(), "errada-1");
    auth.resultado = { error: "CredentialsSignin", code: "credentials" };
    await enviar();
    expect(faixa()).toBe("E-mail ou senha inválidos.");
    expect($("[data-resumo-erros]")!.getAttribute("role")).toBe("alert");
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(senha().getAttribute("aria-invalid")).toBeNull();
  });
});

describe("esqueci minha senha", () => {
  it("e-mail inválido no campo (foco nele); corrigiu, some; o limite do servidor vai para a faixa", async () => {
    const { EsqueciSenhaForm } = await import("@/components/auth/esqueci-senha-form");
    await montar(createElement(EsqueciSenhaForm));
    const campo = $<HTMLInputElement>('input[type="email"]')!;
    await digitar(campo, "nao-e-email");
    await enviar();
    expect(chamadas).toEqual([]);
    expect(erroDo(campo)).toBe("Informe um e-mail válido.");
    expect(document.activeElement).toBe(campo);
    await digitar(campo, "ana@x.com");
    expect(campo.getAttribute("aria-invalid")).toBeNull();
    rotas["POST /api/publico/esqueci-senha"] = { status: 429, json: { erro: "Muitos pedidos seguidos. Aguarde 60 min e tente de novo." } };
    await enviar();
    expect(faixa()).toBe("Muitos pedidos seguidos. Aguarde 60 min e tente de novo.");
    expect(campo.getAttribute("aria-invalid")).toBeNull();
  });

  it("formato ao sair do campo: não acusa enquanto digita, acusa ao sair", async () => {
    const { EsqueciSenhaForm } = await import("@/components/auth/esqueci-senha-form");
    await montar(createElement(EsqueciSenhaForm));
    const campo = $<HTMLInputElement>('input[type="email"]')!;
    await digitar(campo, "ana@x");
    expect(campo.getAttribute("aria-invalid")).toBeNull();
    await sair(campo);
    expect(erroDo(campo)).toBe("E-mail inválido: confira o endereço.");
  });
});

describe("definir senha pelo link", () => {
  it("senha fraca na Nova senha; confirmação diferente na Confirme", async () => {
    nav.sp = new URLSearchParams("token=abc.def");
    rotas["GET /api/publico/definir-senha"] = { json: { nome: "Ana Souza", email: "ana@x.com", finalidade: "recuperacao" } };
    const { DefinirSenhaForm } = await import("@/components/auth/definir-senha-form");
    await montar(createElement(DefinirSenhaForm));
    const [senha, confirmar] = [...caixa.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]')];
    await digitar(senha, "abcdefgh");
    await enviar();
    expect(erroDo(senha)).toBe("A senha precisa ter pelo menos um número.");
    expect(document.activeElement).toBe(senha);
    await digitar(senha, "Nova-senha9");
    expect(senha.getAttribute("aria-invalid")).toBeNull();
    await digitar(confirmar, "Nova-senha8");
    await enviar();
    expect(erroDo(confirmar)).toBe("A confirmação não confere com a senha.");
    expect(document.activeElement).toBe(confirmar);
  });
});

describe("troca obrigatória do 1º acesso", () => {
  it("o erro do servidor (senha recebida errada) cai na Senha recebida, com foco", async () => {
    rotas["PATCH /api/perfil/senha"] = { status: 400, json: { erro: "Senha atual incorreta.", campos: { senhaAtual: "Senha atual incorreta." } } };
    const { TrocarSenhaObrigatoriaForm } = await import("@/components/auth/trocar-senha-obrigatoria-form");
    await montar(createElement(TrocarSenhaObrigatoriaForm, { nome: "Ana Souza", email: "ana@x.com", destino: "/dashboard" }));
    await digitar($("[data-senha-atual]") as HTMLInputElement, "errada-1");
    await digitar($("[data-senha-nova]") as HTMLInputElement, "Nova-senha9");
    await digitar($("[data-senha-confirmar]") as HTMLInputElement, "Nova-senha9");
    await enviar();
    const atual = $("[data-senha-atual]")!;
    expect(atual.getAttribute("aria-invalid")).toBe("true");
    expect(erroDo(atual)).toBe("Senha atual incorreta.");
    expect(document.activeElement).toBe(atual);
    expect(faixa()).toBe("Senha atual incorreta.");
    expect($("[data-senha-nova]")!.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("Meu perfil › Segurança", () => {
  async function abrir() {
    const { PerfilClient } = await import("@/components/perfil/perfil-client");
    rotas["GET /api/perfil/comissoes"] = { json: { ativo: false } };
    await montar(createElement(PerfilClient as any, {
      initial: { nome: "Ana Souza", email: "ana@x.com", telefone: "", avatar: null, perfilNome: "Admin", cargo: null, empresaNome: "Polar Demo", ultimoAcesso: null },
      abaPedida: "seguranca",
    }));
  }
  const campos = () => [...caixa.querySelectorAll<HTMLInputElement>("input[type='password']")];
  const trocar = () => clicar($("[data-trocar-senha]"));

  it("confirmação diferente fica na Confirmar nova senha; a senha atual errada (servidor) na Senha atual", async () => {
    await abrir();
    const [atual, nova, confirmar] = campos();
    await digitar(atual, "Antiga-senha1");
    await digitar(nova, "Nova-senha9");
    await digitar(confirmar, "Nova-senha8");
    await trocar();
    expect(erroDo(confirmar)).toBe("A confirmação da nova senha não coincide.");
    expect(document.activeElement).toBe(confirmar);
    expect(chamadas.filter((c) => c.url === "/api/perfil/senha")).toEqual([]);

    await digitar(confirmar, "Nova-senha9");
    expect(confirmar.getAttribute("aria-invalid")).toBeNull();
    rotas["PATCH /api/perfil/senha"] = { status: 400, json: { erro: "Senha atual incorreta.", campos: { senhaAtual: "Senha atual incorreta." } } };
    await trocar();
    expect(erroDo(atual)).toBe("Senha atual incorreta.");
    expect(document.activeElement).toBe(atual);
    expect($("[data-erro-perfil]")!.textContent).toBe("Senha atual incorreta.");
  });
});

describe("as rotas respondem { erro, campos } sem perder o `erro` de sempre", () => {
  it("definir senha: a confirmação diferente vem no campo `confirmar`", async () => {
    const { POST } = await import("@/app/api/publico/definir-senha/route");
    const r = await POST(new NextRequest("http://x.test/api/publico/definir-senha", { method: "POST", body: JSON.stringify({ token: "0123456789abc", senha: "Nova-senha9", confirmar: "Outra-senha9" }) }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: "A confirmação não confere com a senha.", campos: { confirmar: "A confirmação não confere com a senha." } });
  });
  it("definir senha: senha fraca vem com o mesmo `erro` (a 1ª mensagem) e o campo `senha`", async () => {
    const { POST } = await import("@/app/api/publico/definir-senha/route");
    const r = await POST(new NextRequest("http://x.test/api/publico/definir-senha", { method: "POST", body: JSON.stringify({ token: "0123456789abc", senha: "curta1", confirmar: "curta1" }) }));
    const j = await r.json();
    expect(j.erro).toBe("A senha precisa ter pelo menos 8 caracteres.");
    expect(j.campos).toEqual({ senha: "A senha precisa ter pelo menos 8 caracteres." });
  });
});
