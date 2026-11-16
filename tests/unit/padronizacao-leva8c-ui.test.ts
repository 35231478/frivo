// @vitest-environment happy-dom
/**
 * Leva 8C — folha e fiscal num DOM de verdade (happy-dom), API simulada.
 *
 *  - fechar o mês pergunta antes, avisa por toast com o plural escrito e só então atualiza a tela;
 *  - recusado pelo servidor (403): o erro FICA na tela, sem toast e sem atualizar — a tela não muda;
 *  - a folha do colaborador salva com toast; o erro de validação e o do servidor ficam na tela;
 *  - a importação diz "1 colaborador" / "8 colaboradores", nunca "colaborador(es)", e a prévia
 *    não grava nada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

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
/** Resposta por rota: "METODO /caminho" → { status, corpo } */
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const MODELO = { id: "mod1", nome: "CLT padrão", regime: "CLT", padrao: true, ativo: true, itens: [{ nome: "INSS", percentual: 20 }] };
const FOLHA = {
  salario: 3000, valorDiaria: null, diasMes: null, horasMes: 220, regime: "CLT", adicionalTipo: "NENHUM",
  adicionalPercent: null, adicionalValor: null, horasExtrasValor: null, valeTransporte: null, descontaVt: true,
  valeAlimentacao: null, planoSaude: null, outrosBeneficios: null, descontos: null, descontosDescricao: null,
  modeloEncargosId: "mod1", observacoes: null,
};

beforeEach(() => {
  chamadas.length = 0; avisos.lista.length = 0; respostas = {};
  avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  nav.refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: { ok: true } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(el: unknown) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el as any); });
  await act(async () => {});
}

