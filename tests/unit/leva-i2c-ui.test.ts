// @vitest-environment happy-dom
/**
 * Leva I.2 — grupo C, as telas num DOM de verdade (dados fictícios):
 *  (7) Itens da OS: "Material de campo a conferir" com Confirmar (preço e quantidade ajustáveis) e Excluir da cobrança;
 *      preço 0 não confirma; a etiqueta na linha; quem não edita a OS (ou OS faturada) só vê a lista;
 *  (8) portal: "Resolvido por outro meio" na lista de enviados, com a dica, sem aviso de ação;
 *  (10) a gaveta da conferência: a recusa diz se o e-mail foi ao cliente, e avisa quando não foi.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_PRECO_CAMPO } from "@/lib/os/material-campo-cobranca";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams() }));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const respostas: Record<string, { status: number; corpo: unknown }> = {};
beforeAll(async () => { await Promise.all([import("@/components/os/os-orcamento"), import("@/components/providers/permissoes-provider"), import("@/components/portal/pedido-compra-portal"), import("@/components/pedido-cliente/gaveta-conferir")]); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; avisos.toast.mockClear();
  for (const k of Object.keys(respostas)) delete respostas[k];
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const r = respostas[`${metodo} ${new URL(url, "http://localhost").pathname}`] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais(), role = "ADMIN") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  raiz = createRoot(caixa);
  await act(async () => { raiz!.render(createElement(PermissoesProvider, { role, permissoes, children: el } as any)); });
  await esperar();
}
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
/** O balão da dica (vai para o body, ligado ao botão pelo aria-describedby) */
const dicaEm = (sel: string) => { const b = document.querySelector(`${sel} [aria-describedby]`); return b ? document.getElementById(b.getAttribute("aria-describedby")!)?.textContent ?? null : null; };
const texto = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}

const SERVICO = { id: "iSrv", tipo: "SERVICO", descricao: "Troca de capacitor", quantidade: 1, valorUnitario: 200, valorTotal: 200, executado: true };
const CAP = { id: "iCap", tipo: "PRODUTO", produtoId: "pCap", descricao: "Capacitor 35 µF", quantidade: 2, valorUnitario: 60, valorTotal: 120, executado: true, materialCampoId: "am1", conferirCampo: true };
const FORA = { id: "iFora", tipo: "PRODUTO", produtoId: null, descricao: "Abraçadeira", quantidade: 4, valorUnitario: 0, valorTotal: 0, executado: true, materialCampoId: "am2", conferirCampo: true };
async function montarItens(itens: unknown[], op: { permissoes?: Permissoes; role?: string; situacao?: unknown } = {}) {
  const { OsOrcamento } = await import("@/components/os/os-orcamento");
  await montar(createElement(OsOrcamento, { osId: "os1", itens: itens as any, regraMateriais: "A_PARTE", situacao: (op.situacao ?? null) as any }), op.permissoes, op.role);
}

describe("(7) Itens da OS: material de campo a conferir", () => {
  it("lista o que espera a conferência, com a etiqueta na linha e o aviso do sem preço", async () => {
    await montarItens([SERVICO, CAP, FORA, { ...CAP, id: "iOk", materialCampoId: "am3", conferirCampo: false, descricao: "Fita" }]);
    expect($("[data-material-campo-conferir]")!.textContent).toContain("Material de campo a conferir (2)");
    expect([...document.querySelectorAll("[data-campo-conferir]")].map((e) => e.getAttribute("data-campo-conferir"))).toEqual(["iCap", "iFora"]);
    expect($('[data-item-os="iCap"] [data-item-campo]')!.textContent).toBe("Material de campo · a conferir");
    expect($('[data-item-os="iOk"] [data-item-campo]')!.textContent).toBe("Material de campo");
    expect($('[data-item-os="iSrv"] [data-item-campo]')).toBeNull();
    expect($('[data-campo-conferir="iFora"] [data-campo-sem-preco]')).not.toBeNull();
    expect($('[data-campo-conferir="iCap"] [data-campo-sem-preco]')).toBeNull();
    // o porquê está na dica, não na tela
    expect(dicaEm("[data-material-campo-conferir]")).toMatch(/Cobrado à parte|cobrados à parte/);
    expect(texto()).not.toMatch(/você/i);
  });

  it("Confirmar manda o preço e a quantidade ajustados; o item sai da conferência e vira item comum", async () => {
    await montarItens([SERVICO, CAP]);
    respostas["POST /api/ordens/os1/orcamento/iCap/conferir-campo"] = { status: 200, corpo: { ok: true, item: { ...CAP, quantidade: 3, valorUnitario: 55, valorTotal: 165, conferirCampo: false } } };
    await digitar($('[data-campo-conferir="iCap"] [data-campo-qtd]'), "3");
    await digitar($('[data-campo-conferir="iCap"] [data-campo-preco]'), "55");
    expect($('[data-campo-conferir="iCap"] [data-campo-total]')!.textContent!.replace(/\s/g, " ")).toBe("R$ 165,00");
    await clicar($('[data-campo-conferir="iCap"] [data-campo-confirmar]'));
    expect(chamadas.filter((c) => c.metodo === "POST").map((c) => [c.url, c.corpo])).toEqual([["/api/ordens/os1/orcamento/iCap/conferir-campo", { acao: "confirmar", quantidade: 3, valorUnitario: 55 }]]);
    expect($("[data-material-campo-conferir]")).toBeNull();
    expect($('[data-item-os="iCap"] [data-item-campo]')!.textContent).toBe("Material de campo");
  });

  it("preço 0 não confirma (nem chama o servidor); Excluir da cobrança tira a linha; o erro do servidor aparece", async () => {
    await montarItens([SERVICO, FORA, CAP]);
    await clicar($('[data-campo-conferir="iFora"] [data-campo-confirmar]'));
    expect($('[data-campo-conferir="iFora"] [data-erro-campo]')!.textContent).toBe(MSG_PRECO_CAMPO);
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
    respostas["POST /api/ordens/os1/orcamento/iFora/conferir-campo"] = { status: 200, corpo: { ok: true, item: null } };
    await clicar($('[data-campo-conferir="iFora"] [data-campo-remover]'));
    expect(chamadas.at(-1)!.corpo).toEqual({ acao: "remover" });
    expect($('[data-item-os="iFora"]')).toBeNull();
    respostas["POST /api/ordens/os1/orcamento/iCap/conferir-campo"] = { status: 409, corpo: { erro: "Este material de campo já foi conferido." } };
    await clicar($('[data-campo-conferir="iCap"] [data-campo-remover]'));
    expect($('[data-campo-conferir="iCap"] [data-erro-campo]')!.textContent).toBe("Este material de campo já foi conferido.");
  });

  it("quem não edita a OS, ou OS já faturada: só a lista, sem Confirmar nem Remover", async () => {
    await montarItens([SERVICO, CAP], { permissoes: montarPermissoes({ ordens: ["visualizar"] }), role: "OPERADOR" });
    expect($("[data-material-campo-conferir]")).not.toBeNull();
    expect([$("[data-campo-confirmar]"), $("[data-campo-remover]"), $("[data-campo-preco]")]).toEqual([null, null, null]);
    act(() => raiz?.unmount()); raiz = null;
    await montarItens([SERVICO, CAP], { situacao: { faturado: true } });
    expect([$("[data-campo-confirmar]"), $("[data-campo-remover]")]).toEqual([null, null]);
  });

  it("assinada pelo cliente: a conferência continua (senão a OS nunca faturaria)", async () => {
    await montarItens([SERVICO, CAP], { situacao: { aceite: "CONFIRMADO" } });
    expect($("[data-campo-confirmar]")).not.toBeNull();
  });
});

