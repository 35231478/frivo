// @vitest-environment happy-dom
/**
 * Leva 8A — as ações da conta a pagar num DOM de verdade (happy-dom), API simulada.
 *
 *  - quem só VISUALIZA o financeiro vê a ficha e o histórico, mas não vê registrar pagamento,
 *    editar nem cancelar — nem na ficha, nem no ⋮ da lista;
 *  - com Financeiro › fluxo de caixa os três aparecem;
 *  - cancelar pergunta antes, e quando o servidor recusa (403) a TELA NÃO MUDA: sem refresh, com o
 *    motivo em toast de erro;
 *  - pagamento: sucesso vira toast com o valor e o saldo que fica (ou "conta quitada"); o erro de
 *    validação fica na tela, e nada é confirmado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {} }) }));
const avisos = vi.hoisted(() => ({ lista: [] as [string, string][], confirmar: vi.fn(async (_o?: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  toast: (m: string, t = "sucesso") => { avisos.lista.push([m, t]); },
  confirmar: avisos.confirmar,
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const CONTA = { id: "cp1", numero: "CP-2026-0118", fornecedor: "Clima Peças", valorTotal: 1000, valorPago: 0, saldoRestante: 1000, status: "PENDENTE" };

beforeEach(() => {
  chamadas.length = 0; avisos.lista.length = 0;
  avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  nav.push.mockClear(); nav.refresh.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : null });
    const r = Object.entries(respostas).find(([k]) => url.startsWith(k))?.[1] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(permissoes: Permissoes, props: Record<string, unknown> = {}) {
  const { ContaPagarAcoes } = await import("@/components/financeiro/conta-pagar-acoes");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  const acoes = createElement(ContaPagarAcoes, { conta: CONTA, ...props } as any);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: acoes }));
  });
  await act(async () => {});
}

const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const doc = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
/** O menu de ações abre num portal (fora da caixa do teste): os itens vêm pelo id de cada um. */
const itensDoMenu = () => [...document.querySelectorAll("[data-menu-acoes] [data-item]")].map((e) => e.getAttribute("data-item"));
/** formatarMoeda separa "R$" do número com espaço fino. */
const semNbsp = (t: string) => t.replace(/ /g, " ");

const SO_VE = montarPermissoes({ financeiro: ["visualizar"] });

describe("o que mexe em dinheiro só aparece para quem pode", () => {
  it("na ficha: quem só visualiza vê o histórico, e mais nada", async () => {
    await montar(SO_VE);
    expect($("[data-historico-pagamentos]")).not.toBeNull();
    expect($("[data-registrar-pagamento]")).toBeNull();
    expect($("[data-editar-conta]")).toBeNull();
    expect($("[data-cancelar-conta]")).toBeNull();
  });

  it("na ficha: com Financeiro › fluxo de caixa, os três aparecem", async () => {
    await montar(permissoesTotais());
    expect($("[data-registrar-pagamento]")).not.toBeNull();
    expect($("[data-editar-conta]")!.getAttribute("href")).toBe("/financeiro/contas-pagar/cp1/editar");
    expect($("[data-cancelar-conta]")).not.toBeNull();
  });

  it("no ⋮ da lista: quem só visualiza vê ver detalhes e histórico, sem pagar/editar/cancelar", async () => {
    await montar(SO_VE, { menu: true });
    await clicar($("button[aria-label^='Ações']"));
    expect(itensDoMenu()).toEqual(["detalhes", "historico"]);
  });

  it("no ⋮ da lista: com a permissão, o menu traz as ações de dinheiro", async () => {
    await montar(permissoesTotais(), { menu: true });
    await clicar($("button[aria-label^='Ações']"));
    expect(itensDoMenu()).toEqual(["detalhes", "pagar", "historico", "editar", "cancelar"]);
  });

  it("conta já paga: nem com permissão aparece pagar ou editar (só o histórico)", async () => {
    await montar(permissoesTotais(), { conta: { ...CONTA, status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 } });
    expect($("[data-registrar-pagamento]")).toBeNull();
    expect($("[data-editar-conta]")).toBeNull();
    expect($("[data-historico-pagamentos]")).not.toBeNull();
  });
});

describe("cancelar: pergunta antes e respeita a resposta do servidor", () => {
  it("403: a tela NÃO muda — sem refresh, com o motivo em toast de erro", async () => {
    await montar(permissoesTotais());
    respostas["/api/contas-pagar/cp1"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($("[data-cancelar-conta]"));
    expect(avisos.confirmar).toHaveBeenCalled();
    expect(chamadas.at(-1)!.metodo).toBe("DELETE");
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(avisos.lista).toEqual([["Sem permissão para esta ação", "erro"]]);
  });

  it("recusar a confirmação não chama o servidor", async () => {
    await montar(permissoesTotais());
    avisos.confirmar.mockImplementation(async () => false);
    await clicar($("[data-cancelar-conta]"));
    expect(chamadas).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("deu certo: toast com o número da conta e a tela atualiza", async () => {
    await montar(permissoesTotais());
    respostas["/api/contas-pagar/cp1"] = { status: 200, corpo: { ok: true } };
    await clicar($("[data-cancelar-conta]"));
    expect(avisos.lista).toEqual([["Conta CP-2026-0118 cancelada.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("a confirmação diz o que acontece (fica no histórico; o que foi pago não é desfeito)", async () => {
    await montar(permissoesTotais());
    await clicar($("[data-cancelar-conta]"));
    const o = avisos.confirmar.mock.calls[0][0] as { mensagem: string; perigo?: boolean };
    expect(o.mensagem).toContain("fica no histórico como cancelada");
    expect(o.mensagem).toContain("o que já foi pago não é desfeito");
    expect(o.perigo).toBe(true);
  });
});

describe("registrar pagamento", () => {
  const abrir = async () => {
    await montar(permissoesTotais());
    await clicar($("[data-registrar-pagamento]"));
  };
  const botao = (texto: string) => [...document.querySelectorAll("button")].find((b) => txt(b).includes(texto))!;

  it("parcial: toast com o valor e o saldo que fica", async () => {
    await abrir();
    const valor = doc<HTMLInputElement>('input[type="number"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(valor, "400");
      valor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    respostas["/api/contas-pagar/cp1/pagamentos"] = { status: 201, corpo: { ok: true } };
    await clicar(botao("Registrar pagamento"));
    expect(chamadas.at(-1)!.corpo.valor).toBe(400);
    expect(semNbsp(avisos.lista.at(-1)![0])).toBe("Pagamento de R$ 400,00 registrado. Saldo de R$ 600,00.");
  });

  it("total: o toast diz que a conta foi quitada", async () => {
    await abrir();
    respostas["/api/contas-pagar/cp1/pagamentos"] = { status: 201, corpo: { ok: true } };
    await clicar(botao("Registrar pagamento"));
    expect(semNbsp(avisos.lista.at(-1)![0])).toBe("Pagamento de R$ 1.000,00 registrado. Conta quitada.");
  });

  it("403 do servidor: o erro fica na tela, sem toast e sem refresh", async () => {
    await abrir();
    respostas["/api/contas-pagar/cp1/pagamentos"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    nav.refresh.mockClear();
    await clicar(botao("Registrar pagamento"));
    expect(txt(doc("[role='dialog']"))).toContain("Sem permissão para esta ação");
    expect(avisos.lista).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});