const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
/** Digitar como o navegador: pelo setter nativo, senão o React não enxerga. */
const digitar = async (el: Element | null, v: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const tela = () => txt(caixa);

describe("fechar o mês", () => {
  async function montarFechar(props: Record<string, unknown> = {}) {
    const { FecharMes } = await import("@/components/folha/fechar-mes");
    await montar(createElement(FecharMes, { competencia: "2026-11", rotulo: "novembro de 2026", jaFechado: false, ...props } as any));
  }

  it("pergunta antes e avisa por toast, com o plural escrito", async () => {
    respostas["POST /api/folha/fechar-mes"] = { status: 200, corpo: { ok: true, colaboradores: 8, total: 41234.5 } };
    await montarFechar();
    await clicar($('[data-acao="fechar-mes"]'));
    const o = avisos.confirmar.mock.calls[0][0] as { mensagem: string; titulo: string };
    expect(o.titulo).toBe("Fechar o mês");
    expect(o.mensagem).toContain("novembro de 2026");
    expect(chamadas.at(-1)).toMatchObject({ url: "/api/folha/fechar-mes", metodo: "POST", corpo: { competencia: "2026-11" } });
    expect(avisos.lista).toEqual([["novembro de 2026 fechado: 8 colaboradores na foto do mês.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("um colaborador só: o toast fala no singular", async () => {
    respostas["POST /api/folha/fechar-mes"] = { status: 200, corpo: { ok: true, colaboradores: 1, total: 4100 } };
    await montarFechar();
    await clicar($('[data-acao="fechar-mes"]'));
    expect(avisos.lista.at(-1)![0]).toContain("1 colaborador na foto do mês.");
  });

  it("refazer avisa que a foto anterior é substituída, e o botão muda de nome", async () => {
    await montarFechar({ jaFechado: true });
    expect(txt($('[data-acao="fechar-mes"]'))).toBe("Refazer fechamento");
    await clicar($('[data-acao="fechar-mes"]'));
    expect((avisos.confirmar.mock.calls[0][0] as { mensagem: string }).mensagem).toContain("A anterior é substituída");
  });

  it("recusar a confirmação não chama o servidor", async () => {
    avisos.confirmar.mockImplementation(async () => false);
    await montarFechar();
    await clicar($('[data-acao="fechar-mes"]'));
    expect(chamadas).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("403 do servidor: o erro fica na tela, sem toast e sem atualizar", async () => {
    respostas["POST /api/folha/fechar-mes"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await montarFechar();
    await clicar($('[data-acao="fechar-mes"]'));
    expect(txt($("[data-erro-fechar]"))).toBe("Sem permissão para esta ação");
    expect(avisos.lista).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe("folha do colaborador", () => {
  async function montarFolha() {
    respostas["GET /api/folha/colaboradores/c1"] = { status: 200, corpo: { folha: FOLHA, modelos: [MODELO] } };
    const { FolhaColaborador } = await import("@/components/folha/folha-colaborador");
    await montar(createElement(FolhaColaborador, { colaboradorId: "c1" } as any));
  }

  it("salva com toast, sem deixar recado verde na tela", async () => {
    await montarFolha();
    respostas["PUT /api/folha/colaboradores/c1"] = { status: 200, corpo: { folha: FOLHA, modelos: [MODELO] } };
    await clicar($('[data-acao="salvar-folha"]'));
    expect(avisos.lista).toEqual([["Dados financeiros salvos.", "sucesso"]]);
    expect(tela()).not.toContain("salvos");
  });

  it("valor digitado errado nem chega ao servidor: o aviso fica na tela", async () => {
    await montarFolha();
    await digitar($('[data-campo="salario"]'), "três mil");
    await clicar($('[data-acao="salvar-folha"]'));
    expect(tela()).toContain("Confira os valores");
    expect(chamadas.filter((c) => c.metodo === "PUT")).toEqual([]);
    expect(avisos.lista).toEqual([]);
  });

  it("403 do servidor: o erro fica na tela e não vira toast", async () => {
    await montarFolha();
    respostas["PUT /api/folha/colaboradores/c1"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($('[data-acao="salvar-folha"]'));
    expect(tela()).toContain("Sem permissão para esta ação");
    expect(avisos.lista).toEqual([]);
  });

  it("o custo aparece calculado pelos encargos do modelo (o cálculo é o mesmo do servidor)", async () => {
    await montarFolha();
    // 3000 de base + 20% de encargos = 3600; a conta é a de lib/folha/calculo
    expect(txt($("[data-resumo-custo]"))).toContain("R$ 3.600,00");
  });
});

describe("importar planilha", () => {
  async function montarImportar() {
    const { ImportarPlanilha } = await import("@/components/folha/importar-planilha");
    await montar(createElement(ImportarPlanilha, {} as any));
  }
  const anexar = async (input: Element | null, arquivo: File) => {
    Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
    await act(async () => { (input as HTMLElement).dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => {});
  };
  const planilha = () => new File(["nome;cpf\nAna;1"], "folha.csv", { type: "text/csv" });

  const previa = (resumo: Record<string, number>) => {
    respostas["POST /api/folha/importar"] = {
      status: 200,
      corpo: { analise: { resumo: { existentes: 0, ...resumo }, linhas: [], cargosNovos: [], colunasIgnoradas: [] } },
    };
  };

  it("a prévia não grava nada e fala no plural escrito", async () => {
    previa({ total: 9, novos: 8, atualizar: 1, erros: 0, gravaveis: 9 });
    await montarImportar();
    await anexar($('input[type="file"]'), planilha());
    const t = tela();
    expect(t).toContain("8 colaboradores novos");
    expect(t).toContain("1 atualização");
    expect(t).not.toMatch(/colaborador\(es\)|atualização\(ões\)|linha\(s\)/);
    // etapa=previa em toda chamada: nada é gravado antes de confirmar
    expect(chamadas.map((c) => c.corpo.get("etapa"))).toEqual(["previa"]);
  });

  it("uma linha de cada: singular na prévia", async () => {
    previa({ total: 3, novos: 1, atualizar: 1, erros: 1, gravaveis: 2 });
    await montarImportar();
    await anexar($('input[type="file"]'), planilha());
    const t = tela();
    expect(t).toContain("1 colaborador novo");
    expect(t).toContain("1 linha com erro fica de fora");
  });

  it("confirmar grava e o resultado também fala no plural escrito", async () => {
    previa({ total: 9, novos: 8, atualizar: 1, erros: 0, gravaveis: 9 });
    await montarImportar();
    await anexar($('input[type="file"]'), planilha());
    respostas["POST /api/folha/importar"] = { status: 200, corpo: { criados: 8, atualizados: 1, ignorados: 2, comErro: 1, cargosCriados: [] } };
    await clicar($('[data-acao="confirmar-importacao"]'));
    const t = tela();
    expect(chamadas.at(-1)!.corpo.get("etapa")).toBe("confirmar");
    expect(t).toContain("8 colaboradores criados");
    expect(t).toContain("1 colaborador atualizado");
    expect(t).toContain("2 já cadastrados, ignorados");
    expect(t).toContain("1 linha com erro, não importada");
  });
});
