// @vitest-environment happy-dom
/**
 * Orçamento, leva C — "Itens sem estoque" na seção Compras do orçamento, num DOM de verdade (API simulada):
 *  - mostra cada faltante ("faltam N") e o botão "Solicitar compra dos faltantes" para quem pode;
 *  - clicar cria o pedido (POST), avisa e recarrega a lista de pedidos e o painel; item pedido fica "Compra
 *    solicitada" com o número do pedido (que abre o pedido ali mesmo); nada a pedir: o botão some;
 *  - sem permissão: lista sim, botão não; Compras/Estoque desligado (disponivel=false) ou nada faltando: o painel some;
 *  - sem custo nenhum na tela.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/o1", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast }));

let root: Root;
let caixa: HTMLDivElement;
let estado: { situacao: any; pedidos: any[]; post: { status: number; corpo: any } };
const chamadas: { url: string; metodo: string }[] = [];
const F = (produtoId: string, descricao: string, falta: number, aSolicitar: number, pedidos: any[] = []) => ({
  produtoId, descricao, unidade: "un", necessario: falta, disponivel: 0, falta, solicitado: falta - aSolicitar, aSolicitar, pedidos,
});

beforeAll(async () => { await import("@/components/compras/compras-secao"); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; avisos.toast.mockClear();
  estado = {
    situacao: { disponivel: true, podeSolicitar: true, faltantes: [F("cap", "Capacitor 35uF", 3, 3), F("tubo", "Tubo de cobre", 1, 1)] },
    pedidos: [],
    post: { status: 201, corpo: { ok: true, acao: "criado", pedido: { id: "pc1", numero: "PCI-7" }, pedidos: [{ id: "pc1", numero: "PCI-7" }], itens: 2 } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/api/orcamentos/o1/compra-faltantes" && metodo === "POST") {
      // depois do POST o servidor passa a responder com o pedido criado
      estado.situacao = { ...estado.situacao, faltantes: estado.situacao.faltantes.map((f: any) => ({ ...f, solicitado: f.falta, aSolicitar: 0, pedidos: [{ id: "pc1", numero: "PCI-7", status: "SOLICITADO" }] })) };
      estado.pedidos = [{ id: "pc1", numero: "PCI-7", status: "SOLICITADO", itens: [{ id: "i1", descricao: "Capacitor 35uF", quantidade: 3, unidade: "un" }] }];
      return json(estado.post.corpo, estado.post.status);
    }
    if (url.startsWith("/api/orcamentos/o1/compra-faltantes")) return json(estado.situacao);
    if (url.startsWith("/api/pedidos-compra?")) return json(estado.pedidos);
    if (url.startsWith("/api/pedidos-compra/pc1")) return json({ erro: "x" }, 404);
    return json({}, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function montar() {
  const { ComprasSecao } = await import("@/components/compras/compras-secao");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ComprasSecao, { orcamentoId: "o1" })); });
  await esperar();
}

describe("Itens sem estoque — solicitar compra dos faltantes", () => {
  it("lista os faltantes e o botão; clicar cria o pedido, avisa, recarrega e marca 'Compra solicitada' com o número; o botão some", async () => {
    await montar();
    // (na tela os pedaços ficam separados pelo espaçamento do flex; o textContent junta)
    expect($$("[data-faltante]").map((e) => [e.getAttribute("data-faltante"), e.getAttribute("data-a-solicitar"), txt(e)])).toEqual([
      ["cap", "3", "Capacitor 35uF · faltam 3 una solicitar 3 un"], ["tubo", "1", "Tubo de cobre · faltam 1 una solicitar 1 un"],
    ]);
    expect($("[data-solicitar-faltantes]")).toBeTruthy();
    await act(async () => { $("[data-solicitar-faltantes]")!.click(); });
    await esperar();
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(1);
    expect(avisos.toast).toHaveBeenCalledWith("Pedido PCI-7 criado com 2 itens.");
    expect($$("[data-abrir-pedido]")).toHaveLength(1); // a lista de pedidos recarregou
    expect(txt($("[data-faltante='cap']"))).toContain("Compra solicitada");
    expect($("[data-faltante='cap'] [data-link-pedido='pc1']")!.textContent).toBe("PCI-7");
    expect($("[data-solicitar-faltantes]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/custo|R\$/i);
  });

  it("2º clique (já pedido): avisa 'Compra já solicitada em PCI-7' e não duplica", async () => {
    estado.post = { status: 200, corpo: { ok: true, acao: "nada", pedido: { id: "pc1", numero: "PCI-7" }, pedidos: [{ id: "pc1", numero: "PCI-7" }], itens: 0 } };
    estado.situacao.faltantes = [F("cap", "Capacitor 35uF", 3, 1, [{ id: "pc1", numero: "PCI-7", status: "COTANDO" }])];
    await montar();
    expect(txt($("[data-faltante='cap'] [data-compra-solicitada]"))).toBe("2 un já pedido em");
    expect(txt($("[data-faltante='cap'] [data-link-pedido='pc1']"))).toBe("PCI-7");
    expect(txt($("[data-faltante='cap'] [data-falta-pedir]"))).toBe("· a solicitar 1 un");
    await act(async () => { $("[data-solicitar-faltantes]")!.click(); });
    await esperar();
    expect(avisos.toast).toHaveBeenCalledWith("Compra já solicitada em PCI-7.");
  });

  it("sem permissão: a lista aparece, o botão não", async () => {
    estado.situacao.podeSolicitar = false;
    await montar();
    expect($$("[data-faltante]")).toHaveLength(2);
    expect($("[data-solicitar-faltantes]")).toBeNull();
  });

  it("Compras ou Estoque desligado (disponivel=false) ou nada faltando: o painel some (a seção Compras continua)", async () => {
    // mesmo que venha uma lista, disponivel=false manda: o painel não aparece
    estado.situacao = { disponivel: false, podeSolicitar: true, faltantes: [F("cap", "Capacitor 35uF", 3, 3)] };
    await montar();
    expect($("[data-compra-faltantes]")).toBeNull();
    expect(document.body.textContent).toContain("Compras");
    act(() => root.unmount()); caixa.remove();
    estado.situacao = { disponivel: true, podeSolicitar: true, faltantes: [] };
    await montar();
    expect($("[data-compra-faltantes]")).toBeNull();
  });

  it("erro do servidor: avisa com a mensagem e não marca nada", async () => {
    estado.post = { status: 400, corpo: { erro: "Orçamento cancelado ou reprovado: não há compra a solicitar." } };
    await montar();
    await act(async () => { $("[data-solicitar-faltantes]")!.click(); });
    await esperar();
    expect(avisos.toast).toHaveBeenCalledWith("Orçamento cancelado ou reprovado: não há compra a solicitar.", "erro");
  });
});
