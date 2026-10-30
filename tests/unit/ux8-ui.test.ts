// @vitest-environment happy-dom
/**
 * UX-8 "Consistência miúda" — num DOM de verdade:
 *  - G4: "TUDO OK" na execução desktop chama a rota em lote UMA vez e marca OK na tela só o que
 *    o servidor marcou; some quando não há o que marcar;
 *  - Y6: na Nova OS, com o tipo de OS que esconde colaboradores, dá para habilitar a competência
 *    sem sair do formulário — e o colaborador passa a aparecer na lista;
 *  - Y3: tipo de OS novo nasce na própria Nova OS (cadastro rápido) e já fica escolhido;
 *  - G1: data sempre dd/mm/aaaa (máscara, data impossível marcada, ISO para fora, campo oculto em GET);
 *  - G2: FormField associa o rótulo ao campo (htmlFor ↔ id) — clicar no rótulo foca o campo;
 *  - G3: ordenação natural ("Sala 2" antes de "Sala 10");
 *  - G5: breadcrumbs com rótulos de verdade;
 *  - G14: "Nova Cobrança" só aparece para quem pode criar cobrança.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { completo, faltasEquipamento, paraPendencia, verificarConclusao } from "@/lib/execucao/pendencias";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/nova", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown } | ((url: string, init: RequestInit) => { status: number; corpo: unknown })>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([
    import("@/components/os/atividade-execucao"), import("@/app/(dashboard)/ordens/nova/page"),
    import("@/components/providers/permissoes-provider"), import("@/components/financeiro/contas-receber-view"),
  ]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.push.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.includes(" ") ? k.split(" ") : ["GET", k]; return m === metodo && url.startsWith(u); })
      .sort((a, b) => b.length - a.length)[0];
    const r0 = chave ? respostas[chave] : { status: 200, corpo: {} };
    const r = typeof r0 === "function" ? r0(url, init) : r0;
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

async function montar(el: any, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function escolher(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}

/* ───────── G4: TUDO OK no desktop ───────── */
const ITENS = [
  { id: "i1", texto: "Limpeza dos filtros", pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 0, tipoResposta: "OK_ATENCAO_NA" },
  { id: "i2", texto: "Dreno", pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" },
  { id: "m1", texto: "Corrente", pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 2, tipoResposta: "MEDICAO" },
];
const eqTela = (respostasItens: Record<string, any> = {}) => {
  const e: any = {
    vinculoId: "v-eqA", feito: false, observacao: null,
    equipamento: { id: "eqA", titulo: "Split Sala 1", descricao: "Split", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } },
    itens: ITENS, respostas: respostasItens, fotos: [], formulario: null,
  };
  e.faltas = faltasEquipamento(paraPendencia(e));
  e.completo = completo(e.faltas);
  return e;
};
const execucao = (e: any) => ({
  atividade: { id: "a1", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null },
  os: { id: "os1", numero: "OS-2026-0001", status: "EM_ANDAMENTO", clienteId: "c1", unidadeId: "un1" },
  bloqueada: false, equipamentos: [e], conclusao: verificarConclusao([paraPendencia(e)]),
});
const R = (status: string | null) => ({ status, observacao: null, valor: null, unidade: null, audio: false, audioId: null });

describe("G4: TUDO OK na execução desktop", () => {
  it("uma chamada em lote; marca na tela só o que o servidor marcou; a Atenção fica", async () => {
    respostas["/api/ordens/os1/atividades/a1/execucao"] = { status: 200, corpo: execucao(eqTela({ i2: R("ATENCAO") })) };
    respostas["POST /api/ordens/os1/atividades/a1/execucao/equipamentos/eqA/tudo-ok"] = { status: 200, corpo: { marcados: ["i1"], feito: true } };
    const { AtividadeExecucao } = await import("@/components/os/atividade-execucao");
    await montar(createElement(AtividadeExecucao, { osId: "os1", atividadeId: "a1", titulo: "Preventiva", osNumero: "OS-2026-0001", tipoOs: null }));

    const botao = $("[data-tudo-ok-desktop]");
    expect(botao).not.toBeNull();
    await clicar(botao);
    const escritas = chamadas.filter((c) => c.metodo !== "GET");
    expect(escritas.map((c) => `${c.metodo} ${c.url}`)).toEqual(["POST /api/ordens/os1/atividades/a1/execucao/equipamentos/eqA/tudo-ok"]);
    // i1 virou OK na tela; i2 continua Atenção; nada mais a marcar → o botão some
    const ativo = (item: string) => $(`[data-item="${item}"] button[aria-pressed="true"]`)?.textContent ?? "";
    expect(ativo("i1")).toContain("OK");
    expect(ativo("i2")).toContain("Atenção");
    expect($("[data-tudo-ok-desktop]")).toBeNull();
  });
});

