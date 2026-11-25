// @vitest-environment happy-dom
/**
 * CALENDÁRIO — clicar na OS abre a gaveta "Editar OS" (a MESMA da central), sem sair do calendário:
 *  - o clique não navega mais: abre a gaveta, com "Abrir a OS" no rodapé para a página inteira;
 *  - o cartão que vem de uma ATIVIDADE ganha "Agendamento desta visita" (dia e hora), salvo pelo
 *    mesmo PATCH do arrastar; o cartão pela data prevista não tem essa seção;
 *  - ao salvar, o cartão se move na tela na hora (e a página é recarregada por baixo);
 *  - LEITURA, não porta fechada: sem "ordens › editar", OS inativada ou registro fechado (a trava
 *    vem do servidor) a gaveta abre travada, com o motivo, e nada vai para o servidor;
 *  - a lista do dia (celular) também abre a gaveta; Esc fecha.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_HORA_INVALIDA } from "@/components/ui/input-data-hora";
import { MSG_OS_INATIVADA, MSG_SEM_PERMISSAO_EDITAR, diaDoCartao } from "@/components/calendario/gaveta-os";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/calendario", useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/ui/avisos", async (original) => ({
  ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true),
}));

let root: Root, caixa: HTMLDivElement;
const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el, "campo a preencher").toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement("div", null, el) })); });
  await esperar();
}

/* ───────── o servidor de mentira: o GET da OS, o PUT dos campos, o PATCH da visita ───────── */
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const servidor = { trava: null as string | null, getStatus: 200, patchOk: true };
const OS_BASE = {
  id: "a1", numero: "OS-0147", chamadoNumero: null, status: "AGENDADA", prioridade: "NORMAL", responsavelId: null, responsavel: null,
  previsaoConclusao: "2026-11-17T00:00:00.000Z", prazoExecucao: null, descricao: "Preventiva do chiller", observacoes: "",
};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  chamadas.length = 0;
  servidor.trava = null; servidor.getStatus = 200; servidor.patchOk = true;
  nav.push.mockReset(); nav.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url), metodo = init?.method ?? "GET";
    const corpo = init?.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url: u, metodo, corpo });
    if (u.startsWith("/api/usuarios")) return json([{ id: "u9", nome: "Ana Souza" }]);
    if (metodo === "GET") return servidor.getStatus === 200 ? json({ ...OS_BASE, trava: servidor.trava }) : json({ erro: "Não encontrado" }, servidor.getStatus);
    if (metodo === "PUT") return json({ ...OS_BASE, ...corpo });
    if (metodo === "PATCH") return servidor.patchOk ? json({ ok: true }) : json({ erro: "Não é possível reagendar OS concluída ou cancelada." }, 422);
    return json({}, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/* ───────── o calendário ───────── */
const CELULAS = Array.from({ length: 7 }, (_, i) => ({ dateKey: `2026-11-${15 + i}`, dayNum: 15 + i, inMonth: true, isToday: i === 2, rowIndex: 0 }));
const OPCOES = { clientes: [{ value: "c1", label: "Hospital" }], tiposOs: [], tecnicos: [], unidades: [] };
const card = (id: string, dia: string, extra: Record<string, unknown> = {}) => ({
  chave: `${id}:${dia}`, id, numero: "OS-0147", origem: "MANUAL", atividadeId: "at-1", clienteId: "c1", tecnicoId: null, tipoOsId: null,
  clienteCurto: "Hospital", clienteCompleto: "Hospital Santa Clara", unidadeId: null, unidade: null, tipoOs: null, hora: "09:00",
  dataFmt: "17/11/2026", tecnicoNome: null, tecnicoAvatar: null, status: "AGENDADA", prioridade: "NORMAL", atrasada: false, ...extra,
});
const EVENTOS = {
  "2026-11-17": [card("a1", "2026-11-17")],
  // pela DATA PREVISTA (sem atividade no período): não tem visita para reagendar
  "2026-11-18": [card("a1", "2026-11-18", { atividadeId: null, hora: null })],
};
async function abrirCalendario(eventos: Record<string, unknown[]> = EVENTOS, permissoes?: Permissoes) {
  const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
  await montar(createElement(CalendarioGrid, { celulas: CELULAS, eventosPorDia: eventos, opcoes: OPCOES } as any), permissoes);
}
const cartao = (dia: string) => $(`[data-dia="${dia}"] [data-cartao-os]`);
const gaveta = () => $("[data-editar-os]");
// A casca "Carregando a OS…" é outro diálogo que ainda anima a saída por 300ms: o título é o DA gaveta
const tituloDaGaveta = () => txt($("h3", gaveta()!.closest('[role="dialog"]')!));
const blur = async (el: Element | null) => { await act(async () => { el?.dispatchEvent(new Event("blur", { bubbles: true })); }); await esperar(); };

describe("Calendário — clicar na OS abre a gaveta 'Editar OS'", () => {
  it("o clique NÃO navega mais: abre a gaveta da central, já com a OS carregada e o link para a página inteira", async () => {
    await abrirCalendario();
    expect(gaveta(), "fechada até clicar").toBeNull();
    await clicar(cartao("2026-11-17"));
    expect(nav.push, "nada de router.push").not.toHaveBeenCalled();
    expect(chamadas.find((c) => c.metodo === "GET" && c.url === "/api/ordens/a1"), "buscou a OS").toBeTruthy();
    expect(gaveta()).toBeTruthy();
    expect(tituloDaGaveta()).toBe("Editar a OS OS-0147");
    expect($<HTMLTextAreaElement>("[data-descricao-os]")!.value).toBe("Preventiva do chiller");
    // o link conferido é o DA gaveta (a casca "Carregando…" também o tem, e ainda anima a saída)
    expect($<HTMLAnchorElement>("[data-abrir-os-completa]", gaveta()!.closest('[role="dialog"]')!)!.getAttribute("href")).toBe("/ordens/a1");
    expect($("[data-salvar-os]"), "quem pode editar vê o Salvar").toBeTruthy();
  });

  it("o cartão que vem de uma ATIVIDADE traz 'Agendamento desta visita' com o dia e a hora do cartão", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    const visita = $("[data-visita-gaveta]");
    expect(visita).toBeTruthy();
    expect(txt(visita)).toContain("Agendamento desta visita");
    expect($<HTMLInputElement>('input[aria-label="Dia da visita"]')!.value).toBe("17/11/2026");
    expect($<HTMLInputElement>('input[aria-label="Hora da visita"]')!.value).toBe("09:00");
    expect(diaDoCartao({ chave: "a1:2026-11-17", id: "a1" })).toBe("2026-11-17");
  });

  it("o cartão pela DATA PREVISTA (sem atividade) não tem visita para reagendar", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-18"));
    expect(gaveta()).toBeTruthy();
    expect($("[data-visita-gaveta]")).toBeNull();
  });

  it("mudar o dia e a hora da visita salva pelo PATCH do arrastar, move o cartão na tela e recarrega por baixo", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    await digitar($('input[aria-label="Dia da visita"]'), "19/11/2026");
    await digitar($('input[aria-label="Hora da visita"]'), "14:30");
    await clicar($("[data-salvar-os]"));

    const patch = chamadas.find((c) => c.metodo === "PATCH");
    expect(patch?.url).toBe("/api/ordens/a1");
    expect(patch?.corpo).toEqual({ data: "2026-11-19", hora: "14:30", atividadeId: "at-1" });
    expect(chamadas.find((c) => c.metodo === "PUT"), "nenhum campo da OS mudou: sem PUT").toBeUndefined();
    expect(gaveta(), "fechou ao salvar").toBeNull();
    expect(nav.refresh).toHaveBeenCalled();
    // o cartão já está no dia novo, com a hora nova — sem esperar o servidor
    expect(cartao("2026-11-17")).toBeNull();
    expect(txt($('[data-dia="2026-11-19"] [data-hora-card]'))).toBe("14:30");
  });

  it("mudar só um campo da OS manda o PUT (o mesmo da central) e nenhum PATCH", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    await digitar($("[data-descricao-os]"), "Preventiva do chiller — trocar o filtro");
    await clicar($("[data-salvar-os]"));
    const put = chamadas.find((c) => c.metodo === "PUT");
    expect(put?.corpo).toEqual({ descricao: "Preventiva do chiller — trocar o filtro" });
    expect(chamadas.find((c) => c.metodo === "PATCH")).toBeUndefined();
    expect(gaveta()).toBeNull();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("os dois juntos: PUT dos campos e PATCH da visita, nessa ordem", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    await digitar($("[data-observacoes-os]"), "Levar escada");
    await digitar($('input[aria-label="Hora da visita"]'), "10:00");
    await clicar($("[data-salvar-os]"));
    const metodos = chamadas.filter((c) => c.metodo === "PUT" || c.metodo === "PATCH").map((c) => c.metodo);
    expect(metodos).toEqual(["PUT", "PATCH"]);
    expect(chamadas.find((c) => c.metodo === "PATCH")?.corpo).toEqual({ data: "2026-11-17", hora: "10:00", atividadeId: "at-1" });
  });

  it("a visita mudou mas a hora ficou vazia: não salva e explica", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    await digitar($('input[aria-label="Hora da visita"]'), "");
    await digitar($('input[aria-label="Dia da visita"]'), "19/11/2026");
    await clicar($("[data-salvar-os]"));
    expect(txt($("[data-erro-os]"))).toBe(MSG_HORA_INVALIDA);
    expect(chamadas.find((c) => c.metodo === "PATCH")).toBeUndefined();
    expect(gaveta(), "fica aberta para corrigir").toBeTruthy();
  });

  it("o servidor recusou a visita: a gaveta fica aberta com o motivo e o cartão não sai do lugar", async () => {
    servidor.patchOk = false;
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    await digitar($('input[aria-label="Dia da visita"]'), "19/11/2026");
    await clicar($("[data-salvar-os]"));
    expect(txt($("[data-erro-os]"))).toContain("Não é possível reagendar OS concluída ou cancelada.");
    expect(gaveta()).toBeTruthy();
    expect(cartao("2026-11-17"), "o cartão continua no dia 17").toBeTruthy();
    expect(cartao("2026-11-19")).toBeNull();
  });

  it("sem nada mudado, Salvar só fecha (nenhuma chamada)", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    await clicar($("[data-salvar-os]"));
    expect(chamadas.filter((c) => c.metodo !== "GET")).toEqual([]);
    expect(gaveta()).toBeNull();
    expect(nav.refresh, "nada mudou: nada de recarregar a página").not.toHaveBeenCalled();
  });
});

