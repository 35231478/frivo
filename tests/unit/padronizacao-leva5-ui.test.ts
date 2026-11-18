// @vitest-environment happy-dom
/**
 * PADRONIZAÇÃO — LEVA 5: a Operação montada de verdade (DOM real, API simulada).
 *
 * PRIORIDADE Nº 1 — o que grava só aparece para quem pode:
 *  - calendário: "Nova OS neste dia" só com Ordens › criar; arrastar para reagendar só com Ordens ›
 *    editar (e o cadeado do cartão continua significando só "OS concluída");
 *  - "Gerar OS recorrentes do mês" SAIU do calendário: as OS dos contratos nascem sozinhas na rotina
 *    diária (tests/unit/os-recorrentes-horizonte-pg.test.ts); os testes do botão saíram com ele;
 *  - o botão Editar da OS só com Ordens › editar; se o servidor recusa, a gaveta fica aberta com o
 *    que foi digitado e a tela NÃO muda.
 *
 * CONSERTO: o botão "Editar" do cabeçalho da OS apontava para uma rota que só redirecionava de volta
 * (botão morto). Agora abre a gaveta "Editar OS" — e, com o registro fechado, vira cadeado com o ⓘ.
 *
 * SUGESTÕES (Princípio 9): aparecem na abertura da OS e no diálogo do calendário, dizem de onde vêm,
 * só entram no clique em "Usar", somem no "Dispensar" — e com histórico fino não aparecem.
 *
 * PADRÃO: toast da casa (o calendário tinha um próprio), cadastro inline nos seletores do diálogo.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { centralDaOs } from "@/lib/os/central";
import { TRAVA_ASSINADA, TRAVA_FATURADO, TRAVA_NOTA } from "@/lib/edicao-contexto";
import { notaDaSugestao } from "@/lib/os/sugestoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/calendario", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
/** A gaveta sai com animação (300 ms): o conteúdo só desaparece depois dela */
const esperarAnimacao = () => act(async () => { await new Promise((r) => setTimeout(r, 400)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string | RegExp, dentro: ParentNode = document) =>
  [...dentro.querySelectorAll("button")].filter((b) => (typeof t === "string" ? txt(b) === t : t.test(txt(b)))).at(-1) ?? null;
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
async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [createElement(Avisos, { key: "avisos" }), createElement("div", { key: "tela" }, el)] }));
  });
  await esperar();
}
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
const dica = (rotulo: string) => {
  const b = $(`[data-dica][aria-label="Ajuda: ${rotulo}"]`);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby") ?? "")) : null;
};
const RECUSA = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };

beforeAll(async () => {
  // Avisos primeiro e sozinho: importar em paralelo cria duas cópias do módulo simulado
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/providers/permissoes-provider"),
    () => import("@/components/calendario/calendario-grid"),
    () => import("@/components/os/central/cabecalho-os"),
    () => import("@/components/os/central/editar-os"),
    () => import("@/components/os/sugestao-abertura"),
    () => import("@/app/(dashboard)/ordens/nova/page"),
    () => import("@/components/cadastro-rapido/definicoes"),
  ]) await m();
}, 180_000);

beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear(); nav.push.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    const r = respostas[`${metodo} ${url}`] ?? respostas[`${metodo} ${url.split("?")[0]}`] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const O = (acoes: string[]) => montarPermissoes({ ordens: acoes as any });