/* ───────── Y6 + Y3: Nova OS ───────── */
describe("Nova OS: competência e tipo de OS sem sair do formulário", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/ordens/nova?clienteId=c1&unidadeId=un1&descricao=Preventiva");
    respostas["/api/clientes"] = { status: 200, corpo: [{ id: "c1", nome: "Hospital" }] };
    respostas["/api/unidades"] = { status: 200, corpo: [{ id: "un1", nome: "Matriz" }] };
    respostas["/api/equipamentos"] = { status: 200, corpo: [] };
    respostas["/api/contratos"] = { status: 200, corpo: [] };
    respostas["/api/tipos-os"] = { status: 200, corpo: [{ id: "to1", nome: "Preventiva", ativo: true }, { id: "to2", nome: "Higienização", ativo: true }] };
    respostas["/api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [{ id: "to1" }] }, { id: "t2", nome: "Maria Souza", competencias: [] }] };
    respostas["/api/equipes"] = { status: 200, corpo: [] };
  });
  const montarNova = async (permissoes?: Permissoes) => {
    const { default: NovaOrdemPage } = await import("@/app/(dashboard)/ordens/nova/page");
    await montar(createElement(NovaOrdemPage), permissoes);
  };
  // SelectCadastroRapido é um combobox de botões: abre pelo botão e escolhe a opção
  const botaoTipo = () => $$("button").find((b) => /Sem tipo definido|Preventiva|Higienização|Instalação/.test(b.textContent ?? "") && !b.closest("[data-seletor-tecnicos]") && b.querySelector("svg")) as HTMLButtonElement;
  const escolherTipo = async (nome: string) => {
    await clicar(botaoTipo());
    await clicar($$("button").find((b) => b.textContent?.trim() === nome));
  };
  const colaboradores = async () => {
    const sel = $("[data-seletor-tecnicos]")!;
    const combo = [...sel.querySelectorAll("button")].find((b) => /Selecione o colaborador|Adicionar outro/.test(b.textContent ?? ""));
    if (!combo) return [] as string[];
    await clicar(combo);
    const nomes = [...sel.querySelectorAll("div.absolute button")].map((b) => b.textContent?.trim() ?? "");
    await clicar(combo);
    return nomes;
  };

  it("Y6: habilita a competência inline e o colaborador aparece (sem perder o tipo escolhido)", async () => {
    respostas["POST /api/tecnicos/t2/competencias"] = { status: 200, corpo: { ok: true } };
    await montarNova();
    await escolherTipo("Higienização");
    expect(await colaboradores()).not.toContain("Maria Souza");
    const habilitar = $("[data-habilitar-competencia]") as HTMLSelectElement;
    expect(habilitar).not.toBeNull();
    await escolher(habilitar, "t2");
    const post = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/tecnicos/t2/competencias");
    expect(post?.corpo).toEqual({ tipoOsId: "to2" });
    expect(await colaboradores()).toContain("Maria Souza");
    expect(botaoTipo().textContent).toContain("Higienização"); // o tipo escolhido não se perdeu
  });

  it("Y6: quem não gerencia colaboradores não vê o atalho (o servidor também recusa)", async () => {
    const p = permissoesTotais() as any;
    p.equipes = { ...p.equipes, gerenciar: false };
    await montarNova(p);
    await escolherTipo("Higienização");
    expect($("[data-ocultos-competencia]")).not.toBeNull();
    expect($("[data-habilitar-competencia]")).toBeNull();
  });

  it("Y3: tipo de OS novo nasce na própria Nova OS e já fica escolhido", async () => {
    respostas["POST /api/tipos-os"] = { status: 201, corpo: { id: "to3", nome: "Instalação", ativo: true } };
    await montarNova();
    await clicar(botaoTipo());
    await clicar($$("button").find((b) => b.textContent?.trim() === "Novo tipo de OS"));
    const nome = [...document.querySelectorAll("label")].find((l) => l.textContent?.includes("Nome do tipo"))?.parentElement?.querySelector("input")
      ?? [...document.querySelectorAll("input")].find((i) => i.getAttribute("placeholder") === "Ex: Higienização");
    await digitar(nome as HTMLInputElement, "Instalação");
    await clicar([...document.querySelectorAll("button")].find((b) => /Salvar e selecionar/.test(b.textContent ?? "")));
    expect(chamadas.find((c) => c.metodo === "POST" && c.url === "/api/tipos-os")?.corpo).toEqual({ nome: "Instalação" });
    expect(botaoTipo().textContent).toContain("Instalação"); // já fica escolhido
  });
});

