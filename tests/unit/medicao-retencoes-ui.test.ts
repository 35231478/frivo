// @vitest-environment happy-dom
/**
 * Retenções da medição, num DOM de verdade:
 *  - nada gravado + serviços que retêm (cadastro) → a retenção aparece marcada (com a alíquota),
 *    o resto desmarcado; o usuário confirma salvando (nada vai ao servidor sozinho);
 *  - resumo discreto: uma linha ("Retenções: ISS retido 5% (−R$ …) · Líquido a receber R$ …"); sem
 *    retenção, só o líquido; "Editar" abre o editor e, salvo/cancelado, volta ao resumo;
 *  - marcar IR com alíquota mostra cada retenção e o líquido na hora; salvar manda as alíquotas;
 *  - alíquota vazia não vai ao servidor; erro do servidor aparece no card;
 *  - bloqueio (boleto emitido…) e sem permissão: tudo apagado, sem botão.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: () => {} }) }));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast }));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: unknown };
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let Comp: typeof import("@/components/medicao/medicao-retencoes").MedicaoRetencoes;
let Resumo: typeof import("@/components/medicao/medicao-retencoes").ResumoRetencoes;

beforeAll(async () => { ({ MedicaoRetencoes: Comp, ResumoRetencoes: Resumo } = await import("@/components/medicao/medicao-retencoes")); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.refresh.mockClear(); avisos.toast.mockClear();
  resposta = { status: 200, corpo: { ok: true, contaReceber: { id: "cr1", numero: "CR-2026-0001", valor: 935 } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method), corpo: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const SEM = { retencoes: {}, parciais: [], aliquotas: {} };
const COM_ISS = { retencoes: { iss: 5 }, parciais: [], aliquotas: { iss: 5 } };
function montar(props: Partial<Parameters<typeof Comp>[0]> = {}) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  act(() => root.render(createElement(Comp, { medicaoId: "m1", base: 1000, gravadas: {}, sugestao: SEM, podeEditar: true, bloqueio: null, ...props })));
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T;
const marcar = (k: string) => act(() => { $<HTMLInputElement>(`[data-marcar="${k}"]`).click(); });
function digitar(k: string, valor: string) {
  const el = $<HTMLInputElement>(`[data-aliquota="${k}"]`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const marcadas = () => [...caixa.querySelectorAll<HTMLInputElement>("[data-marcar]")].filter((i) => i.checked).map((i) => i.dataset.marcar);

describe("Retenções da medição", () => {
  it("nada gravado + ISS retido na nota → ISS já marcado com a alíquota; federais desmarcados; nada enviado", () => {
    montar({ sugestao: COM_ISS });
    expect(marcadas()).toEqual(["iss"]);
    expect($<HTMLInputElement>('[data-aliquota="iss"]').value).toBe("5");
    expect($("[data-liquido]").textContent).toMatch(/950,00/);
    expect(chamadas).toHaveLength(0);
    expect($<HTMLButtonElement>("[data-salvar-retencoes]").disabled).toBe(false);
  });

  it("já gravado: mostra o que está gravado (a sugestão não sobrepõe); sem mudança, salvar fica apagado", () => {
    montar({ gravadas: { ir: 1.5 }, sugestao: COM_ISS });
    expect(marcadas()).toEqual(["ir"]);
    expect($<HTMLInputElement>('[data-aliquota="ir"]').value).toBe("1,5");
    expect($<HTMLButtonElement>("[data-salvar-retencoes]").disabled).toBe(true);
  });

  it("marcar IR 1,5% mostra a retenção e o líquido na hora; salvar manda as alíquotas, toast e refresh", async () => {
    montar();
    expect(marcadas()).toEqual([]);
    expect($("[data-liquido]").textContent).toMatch(/1\.000,00/);
    marcar("ir");
    digitar("ir", "1,5");
    expect($('[data-retencao="ir"]').textContent).toMatch(/− R\$\s?15,00/);
    expect($("[data-detalhamento]").textContent).toMatch(/IR− R\$\s?15,00/);
    expect($("[data-liquido]").textContent).toMatch(/985,00/);
    act(() => { $<HTMLButtonElement>("[data-salvar-retencoes]").click(); });
    await esperar();
    expect(chamadas).toEqual([{ url: "/api/medicoes/m1/retencoes", metodo: "PUT", corpo: { iss: null, ir: 1.5, pis: null, cofins: null, csll: null, inss: null } }]);
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/^Retenções salvas\. CR-2026-0001: R\$\s?935,00\.$/));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("marcada sem alíquota não vai ao servidor; erro do servidor aparece no card", async () => {
    montar();
    marcar("pis");
    act(() => { $<HTMLButtonElement>("[data-salvar-retencoes]").click(); });
    await esperar();
    expect(chamadas).toHaveLength(0);
    expect($("[data-erro-retencoes]").textContent).toBe("Informe a alíquota de cada retenção marcada.");

    digitar("pis", "0,65");
    resposta = { status: 409, corpo: { erro: "Boleto emitido: cancele o boleto antes de mudar as retenções." } };
    act(() => { $<HTMLButtonElement>("[data-salvar-retencoes]").click(); });
    await esperar();
    expect($("[data-erro-retencoes]").textContent).toBe("Boleto emitido: cancele o boleto antes de mudar as retenções.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("bloqueio ou sem permissão: caixas apagadas, sem botão; o bloqueio é explicado", () => {
    montar({ gravadas: { iss: 5 }, bloqueio: "Boleto emitido: cancele o boleto para mudar as retenções." });
    expect([...caixa.querySelectorAll<HTMLInputElement>("[data-marcar]")].every((i) => i.disabled)).toBe(true);
    expect($("[data-salvar-retencoes]")).toBeNull();
    expect($("[data-bloqueio-retencoes]").textContent).toContain("Boleto emitido");
    act(() => root.unmount()); caixa.remove();
    montar({ podeEditar: false });
    expect($("[data-salvar-retencoes]")).toBeNull();
    expect($<HTMLInputElement>('[data-marcar="iss"]').disabled).toBe(true);
  });
});

describe("Resumo discreto das retenções (faturamento)", () => {
  function montarResumo(props: Partial<Parameters<typeof Resumo>[0]> = {}) {
    caixa = document.createElement("div");
    document.body.appendChild(caixa);
    root = createRoot(caixa);
    act(() => root.render(createElement(Resumo, { medicaoId: "m1", base: 2800, gravadas: {}, sugestao: SEM, podeEditar: true, bloqueio: null, ...props })));
  }
  const limpo = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();

  it("uma linha: \"Retenções: ISS retido 5% (−R$ 140,00) · Líquido a receber R$ 2.660,00\"; sem o card grande", () => {
    montarResumo({ gravadas: { iss: 5 }, sugestao: COM_ISS });
    expect(limpo($("[data-resumo-retencoes] p").textContent)).toMatch(/^Retenções: ISS retido 5% \(−R\$ 140,00\) · Líquido a receber R\$ 2\.660,00$/);
    expect($("[data-retencoes]")).toBeNull();
    expect($("[data-marcar]")).toBeNull();
  });

  it("serviço sem retenção: só o líquido (= bruto), sem poluir", () => {
    montarResumo();
    expect(limpo($("[data-resumo-retencoes] p").textContent)).toMatch(/^Líquido a receber R\$ 2\.800,00$/);
    expect($("[data-resumo-linhas]")).toBeNull();
    expect($("[data-nao-aplicadas]")).toBeNull();
  });

  it("\"Editar\" abre o editor completo (6 linhas, já com o gravado); Cancelar/✕ volta ao resumo sem gravar", () => {
    montarResumo({ gravadas: { iss: 5 }, sugestao: COM_ISS });
    act(() => { $<HTMLButtonElement>("[data-editar-retencoes]").click(); });
    expect(caixa.querySelectorAll("[data-retencao]")).toHaveLength(6);
    expect(marcadas()).toEqual(["iss"]);
    expect($("[data-resumo-retencoes]")).toBeNull();
    act(() => { $<HTMLButtonElement>("[data-fechar-retencoes]").click(); });
    expect($("[data-resumo-retencoes]")).not.toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it("exceção: Editar → marca IR 1,5% → salvar grava, refresca e volta ao resumo", async () => {
    montarResumo({ gravadas: { iss: 5 }, sugestao: COM_ISS });
    act(() => { $<HTMLButtonElement>("[data-editar-retencoes]").click(); });
    marcar("ir");
    digitar("ir", "1,5");
    expect($("[data-liquido]").textContent).toMatch(/2\.618,00/);
    act(() => { $<HTMLButtonElement>("[data-salvar-retencoes]").click(); });
    await esperar();
    expect(chamadas[0].corpo).toEqual({ iss: 5, ir: 1.5, pis: null, cofins: null, csll: null, inss: null });
    expect(nav.refresh).toHaveBeenCalled();
    expect($("[data-resumo-retencoes]")).not.toBeNull();
  });

  it("medição antiga (nada gravado) com serviço que retém: avisa que não foi aplicada; parcial também avisa", () => {
    montarResumo({ sugestao: COM_ISS });
    expect(limpo($("[data-resumo-retencoes] p").textContent)).toContain("Líquido a receber R$ 2.800,00");
    expect($("[data-nao-aplicadas]").textContent).toBe("Serviço com ISS retido não aplicado. Confira em Editar.");
    act(() => root.unmount()); caixa.remove();
    montarResumo({ sugestao: { retencoes: {}, parciais: ["iss", "ir"], aliquotas: { iss: 5 } } });
    expect($("[data-parciais]").textContent).toBe("Só parte dos serviços retém ISS retido, IR. Confira em Editar.");
  });

  it("com produto (fora da nota): retenção sobre a nota, mas o líquido a receber é o da medição inteira", () => {
    montarResumo({ base: 1000, liquido: 1500, gravadas: { iss: 5 } });
    expect(limpo($("[data-resumo-retencoes] p").textContent)).toMatch(/^Retenções: ISS retido 5% \(−R\$ 50,00\) · Líquido a receber R\$ 1\.450,00$/);
    act(() => { $<HTMLButtonElement>("[data-editar-retencoes]").click(); });
    expect($("[data-bruto]")!.textContent).toMatch(/1\.000,00/);
    expect($("[data-produtos]")!.textContent).toMatch(/500,00/);
    expect($("[data-liquido]")!.textContent).toMatch(/1\.450,00/);
  });

  it("sem permissão ou travado (boleto emitido): sem \"Editar\"", () => {
    montarResumo({ gravadas: { iss: 5 }, podeEditar: false });
    expect($("[data-editar-retencoes]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    montarResumo({ gravadas: { iss: 5 }, bloqueio: "Boleto emitido: cancele o boleto para mudar as retenções." });
    expect($("[data-editar-retencoes]")).toBeNull();
    expect(limpo($("[data-resumo-retencoes] p").textContent)).toContain("ISS retido 5%");
  });
});