/* ═════════ o conserto do botão "Editar" da OS ═════════ */
const osBase = (extra: Record<string, unknown> = {}) => ({
  id: "os1", numero: "OS-1001", status: "EM_ANDAMENTO", statusManual: false, prioridade: "NORMAL",
  descricao: "Higienização dos splits", observacoes: "", previsaoConclusao: null, responsavelId: null, responsavel: null,
  cliente: { id: "c1", nome: "Hospital Santa Clara", nomeFantasia: "Hospital Santa Clara" },
  unidade: { id: "u1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
  atividades: [], medicoes: [], itensOrcamento: [], orcamentos: [], servicosAdicionais: [], prazosSla: [], materiais: [],
  aceite: null, fatura: null, notaEmitida: false, equipamentoId: null,
  ...extra,
});
async function abrirOs(os: Record<string, unknown>, permissoes: Permissoes = permissoesTotais()) {
  const { CabecalhoOs } = await import("@/components/os/central/cabecalho-os");
  await montar(createElement(CabecalhoOs, { os, central: centralDaOs(os as any), onAba: () => {}, onAtualizado: () => {} }), permissoes);
}

describe("Leva 5 — o botão Editar da OS: era morto, agora abre a gaveta", () => {
  it("com Ordens › editar: o Editar abre a gaveta com os campos da OS já preenchidos", async () => {
    await abrirOs(osBase({ prioridade: "ALTA", observacoes: "Levar escada" }));
    expect($("[data-editar-os-abrir]")).toBeTruthy();
    expect($("[data-editar-os]")).toBeNull();

    await clicar($("[data-editar-os-abrir]"));
    expect($("[data-editar-os]")).toBeTruthy();
    expect($<HTMLSelectElement>("[data-prioridade-os]")!.value).toBe("ALTA");
    expect($<HTMLTextAreaElement>("[data-descricao-os]")!.value).toBe("Higienização dos splits");
    expect($<HTMLTextAreaElement>("[data-observacoes-os]")!.value).toBe("Levar escada");
  });

  it("salva SÓ o que mudou, com toast, e nada vai se nada mudou", async () => {
    respostas["PUT /api/ordens/os1"] = { status: 200, corpo: { ...osBase(), prioridade: "URGENTE" } };
    await abrirOs(osBase());
    await clicar($("[data-editar-os-abrir]"));
    await escolher($("[data-prioridade-os]"), "URGENTE");
    await clicar($("[data-salvar-os]"));
    expect(gravacoes()).toEqual([{ url: "/api/ordens/os1", metodo: "PUT", corpo: { prioridade: "URGENTE" } }]);
    expect(await toasts()).toEqual([["OS salva.", "sucesso"]]);
    await esperarAnimacao();
    expect($("[data-editar-os]")).toBeNull(); // fechou

    // reabrir e salvar sem mexer em nada: nenhuma chamada
    chamadas.length = 0;
    await clicar($("[data-editar-os-abrir]"));
    await clicar($("[data-salvar-os]"));
    expect(gravacoes()).toEqual([]);
  });

  it("Data prevista e Prazo para finalizar são DOIS campos: cada um com a sua dica, e mudar o prazo manda só o prazo", async () => {
    respostas["PUT /api/ordens/os1"] = { status: 200, corpo: { ...osBase(), prazoExecucao: "2026-12-20T00:00:00.000Z" } };
    await abrirOs(osBase({ previsaoConclusao: "2026-12-10T00:00:00.000Z", prazoExecucao: "2026-12-15T00:00:00.000Z" }));
    await clicar($("[data-editar-os-abrir]"));
    const prevista = $<HTMLInputElement>("[data-editar-os] input[aria-label='Data prevista']")!;
    const prazo = $<HTMLInputElement>("[data-editar-os] input[aria-label='Prazo para finalizar']")!;
    expect([prevista.value, prazo.value]).toEqual(["10/12/2026", "15/12/2026"]);
    expect($("[data-editar-os]")!.textContent).not.toContain("Previsão de conclusão"); // o rótulo que misturava os dois saiu
    expect($('[data-editar-os] [data-dica][aria-label="Ajuda: Data prevista"]')).toBeTruthy();
    expect($('[data-editar-os] [data-dica][aria-label="Ajuda: Prazo para finalizar"]')).toBeTruthy();

    await digitar(prazo, "20122026");
    await clicar($("[data-salvar-os]"));
    expect(gravacoes()).toEqual([{ url: "/api/ordens/os1", metodo: "PUT", corpo: { prazoExecucao: "2026-12-20" } }]);
  });

  it("as datas chegam do servidor como Date: os dois campos abrem PREENCHIDOS (abriam vazios) — com hora, vale o dia de Brasília; e salvar sem mexer não manda nada", async () => {
    // 20/11 às 22h de Brasília já é dia 21 em UTC: o campo mostra 20/11
    await abrirOs(osBase({ previsaoConclusao: new Date("2026-11-21T01:00:00.000Z"), prazoExecucao: new Date("2026-11-25T00:00:00.000Z") }));
    await clicar($("[data-editar-os-abrir]"));
    expect($<HTMLInputElement>("[data-editar-os] input[aria-label='Data prevista']")!.value).toBe("20/11/2026");
    expect($<HTMLInputElement>("[data-editar-os] input[aria-label='Prazo para finalizar']")!.value).toBe("25/11/2026");
    await clicar($("[data-salvar-os]"));
    expect(gravacoes()).toEqual([]);
  });

  it("o servidor recusou (403): a gaveta FICA aberta com o que foi digitado, o motivo aparece e não há toast", async () => {
    respostas["PUT /api/ordens/os1"] = RECUSA;
    await abrirOs(osBase());
    await clicar($("[data-editar-os-abrir]"));
    await digitar($("[data-observacoes-os]"), "Portaria pede crachá");
    await clicar($("[data-salvar-os]"));
    expect(txt($("[data-erro-os]"))).toBe("Sem permissão para esta ação");
    expect($<HTMLTextAreaElement>("[data-observacoes-os]")!.value).toBe("Portaria pede crachá");
    expect(await toasts()).toEqual([]);
  });

  it("descrição vazia não vai ao servidor", async () => {
    await abrirOs(osBase());
    await clicar($("[data-editar-os-abrir]"));
    await digitar($("[data-descricao-os]"), "   ");
    await clicar($("[data-salvar-os]"));
    expect(gravacoes()).toEqual([]);
    expect(txt($("[data-erro-os]"))).toBe("Descreva o serviço da OS.");
  });

  it("sem Ordens › editar o botão não existe (e o servidor recusaria de qualquer jeito)", async () => {
    await abrirOs(osBase(), O(["visualizar"]));
    expect($("[data-editar-os-abrir]")).toBeNull();
    expect($("[data-editar-os-travado]")).toBeNull();
  });

  it("OS CANCELADA não oferece editar", async () => {
    await abrirOs(osBase({ status: "CANCELADA" }));
    expect($("[data-editar-os-abrir]")).toBeNull();
  });

  it("registro FECHADO: o botão vira cadeado com o motivo no ⓘ, e a gaveta não abre", async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ aceite: { situacao: "CONFIRMADO" } }, TRAVA_ASSINADA],
      [{ fatura: { id: "f1" } }, TRAVA_FATURADO],
      [{ notaEmitida: true }, TRAVA_NOTA],
    ];
    for (const [extra, motivo] of casos) {
      await abrirOs(osBase(extra));
      expect($("[data-editar-os-abrir]"), motivo).toBeNull();
      const travado = $("[data-editar-os-travado]");
      expect(travado, motivo).toBeTruthy();
      expect((travado as HTMLButtonElement).disabled).toBe(true);
      expect(dica("Por que não dá para editar")).toBe(motivo);
      await clicar(travado);
      expect($("[data-editar-os]")).toBeNull();
      act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    }
  });
});

