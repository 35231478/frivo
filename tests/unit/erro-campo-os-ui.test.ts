// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — as telas de OS, num DOM de verdade:
 *  - Nova OS: sem cliente, sem quem executa e sem descrição, cada erro no seu campo, a faixa resume e o foco vai ao
 *    cliente (o 1º na tela); escolher o cliente tira o erro dele; o erro do servidor ("Cliente inválido.") cai no cliente;
 *  - gaveta "Editar a OS": a descrição apagada fica marcada com o foco nela; a hora recusada pelo servidor (PATCH da
 *    visita) cai no campo da hora;
 *  - gaveta "Justificar atraso": o `campos` do servidor (zod) cai no campo da explicação.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 60_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/nova", useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([
    import("@/app/(dashboard)/ordens/nova/page"), import("@/components/os/central/editar-os"),
    import("@/components/os/central/atraso-justificado"), import("@/components/providers/permissoes-provider"),
  ]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.push.mockReset();
  respostas = { "GET /api/clientes": { status: 200, corpo: [{ id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", ativo: true }] } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && String(url).split("?")[0] === u; })[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function montar(el: ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 40)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (texto: string) => $$<HTMLButtonElement>("button").find((b) => b.textContent?.trim().includes(texto));
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
const erroDoCampo = (nome: string) => $(`[data-campo-nome="${nome}"]`)?.querySelector("[data-erro-campo]")?.textContent ?? null;
const escritas = () => chamadas.filter((c) => c.metodo !== "GET");

describe("Nova OS: cada erro no seu campo", () => {
  it("sem cliente, sem quem executa e sem descrição: os três marcados, a faixa resume e o foco vai ao cliente; nada vai ao servidor", async () => {
    const { default: NovaOrdemPage } = await import("@/app/(dashboard)/ordens/nova/page");
    await montar(createElement(NovaOrdemPage));
    await clicar(botao("Abrir ordem de serviço"));
    expect(escritas()).toEqual([]);
    expect(erroDoCampo("clienteId")).toBe("Selecione o cliente.");
    expect(erroDoCampo("execucao")).toBe("Escolha quem executa: uma equipe ou um ou mais colaboradores.");
    expect(erroDoCampo("descricao")).toBe("Descreva o serviço ou problema.");
    expect($("[data-resumo-erros]")!.textContent).toContain("3 campos para corrigir");
    const gatilho = $<HTMLButtonElement>('[data-campo-nome="clienteId"] button[aria-invalid="true"]')!;
    expect(gatilho).toBeTruthy();
    expect(document.activeElement).toBe(gatilho);
    // a descrição: borda vermelha + aria-describedby apontando a mensagem logo abaixo
    const desc = $<HTMLTextAreaElement>('[data-campo-nome="descricao"] textarea')!;
    expect(desc.getAttribute("aria-invalid")).toBe("true");
    expect(desc.className).toContain("border-atrasado");
    expect(document.getElementById(desc.getAttribute("aria-describedby")!)!.textContent).toBe("Descreva o serviço ou problema.");
    // digitou: o erro da descrição some na hora
    await digitar(desc, "Split pingando");
    expect(erroDoCampo("descricao")).toBeNull();
    expect($("[data-resumo-erros]")!.textContent).toContain("2 campos para corrigir");
  });

  it("o erro do servidor cai no campo certo (cliente inválido → no cliente, com foco)", async () => {
    // o cliente vem pela URL (como o "Nova OS" da ficha do cliente): o servidor recusa mesmo assim
    window.history.replaceState(null, "", "/ordens/nova?clienteId=c1");
    respostas["GET /api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [] }] };
    respostas["GET /api/equipes"] = { status: 200, corpo: [{ id: "eq1", nome: "Alfa", liderId: "t1", membroIds: ["t1"] }] };
    respostas["POST /api/ordens"] = { status: 400, corpo: { erro: "Cliente inválido.", campos: { clienteId: "Cliente inválido." } } };
    const { default: NovaOrdemPage } = await import("@/app/(dashboard)/ordens/nova/page");
    await montar(createElement(NovaOrdemPage));
    await clicar($("[data-seletor-equipe] button"));
    await clicar($('[data-opcao-equipe="eq1"]'));
    await digitar($('[data-campo-nome="descricao"] textarea'), "Split pingando na sala 3");
    await clicar(botao("Abrir ordem de serviço"));
    expect(escritas().filter((c) => c.url === "/api/ordens")).toHaveLength(1);
    expect(erroDoCampo("clienteId")).toBe("Cliente inválido.");
    expect($("[data-resumo-erros]")!.textContent).toBe("Cliente inválido.");
    expect(document.activeElement).toBe($('[data-campo-nome="clienteId"] button[aria-invalid="true"]'));
    window.history.replaceState(null, "", "/");
  });
});

const OS = {
  id: "a1", numero: "OS-0147", chamadoNumero: null, status: "AGENDADA", prioridade: "NORMAL", responsavelId: null, responsavel: null,
  previsaoConclusao: null, prazoExecucao: null, descricao: "Preventiva do chiller", observacoes: "",
};

describe("gaveta Editar a OS", () => {
  it("a descrição apagada fica marcada, com o foco nela; a faixa repete a frase (um erro só)", async () => {
    const { EditarOs } = await import("@/components/os/central/editar-os");
    await montar(createElement(EditarOs, { os: OS, aberto: true, onFechar: () => {}, onAtualizado: () => {} }));
    await digitar($("[data-descricao-os]"), "");
    await clicar($("[data-salvar-os]"));
    expect(escritas()).toEqual([]);
    expect(erroDoCampo("descricao")).toBe("Descreva o serviço da OS.");
    expect($("[data-erro-os]")!.textContent).toBe("Descreva o serviço da OS.");
    expect(document.activeElement).toBe($("[data-descricao-os]"));
  });

  it("a hora recusada pelo servidor (PATCH da visita) cai no campo da hora", async () => {
    respostas["PATCH /api/ordens/a1"] = { status: 400, corpo: { erro: "Hora inválida.", campos: { visitaHora: "Hora inválida." } } };
    const { EditarOs } = await import("@/components/os/central/editar-os");
    await montar(createElement(EditarOs, { os: OS, aberto: true, onFechar: () => {}, onAtualizado: () => {}, visita: { atividadeId: "at1", data: "2026-11-20", hora: "09:00" } }));
    await digitar($("[data-input-hora]"), "10:30");
    await clicar($("[data-salvar-os]"));
    expect(escritas().filter((c) => c.metodo === "PATCH")).toHaveLength(1);
    expect(erroDoCampo("visitaHora")).toBe("Hora inválida.");
    expect($<HTMLInputElement>("[data-input-hora]")!.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe($("[data-input-hora]"));
  });
});

describe("gaveta Justificar atraso", () => {
  it("o `campos` do servidor (zod) cai no campo da explicação", async () => {
    respostas["POST /api/ordens/a1/atraso-justificado"] = { status: 400, corpo: { erro: "Explicação muito longa.", campos: { observacao: "Explicação muito longa." } } };
    const { AtrasoJustificado } = await import("@/components/os/central/atraso-justificado");
    const atrasada = { ...OS, prazoExecucao: "2026-01-10T00:00:00.000Z", status: "EM_EXECUCAO", atividades: [] };
    await montar(createElement(AtrasoJustificado, { os: atrasada, onAtualizado: () => {} }));
    await clicar($("[data-justificar-atraso]"));
    await act(async () => {
      const sel = $<HTMLSelectElement>("[data-motivo]")!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "CLIENTE_AUSENTE");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
    await clicar($("[data-salvar-atraso]"));
    expect(escritas().filter((c) => c.metodo === "POST")).toHaveLength(1);
    expect(erroDoCampo("observacao")).toBe("Explicação muito longa.");
    expect(document.activeElement).toBe($("[data-observacao]"));
  });
});
