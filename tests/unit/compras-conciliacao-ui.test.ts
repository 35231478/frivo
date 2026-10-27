// @vitest-environment happy-dom
/**
 * Compras 2/2 — Conciliação NF ↔ Pedido num DOM de verdade (API simulada):
 *  - central da NF (antes de lançar): "Esta NF parece ser do Pedido X — vincular?" com os motivos;
 *    1 clique escolhe o pedido (vai no lançamento), "Não vincular" desfaz; o idêntico avisa que vai
 *    sozinho; sem Compras › gerenciar só mostra;
 *  - painel da NF lançada: Vincular (1 clique, POST) e Desvincular (confirmação da casa, DELETE);
 *    erro da API vira aviso; sem Compras, só leitura;
 *  - sino: "NF chegou nos seus pedidos" leva ao pedido, mesmo sem a permissão de Compras.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/estoque/notas/n1", useRouter: () => ({ push: () => {}, refresh: nav.refresh, replace: () => {}, back: () => {} }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
const avisos = vi.hoisted(() => ({ toasts: [] as [string, string][], confirmar: true, perguntas: [] as any[] }));
vi.mock("@/components/ui/avisos", () => ({
  toast: (m: string, t = "sucesso") => { avisos.toasts.push([m, t]); },
  confirmar: async (o: any) => { avisos.perguntas.push(o); return avisos.confirmar; },
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([import("@/components/compras/conciliacao-nota"), import("@/components/compras/pedido-da-nota"), import("@/components/layout/header")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear();
  avisos.toasts = []; avisos.confirmar = true; avisos.perguntas = [];
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: url.startsWith("/api/cadastros") ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const ultima = (url: string) => chamadas.filter((c) => c.url === url).at(-1);

const SEM_FISCAL = { ncm: null, cest: null, gtin: null, origemMercadoria: null, unidadeTributavel: null };
const ITENS = [{
  id: "i1", numeroItem: 1, codigoFornecedor: "R410A", descricaoFornecedor: "GAS R410A", unidade: "UN", quantidade: 1, valorUnitario: 900, valorTotal: 900,
  fiscal: SEM_FISCAL, fator: 1, fatorAprendido: null, aprendido: true,
  produto: { id: "pGas", nome: "Gás R410A", unidade: "un", preco: null, margemVenda: null, custo: null, fiscal: SEM_FISCAL },
}];
const FIN = {
  categoriaId: null, centroCustoId: null, formaPagamento: "PIX", parcelas: [{ duplicata: null, vencimento: "2026-10-20", valor: 900, boleto: null }],
  parcelasNf: [{ duplicata: null, vencimento: "2026-10-20", valor: 900, boleto: null }], valorNota: 900, pagamentosNf: [], padrao: { categoriaId: null, centroCustoId: null }, hoje: "2026-10-20",
};
const SUG_A = { pedidoId: "pcA", numero: "PCI-2026-0001", pontos: 100, identico: true, motivos: ["Mesmo fornecedor da NF", "1 de 1 item bate: Gás R410A (produto)"] };
const SUG_B = { pedidoId: "pcB", numero: "PCI-2026-0002", pontos: 63, identico: false, motivos: ["Pedido sem fornecedor definido"] };
const PEDIDOS = [{ id: "pcB", numero: "PCI-2026-0002" }, { id: "pcA", numero: "PCI-2026-0001" }];

async function central(extra: Record<string, unknown> = {}) {
  const { ConciliacaoNota } = await import("@/components/compras/conciliacao-nota");
  await montar(createElement(ConciliacaoNota, { notaId: "n1", itens: ITENS, pedidos: PEDIDOS, podeLancar: true, financeiro: FIN, sugestoes: [SUG_A, SUG_B], automaticoId: "pcA", ...extra } as any));
}
const lancarBtn = () => $("[data-lancar-nota]");

describe("central da NF: sugestão antes de lançar", () => {
  it("mostra o pedido e por quê; o idêntico avisa que vai sozinho; nada escolhido = lança sem pedido (o servidor vincula o idêntico)", async () => {
    await central();
    const [a, b] = $$("[data-sugestao-pedido]");
    expect(txt(a)).toContain("Esta NF parece ser do Pedido PCI-2026-0001 — vincular?");
    expect([...a.querySelectorAll("[data-motivos] li")].map(txt)).toEqual(["Mesmo fornecedor da NF", "1 de 1 item bate: Gás R410A (produto)"]);
    expect(a.querySelector("[data-vai-sozinho]")).toBeTruthy();
    expect(txt(b)).toContain("Também pode ser do Pedido PCI-2026-0002 — vincular?");
    expect(b.querySelector("[data-vai-sozinho]")).toBeNull();
    expect(txt($("select[data-pedido] option"))).toBe("Automático (o pedido idêntico)");
    await clicar(lancarBtn());
    expect(ultima("/api/compras/notas/n1/lancar")!.corpo.pedidoCompraId).toBeNull();
  });

  it("1 clique em Vincular escolhe o pedido (vai no lançamento); 'Não vincular' desfaz", async () => {
    await central();
    await clicar($('[data-escolher-pedido="pcB"]'));
    expect($<HTMLSelectElement>("select[data-pedido]")!.value).toBe("pcB");
    const b = $('[data-sugestao-pedido="pcB"]')!;
    expect(txt(b)).toContain("Pedido PCI-2026-0002.");
    expect(b.querySelector("[data-escolhido]")).toBeTruthy();
    expect($("[data-vai-sozinho]")).toBeNull(); // escolheu outro: o idêntico não vai mais sozinho
    expect($('[data-escolher-pedido="pcB"]')).toBeNull();
    await clicar(lancarBtn());
    expect(ultima("/api/compras/notas/n1/lancar")!.corpo.pedidoCompraId).toBe("pcB");

    await clicar($("[data-desfazer-escolha]"));
    expect($<HTMLSelectElement>("select[data-pedido]")!.value).toBe("");
    expect($("[data-escolhido]")).toBeNull();
    expect($("[data-vai-sozinho]")).toBeTruthy();
    await clicar(lancarBtn());
    expect(ultima("/api/compras/notas/n1/lancar")!.corpo.pedidoCompraId).toBeNull();
  });

  it("sem idêntico: a 1ª opção é 'Sem pedido' e ninguém vai sozinho", async () => {
    await central({ sugestoes: [SUG_B], automaticoId: null });
    expect(txt($("select[data-pedido] option"))).toBe("Sem pedido");
    expect($("[data-vai-sozinho]")).toBeNull();
    expect(txt($("[data-sugestao-pedido]"))).toContain("Esta NF parece ser do Pedido PCI-2026-0002");
  });

  it("sem Compras › gerenciar (sem pedidos para escolher): mostra a sugestão, sem botão nem select", async () => {
    await central({ pedidos: [] });
    expect($("[data-sugestoes-pedido]")).toBeTruthy();
    expect($("[data-sem-compras]")).toBeTruthy();
    expect($("[data-escolher-pedido]")).toBeNull();
    expect($("select[data-pedido]")).toBeNull();
  });

  it("sem sugestão e sem pedidos: o cartão do pedido nem aparece", async () => {
    await central({ pedidos: [], sugestoes: [], automaticoId: null });
    expect($("[data-pedido-compra]")).toBeNull();
  });
});

const VINCULO = {
  pedidoId: "pcA", numero: "PCI-2026-0001", status: "PARCIAL", automatico: true,
  itens: [{ descricao: "Gás R410A", unidade: "kg", quantidade: 4, pedido: 10, recebido: 4, valorUnitario: 95, notaItem: 1, criterio: "PRODUTO" }],
};

async function painel(extra: Record<string, unknown> = {}) {
  const { PedidoDaNota } = await import("@/components/compras/pedido-da-nota");
  await montar(createElement(PedidoDaNota, { notaId: "n1", vinculos: [VINCULO], sugestoes: [SUG_B], podeGerenciar: true, ...extra } as any));
}

describe("painel da NF lançada", () => {
  it("lista o vínculo por item (quantidade, custo, recebido) e o badge de automático", async () => {
    await painel();
    const v = $('[data-vinculo-pedido="pcA"]')!;
    expect(txt(v.querySelector("a"))).toBe("Pedido PCI-2026-0001");
    expect(v.querySelector("a")!.getAttribute("href")).toBe("/compras/pedidos/pcA");
    expect(txt(v.querySelector("[data-status-vinculo]"))).toBe("Parcial");
    expect(v.querySelector("[data-vinculo-automatico]")).toBeTruthy();
    expect(txt(v.querySelector("[data-vinculo-item]"))).toBe("Item 1 → Gás R410A: 4 kg × R$ 95,00 (recebido 4 de 10)");
    expect(txt($('[data-sugestao-pedido="pcB"]'))).toContain("O restante desta NF parece ser do Pedido PCI-2026-0002 — vincular?");
  });

  it("Vincular: 1 clique → POST com o pedido, aviso e a tela recarrega", async () => {
    respostas["POST /api/compras/notas/n1/vinculos"] = { status: 201, corpo: { criados: 1, status: "CONCLUIDO" } };
    await painel();
    await clicar($('[data-vincular-pedido="pcB"]'));
    expect(ultima("/api/compras/notas/n1/vinculos")).toMatchObject({ metodo: "POST", corpo: { pedidoId: "pcB" } });
    expect(avisos.toasts).toEqual([["NF vinculada ao pedido PCI-2026-0002: Concluída.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("Vincular de novo (nada criado) avisa que já estava; erro da API vira aviso e não recarrega", async () => {
    respostas["POST /api/compras/notas/n1/vinculos"] = { status: 200, corpo: { criados: 0, status: "PARCIAL" } };
    await painel();
    await clicar($('[data-vincular-pedido="pcB"]'));
    expect(avisos.toasts.at(-1)).toEqual(["Já estava vinculada ao pedido PCI-2026-0002.", "sucesso"]);
    respostas["POST /api/compras/notas/n1/vinculos"] = { status: 409, corpo: { erro: "Nenhum item desta NF casa com o que falta no pedido PCI-2026-0002." } };
    nav.refresh.mockClear();
    await clicar($('[data-vincular-pedido="pcB"]'));
    expect(avisos.toasts.at(-1)).toEqual(["Nenhum item desta NF casa com o que falta no pedido PCI-2026-0002.", "erro"]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("Desvincular pede confirmação: Voltar não chama a API; confirmar → DELETE do pedido certo", async () => {
    await painel();
    avisos.confirmar = false;
    await clicar($('[data-desvincular-pedido="pcA"]'));
    expect(avisos.perguntas[0]).toMatchObject({ titulo: "Desvincular do pedido PCI-2026-0001?", confirmarTexto: "Desvincular", perigo: true });
    expect(chamadas.filter((c) => c.metodo === "DELETE")).toHaveLength(0);
    avisos.confirmar = true;
    await clicar($('[data-desvincular-pedido="pcA"]'));
    expect(chamadas.filter((c) => c.metodo === "DELETE").map((c) => c.url)).toEqual(["/api/compras/notas/n1/vinculos?pedidoId=pcA"]);
    expect(avisos.toasts.at(-1)).toEqual(["NF desvinculada do pedido PCI-2026-0001.", "sucesso"]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("Desvincular com erro: aviso de erro e não recarrega", async () => {
    respostas["DELETE /api/compras/notas/n1/vinculos?pedidoId=pcA"] = { status: 403, corpo: { erro: "Sem permissão" } };
    await painel();
    await clicar($('[data-desvincular-pedido="pcA"]'));
    expect(avisos.toasts.at(-1)).toEqual(["Sem permissão", "erro"]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("sem Compras › gerenciar: só leitura", async () => {
    await painel({ podeGerenciar: false });
    expect($("[data-vinculo-pedido]")).toBeTruthy();
    expect($("[data-desvincular-pedido]")).toBeNull();
    expect($("[data-vincular-pedido]")).toBeNull();
    expect(txt(caixa)).toContain("Só quem tem Compras › gerenciar vincula a nota ao pedido.");
  });

  it("nada vinculado nem sugerido: o painel não aparece", async () => {
    await painel({ vinculos: [], sugestoes: [] });
    expect($("[data-pedido-da-nota]")).toBeNull();
    await act(async () => root.unmount()); caixa.remove();
    await painel({ vinculos: [], sugestoes: [SUG_B, SUG_A] });
    expect(txt($('[data-sugestao-pedido="pcB"]'))).toContain("Esta NF parece ser do Pedido PCI-2026-0002 — vincular?");
    expect(txt($('[data-sugestao-pedido="pcA"]'))).toContain("Também pode ser do Pedido PCI-2026-0001 — vincular?");
  });
});

describe("sino: NF chegou nos pedidos de quem pediu", () => {
  const ALERTAS = { prazosVencidos: 0, etapasVencendoHoje: 0, pedidosPendentes: 0, atendimentosAtraso: 0, chamadosPortal: 0, checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, boletosPagos: 0, orcamentosRespondidos: 0 };
  async function sino(alertas: Record<string, unknown>) {
    respostas["GET /api/alertas"] = { status: 200, corpo: { ...ALERTAS, ...alertas } };
    const { Header } = await import("@/components/layout/header");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const permissoes = montarPermissoes({ ordens: ["visualizar"] }); // técnico: sem Compras
    const sessao = { user: { id: "uSol", name: "Sérgio", email: "s@x.com", empresaId: "e1", role: "OPERADOR", permissoes }, expires: "2099-01-01T00:00:00Z" };
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes } as any, createElement(Header, { session: sessao, avatarUrl: null } as any)));
    await clicar([...caixa.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-bell"))!);
  }

  it("aparece para quem pediu (mesmo sem Compras) e leva ao pedido mais recente", async () => {
    await sino({ nfPedidos: 2, nfPedidoId: "pcA", total: 2 });
    const link = [...caixa.querySelectorAll("a")].find((a) => a.textContent?.includes("NF chegou nos seus pedidos"))!;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/compras/pedidos/pcA");
    expect(txt(link)).toContain("2");
    expect(txt(caixa)).not.toContain("Compras pendentes");
  });

  it("zero: não aparece", async () => {
    await sino({ nfPedidos: 0, nfPedidoId: null, prazosVencidos: 1, total: 1 });
    expect(txt(caixa)).toContain("Prazos vencidos");
    expect(txt(caixa)).not.toContain("NF chegou nos seus pedidos");
  });
});