/* ───────── G1: InputData ───────── */
describe("G1: data sempre dd/mm/aaaa", () => {
  it("máscara, ISO para fora, data impossível marcada, campo oculto para formulários GET", async () => {
    const { InputData, brParaIso, isoParaBr, mascararData } = await import("@/components/ui/input-data");
    expect(mascararData("25122026")).toBe("25/12/2026");
    expect(mascararData("2a5/1")).toBe("25/1");
    expect(brParaIso("31/02/2026")).toBeNull();
    expect(brParaIso("29/02/2028")).toBe("2028-02-29");
    expect(isoParaBr("2026-10-23")).toBe("23/10/2026");

    const mudou = vi.fn();
    await montar(createElement("form", null, createElement(InputData, { name: "dataInicio", defaultValue: "2026-10-01", onChange: mudou })));
    const campo = $<HTMLInputElement>("[data-input-data]")!;
    expect(campo.value).toBe("01/10/2026");
    expect($<HTMLInputElement>('input[type="hidden"][name="dataInicio"]')!.value).toBe("2026-10-01");

    await digitar(campo, "05112026");
    expect(campo.value).toBe("05/11/2026");
    expect(mudou).toHaveBeenLastCalledWith("2026-11-05");
    expect($<HTMLInputElement>('input[type="hidden"][name="dataInicio"]')!.value).toBe("2026-11-05");

    await digitar(campo, "31022026");
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(mudou).not.toHaveBeenCalledWith("2026-02-31");

    await digitar(campo, "");
    expect(mudou).toHaveBeenLastCalledWith("");
  });
});

/* ───────── G2: FormField ───────── */
describe("G2: rótulo associado ao campo", () => {
  it("htmlFor ↔ id gerado; id próprio do campo é respeitado", async () => {
    const { FormField } = await import("@/components/ui/form-field");
    await montar(createElement("div", null,
      createElement(FormField, { label: "Marca", children: createElement("input", { "data-a": "" }) }),
      createElement(FormField, { label: "Modelo", children: createElement("input", { id: "meu-id", "data-b": "" }) }),
    ));
    const [l1, l2] = $$("label");
    const a = $<HTMLInputElement>("[data-a]")!;
    expect(a.id).toBeTruthy();
    expect(l1.getAttribute("for")).toBe(a.id);
    expect(l2.getAttribute("for")).toBe("meu-id");
  });
});

/* ───────── G3, G5 ───────── */
describe("G3/G5: ordenação natural e breadcrumbs", () => {
  it("'Sala 2' antes de 'Sala 10'; acento e caixa não atrapalham", async () => {
    const { comparaNatural } = await import("@/lib/utils");
    expect(["Sala 10", "Sala 2", "sala 1", "Academia 103", "Academia 19"].sort(comparaNatural))
      .toEqual(["Academia 19", "Academia 103", "sala 1", "Sala 2", "Sala 10"]);
  });
  it("segmentos viram rótulos de verdade", async () => {
    const { gerarBreadcrumb } = await import("@/components/layout/header");
    expect(gerarBreadcrumb("/financeiro/contas-pagar").map((i) => i.label)).toEqual(["Financeiro", "Contas a pagar"]);
    expect(gerarBreadcrumb("/financeiro/medicoes").map((i) => i.label)).toEqual(["Financeiro", "Medições"]);
    expect(gerarBreadcrumb("/financeiro/fluxo-caixa").map((i) => i.label)).toEqual(["Financeiro", "Fluxo de caixa"]);
  });
});

/* ───────── G14 ───────── */
describe("G14: 'Nova Cobrança' segue a permissão de criar cobrança", () => {
  const props = {
    contas: [], clientes: [], categorias: [], interAtivo: false,
    resumo: { VENCIDO: { v: 0, q: 0 }, VENCE_HOJE: { v: 0, q: 0 }, A_VENCER: { v: 0, q: 0 }, RECEBIDO: { v: 0, q: 0 }, TOTAL: { v: 0, q: 0 } },
    periodo: { tipo: "mes", mes: "2026-11", de: null, ate: null, rotulo: "Novembro de 2026" },
    total: 0, totalFiltrado: 0, pagina: 1, porPagina: 25,
    filtros: { q: "", card: "", clienteId: "", categoria: "", forma: "", banco: "", valorMin: "", valorMax: "", vencDe: "", vencAte: "", status: "" },
  };
  it("com contasReceber: aparece; sem: some", async () => {
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props as any));
    expect($("[data-nova-cobranca]")).not.toBeNull();
    act(() => root.unmount()); caixa.remove();

    const p = permissoesVazias() as any;
    p.financeiro = { visualizar: true };
    await montar(createElement(ContasReceberView, props as any), p);
    expect($("[data-nova-cobranca]")).toBeNull();
  });
});
