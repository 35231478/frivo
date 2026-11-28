// @vitest-environment happy-dom
/**
 * Leva I — as telas num DOM de verdade:
 *  1. o menu "Colunas" abre em portal (fora da tabela), fixo e rolável — a tabela curta não o recorta;
 *  2. o modal aberto de dentro da gaveta fica por cima dela;
 *  4. sair sem salvar: link interno com alteração pergunta (e só sai se confirmar); sem alteração, não; depois de
 *     salvar, não; fechar a aba com alteração pede o aviso do navegador;
 *  5. o campo de CEP preenche o endereço e diz quando não acha;
 *  6. a chave da nota copia ao clicar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/clientes/novo", useSearchParams: () => new URLSearchParams() }));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
beforeEach(() => {
  nav.push.mockClear(); avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  // um endereço de verdade (o "link interno" se mede contra ele)
  (window as any).happyDOM?.setURL("http://localhost:3000/clientes/novo");
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement) { raiz = createRoot(caixa); await act(async () => { raiz!.render(el); }); await esperar(); }
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}

describe("1. o menu Colunas não é recortado pela tabela", () => {
  it("abre em portal no corpo da página, fixo, com altura máxima e rolagem", async () => {
    const { TabelaPro } = await import("@/components/listagem/tabela-pro");
    await montar(createElement("div", { className: "overflow-hidden", style: { height: "120px" }, "data-recipiente": "" },
      createElement(TabelaPro, { tela: "teste-leva-i", colunas: [{ id: "placa", titulo: "Placa" }, { id: "modelo", titulo: "Modelo" }], linhas: [{ id: "v1", celulas: { placa: "ABC1D23", modelo: "Fiorino" } }] } as any)));
    await clicar($("[data-colunas-menu]"));
    const menu = $("[data-menu-colunas]")!;
    expect(menu).toBeTruthy();
    expect($("[data-recipiente]")!.contains(menu)).toBe(false); // fora do recipiente que corta
    expect(menu.parentElement).toBe(document.body);
    expect(menu.className).toContain("fixed");
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.className).toContain("z-[80]");
    expect(menu.style.maxHeight).not.toBe("");
    // marcar uma coluna não fecha o menu (o clique dentro do portal conta como dentro)
    await act(async () => { menu.querySelector('[data-coluna-opcao="modelo"]')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    await clicar(menu.querySelector('[data-coluna-opcao="modelo"]'));
    expect($("[data-menu-colunas]")).toBeTruthy();
    // clicar fora fecha
    await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    await esperar();
    expect($("[data-menu-colunas]")).toBeNull();
  });
});

describe("2. o modal de dentro da gaveta fica por cima", () => {
  it("gaveta z-[60] < modal z-[70]", async () => {
    const { Drawer } = await import("@/components/ui/drawer");
    const { Modal } = await import("@/components/ui/modal");
    await montar(createElement(Drawer, { aberto: true, onFechar: () => {}, titulo: "Cargos" } as any,
      createElement(Modal, { aberto: true, onFechar: () => {}, titulo: "Inativar cargo" } as any, createElement("p", null, "Confirmar"))));
    const modal = $("[data-modal]")!;
    const gaveta = [...document.querySelectorAll("div")].find((d) => d.className.includes("z-[60]"))!;
    expect(gaveta).toBeTruthy();
    expect(modal.className).toContain("z-[70]");
  });
});

describe("4. sair sem salvar", () => {
  async function montarForm() {
    const { ProtegerSaida } = await import("@/components/ui/proteger-saida");
    await montar(createElement("div", null,
      createElement("a", { href: "/clientes", "data-sair": "" }, "Clientes"),
      createElement(ProtegerSaida, null, createElement("form", { onSubmit: (e: Event) => e.preventDefault(), "data-form": "" },
        createElement("input", { name: "nome", "data-nome": "" }),
        createElement("input", { name: "busca", "data-sem-aviso": "", "data-busca": "" })))));
  }
  it("sem alteração: o link sai sem perguntar", async () => {
    await montarForm();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { $("[data-sair]")!.dispatchEvent(ev); });
    expect(avisos.confirmar).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
  it("com alteração: pergunta; \"Continuar editando\" fica; \"Sair sem salvar\" vai", async () => {
    await montarForm();
    await digitar($("[data-nome]"), "Hospital");
    avisos.confirmar.mockImplementationOnce(async () => false);
    await clicar($("[data-sair]"));
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({ titulo: "Sair sem salvar?", confirmarTexto: "Sair sem salvar", cancelarTexto: "Continuar editando" }));
    expect(nav.push).not.toHaveBeenCalled();
    await clicar($("[data-sair]"));
    expect(nav.push).toHaveBeenCalledWith("/clientes");
  });
  it("a busca marcada com data-sem-aviso não conta; depois do envio (salvando) não pergunta; fechar a aba com alteração avisa", async () => {
    await montarForm();
    await digitar($("[data-busca]"), "abc");
    const fechar = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(fechar);
    expect(fechar.defaultPrevented).toBe(false);
    await digitar($("[data-nome]"), "Hospital");
    const fechar2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(fechar2);
    expect(fechar2.defaultPrevented).toBe(true);
    await act(async () => { ($("[data-form]") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await clicar($("[data-sair]"));
    expect(avisos.confirmar).not.toHaveBeenCalled();
  });
  it("salvou e ficou na tela (marcarFormularioSalvo): não pergunta mais", async () => {
    const { marcarFormularioSalvo } = await import("@/lib/ui/sair-sem-salvar");
    await montarForm();
    await digitar($("[data-nome]"), "Hospital");
    act(() => marcarFormularioSalvo());
    await clicar($("[data-sair]"));
    expect(avisos.confirmar).not.toHaveBeenCalled();
  });
});

describe("5. o campo de CEP", () => {
  it("8 dígitos: consulta e preenche; não achou: diz e deixa digitar", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => new Response(JSON.stringify(u.includes("01310100")
      ? { logradouro: "Avenida Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" } : { erro: true }), { status: u.includes("brasilapi") ? 404 : 200 })));
    const { CampoCep, DICA_CEP } = await import("@/components/ui/campo-cep");
    const achou = vi.fn();
    let valor = "";
    const Teste = () => createElement(CampoCep, { valor, onValor: (v: string) => { valor = v; }, onEndereco: achou });
    await montar(createElement(Teste));
    await digitar($("[data-campo='cep']"), "01310100");
    expect(achou).toHaveBeenCalledWith(expect.objectContaining({ logradouro: "Avenida Paulista", cidade: "São Paulo", estado: "SP" }));
    expect(document.body.textContent).toContain(DICA_CEP.achou);
    await digitar($("[data-campo='cep']"), "99999999");
    expect(document.body.textContent).toContain(DICA_CEP.naoEncontrado);
    expect(achou).toHaveBeenCalledTimes(1);
  });
});

describe("6. a chave da nota copia ao clicar", () => {
  it("copia os 44 dígitos (sem os espaços) e avisa \"Chave copiada.\"; não abre a linha", async () => {
    const copiados: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copiados.push(t); } } });
    const { ChaveCopiavel } = await import("@/components/compras/chave-copiavel");
    const chave = "35261011222333000181550010000045211000045217";
    const linha = vi.fn();
    await montar(createElement("div", { onClick: linha }, createElement(ChaveCopiavel, { chave })));
    expect($("[data-chave-copiavel]")!.textContent).toBe("3526 1011 2223 3300 0181 5500 1000 0045 2110 0004 5217");
    await clicar($("[data-chave-copiavel]"));
    expect(copiados).toEqual([chave]);
    expect(avisos.toast).toHaveBeenCalledWith("Chave copiada.");
    expect(linha).not.toHaveBeenCalled();
  });
});
