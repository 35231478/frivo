// @vitest-environment happy-dom
/**
 * Leva I.2 — grupo B, as telas num DOM de verdade:
 *  5. medição/fatura: o item da tabela do cliente aparece travado (cadeado, sem campo) para quem não tem "Alterar
 *     preço de tabela", com o preço já gravado; com a permissão, mudar o preço faz aparecer o motivo, que é exigido
 *     antes de salvar e vai no corpo; o 400 do servidor ({ precoTabela }) também abre o campo do motivo;
 *  6. editor da tabela de preço: "Reajustar preços" (todos ou os marcados) abre o modal; a prévia vem do servidor
 *     (item, atual → novo) antes de aplicar; o motivo é exigido; aplicar recarrega os itens; "Desfazer reajuste" com a
 *     confirmação e o aviso dos itens que ficam; quem não edita tabela não vê nada disso; com alteração não salva, os
 *     botões ficam desligados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roteador = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => roteador, usePathname: () => "/financeiro/medicoes", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

type Resposta = { status?: number; corpo: unknown };
let raiz: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
/** "METODO url-prefixo" → resposta (a primeira que casar) */
let rotas: [string, (corpo: any) => Resposta][] = [];

beforeEach(() => {
  chamadas.length = 0; rotas = []; roteador.push.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    chamadas.push({ url: String(url), metodo, corpo });
    const r = rotas.find(([k]) => { const [m, u] = k.split(" "); return m === metodo && String(url).startsWith(u); });
    const res = r ? r[1](corpo) : { corpo: [] };
    return new Response(JSON.stringify(res.corpo), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
  }));
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement) { raiz = createRoot(caixa); await act(async () => { raiz!.render(el); }); await esperar(); }
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLSelectElement).value = v; el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
const tela = () => document.body.textContent ?? "";
const botao = (texto: string) => $$<HTMLButtonElement>("button").find((b) => b.textContent?.trim() === texto);

async function comPermissoes(filho: ReactElement, role: string, lista: Record<string, string[]> = {}) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { montarPermissoes } = await import("@/lib/permissoes");
  return createElement(PermissoesProvider, { role, permissoes: montarPermissoes(lista as any), children: filho } as any);
}

describe("5. medição/fatura — preço de tabela travado na tela", () => {
  const TABELA = { id: "tab", nome: "Contrato fictício", tipo: "CONTRATO", itens: { sLimp: { valorFinal: 150, tipoPreco: "VALOR_FIXO", descontoPercent: null } } };
  const inicial = {
    id: "m1", numero: "MED-0007", clienteId: "c1", tipo: "ADICIONAL", descontoValor: 0, descontoPercent: 0,
    servicos: [{ id: "i1", catalogoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: 120 }], produtos: [],
  };
  async function abrir(role: string, lista?: Record<string, string[]>) {
    rotas.push(["GET /api/clientes/c1/tabela-preco", () => ({ corpo: TABELA })]);
    const { MedicaoForm } = await import("@/components/medicao/medicao-form");
    await montar(await comPermissoes(createElement(MedicaoForm, { mode: "editar", clientes: [{ id: "c1", nome: "Hospital Fictício" }], catalogoServicos: [], catalogoProdutos: [], inicial } as any), role, lista));
  }
  const salvar = async () => {
    await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await esperar();
  };
  const put = () => chamadas.filter((c) => c.metodo === "PUT" && c.url === "/api/medicoes/m1");

  it("sem a permissão: travado com cadeado, mantém o preço gravado e salva sem motivo", async () => {
    rotas.push(["PUT /api/medicoes/m1", () => ({ corpo: { id: "m1" } })]);
    await abrir("OPERADOR", { financeiro: ["visualizar", "medicoes"] });
    expect($("[data-trava-tabela]")!.textContent).toBe("Preços da tabela travados");
    expect($('[data-campo="unitario"]')).toBeNull();
    expect($('[title="Preço definido em contrato — não pode ser alterado"]')).toBeTruthy();
    expect(tela()).toContain("120,00");
    expect($("[data-motivo-preco-tabela]")).toBeNull();
    await salvar();
    expect(put()[0].corpo).toMatchObject({ motivoPrecoTabela: null, itens: [{ servicoId: "sLimp", valorUnitario: 120 }] });
  });

  it("com a permissão: o campo abre; mudar o preço pede o motivo antes de salvar, e o motivo vai no corpo", async () => {
    rotas.push(["PUT /api/medicoes/m1", () => ({ corpo: { id: "m1" } })]);
    await abrir("ADMIN");
    expect($("[data-trava-tabela]")!.textContent).toBe("Mudar o preço da tabela pede motivo");
    await digitar($('[data-campo="unitario"]'), "110");
    expect($("[data-motivo-preco-tabela]")!.textContent).toContain("Fora da tabela: Limpeza");
    await salvar();
    expect(put()).toHaveLength(0);
    expect(tela()).toContain("Informe o motivo da alteração do preço de tabela.");
    await digitar($("[data-motivo-preco-tabela] input"), "Desconto negociado em reunião");
    await salvar();
    expect(put()[0].corpo).toMatchObject({ motivoPrecoTabela: "Desconto negociado em reunião", itens: [{ valorUnitario: 110 }] });
    expect(roteador.push).toHaveBeenCalledWith("/financeiro/medicoes/m1");
  });

  it("o servidor pediu o motivo (400 precoTabela): o campo aparece mesmo sem a conta da tela pedir", async () => {
    rotas.push(["PUT /api/medicoes/m1", () => ({ status: 400, corpo: { erro: "Informe o motivo da alteração do preço de tabela (Limpeza).", precoTabela: true } })]);
    await abrir("ADMIN");
    expect($("[data-motivo-preco-tabela]")).toBeNull();
    await salvar();
    expect($("[data-motivo-preco-tabela]")).toBeTruthy();
    expect(tela()).toContain("Informe o motivo da alteração do preço de tabela (Limpeza).");
  });
});

