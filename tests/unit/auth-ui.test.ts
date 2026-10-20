// @vitest-environment happy-dom
/**
 * Autenticação — Fase A: as telas de verdade num DOM (login, "Esqueci minha senha", definir senha
 * pelo link de recuperação, troca no perfil). Prova:
 *  - login: "Manter conectado" desmarcado por padrão, explica a duração, manda a escolha ao Auth.js
 *    e o aparelho lembra a última; link "Esqueci minha senha"; mensagem de bloqueio com os minutos;
 *  - esqueci: manda o e-mail e mostra a mensagem genérica que veio do servidor; erro de limite;
 *  - definir senha (recuperação): texto de "nova senha", requisitos ao vivo, recusa senha fraca;
 *    link vencido mostra "Pedir um novo link".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp,
  usePathname: () => "/login",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: () => {}, refresh: () => {} }),
}));
const auth = vi.hoisted(() => ({ resultado: {} as any, chamadas: [] as any[] }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn(async (...a: any[]) => { auth.chamadas.push(a); return auth.resultado; }) }));

let rotas: Record<string, { status?: number; json: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

let root: Root;
let caixa: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const texto = () => caixa.textContent ?? "";

async function montar(el: () => Promise<React.ReactElement>) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  const elemento = await el();
  await act(async () => { root.render(elemento); });
  await flush();
}
async function clicar(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
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
async function enviar() {
  await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  nav.sp = new URLSearchParams();
  nav.push = [];
  auth.resultado = { ok: true }; auth.chamadas = [];
  chamadas.length = 0;
  rotas = {};
  localStorage.clear();
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = rotas[`${metodo} ${url.split("?")[0]}`];
    if (!r) throw new Error(`rota não simulada: ${metodo} ${url}`);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

const loginForm = async () => { const { LoginForm } = await import("@/components/auth/login-form"); return createElement(LoginForm); };
const lembrar = () => $<HTMLInputElement>('input[name="lembrar"]')!;

describe("login", () => {
  it("“Manter conectado” vem desmarcado e explica a duração; marcado manda lembrar=true", async () => {
    await montar(loginForm);
    expect(lembrar().checked).toBe(false);
    expect(texto()).toMatch(/a sessão vale por 1 dia/);
    await clicar(lembrar());
    expect(texto()).toMatch(/30 dias neste aparelho/);

    await digitar($('input[type="email"]'), "ana@x.com");
    await digitar($('input[autocomplete="current-password"]'), "Senha-antiga1");
    await enviar();
    expect(auth.chamadas).toEqual([["credentials", { email: "ana@x.com", senha: "Senha-antiga1", lembrar: "true", redirect: false }]]);
    expect(nav.push).toEqual(["/dashboard"]);
    expect(localStorage.getItem("frivo:manter-conectado")).toBe("1");
  });

  it("desmarcado manda lembrar=false; o aparelho lembra a última escolha", async () => {
    localStorage.setItem("frivo:manter-conectado", "1");
    await montar(loginForm);
    expect(lembrar().checked).toBe(true);
    await clicar(lembrar());
    await digitar($('input[type="email"]'), "ana@x.com");
    await digitar($('input[autocomplete="current-password"]'), "Senha-antiga1");
    await enviar();
    expect(auth.chamadas[0][1].lembrar).toBe("false");
    expect(localStorage.getItem("frivo:manter-conectado")).toBe("0");
  });

  it("senha errada: mensagem genérica; bloqueado: diz quantos minutos e sugere “Esqueci minha senha”", async () => {
    await montar(loginForm);
    await digitar($('input[type="email"]'), "ana@x.com");
    await digitar($('input[autocomplete="current-password"]'), "errada-1");
    auth.resultado = { error: "CredentialsSignin", code: "credentials" };
    await enviar();
    expect(texto()).toMatch(/E-mail ou senha inválidos\./);
    auth.resultado = { error: "CredentialsSignin", code: "bloqueado-7" };
    await enviar();
    expect(texto()).toMatch(/Muitas tentativas sem sucesso.*aguarde 7 min.*Esqueci minha senha/);
    expect(nav.push).toEqual([]);
  });

  it("tem o link “Esqueci minha senha”", async () => {
    await montar(loginForm);
    expect($('a[href="/esqueci-senha"]')?.textContent).toMatch(/Esqueci minha senha/);
  });
});

describe("esqueci minha senha", () => {
  const form = async () => { const { EsqueciSenhaForm } = await import("@/components/auth/esqueci-senha-form"); return createElement(EsqueciSenhaForm); };

  it("manda o e-mail e mostra a mensagem genérica do servidor", async () => {
    rotas["POST /api/publico/esqueci-senha"] = { json: { ok: true, mensagem: "Se este e-mail estiver cadastrado, você vai receber…" } };
    await montar(form);
    await digitar($('input[type="email"]'), " ana@x.com ");
    await enviar();
    expect(chamadas).toEqual([{ url: "/api/publico/esqueci-senha", metodo: "POST", corpo: { email: "ana@x.com" } }]);
    expect(texto()).toMatch(/Verifique o seu e-mail/);
    expect(texto()).toMatch(/Se este e-mail estiver cadastrado/);
    expect($('a[href="/login"]')).toBeTruthy();
  });

  it("e-mail inválido nem sai da tela; limite do servidor aparece como erro", async () => {
    await montar(form);
    await digitar($('input[type="email"]'), "nao-e-email");
    await enviar();
    expect(chamadas).toEqual([]);
    expect(texto()).toMatch(/Informe um e-mail válido/);
    rotas["POST /api/publico/esqueci-senha"] = { status: 429, json: { erro: "Muitos pedidos seguidos. Aguarde 60 min e tente de novo." } };
    await digitar($('input[type="email"]'), "ana@x.com");
    await enviar();
    expect(texto()).toMatch(/Aguarde 60 min/);
    expect(texto()).not.toMatch(/Verifique o seu e-mail/);
  });
});

describe("definir senha pelo link de recuperação", () => {
  const form = async () => { const { DefinirSenhaForm } = await import("@/components/auth/definir-senha-form"); return createElement(DefinirSenhaForm); };

  it("texto de nova senha, requisitos ao vivo, recusa senha fraca e salva a forte", async () => {
    nav.sp = new URLSearchParams("token=abc.def");
    rotas["GET /api/publico/definir-senha"] = { json: { nome: "Ana Souza", email: "ana@x.com", finalidade: "recuperacao" } };
    rotas["POST /api/publico/definir-senha"] = { json: { ok: true, email: "ana@x.com" } };
    await montar(form);
    expect(texto()).toMatch(/Criar nova senha/);
    expect(texto()).toMatch(/sessões abertas com a senha antiga são encerradas/);
    const ok = (id: string) => $(`[data-requisito="${id}"]`)!.getAttribute("data-ok");

    const [senha, confirmar] = [...caixa.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]')];
    await digitar(senha, "abcdefgh");
    expect([ok("tamanho"), ok("letra"), ok("numero")]).toEqual(["true", "true", "false"]);
    await digitar(confirmar, "abcdefgh");
    await enviar();
    expect(texto()).toMatch(/pelo menos um número/);
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);

    await digitar(senha, "Nova-senha9");
    expect(ok("numero")).toBe("true");
    await digitar(confirmar, "Nova-senha9");
    await enviar();
    expect(chamadas.at(-1)).toEqual({ url: "/api/publico/definir-senha", metodo: "POST", corpo: { token: "abc.def", senha: "Nova-senha9", confirmar: "Nova-senha9" } });
    expect(nav.push).toEqual(["/login?senha=definida&email=ana%40x.com"]);
  });

  it("link vencido: mostra o erro e “Pedir um novo link”", async () => {
    nav.sp = new URLSearchParams("token=abc.def");
    rotas["GET /api/publico/definir-senha"] = { status: 400, json: { erro: "Este link expirou (vale 60 minutos).", finalidade: "recuperacao" } };
    await montar(form);
    expect(texto()).toMatch(/Este link expirou/);
    expect($('a[href="/esqueci-senha"]')?.textContent).toMatch(/Pedir um novo link/);
  });

  it("convite continua com o texto de convite (sem o link de recuperação)", async () => {
    nav.sp = new URLSearchParams("token=abc.def");
    rotas["GET /api/publico/definir-senha"] = { json: { nome: "Nina Nova", email: "nina@x.com", finalidade: "convite" } };
    await montar(form);
    expect(texto()).toMatch(/Olá, Nina!/);
    expect(texto()).toMatch(/Definir senha e entrar/);
  });
});
