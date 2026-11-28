// @vitest-environment happy-dom
/**
 * CHAT-1.1 — a FOTO do chat e o EQUIPAMENTO nas telas (happy-dom; servidor simulado):
 *  - o balão: a etiqueta discreta do equipamento embaixo da foto (o "porquê" na dica), "QR de outro cliente" e "No
 *    relatório"; tocar na etiqueta (ou o menu "Equipamento da foto") abre os chips para corrigir; o erro aparece;
 *  - a caixa de escrever: com foto e OS, os chips do equipamento já marcados pelas regras (único, em andamento, QR) e
 *    "escolha o da foto" quando a OS tem vários; o envio leva a escolha e o QR lido;
 *  - o escritório: corrigir e "Mostrar no relatório" pela rota, o balão volta como ficou; conversa só leitura não corrige.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import { MOTIVO_EQUIPAMENTO } from "@/lib/chat/equipamento-foto";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const foto = vi.hoisted(() => ({ resultado: { ok: true, foto: "data:image/jpeg;base64,Rk9UTw==", miniatura: "data:image/jpeg;base64,TUlOSQ==" } as any }));
vi.mock("@/lib/chat/foto-cliente", () => ({ prepararFoto: vi.fn(async () => foto.resultado) }));
vi.mock("@/components/chat/use-novidades", () => ({ useNovidades: () => {}, avisarNovidades: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/ui/sino", () => ({ atualizarSino: vi.fn() }));

let root: Root | undefined;
let chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, (() => Response) | { status: number; corpo: unknown }> = {};
beforeEach(() => {
  chamadas = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    if (typeof r === "function") return r();
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function montar(el: React.ReactElement) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(el); });
  await esperar();
}
async function clicar(el: Element | null) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); }
async function escolherFoto() {
  const input = $("[data-input-foto]") as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "f.jpg", { type: "image/jpeg" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}

const OS1 = { id: "os1", numero: "OS-0001", cliente: "Mercado Exemplo" };
const A = { id: "eA", titulo: "Split sala 3" }, B = { id: "eB", titulo: "Split sala 4" };
const msg = (over: Partial<ComentarioTela>): ComentarioTela => ({ id: "m", clientId: "m", texto: "", autor: "João Silva", origem: "APP", criadoEm: new Date().toISOString(), meu: false, os: OS1, ...over });
const comFoto = (id: string, f: Partial<NonNullable<ComentarioTela["foto"]>> = {}) => msg({ id, clientId: id, foto: { id: `f-${id}`, miniatura: "data:image/jpeg;base64,TUlOSQ==", ...f } });
const INFO = { os1: { equipamentos: [A, B], emAndamento: null as string | null } };

describe("o balão: a etiqueta do equipamento e a correção", () => {
  async function conversa(mensagens: ComentarioTela[], props: Record<string, unknown> = {}) {
    const { ConversaChat } = await import("@/components/chat/conversa");
    await montar(createElement(ConversaChat, { mensagens, onEnviar: async () => null, urlFoto: () => "", equipamentosDaOs: (id: string) => (INFO as any)[id], ...props }));
  }

  it("a etiqueta embaixo da foto, com o porquê na dica; QR de outro cliente; \"No relatório\"; sem OS, nada", async () => {
    await conversa([
      comFoto("m1", { equipamento: A, origemEquipamento: "QR" }),
      comFoto("m2", { equipamento: null, sugerido: { id: "eC", titulo: "Split da padaria" } }),
      comFoto("m3", { equipamento: B, origemEquipamento: "UNICO", noRelatorio: true }),
      { ...comFoto("m4"), os: null },
    ]);
    expect(txt($("[data-mensagem='m1'] [data-equipamento-foto]"))).toBe("Split sala 3");
    expect($("[data-mensagem='m1'] [data-equipamento-foto]")!.getAttribute("title")).toBe(MOTIVO_EQUIPAMENTO.QR);
    expect(txt($("[data-mensagem='m2'] [data-equipamento-foto]"))).toBe("Sem equipamento");
    expect(txt($("[data-mensagem='m2'] [data-sugerido]"))).toBe("QR de outro cliente: Split da padaria");
    expect(txt($("[data-mensagem='m3'] [data-no-relatorio]"))).toBe("No relatório");
    expect($("[data-mensagem='m4'] [data-foto-equipamento-area]")).toBeNull();
    // sem quem corrija: a etiqueta não abre nada
    expect(($("[data-mensagem='m1'] [data-equipamento-foto]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("tocar na etiqueta abre os chips (o atual marcado); escolher corrige; o erro aparece no balão", async () => {
    const corrigir = vi.fn(async () => null);
    await conversa([comFoto("m1", { equipamento: A, origemEquipamento: "UNICO" })], { onCorrigirEquipamento: corrigir });
    await clicar($("[data-mensagem='m1'] [data-equipamento-foto]"));
    expect($$("[data-mensagem='m1'] [data-equipamento-opcao]").map((e) => [e.getAttribute("data-equipamento-opcao"), e.getAttribute("aria-checked")]))
      .toEqual([["eA", "true"], ["eB", "false"], ["sem", "false"]]);
    await clicar($("[data-mensagem='m1'] [data-equipamento-opcao='eB']"));
    expect(corrigir).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), "eB");
    expect($("[data-mensagem='m1'] [data-escolha-equipamento]")).toBeNull(); // fechou
    corrigir.mockResolvedValueOnce("Este equipamento não é desta OS." as never);
    await clicar($("[data-mensagem='m1'] [data-equipamento-foto]"));
    await clicar($("[data-mensagem='m1'] [data-equipamento-opcao='sem']"));
    expect(corrigir).toHaveBeenLastCalledWith(expect.objectContaining({ id: "m1" }), null);
    expect(txt($("[data-mensagem='m1'] [data-aviso-balao]"))).toBe("Este equipamento não é desta OS.");
  });

  it("o menu (botão direito / toque longo): \"Equipamento da foto\" e, no escritório, \"Mostrar no relatório\"", async () => {
    const corrigir = vi.fn(async () => null);
    const relatorio = vi.fn(async () => null);
    await conversa([comFoto("m1", { equipamento: A })], { onCorrigirEquipamento: corrigir, onRelatorio: relatorio });
    await act(async () => { $("[data-mensagem='m1'] [data-corpo-balao]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(txt($("[data-menu-relatorio]"))).toBe("Mostrar no relatório");
    await clicar($("[data-menu-relatorio]"));
    expect(relatorio).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), true);
    await act(async () => { $("[data-mensagem='m1'] [data-corpo-balao]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    await clicar($("[data-menu-equipamento]"));
    expect($("[data-mensagem='m1'] [data-escolha-equipamento]")).not.toBeNull();
  });

  it("conversa só leitura (OS cancelada): nem corrigir nem relatório", async () => {
    await conversa([comFoto("m1", { equipamento: A })], { onCorrigirEquipamento: vi.fn(), onRelatorio: vi.fn(), somenteLeitura: "OS cancelada." });
    expect(($("[data-mensagem='m1'] [data-equipamento-foto]") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { $("[data-mensagem='m1'] [data-corpo-balao]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect($("[data-menu-mensagem]")).toBeNull();
  });
});

describe("a caixa de escrever: o equipamento da foto antes de enviar", () => {
  async function caixa(props: Record<string, unknown>) {
    const { ConversaChat } = await import("@/components/chat/conversa");
    const onEnviar = vi.fn(async () => null);
    await montar(createElement(ConversaChat, { mensagens: [], onEnviar, urlFoto: () => "", osDaMensagem: "os1", ...props }));
    return onEnviar;
  }
  const marcados = () => $$("[data-equipamento-da-foto] [data-equipamento-opcao]").filter((e) => e.getAttribute("aria-checked") === "true").map((e) => e.getAttribute("data-equipamento-opcao"));

  it("sem foto, nada; a OS com UM equipamento: já marcado, com o porquê; enviar não força escolha (a regra decide)", async () => {
    const onEnviar = await caixa({ equipamentosDaOs: () => ({ equipamentos: [A], emAndamento: null }) });
    expect($("[data-equipamento-da-foto]")).toBeNull();
    await escolherFoto();
    expect(marcados()).toEqual(["eA"]);
    expect(txt($("[data-motivo-equipamento]"))).toBe(MOTIVO_EQUIPAMENTO.UNICO);
    await clicar($("[data-enviar-mensagem]"));
    expect(onEnviar.mock.calls[0][0]).not.toHaveProperty("equipamentoId");
  });

  it("vários e nada indica: pede a escolha; tocar escolhe e o envio leva o equipamento (ou \"Sem equipamento\")", async () => {
    const onEnviar = await caixa({ equipamentosDaOs: () => ({ equipamentos: [A, B], emAndamento: null }) });
    await escolherFoto();
    expect(marcados()).toEqual([]);
    expect(txt($("[data-motivo-equipamento]"))).toMatch(/vários equipamentos: escolha/);
    await clicar($("[data-equipamento-da-foto] [data-equipamento-opcao='eB']"));
    expect(marcados()).toEqual(["eB"]);
    await clicar($("[data-enviar-mensagem]"));
    expect(onEnviar.mock.calls[0][0]).toMatchObject({ equipamentoId: "eB" });
    expect($("[data-equipamento-da-foto]")).toBeNull(); // enviou: a foto e a escolha saem
    await escolherFoto();
    await clicar($("[data-equipamento-da-foto] [data-equipamento-opcao='sem']"));
    await clicar($("[data-enviar-mensagem]"));
    expect(onEnviar.mock.calls[1][0]).toMatchObject({ equipamentoId: null });
  });

  it("app: a atividade em andamento marca o equipamento; o QR lido na foto marca e vai junto; QR de outro cliente avisa", async () => {
    const lerQr = vi.fn(async () => "https://app.exemplo.test/qr/tok-eA");
    const onEnviar = await caixa({ origem: "APP", equipamentosDaOs: () => ({ equipamentos: [A, B], emAndamento: null }), lerQr,
      resolverQr: () => ({ equipamentoId: "eA", mesmoCliente: true, titulo: "Split sala 3" }) });
    await escolherFoto();
    expect(lerQr).toHaveBeenCalled();
    expect(marcados()).toEqual(["eA"]);
    expect(txt($("[data-motivo-equipamento]"))).toBe(MOTIVO_EQUIPAMENTO.QR);
    await clicar($("[data-enviar-mensagem]"));
    expect(onEnviar.mock.calls[0][0]).toMatchObject({ qr: "https://app.exemplo.test/qr/tok-eA" });
    act(() => root!.unmount()); root = undefined; document.body.innerHTML = "";
    await caixa({ origem: "APP", equipamentosDaOs: () => ({ equipamentos: [A, B], emAndamento: "eB" }) });
    await escolherFoto();
    expect(marcados()).toEqual(["eB"]);
    expect(txt($("[data-motivo-equipamento]"))).toBe(MOTIVO_EQUIPAMENTO.ANDAMENTO);
    act(() => root!.unmount()); root = undefined; document.body.innerHTML = "";
    await caixa({ origem: "APP", equipamentosDaOs: () => ({ equipamentos: [A, B], emAndamento: null }), lerQr: async () => "tok-eC",
      resolverQr: () => ({ equipamentoId: "eC", mesmoCliente: false, titulo: "Split da padaria" }) });
    await escolherFoto();
    expect(marcados()).toEqual([]);
    expect(txt($("[data-motivo-equipamento]"))).toMatch(/QR code na foto é de outro cliente \(Split da padaria\): não será vinculada/);
  });

  it("escritório: nem atividade em andamento nem QR (só a OS com um equipamento e a escolha)", async () => {
    const lerQr = vi.fn(async () => "tok-eA");
    await caixa({ origem: "ESCRITORIO", equipamentosDaOs: () => ({ equipamentos: [A, B], emAndamento: "eB" }) });
    await escolherFoto();
    expect(lerQr).not.toHaveBeenCalled();
    expect(marcados()).toEqual([]);
  });
});

describe("o escritório: corrigir e pôr no relatório pela rota", () => {
  it("corrigir e \"Mostrar no relatório\" vão à rota da foto; o balão volta como o servidor gravou", async () => {
    const m1 = comFoto("m1", { equipamento: A, origemEquipamento: "UNICO" });
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: { osId: "os1", osNumero: "OS-0001", cliente: "Mercado Exemplo", status: "AGENDADA", tecnicos: [], ultima: null, naoLidas: 0 }, mensagens: [m1], equipamentosDasOs: INFO } };
    let atual = m1;
    respostas["PATCH /api/conversas/mensagens/m1/foto"] = () => {
      const c = chamadas.at(-1)!.corpo;
      atual = { ...atual, foto: { ...atual.foto!, ...(c.equipamentoId !== undefined && { equipamento: c.equipamentoId === "eB" ? B : null, origemEquipamento: "CORRIGIDO" }), ...(c.noRelatorio !== undefined && { noRelatorio: c.noRelatorio }) } };
      return new Response(JSON.stringify({ mensagem: atual }), { status: 200 });
    };
    const { ConversaEscritorio } = await import("@/components/chat/conversa-escritorio");
    await montar(createElement(ConversaEscritorio, { alvo: { tipo: "os", osId: "os1" }, podeEscrever: true, podeCorrigirFoto: true }));
    await clicar($("[data-mensagem='m1'] [data-equipamento-foto]"));
    await clicar($("[data-mensagem='m1'] [data-equipamento-opcao='eB']"));
    expect(chamadas.at(-1)).toMatchObject({ metodo: "PATCH", url: "/api/conversas/mensagens/m1/foto", corpo: { equipamentoId: "eB" } });
    expect(txt($("[data-mensagem='m1'] [data-equipamento-foto]"))).toBe("Split sala 4");
    await act(async () => { $("[data-mensagem='m1'] [data-corpo-balao]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    await clicar($("[data-menu-relatorio]"));
    expect(chamadas.at(-1)!.corpo).toEqual({ noRelatorio: true });
    expect($("[data-mensagem='m1'] [data-no-relatorio]")).not.toBeNull();
  });

  it("sem poder editar a OS: a etiqueta não abre, o menu não tem as ações da foto", async () => {
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: { osId: "os1", osNumero: "OS-0001", cliente: "", status: "AGENDADA", tecnicos: [], ultima: null, naoLidas: 0 }, mensagens: [comFoto("m1", { equipamento: A })], equipamentosDasOs: INFO } };
    const { ConversaEscritorio } = await import("@/components/chat/conversa-escritorio");
    await montar(createElement(ConversaEscritorio, { alvo: { tipo: "os", osId: "os1" }, podeEscrever: false }));
    expect(($("[data-mensagem='m1'] [data-equipamento-foto]") as HTMLButtonElement).disabled).toBe(true);
  });
});
