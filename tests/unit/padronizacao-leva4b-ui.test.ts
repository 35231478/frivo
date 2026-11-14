// @vitest-environment happy-dom
/**
 * PADRONIZAÇÃO — LEVA 4B: Veículos, Colaboradores e Equipes montados de verdade (DOM real, API simulada).
 *
 * PRIORIDADE Nº 1 — botão destrutivo (Excluir/Inativar) ou de ação sensível só aparece para quem pode:
 *  - checklist de veículo preenchido: Detalhe para quem vê; Editar e Reativar com Veículos › gerenciar;
 *    Excluir (reversível) com Veículos › excluir;
 *  - veículos, colaboradores e equipes: lápis, Inativar e Reativar conforme a permissão; sem Equipes ›
 *    gerenciar, o colaborador e a equipe não são link (a ficha recusaria);
 *  - se o servidor recusa (403), a TELA NÃO MUDA (a lista não é recarregada) e o motivo aparece;
 *  - cancelar a confirmação não grava nada.
 *
 * CONSERTOS: checklist preenchido com Detalhe/Editar/Excluir; responsável técnico cadastrado na hora
 * (com CREA) em Dados da empresa; aba Inativos + Reativar nos formulários de OS e nos modelos de checklist.
 *
 * PADRÃO: listas na tabela da casa com cartões no celular; toast em toda gravação; instrução no ⓘ;
 * cadastrar na hora e editar no contexto nos seletores; vocabulário.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { itemGeraAlerta, porCategoria, primeiroObrigatorioFaltando, statusPelosAlertas, type ItemDoModelo } from "@/lib/veiculos/checklist";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: nav.back }),
  usePathname: () => "/veiculos", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string, dentro: ParentNode = document) => [...dentro.querySelectorAll("button")].filter((b) => txt(b) === t).at(-1) ?? null;
async function digitar(el: Element | null | undefined, v: string) {
  expect(el, "campo a preencher").toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null | undefined, v: string) {
  expect(el, "select a mudar").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montar(el: ReactElement, permissoes: Permissoes) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [createElement("div", { key: "tela" }, el), createElement(Avisos, { key: "avisos" })] })); });
  await esperar();
}
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);
/** O que foi para as rotas da tela (a tabela também lê e grava a preferência de colunas do usuário) */
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
const leituras = (url: string) => chamadas.filter((c) => c.metodo === "GET" && c.url === url).length;
const confirmacao = () => $("[data-confirmacao]");
const dialogo = () => $$('[role="dialog"]').at(-1)!;
const dica = (rotulo: string, dentro: ParentNode = document) => {
  const b = $(`[data-dica][aria-label="Ajuda: ${rotulo}"]`, dentro);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby") ?? "")) : null;
};
/** O campo do cadastro rápido pelo rótulo (o rótulo envolve o campo) */
const campo = (rotulo: string) => {
  const l = $$("label", dialogo()).find((x) => txt($("span", x)).replace(" *", "") === rotulo);
  expect(l, `rótulo "${rotulo}"`).toBeTruthy();
  return l!.querySelector("input") as HTMLInputElement;
};
const RECUSA = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };

