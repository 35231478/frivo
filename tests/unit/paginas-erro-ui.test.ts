// @vitest-environment happy-dom
/**
 * PÁGINAS DE ERRO em português — antes, endereço inexistente mostrava "404 This page could not be
 * found." (inclusive DENTRO do painel, para uma OS que não existe) e erro inesperado mostrava
 * "Application error: a server-side exception has occurred… (see the server logs…)".
 *
 * O que se prova, tela por tela:
 *  - 404 fora do painel: título, uma linha, "Ir para o início" sem sessão e "Ir para o painel" com;
 *  - 404 dentro do painel: a mesma mensagem, sem a marca (o menu continua ali);
 *  - erro inesperado (raiz, painel e o global): "Tentar de novo" que busca de novo e remonta; nenhum
 *    detalhe técnico na tela — a mensagem do erro não aparece; o código só no ⓘ;
 *  - celular: as saídas empilham e ocupam a largura (classes da tela);
 *  - nenhum emoji, nenhum texto em inglês.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const RAIZ = path.resolve(__dirname, "../..");
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const INGLES = /could not be found|Application error|server-side exception|Something went wrong|Try again|Go back|Not Found/i;

const nav = vi.hoisted(() => ({ refresh: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav, usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(),
  redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); }, notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
const sessao = vi.hoisted(() => ({ atual: null as any, falha: false }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => { if (sessao.falha) throw new Error("banco fora"); return sessao.atual; }) }));
// global-error importa as fontes do Next (next/font/local), que só existem no build
vi.mock("@/app/fonts", () => ({ inter: { variable: "f-inter" }, archivo: { variable: "f-archivo" } }));

const ERRO = Object.assign(new Error("PrismaClientKnownRequestError P2025: ordens.findUnique em /var/task/.next/server"), { digest: "3589624100" });

let root: Root | null = null, caixa: HTMLDivElement | null = null;
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(el); });
  return caixa;
}
const $ = (sel: string) => caixa!.querySelector(sel) as HTMLElement | null;
beforeEach(() => { sessao.atual = null; sessao.falha = false; nav.refresh.mockClear(); nav.back.mockClear(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); root = null; caixa = null; vi.restoreAllMocks(); });

/** A saída marcada com data-acao-erro, lida do HTML: [texto, href] */
const saida = (html: string, acao: string) => {
  const a = new DOMParser().parseFromString(html, "text/html").querySelector(`[data-acao-erro="${acao}"]`);
  return a ? [a.textContent, a.getAttribute("href")] : null;
};
const semTecnico = (html: string) => {
  expect(html).not.toMatch(INGLES);
  expect(EMOJI.test(html)).toBe(false);
  expect(html, "a mensagem técnica do erro não vai para a tela").not.toMatch(/Prisma|P2025|findUnique|\/var\/task/);
};

describe("404 fora do painel (app/not-found.tsx)", () => {
  const render = async () => { const { default: P } = await import("@/app/not-found"); return renderToStaticMarkup(await P()); };

  it("sem sessão: \"Página não encontrada\", uma linha e \"Ir para o início\"", async () => {
    const html = await render();
    expect(html).toContain("Página não encontrada");
    expect(html).toContain("O endereço não existe ou foi alterado.");
    expect(saida(html, "inicio")).toEqual(["Ir para o início", "/"]);
    expect(html).not.toContain("Ir para o painel");
    expect(html, "fora do painel: a marca do Frivo").toContain("frivo");
    semTecnico(html);
  });

  it("com sessão: \"Ir para o painel\" (\"/\" leva cada um ao seu: Dashboard ou app do técnico)", async () => {
    sessao.atual = { user: { id: "u1", role: "OPERADOR", permissoes: {} } };
    const html = await render();
    expect(saida(html, "painel")).toEqual(["Ir para o painel", "/"]);
    expect(html).not.toContain("Ir para o início");
  });

  it("a página de erro não quebra se a sessão não puder ser lida (banco fora): segue como sem sessão", async () => {
    sessao.falha = true;
    expect(await render()).toContain("Ir para o início");
  });

  it("título da aba em português", async () => {
    const { metadata } = await import("@/app/not-found");
    expect(metadata.title).toBe("Página não encontrada");
  });
});

