// @vitest-environment happy-dom
/**
 * Botão "Faturar" (orçamento aprovado / OS concluída) num DOM de verdade:
 *  - pronto para faturar: frase curta + valor + ⓘ e o botão; confirma (quantos itens e o valor), POST
 *    na rota da origem, toast e vai DIRETO para a emissão da NFS-e da fatura (?nfse=emitir);
 *  - "já faturado" do servidor: toast informativo e leva à fatura existente; erro: toast de erro, fica;
 *  - cancelar a confirmação: nada vai ao servidor;
 *  - já faturado: mostra "Fatura 2026-0012" com "Abrir" (só para quem vê o Financeiro) — nunca o botão;
 *  - sem permissão de faturar: nada; compacto (cabeçalho da OS): só o botão / o link da fatura.
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
const chamadas: { url: string; metodo: string }[] = [];
type Comp = typeof import("@/components/faturamento/botao-faturar").BotaoFaturar;
let BotaoFaturar: Comp;

beforeAll(async () => { ({ BotaoFaturar } = await import("@/components/faturamento/botao-faturar")); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.push.mockClear(); avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  resposta = { status: 201, corpo: { id: "m9", numero: "MED-2026-0012", rotulo: "Fatura 2026-0012", jaExistia: false } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET") });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
function montar(props: Partial<Parameters<Comp>[0]> = {}) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  act(() => root.render(createElement(BotaoFaturar, {
    url: "/api/orcamentos/orc1/faturar", origem: "orçamento", fatura: null, valor: 2800, itens: 3, podeFaturar: true, podeVer: true, ...props,
  })));
}
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

describe("Botão \"Faturar\"", () => {
  it("pronto para faturar: frase curta com o valor + ⓘ; confirma, POST, toast e vai direto para \"Emitir NFS-e\" da fatura", async () => {
    montar();
    expect(txt($("[data-secao-faturar] p"))).toMatch(/^Pronto para faturar · R\$\s?2\.800,00/);
    expect($("[data-secao-faturar] [data-dica]")).not.toBeNull();
    await clicar($("[data-faturar]"));
    expect(avisos.confirmar).toHaveBeenCalledWith(expect.objectContaining({
      titulo: "Faturar orçamento", confirmarTexto: "Faturar",
      mensagem: expect.stringMatching(/^Gera a fatura \(3 itens · R\$\s?2\.800,00\), já liberada para a nota fiscal\. A conta a receber sai pelo líquido\.$/),
    }));
    expect(chamadas).toEqual([{ url: "/api/orcamentos/orc1/faturar", metodo: "POST" }]);
    expect(avisos.toast).toHaveBeenCalledWith("Fatura 2026-0012 criada.", "sucesso");
    expect(nav.push).toHaveBeenCalledWith("/financeiro/faturas/m9?nfse=emitir");
  });

  it("cancelar a confirmação: nada vai ao servidor", async () => {
    avisos.confirmar.mockImplementation(async () => false);
    montar();
    await clicar($("[data-faturar]"));
    expect(chamadas).toHaveLength(0);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("servidor diz \"já faturado\": toast informativo e leva à fatura existente; erro: toast de erro e fica", async () => {
    resposta = { status: 200, corpo: { id: "m1", numero: "MED-2026-0003", rotulo: "Fatura 2026-0003", jaExistia: true } };
    montar({ url: "/api/ordens/os1/faturar", origem: "OS", valor: null, itens: null });
    await clicar($("[data-faturar]"));
    expect(avisos.confirmar.mock.calls[0][0]).toMatchObject({ titulo: "Faturar OS", mensagem: "Gera a fatura, já liberada para a nota fiscal. A conta a receber sai pelo líquido." });
    expect(avisos.toast).toHaveBeenCalledWith("Já faturado: Fatura 2026-0003.", "info");
    expect(nav.push).toHaveBeenCalledWith("/financeiro/faturas/m1?nfse=emitir");

    act(() => root.unmount()); caixa.remove(); nav.push.mockClear(); avisos.toast.mockClear();
    resposta = { status: 409, corpo: { erro: "Conclua a OS antes de faturar." } };
    montar({ url: "/api/ordens/os1/faturar", origem: "OS" });
    await clicar($("[data-faturar]"));
    expect(avisos.toast).toHaveBeenCalledWith("Conclua a OS antes de faturar.", "erro");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("já faturado: \"Faturado: Fatura 2026-0012\" com Abrir (Financeiro) — nunca o botão; medição comum aparece como medição", () => {
    montar({ fatura: { id: "m9", numero: "MED-2026-0012", avulsa: true } });
    expect($("[data-faturar]")).toBeNull();
    expect(txt($("[data-fatura-da-origem] p"))).toBe("Faturado: Fatura 2026-0012");
    expect($<HTMLAnchorElement>("[data-abrir-fatura]")!.getAttribute("href")).toBe("/financeiro/faturas/m9");
    act(() => root.unmount()); caixa.remove();
    montar({ fatura: { id: "m2", numero: "MED-2026-0002", avulsa: false }, podeVer: false });
    expect(txt($("[data-rotulo-fatura]"))).toBe("Medição MED-2026-0002");
    expect($("[data-abrir-fatura]")).toBeNull();
  });

  it("sem permissão de faturar: nada; compacto (cabeçalho da OS): só o botão, ou o link da fatura", () => {
    montar({ podeFaturar: false });
    expect(caixa.innerHTML).toBe("");
    act(() => root.unmount()); caixa.remove();
    montar({ compacto: true });
    expect($("[data-secao-faturar]")).toBeNull();
    expect(txt($("[data-faturar]"))).toBe("Faturar");
    act(() => root.unmount()); caixa.remove();
    montar({ compacto: true, fatura: { id: "m9", numero: "MED-2026-0012", avulsa: true } });
    expect(txt($("[data-abrir-fatura]"))).toBe("Fatura 2026-0012");
  });
});

describe("Fatura avulsa: documento e envio dizem \"Fatura\" (D1)", () => {
  it("documento: cabeçalho \"Fatura\" + 2026-0012, \"A emitir\" e \"Faturamento avulso\"; a medição comum segue igual", async () => {
    const { MedicaoDocumento } = await import("@/components/medicao/medicao-documento");
    const med = { numero: "MED-2026-0012", tipo: "ADICIONAL", status: "PC_RECEBIDO", criadoEm: "2026-10-30", valorTotal: 100, descontoValor: 0, descontoPercent: 0, valorLiquido: 100, itens: [] };
    const empresa = { nome: "Clima Total", cnpj: "12345678000190" } as any;
    const cliente = { nome: "Hospital", cpfCnpj: "11222333000181" } as any;
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    act(() => root.render(createElement(MedicaoDocumento, { medicao: { ...med, avulsa: true }, empresa, cliente })));
    expect(txt(caixa.querySelector(".text-right.shrink-0"))).toBe("Fatura2026-0012A emitir");
    expect(txt(caixa)).toContain("Faturamento avulso");
    act(() => root.render(createElement(MedicaoDocumento, { medicao: med, empresa, cliente })));
    expect(txt(caixa.querySelector(".text-right.shrink-0"))).toBe("MediçãoMED-2026-0012PC recebido");
  });

  it("envio (e-mail/WhatsApp do link público): \"Fatura nº 2026-0012\" no assunto e no texto", async () => {
    const { MedicaoEnvio } = await import("@/components/medicao/medicao-envio");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    act(() => root.render(createElement(MedicaoEnvio, { token: "tk", numero: "MED-2026-0012", avulsa: true, empresaNome: "Clima Total", emailDestino: "fin@h.com" })));
    const mailto = decodeURIComponent(caixa.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!.getAttribute("href")!);
    expect(mailto).toContain("subject=Fatura nº 2026-0012 — Clima Total");
    expect(mailto).toContain("Segue a fatura nº 2026-0012:");
    expect(mailto).not.toContain("MED-");
    act(() => root.render(createElement(MedicaoEnvio, { token: "tk", numero: "MED-2026-0012", empresaNome: "Clima Total" })));
    expect(decodeURIComponent(caixa.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!.getAttribute("href")!)).toContain("subject=Medição MED-2026-0012 — Clima Total");
  });
});
