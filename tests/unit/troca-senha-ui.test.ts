// @vitest-environment happy-dom
/**
 * "Troca de senha no 1º acesso" — a tela, num DOM de verdade (API simulada):
 *  - o formulário confere antes de enviar (senha recebida, regra forte, confirmação, diferente da recebida);
 *  - envia para a mesma troca de Meu perfil (senha atual + nova) e, deu certo, segue para o trabalho;
 *  - o erro do servidor aparece e a pessoa continua na tela; "Sair" encerra a sessão;
 *  - a página: com a troca pendente mostra o formulário; sem ela, volta ao painel ou ao app do técnico.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const sair = vi.hoisted(() => vi.fn());
vi.mock("next-auth/react", () => ({ signOut: sair }));
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: unknown };
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const irPara = vi.fn();

beforeEach(() => {
  chamadas.length = 0; irPara.mockClear(); sair.mockClear();
  resposta = { status: 200, corpo: { ok: true } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
  vi.stubGlobal("location", { ...window.location, assign: irPara });
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function digitar(sel: string, v: string) {
  const el = $(sel)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function enviar() { await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await esperar(); }
async function montar(destino = "/dashboard") {
  const { TrocarSenhaObrigatoriaForm } = await import("@/components/auth/trocar-senha-obrigatoria-form");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(TrocarSenhaObrigatoriaForm, { nome: "Beatriz Fictícia", email: "beatriz@ficticio.test", destino })); });
}
async function preencher(atual: string, nova: string, confirmar = nova) {
  await digitar("[data-senha-atual]", atual); await digitar("[data-senha-nova]", nova); await digitar("[data-senha-confirmar]", confirmar);
}

describe("o formulário", () => {
  it("cumprimenta pelo primeiro nome e explica em uma linha", async () => {
    await montar();
    expect(txt($("h2"))).toBe("Crie a sua senha, Beatriz");
    expect(txt($("[data-trocar-senha-obrigatoria] p"))).toBe("A senha de beatriz@ficticio.test foi definida por outra pessoa. Troque-a para continuar.");
  });

  it("confere antes de enviar: senha recebida, regra forte, confirmação e diferente da recebida", async () => {
    await montar();
    await enviar();
    expect(txt($("[role=alert]"))).toBe("Informe a senha recebida.");
    await preencher("Recebida-123", "curta");
    await enviar();
    expect(txt($("[role=alert]"))).toMatch(/8 caracteres/);
    await preencher("Recebida-123", "Minha-senha9", "Outra-senha9");
    await enviar();
    expect(txt($("[role=alert]"))).toBe("A confirmação não confere com a nova senha.");
    await preencher("Recebida-123", "Recebida-123");
    await enviar();
    expect(txt($("[role=alert]"))).toBe("A nova senha precisa ser diferente da recebida.");
    expect(chamadas).toEqual([]);
  });

  it("envia para a troca de Meu perfil e, deu certo, segue para o trabalho (o app do técnico, aqui)", async () => {
    await montar("/tecnico");
    await preencher("Recebida-123", "Minha-senha9");
    await enviar();
    expect(chamadas).toEqual([{ url: "/api/perfil/senha", metodo: "PATCH", corpo: { senhaAtual: "Recebida-123", novaSenha: "Minha-senha9", confirmar: "Minha-senha9" } }]);
    expect(irPara).toHaveBeenCalledWith("/tecnico");
  });

  it("erro do servidor (senha recebida errada): aparece e a pessoa fica na tela", async () => {
    resposta = { status: 400, corpo: { erro: "Senha atual incorreta." } };
    await montar();
    await preencher("Errada-123", "Minha-senha9");
    await enviar();
    expect(txt($("[role=alert]"))).toBe("Senha atual incorreta.");
    expect(irPara).not.toHaveBeenCalled();
  });

  it("Sair encerra a sessão e volta ao login; os botões têm área de toque ≥ 44px", async () => {
    await montar();
    await act(async () => { $("[data-sair]")!.click(); });
    expect(sair).toHaveBeenCalledWith({ callbackUrl: "/login" });
    for (const b of ["[data-salvar-senha]", "[data-sair]"]) expect($(b)!.className).toMatch(/min-h-\[44px\]/);
  });
});

describe("a página /trocar-senha", () => {
  const pagina = async () => (await import("@/app/(auth)/trocar-senha/page")).default();
  const destinoDe = async () => { try { await pagina(); return null; } catch (e: any) { return e.url; } };

  it("com a troca pendente: o formulário, com o destino certo (painel ou app)", async () => {
    sessao.atual = { user: { id: "u1", name: "Beatriz Fictícia", email: "beatriz@ficticio.test", role: "ADMIN", permissoes: {}, trocarSenha: true } };
    const html = renderToStaticMarkup(await pagina());
    expect(html).toContain("data-trocar-senha-obrigatoria");
    expect(html).toContain("Crie a sua senha, Beatriz");
  });

  it("sem a troca pendente: volta ao trabalho (o técnico, ao app); sem sessão: login", async () => {
    sessao.atual = { user: { id: "u2", role: "ADMIN", permissoes: {}, trocarSenha: false } };
    expect(await destinoDe()).toBe("/dashboard");
    const { PRESETS } = await import("@/lib/permissoes");
    sessao.atual = { user: { id: "uT", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1", trocarSenha: false } };
    expect(await destinoDe()).toBe("/tecnico");
    sessao.atual = null;
    expect(await destinoDe()).toBe("/login");
  });
});
