// @vitest-environment happy-dom
/**
 * Bloco de faturamento com partes (P5) num DOM de verdade — `BotaoFaturar` com `faturamento`:
 *  - status "A faturar" / "Parcialmente faturado" / "Faturado" (pílula), "Faturado X de T · a faturar S" e o histórico
 *    das faturas (número, parte, status, NF, valor, Abrir só para quem vê o Financeiro);
 *  - "Faturar parcial" abre o modal: total / já faturado / a faturar; por percentual (do total) ou por valor; mostra
 *    a parte e o que resta; acima do saldo → erro e botão travado; POST { parcial, parcelamento? }; toast neutro e
 *    vai direto para a emissão da NFS-e; erro do servidor fica no modal;
 *  - "Faturar" (o saldo): confirma com o saldo, POST sem corpo; faturado por inteiro: sem botões;
 *  - compacto (cabeçalho da OS): o botão enquanto há saldo, o link da última fatura quando fechou; sem permissão e
 *    sem faturas: nada. Textos sem "!", em caixa de frase (o ratchet confere o arquivo do componente).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/orc1", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: unknown };
const chamadas: { url: string; metodo: string; corpo: unknown }[] = [];
type Comp = typeof import("@/components/faturamento/botao-faturar").BotaoFaturar;
let BotaoFaturar: Comp;

beforeAll(async () => { ({ BotaoFaturar } = await import("@/components/faturamento/botao-faturar")); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.push.mockClear(); avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  resposta = { status: 201, corpo: { id: "m9", numero: "MED-2026-0013", rotulo: "Fatura 2026-0013 (parcial 25%)", jaExistia: false, parcial: { percentual: 25, valor: 250, saldoRestante: 350 } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const fat = (id: string, numero: string, valor: number, parcial: boolean, percentual: number | null, extra: Partial<{ status: string; nfNumero: string | null }> = {}) =>
  ({ id, numero, valor, parcial, percentual, status: extra.status ?? "PC_RECEBIDO", nfNumero: extra.nfNumero ?? null, criadoEm: "2026-11-01T12:00:00.000Z" });
const A_FATURAR = { total: 1000, faturado: 0, saldo: 1000, faturas: [] };
const PARCIAL = { total: 1000, faturado: 400, saldo: 600, faturas: [fat("m1", "MED-2026-0012", 400, true, 40, { status: "NF_EMITIDA", nfNumero: "123" })] };
const FATURADO = { total: 1000, faturado: 1000, saldo: 0, faturas: [fat("m1", "MED-2026-0012", 400, true, 40, { status: "PAGO" }), fat("m2", "MED-2026-0015", 600, true, 60)] };

function montar(props: Partial<Parameters<Comp>[0]> = {}) {
  if (caixa?.isConnected) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  act(() => root.render(createElement(BotaoFaturar, {
    url: "/api/orcamentos/orc1/faturar", origem: "orçamento", fatura: null, faturamento: A_FATURAR, podeFaturar: true, podeVer: true, ...props,
  })));
}
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
const posts = () => chamadas.filter((c) => c.metodo === "POST");

describe("Bloco de faturamento (P5)", () => {
  it("a faturar: pílula, \"A faturar R$ 1.000,00\", ⓘ, parcelas, \"Faturar parcial\" e \"Faturar\"; sem histórico", () => {
    montar();
    expect($("[data-secao-faturamento]")!.getAttribute("data-status-faturamento")).toBe("A_FATURAR");
    expect(txt($("[data-pill-faturamento]"))).toBe("A faturar");
    expect(txt($("[data-resumo-faturamento]"))).toMatch(/^A faturar R\$\s?1\.000,00/);
    expect($("[data-secao-faturamento] [data-dica]")).not.toBeNull();
    expect($("[data-faturar-parcelas]")).not.toBeNull();
    expect(txt($("[data-faturar-parcial]"))).toBe("Faturar parcial");
    expect(txt($("[data-faturar]"))).toBe("Faturar");
    expect($("[data-historico-faturas]")).toBeNull();
  });

  it("parcialmente faturado: \"Faturado R$ 400,00 de R$ 1.000,00 · a faturar R$ 600,00\" + histórico (parte, status, NF, valor, Abrir)", () => {
    montar({ faturamento: PARCIAL });
    expect($("[data-secao-faturamento]")!.getAttribute("data-status-faturamento")).toBe("PARCIAL");
    expect(txt($("[data-pill-faturamento]"))).toBe("Parcialmente faturado");
    expect(txt($("[data-resumo-faturamento]"))).toMatch(/^Faturado R\$\s?400,00 de R\$\s?1\.000,00 · a faturar R\$\s?600,00/);
    const linhas = $$("[data-historico-faturas] [data-fatura]");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].getAttribute("data-fatura-parcial")).toBe("1");
    expect(txt(linhas[0].querySelector("[data-rotulo-fatura]"))).toBe("Fatura 2026-0012");
    expect(txt(linhas[0].querySelector("[data-parte]"))).toBe("parcial 40%");
    expect(txt(linhas[0].querySelector("[data-tom]"))).toBe("NF emitida");
    expect(txt(linhas[0].querySelector("[data-nf]"))).toBe("NF 123");
    expect(txt(linhas[0].querySelector("[data-valor-fatura]"))).toMatch(/^R\$\s?400,00$/);
    expect(linhas[0].querySelector<HTMLAnchorElement>("[data-abrir-fatura]")!.getAttribute("href")).toBe("/financeiro/faturas/m1");
    // ainda dá para faturar o resto
    expect($("[data-faturar]")).not.toBeNull();
    expect($("[data-faturar-parcial]")).not.toBeNull();
  });

  it("faturado: pílula \"Faturado\", duas faturas no histórico, sem botões; sem ver o Financeiro, sem \"Abrir\"", () => {
    montar({ faturamento: FATURADO, podeVer: false });
    expect(txt($("[data-pill-faturamento]"))).toBe("Faturado");
    expect(txt($("[data-resumo-faturamento]"))).toMatch(/^Faturado R\$\s?1\.000,00 de R\$\s?1\.000,00$/);
    expect($$("[data-historico-faturas] [data-fatura]").map((l) => txt(l.querySelector("[data-rotulo-fatura]")))).toEqual(["Fatura 2026-0012", "Fatura 2026-0015"]);
    expect($$("[data-historico-faturas] [data-tom]").map(txt)).toEqual(["Pago", "PC recebido"]);
    expect($("[data-faturar]")).toBeNull();
    expect($("[data-faturar-parcial]")).toBeNull();
    expect($("[data-faturar-parcelas]")).toBeNull();
    expect($("[data-abrir-fatura]")).toBeNull();
  });

  it("\"Faturar parcial\": modal com total / já faturado / a faturar; por percentual DO TOTAL mostra a parte e o que resta; acima do saldo trava", async () => {
    montar({ faturamento: PARCIAL });
    await clicar($("[data-faturar-parcial]"));
    expect($("[role=dialog] h3")!.textContent).toBe("Faturar parcial — orçamento");
    expect($$("[data-resumo-parcial] dd").map(txt)).toEqual([expect.stringMatching(/1\.000,00/), expect.stringMatching(/400,00/), expect.stringMatching(/600,00/)]);
    expect($("[data-modo-parcial=percentual]")!.getAttribute("aria-pressed")).toBe("true");
    expect($<HTMLButtonElement>("[data-confirmar-parcial]")!.disabled).toBe(true);
    expect($("[data-previa-parcial]")).toBeNull();
    // 40% do total (1.000) = 400 — não 40% do saldo
    await digitar($("[data-valor-parcial]"), "40");
    expect(txt($("[data-previa-parcial]"))).toMatch(/^Esta parte: R\$\s?400,00 \(parcial 40% do total\)\. Resta a faturar R\$\s?200,00\.$/);
    expect($<HTMLButtonElement>("[data-confirmar-parcial]")!.disabled).toBe(false);
    // 70% = 700 > saldo 600 → erro e trava
    await digitar($("[data-valor-parcial]"), "70");
    expect(txt($("[role=dialog]"))).toContain("passa do saldo a faturar (600.00)");
    expect($("[data-previa-parcial]")).toBeNull();
    expect($<HTMLButtonElement>("[data-confirmar-parcial]")!.disabled).toBe(true);
    // 60% fecha a origem
    await digitar($("[data-valor-parcial]"), "60");
    expect(txt($("[data-saldo-depois]"))).toMatch(/^R\$\s?0,00$/);
    expect(posts()).toEqual([]);
  });

  it("por valor com parcelas: POST { parcial: { valor }, parcelamento }, toast neutro e vai para a emissão da NFS-e", async () => {
    montar({ faturamento: PARCIAL });
    await clicar($("[data-faturar-parcial]"));
    await clicar($("[data-modo-parcial=valor]"));
    expect($("[data-modo-parcial=valor]")!.getAttribute("aria-pressed")).toBe("true");
    expect($<HTMLInputElement>("[data-valor-parcial]")!.value).toBe("");
    await digitar($("[data-valor-parcial]"), "250");
    expect(txt($("[data-previa-parcial]"))).toMatch(/^Esta parte: R\$\s?250,00 \(parcial 25% do total\)\. Resta a faturar R\$\s?350,00\.$/);
    await escolher($("[data-parcial-parcelas]"), "2");
    resposta = { status: 201, corpo: { ...(resposta.corpo as object), parcelas: 2 } };
    await clicar($("[data-confirmar-parcial]"));
    expect(posts()).toEqual([{ url: "/api/orcamentos/orc1/faturar", metodo: "POST", corpo: { parcial: { valor: 250 }, parcelamento: { quantidade: 2 } } }]);
    expect(avisos.confirmar).not.toHaveBeenCalled(); // o modal já é a confirmação
    expect(avisos.toast).toHaveBeenCalledWith("Fatura 2026-0013 (parcial 25%) criada em 2 parcelas.", "sucesso");
    expect(nav.push).toHaveBeenCalledWith("/financeiro/faturas/m9?nfse=emitir");
  });

  it("vírgula decimal vale; erro do servidor fica no modal (sem toast, sem navegar)", async () => {
    montar({ faturamento: PARCIAL });
    await clicar($("[data-faturar-parcial]"));
    await clicar($("[data-modo-parcial=valor]"));
    await digitar($("[data-valor-parcial]"), "99,5");
    expect(txt($("[data-previa-parcial]"))).toMatch(/^Esta parte: R\$\s?99,50 \(parcial 9,95% do total\)/);
    resposta = { status: 409, corpo: { erro: "A parte (99.50) passa do saldo a faturar (50.00)." } };
    await clicar($("[data-confirmar-parcial]"));
    expect(posts()[0].corpo).toEqual({ parcial: { valor: 99.5 } });
    expect(txt($("[role=dialog]"))).toContain("A parte (99.50) passa do saldo a faturar (50.00).");
    expect(avisos.toast).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    // "Voltar" fecha
    await clicar([...$$("[role=dialog] button")].find((b) => txt(b) === "Voltar") ?? null);
    expect($("[role=dialog]")).toBeNull();
  });

  it("\"Faturar\" (o saldo): confirma com o saldo a faturar e manda POST sem corpo; o cheio sem parte anterior confirma o total", async () => {
    montar({ faturamento: PARCIAL });
    resposta = { status: 201, corpo: { id: "m8", numero: "MED-2026-0014", rotulo: "Fatura 2026-0014 (parcial 60%)", jaExistia: false } };
    await clicar($("[data-faturar]"));
    expect(avisos.confirmar.mock.calls[0][0]).toMatchObject({
      titulo: "Faturar orçamento", confirmarTexto: "Faturar",
      mensagem: expect.stringMatching(/^Gera a fatura de R\$\s?600,00 \(o saldo a faturar\), já liberada para a nota fiscal\. A conta a receber sai pelo líquido\.$/),
    });
    expect(posts()).toEqual([{ url: "/api/orcamentos/orc1/faturar", metodo: "POST", corpo: null }]);
    expect(avisos.toast).toHaveBeenCalledWith("Fatura 2026-0014 (parcial 60%) criada.", "sucesso");
    expect(nav.push).toHaveBeenCalledWith("/financeiro/faturas/m8?nfse=emitir");

    montar(); avisos.confirmar.mockClear(); chamadas.length = 0;
    await escolher($("[data-faturar-parcelas]"), "3");
    await clicar($("[data-faturar]"));
    expect((avisos.confirmar.mock.calls[0][0] as { mensagem: string }).mensagem).toMatch(/^Gera a fatura de R\$\s?1\.000,00, já liberada para a nota fiscal\. A conta a receber sai pelo líquido, em 3 parcelas mensais/);
    expect(posts()[0].corpo).toEqual({ parcelamento: { quantidade: 3 } });
  });

  it("compacto: o botão enquanto há saldo; o link da última fatura quando fechou; sem permissão e sem faturas: nada", () => {
    montar({ compacto: true, faturamento: PARCIAL });
    expect($("[data-secao-faturamento]")).toBeNull();
    expect(txt($("[data-faturar]"))).toBe("Faturar");
    montar({ compacto: true, faturamento: FATURADO });
    expect($("[data-faturar]")).toBeNull();
    expect(txt($("[data-abrir-fatura]"))).toBe("Fatura 2026-0015");
    expect($<HTMLAnchorElement>("[data-abrir-fatura]")!.getAttribute("href")).toBe("/financeiro/faturas/m2");
    montar({ compacto: true, faturamento: PARCIAL, podeFaturar: false });
    expect(txt($("[data-abrir-fatura]"))).toBe("Fatura 2026-0012");
    montar({ podeFaturar: false });
    expect(caixa.innerHTML).toBe("");
    montar({ podeFaturar: false, faturamento: PARCIAL });
    expect($("[data-faturar]")).toBeNull();
    expect($$("[data-historico-faturas] [data-fatura]")).toHaveLength(1);
  });
});
