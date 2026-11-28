// @vitest-environment happy-dom
/**
 * COM-2A — as telas num DOM de verdade (happy-dom), API simulada, dados fictícios:
 *  - Configurações › Comissões: a regra do Executor com a divisão (e o % de cada cargo), a linha da regra mostra a
 *    divisão; a seção "Comissão do técnico" (gatilho, dias do retorno, tipos de OS de retorno, o aviso de desligado);
 *    o teto mensal (criar, erro do servidor, excluir);
 *  - Desempenho › Fechamento: "Estornos a revisar" (manter/estornar com motivo, erro do servidor, some sem revisão);
 *  - Minhas comissões: a OS do técnico com o equipamento e a marca "Em revisão".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/avisos", async (o) => ({ ...(await o<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeEach(() => {
  chamadas.length = 0; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && String(url).startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement) { raiz = createRoot(caixa); await act(async () => { raiz!.render(el); }); await esperar(); }
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el, "campo").toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el, "seletor").toBeTruthy();
  await act(async () => { (el as HTMLSelectElement).value = v; el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}

/* ───────── Configurações › Comissões ───────── */

const regra = (x: Record<string, unknown>) => ({ quemTipo: "TODOS", usuarioId: null, cargoId: null, papel: "EXECUTOR", sobreTipo: "TODOS_SERVICOS", categoria: null, servicoId: null, base: "PERC_VENDA", valor: 10, ativo: true, divisao: "IGUAL", divisaoCargos: null, nomes: { pessoa: null, cargo: null, servico: null }, ...x });
const DADOS = {
  regras: [
    regra({ id: "rV", papel: "VENDEDOR", valor: 2 }),
    regra({ id: "rE", divisao: "POR_CARGO", divisaoCargos: { cgTec: 60, cgAj: 40 } }),
    regra({ id: "rX", base: "FIXO_ITEM", valor: 25, divisao: "POR_EXECUTOR" }),
  ],
  config: { quando: "RECEBIMENTO", liquidaImpostos: false, executorQuando: "CONCLUSAO_OS", retornoDias: 30, tiposRetorno: ["toCorr"] },
  opcoes: {
    pessoas: [{ id: "uC", nome: "Carlos Técnico" }], cargos: [{ id: "cgTec", nome: "Técnico" }, { id: "cgAj", nome: "Ajudante" }], servicos: [], categorias: [],
    tiposOs: [{ id: "toCorr", nome: "Corretiva" }, { id: "toPrev", nome: "Preventiva" }],
  },
  tetos: [{ id: "t1", quemTipo: "CARGO", usuarioId: null, cargoId: "cgAj", valor: 900, ativo: true, nome: "Ajudante" }],
};
const abrirConfig = async (dados: any = DADOS) => {
  respostas["GET /api/comissoes"] = { status: 200, corpo: dados }; // o recarregar depois de gravar
  const { ComissoesClient } = await import("@/components/config/comissoes-client");
  await montar(createElement(ComissoesClient, { inicial: dados }));
};