describe("404 dentro do painel (app/(dashboard)/not-found.tsx)", () => {
  it("registro que não existe: mensagem em português, sem a marca (o menu continua), saída para o painel", async () => {
    const { default: P } = await import("@/app/(dashboard)/not-found");
    const html = renderToStaticMarkup(createElement(P));
    expect(html).toContain("Página não encontrada");
    expect(html).toContain("O registro não existe mais ou o link está incompleto.");
    expect(html).toContain('data-pagina-erro="404-painel"');
    expect(html).toContain("Ir para o painel");
    expect(html).not.toContain("min-h-[100dvh]");
    semTecnico(html);
  });

  it("\"Voltar\" só aparece quando há para onde voltar — e volta", async () => {
    const { default: P } = await import("@/app/(dashboard)/not-found");
    const comprimento = vi.spyOn(window.history, "length", "get");
    comprimento.mockReturnValue(1);
    await montar(createElement(P));
    expect($('[data-acao-erro="voltar"]'), "aba aberta direto no link").toBeNull();
    act(() => root!.unmount()); caixa!.remove();
    comprimento.mockReturnValue(3);
    await montar(createElement(P));
    await act(async () => { $('[data-acao-erro="voltar"]')!.click(); });
    expect(nav.back).toHaveBeenCalledTimes(1);
  });
});

describe("erro inesperado", () => {
  it("dentro do painel: \"Algo deu errado\", \"Tentar de novo\" busca no servidor e remonta; nada técnico na tela", async () => {
    const { default: P } = await import("@/app/(dashboard)/error");
    const reset = vi.fn();
    await montar(createElement(P, { error: ERRO, reset }));
    const html = caixa!.innerHTML;
    expect($("[data-titulo-erro]")!.textContent).toBe("Algo deu errado");
    expect($("[data-texto-erro]")!.textContent).toContain("Não foi possível carregar esta página.");
    expect($('[data-acao-erro="painel"]')!.getAttribute("href")).toBe("/");
    semTecnico(html);
    await act(async () => { $('[data-acao-erro="tentar"]')!.click(); });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(console.error, "o erro vai para o console de quem investiga").toHaveBeenCalledWith(ERRO);
  });

  it("o código do erro fica no ⓘ (para o suporte), nunca no texto da tela; sem código, sem ⓘ", async () => {
    const { default: P } = await import("@/app/(dashboard)/error");
    await montar(createElement(P, { error: ERRO, reset: () => {} }));
    const ajuda = document.body.querySelector('[role="tooltip"]');
    expect(ajuda?.textContent).toContain("informe ao suporte o código 3589624100");
    expect($("[data-texto-erro] > span")!.textContent).not.toContain("3589624100");
    act(() => root!.unmount()); caixa!.remove(); document.body.innerHTML = "";
    await montar(createElement(P, { error: new Error("x"), reset: () => {} }));
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("fora do painel (app/error.tsx): tela cheia com a marca, \"Ir para o início\" e \"Tentar de novo\"", async () => {
    const { default: P } = await import("@/app/error");
    const reset = vi.fn();
    await montar(createElement(P, { error: ERRO, reset }));
    expect($('[data-pagina-erro="erro"]')!.className).toContain("min-h-[100dvh]");
    expect($('[data-acao-erro="inicio"]')!.textContent).toBe("Ir para o início");
    semTecnico(caixa!.innerHTML);
    await act(async () => { $('[data-acao-erro="tentar"]')!.click(); });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("global-error: documento próprio em pt-BR, \"Tentar de novo\" recarrega a página", async () => {
    const { default: P } = await import("@/app/global-error");
    const html = renderToStaticMarkup(createElement(P, { error: ERRO, reset: () => {} }));
    expect(html).toMatch(/^<html lang="pt-BR"/);
    expect(html).toContain("<title>Algo deu errado | Frivo</title>");
    expect(html).toContain("Não foi possível abrir o Frivo agora.");
    expect(html).toContain("Tentar de novo");
    semTecnico(html);
    expect(readFileSync(path.join(RAIZ, "app/global-error.tsx"), "utf8")).toContain("window.location.reload()");
  });
});

describe("celular e estrutura", () => {
  it("as saídas empilham e ocupam a largura no celular; lado a lado a partir do sm", async () => {
    const { default: P } = await import("@/app/(dashboard)/not-found");
    const html = renderToStaticMarkup(createElement(P));
    expect(html).toContain("flex flex-col-reverse sm:flex-row items-stretch");
    expect(html).toContain("w-full max-w-xs sm:max-w-none sm:w-auto");
    expect(html, "alvo de toque").toContain("touch-target");
  });

  it("toda borda de erro existe: 404 e erro na raiz e no painel, e o global", () => {
    for (const f of ["app/not-found.tsx", "app/error.tsx", "app/global-error.tsx", "app/(dashboard)/not-found.tsx", "app/(dashboard)/error.tsx"]) {
      expect(existsSync(path.join(RAIZ, f)), f).toBe(true);
    }
    for (const f of ["app/error.tsx", "app/global-error.tsx", "app/(dashboard)/error.tsx"]) {
      const src = readFileSync(path.join(RAIZ, f), "utf8");
      expect(src.startsWith('"use client"'), `${f}: error boundary é componente de cliente`).toBe(true);
      expect(src, `${f}: não exibe error.message`).not.toMatch(/error\.message|error\.stack/);
    }
  });
});
