// @vitest-environment happy-dom
/**
 * NFS-e — seção "Dados fiscais (NFS-e)" do cadastro de serviço num DOM de verdade (tela real de
 * Serviços, com a seção de desenho próprio):
 *  - três blocos (Classificação do serviço · Tributação · Discriminação), duas colunas onde cabe;
 *  - LC 116 e código municipal em caixas de busca-e-seleção (filtram ao digitar, "código — descrição",
 *    clique/teclado preenchem, o digitado também vale); o municipal sugere os códigos já usados;
 *  - CNAE: "Usar o CNAE principal da empresa" (marcado quando o serviço não tem CNAE próprio) ou um
 *    próprio; ISS retido numa caixa de marcar; alíquota mostra o ISS da empresa quando vazia;
 *  - sem Financeiro › Fiscal: tudo só leitura (aviso uma vez) e o salvar não manda dado fiscal;
 *  - salvar manda só o que mudou; erro do servidor aparece no topo e a gaveta rola até ele.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const GESTOR_FISCAL = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });
const BASE = {
  codigo: "LIMP01", descricao: null, unidade: "un", valorPadrao: "120", ativo: true,
  codigoMunicipal: null, aliquotaISS: null, nfseTributacao: null, issRetido: false, discriminacaoPadrao: null,
  aliquotaPIS: null, aliquotaCOFINS: null, aliquotaCSLL: null, aliquotaIR: null, observacaoFiscal: null,
};
const HERDA = { ...BASE, id: "s1", nome: "Limpeza de split", codigoLc116: "14.01", aliquotaISS: "5", cnae: null };
const PROPRIO = { ...BASE, id: "s2", nome: "Instalação", codigo: "INST01", codigoLc116: "14.06", cnae: "4321500" };

let root: Root;
let caixa: HTMLDivElement;
let enviados: { metodo: string; corpo: any }[];
let recusar: string | null;
let apoio: any;
beforeEach(() => {
  enviados = [];
  recusar = null;
  apoio = { cnaeEmpresa: "4322302", issEmpresa: 3.5, servicos: [{ codigoMunicipal: "140101", nome: "Limpeza de split" }, { codigoMunicipal: "140101", nome: "Higienização" }] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    if (init?.method === "POST" || init?.method === "PATCH") {
      enviados.push({ metodo: init.method, corpo: JSON.parse(String(init.body)) });
      if (recusar) return new Response(JSON.stringify({ erro: recusar }), { status: 400 });
      return new Response(JSON.stringify({ ...HERDA, id: "s9" }), { status: 200 });
    }
    const corpo = u.pathname === "/api/fiscal/apoio-servico" ? apoio
      : u.searchParams.get("sugestoes") === "1" ? { sugestoes: [] }
        : { itens: [HERDA, PROPRIO], total: 2, pagina: 1, porPagina: 50, contagens: { ativos: 2, inativos: 0, todos: 2 } };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const texto = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); }

async function montar(permissoes: Permissoes, role = "OPERADOR") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { TelaServicos } = await import("@/components/config/telas/servicos");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role, permissoes, children: createElement(TelaServicos) })); });
  await esperar();
}
const abrirServico = (nome: string) => clicar(document.querySelector(`[aria-label="Editar ${nome}"]`));
async function abrir(permissoes: Permissoes, o: { role?: string; novo?: boolean; nome?: string } = {}) {
  await montar(permissoes, o.role);
  if (o.novo) await clicar(document.querySelector('[data-acao="novo-cadastro"]'));
  else await abrirServico(o.nome ?? "Limpeza de split");
}
const fechar = () => clicar([...document.querySelectorAll("button")].find((b) => texto(b) === "Cancelar"));

/** O controle do campo pelo rótulo (label ligado por htmlFor) */
function campo<T extends HTMLElement = HTMLInputElement>(rotulo: string): T {
  const label = [...document.querySelectorAll("label")].find((l) => texto(l).replace(/\*$/, "") === rotulo);
  expect(label, rotulo).toBeTruthy();
  return document.getElementById(label!.htmlFor) as T;
}
const ajudaDe = (rotulo: string) => texto(campo(rotulo).closest(".flex-col")!.querySelector(":scope > p"));
/** Texto do ⓘ ao lado do rótulo (Princípio 7: a explicação do campo fica na dica) */
const dicaDe = (rotulo: string) => {
  const b = campo(rotulo).closest(".flex-col")!.querySelector("[data-dica]");
  return b ? texto(document.getElementById(b.getAttribute("aria-describedby")!)) : null;
};
const bloco = (titulo: string) => document.querySelector(`section[aria-label="${titulo}"]`) as HTMLElement;
const rotulosEm = (el: Element) => [...el.querySelectorAll("label, [data-campo=cnae] > span")].map((l) => texto(l)).filter(Boolean);
const caixaCnae = () => document.querySelector('[data-campo="cnae"] input[type="checkbox"]') as HTMLInputElement;
const caixaRetido = () => document.querySelector('[data-campo="issRetido"] input[type="checkbox"]') as HTMLInputElement;
const cnaeProprio = () => document.querySelector('[data-campo="cnae"] input:not([type])') as HTMLInputElement | null;
const opcoes = () => [...document.querySelectorAll('[role="option"]')] as HTMLElement[];