describe("Calendário — a gaveta em LEITURA (quem não edita vê, não muda)", () => {
  // Os campos que a pessoa vê (o InputData tem um <input type="date"> escondido, aria-hidden, só para o calendário nativo)
  const soltos = () => $$("[data-editar-os] input, [data-editar-os] select, [data-editar-os] textarea")
    .filter((e) => e.getAttribute("aria-hidden") !== "true" && !(e as HTMLInputElement).disabled).map((e) => e.outerHTML.slice(0, 120));

  it("sem 'ordens › editar': a gaveta abre travada, com o motivo, sem Salvar — e nada vai ao servidor", async () => {
    await abrirCalendario(EVENTOS, montarPermissoes({ ordens: ["visualizar"] }));
    await clicar(cartao("2026-11-17"));
    expect(gaveta()).toBeTruthy();
    expect(gaveta()!.hasAttribute("data-somente-leitura")).toBe(true);
    expect(txt($("[data-motivo-leitura]"))).toBe(MSG_SEM_PERMISSAO_EDITAR);
    expect(tituloDaGaveta(), "o título não promete editar").toBe("OS OS-0147");
    expect($("[data-salvar-os]")).toBeNull();
    expect($("[data-fechar-os]")).toBeTruthy();
    expect(soltos(), "todos os campos travados").toEqual([]);
    expect($("[data-abrir-os-completa]", gaveta()!.closest('[role="dialog"]')!), "a página inteira continua a um clique").toBeTruthy();
    expect(chamadas.filter((c) => c.url.startsWith("/api/usuarios")), "nem a lista de usuários é buscada").toEqual([]);
    await clicar($("[data-fechar-os]"));
    expect(gaveta()).toBeNull();
    expect(chamadas.filter((c) => c.metodo !== "GET")).toEqual([]);
  });

  it("registro FECHADO (a trava vem do GET da OS): leitura com o motivo do servidor", async () => {
    servidor.trava = "OS assinada pelo cliente: este registro não pode mais ser editado.";
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    expect(gaveta()!.hasAttribute("data-somente-leitura")).toBe(true);
    expect(txt($("[data-motivo-leitura]"))).toBe(servidor.trava);
    expect($("[data-salvar-os]")).toBeNull();
    expect(soltos()).toEqual([]);
  });

  it("OS inativada: leitura, apontando o Reabrir da página da OS", async () => {
    await abrirCalendario({ "2026-11-17": [card("a1", "2026-11-17", { status: "CANCELADA" })] });
    await clicar(cartao("2026-11-17"));
    expect(txt($("[data-motivo-leitura]"))).toBe(MSG_OS_INATIVADA);
    expect($("[data-salvar-os]")).toBeNull();
  });

  it("a OS não veio (404): a gaveta abre com o erro e o link, em vez de uma tela em branco", async () => {
    servidor.getStatus = 404;
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    expect(txt($("[data-erro-gaveta-os]"))).toBe("Não encontrado");
    expect(gaveta()).toBeNull();
    expect($("[data-abrir-os-completa]")).toBeTruthy();
  });
});