/* ═════════ as sugestões da abertura da OS ═════════ */
const SUG_COMPLETA = {
  janelaMeses: 6,
  tipoOs: { id: "tp1", nome: "Preventiva", vezes: 3 },
  executor: { tipo: "tecnico", id: "t1", nome: "João Silva", vezes: 2 },
};
const dadosDaAbertura = (sug: unknown) => {
  respostas["GET /api/clientes"] = { status: 200, corpo: [{ id: "c1", nome: "Hospital Santa Clara", nomeFantasia: null }] };
  respostas["GET /api/tipos-os"] = { status: 200, corpo: [{ id: "tp1", nome: "Preventiva", ativo: true }, { id: "tp2", nome: "Corretiva", ativo: true }] };
  respostas["GET /api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [{ id: "tp1" }, { id: "tp2" }], veiculoId: null }] };
  respostas["GET /api/equipes?resumo=1"] = { status: 200, corpo: [{ id: "eq1", nome: "Equipe Azul", cor: "#1d4ed8", liderId: "t1", membroIds: ["t1"] }] };
  respostas["GET /api/veiculos?resumo=1"] = { status: 200, corpo: [] };
  respostas["GET /api/ordens/sugestoes?clienteId=c1"] = { status: 200, corpo: sug };
};

async function abrirNovaOs(sug: unknown) {
  dadosDaAbertura(sug);
  const { default: NovaOrdemPage } = await import("@/app/(dashboard)/ordens/nova/page");
  await montar(createElement(NovaOrdemPage));
  // escolhe o cliente: é o que dispara a sugestão
  await clicar(botao(/Selecione o cliente|Hospital/));
  await clicar(botao("Hospital Santa Clara"));
}

describe("Leva 5 — sugestões da abertura da OS (sugere, não preenche no escuro)", () => {
  it("sem cliente escolhido, nem pergunta ao servidor", async () => {
    dadosDaAbertura(SUG_COMPLETA);
    const { default: NovaOrdemPage } = await import("@/app/(dashboard)/ordens/nova/page");
    await montar(createElement(NovaOrdemPage));
    expect(chamadas.some((c) => c.url.startsWith("/api/ordens/sugestoes"))).toBe(false);
    expect($("[data-sugestao]")).toBeNull();
  });

  it("com o cliente escolhido, pergunta e mostra as duas sugestões dizendo de onde vêm", async () => {
    await abrirNovaOs(SUG_COMPLETA);
    expect(chamadas.filter((c) => c.url === "/api/ordens/sugestoes?clienteId=c1").length).toBe(1);
    // o texto da linha (os botões Usar/Dispensar vêm depois, no mesmo parágrafo)
    expect(txt($("[data-sugestao='tipo'] > span"))).toBe(`Sugestão: Preventiva. ${notaDaSugestao(3, "tipo")}`);
    expect(txt($("[data-sugestao='executor'] > span"))).toBe(`Sugestão: João Silva. ${notaDaSugestao(2, "executor")}`);
    expect($$("[data-sugestao='tipo'] button").map((b) => txt(b))).toEqual(["Usar", "Dispensar"]);
    // nada foi preenchido: o campo continua vazio até alguém clicar em "Usar"
    expect(txt(botao(/Sem tipo definido/))).toContain("Sem tipo definido");
    expect($("[data-tecnicos-escolhidos]")).toBeNull();
  });

  it("\"Usar\" preenche o campo e a linha some; o que foi para o servidor é o sugerido", async () => {
    respostas["POST /api/ordens"] = { status: 201, corpo: { id: "osNova", numero: "OS-900" } };
    await abrirNovaOs(SUG_COMPLETA);
    await clicar($("[data-usar-sugestao='tipo']"));
    expect($("[data-sugestao='tipo']")).toBeNull();
    await clicar($("[data-usar-sugestao='executor']"));
    expect($("[data-sugestao='executor']")).toBeNull();
    expect(txt($("[data-tecnicos-escolhidos]"))).toContain("João Silva");

    await digitar($("textarea"), "Higienização dos splits da recepção");
    await clicar(botao("Abrir ordem de serviço"));
    const pedido = gravacoes().find((c) => c.url === "/api/ordens");
    expect(pedido?.corpo?.execucao).toMatchObject({ tipoOsId: "tp1", tecnicoIds: ["t1"], responsavelId: "t1" });
  });

  it("\"Dispensar\" tira a linha sem preencher nada", async () => {
    await abrirNovaOs(SUG_COMPLETA);
    await clicar($("[data-dispensar-sugestao='tipo']"));
    expect($("[data-sugestao='tipo']")).toBeNull();
    expect($("[data-sugestao='executor']")).toBeTruthy(); // uma não apaga a outra
    expect(txt(botao(/Sem tipo definido/))).toContain("Sem tipo definido");
  });

  it("HISTÓRICO FINO: o servidor não sugere nada e a tela não mostra linha nenhuma", async () => {
    await abrirNovaOs({ janelaMeses: 6, tipoOs: null, executor: null });
    expect($$("[data-sugestao]")).toEqual([]);
  });

  it("servidor fora do ar na sugestão: a abertura da OS segue normal (a sugestão é um extra)", async () => {
    dadosDaAbertura(SUG_COMPLETA);
    // a recusa vem com um corpo que PARECE uma sugestão: nada de uma resposta não-ok pode entrar na tela
    respostas["GET /api/ordens/sugestoes?clienteId=c1"] = { status: 500, corpo: { erro: "ops", janelaMeses: 6, tipoOs: { id: "tpX", nome: "NAO DEVIA APARECER", vezes: 9 }, executor: null } };
    const { default: NovaOrdemPage } = await import("@/app/(dashboard)/ordens/nova/page");
    await montar(createElement(NovaOrdemPage));
    await clicar(botao(/Selecione o cliente|Hospital/));
    await clicar(botao("Hospital Santa Clara"));
    expect($$("[data-sugestao]")).toEqual([]);
    expect(txt(document.body)).not.toContain("NAO DEVIA APARECER");
    expect(await toasts()).toEqual([]); // nem toast de erro: não é problema de quem está abrindo a OS
  });

  it("o sugerido que já não dá para escolher não é oferecido (técnico fora da lista)", async () => {
    await abrirNovaOs({ ...SUG_COMPLETA, executor: { tipo: "tecnico", id: "tFantasma", nome: "Quem saiu", vezes: 4 } });
    expect($("[data-sugestao='tipo']")).toBeTruthy();
    expect($("[data-sugestao='executor']")).toBeNull();
  });
});

/* ═════════ o calendário ═════════ */
const CELULAS = Array.from({ length: 7 }, (_, i) => ({ dateKey: `2026-11-${15 + i}`, dayNum: 15 + i, inMonth: true, isToday: false, rowIndex: 0 }));
const OPCOES = {
  clientes: [{ value: "c1", label: "Hospital Santa Clara" }],
  tiposOs: [{ value: "tp1", label: "Preventiva" }],
  tecnicos: [{ value: "t1", label: "João Silva" }],
};
const CARD = {
  chave: "osA:2026-11-17", id: "osA", numero: "OS-1001", origem: "MANUAL", atividadeId: "a1", clienteId: "c1",
  tecnicoId: "t1", tipoOsId: "tp1", clienteCurto: "Hospital", clienteCompleto: "Hospital Santa Clara",
  unidade: "Matriz", tipoOs: "Preventiva", hora: "09:00", dataFmt: "17/11", tecnicoNome: "João Silva",
  tecnicoAvatar: null, status: "AGENDADA", prioridade: "NORMAL", atrasada: false,
};
async function abrirCalendario(permissoes: Permissoes = permissoesTotais(), eventosPorDia: Record<string, unknown[]> = {}) {
  const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
  await montar(createElement(CalendarioGrid, { celulas: CELULAS, eventosPorDia, opcoes: OPCOES } as any), permissoes);
}

describe("Leva 5 — calendário: permissão nos botões que gravam", () => {
  it("com Ordens › criar, o dia oferece criar a OS ali; sem ela, nenhum caminho aparece", async () => {
    await abrirCalendario(O(["visualizar", "criar"]));
    expect($$("[data-criar-no-dia]").length).toBeGreaterThan(0);
    await clicar($('[data-dia="2026-11-17"]'));
    expect(txt($('[role="dialog"]')) || txt(document.body)).toContain("Nova OS");

    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await abrirCalendario(O(["visualizar"]));
    expect($$("[data-criar-no-dia]")).toEqual([]);
    await clicar($('[data-dia="2026-11-17"]'));
    expect(txt(document.body)).not.toContain("Nova OS");
    expect(gravacoes()).toEqual([]);
  });

  it("sem Ordens › editar o cartão não é arrastável — e o cadeado continua só para OS concluída", async () => {
    await abrirCalendario(O(["visualizar"]), { "2026-11-17": [CARD] });
    const agarraveis = () => $$('[data-dia="2026-11-17"] div').filter((d) => /cursor-grab/.test(d.className)).length;
    expect(txt($('[data-dia="2026-11-17"]')), "o cartão está na tela").toContain("Hospital");
    expect(agarraveis(), "nenhum cartão agarrável sem a permissão").toBe(0);
    // e o cadeado não virou "falta permissão" (ele é só da OS concluída)
    expect(txt(document.body)).not.toContain("Não é possível reagendar OS concluída");

    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await abrirCalendario(O(["visualizar", "editar"]), { "2026-11-17": [CARD] });
    expect(agarraveis(), "com a permissão, o cartão é agarrável").toBeGreaterThan(0);
  });

  it("o diálogo \"Nova OS\" usa os seletores do padrão (cadastrar na hora) e o toast da casa", async () => {
    respostas["GET /api/tipos-os"] = { status: 200, corpo: [{ id: "tp1", nome: "Preventiva", ativo: true }] };
    respostas["GET /api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [{ id: "tp1" }], veiculoId: null }] };
    respostas["GET /api/equipes?resumo=1"] = { status: 200, corpo: [{ id: "eq1", nome: "Equipe Azul", cor: "#1d4ed8", liderId: "t1", membroIds: ["t1"] }] };
    respostas["POST /api/ordens"] = { status: 201, corpo: { id: "osNova", numero: "OS-900" } };
    respostas["GET /api/ordens/sugestoes?clienteId=c1"] = { status: 200, corpo: { janelaMeses: 6, tipoOs: null, executor: null } };
    await abrirCalendario();
    await clicar($('[data-dia="2026-11-17"]'));
    // o seletor de cliente é o do cadastro rápido (abre a lista; com permissão, oferece cadastrar)
    await clicar(botao(/Pesquisar cliente/));
    expect(botao("Novo cliente"), "o cadastro inline do cliente").toBeTruthy();
    await clicar(botao("Hospital Santa Clara"));
    await clicar($("[data-seletor-equipe] button"));
    await clicar($('[data-opcao-equipe="eq1"]') ?? botao("Equipe Azul"));
    await digitar($("textarea"), "Limpeza dos filtros");
    await clicar(botao("Criar OS"));
    expect(await toasts()).toEqual([["OS OS-900 criada em 17/11/2026.", "sucesso"]]);
  });

  it("a sugestão também aparece no diálogo do calendário, e com histórico fino não aparece", async () => {
    respostas["GET /api/tipos-os"] = { status: 200, corpo: [{ id: "tp1", nome: "Preventiva", ativo: true }] };
    respostas["GET /api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [{ id: "tp1" }], veiculoId: null }] };
    respostas["GET /api/equipes?resumo=1"] = { status: 200, corpo: [{ id: "eq1", nome: "Equipe Azul", cor: "#1d4ed8", liderId: "t1", membroIds: ["t1"] }] };
    respostas["GET /api/ordens/sugestoes?clienteId=c1"] = { status: 200, corpo: SUG_COMPLETA };
    await abrirCalendario();
    await clicar($('[data-dia="2026-11-17"]'));
    await clicar(botao(/Pesquisar cliente/));
    await clicar(botao("Hospital Santa Clara"));
    expect(txt($("[data-sugestao='tipo']"))).toContain("Preventiva");
    await clicar($("[data-usar-sugestao='tipo']"));
    expect($("[data-sugestao='tipo']")).toBeNull();
  });
});