async function digitar(el: HTMLElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const tecla = (el: HTMLElement, key: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
const focar = (el: HTMLElement) => act(async () => { el.focus(); el.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
const desfocar = (el: HTMLElement) => act(async () => { el.blur(); el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
const mouseDown = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
async function marcar(el: HTMLInputElement) { await act(async () => { el.click(); }); }
async function salvar() {
  await clicar([...document.querySelectorAll("button")].find((x) => /^(Salvar|Adicionar)$/.test(texto(x))));
}

describe("Layout da seção fiscal", () => {
  it("quatro blocos na ordem, cada campo no seu bloco, duas colunas onde cabe", async () => {
    await abrir(GESTOR_FISCAL);
    const secao = document.querySelector("[data-secao-fiscal]")!;
    expect([...secao.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"))).toEqual(["Classificação do serviço", "Tributação", "Retenções na fonte", "Discriminação"]);
    expect(rotulosEm(bloco("Classificação do serviço"))).toEqual(["Código do serviço (LC 116)", "Código municipal", "CNAE", "Usar o CNAE principal da empresa"]);
    expect(rotulosEm(bloco("Tributação"))).toEqual(["Tributação do ISS", "Alíquota de ISS (%)"]);
    // Retenções: ISS retido + "Reter" federal com a alíquota ao lado (Simples Nacional: desmarcados)
    expect(rotulosEm(bloco("Retenções na fonte"))).toEqual(["ISS retido pelo tomador", "Reter IR", "Reter PIS", "Reter COFINS", "Reter CSLL", "Reter INSS"]);
    expect([...bloco("Retenções na fonte").querySelectorAll("[data-aliquota]")].map((i) => i.getAttribute("aria-label")))
      .toEqual(["Alíquota IR (%)", "Alíquota PIS (%)", "Alíquota COFINS (%)", "Alíquota CSLL (%)", "Alíquota INSS (%)"]);
    expect(bloco("Retenções na fonte").querySelector("ul")!.className).toContain("grid-cols-1 sm:grid-cols-2");
    expect(rotulosEm(bloco("Discriminação"))).toEqual(["Discriminação padrão"]);
    // pares lado a lado (uma coluna no celular)
    const grade = (rotulo: string) => campo(rotulo).closest(".grid")!.className;
    for (const r of ["Código municipal", "Tributação do ISS", "Alíquota de ISS (%)"]) expect(grade(r)).toContain("grid-cols-1 sm:grid-cols-2");
    expect(campo("Código do serviço (LC 116)").closest(".grid")).toBeNull();
    // seção abaixo do título; "Outros tributos" (só a observação, na largura toda) logo depois
    const titulos = [...document.querySelectorAll("h4")].map(texto);
    expect(titulos.slice(-2)).toEqual(["Dados fiscais (NFS-e)", "Outros tributos"]);
    expect(campo("Observação fiscal").closest("[data-grupo-colunas]")!.className).toContain("sm:grid-cols-2");
    expect(campo("Observação fiscal").closest(".flex-col")!.className).toContain("sm:col-span-2");
  });

  it("Princípio 7: explicação no ⓘ; a descrição do código LC 116 fica visível; alíquota vazia mostra o ISS da empresa", async () => {
    await abrir(GESTOR_FISCAL, { nome: "Instalação" });
    // O que o código significa é dado fiscal: fica na tela
    expect(ajudaDe("Código do serviço (LC 116)")).toMatch(/^14\.06 — Instalação e montagem/);
    // As explicações saem da tela e vão para o ⓘ
    expect(ajudaDe("Código municipal")).toBe("");
    expect(ajudaDe("Alíquota de ISS (%)")).toBe("");
    expect(dicaDe("Código municipal")).toBe("Preencha apenas se a prefeitura adotar codificação própria de serviços. Em branco, a nota usa o código LC 116.");
    expect(dicaDe("Alíquota de ISS (%)")).toBe("Em branco, a nota usa a alíquota de ISS da empresa.");
    expect(dicaDe("Código do serviço (LC 116)")).toBe("Subitem da lista de serviços da Lei Complementar 116/2003, no formato NN.NN.");
    expect(dicaDe("Discriminação padrão")).toBe("Texto-base da discriminação da NFS-e. Pode ser ajustado no momento da emissão.");
    expect(dicaDe("Tributação do ISS")).toBeNull();
    // CNAE e ISS retido também com ⓘ
    const dicas = [...document.querySelectorAll('[data-campo="cnae"] [data-dica], [data-secao-fiscal] [data-dica][aria-label="Ajuda: ISS retido pelo tomador"]')];
    expect(dicas.map((b) => texto(document.getElementById(b.getAttribute("aria-describedby")!)))).toEqual([
      "Em branco, a nota usa o CNAE principal da empresa.", "Marque quando o tomador (cliente) retém e recolhe o ISS desta nota. Usa a alíquota de ISS acima.",
    ]);
    expect(campo("Alíquota de ISS (%)").placeholder).toBe("Em branco: 3,50 (empresa)");
    expect(campo("Código municipal").placeholder).toBe("Em branco: código LC 116");
    // Código fora da lista: não há descrição para mostrar
    await digitar(campo("Código do serviço (LC 116)"), "17.99");
    expect(ajudaDe("Código do serviço (LC 116)")).toBe("");
  });

  it("ISS da empresa zero também aparece; resposta de erro do apoio é ignorada", async () => {
    apoio = { cnaeEmpresa: null, issEmpresa: 0, servicos: [] };
    await abrir(GESTOR_FISCAL);
    expect(campo("Alíquota de ISS (%)").placeholder).toBe("Em branco: 0,00 (empresa)");
    await fechar();
    act(() => root.unmount()); caixa.remove();
    const original = (globalThis.fetch as any).getMockImplementation();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (new URL(url, "http://localhost").pathname === "/api/fiscal/apoio-servico"
      ? new Response(JSON.stringify({ cnaeEmpresa: "9999999", issEmpresa: 9, servicos: [] }), { status: 403 })
      : original(url, init))));
    await abrir(GESTOR_FISCAL);
    expect(texto(document.querySelector("[data-cnae-herdado]"))).toBe("Empresa sem CNAE principal. Informe em Configurações › Dados da empresa.");
    expect(campo("Alíquota de ISS (%)").placeholder).toBe("Ex: 5,00");
  });

  it("sem o ISS da empresa: o placeholder do registro", async () => {
    apoio = { cnaeEmpresa: null, issEmpresa: null, servicos: [] };
    await abrir(GESTOR_FISCAL);
    expect(campo("Alíquota de ISS (%)").placeholder).toBe("Ex: 5,00");
  });
});

describe("Busca-e-seleção dos códigos", () => {
  it("LC 116: abre ao focar, filtra ao digitar (código ou descrição), Enter/clique preenche", async () => {
    await abrir(GESTOR_FISCAL);
    const lc = campo("Código do serviço (LC 116)");
    expect(lc.getAttribute("role")).toBe("combobox");
    expect(lc.getAttribute("aria-expanded")).toBe("false");
    await focar(lc);
    expect(lc.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(lc.getAttribute("aria-controls")!)!.getAttribute("role")).toBe("listbox");
    await digitar(lc, "1406");
    expect(opcoes().map((o) => o.dataset.codigo)).toEqual(["14.06"]);
    expect([...opcoes()[0].querySelectorAll("span")].map((x) => texto(x).slice(0, 22))).toEqual(["14.06", "Instalação e montagem "]);
    await tecla(lc, "ArrowDown");
    expect(opcoes()[0].getAttribute("aria-selected")).toBe("true");
    expect(lc.getAttribute("aria-activedescendant")).toBe(opcoes()[0].id);
    await tecla(lc, "Enter");
    expect(lc.value).toBe("14.06");
    expect(lc.getAttribute("aria-expanded")).toBe("false");
    // por descrição, e clique
    await digitar(lc, "lubrificação");
    expect(opcoes().map((o) => o.dataset.codigo)).toContain("14.01");
    await mouseDown(opcoes().find((o) => o.dataset.codigo === "14.01")!);
    expect(lc.value).toBe("14.01");
    expect(opcoes()).toHaveLength(0);
  });

  it("teclado: ↑/↓ andam e param nas pontas; Esc fecha; Enter sem escolha não preenche; o digitado vale", async () => {
    await abrir(GESTOR_FISCAL);
    const lc = campo("Código do serviço (LC 116)");
    await digitar(lc, "14.0");
    const n = opcoes().length;
    expect(n).toBeGreaterThan(2);
    await tecla(lc, "Enter"); // nada escolhido ainda
    expect(lc.value).toBe("14.0");
    await tecla(lc, "ArrowUp");
    expect(opcoes()[0].getAttribute("aria-selected")).toBe("true");
    await tecla(lc, "ArrowDown");
    await tecla(lc, "ArrowDown");
    expect(opcoes()[2].getAttribute("aria-selected")).toBe("true");
    await tecla(lc, "ArrowUp");
    expect(opcoes()[1].getAttribute("aria-selected")).toBe("true");
    for (let i = 0; i < n + 3; i++) await tecla(lc, "ArrowDown");
    expect(opcoes()[n - 1].getAttribute("aria-selected")).toBe("true");
    for (let i = 0; i < n + 3; i++) await tecla(lc, "ArrowUp");
    expect(opcoes()[0].getAttribute("aria-selected")).toBe("true");
    await tecla(lc, "ArrowDown");
    await tecla(lc, "ArrowDown");
    await tecla(lc, "Escape");
    expect(opcoes()).toHaveLength(0);
    expect(document.querySelector("[data-secao-fiscal]")).not.toBeNull(); // a gaveta continua aberta
    await tecla(lc, "Enter"); // lista fechada: Enter não escolhe a opção que estava marcada
    expect(lc.value).toBe("14.0");
    await tecla(lc, "ArrowDown"); // reabre já no primeiro
    expect(opcoes()[0].getAttribute("aria-selected")).toBe("true");
    await tecla(lc, "ArrowDown");
    await digitar(lc, "14.01"); // digitar de novo desmarca (a lista mudou)
    expect(opcoes().some((o) => o.getAttribute("aria-selected") === "true")).toBe(false);
    expect(lc.hasAttribute("aria-activedescendant")).toBe(false);
    await desfocar(lc);
    expect(opcoes()).toHaveLength(0);
    await digitar(lc, "99.99");
    expect(texto(document.querySelector('[role="listbox"]'))).toBe("Nenhum código encontrado: o digitado vale como está.");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { codigoLc116: "99.99" } }]);
  });

  it("Esc com a lista aberta fecha só a lista; com ela fechada, fecha a gaveta (como sempre)", async () => {
    await abrir(GESTOR_FISCAL);
    const lc = campo("Código do serviço (LC 116)");
    await focar(lc);
    await tecla(lc, "Escape");
    expect(opcoes()).toHaveLength(0);
    await esperar();
    const gaveta = () => document.querySelector('[role="dialog"]')!.className;
    expect(gaveta()).toContain("translate-x-0");
    await tecla(lc, "Escape");
    await esperar();
    expect(gaveta()).toContain("translate-x-full"); // fechando
  });

  it("passar o mouse marca a opção; o botão da seta abre e fecha", async () => {
    await abrir(GESTOR_FISCAL);
    const lc = campo("Código do serviço (LC 116)");
    const seta = lc.parentElement!.querySelector('button[aria-label="Ver a lista"]')!;
    await mouseDown(seta);
    expect(lc.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { opcoes()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    expect(opcoes()[0].getAttribute("aria-selected")).toBe("true");
    await mouseDown(seta);
    expect(lc.getAttribute("aria-expanded")).toBe("false");
  });

  it("código municipal: primeiro os já usados nos serviços, depois a LC 116 de apoio", async () => {
    await abrir(GESTOR_FISCAL);
    const mun = campo("Código municipal");
    expect(mun.getAttribute("role")).toBe("combobox");
    await focar(mun);
    const lista = document.querySelector('[role="listbox"]')!;
    const titulos = [...lista.querySelectorAll("p")].map(texto);
    expect(titulos).toEqual(["Usados nos seus serviços", "Lista da LC 116 (apoio)"]);
    expect([...opcoes()[0].querySelectorAll("span")].map(texto)).toEqual(["140101", "Em uso: Limpeza de split, Higienização"]);
    await digitar(mun, "1401");
    expect(opcoes().map((o) => o.dataset.codigo)).toEqual(["140101", "14.01"]);
    await mouseDown(opcoes()[0]);
    expect(mun.value).toBe("140101");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { codigoMunicipal: "140101" } }]);
  });
});

describe("CNAE herdado da empresa", () => {
  it("serviço sem CNAE próprio: caixa marcada, mostra o da empresa e não manda nada", async () => {
    await abrir(GESTOR_FISCAL);
    expect(caixaCnae().checked).toBe(true);
    expect(cnaeProprio()).toBeNull();
    expect(texto(document.querySelector("[data-cnae-herdado]"))).toBe("CNAE na nota: 4322-3/02");
    await digitar(campo("Nome"), "Limpeza 2");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { nome: "Limpeza 2" } }]);
  });

  it("desmarcar abre o campo do CNAE próprio; digitar e salvar manda o CNAE", async () => {
    await abrir(GESTOR_FISCAL);
    await marcar(caixaCnae());
    expect(caixaCnae().checked).toBe(false);
    expect(document.querySelector("[data-cnae-herdado]")).toBeNull();
    const c = cnaeProprio()!;
    expect(c.placeholder).toBe("Ex: 4322-3/02");
    expect(document.activeElement).toBe(c); // já com o cursor
    await digitar(c, "4321-5/00");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { cnae: "4321-5/00" } }]);
  });

  it("serviço com CNAE próprio: caixa desmarcada e o CNAE formatado; marcar limpa (passa a herdar)", async () => {
    await abrir(GESTOR_FISCAL, { nome: "Instalação" });
    expect(caixaCnae().checked).toBe(false);
    expect(cnaeProprio()!.value).toBe("4321-5/00");
    expect(document.activeElement).not.toBe(cnaeProprio());
    await marcar(caixaCnae());
    expect(cnaeProprio()).toBeNull();
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { cnae: "" } }]);
  });

  it("cada abertura começa do serviço aberto (a escolha anterior não vaza)", async () => {
    await abrir(GESTOR_FISCAL, { nome: "Instalação" });
    await marcar(caixaCnae()); // passa a herdar, sem salvar
    await fechar();
    await abrirServico("Instalação");
    expect(caixaCnae().checked).toBe(false);
    expect(cnaeProprio()!.value).toBe("4321-5/00");
    await fechar();
    await abrirServico("Limpeza de split");
    expect(caixaCnae().checked).toBe(true);
  });

  it("empresa sem CNAE principal: avisa onde informar", async () => {
    apoio = { cnaeEmpresa: null, issEmpresa: 5, servicos: [] };
    await abrir(GESTOR_FISCAL);
    expect(texto(document.querySelector("[data-cnae-herdado]"))).toBe("Empresa sem CNAE principal. Informe em Configurações › Dados da empresa.");
  });
});

