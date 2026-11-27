// @vitest-environment happy-dom
/**
 * Leva "Pronto pra janeiro" — os atritos de baixo risco achados no percurso de um cliente novo
 * (empresa do zero → orçamento → OS → app do técnico → concluir → faturar):
 *  - OS avulsa concluída sem item executado: a aba Financeiro dizia só "ainda não foi faturada", sem
 *    botão nem motivo — agora explica e leva à aba Comercial (onde o item é marcado);
 *  - "O que falta": a OS avulsa fatura com "Faturar" (não "Gerar a medição", que é a de contrato), e
 *    sem item executado o passo aponta para a aba Comercial;
 *  - seletor de colaboradores: com todos já escolhidos dizia "Nenhum técnico cadastrado";
 *  - hora já preenchida (08:00 sugerido): o que se digita substitui, não se soma ("1400" virava 08:01);
 *  - iniciais do avatar sem a pontuação ("Diego Silva (apelido)" dava "D(").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes } from "@/lib/permissoes";
import { pendenciaFaturar, centralDaOs, type OsCentralEntrada } from "@/lib/os/central";
import { iniciais } from "@/lib/utils";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));
// O bloco de notas fiscais busca na API; aqui só interessa o faturar
vi.mock("@/components/fiscal/nfse-notas", () => ({ NotasFiscais: () => null }));

let root: Root | null = null;
let caixa: HTMLDivElement;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; caixa?.remove(); vi.useRealTimers(); });

async function montar(el: any, permissoes = montarPermissoes({ financeiro: ["visualizar", "medicoes"], ordens: ["visualizar"] })) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
}

describe("O que falta — o passo de faturar da OS concluída", () => {
  const item = (executado?: boolean) => ({ valorTotal: 280, ...(executado === undefined ? {} : { executado }) });

  it("OS de contrato: entra numa medição (aba Financeiro)", () => {
    expect(pendenciaFaturar({ contratoId: "c1", itensOrcamento: [item(false)] })).toEqual({ chave: "faturar", texto: "Gerar a medição para faturar a OS", aba: "financeiro", nivel: "acao" });
  });

  it("OS avulsa com item executado: \"Faturar a OS\" (aba Financeiro)", () => {
    expect(pendenciaFaturar({ contratoId: null, itensOrcamento: [item(true), item(false)] })).toMatchObject({ texto: "Faturar a OS", aba: "financeiro" });
  });

  it("OS avulsa sem nenhum item executado: leva à aba Comercial, onde o item é marcado", () => {
    expect(pendenciaFaturar({ itensOrcamento: [item(false), item(false)] })).toEqual({ chave: "faturar", texto: "Marcar os itens executados para faturar a OS", aba: "comercial", nivel: "acao" });
  });

  it("adicional marcado \"Cobrar\" já é o que faturar: fica no Financeiro mesmo sem item executado", () => {
    expect(pendenciaFaturar({ itensOrcamento: [item(false)], servicosAdicionais: [{ statusCobranca: "COBRAR" }] })).toMatchObject({ aba: "financeiro", texto: "Faturar a OS" });
    expect(pendenciaFaturar({ itensOrcamento: [item(false)], servicosAdicionais: [{ statusCobranca: "A_AVALIAR" }] })).toMatchObject({ aba: "comercial" });
  });

  it("sem itens, ou sem saber se foram executados: não muda o destino (Financeiro)", () => {
    expect(pendenciaFaturar({ itensOrcamento: [] })).toMatchObject({ aba: "financeiro", texto: "Faturar a OS" });
    expect(pendenciaFaturar({ itensOrcamento: [item(), item(false)] })).toMatchObject({ aba: "financeiro" });
  });

  it("na central da OS concluída: a mesma pendência, com a chave de sempre", () => {
    const os: OsCentralEntrada = {
      status: "CONCLUIDA", statusManual: false, previsaoConclusao: null, medicoes: [], orcamentos: [],
      atividades: [{ id: "a1", status: "CONCLUIDA", dataAgendada: null, dataConclusao: "2026-11-27T12:00:00Z", equipamentos: [] } as any],
      itensOrcamento: [item(false)], contratoId: null,
    };
    expect(centralDaOs(os).falta.filter((p) => p.chave === "faturar")).toEqual([{ chave: "faturar", texto: "Marcar os itens executados para faturar a OS", aba: "comercial", nivel: "acao" }]);
  });
});

describe("aba Financeiro da OS avulsa concluída", () => {
  const faturamento = (saldo: number, faturas: any[] = []) => ({ total: saldo, faturado: 0, saldo, faturas });
  const props = (extra: Record<string, unknown>) => ({ osId: "os1", concluida: true, medicoes: [], itensOrcamento: [{ id: "i1", valorTotal: 280, executado: false }], ...extra });

  it("sem nada a faturar: diz o porquê e o botão leva à aba Comercial (antes: só \"ainda não foi faturada\")", async () => {
    const { OsFinanceiro } = await import("@/components/os/os-financeiro");
    const onAba = vi.fn();
    await montar(createElement(OsFinanceiro, props({ faturamento: faturamento(0), onAba }) as any));
    const aviso = document.querySelector("[data-nada-a-faturar]") as HTMLElement;
    expect(aviso.textContent).toContain("nenhum item desta OS está marcado como executado");
    expect(document.querySelector("[data-faturar]")).toBeNull();
    await act(async () => { (document.querySelector("[data-ir-comercial]") as HTMLButtonElement).click(); });
    expect(onAba).toHaveBeenCalledWith("comercial");
  });

  it("sem o atalho de aba: o texto ainda aponta o lugar", async () => {
    const { OsFinanceiro } = await import("@/components/os/os-financeiro");
    await montar(createElement(OsFinanceiro, props({ faturamento: faturamento(0) }) as any));
    expect(document.querySelector("[data-nada-a-faturar]")!.textContent).toContain("Marque os itens executados na aba Comercial.");
    expect(document.querySelector("[data-ir-comercial]")).toBeNull();
  });

  it("com saldo: o Faturar de sempre, sem o aviso", async () => {
    const { OsFinanceiro } = await import("@/components/os/os-financeiro");
    await montar(createElement(OsFinanceiro, props({ faturamento: faturamento(280), onAba: () => {} }) as any));
    expect(document.querySelector("[data-faturar]")).toBeTruthy();
    expect(document.querySelector("[data-nada-a-faturar]")).toBeNull();
  });

  it("OS de contrato, não concluída ou sem Financeiro › Medições: nunca mostra o aviso", async () => {
    const { OsFinanceiro } = await import("@/components/os/os-financeiro");
    await montar(createElement(OsFinanceiro, props({ temContrato: true, faturamento: null }) as any));
    expect(document.querySelector("[data-nada-a-faturar]")).toBeNull();
    act(() => root!.unmount()); caixa.remove(); root = null;
    await montar(createElement(OsFinanceiro, props({ concluida: false, faturamento: faturamento(0) }) as any));
    expect(document.querySelector("[data-nada-a-faturar]")).toBeNull();
    act(() => root!.unmount()); caixa.remove(); root = null;
    await montar(createElement(OsFinanceiro, props({ faturamento: faturamento(0) }) as any), montarPermissoes({ financeiro: ["visualizar"] }));
    expect(document.querySelector("[data-nada-a-faturar]")).toBeNull();
  });
});

describe("seletor de colaboradores da atividade", () => {
  const tecnicos = [{ id: "t1", nome: "Diego Técnico", competencias: [] }];
  const valor = (ids: string[]) => ({ tecnicoIds: ids, responsavelId: ids[0] ?? null, equipeId: null });

  it("todos já escolhidos: \"Todos os colaboradores já estão na atividade\" (não \"Nenhum técnico cadastrado\")", async () => {
    const { SeletorTecnicos } = await import("@/components/os/seletor-tecnicos");
    await montar(createElement(SeletorTecnicos, { tecnicos, equipes: [], tipoOsId: "", valor: valor(["t1"]), onChange: () => {} } as any));
    const vazio = document.querySelector("[data-vazio-seletor]")!;
    expect(vazio.textContent).toBe("Todos os colaboradores já estão na atividade");
  });

  it("sem nenhum cadastrado: continua \"Nenhum ... cadastrado\" com o Cadastrar agora", async () => {
    const { SeletorTecnicos } = await import("@/components/os/seletor-tecnicos");
    await montar(createElement(SeletorTecnicos, { tecnicos: [], equipes: [], tipoOsId: "", valor: valor([]), onChange: () => {} } as any));
    expect(document.querySelector("[data-vazio-seletor]")!.textContent).toMatch(/^Nenhum .+ cadastrad[oa]/);
  });
});

describe("hora já preenchida", () => {
  it("ao entrar no campo, o texto fica selecionado: o que se digita substitui (\"1400\" não vira 08:01)", async () => {
    vi.useFakeTimers();
    const { InputHora } = await import("@/components/ui/input-hora");
    await montar(createElement(InputHora, { value: "08:00", onChange: () => {}, "aria-label": "Hora" }));
    const campo = document.querySelector("[data-input-hora]") as HTMLInputElement;
    act(() => { campo.focus(); });
    act(() => { vi.runAllTimers(); });
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([0, 5]);
  });

  it("campo vazio: nada a selecionar", async () => {
    const { selecionarAoFocar } = await import("@/components/ui/input-data-hora");
    vi.useFakeTimers();
    const el = document.createElement("input");
    document.body.appendChild(el);
    const select = vi.spyOn(el, "select");
    el.focus();
    selecionarAoFocar({ currentTarget: el } as any);
    vi.runAllTimers();
    expect(select).not.toHaveBeenCalled();
    el.remove();
  });
});

describe("iniciais do avatar", () => {
  it("ignora a pontuação da frente das palavras", () => {
    expect(iniciais("Diego Técnico (fictício)")).toBe("DF");
    expect(iniciais("Ana (gerente)")).toBe("AG");
    expect(iniciais("— Maria")).toBe("MA");
  });
  it("continua igual para nomes comuns e vazios", () => {
    expect([iniciais("Carlos Oliveira"), iniciais("Ana"), iniciais("  maria  da  silva "), iniciais(""), iniciais(null)]).toEqual(["CO", "AN", "MS", "?", "?"]);
  });
});
