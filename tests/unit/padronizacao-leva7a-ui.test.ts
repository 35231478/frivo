// @vitest-environment happy-dom
/**
 * Leva 7A — as telas de estoque montadas de verdade, com a API simulada. O que se prova aqui é a
 * prioridade nº 1 pelo lado da tela: quando o servidor RECUSA (403), a tela NÃO muda — nenhum saldo
 * novo, nenhum material separado, nenhuma confirmação de sucesso — e o motivo aparece.
 *
 *  - lançar movimento: sucesso vira toast da casa (com a operação e o saldo novo) e o modal fica com
 *    o saldo e o "Lançar outro"; 403 mantém o formulário, com o erro na tela e sem toast;
 *  - separação: 403 não mexe no que está na tela (nem quantidade separada, nem situação);
 *  - devolução: idem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resumoSeparacao } from "@/lib/estoque/separacao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/estoque", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ lista: [] as [string, string][], confirmar: vi.fn(async (_o?: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  toast: (m: string, t = "sucesso") => { avisos.lista.push([m, t]); },
  confirmar: avisos.confirmar,
}));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
/** A resposta do servidor para o próximo POST (o 403 é o que interessa aqui). */
let resposta: { status: number; corpo: unknown } = { status: 201, corpo: {} };

const PRODUTO = { id: "p1", nome: "Filtro G4 595x595", unidade: "un", saldo: 4 };

const M = (id: string, descricao: string, quantidade: number, separada: number, saldo: number): any => ({
  id, produtoId: `prod-${id}`, descricao, unidade: "un", quantidade, quantidadeSeparada: separada,
  estadoSeparacao: separada > 0 ? "SEPARADO" : null, osItemId: "i1", item: "Troca de filtros", kitNome: null,
  comportamento: "VENDA_A_PARTE", falta: Math.max(0, quantidade - separada),
  situacao: separada <= 0 ? "pendente" : separada < quantidade ? "parcial" : "separado",
  separadoEm: null, separadoPor: null, saldo, situacaoSaldo: saldo < 0 ? "negativo" : "ok",
  quantidadeConsumida: 0, consumidoEm: null, consumidoPor: null, pendenteDevolucao: 0,
  quantidadeDevolvida: 0, devolvidoEm: null, devolvidoPor: null, aDevolver: 0,
});
const OS = { id: "os1", numero: "OS-2026-0700", chamadoNumero: null, status: "ABERTA", descricao: "Troca de filtros", previsaoConclusao: null, cliente: "Hospital Santa Clara", unidade: null };
const MATERIAIS = [M("m1", "Filtro G4 595x595", 4, 0, 10)];
const SEPARACAO: any = { os: OS, materiais: MATERIAIS, resumo: resumoSeparacao(MATERIAIS as any) };

beforeEach(() => {
  chamadas.length = 0; avisos.lista.length = 0; avisos.confirmar.mockClear();
  avisos.confirmar.mockImplementation(async () => true);
  resposta = { status: 201, corpo: { saldo: 14, aviso: null } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function montar(el: React.ReactElement) {
  await act(async () => { root.render(el); });
  await esperar();
}

describe("lançar movimento", () => {
  async function abrir() {
    const { LancarEstoque } = await import("@/components/estoque/lancar-estoque");
    await montar(createElement(LancarEstoque, { produto: PRODUTO }));
    await clicar($("[data-lancar]"));
  }

  it("sucesso: toast da casa com a operação e o saldo novo", async () => {
    await abrir();
    await digitar($("input[name='valor']"), "10");
    await clicar($("button[type='submit']"));
    expect(chamadas.map((c) => [c.metodo, c.url])).toEqual([["POST", "/api/estoque/p1/movimentacoes"]]);
    expect(avisos.lista).toEqual([["Entrada lançada. Saldo agora: 14 un.", "sucesso"]]);
    // o modal fica com o saldo e o atalho de lançar outro (o toast some sozinho)
    expect(txt($("[data-lancamento-feito]"))).toContain("Saldo agora: 14 un");
    expect(txt($("[data-lancamento-feito]"))).toContain("Lançar outro");
  });

  it("ajuste e inventário dizem o que foram no toast", async () => {
    for (const [botao, esperado] of [["Ajuste", "Ajuste lançado"], ["Inventário", "Inventário lançado"]] as const) {
      await abrir();
      await clicar($$("button[role='tab']").find((b) => b.textContent === botao));
      await digitar($("input[name='valor']"), "7");
      await digitar($("input[name='observacao']"), "contagem do mês");
      await clicar($("button[type='submit']"));
      expect(avisos.lista.at(-1)![0]).toContain(esperado);
      act(() => root.unmount());
      caixa.remove();
      caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    }
  });

  it("403: a tela NÃO muda — sem toast, sem saldo novo, com o motivo na tela", async () => {
    resposta = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrir();
    await digitar($("input[name='valor']"), "10");
    await clicar($("button[type='submit']"));
    expect(avisos.lista).toEqual([]);
    expect($("[data-lancamento-feito]")).toBeNull();
    expect(txt($("[role='alert']"))).toBe("Sem permissão para esta ação");
    // o formulário continua como estava, com o que foi digitado
    expect($<HTMLInputElement>("input[name='valor']")!.value).toBe("10");
    expect(txt($("[data-previa]"))).toContain("saldo fica 14 un");
  });
});

describe("separação da OS", () => {
  async function abrir() {
    const { SeparacaoOs } = await import("@/components/estoque/separacao-os");
    await montar(createElement(SeparacaoOs, { inicial: SEPARACAO }));
  }
  const linha = () => $('[data-tabela-separacao] [data-material-sep="m1"]');

  it("403: nada muda na tela (nem separado, nem situação) e o erro aparece", async () => {
    resposta = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrir();
    expect(txt(linha()!.querySelector("[data-separado]"))).toBe("0");
    await clicar($$("button").find((b) => b.textContent?.includes("Confirmar separação")));
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(true);
    expect(txt(linha()!.querySelector("[data-separado]"))).toBe("0");
    expect(linha()!.getAttribute("data-situacao-material")).toBe("pendente");
    expect(avisos.lista).toEqual([]);
    expect(document.body.textContent).toContain("Sem permissão para esta ação");
  });

  it("a planilha é a da casa (zebra e cabeçalho dos tokens), com a coluna Disponível explicada no ⓘ", async () => {
    await abrir();
    const tabela = $("[data-tabela-separacao]")!;
    expect(tabela.className).toContain("border-collapse");
    expect(tabela.querySelector("thead tr")!.className).toContain("bg-surface-alt");
    expect(tabela.querySelector('button[aria-label*="Disponível"]')).toBeTruthy();
  });
});