describe("Tributação e salvar", () => {
  it("tributação: vazio = Tributável (padrão); ISS retido numa caixa de marcar", async () => {
    await abrir(GESTOR_FISCAL);
    const trib = campo<HTMLSelectElement>("Tributação do ISS");
    expect(trib.value).toBe("");
    expect(texto(trib.selectedOptions[0])).toBe("Tributável no município (padrão)");
    expect(caixaRetido().checked).toBe(false);
    await marcar(caixaRetido());
    await digitar(trib, "ISENTO");
    await digitar(campo("Alíquota de ISS (%)"), "2,5");
    await digitar(campo("Discriminação padrão"), "Texto da nota");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { nfseTributacao: "ISENTO", aliquotaISS: "2,5", issRetido: "true", discriminacaoPadrao: "Texto da nota" } }]);
  });

  it("desmarcar o retido volta a \"false\"", async () => {
    await abrir(GESTOR_FISCAL);
    await marcar(caixaRetido());
    await marcar(caixaRetido());
    expect(caixaRetido().checked).toBe(false);
    await salvar();
    expect(enviados).toEqual([]); // nada mudou: só fecha
  });

  it("erro do servidor: mostra no topo e rola até ele", async () => {
    const rolou = vi.fn();
    (HTMLElement.prototype as any).scrollIntoView = rolou;
    await abrir(GESTOR_FISCAL);
    recusar = "CNAE: CNAE inválido: use os 7 dígitos da subclasse (ex.: 4321-5/00).";
    await marcar(caixaCnae());
    await digitar(cnaeProprio()!, "43223");
    await salvar();
    const alerta = document.querySelector('[role="alert"]')!;
    expect(texto(alerta)).toBe(recusar);
    expect(rolou.mock.contexts).toContain(alerta);
    delete (HTMLElement.prototype as any).scrollIntoView;
  });
});