describe("Configurações › Comissões (COM-2)", () => {
  it("a linha da regra do Executor mostra a divisão (com o % de cada cargo); a do vendedor, não", async () => {
    await abrirConfig();
    expect(texto($("[data-regra='rE'] [data-divisao-regra]"))).toBe("· % por cargo (Técnico 60% · Ajudante 40%)");
    expect(texto($("[data-regra='rX'] [data-divisao-regra]"))).toBe("· Para quem executou");
    expect($("[data-regra='rV'] [data-divisao-regra]")).toBeNull();
  });

  it("nova regra de Executor: a divisão aparece só no Executor; '% por cargo' pede o % de cada cargo e vai no POST", async () => {
    respostas["POST /api/comissoes/regras"] = { status: 201, corpo: { id: "novo" } };
    await abrirConfig();
    await clicar($("[data-nova-regra]"));
    expect($("[data-campo-divisao]")).toBeNull();
    await escolher($("[data-campo-papel]"), "EXECUTOR");
    expect($$<HTMLOptionElement>("[data-campo-divisao] option").map((o) => o.textContent)).toEqual(["Igual entre os técnicos", "Para quem executou", "% por cargo"]);
    await escolher($("[data-campo-base]"), "FIXO_ITEM");
    expect(texto($("[data-form-regra]"))).toContain("Valor por equipamento atendido (R$)");
    expect($("[data-divisao-cargos]")).toBeNull();
    await escolher($("[data-campo-divisao]"), "POR_CARGO");
    await digitar($("[data-divisao-cargo='cgTec']"), "60");
    await digitar($("[data-divisao-cargo='cgAj']"), "40,5");
    await digitar($("[data-campo-valor]"), "25");
    await clicar($("[data-salvar-regra]"));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toMatchObject({ papel: "EXECUTOR", base: "FIXO_ITEM", valor: 25, divisao: "POR_CARGO", divisaoCargos: { cgTec: 60, cgAj: 40.5 } });
  });

  it("a regra do vendedor não manda divisão; editar uma do Executor abre com a divisão dela", async () => {
    respostas["POST /api/comissoes/regras"] = { status: 201, corpo: { id: "novo" } };
    respostas["PATCH /api/comissoes/regras/rE"] = { status: 200, corpo: { id: "rE" } };
    await abrirConfig();
    await clicar($("[data-nova-regra]"));
    await digitar($("[data-campo-valor]"), "3");
    await clicar($("[data-salvar-regra]"));
    const post = chamadas.find((c) => c.metodo === "POST")!.corpo;
    expect(post.papel).toBe("VENDEDOR");
    expect("divisao" in post).toBe(false);
    await clicar($("[data-regra='rE'] [data-editar-regra]"));
    expect(($("[data-campo-divisao]") as HTMLSelectElement).value).toBe("POR_CARGO");
    expect(($("[data-divisao-cargo='cgTec']") as HTMLInputElement).value).toBe("60");
    await clicar($("[data-salvar-regra]"));
    expect(chamadas.find((c) => c.metodo === "PATCH")!.corpo).toMatchObject({ divisao: "POR_CARGO", divisaoCargos: { cgTec: 60, cgAj: 40 } });
  });

  it("'Comissão do técnico': o gatilho, os dias e os tipos de retorno; só salva com mudança; sem tipo, o aviso de desligado", async () => {
    await abrirConfig();
    expect(($("[data-salvar-config-comissao]") as HTMLButtonElement).disabled).toBe(true);
    expect($("[data-tipo-retorno='toCorr']")!.getAttribute("aria-pressed")).toBe("true");
    expect($("[data-retorno-desligado]")).toBeNull();
    await escolher($("[data-comissao-executor-quando]"), "ACEITE");
    await digitar($("[data-comissao-retorno-dias]"), "45 dias");
    await clicar($("[data-tipo-retorno='toPrev']"));
    await clicar($("[data-tipo-retorno='toCorr']"));
    expect(($("[data-salvar-config-comissao]") as HTMLButtonElement).disabled).toBe(false);
    await clicar($("[data-salvar-config-comissao]"));
    expect(chamadas.find((c) => c.metodo === "PUT")).toEqual({ url: "/api/comissoes", metodo: "PUT", corpo: {
      quando: "RECEBIMENTO", liquidaImpostos: false, executorQuando: "ACEITE", retornoDias: 45, tiposRetorno: ["toPrev"],
    } });
    // desmarcar todos: o aviso
    await clicar($("[data-tipo-retorno='toPrev']"));
    expect(texto($("[data-retorno-desligado]"))).toBe("Sem tipo marcado, a revisão de retorno fica desligada.");
    // dias acima do máximo param em 365
    await digitar($("[data-comissao-retorno-dias]"), "999");
    expect(($("[data-comissao-retorno-dias]") as HTMLInputElement).value).toBe("365");
  });

  it("sem regra do Executor: o aviso de que a seção vale quando houver", async () => {
    await abrirConfig({ ...DADOS, regras: [DADOS.regras[0]] });
    expect(texto($("[data-sem-regra-executor]"))).toBe("Vale quando houver uma regra com o papel Executor.");
    await abrirConfig();
  });

  it("teto mensal: a lista; criar (pessoa) manda o POST; o erro do servidor aparece; excluir manda o DELETE", async () => {
    await abrirConfig();
    expect(texto($("[data-teto='t1'] > span"))).toBe("Ajudante (cargo)");
    expect(texto($("[data-teto='t1']"))).toContain("R$ 900,00");
    respostas["POST /api/comissoes/tetos"] = { status: 409, corpo: { erro: "Já existe um teto para esta pessoa/cargo. Edite o que existe." } };
    await clicar($("[data-novo-teto]"));
    await escolher($("[data-teto-pessoa]"), "uC");
    await digitar($("[data-teto-valor]"), "1500,50");
    await clicar($("[data-salvar-teto]"));
    expect(chamadas.find((c) => c.metodo === "POST" && c.url === "/api/comissoes/tetos")!.corpo).toEqual({ quemTipo: "PESSOA", usuarioId: "uC", cargoId: null, valor: 1500.5 });
    expect(texto($("[data-erro-teto]"))).toBe("Já existe um teto para esta pessoa/cargo. Edite o que existe.");
    await escolher($("[data-teto-quem]"), "CARGO");
    expect($("[data-teto-cargo]")).toBeTruthy();
    expect($("[data-teto-pessoa]")).toBeNull();
    respostas["DELETE /api/comissoes/tetos/t1"] = { status: 200, corpo: { ok: true } };
    await clicar($("[data-teto='t1'] [data-excluir-teto]"));
    expect(chamadas.some((c) => c.metodo === "DELETE" && c.url === "/api/comissoes/tetos/t1")).toBe(true);
  });

  it("sem teto: o texto de que a comissão é paga inteira", async () => {
    await abrirConfig({ ...DADOS, tetos: [] });
    expect(texto($("[data-sem-tetos]"))).toBe("Sem teto: a comissão do mês é paga inteira.");
  });
});