describe("Calendário — a gaveta pelos outros caminhos", () => {
  it("a lista do dia (celular) também abre a gaveta, e fecha a lista", async () => {
    await abrirCalendario();
    await clicar($('[data-dia-mobile="2026-11-17"]'));
    const lista = $('[role="dialog"]');
    expect(lista).toBeTruthy();
    await clicar($("[data-cartao-os]", lista!));
    expect(gaveta()).toBeTruthy();
    expect($$('[role="dialog"]').some((d) => txt(d).includes("ordem de serviço") && !d.contains(gaveta())), "a lista do dia fechou").toBe(false);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Esc fecha a gaveta", async () => {
    await abrirCalendario();
    await clicar(cartao("2026-11-17"));
    expect(gaveta()).toBeTruthy();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await esperar();
    // a gaveta anima a saída: some do DOM logo depois
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(gaveta()).toBeNull();
  });

  it("a central da OS continua usando a gaveta sem visita nem leitura (nada mudou para ela)", async () => {
    const { EditarOs } = await import("@/components/os/central/editar-os");
    const onFechar = vi.fn(), onAtualizado = vi.fn();
    await montar(createElement(EditarOs, { os: OS_BASE, aberto: true, onFechar, onAtualizado }));
    expect(gaveta()).toBeTruthy();
    expect($("[data-visita-gaveta]")).toBeNull();
    expect($("[data-motivo-leitura]")).toBeNull();
    expect($("[data-abrir-os-completa]")).toBeNull();
    expect($("[data-salvar-os]")).toBeTruthy();
    expect(tituloDaGaveta()).toBe("Editar a OS OS-0147");
    await blur(null);
  });
});