beforeAll(async () => {
  // Um de cada vez, com os avisos primeiro: importar em paralelo cria duas cópias do módulo simulado e
  // o teste passaria a ler um `toast` que não é o da tela
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/providers/permissoes-provider"), () => import("@/components/veiculos/checklists-preenchidos"), () => import("@/components/veiculos/checklist-tela"),
    () => import("@/components/forms/configuracoes-client"), () => import("@/components/config/telas/formularios"), () => import("@/components/config/checklist-templates-client"),
    () => import("@/app/(dashboard)/veiculos/veiculos-lista-client"), () => import("@/app/(dashboard)/colaboradores/colaboradores-lista-client"), () => import("@/components/equipes/equipes-view"),
    () => import("@/components/forms/equipe-form"), () => import("@/components/forms/veiculo-form"), () => import("@/components/equipes/montador-equipes"),
    () => import("@/components/ui/inativar-registro"), () => import("@/components/acoes-massa/selecao"), () => import("@/components/cadastro-rapido/definicoes"),
  ]) await m();
}, 180_000);
beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear(); nav.push.mockClear(); nav.back.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    // primeiro a URL inteira (com o filtro), depois só o caminho
    const r = respostas[`${metodo} ${url}`] ?? respostas[`${metodo} ${url.split("?")[0]}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const V = (acoes: string[]) => montarPermissoes({ veiculos: acoes as any });
const E = (acoes: string[]) => montarPermissoes({ equipes: acoes as any });

/* ═════════ As regras puras do checklist preenchido ═════════ */
describe("checklist de veículo — as regras (tela e rota usam as mesmas)", () => {
  const item = (id: string, extra: Partial<ItemDoModelo> = {}): ItemDoModelo => ({ id, categoria: "Motor", descricao: `Item ${id}`, tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem: 0, ...extra });

  it("alerta: só item de opção, respondido, e fora da primeira opção (a saudável)", () => {
    expect(itemGeraAlerta(item("a"), "OK")).toBe(false);
    expect(itemGeraAlerta(item("a"), "NOK")).toBe(true);
    expect(itemGeraAlerta(item("a", { tipo: "NIVEL", opcoes: ["Cheio", "Meio", "Reserva"] }), "Reserva")).toBe(true);
    expect(itemGeraAlerta(item("a", { tipo: "NIVEL", opcoes: ["Cheio", "Meio"] }), "Cheio")).toBe(false);
    expect(itemGeraAlerta(item("a"), null)).toBe(false);
    expect(itemGeraAlerta(item("a"), "")).toBe(false);
    expect(itemGeraAlerta(item("a", { tipo: "TEXTO", opcoes: [] }), "qualquer coisa")).toBe(false);
    // texto livre nunca alerta — nem quando o item ficou com opções de um tipo anterior
    expect(itemGeraAlerta(item("a", { tipo: "TEXTO" }), "qualquer coisa")).toBe(false);
    expect(itemGeraAlerta(item("a", { tipo: "FOTO" }), "NOK")).toBe(false);
    expect(itemGeraAlerta(item("a", { tipo: "FOTO", opcoes: [] }), "x")).toBe(false);
    expect(itemGeraAlerta(item("a", { opcoes: [] }), "NOK")).toBe(false);
  });

  it("situação: um alerta basta para 'Com alertas'; sem nenhum, 'Concluído'", () => {
    expect(statusPelosAlertas([false, false])).toBe("CONCLUIDO");
    expect(statusPelosAlertas([false, true, false])).toBe("COM_ALERTAS");
    expect(statusPelosAlertas([])).toBe("CONCLUIDO");
  });

  it("obrigatório faltando: o primeiro na ordem; foto pede a foto, os outros o valor; opcional não trava", () => {
    const itens = [item("a"), item("b", { tipo: "FOTO", opcoes: [], descricao: "Painel" }), item("c", { obrigatorio: false, tipo: "TEXTO", opcoes: [] })];
    expect(primeiroObrigatorioFaltando(itens, {})).toBe("Preencha: Item a");
    expect(primeiroObrigatorioFaltando(itens, { a: { valor: "  ", foto: null } })).toBe("Preencha: Item a");
    expect(primeiroObrigatorioFaltando(itens, { a: { valor: "OK", foto: null } })).toBe("Anexe a foto: Painel");
    expect(primeiroObrigatorioFaltando(itens, { a: { valor: "OK", foto: null }, b: { valor: "texto não serve", foto: null } })).toBe("Anexe a foto: Painel");
    expect(primeiroObrigatorioFaltando(itens, { a: { valor: "OK", foto: null }, b: { valor: null, foto: "data:x" } })).toBeNull();
  });

  it("os itens se agrupam por categoria, na ordem do modelo", () => {
    const itens = [item("c", { categoria: "Cabine", ordem: 2 }), item("a", { ordem: 0 }), item("b", { ordem: 1 }), item("d", { categoria: "Cabine", ordem: 3 })];
    expect(porCategoria(itens).map(([cat, l]) => [cat, l.map((i) => i.id)])).toEqual([["Motor", ["a", "b"]], ["Cabine", ["c", "d"]]]);
  });
});

/* ═════════ Conserto 1: checklist de veículo preenchido ═════════ */
describe("checklists preenchidos (Detalhe, Editar, Excluir reversível)", () => {
  const linha = (id: string, extra: object = {}) => ({
    id, status: "CONCLUIDO", criadoEm: "2026-11-10T12:00:00.000Z", editadoEm: null, inativadoEm: null, veiculoId: "v1",
    veiculo: { placa: "FRV1A01", modelo: "Fiorino" }, colaborador: { nome: "João" }, template: { nome: "Checklist diário" }, inativadoPor: null, totalItens: 3, alertas: 0, ...extra,
  });
  const ATIVOS = [linha("p1"), linha("p2", { status: "COM_ALERTAS", alertas: 1, veiculo: { placa: "FRV2B02", modelo: "Saveiro" } })];
  const INATIVOS = [linha("p3", { inativadoEm: "2026-11-11T12:00:00.000Z", inativadoPor: { nome: "Ana" } })];
  const it1 = { id: "i1", categoria: "Motor", descricao: "Nível do óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem: 0 };
  const it2 = { id: "i2", categoria: "Cabine", descricao: "Ruídos", tipo: "TEXTO", opcoes: [], obrigatorio: true, ordem: 1 };
  const it3 = { id: "i3", categoria: "Cabine", descricao: "Foto do painel", tipo: "FOTO", opcoes: [], obrigatorio: true, ordem: 2 };
  const DETALHE = {
    ...linha("p1"), observacaoGeral: "Tudo certo", colaborador: { id: "t1", nome: "João" }, editadoPor: null,
    itens: [
      { id: "r1", itemTemplateId: "i1", valor: "OK", foto: null, alerta: false, itemTemplate: it1 },
      { id: "r2", itemTemplateId: "i2", valor: "Sem ruído", foto: null, alerta: false, itemTemplate: it2 },
      { id: "r3", itemTemplateId: "i3", valor: null, foto: "data:image/png;base64,FOTO", alerta: false, itemTemplate: it3 },
    ],
  };
  const COLABS = [{ id: "t1", nome: "João" }, { id: "t2", nome: "Bia" }];
  async function abrir(permissoes: Permissoes, props: object = {}) {
    const { ChecklistsPreenchidos } = await import("@/components/veiculos/checklists-preenchidos");
    respostas["GET /api/checklists"] = { status: 200, corpo: ATIVOS };
    respostas["GET /api/checklists?inativos=1"] = { status: 200, corpo: INATIVOS };
    respostas["GET /api/checklists/p1"] = { status: 200, corpo: DETALHE };
    await montar(createElement(ChecklistsPreenchidos, { colaboradores: COLABS, ...props }), permissoes);
  }
  const linhas = () => $$("tr[data-checklist]").map((l) => l.getAttribute("data-checklist"));
  const naLinha = (id: string, sel: string) => $(`tr[data-checklist="${id}"] ${sel}`);
  const acoesDe = (id: string) => $$(`tr[data-checklist="${id}"] [data-acoes-checklist] button`).map((b) => b.getAttribute("title"));
  const abaInativos = () => clicar($('[data-checklists-preenchidos] [data-aba="inativos"]'));

  it("quem só visualiza: a lista (tabela e cartões) com Detalhe; sem Editar, Excluir nem Reativar", async () => {
    await abrir(V(["visualizar"]));
    expect(linhas()).toEqual(["p1", "p2"]);
    expect(acoesDe("p1")).toEqual(["Detalhe"]);
    expect($$("[data-cartoes] [data-cartao]").map((c) => c.getAttribute("data-cartao"))).toEqual(["p1", "p2"]);
    expect($$("[data-cartoes] [data-ver-checklist]")).toHaveLength(2);
    expect($$("[data-editar-checklist], [data-inativar-checklist], [data-reativar-checklist]")).toEqual([]);
    expect(txt(naLinha("p2", "[data-status-checklist]"))).toBe("Com alertas");
    expect(txt($("tr[data-checklist='p2']"))).toContain("3 itens · 1 alerta");
    await abaInativos();
    expect(linhas()).toEqual(["p3"]);
    expect(acoesDe("p3")).toEqual(["Detalhe"]);
    expect(txt($("tr[data-checklist='p3']"))).toContain("Ana");
  });

  it("cada permissão libera só a sua ação: gerenciar edita e reativa; excluir exclui", async () => {
    await abrir(V(["visualizar", "gerenciar"]));
    expect(acoesDe("p1")).toEqual(["Detalhe", "Editar"]);
    await abaInativos();
    expect(acoesDe("p3")).toEqual(["Detalhe", "Reativar"]);
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["visualizar", "excluir"]));
    expect(acoesDe("p1")).toEqual(["Detalhe", "Excluir"]);
    await abaInativos();
    expect(acoesDe("p3")).toEqual(["Detalhe"]);
  });

  it("a instrução está no ⓘ; a busca filtra por placa, colaborador ou modelo; lista vazia diz o que é", async () => {
    await abrir(V(["visualizar"]));
    expect(dica("Checklists preenchidos")).toContain("Excluir é reversível");
    expect(txt($("[data-checklists-preenchidos]"))).not.toContain("Excluir é reversível");
    expect(txt($("[data-contagem-checklists]"))).toBe("2 checklists");
    await digitar($('[data-checklists-preenchidos] input[aria-label="Pesquisar checklists"]'), "saveiro");
    expect(linhas()).toEqual(["p2"]);
    expect(txt($("[data-contagem-checklists]"))).toBe("1 checklist");
    await digitar($('[data-checklists-preenchidos] input[aria-label="Pesquisar checklists"]'), "kombi");
    expect(linhas()).toEqual([]);
    expect(txt($("[data-checklists-preenchidos]"))).toContain("Nenhum checklist encontrado");
  });

  it("na ficha do veículo lista só os dele (sem a coluna Veículo) e avisa a ficha quando muda", async () => {
    const onMudou = vi.fn();
    respostas["DELETE /api/checklists/p1"] = { status: 200, corpo: { ok: true } };
    await abrir(V(["visualizar", "excluir"]), { veiculoId: "v1", onMudou });
    expect(chamadas.filter((c) => c.url.startsWith("/api/checklists")).map((c) => c.url)).toEqual(["/api/checklists?veiculoId=v1"]);
    expect($$("[data-tabela-checklists] thead th").map(txt)).not.toContain("Veículo");
    await clicar(naLinha("p1", "[data-inativar-checklist]"));
    await clicar($("[data-confirmar-sim]"));
    expect(onMudou).toHaveBeenCalledTimes(1);
    await abaInativos();
    expect(chamadas.filter((c) => c.url.startsWith("/api/checklists")).at(-1)!.url).toBe("/api/checklists?veiculoId=v1&inativos=1");
  });

  it("Excluir pede confirmação dizendo que é reversível; cancelar não grava", async () => {
    await abrir(V(["visualizar", "excluir"]));
    await clicar(naLinha("p1", "[data-inativar-checklist]"));
    expect(txt(confirmacao())).toContain("Excluir este checklist?");
    expect(txt(confirmacao())).toContain("FRV1A01");
    expect(txt(confirmacao())).toContain("reativar na aba Inativos");
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    expect(await toasts()).toEqual([]);
    expect(linhas()).toEqual(["p1", "p2"]);
  });

  it("Excluir aceito: avisa e recarrega a lista; recusado (403): a lista NÃO é recarregada e o motivo aparece", async () => {
    respostas["DELETE /api/checklists/p1"] = { status: 200, corpo: { ok: true, ativo: false } };
    respostas["DELETE /api/checklists/p2"] = RECUSA;
    await abrir(V(["visualizar", "excluir"]));
    expect(leituras("/api/checklists?")).toBe(1);

    await clicar(naLinha("p2", "[data-inativar-checklist]"));
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/checklists/p2", metodo: "DELETE", corpo: null }]);
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(leituras("/api/checklists?")).toBe(1);
    expect(linhas()).toEqual(["p1", "p2"]);

    await clicar(naLinha("p1", "[data-inativar-checklist]"));
    await clicar($("[data-confirmar-sim]"));
    expect((await toasts()).at(-1)).toEqual(["Checklist excluído. Está na aba Inativos.", "sucesso"]);
    expect(leituras("/api/checklists?")).toBe(2);
  });

  it("Reativar manda { ativo: true }; aceito avisa e recarrega; recusado deixa a aba Inativos como estava", async () => {
    await abrir(V(["visualizar", "gerenciar"]));
    await abaInativos();
    respostas["PATCH /api/checklists/p3"] = RECUSA;
    await clicar(naLinha("p3", "[data-reativar-checklist]"));
    expect(gravacoes()).toEqual([{ url: "/api/checklists/p3", metodo: "PATCH", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(leituras("/api/checklists?inativos=1")).toBe(1);
    expect(linhas()).toEqual(["p3"]);

    respostas["PATCH /api/checklists/p3"] = { status: 200, corpo: { ok: true, ativo: true } };
    await clicar(naLinha("p3", "[data-reativar-checklist]"));
    expect((await toasts()).at(-1)).toEqual(["Checklist reativado.", "sucesso"]);
    expect(leituras("/api/checklists?inativos=1")).toBe(2);
  });

  it("Detalhe: as respostas só para leitura (sem campo nem botão de opção); Editar no detalhe só com a permissão", async () => {
    await abrir(V(["visualizar"]));
    await clicar(naLinha("p1", "[data-ver-checklist]"));
    const painel = $('[data-painel-checklist="ver"]')!;
    expect(painel).toBeTruthy();
    expect(txt($("[data-cabecalho-checklist]", painel))).toContain("FRV1A01 · Fiorino");
    expect($$("[data-valor-item]", painel).map(txt)).toEqual(["OK", "Sem ruído"]);
    expect($("[data-foto-item]", painel)!.getAttribute("src")).toBe("data:image/png;base64,FOTO");
    expect($$("[data-opcao], textarea, input, select", painel)).toEqual([]);
    expect(txt($("[data-observacao-checklist]", painel))).toContain("Tudo certo");
    expect($("[data-editar-no-detalhe]")).toBeNull();
    expect($("[data-salvar-checklist]")).toBeNull();
    expect(gravacoes()).toEqual([]);
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["visualizar", "gerenciar"]));
    await clicar(naLinha("p1", "[data-ver-checklist]"));
    await clicar($("[data-editar-no-detalhe]"));
    expect($('[data-painel-checklist="editar"]')).toBeTruthy();
    expect($("[data-salvar-checklist]")).toBeTruthy();
  });

  it("checklist inativado abre só para leitura, mesmo para quem edita (reative antes)", async () => {
    respostas["GET /api/checklists/p3"] = { status: 200, corpo: { ...DETALHE, id: "p3", inativadoEm: "2026-11-11T12:00:00.000Z", inativadoPor: { nome: "Ana" } } };
    await abrir(V(["visualizar", "gerenciar"]));
    await abaInativos();
    await clicar(naLinha("p3", "[data-ver-checklist]"));
    expect($('[data-painel-checklist="ver"]')).toBeTruthy();
    expect(txt($("[data-inativado]"))).toContain("Ana");
    expect($("[data-editar-no-detalhe]")).toBeNull();
  });

  it("Editar: marca o alerta na hora, manda só o que a rota precisa (a foto só se mudou), avisa e recarrega", async () => {
    respostas["PUT /api/checklists/p1"] = { status: 200, corpo: DETALHE };
    await abrir(V(["visualizar", "gerenciar"]));
    await clicar(naLinha("p1", "[data-editar-checklist]"));
    const painel = () => $('[data-painel-checklist="editar"]')!;
    expect($("[data-alerta-item]", painel())).toBeNull();
    await clicar($('[data-item-checklist="i1"] [data-opcao="NOK"]', painel()));
    expect(txt($('[data-item-checklist="i1"] [data-alerta-item]', painel()))).toBe("Alerta");
    await escolher($("[data-colaborador-checklist]", painel()), "t2");
    await digitar($("textarea[data-observacao-checklist]", painel()), "Trocar o óleo");
    await clicar($("[data-salvar-checklist]"));
    expect(gravacoes()).toEqual([{ url: "/api/checklists/p1", metodo: "PUT", corpo: {
      colaboradorId: "t2", observacaoGeral: "Trocar o óleo",
      itens: [{ itemTemplateId: "i1", valor: "NOK" }, { itemTemplateId: "i2", valor: "Sem ruído" }, { itemTemplateId: "i3", valor: null }],
    } }]);
    expect(await toasts()).toEqual([["Checklist atualizado.", "sucesso"]]);
    // a gaveta fecha (sai de cena em 300 ms, ainda no modo em que estava)
    expect($("[data-painel-checklist]")!.getAttribute("data-painel-checklist")).toBe("editar");
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect($("[data-painel-checklist]")).toBeNull();
    expect(leituras("/api/checklists?")).toBe(2);
  });

  it("Editar: tirar a foto vai no corpo (foto: null); obrigatório vazio trava ANTES de chamar o servidor", async () => {
    await abrir(V(["visualizar", "gerenciar"]));
    await clicar(naLinha("p1", "[data-editar-checklist]"));
    await digitar($('[data-item-checklist="i2"] textarea'), "");
    await clicar($("[data-salvar-checklist]"));
    expect(txt($("[data-erro-checklist]"))).toBe("Preencha: Ruídos");
    expect(gravacoes()).toEqual([]);

    await digitar($('[data-item-checklist="i2"] textarea'), "Rangido");
    await clicar($('[data-item-checklist="i3"] button[aria-label="Excluir a foto de Foto do painel"]'));
    await clicar($("[data-salvar-checklist]"));
    expect(txt($("[data-erro-checklist]"))).toBe("Anexe a foto: Foto do painel");
    expect(gravacoes()).toEqual([]);
  });

  it("Editar recusado (403): a gaveta fica aberta com o motivo, sem aviso de sucesso, e a lista não é recarregada", async () => {
    respostas["PUT /api/checklists/p1"] = RECUSA;
    await abrir(V(["visualizar", "gerenciar"]));
    await clicar(naLinha("p1", "[data-editar-checklist]"));
    await clicar($('[data-item-checklist="i1"] [data-opcao="NOK"]'));
    await clicar($("[data-salvar-checklist]"));
    expect(gravacoes()).toHaveLength(1);
    expect(txt($("[data-erro-checklist]"))).toBe("Sem permissão para esta ação");
    expect($('[data-painel-checklist="editar"]')).toBeTruthy();
    expect(await toasts()).toEqual([]);
    expect(leituras("/api/checklists?")).toBe(1);
  });

  it("se a lista não carrega, a tela diz por quê (nada de lista vazia muda)", async () => {
    const { ChecklistsPreenchidos } = await import("@/components/veiculos/checklists-preenchidos");
    respostas["GET /api/checklists"] = RECUSA;
    await montar(createElement(ChecklistsPreenchidos, { colaboradores: [] }), V([]));
    expect(txt($("[data-erro-checklists]"))).toBe("Sem permissão para esta ação");
  });
});

describe("tela do checklist de veículo (Preencher | Preenchidos)", () => {
  const VEICULOS = [{ id: "v1", placa: "FRV1A01", modelo: "Fiorino" }];
  const MODELOS = [{ id: "ck1", nome: "Checklist diário", frequencia: "DIARIO", itens: [
    { id: "i1", categoria: "Motor", descricao: "Nível do óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem: 0 },
    { id: "i2", categoria: "Cabine", descricao: "Ruídos", tipo: "TEXTO", opcoes: [], obrigatorio: false, ordem: 1 },
  ] }];
  async function abrir(permissoes: Permissoes, props: object = {}) {
    const { ChecklistTela } = await import("@/components/veiculos/checklist-tela");
    respostas["GET /api/checklists"] = { status: 200, corpo: [] };
    await montar(createElement(ChecklistTela, { veiculos: VEICULOS, templates: MODELOS, colaboradores: [{ id: "t1", nome: "João" }], ...props }), permissoes);
  }
  const abas = () => $$("[data-aba-tela]").map((a) => a.getAttribute("data-aba-tela"));

  it("as abas seguem a permissão: quem só preenche vê só o formulário; quem só vê, só os preenchidos", async () => {
    await abrir(V(["visualizar", "checklist"]));
    expect(abas()).toEqual(["preencher", "preenchidos"]);
    expect($("[data-checklist-preenchimento]")).toBeTruthy();
    expect($("[data-checklists-preenchidos]")).toBeNull();
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["checklist"]));
    expect(abas()).toEqual([]);
    expect($("[data-checklist-preenchimento]")).toBeTruthy();
    expect(chamadas.filter((c) => c.url.startsWith("/api/checklists"))).toEqual([]);
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["visualizar"]));
    expect(abas()).toEqual([]);
    expect($("[data-checklist-preenchimento]")).toBeNull();
    expect($("[data-checklists-preenchidos]")).toBeTruthy();
    act(() => root.unmount()); caixa.remove();

    await abrir(montarPermissoes({}));
    expect(txt($("[data-somente-leitura]"))).toBe("Somente leitura: requer a permissão Veículos › checklist.");
  });

  it("?aba=preenchidos abre direto na lista — só para quem pode ver", async () => {
    await abrir(V(["visualizar", "checklist"]), { abaInicial: "preenchidos" });
    expect($("[data-checklists-preenchidos]")).toBeTruthy();
    act(() => root.unmount()); caixa.remove();
    await abrir(V(["checklist"]), { abaInicial: "preenchidos" });
    expect($("[data-checklists-preenchidos]")).toBeNull();
    expect($("[data-checklist-preenchimento]")).toBeTruthy();
  });

  it("preencher: obrigatório vazio trava antes do servidor; enviar manda o alerta calculado, avisa e leva aos preenchidos", async () => {
    respostas["POST /api/checklists"] = { status: 201, corpo: { id: "novo", temAlerta: true } };
    await abrir(V(["visualizar", "checklist"]), { veiculoInicial: "v1" });
    expect($<HTMLSelectElement>("[data-veiculo-checklist]")!.value).toBe("v1");
    await clicar($("[data-enviar-checklist]"));
    expect(txt($("[data-erro-checklist]"))).toBe("Preencha: Nível do óleo");
    expect(gravacoes()).toEqual([]);

    await clicar($('[data-item-checklist="i1"] [data-opcao="NOK"]'));
    await clicar($("[data-enviar-checklist]"));
    expect(gravacoes()).toEqual([{ url: "/api/checklists", metodo: "POST", corpo: {
      veiculoId: "v1", templateId: "ck1", colaboradorId: "", observacaoGeral: "",
      itens: [{ itemTemplateId: "i1", valor: "NOK", foto: null, alerta: true }, { itemTemplateId: "i2", valor: null, foto: null, alerta: false }],
    } }]);
    expect(await toasts()).toEqual([["Checklist enviado.", "sucesso"]]);
    expect($("[data-checklist-enviado]")!.getAttribute("data-checklist-enviado")).toBe("COM_ALERTAS");
    await clicar($("[data-ver-preenchidos]"));
    expect($("[data-checklists-preenchidos]")).toBeTruthy();
  });

  it("sem veículo escolhido não envia; recusado (403): o formulário fica com as respostas e mostra o motivo", async () => {
    respostas["POST /api/checklists"] = RECUSA;
    await abrir(V(["checklist"]));
    await clicar($('[data-item-checklist="i1"] [data-opcao="OK"]'));
    await clicar($("[data-enviar-checklist]"));
    expect(txt($("[data-erro-checklist]"))).toBe("Selecione o veículo.");
    expect(gravacoes()).toEqual([]);
    await escolher($("[data-veiculo-checklist]"), "v1");
    await clicar($("[data-enviar-checklist]"));
    expect(gravacoes()).toHaveLength(1);
    expect(txt($("[data-erro-checklist]"))).toBe("Sem permissão para esta ação");
    expect($("[data-checklist-enviado]")).toBeNull();
    expect($('[data-item-checklist="i1"] [data-opcao="OK"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(await toasts()).toEqual([]);
    // quem só preenche não ganha "Ver preenchidos" (não pode ver a lista)
    expect($("[data-ver-preenchidos]")).toBeNull();
  });

  it("vocabulário: 'modelo de checklist' (nunca 'template') e a instrução da página no ⓘ", () => {
    const tela = fonte("components/veiculos/checklist-preenchimento.tsx");
    expect(tela).not.toMatch(/o template|Nenhum template|Erro de conexão|…/);
    const pagina = fonte("app/(dashboard)/veiculos/checklist/page.tsx");
    expect(pagina).toContain("dica={AJUDA}");
    expect(pagina).not.toContain("description=");
  });
});

/* ═════════ Conserto 2: responsável técnico cadastrado na hora ═════════ */
describe("Dados da empresa: responsável técnico com cadastro rápido e edição no contexto", () => {
  const EMPRESA: any = {
    id: "e1", nome: "Clima Total Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "a@b.com", logo: null,
    telefone: null, celular: null, site: null, endereco: "Av. Paulista", numero: "1000", complemento: null, bairro: null, cidade: "São Paulo",
    estado: "SP", cep: null, latitude: null, longitude: null, bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTipoConta: null,
    bancoTitular: null, pixChave: null, inscricaoEstadual: null, inscricaoMunicipal: null, cnaePrincipal: "4322302", responsavelTecnicoId: null,
  };
  const RTS = [{ id: "t2", nome: "Eng. Rosa Lima", crea: "5012345-D/SP", ativo: true }, { id: "t5", nome: "Eng. Antigo", crea: "1-D/SP", ativo: false }];
  const TUDO = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], equipes: ["visualizar", "gerenciar"] });
  const SO_CONFIG = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
  async function abrir(permissoes: Permissoes, tecnicosRt: unknown[] = RTS, responsavelTecnicoId: string | null = null) {
    const { ConfiguracoesClient } = await import("@/components/forms/configuracoes-client");
    await montar(createElement(ConfiguracoesClient, { empresa: { ...EMPRESA, responsavelTecnicoId }, config: { issAliquota: 2 } as any, parte: "empresa", tecnicosRt: tecnicosRt as any }), permissoes);
  }
  const rt = () => $("[data-rt-padrao]")!;
  const abrirSeletor = () => clicar($("button", rt()));
  const opcoes = () => $$(".max-h-60 button", rt()).map(txt);

  it("o seletor lista só os RT ativos (com o CREA), 'Nenhum' é uma escolha, e oferece cadastrar um novo", async () => {
    await abrir(TUDO);
    expect(rt().getAttribute("data-rt-padrao")).toBe("");
    await abrirSeletor();
    expect(opcoes()).toEqual(["Nenhum (o documento não mostra RT)", "Eng. Rosa Lima — CREA 5012345-D/SP"]);
    expect(botao("Novo responsável técnico", rt())).toBeTruthy();
    await clicar($$(".max-h-60 button", rt())[1]);
    expect(rt().getAttribute("data-rt-padrao")).toBe("t2");
    // o parágrafo que mandava ir a Equipes › Colaboradores saiu: agora cadastra aqui
    expect(txt(caixa)).not.toContain("Cadastre em Equipes");
  });

  it("RT inativo só aparece se já é o escolhido (dá para manter, não para escolher de novo)", async () => {
    await abrir(TUDO, RTS, "t5");
    await abrirSeletor();
    expect(opcoes()).toEqual(["Nenhum (o documento não mostra RT)", "Eng. Rosa Lima — CREA 5012345-D/SP", "Eng. Antigo — CREA 1-D/SP (inativo)"]);
  });

  it("sem RT nenhum: estado vazio com 'Cadastrar agora'; o cadastro pede nome, CPF, CREA e telefone", async () => {
    await abrir(TUDO, []);
    expect(txt(rt())).toContain("Nenhum responsável técnico cadastrado");
    await clicar(botao("Cadastrar agora", rt()));
    expect($$("label", dialogo()).map((l) => txt($("span", l)))).toEqual(["Nome completo *", "CPF *", "CREA *", "Telefone *"]);
  });

  it("cadastrar: cria o colaborador como responsável técnico com o CREA, escolhe-o no seletor e avisa", async () => {
    respostas["POST /api/tecnicos"] = { status: 201, corpo: { id: "t7", nome: "Eng. Carla Souza", crea: "7001-D/SP", tipo: "RESPONSAVEL_TECNICO" } };
    await abrir(TUDO);
    await abrirSeletor();
    await clicar(botao("Novo responsável técnico", rt()));
    await digitar(campo("Nome completo"), "Eng. Carla Souza");
    await digitar(campo("CPF"), "168.995.350-09");
    await digitar(campo("CREA"), " 7001-D/SP ");
    await digitar(campo("Telefone"), "(11) 95555-5555");
    await clicar(botao("SalvarSalvar e selecionar", dialogo()));
    expect(gravacoes()).toEqual([{ url: "/api/tecnicos", metodo: "POST", corpo: { nome: "Eng. Carla Souza", cpf: "168.995.350-09", telefone: "(11) 95555-5555", tipo: "RESPONSAVEL_TECNICO", crea: "7001-D/SP" } }]);
    expect(await toasts()).toEqual([["Responsável técnico cadastrado.", "sucesso"]]);
    expect(rt().getAttribute("data-rt-padrao")).toBe("t7");
    expect(txt($("button", rt()))).toContain("Eng. Carla Souza — CREA 7001-D/SP");
  });

  it("cadastro recusado (403) ou CPF incompleto: nada é escolhido e o motivo aparece no próprio cadastro", async () => {
    respostas["POST /api/tecnicos"] = RECUSA;
    await abrir(TUDO);
    await abrirSeletor();
    await clicar(botao("Novo responsável técnico", rt()));
    await digitar(campo("Nome completo"), "Eng. Carla Souza");
    await digitar(campo("CPF"), "168.995");
    await digitar(campo("CREA"), "7001-D/SP");
    await digitar(campo("Telefone"), "(11) 95555-5555");
    await clicar(botao("SalvarSalvar e selecionar", dialogo()));
    expect(txt(dialogo())).toContain("CPF deve ter 11 dígitos.");
    expect(gravacoes()).toEqual([]);
    await digitar(campo("CPF"), "168.995.350-09");
    await clicar(botao("SalvarSalvar e selecionar", dialogo()));
    expect(gravacoes()).toHaveLength(1);
    expect(txt(dialogo())).toContain("Sem permissão para esta ação");
    expect(rt().getAttribute("data-rt-padrao")).toBe("");
    expect(await toasts()).toEqual([]);
  });

  it("sem Equipes › gerenciar: escolhe o RT, mas não cadastra nem edita colaborador por aqui", async () => {
    await abrir(SO_CONFIG, RTS, "t2");
    await abrirSeletor();
    expect(opcoes()).toHaveLength(2);
    expect(botao("Novo responsável técnico", rt())).toBeNull();
    expect($('button[aria-label="Editar o responsável técnico selecionado"]')).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await abrir(SO_CONFIG, []);
    expect(txt(rt())).toContain("Nenhum responsável técnico cadastrado");
    expect(botao("Cadastrar agora", rt())).toBeNull();
  });

  it("editar no contexto o RT escolhido: manda só o que mudou e o rótulo do seletor acompanha", async () => {
    respostas["GET /api/tecnicos/t2"] = { status: 200, corpo: { id: "t2", nome: "Eng. Rosa Lima", telefone: "(11) 92222-2222", crea: "5012345-D/SP", cpf: "390.533.447-05" } };
    respostas["PATCH /api/tecnicos/t2"] = { status: 200, corpo: { id: "t2", nome: "Eng. Rosa Lima", telefone: "(11) 92222-2222", crea: "5012345-D/RJ", ativo: true } };
    await abrir(TUDO, RTS, "t2");
    expect($('button[aria-label="Editar o responsável técnico selecionado"]')).toBeTruthy();
    await clicar($('button[aria-label="Editar o responsável técnico selecionado"]'));
    expect($$("label", dialogo()).map((l) => txt($("span", l)))).toEqual(["Nome completo *", "Telefone *", "CREA *"]);
    expect(campo("CREA").value).toBe("5012345-D/SP");
    await digitar(campo("CREA"), "5012345-D/RJ");
    await clicar(botao("SalvarSalvar", dialogo()));
    expect(gravacoes()).toEqual([{ url: "/api/tecnicos/t2", metodo: "PATCH", corpo: { crea: "5012345-D/RJ" } }]);
    expect(await toasts()).toEqual([["Responsável técnico atualizado.", "sucesso"]]);
    expect(txt($("button", rt()))).toContain("Eng. Rosa Lima — CREA 5012345-D/RJ");
  });

  it("sem escolha (Nenhum) não há lápis; sem Configurações › gerenciar o seletor fica travado mostrando o escolhido", async () => {
    await abrir(TUDO);
    expect($('button[aria-label="Editar o responsável técnico selecionado"]')).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await abrir(montarPermissoes({ configuracoes: ["visualizar"], equipes: ["visualizar", "gerenciar"] }), RTS, "t2");
    const b = $<HTMLButtonElement>("button", rt())!;
    expect(b.disabled).toBe(true);
    expect(txt(b)).toBe("Eng. Rosa Lima — CREA 5012345-D/SP");
    expect($('button[aria-label="Editar o responsável técnico selecionado"]')).toBeNull();
  });
});

/* ═════════ Conserto 3: aba Inativos + Reativar ═════════ */
describe("Formulários de OS: aba Inativos e Reativar", () => {
  const CONFIG = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
  const F1 = { id: "f1", nome: "Preventiva de split", descricao: "", tipoOsId: null, tipoOs: null, campos: [{ id: "c1", label: "Pressão", tipo: "NUMERO", obrigatorio: true, ordem: 0 }] };
  const F2 = { id: "f2", nome: "Formulário antigo", descricao: "", tipoOsId: null, tipoOs: null, ativo: false, campos: [] };
  async function abrir(permissoes: Permissoes) {
    const { TelaFormularios } = await import("@/components/config/telas/formularios");
    respostas["GET /api/formularios"] = { status: 200, corpo: [F1] };
    respostas["GET /api/formularios?inativos=1"] = { status: 200, corpo: [F2] };
    respostas["GET /api/formularios/f1/vinculos"] = { status: 200, corpo: [] };
    await montar(createElement(TelaFormularios), permissoes);
  }
  const linhas = () => $$("[data-formulario]").map((l) => l.getAttribute("data-formulario"));
  const aba = (id: string) => clicar($(`[data-formularios] [data-aba="${id}"]`));
  const abasTxt = () => $$("[data-formularios] [data-aba]").map(txt);

  it("as abas contam os ativos e os inativos; a lista de inativos vem da leitura com o filtro", async () => {
    await abrir(CONFIG);
    expect(chamadas.filter((c) => c.url.startsWith("/api/formularios")).map((c) => c.url).sort()).toEqual(["/api/formularios", "/api/formularios?inativos=1"]);
    expect(abasTxt()).toEqual(["Ativos (1)", "Inativos (1)"]);
    expect(linhas()).toEqual(["f1"]);
    expect($$("[data-reativar-formulario]")).toEqual([]);
    await aba("inativos");
    expect(linhas()).toEqual(["f2"]);
    expect($$("[data-inativar-formulario]")).toEqual([]);
    expect($("[data-formulario='f2'] [data-reativar-formulario]")!.getAttribute("aria-label")).toBe("Reativar Formulário antigo");
  });

  it("quem só visualiza vê os inativos, sem Reativar", async () => {
    await abrir(montarPermissoes({ configuracoes: ["visualizar"] }));
    await aba("inativos");
    expect(linhas()).toEqual(["f2"]);
    expect($$("[data-reativar-formulario]")).toEqual([]);
  });

  it("Reativar manda { ativo: true }: o formulário volta para os Ativos e a tela avisa", async () => {
    respostas["PUT /api/formularios/f2"] = { status: 200, corpo: { ...F2, ativo: true } };
    await abrir(CONFIG);
    await aba("inativos");
    await clicar($("[data-formulario='f2'] [data-reativar-formulario]"));
    expect(gravacoes()).toEqual([{ url: "/api/formularios/f2", metodo: "PUT", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual([["Formulário reativado.", "sucesso"]]);
    expect(linhas()).toEqual([]);
    expect(txt($("[data-formularios]"))).toContain("Nenhum formulário inativo");
    expect(abasTxt()).toEqual(["Ativos (2)", "Inativos (0)"]);
    await aba("ativos");
    expect(linhas()).toEqual(["f2", "f1"]);
  });

  it("Reativar recusado (403): fica na aba Inativos, as contagens não mudam e o motivo aparece", async () => {
    respostas["PUT /api/formularios/f2"] = RECUSA;
    await abrir(CONFIG);
    await aba("inativos");
    await clicar($("[data-formulario='f2'] [data-reativar-formulario]"));
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(linhas()).toEqual(["f2"]);
    expect(abasTxt()).toEqual(["Ativos (1)", "Inativos (1)"]);
  });

  it("inativar leva o formulário para a aba Inativos (de onde volta)", async () => {
    respostas["DELETE /api/formularios/f1"] = { status: 200, corpo: { ok: true } };
    await abrir(CONFIG);
    await clicar($("[data-formulario='f1'] [data-inativar-formulario]"));
    await clicar($("[data-confirmar-sim]"));
    expect(await toasts()).toEqual([["Formulário inativado. Está na aba Inativos.", "sucesso"]]);
    expect(abasTxt()).toEqual(["Ativos (0)", "Inativos (2)"]);
    await aba("inativos");
    expect(linhas()).toEqual(["f2", "f1"]);
  });
});

describe("Modelos de checklist de veículo: aba Inativos e Reativar", () => {
  const FROTA = V(["visualizar", "gerenciar"]);
  const C1 = { id: "ck1", nome: "Checklist diário", descricao: "", frequencia: "DIARIO", ativo: true, itens: [], _count: { itens: 4, preenchidos: 12 } };
  const C2 = { id: "ck2", nome: "Checklist antigo", descricao: "", frequencia: "SEMANAL", ativo: false, itens: [], _count: { itens: 2, preenchidos: 3 } };
  async function abrir(permissoes: Permissoes) {
    const { ChecklistTemplatesClient } = await import("@/components/config/checklist-templates-client");
    respostas["GET /api/checklist-templates"] = { status: 200, corpo: [C1, C2] };
    await montar(createElement(ChecklistTemplatesClient), permissoes);
  }
  const linhas = () => $$("[data-modelo]").map((l) => l.getAttribute("data-modelo"));
  const aba = (id: string) => clicar($(`[data-checklists-veiculo] [data-aba="${id}"]`));
  const abasTxt = () => $$("[data-checklists-veiculo] [data-aba]").map(txt);

  it("ativos e inativos em abas (antes o inativo sumia de vez); Reativar só na aba Inativos e só com a permissão", async () => {
    await abrir(FROTA);
    expect(abasTxt()).toEqual(["Ativos (1)", "Inativos (1)"]);
    expect(linhas()).toEqual(["ck1"]);
    expect($$("[data-reativar-modelo]")).toEqual([]);
    await aba("inativos");
    expect(linhas()).toEqual(["ck2"]);
    expect($$("[data-inativar-modelo]")).toEqual([]);
    expect($("[data-modelo='ck2'] [data-reativar-modelo]")).toBeTruthy();
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["visualizar"]));
    await aba("inativos");
    expect(linhas()).toEqual(["ck2"]);
    expect($$("[data-reativar-modelo]")).toEqual([]);
  });

  it("Reativar manda { ativo: true } e o modelo volta para os Ativos; recusado, fica onde estava", async () => {
    respostas["PUT /api/checklist-templates/ck2"] = RECUSA;
    await abrir(FROTA);
    await aba("inativos");
    await clicar($("[data-modelo='ck2'] [data-reativar-modelo]"));
    expect(gravacoes()).toEqual([{ url: "/api/checklist-templates/ck2", metodo: "PUT", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(linhas()).toEqual(["ck2"]);
    expect(abasTxt()).toEqual(["Ativos (1)", "Inativos (1)"]);

    respostas["PUT /api/checklist-templates/ck2"] = { status: 200, corpo: { ...C2, ativo: true } };
    await clicar($("[data-modelo='ck2'] [data-reativar-modelo]"));
    expect((await toasts()).at(-1)).toEqual(["Modelo de checklist reativado.", "sucesso"]);
    expect(linhas()).toEqual([]);
    expect(abasTxt()).toEqual(["Ativos (2)", "Inativos (0)"]);
  });

  it("a explicação (no ⓘ) diz por onde o inativado volta", async () => {
    await abrir(FROTA);
    expect(dica("Checklists de veículo")).toContain("volta pela aba Inativos");
  });
});

/* ═════════ Listas no padrão ═════════ */
describe("lista de veículos", () => {
  const v = (id: string, extra: object = {}) => ({
    id, placa: `FRV${id}`, marca: "Fiat", modelo: "Fiorino", ano: "2022", anoModelo: "2023", combustivel: "Flex", cor: "Branco", tipo: "CARRO", tipoLabel: "Carro",
    status: "ATIVO", km: 1000, foto: null, responsavel: "João", equipe: { nome: "Alfa", cor: "#0EA5E9" }, documento: null, revisao: null, checklistHoje: null, ...extra,
  });
  const FILTROS = { q: "", tipos: [], status: "todos", aviso: "", ordem: "placa", dir: "asc", pagina: 1, porPagina: 50 };
  const RESUMO = { ativos: 1, manutencao: 0, inativos: 1, docVencido: 0, docVencendo: 0, revisaoVencida: 0, revisaoProxima: 0, semChecklist: 1 };
  async function abrir(permissoes: Permissoes) {
    const { VeiculosListaClient } = await import("@/app/(dashboard)/veiculos/veiculos-lista-client");
    const { SelecaoMassaProvider } = await import("@/components/acoes-massa/selecao");
    const itens = [v("1"), v("2", { status: "INATIVO" })];
    await montar(createElement(SelecaoMassaProvider, { entidade: "veiculos", idsPagina: ["1", "2"], total: 2, children: createElement(VeiculosListaClient, { itens: itens as any, total: 2, filtros: FILTROS as any, tipos: [], resumo: RESUMO }) }), permissoes);
  }
  const acoes = (id: string) => $$(`tr[data-veiculo-id="${id}"] [data-acoes-veiculo] a, tr[data-veiculo-id="${id}"] [data-acoes-veiculo] button`).map((b) => b.getAttribute("title"));

  it("é a tabela da casa (colunas, ordenação) e, no celular, cartões — sem tabela própria", async () => {
    await abrir(V(["visualizar"]));
    expect($("[data-tabela-veiculos]")).toBeTruthy();
    expect($$("[data-tabela-veiculos] [data-ordenar]").map((b) => b.getAttribute("data-ordenar"))).toEqual(["placa", "ano"]);
    expect($("[data-colunas-menu]")).toBeTruthy();
    expect($$('[data-visao="mobile"] [data-veiculo-id]')).toHaveLength(2);
    expect(txt($('tr[data-veiculo-id="1"] [data-placa]'))).toBe("FRV1");
    expect(txt($('tr[data-veiculo-id="1"] [data-marca-modelo]'))).toBe("Fiat Fiorino · Branco");
    const src = fonte("app/(dashboard)/veiculos/veiculos-lista-client.tsx");
    expect(src).not.toMatch(/<table|<thead|ThOrd/);
  });

  it("quem só visualiza: abre a ficha para ver (olho); sem Novo, checklist, Inativar nem Reativar", async () => {
    await abrir(V(["visualizar"]));
    expect(acoes("1")).toEqual(["Ver ficha"]);
    expect(acoes("2")).toEqual(["Ver ficha"]);
    expect($$('a[href="/veiculos/novo"]')).toEqual([]);
  });

  it("cada permissão libera a sua ação: checklist preenche, gerenciar edita e reativa, excluir inativa", async () => {
    await abrir(V(["visualizar", "checklist"]));
    expect(acoes("1")).toEqual(["Preencher checklist", "Ver ficha"]);
    expect(acoes("2")).toEqual(["Ver ficha"]); // veículo inativo não recebe checklist
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["visualizar", "gerenciar"]));
    expect(acoes("1")).toEqual(["Editar"]);
    expect(acoes("2")).toEqual(["Editar", "Reativar veículo"]);
    expect($$('a[href="/veiculos/novo"]')).toHaveLength(1);
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["visualizar", "excluir"]));
    expect(acoes("1")).toEqual(["Ver ficha", "Inativar veículo"]);
    expect(acoes("2")).toEqual(["Ver ficha"]);
  });
});

describe("Inativar / Reativar (o botão compartilhado dos cadastros)", () => {
  async function abrir(permissoes: Permissoes, ativo = true) {
    const { InativarRegistro } = await import("@/components/ui/inativar-registro");
    respostas["GET /api/veiculos/v1/impacto"] = { status: 200, corpo: { bloqueio: null, avisos: [] } };
    await montar(createElement(InativarRegistro, { url: "/api/veiculos/v1", modulo: "veiculos", acaoReativar: "gerenciar", ativo, nome: "FRV1A01", entidade: "veículo" }), permissoes);
  }
  it("aceito: avisa com toast ('Veículo inativado.') e atualiza a tela", async () => {
    respostas["DELETE /api/veiculos/v1"] = { status: 200, corpo: { ok: true } };
    await abrir(V(["visualizar", "excluir"]));
    await clicar($("[data-inativar-registro='inativar']"));
    await clicar(botao("Sim, inativar", dialogo()));
    expect(gravacoes().map((c) => [c.url, c.metodo])).toEqual([["/api/veiculos/v1", "DELETE"]]);
    expect(await toasts()).toEqual([["Veículo inativado.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("recusado (403): a confirmação fica aberta com o motivo; sem aviso de sucesso e sem atualizar a tela", async () => {
    respostas["DELETE /api/veiculos/v1"] = RECUSA;
    await abrir(V(["visualizar", "excluir"]));
    await clicar($("[data-inativar-registro='inativar']"));
    await clicar(botao("Sim, inativar", dialogo()));
    expect(txt(dialogo())).toContain("Sem permissão para esta ação");
    expect(await toasts()).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("reativar: { ativo: true } e o aviso 'Veículo reativado.'; sem a permissão, o botão nem aparece", async () => {
    respostas["PATCH /api/veiculos/v1"] = { status: 200, corpo: { ok: true } };
    await abrir(V(["visualizar", "gerenciar"]), false);
    await clicar($("[data-inativar-registro='reativar']"));
    await clicar(botao("Reativar", dialogo()));
    expect(gravacoes()).toEqual([{ url: "/api/veiculos/v1", metodo: "PATCH", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual([["Veículo reativado.", "sucesso"]]);
    act(() => root.unmount()); caixa.remove();
    await abrir(V(["visualizar"]), false);
    expect($("[data-inativar-registro]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await abrir(V(["visualizar", "gerenciar"]), true);
    expect($("[data-inativar-registro]")).toBeNull();
  });

  it("o cadastro padrão não repete o aviso (o toast é do botão — um só)", () => {
    expect(fonte("components/cadastros/cadastro-padrao.tsx")).not.toMatch(/aoConcluir=\{\(\) => \{ toast\(/);
  });
});

describe("lista de colaboradores", () => {
  const c = (id: string, extra: object = {}) => ({
    id, nome: `Colab ${id}`, funcao: "TECNICO_CAMPO", funcaoLabel: "Técnico de campo", cargo: "Eletricista", telefone: "11911111111", email: null, ativo: true, status: "ATIVO",
    especialidades: [], foto: null, equipes: [{ id: "eqA", nome: "Alfa", cor: "#0EA5E9" }], lider: false, semEquipe: false, atividades: 3, documento: null, ...extra,
  });
  const FILTROS = { q: "", status: "todos", funcoes: [], cargo: "", equipe: "", aviso: "", ordem: "nome", dir: "asc", pagina: 1, porPagina: 50 };
  const RESUMO = { ativos: 1, inativos: 1, tecnicos: 1, semEquipe: 0, ausentes: 0, docVencido: 0, docVencendo: 0 };
  async function abrir(permissoes: Permissoes) {
    const { ColaboradoresListaClient } = await import("@/app/(dashboard)/colaboradores/colaboradores-lista-client");
    const { SelecaoMassaProvider } = await import("@/components/acoes-massa/selecao");
    const itens = [c("1"), c("2", { ativo: false, status: "INATIVO" })];
    await montar(createElement(SelecaoMassaProvider, { entidade: "colaboradores", idsPagina: ["1", "2"], total: 2, children: createElement(ColaboradoresListaClient, {
      itens: itens as any, total: 2, filtros: FILTROS as any, opcoes: { funcoes: [{ value: "TECNICO_CAMPO", label: "Técnico de campo" }], cargos: [], equipes: [] }, resumo: RESUMO,
    }) }), permissoes);
  }
  const acoes = (id: string) => $$(`tr[data-colaborador-id="${id}"] [data-acoes-colaborador] a, tr[data-colaborador-id="${id}"] [data-acoes-colaborador] button`).map((b) => b.getAttribute("title"));

  it("é a tabela da casa e, no celular, cartões — sem tabela própria", async () => {
    await abrir(E(["visualizar", "gerenciar"]));
    expect($("[data-tabela-colaboradores]")).toBeTruthy();
    expect($$("[data-tabela-colaboradores] [data-ordenar]").map((b) => b.getAttribute("data-ordenar"))).toEqual(["nome", "cargo"]);
    expect($$('[data-visao="mobile"] [data-colaborador-id]')).toHaveLength(2);
    expect(fonte("app/(dashboard)/colaboradores/colaboradores-lista-client.tsx")).not.toMatch(/<table|<thead|ThOrd/);
  });

  it("quem só visualiza: o nome NÃO é link (a ficha recusaria) e a linha não tem Editar, Inativar nem Reativar; sem Novo", async () => {
    await abrir(E(["visualizar"]));
    expect($$('a[href^="/colaboradores/"]')).toEqual([]);
    expect(acoes("1")).toEqual([]);
    expect(acoes("2")).toEqual([]);
    expect($("[data-novo-colaborador]")).toBeNull();
    expect(txt($('tr[data-colaborador-id="1"] [data-nome]'))).toBe("Colab 1");
  });

  it("quem gerencia abre a ficha pelo nome e pelo lápis, e reativa; inativar pede a permissão de excluir", async () => {
    await abrir(E(["visualizar", "gerenciar"]));
    expect($('tr[data-colaborador-id="1"] a[href="/colaboradores/1/editar"] [data-nome]')).toBeTruthy();
    expect(acoes("1")).toEqual(["Editar"]);
    expect(acoes("2")).toEqual(["Editar", "Reativar colaborador"]);
    expect($$('[data-visao="mobile"] a[href^="/colaboradores/"]')).toHaveLength(2);
    act(() => root.unmount()); caixa.remove();
    await abrir(E(["visualizar", "gerenciar", "excluir"]));
    expect(acoes("1")).toEqual(["Editar", "Inativar colaborador"]);
  });

  it("Novo colaborador (cadastro rápido): grava e avisa com toast", async () => {
    respostas["POST /api/tecnicos"] = { status: 201, corpo: { id: "t9", nome: "Novo Colab" } };
    await abrir(E(["visualizar", "gerenciar"]));
    await clicar($("[data-novo-colaborador]"));
    await digitar(campo("Nome completo"), "Novo Colab");
    await digitar(campo("CPF"), "168.995.350-09");
    await digitar(campo("Telefone"), "(11) 95555-5555");
    await clicar(botao("SalvarCadastrar colaborador", dialogo()));
    expect(gravacoes()).toHaveLength(1);
    expect(await toasts()).toEqual([["Colaborador cadastrado.", "sucesso"]]);
  });
});

describe("equipes (cartões)", () => {
  const GRUPOS = [
    { id: "eqA", nome: "Alfa", cor: "#0EA5E9", status: "ATIVA", lider: { id: "t1", nome: "João", avatar: null }, membros: [{ id: "t1", nome: "João", avatar: null }], veiculos: [] },
    { id: "eqB", nome: "Antiga", cor: "#0EA5E9", status: "INATIVA", lider: null, membros: [], veiculos: [] },
  ];
  const COLABS = [{ id: "t1", nome: "João", avatar: null, tipoEquipe: "CAMPO", cargo: null, perfilAcesso: null }];
  async function abrir(permissoes: Permissoes, aba: "grupos" | "campo" = "grupos") {
    const { EquipesView } = await import("@/components/equipes/equipes-view");
    await montar(createElement(EquipesView, { aba, q: "", grupos: aba === "grupos" ? GRUPOS as any : [], colaboradores: aba === "campo" ? COLABS as any : [], perfis: [], contagens: { grupos: 2, campo: 1, administrativa: 0 }, total: aba === "grupos" ? 2 : 1, pagina: 1, porPagina: 50 }), permissoes);
  }

  it("quem só visualiza: os cartões não são link (a ficha recusaria); sem 'Nova equipe', Inativar nem Reativar", async () => {
    await abrir(E(["visualizar"]));
    expect($$("[data-card-id]")).toHaveLength(2);
    expect($$('a[href^="/equipes/eq"]')).toEqual([]);
    expect($$('a[href="/equipes/novo"]')).toEqual([]);
    expect($$("[data-inativar-registro]")).toEqual([]);
    expect(txt($('[data-card-id="eqA"]'))).toContain("1 membro");
    expect(txt($('[data-card-id="eqB"]'))).toContain("0 membros");
    act(() => root.unmount()); caixa.remove();
    await abrir(E(["visualizar"]), "campo");
    expect($$("[data-colaborador-equipe]")).toHaveLength(1);
    expect($$('a[href^="/colaboradores/"]')).toEqual([]);
  });

  it("quem gerencia: cartões abrem a ficha, 'Nova equipe' (caixa de frase) e Reativar; Inativar pede 'excluir'", async () => {
    await abrir(E(["visualizar", "gerenciar"]));
    expect($$('a[href^="/equipes/eq"]').map((a) => a.getAttribute("href"))).toEqual(["/equipes/eqA/editar", "/equipes/eqB/editar"]);
    expect(txt($('a[href="/equipes/novo"]'))).toBe("Nova equipe");
    expect($$("[data-inativar-registro]").map((b) => b.getAttribute("data-inativar-registro"))).toEqual(["reativar"]);
    expect(dica("Equipes")).toContain("Grupos de equipe");
    act(() => root.unmount()); caixa.remove();
    await abrir(E(["visualizar", "gerenciar", "excluir"]));
    expect($$("[data-inativar-registro]").map((b) => b.getAttribute("data-inativar-registro"))).toEqual(["inativar", "reativar"]);
    act(() => root.unmount()); caixa.remove();
    await abrir(E(["visualizar", "gerenciar"]), "campo");
    expect($$('a[href="/colaboradores/t1/editar"]')).toHaveLength(1);
  });
});

/* ═════════ Formulários: toast, recusa e cadastro no contexto ═════════ */
describe("formulário da equipe", () => {
  const GERENCIA = E(["visualizar", "gerenciar"]);
  const INICIAL = { id: "eqA", nome: "Alfa", cor: "#0EA5E9", status: "ATIVA", liderId: "t1", membros: [{ id: "t1" }], veiculos: [], observacoes: "" };
  async function abrir(permissoes: Permissoes, initialData: any = INICIAL) {
    if (initialData === null) initialData = undefined; // equipe nova
    const { EquipeForm } = await import("@/components/forms/equipe-form");
    respostas["GET /api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João" }, { id: "t2", nome: "Bia" }] };
    respostas["GET /api/veiculos"] = { status: 200, corpo: [] };
    await montar(createElement(EquipeForm, { initialData }), permissoes);
  }
  const lider = () => $("[data-lider-equipe]")!;
  const marcados = () => $$("[data-membros-equipe] input:checked").map((i) => i.getAttribute("aria-label"));

  it("salvar aceito: avisa ('Equipe salva.') e volta para a lista; recusado (403): fica na tela com o motivo, sem aviso", async () => {
    respostas["PUT /api/equipes/eqA"] = RECUSA;
    await abrir(GERENCIA);
    await clicar($("[data-salvar-equipe]"));
    expect(txt($("[data-erro-equipe]"))).toBe("Sem permissão para esta ação");
    expect(await toasts()).toEqual([]);
    expect(nav.push).not.toHaveBeenCalled();

    respostas["PUT /api/equipes/eqA"] = { status: 200, corpo: { id: "eqA" } };
    await clicar($("[data-salvar-equipe]"));
    expect(await toasts()).toEqual([["Equipe salva.", "sucesso"]]);
    expect(nav.push).toHaveBeenCalledWith("/equipes");
  });

  it("equipe nova: o aviso é 'Equipe cadastrada.'", async () => {
    respostas["POST /api/equipes"] = { status: 201, corpo: { id: "nova" } };
    await abrir(GERENCIA, null);
    await digitar($('[data-form-equipe] input[placeholder="Ex: Equipe Norte"]'), "Equipe Sul");
    await clicar($("[data-salvar-equipe]"));
    expect(gravacoes()[0]).toMatchObject({ url: "/api/equipes", metodo: "POST", corpo: { nome: "Equipe Sul", liderId: null, membroIds: [] } });
    expect(await toasts()).toEqual([["Equipe cadastrada.", "sucesso"]]);
  });

  it("líder: escolhe, cadastra um colaborador na hora (vira o líder) e edita o escolhido no contexto", async () => {
    respostas["POST /api/tecnicos"] = { status: 201, corpo: { id: "t7", nome: "Carla Souza" } };
    await abrir(GERENCIA);
    expect(lider().getAttribute("data-lider-equipe")).toBe("t1");
    expect($('button[aria-label="Editar o colaborador selecionado"]', lider())).toBeTruthy();
    await clicar($("button", lider()));
    expect($$(".max-h-60 button", lider()).map(txt)).toEqual(["Sem líder", "João", "Bia"]);
    await clicar(botao("Novo colaborador", lider()));
    await digitar(campo("Nome completo"), "Carla Souza");
    await digitar(campo("CPF"), "168.995.350-09");
    await digitar(campo("Telefone"), "(11) 95555-5555");
    await clicar(botao("SalvarSalvar e selecionar", dialogo()));
    expect(gravacoes()).toEqual([{ url: "/api/tecnicos", metodo: "POST", corpo: { nome: "Carla Souza", cpf: "168.995.350-09", telefone: "(11) 95555-5555", competenciaIds: [] } }]);
    expect(await toasts()).toEqual([["Colaborador cadastrado.", "sucesso"]]);
    expect(lider().getAttribute("data-lider-equipe")).toBe("t7");
    // a pessoa nova também aparece para marcar como membro
    expect($$("[data-membros-equipe] input").map((i) => i.getAttribute("aria-label"))).toEqual(["Membro Bia", "Membro Carla Souza", "Membro João"]);
  });

  it("membros: 'Novo colaborador' cadastra e já marca como membro", async () => {
    respostas["POST /api/tecnicos"] = { status: 201, corpo: { id: "t7", nome: "Carla Souza" } };
    await abrir(GERENCIA);
    expect(marcados()).toEqual(["Membro João"]);
    await clicar($("[data-novo-membro]"));
    await digitar(campo("Nome completo"), "Carla Souza");
    await digitar(campo("CPF"), "168.995.350-09");
    await digitar(campo("Telefone"), "(11) 95555-5555");
    await clicar(botao("SalvarCadastrar e marcar", dialogo()));
    expect(marcados()).toEqual(["Membro Carla Souza", "Membro João"]);
    expect(lider().getAttribute("data-lider-equipe")).toBe("t1");
  });

  it("as instruções dos campos estão no ⓘ (nenhuma solta na tela)", async () => {
    await abrir(GERENCIA);
    expect(dica("Membros")).toBe("Marque os colaboradores que compõem a equipe.");
    expect(dica("Veículos da equipe")).toBe("Marque todos os veículos que ficam com esta equipe.");
    expect(dica("Cor de identificação")).toBe("Usada para destacar a equipe no calendário.");
    expect(txt($("[data-form-equipe]"))).not.toMatch(/Marque os colaboradores|Usada para destacar|Selecione…/);
    expect(fonte("components/forms/equipe-form.tsx")).not.toMatch(/hint=/);
  });
});

describe("ficha do veículo: manutenções, seletores e aba Checklists", () => {
  const INICIAL = {
    id: "v1", placa: "FRV1A01", marca: "Fiat", modelo: "Fiorino", tipo: "CARRO", status: "ATIVO", responsavelId: "t1", equipeId: "", fotos: [], fotosRotulos: [], documentos: [], checklists: [],
    manutencoes: [{ id: "m1", tipo: "PREVENTIVA", descricao: "Troca de óleo", dataRealizacao: "2026-01-05T12:00:00.000Z", quilometragem: 1000, custo: 150 }],
  };
  async function abrir(permissoes: Permissoes, somenteLeitura = false) {
    const { VeiculoForm } = await import("@/components/forms/veiculo-form");
    respostas["GET /api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João" }] };
    respostas["GET /api/equipes"] = { status: 200, corpo: [{ id: "eqA", nome: "Alfa", status: "ATIVA" }] };
    respostas["GET /api/checklists"] = { status: 200, corpo: [] };
    await montar(createElement(VeiculoForm, { initialData: INICIAL, somenteLeitura }), permissoes);
  }
  const aba = (rotulo: string) => clicar($$("nav button").find((b) => txt(b).startsWith(rotulo)));
  const manutencoes = () => $$("[data-excluir-manutencao]").map((b) => b.getAttribute("data-excluir-manutencao"));
  const TUDO = montarPermissoes({ veiculos: ["visualizar", "checklist", "gerenciar", "excluir"], equipes: ["visualizar", "gerenciar"] });

  it("excluir manutenção recusado (403): ela CONTINUA na lista e o motivo aparece; aceito: sai e avisa", async () => {
    respostas["DELETE /api/veiculos/v1/manutencoes"] = RECUSA;
    await abrir(TUDO);
    await aba("Manutenções");
    expect(manutencoes()).toEqual(["m1"]);
    await clicar($("[data-excluir-manutencao='m1']"));
    expect(txt(confirmacao())).toContain("Excluir esta manutenção?");
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes().map((c) => [c.url, c.metodo])).toEqual([["/api/veiculos/v1/manutencoes?manutencaoId=m1", "DELETE"]]);
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(manutencoes()).toEqual(["m1"]);

    respostas["DELETE /api/veiculos/v1/manutencoes"] = { status: 200, corpo: { ok: true } };
    await clicar($("[data-excluir-manutencao='m1']"));
    await clicar($("[data-confirmar-sim]"));
    expect((await toasts()).at(-1)).toEqual(["Manutenção excluída.", "sucesso"]);
    expect(manutencoes()).toEqual([]);
  });

  it("cancelar a exclusão da manutenção não grava", async () => {
    await abrir(TUDO);
    await aba("Manutenções");
    await clicar($("[data-excluir-manutencao='m1']"));
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    expect(manutencoes()).toEqual(["m1"]);
  });

  it("registrar manutenção recusado: o formulário fica aberto e nada entra na lista; sem data ou descrição, nem chama", async () => {
    respostas["POST /api/veiculos/v1/manutencoes"] = RECUSA;
    await abrir(TUDO);
    await aba("Manutenções");
    await clicar($("[data-nova-manutencao]"));
    await clicar($("[data-registrar-manutencao]"));
    expect(gravacoes()).toEqual([]);
    expect(await toasts()).toEqual([["Informe a data e a descrição da manutenção.", "erro"]]);
  });

  it("somente leitura: sem Salvar, sem excluir nem registrar manutenção; a aba Checklists continua utilizável", async () => {
    await abrir(V(["visualizar"]), true);
    expect($("[data-salvar-veiculo]")).toBeNull();
    expect(txt($("[data-somente-leitura]"))).toBe("Somente leitura: requer a permissão Veículos › gerenciar.");
    await aba("Manutenções");
    expect($$("[data-excluir-manutencao], [data-nova-manutencao]")).toEqual([]);
    await aba("Checklists");
    // fora do fieldset travado: a lista dos preenchidos (com o Detalhe) funciona para quem só consulta
    const lista = $("[data-aba-checklists-veiculo] [data-checklists-preenchidos]")!;
    expect(lista).toBeTruthy();
    expect(lista.closest("fieldset")).toBeNull();
    expect(chamadas.some((c) => c.url === "/api/checklists?veiculoId=v1")).toBe(true);
    expect($("[data-preencher-checklist]")).toBeNull(); // sem Veículos › checklist
  });

  it("salvar: aceito avisa ('Veículo salvo.') e volta à lista; recusado fica na ficha com o motivo", async () => {
    respostas["PUT /api/veiculos/v1"] = RECUSA;
    await abrir(TUDO);
    await clicar($("[data-salvar-veiculo]"));
    expect(txt(caixa)).toContain("Sem permissão para esta ação");
    expect(await toasts()).toEqual([]);
    expect(nav.push).not.toHaveBeenCalled();
    respostas["PUT /api/veiculos/v1"] = { status: 200, corpo: { id: "v1" } };
    await clicar($("[data-salvar-veiculo]"));
    expect(await toasts()).toEqual([["Veículo salvo.", "sucesso"]]);
    expect(nav.push).toHaveBeenCalledWith("/veiculos");
  });

  it("responsável e equipe: escolher, cadastrar na hora e editar o escolhido — só com Equipes › gerenciar", async () => {
    respostas["POST /api/equipes"] = { status: 201, corpo: { id: "eqN", nome: "Equipe Sul" } };
    await abrir(TUDO);
    await aba("Responsável");
    const resp = $("[data-responsavel-veiculo]")!, equipe = $("[data-equipe-veiculo]")!;
    expect(resp.getAttribute("data-responsavel-veiculo")).toBe("t1");
    expect($('button[aria-label="Editar o colaborador selecionado"]', resp)).toBeTruthy();
    expect($('button[aria-label="Editar a equipe selecionada"]', equipe)).toBeNull(); // nada escolhido
    await clicar($("button", equipe));
    expect($$(".max-h-60 button", equipe).map(txt)).toEqual(["Sem equipe", "Alfa"]);
    await clicar(botao("Nova equipe", equipe));
    await digitar(campo("Nome da equipe"), "Equipe Sul");
    await clicar(botao("SalvarSalvar e selecionar", dialogo()));
    expect(gravacoes()).toEqual([{ url: "/api/equipes", metodo: "POST", corpo: { nome: "Equipe Sul" } }]);
    expect(await toasts()).toEqual([["Equipe cadastrada.", "sucesso"]]);
    expect(equipe.getAttribute("data-equipe-veiculo")).toBe("eqN");
    expect($('button[aria-label="Editar a equipe selecionada"]', equipe)).toBeTruthy();
    act(() => root.unmount()); caixa.remove();

    await abrir(V(["visualizar", "gerenciar"]));
    await aba("Responsável");
    await clicar($("button", $("[data-equipe-veiculo]")!));
    expect(botao("Nova equipe", $("[data-equipe-veiculo]")!)).toBeNull();
    expect($('button[aria-label="Editar o colaborador selecionado"]')).toBeNull();
  });
});

describe("montador de equipes e app do colaborador", () => {
  const EQUIPES = [{ chave: "eqA", id: "eqA", nome: "Alfa", cor: "#0EA5E9", liderId: "t1", membros: ["t1"], veiculos: [] }];
  const COLABS = [{ id: "t1", nome: "João", funcao: "Técnico", ausente: null, foto: null }, { id: "t2", nome: "Bia", funcao: "Técnico", ausente: null, foto: null }];
  async function abrir(permissoes: Permissoes, podeGerenciar: boolean) {
    const { MontadorEquipes } = await import("@/components/equipes/montador-equipes");
    await montar(createElement(MontadorEquipes, { equipesIniciais: EQUIPES, colaboradores: COLABS, podeGerenciar }), permissoes);
  }
  const salvarComposicao = () => botao("Salvar composição");

  it("somente leitura: sem a barra de salvar; a instrução de arrastar está no ⓘ", async () => {
    await abrir(E(["visualizar"]), false);
    expect($("[data-barra-montador]")).toBeNull();
    expect(txt($("[data-somente-leitura]"))).toBe("Somente leitura: requer a permissão Equipes › gerenciar.");
    expect(dica("Montar equipes")).toContain("Arraste os colaboradores");
    expect(txt($("[data-montador] h1"))).toBe("Montar equipes");
  });

  it("salvar a composição: aceito avisa com toast; recusado (403) mantém o que foi montado e diz por quê", async () => {
    respostas["POST /api/equipes/montador"] = RECUSA;
    await abrir(E(["visualizar", "gerenciar"]), true);
    expect($("[data-somente-leitura]")).toBeNull();
    // muda o nome da equipe para haver o que salvar
    await digitar($('[data-montador] input[value="Alfa"]'), "Alfa Norte");
    await clicar(salvarComposicao());
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0].corpo.equipes[0]).toMatchObject({ id: "eqA", nome: "Alfa Norte", liderId: "t1", membroIds: ["t1"] });
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(txt($("[data-status-montador]"))).toContain("Sem permissão para esta ação");
    expect($<HTMLInputElement>('[data-montador] input[value="Alfa Norte"]')).toBeTruthy();
    expect(nav.refresh).not.toHaveBeenCalled();

    respostas["POST /api/equipes/montador"] = { status: 200, corpo: { criadas: {} } };
    await clicar(salvarComposicao());
    expect((await toasts()).at(-1)).toEqual(["Composição salva.", "sucesso"]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("app do colaborador: cabeçalho neutro com a explicação no ⓘ; gravação recusada mostra o motivo sem aviso de sucesso", async () => {
    const { AppColaboradorClient } = await import("@/components/equipes/app-colaborador-client");
    const { CONFIG_APP_PADRAO } = await import("@/lib/tecnico/config-app");
    respostas["PUT /api/configuracoes"] = RECUSA;
    await montar(createElement(AppColaboradorClient, { inicial: CONFIG_APP_PADRAO }), permissoesTotais());
    expect(dica("App do colaborador")).toContain("Vale para a empresa toda");
    expect(txt($("header"))).toBe("App do colaborador");
    await clicar($("[data-salvar]"));
    expect(txt($("[data-erro-app]"))).toBe("Sem permissão para esta ação");
    expect(await toasts()).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(fonte("components/equipes/app-colaborador-client.tsx")).not.toMatch(/bg-primary-50 text-primary-700 p-2\.5|data-sucesso/);
  });
});

/* ═════════ O padrão no código ═════════ */
describe("padrão da casa nas telas da leva", () => {
  const TELAS = [
    "app/(dashboard)/veiculos/veiculos-lista-client.tsx", "app/(dashboard)/colaboradores/colaboradores-lista-client.tsx", "components/equipes/equipes-view.tsx",
    "components/forms/veiculo-form.tsx", "components/forms/equipe-form.tsx", "components/equipes/montador-equipes.tsx", "components/equipes/app-colaborador-client.tsx",
    "components/veiculos/checklists-preenchidos.tsx", "components/veiculos/checklist-preenchimento.tsx", "components/veiculos/itens-checklist.tsx", "components/veiculos/checklist-tela.tsx",
  ];
  it("nenhuma tabela própria, nenhum alert/confirm do navegador, e o vocabulário (Pesquisar, Excluir)", () => {
    for (const f of TELAS) {
      const src = fonte(f);
      expect(src, f).not.toMatch(/<table|<thead/);
      expect(src, f).not.toMatch(/window\.(alert|confirm)\(|[^.\w](alert|confirm)\(/);
      expect(src, f).not.toMatch(/>\s*Buscar|"Buscar|>\s*Remover|"Remover/);
      expect(src, f).not.toMatch(/Erro de conexão/);
    }
  });

  it("toda tela que grava avisa com o toast da casa", () => {
    for (const f of ["components/forms/veiculo-form.tsx", "components/forms/equipe-form.tsx", "components/equipes/montador-equipes.tsx", "components/equipes/app-colaborador-client.tsx",
      "components/veiculos/checklists-preenchidos.tsx", "components/veiculos/checklist-preenchimento.tsx", "components/ui/inativar-registro.tsx", "app/(dashboard)/colaboradores/colaboradores-lista-client.tsx"]) {
      expect(fonte(f), f).toMatch(/import \{[^}]*\btoast\b[^}]*\} from "@\/components\/ui\/avisos"/);
    }
  });

  it("as abas de situação são o mesmo componente no cadastro padrão, nos formulários, nos modelos e nos checklists", () => {
    for (const f of ["components/cadastros/cadastro-padrao.tsx", "components/config/telas/formularios.tsx", "components/config/checklist-templates-client.tsx", "components/veiculos/checklists-preenchidos.tsx"]) {
      expect(fonte(f), f).toContain('from "@/components/listagem/abas-situacao"');
      expect(fonte(f), f).not.toMatch(/role="tab"/);
    }
  });
});