/* ───────── Estornos a revisar ───────── */

const REV = (x: Record<string, unknown>) => ({
  id: "rv1", situacao: "A_REVISAR", descricao: "OS-901 aberta 5 dias depois do serviço da OS-880 em Split 3 LG S4", beneficiario: "Carlos Técnico", usuarioId: "uC",
  osNumero: "OS-880", valor: 15, motivo: null, decididoPorNome: null, decididoEm: null, criadoEm: "2027-02-10T12:00:00.000Z", ...x,
});

describe("Desempenho › Fechamento: Estornos a revisar", () => {
  const abrir = async () => {
    const { RevisoesDeComissao } = await import("@/components/comissoes/revisoes-comissao");
    await montar(createElement(RevisoesDeComissao));
  };

  it("sem revisão nenhuma: a seção não aparece", async () => {
    respostas["GET /api/comissoes/revisoes"] = { status: 200, corpo: { revisoes: [] } };
    await abrir();
    expect($("[data-revisoes-comissao]")).toBeNull();
  });

  it("a aberta com Manter/Estornar e o contador; a decidida com quem, quando e o motivo", async () => {
    respostas["GET /api/comissoes/revisoes"] = { status: 200, corpo: { revisoes: [
      REV({}), REV({ id: "rv2", situacao: "ESTORNAR", beneficiario: "Ana Ajudante", motivo: "Mesmo vazamento", decididoPorNome: "Gestora Fictícia", decididoEm: "2027-02-11T12:00:00.000Z" }),
    ] } };
    await abrir();
    expect(texto($("[data-revisoes-abertas]"))).toBe("1");
    expect(texto($("[data-revisao='rv1']"))).toContain("Carlos Técnico · R$ 15,00");
    expect($("[data-revisao='rv1'] [data-manter]")).toBeTruthy();
    expect($("[data-revisao='rv2'] [data-manter]")).toBeNull();
    expect(texto($("[data-revisao='rv2'] [data-decisao-revisao]"))).toBe("Estornada por Gestora Fictícia em 11/02/2027: Mesmo vazamento");
  });

  it("decidir pede o motivo (mínimo 5); manda o POST; o erro do servidor aparece no diálogo; dá certo e recarrega", async () => {
    respostas["GET /api/comissoes/revisoes"] = { status: 200, corpo: { revisoes: [REV({})] } };
    await abrir();
    await clicar($("[data-revisao='rv1'] [data-estornar]"));
    const confirmar = () => $("[data-confirmar-revisao]") as HTMLButtonElement;
    expect(confirmar().disabled).toBe(true);
    await digitar($("[data-motivo-revisao]"), "abc");
    expect(confirmar().disabled).toBe(true);
    await digitar($("[data-motivo-revisao]"), "Mesmo vazamento");
    respostas["POST /api/comissoes/revisoes/rv1"] = { status: 403, corpo: { erro: "Você não pode decidir a revisão da sua própria comissão. Peça a outra pessoa." } };
    await clicar(confirmar());
    expect(chamadas.find((c) => c.metodo === "POST")).toEqual({ url: "/api/comissoes/revisoes/rv1", metodo: "POST", corpo: { decisao: "ESTORNAR", motivo: "Mesmo vazamento" } });
    expect(texto($("[data-erro-revisao]"))).toMatch(/sua própria comissão/);
    respostas["POST /api/comissoes/revisoes/rv1"] = { status: 200, corpo: { ok: true } };
    respostas["GET /api/comissoes/revisoes"] = { status: 200, corpo: { revisoes: [REV({ situacao: "ESTORNAR", motivo: "Mesmo vazamento", decididoPorNome: "Gestora", decididoEm: "2027-02-11T12:00:00.000Z" })] } };
    await clicar(confirmar());
    expect($("[data-form-revisao]")).toBeNull();
    expect($("[data-revisao='rv1']")!.getAttribute("data-situacao")).toBe("ESTORNAR");
    const { toast } = await import("@/components/ui/avisos");
    expect(vi.mocked(toast)).toHaveBeenCalledWith("Comissão estornada.");
  });
});