describe("Retenções na fonte (herdadas pelo faturamento)", () => {
  const reter = (k: string) => document.querySelector(`[data-campo="${k}"] input[type="checkbox"]`) as HTMLInputElement;
  const aliquota = (k: string) => document.querySelector(`[data-aliquota="${k}"]`) as HTMLInputElement;
  it("Simples Nacional: federais desmarcados; marcar \"Reter IR\" + alíquota vai no salvar (só o que mudou)", async () => {
    await abrir(GESTOR_FISCAL);
    for (const k of ["retIr", "retPis", "retCofins", "retCsll", "retInss"]) expect(reter(k).checked, k).toBe(false);
    await clicar(reter("retIr"));
    await digitar(aliquota("aliquotaIR"), "1,5a");
    expect(aliquota("aliquotaIR").value).toBe("1,5");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { retIr: "true", aliquotaIR: "1,5" } }]);
  });
});

describe("Permissão Financeiro › Fiscal", () => {
  it("sem ela: tudo só leitura (aviso uma vez), o resto edita e o salvar não manda dado fiscal", async () => {
    await abrir(GESTOR);
    const avisos = document.querySelectorAll("[data-somente-leitura]");
    expect(avisos).toHaveLength(1);
    expect(texto(avisos[0])).toBe("Somente leitura: alterar estes dados exige a permissão Financeiro › Fiscal (NFS-e).");
    for (const r of ["Código do serviço (LC 116)", "Código municipal", "Tributação do ISS", "Alíquota de ISS (%)", "Discriminação padrão"]) {
      expect(campo(r).hasAttribute("disabled"), r).toBe(true);
    }
    expect(caixaCnae().disabled).toBe(true);
    expect(caixaRetido().disabled).toBe(true);
    expect(campo("Código do serviço (LC 116)").value).toBe("14.01");
    await focar(campo("Código do serviço (LC 116)"));
    expect(opcoes()).toHaveLength(0); // travado: a lista não abre
    // Retenções também são do Fiscal: caixinhas e alíquotas travadas
    for (const el of bloco("Retenções na fonte").querySelectorAll("input")) expect((el as HTMLInputElement).disabled).toBe(true);
    expect(campo("Nome").hasAttribute("disabled")).toBe(false);
    await digitar(campo("Nome"), "Limpeza de split 9000");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { nome: "Limpeza de split 9000" } }]);
  });

  it("CNAE próprio também fica travado", async () => {
    await abrir(GESTOR, { nome: "Instalação" });
    expect(cnaeProprio()!.disabled).toBe(true);
  });

  it("ADMIN edita mesmo sem o Fiscal no perfil", async () => {
    await abrir(GESTOR, { role: "ADMIN" });
    expect(document.querySelector("[data-somente-leitura]")).toBeNull();
    expect(caixaCnae().disabled).toBe(false);
    expect(campo("Código municipal").hasAttribute("disabled")).toBe(false);
  });

  it("criar sem o Fiscal: os campos travados vão com os valores padrão (o servidor aceita)", async () => {
    await abrir(GESTOR, { novo: true });
    expect(caixaCnae().checked).toBe(true);
    await digitar(campo("Nome"), "Visita técnica");
    await salvar();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      metodo: "POST",
      corpo: { nome: "Visita técnica", codigoLc116: "", codigoMunicipal: "", aliquotaISS: "", nfseTributacao: "", issRetido: "false", cnae: "", discriminacaoPadrao: "" },
    });
  });
});
