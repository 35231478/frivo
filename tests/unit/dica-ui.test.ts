// @vitest-environment happy-dom
/**
 * Dica (ⓘ + balão): o tooltip ÚNICO do sistema (Princípio 7).
 *  - acessível: botão "Ajuda: <rótulo>", aria-describedby → role="tooltip" (no DOM mesmo fechado);
 *  - mouse: hover abre, sair fecha, clique não fecha; toque: alterna, toque fora fecha;
 *  - teclado: foco abre, Esc fecha; rolar a tela fecha;
 *  - balão no body (não é cortado por gaveta/tabela) e sempre dentro da tela;
 *  - atalhos `dica` em FormField, FormSection, CardTitulo e PageHeader.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dica } from "@/components/ui/dica";
import { FormField, FormSection } from "@/components/ui/form-field";
import { CardTitulo } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, caixa: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); Object.assign(window, { innerWidth: 1024, innerHeight: 768 }); });

async function montar(el: ReactElement) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
}
const botao = (el: ParentNode = caixa) => el.querySelector("[data-dica]") as HTMLButtonElement;
const balao = (b = botao()) => document.getElementById(b.getAttribute("aria-describedby")!) as HTMLElement;
const aberta = (b = botao()) => !balao(b).hidden;
const disparar = async (alvo: EventTarget, tipo: string, init: Record<string, unknown> = {}) => {
  await act(async () => {
    const Ev = tipo.startsWith("pointer") ? (globalThis.PointerEvent ?? MouseEvent) : tipo.startsWith("key") ? KeyboardEvent : Event;
    alvo.dispatchEvent(new (Ev as any)(tipo, { bubbles: true, cancelable: true, ...init }));
  });
};
const hover = async (b: HTMLElement, entrar: boolean) =>
  disparar(b, entrar ? "pointerover" : "pointerout", { pointerType: "mouse", relatedTarget: document.body });
const tocar = async (b: HTMLElement) => {
  await disparar(b, "pointerdown", { pointerType: "touch" });
  await act(async () => { b.focus(); });
  await act(async () => { b.click(); });
};
const retangulo = (b: HTMLElement, r: { left: number; top: number; w?: number; h?: number }) => {
  const w = r.w ?? 18, h = r.h ?? 18;
  b.getBoundingClientRect = () => ({ left: r.left, right: r.left + w, top: r.top, bottom: r.top + h, width: w, height: h, x: r.left, y: r.top, toJSON: () => ({}) });
};

describe("acessibilidade", () => {
  it("botão com nome 'Ajuda: <rótulo>' descrito pelo balão (role tooltip), presente mesmo fechado", async () => {
    await montar(createElement(Dica, { texto: "Código do serviço na lista da LC 116.", rotulo: "Serviço (LC 116)" }));
    const b = botao();
    expect([b.tagName, b.type, b.getAttribute("aria-label"), b.getAttribute("aria-expanded")]).toEqual(["BUTTON", "button", "Ajuda: Serviço (LC 116)", "false"]);
    const t = balao();
    expect([t.getAttribute("role"), t.hidden, t.textContent]).toEqual(["tooltip", true, "Código do serviço na lista da LC 116."]);
    // Sem rótulo: nome genérico
    act(() => root.unmount()); caixa.remove();
    await montar(createElement(Dica, { texto: "x" }));
    expect(botao().getAttribute("aria-label")).toBe("Mais informações");
  });

  it("teclado: foco abre, Esc fecha; Enter alterna", async () => {
    await montar(createElement(Dica, { texto: "Explicação", rotulo: "Campo" }));
    const b = botao();
    await act(async () => { b.focus(); });
    expect([aberta(), b.getAttribute("aria-expanded")]).toEqual([true, "true"]);
    await disparar(document, "keydown", { key: "Escape" });
    expect(aberta()).toBe(false);
    await act(async () => { b.click(); }); // Enter/Espaço viram clique sem ponteiro
    expect(aberta()).toBe(true);
    await act(async () => { b.click(); });
    expect(aberta()).toBe(false);
    await act(async () => { b.click(); });
    await act(async () => { b.blur(); });
    expect(aberta()).toBe(false);
  });
});

describe("mouse e toque", () => {
  it("mouse: hover abre e sair fecha; o clique com o mouse não fecha", async () => {
    await montar(createElement(Dica, { texto: "Explicação" }));
    const b = botao();
    await hover(b, true);
    expect(aberta()).toBe(true);
    await disparar(b, "pointerdown", { pointerType: "mouse" });
    await act(async () => { b.click(); });
    expect(aberta()).toBe(true);
    await hover(b, false);
    expect(aberta()).toBe(false);
  });

  it("toque: abre (o foco do toque não anula o clique), segundo toque fecha, toque fora fecha", async () => {
    await montar(createElement(Dica, { texto: "Explicação" }));
    const b = botao();
    await tocar(b);
    expect(aberta()).toBe(true);
    await tocar(b);
    expect(aberta()).toBe(false);
    await tocar(b);
    await disparar(document.body, "pointerdown", { pointerType: "touch" });
    expect(aberta()).toBe(false);
  });

  it("toque no próprio balão não fecha; rolar a tela fecha", async () => {
    await montar(createElement(Dica, { texto: "Explicação" }));
    const b = botao();
    await tocar(b);
    await disparar(balao(), "pointerdown", { pointerType: "touch" });
    expect(aberta()).toBe(true);
    await disparar(window, "scroll");
    expect(aberta()).toBe(false);
  });

  it("o clique na dica não aciona o que está em volta (card clicável, label)", async () => {
    let cliques = 0;
    await montar(createElement("button", { type: "button", onClick: () => { cliques++; } }, createElement(Dica, { texto: "x" })));
    await act(async () => { botao().click(); });
    expect([cliques, aberta()]).toEqual([0, true]);
  });
});

describe("posição: no body e sempre dentro da tela", () => {
  it("balão vai para o body (não é cortado por gaveta/tabela com rolagem)", async () => {
    await montar(createElement("div", { style: { overflow: "hidden", height: "10px" } }, createElement(Dica, { texto: "x" })));
    expect(balao().parentElement).toBe(document.body);
    expect(balao().className).toContain("fixed");
  });

  it("centralizado no ícone; perto da borda direita encosta na margem; perto do rodapé abre para cima", async () => {
    Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
    await montar(createElement(Dica, { texto: "x" }));
    const b = botao();
    retangulo(b, { left: 500, top: 100 });
    await act(async () => { b.click(); });
    expect([balao().style.left, balao().style.width, balao().style.top, balao().style.bottom]).toEqual(["377px", "264px", "124px", ""]);
    await act(async () => { b.click(); });
    retangulo(b, { left: 1010, top: 700 });
    await act(async () => { b.click(); });
    expect([balao().style.left, balao().style.top, balao().style.bottom]).toEqual(["752px", "", "74px"]);
  });

  it("celular estreito: o balão encolhe para caber; perto da borda esquerda não sai da tela", async () => {
    Object.assign(window, { innerWidth: 240, innerHeight: 640 });
    await montar(createElement(Dica, { texto: "x", lado: "esquerda" }));
    const b = botao();
    retangulo(b, { left: 4, top: 50 });
    await act(async () => { b.click(); });
    expect([balao().style.left, balao().style.width]).toEqual(["8px", "224px"]);
  });
});

describe("atalho `dica` nos componentes-base", () => {
  it("FormField: ⓘ ao lado do rótulo, fora do <label> (clicar na dica não foca o campo)", async () => {
    await montar(createElement(FormField, { label: "CNAE", dica: "Atividade econômica principal.", children: createElement("input") }));
    const b = botao();
    expect([b.getAttribute("aria-label"), b.closest("label"), balao().textContent]).toEqual(["Ajuda: CNAE", null, "Atividade econômica principal."]);
    expect(caixa.querySelector("label")!.textContent).toBe("CNAE");
  });

  it("FormField sem dica não mostra ⓘ; erro continua visível na tela", async () => {
    await montar(createElement(FormField, { label: "CNPJ", error: "CNPJ inválido.", children: createElement("input") }));
    expect(botao()).toBeNull();
    expect(caixa.textContent).toContain("CNPJ inválido.");
  });

  it("FormSection, CardTitulo e PageHeader", async () => {
    await montar(createElement("div", null,
      createElement(FormSection, { title: "Tributação", dica: "Regras do ISS.", children: "c" }),
      createElement(CardTitulo, { dica: "Dados que saem na nota.", children: "Emitente" }),
      createElement(PageHeader, { title: "Dados fiscais", backHref: "/", dica: "Emissão de NFS-e." }),
    ));
    const nomes = [...caixa.querySelectorAll("[data-dica]")].map((b) => [b.getAttribute("aria-label"), balao(b as HTMLButtonElement).textContent]);
    expect(nomes).toEqual([["Ajuda: Tributação", "Regras do ISS."], ["Ajuda: Emitente", "Dados que saem na nota."], ["Ajuda: Dados fiscais", "Emissão de NFS-e."]]);
  });
});
