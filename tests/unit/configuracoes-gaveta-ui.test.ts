// @vitest-environment happy-dom
/**
 * Página de Configurações num DOM de verdade:
 *  - abas Operacionais/Financeiras/Conta trocam os cartões na hora (e a URL acompanha);
 *  - clicar num cartão abre a gaveta NA HORA (carregando) e pede a URL do item (?aba&secao);
 *    a tela completa chega do servidor e aparece dentro dela, sem o "voltar" da página;
 *  - fechar (X, Esc ou fundo) volta aos cartões e limpa a URL; o foco volta para o cartão;
 *  - um modal aberto DENTRO da gaveta: Esc fecha só o modal;
 *  - só os cartões que o perfil pode ver; ?secao negada mostra aviso.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Drawer } from "@/components/ui/drawer";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh, back: () => {} }),
  usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;

beforeAll(async () => { await import("@/components/config/painel-configuracoes"); }, 120_000);
beforeEach(() => { nav.push.mockClear(); nav.replace.mockClear(); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; document.body.style.overflow = ""; });

const TODOS = ["tipos-os", "formularios", "termos", "prazos", "impressao-os", "tipos-equipamento", "servicos", "produtos", "tabelas-preco",
  "categorias-financeiras", "centros-custo", "banco-inter", "empresa", "preferencias", "usuarios", "perfis", "cargos", "email", "email-templates", "portal", "qr-code"];

/** Tela "de verdade" de exemplo: um CRUD com um modal de edição (como os cadastros) */
function TelaExemplo() {
  const [aberto, setAberto] = useState(false);
  return createElement("div", { "data-tela-exemplo": true },
    createElement(PageHeader, { title: "Tipos de OS", backHref: "/configuracoes" }),
    createElement("button", { type: "button", onClick: () => setAberto(true) }, "Novo tipo"),
    createElement(Modal, { aberto, onFechar: () => setAberto(false), titulo: "Novo tipo de OS", children: createElement("input", { "aria-label": "Nome" }) }),
  );
}

async function montar(props: Record<string, unknown>) {
  const { PainelConfiguracoes } = await import("@/components/config/painel-configuracoes");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  const render = async (p: Record<string, unknown>) => {
    await act(async () => { root.render(createElement(PainelConfiguracoes as any, { visiveis: TODOS, abaInicial: null, secaoAberta: null, ...p })); });
    await esperar();
  };
  await render(props);
  return render;
}
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const tecla = async (key: string) => { await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }); await esperar(); };
const cartoes = () => $$("[data-cartao-config]").map((c) => c.getAttribute("data-cartao-config"));

describe("abas e cartões", () => {
  it("3 abas; cada uma mostra os seus cartões; trocar de aba não vai ao servidor e a URL acompanha", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    await montar({});
    expect($$("[role='tab']").map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([["Operacionais", "true"], ["Financeiras", "false"], ["Conta", "false"]]);
    expect(cartoes()).toEqual(["tipos-os", "formularios", "termos", "prazos", "impressao-os", "tipos-equipamento", "servicos", "produtos", "tabelas-preco"]);
    await clicar($("[data-aba-config='financeiras']"));
    expect(cartoes()).toEqual(["categorias-financeiras", "centros-custo", "banco-inter"]);
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/configuracoes?aba=financeiras");
    await clicar($("[data-aba-config='conta']"));
    expect(cartoes()).toEqual(["empresa", "preferencias", "usuarios", "perfis", "cargos", "email", "portal", "qr-code"]);
    expect(nav.push).not.toHaveBeenCalled();
    // Cada cartão também é um link de verdade (abrir em nova aba leva à mesma gaveta)
    expect($("[data-cartao-config='usuarios']")?.getAttribute("href")).toBe("/configuracoes?aba=conta&secao=usuarios");
    expect($("[data-cartao-config='usuarios']")?.getAttribute("aria-haspopup")).toBe("dialog");
    replaceState.mockRestore();
  });

  it("aba inicial pela URL; só os cartões liberados para o perfil", async () => {
    await montar({ abaInicial: "conta", visiveis: ["usuarios", "tipos-os"] });
    expect($$("[role='tab']").map((t) => t.textContent)).toEqual(["Operacionais", "Conta"]);
    expect(cartoes()).toEqual(["usuarios"]);
  });

  it("perfil sem nenhuma configuração: aviso, sem abas", async () => {
    await montar({ visiveis: [] });
    expect($("[role='tablist']")).toBeNull();
    expect(document.body.textContent).toContain("não libera nenhuma configuração");
  });

  it("?secao negada: aviso com o nome do item", async () => {
    await montar({ secaoNegada: "usuarios" });
    expect($("[data-secao-negada]")?.textContent).toContain("(Usuários)");
  });
});