/* ───────── Minhas comissões ───────── */

describe("Minhas comissões: a OS do técnico", () => {
  it("a OS com o equipamento no item e a marca 'Em revisão'; sem base nem custo", async () => {
    respostas["GET /api/perfil/comissoes"] = { status: 200, corpo: { ativo: true, totais: { prevista: 15, liberada: 0, paga: 0 }, vendas: [{
      chave: "os:os1", tipo: "OS", orcamentoId: null, codigo: "OS-880", nome: "Serviço executado", cliente: "Hospital Fictício", osNumero: null, prevista: 15, liberada: 0, paga: 0,
      itens: [{ descricao: "Limpeza de split — Split 3 LG S4", regra: "Todos · Todos os serviços · 10% da venda", valor: 15, emRevisao: true }],
    }] } };
    const { MinhasComissoes } = await import("@/components/perfil/minhas-comissoes");
    await montar(createElement(MinhasComissoes));
    expect(texto($("[data-venda-comissao='os:os1']"))).toContain("OS-880 · Serviço executado");
    await clicar($("[data-venda-comissao='os:os1'] button"));
    expect(texto($("[data-itens-comissao]"))).toContain("Limpeza de split — Split 3 LG S4");
    expect(texto($("[data-item-em-revisao]"))).toBe("Em revisão: retorno no equipamento");
    expect(texto($("[data-minhas-comissoes]"))).not.toMatch(/custo|margem|base/i);
  });
});