describe("(8) portal: Resolvido por outro meio", () => {
  it("a lista de enviados mostra a situação com a dica e não pede ação", async () => {
    const { PedidoCompraPortal } = await import("@/components/portal/pedido-compra-portal");
    await montar(createElement(PedidoCompraPortal, { itens: [], enviados: [
      { id: "p1", numero: "PC-77", data: "2026-11-20", valor: null, situacao: "RESOLVIDO", motivoRecusa: null, enviadoEm: "2026-11-20T15:00:00.000Z", itens: ["OS-0201"], chaves: ["os:o1"] },
    ] }));
    expect($('[data-pedido-enviado-linha="RESOLVIDO"] [data-situacao-pedido]')!.textContent!.trim()).toBe("Resolvido por outro meio");
    expect(dicaEm('[data-pedido-enviado-linha="RESOLVIDO"]')).toContain("Nenhuma ação é necessária");
    expect([$("[data-pedido-recusado]"), $("[data-motivo-recusa-portal]")]).toEqual([null, null]);
  });
});

describe("(10) a gaveta da conferência: o e-mail da recusa", () => {
  const PEDIDO = { id: "p1", numero: "PC-90", data: "2026-11-20", valor: 900, observacao: null, situacao: "CONFERIR", podeConferir: true, temAnexo: false, anexoNome: null, total: 900, alerta: null, cliente: "Indústria P", enviadoPor: "Pedro", criadoEm: "2026-11-20T15:00:00.000Z", ordens: [{ id: "o1", numero: "OS-0203" }], orcamentos: [] };
  async function recusar(resposta: unknown) {
    const { GavetaConferir } = await import("@/components/pedido-cliente/gaveta-conferir");
    respostas["GET /api/pedidos-cliente/p1"] = { status: 200, corpo: PEDIDO };
    respostas["POST /api/pedidos-cliente/p1/conferir"] = { status: 200, corpo: resposta };
    await montar(createElement(GavetaConferir, { aberto: true, onFechar: () => {}, pedidoId: "p1" }));
    await clicar($("[data-recusar-pedido]"));
    await act(async () => {
      const t = $("[data-motivo-recusa]") as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(t, "Pedido sem assinatura do comprador");
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await esperar();
    await clicar($("[data-confirmar-recusa]"));
  }
  it("e-mail enviado: diz que o cliente recebeu o motivo", async () => {
    await recusar({ ok: true, email: { ok: true, para: ["pedro@p.test"] } });
    expect(avisos.toast.mock.calls.map((c) => c[0])).toEqual(["Pedido recusado. O cliente recebeu o motivo por e-mail e o vê no portal."]);
  });
  it("e-mail não enviado: a recusa vale e o escritório é avisado", async () => {
    await recusar({ ok: true, email: { ok: false, erro: "E-mail não configurado ou inativo." } });
    expect(avisos.toast.mock.calls.map((c) => c[0])).toEqual(["Pedido recusado. O cliente vê o motivo no portal.", "O e-mail da recusa não foi enviado: E-mail não configurado ou inativo."]);
  });
  it("pedido já encerrado como RESOLVIDO: a gaveta explica e não oferece Confirmar/Recusar", async () => {
    const { GavetaConferir } = await import("@/components/pedido-cliente/gaveta-conferir");
    respostas["GET /api/pedidos-cliente/p1"] = { status: 200, corpo: { ...PEDIDO, situacao: "RESOLVIDO" } };
    await montar(createElement(GavetaConferir, { aberto: true, onFechar: () => {}, pedidoId: "p1" }));
    expect(texto()).toContain("os serviços dele já não aguardam pedido de compra");
    expect([$("[data-confirmar-pedido]"), $("[data-recusar-pedido]")]).toEqual([null, null]);
  });
});