describe("6. editor da tabela de preço — reajuste em massa", () => {
  const ITENS = [
    { id: "li1", servicoId: "s1", tipoPreco: "VALOR_FIXO", valorFixo: 150, valorFinal: 150, servico: { id: "s1", nome: "Limpeza", valorPadrao: 200, ativo: true } },
    { id: "li2", servicoId: "s2", tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10, valorFinal: 900, servico: { id: "s2", nome: "Instalação", valorPadrao: 1000, ativo: true } },
  ];
  const LOTE = { id: "lote1", tipo: "PERCENTUAL", valor: 8, motivo: "Reajuste anual do contrato", criadoEm: "2026-11-20T13:00:00.000Z", usuarioNome: "Ana Fictícia", itens: 2 };
  let ultimo: unknown = null;
  async function abrir(role: string, lista?: Record<string, string[]>) {
    rotas.push(
      ["GET /api/cadastros/tabelas-preco/t1/reajustes", () => ({ corpo: { ultimo } })],
      ["GET /api/cadastros/tabelas-preco/t1", () => ({ corpo: { id: "t1", nome: "Contrato fictício", itens: ITENS } })],
      ["POST /api/cadastros/tabelas-preco/t1/reajustes/desfazer", (c) => ({ corpo: { ok: true, previa: c.previa, lote: LOTE, plano: {
        voltam: [{ itemId: "li1", descricao: "Limpeza", atual: 162, preco: { tipoPreco: "VALOR_FIXO", valorFixo: 150, descontoPercent: null, valorFinal: 150 } }],
        ignorados: [{ descricao: "Instalação", motivo: "alterado" }],
      } } })],
      ["POST /api/cadastros/tabelas-preco/t1/reajustes", (c) => (c.previa === false && String(c.motivo ?? "").trim().length < 5
        ? { status: 400, corpo: { erro: "Informe o motivo do reajuste (ao menos 5 caracteres)." } }
        : { status: c.previa ? 200 : 201, corpo: { ok: true, previa: c.previa, linhas: [{ itemId: "li1", servicoId: "s1", produtoId: null, descricao: "Limpeza", antes: { valorFinal: 150 }, depois: { valorFinal: 165 } }] } })],
    );
    const { EditorTabelaPreco } = await import("@/components/cadastros/editores/editor-tabela-preco");
    await montar(await comPermissoes(createElement(EditorTabelaPreco, { item: { id: "t1", nome: "Contrato fictício", tipo: "CONTRATO", ativo: true }, aberto: true, onFechar: () => {}, onSalvo: () => {} } as any), role, lista));
  }
  beforeEach(() => { ultimo = null; });

  it("quem não edita tabela de preço não vê o reajuste nem as caixas", async () => {
    await abrir("OPERADOR", { configuracoes: ["visualizar"] });
    expect(tela()).toContain("Limpeza");
    expect($("[data-reajustar-precos]")).toBeNull();
    expect($("[data-sel-reajuste]")).toBeNull();
    expect(chamadas.some((c) => c.url.includes("/reajustes"))).toBe(false);
  });

  it("reajustar os marcados: prévia do servidor (atual → novo), o motivo exigido, aplicar e recarregar", async () => {
    await abrir("OPERADOR", { configuracoes: ["visualizar", "gerenciar"] });
    expect(botao("Reajustar preços")).toBeTruthy();
    expect($("[data-desfazer-reajuste]")).toBeNull(); // sem lote
    await clicar($('[data-sel-reajuste="li1"]'));
    expect($("[data-reajustar-precos]")!.textContent).toContain("Reajustar selecionados (1)");
    await clicar($("[data-reajustar-precos]"));
    expect($("[data-abrangencia]")!.textContent).toBe("1 item selecionado.");
    await digitar($("[data-valor-reajuste]"), "10");
    await clicar($("[data-ver-previa]"));
    const previa = chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/reajustes"))!;
    expect(previa.corpo).toMatchObject({ tipo: "PERCENTUAL", valor: 10, previa: true, itemIds: ["li1"] });
    expect($$("[data-linha-previa]").map((l) => l.textContent?.replace(/\s/g, " "))).toEqual(["LimpezaR$ 150,00R$ 165,00"]);
    // Aplicar sem motivo: a tela recusa antes de mandar
    const n = chamadas.length;
    await clicar($("[data-aplicar-reajuste]"));
    expect(tela()).toContain("Informe o motivo do reajuste");
    expect(chamadas.length).toBe(n);
    await digitar($("[data-motivo-reajuste]"), "Reajuste anual do contrato");
    // Mudar o valor apaga a prévia (ela deixa de valer)
    await digitar($("[data-valor-reajuste]"), "12");
    expect($("[data-aplicar-reajuste]")).toBeNull();
    await clicar($("[data-ver-previa]"));
    await clicar($("[data-aplicar-reajuste]"));
    const aplicar = chamadas.filter((c) => c.metodo === "POST" && c.url.endsWith("/reajustes")).at(-1)!;
    expect(aplicar.corpo).toEqual({ tipo: "PERCENTUAL", valor: 12, previa: false, motivo: "Reajuste anual do contrato", itemIds: ["li1"] });
    expect($("[data-modal-reajuste]")).toBeNull();
    // Os itens e o último lote vêm de novo do servidor
    expect(chamadas.filter((c) => c.metodo === "GET" && c.url === "/api/cadastros/tabelas-preco/t1")).toHaveLength(2);
    expect(chamadas.filter((c) => c.metodo === "GET" && c.url.endsWith("/reajustes"))).toHaveLength(2);
  });

  it("sem marcar: todos os itens, em R$; com alteração não salva, os botões ficam desligados", async () => {
    ultimo = LOTE;
    await abrir("ADMIN");
    await clicar($("[data-reajustar-precos]"));
    expect($("[data-abrangencia]")!.textContent).toBe("Todos os itens da tabela.");
    await escolher($("[data-tipo-reajuste]"), "VALOR");
    await digitar($("[data-valor-reajuste]"), "-5");
    await clicar($("[data-ver-previa]"));
    expect(chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/reajustes"))!.corpo).toEqual({ tipo: "VALOR", valor: -5, motivo: "", previa: true });
    await clicar($$<HTMLButtonElement>("[data-modal-reajuste] button").find((b) => b.textContent?.trim() === "Cancelar"));
    // Mexer num preço sem salvar: reajustar e desfazer desligam (o reajuste vale sobre o gravado)
    const valor = $$<HTMLInputElement>('input[type="number"]').find((i) => i.value === "150")!;
    await digitar(valor, "151");
    expect(($("[data-reajustar-precos]") as HTMLButtonElement).disabled).toBe(true);
    expect(($("[data-desfazer-reajuste]") as HTMLButtonElement).disabled).toBe(true);
    await digitar(valor, "150");
    expect(($("[data-reajustar-precos]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("desfazer: confirmação com o lote, os itens que voltam e o aviso dos que ficam; confirmar desfaz e recarrega", async () => {
    ultimo = LOTE;
    await abrir("ADMIN");
    await clicar($("[data-desfazer-reajuste]"));
    expect(chamadas.at(-1)).toMatchObject({ metodo: "POST", url: "/api/cadastros/tabelas-preco/t1/reajustes/desfazer", corpo: { previa: true } });
    const modal = $("[data-modal-desfazer]")!;
    expect(modal.textContent).toContain("+8%");
    expect(modal.textContent).toContain("Ana Fictícia");
    expect(modal.textContent).toContain("Motivo: Reajuste anual do contrato");
    expect($("[data-aviso-desfazer]")!.textContent).toBe("Instalação foi alterado depois do reajuste: fica como está.");
    expect($$("[data-linha-previa]").map((l) => l.textContent?.replace(/\s/g, " "))).toEqual(["LimpezaR$ 162,00R$ 150,00"]);
    ultimo = null;
    await clicar($("[data-confirmar-desfazer]"));
    expect(chamadas.filter((c) => c.url.endsWith("/desfazer")).at(-1)!.corpo).toEqual({ previa: false });
    expect($("[data-modal-desfazer]")).toBeNull();
    expect($("[data-desfazer-reajuste]")).toBeNull(); // o lote recarregado: não há outro
  });
});