describe("gaveta com a tela completa", () => {
  it("clicar abre a gaveta na hora (carregando) e pede a URL do item; a tela do servidor aparece dentro dela", async () => {
    const render = await montar({});
    const cartao = $("[data-cartao-config='tipos-os']")!;
    cartao.focus();
    await clicar(cartao);
    expect(nav.push).toHaveBeenCalledWith("/configuracoes?aba=operacionais&secao=tipos-os", { scroll: false });
    const dialogo = $("[role='dialog']")!;
    expect(dialogo).toBeTruthy();
    expect(dialogo.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialogo.getAttribute("aria-labelledby")!)?.textContent).toContain("Tipos de OS");
    expect($("[data-carregando-config]")).toBeTruthy();
    expect(document.activeElement).toBe(dialogo); // foco entrou na gaveta
    expect(document.body.style.overflow).toBe("hidden");

    // O servidor responde com a tela do item
    await render({ secaoAberta: "tipos-os", abaInicial: "operacionais", children: createElement(TelaExemplo) });
    expect($("[data-gaveta-config='tipos-os'] [data-tela-exemplo]")).toBeTruthy();
    expect($("[data-carregando-config]")).toBeNull();
    // O "voltar" da página fica escondido dentro da gaveta (quem fecha é a gaveta)
    expect($("[data-gaveta-config]")?.className).toContain("[&_[data-voltar]]:hidden");
    expect($("[data-gaveta-config] [data-voltar]")).toBeTruthy();
  });

  it("Esc fecha: volta aos cartões, limpa a URL (aba do item) e devolve o foco ao cartão", async () => {
    const render = await montar({});
    const cartao = $("[data-cartao-config='servicos']")!;
    cartao.focus();
    await clicar(cartao);
    await render({ secaoAberta: "servicos", abaInicial: "operacionais", children: createElement(TelaExemplo) });
    await tecla("Escape");
    expect(nav.replace).toHaveBeenCalledWith("/configuracoes?aba=operacionais", { scroll: false });
    await render({ secaoAberta: null, abaInicial: "operacionais", children: null });
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); }); // animação de saída
    expect($("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe($("[data-cartao-config='servicos']"));
    expect(document.body.style.overflow).toBe("");
    expect(cartoes().length).toBe(9);
  });

  it("deeplink/refresh: a gaveta já abre com a tela; o botão Fechar também volta aos cartões", async () => {
    await montar({ secaoAberta: "email-templates", abaInicial: "conta", children: createElement(TelaExemplo) });
    expect($("[role='dialog']")?.textContent).toContain("Templates de e-mail");
    expect($("[data-aba-config='conta']")?.getAttribute("aria-selected")).toBe("true");
    await clicar($("[role='dialog'] button[aria-label='Fechar']"));
    expect(nav.replace).toHaveBeenCalledWith("/configuracoes?aba=conta", { scroll: false });
  });

  it("modal DENTRO da gaveta: Esc fecha só o modal; o segundo Esc fecha a gaveta", async () => {
    await montar({ secaoAberta: "tipos-os", abaInicial: "operacionais", children: createElement(TelaExemplo) });
    await clicar([...document.querySelectorAll("button")].find((b) => b.textContent === "Novo tipo"));
    expect($$("[role='dialog']").length).toBe(2);
    await tecla("Escape");
    expect($$("[role='dialog']").length).toBe(1);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("hidden"); // a gaveta continua aberta: página segue travada
    await tecla("Escape");
    expect(nav.replace).toHaveBeenCalledWith("/configuracoes?aba=operacionais", { scroll: false });
  });

  it("Tab não sai da gaveta (foco preso)", async () => {
    await montar({ secaoAberta: "tipos-os", abaInicial: "operacionais", children: createElement(TelaExemplo) });
    const dialogo = $("[role='dialog']")!;
    const focaveis = [...dialogo.querySelectorAll<HTMLElement>("a[href], button")];
    const ultimo = focaveis[focaveis.length - 1];
    ultimo.focus();
    await act(async () => {
      const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      if (!ev.defaultPrevented) throw new Error("Tab escapou da gaveta");
    });
    expect(dialogo.contains(document.activeElement)).toBe(true);
  });

  it("clicar com Ctrl (nova aba) não abre a gaveta aqui: deixa o navegador seguir o link", async () => {
    await montar({});
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => { $("[data-cartao-config='termos']")!.dispatchEvent(ev); });
    expect(nav.push).not.toHaveBeenCalled();
    expect($("[role='dialog']")).toBeNull();
  });
});

describe("camadas: Esc fecha só a de cima, em qualquer ordem", () => {
  it("gaveta aberta POR CIMA de um modal: Esc fecha a gaveta e o modal fica", async () => {
    const fechouModal = vi.fn(), fechouGaveta = vi.fn();
    function Cena() {
      const [gaveta, setGaveta] = useState(false);
      return createElement(Modal, {
        aberto: true, onFechar: fechouModal, titulo: "Modal",
        children: createElement("div", null,
          createElement("button", { type: "button", onClick: () => setGaveta(true) }, "Abrir gaveta"),
          createElement(Drawer, { aberto: gaveta, onFechar: () => { fechouGaveta(); setGaveta(false); }, titulo: "Gaveta", children: createElement("p", null, "dentro") }),
        ),
      });
    }
    caixa = document.createElement("div");
    document.body.appendChild(caixa);
    root = createRoot(caixa);
    await act(async () => { root.render(createElement(Cena)); });
    await esperar();
    await clicar([...document.querySelectorAll("button")].find((b) => b.textContent === "Abrir gaveta"));
    await tecla("Escape");
    expect(fechouGaveta).toHaveBeenCalledTimes(1);
    expect(fechouModal).not.toHaveBeenCalled();
    await tecla("Escape");
    expect(fechouModal).toHaveBeenCalledTimes(1);
  });
});
