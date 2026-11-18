// @vitest-environment happy-dom
/**
 * Prazos da OS — PR 2, as telas num DOM de verdade (happy-dom), API simulada:
 *  - ATRASO JUSTIFICADO no cartão "Prazos" da OS: o botão só aparece para quem revisa o desempenho e
 *    só quando há atraso (da OS ou de uma atividade); a gaveta valida antes de chamar; o servidor que
 *    recusa deixa a gaveta aberta com o motivo; justificada, todo mundo lê quem/quando/por quê e só o
 *    gestor altera ou desfaz (com confirmação);
 *  - o SELO DE PRAZO do app do técnico: discreto com folga, âmbar no dia, vermelho depois; some na
 *    atividade concluída e quando ninguém definiu prazo.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(""),
}));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};
const GESTOR = montarPermissoes({ ordens: ["visualizar", "editar"], desempenho: ["visualizar", "revisar"] });
const OPERADOR = montarPermissoes({ ordens: ["visualizar", "criar", "editar", "concluir", "excluir"], desempenho: ["visualizar"] });

beforeAll(async () => {
  await import("@/components/ui/avisos");
  await import("@/components/os/central/atraso-justificado");
  await import("@/components/tecnico/meu-dia");
}, 120_000);

beforeEach(() => {
  chamadas.length = 0; respostas = {};
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-18T18:00:00.000Z") }); // 18/11/2026, 15h em Brasília
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el, "elemento a clicar").not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function escrever(el: Element | null, v: string) {
  expect(el, "campo a preencher").not.toBeNull();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await esperar();
}
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET");
const toasts = () => [...document.querySelectorAll("[data-toast]")].map((t) => [txt(t), t.getAttribute("data-toast")]);

const URL_JUSTIFICAR = "/api/ordens/os1/atraso-justificado";
const osAtrasada = (extra: Record<string, unknown> = {}) => ({
  id: "os1", numero: "OS-2026-0301", chamadoNumero: null, status: "AGENDADA", prazoExecucao: "2026-11-15T00:00:00.000Z", previsaoConclusao: null,
  dataConclusao: null, atividades: [], atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoJustificadoEm: null, atrasoJustificadoPor: null, ...extra,
});
const JUSTIFICADA = {
  atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoJustificadoObs: "Ninguém na portaria.", atrasoJustificadoEm: "2026-11-17T14:00:00.000Z",
  atrasoJustificadoPor: { id: "u1", nome: "Gabi Gestora" },
};

async function montarAtraso(os: any, permissoes: Permissoes = GESTOR) {
  const atualizado = vi.fn();
  const [{ AtrasoJustificado }, { PermissoesProvider }, { Avisos }] = await Promise.all([
    import("@/components/os/central/atraso-justificado"), import("@/components/providers/permissoes-provider"), import("@/components/ui/avisos"),
  ]);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [
      createElement(Avisos, { key: "avisos" }), createElement(AtrasoJustificado, { key: "tela", os, onAtualizado: atualizado }),
    ] }));
  });
  await esperar();
  return atualizado;
}

describe("Atraso justificado no cartão Prazos da OS", () => {
  it("gestor + OS atrasada: \"Justificar atraso\" abre a gaveta; a validação acontece antes de chamar o servidor", async () => {
    respostas[`POST ${URL_JUSTIFICAR}`] = { status: 200, corpo: JUSTIFICADA };
    const atualizado = await montarAtraso(osAtrasada());
    expect($("[data-atraso-justificado]")!.getAttribute("data-atraso-justificado")).toBe("nao");
    expect($("[data-gaveta-atraso]")).toBeNull();
    await clicar($("[data-justificar-atraso]"));
    expect($("[data-gaveta-atraso]")).not.toBeNull();
    expect([...$<HTMLSelectElement>("[data-motivo]")!.options].map((o) => o.textContent)).toEqual(
      ["Escolha o motivo", "Cliente ausente", "Peça faltando", "Acesso ao local negado", "Chuva ou clima", "Outro motivo"]);

    await clicar($("[data-salvar-atraso]")); // sem motivo
    expect(txt($("[data-erro-atraso]"))).toBe("Escolha o motivo do atraso.");
    await escrever($("[data-motivo]"), "OUTRO");
    await clicar($("[data-salvar-atraso]")); // "Outro" sem explicação
    expect(txt($("[data-erro-atraso]"))).toBe("Explique o motivo do atraso (pelo menos 5 caracteres).");
    // "razão é razão": um "x" não é explicação
    await escrever($("[data-observacao]"), "   x    "); // 8 caracteres, mas só 1 diz alguma coisa
    await clicar($("[data-salvar-atraso]"));
    expect(txt($("[data-erro-atraso]"))).toBe("Explique o motivo do atraso (pelo menos 5 caracteres).");
    expect(gravacoes()).toEqual([]);

    await escrever($("[data-motivo]"), "CLIENTE_AUSENTE");
    await escrever($("[data-observacao]"), "Ninguém na portaria.");
    await clicar($("[data-salvar-atraso]"));
    expect(gravacoes()).toEqual([{ url: URL_JUSTIFICAR, metodo: "POST", corpo: { motivo: "CLIENTE_AUSENTE", observacao: "Ninguém na portaria." } }]);
    expect(atualizado).toHaveBeenCalledWith(JUSTIFICADA); // a tela da OS recebe o que o servidor gravou
    expect(toasts().at(-1)).toEqual(["Atraso justificado.", "sucesso"]);
  });

  it("o servidor recusou (sem atraso, sem permissão): a gaveta FICA aberta com o motivo da recusa e nada muda na tela", async () => {
    respostas[`POST ${URL_JUSTIFICAR}`] = { status: 409, corpo: { erro: "Esta OS não está atrasada: não há atraso para justificar." } };
    const atualizado = await montarAtraso(osAtrasada());
    await clicar($("[data-justificar-atraso]"));
    await escrever($("[data-motivo]"), "CLIMA");
    const avisosAntes = toasts().length; // o aviso de um caso anterior pode ainda estar na tela
    await clicar($("[data-salvar-atraso]"));
    expect(txt($("[data-erro-atraso]"))).toBe("Esta OS não está atrasada: não há atraso para justificar.");
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); }); // se a gaveta fosse fechar, já teria saído da tela
    expect($("[data-gaveta-atraso]")).not.toBeNull();
    expect($<HTMLSelectElement>("[data-motivo]")!.value).toBe("CLIMA");
    expect(atualizado).not.toHaveBeenCalled();
    expect(toasts()).toHaveLength(avisosAntes); // recusa não dá aviso de sucesso: o erro fica na gaveta
  });

  it("justificada: mostra o motivo, a explicação, quem marcou e quando; o gestor altera (a gaveta abre preenchida) e desfaz com confirmação", async () => {
    respostas[`DELETE ${URL_JUSTIFICAR}`] = { status: 200, corpo: { atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoJustificadoEm: null, atrasoJustificadoPor: null } };
    const atualizado = await montarAtraso(osAtrasada(JUSTIFICADA));
    expect($("[data-atraso-justificado]")!.getAttribute("data-atraso-justificado")).toBe("sim");
    expect(txt($("[data-motivo-atraso]"))).toBe("Cliente ausente");
    expect(txt($("[data-obs-atraso]"))).toBe("Ninguém na portaria.");
    expect(txt($("[data-autor-atraso]"))).toBe("Gabi Gestora · 17/11/2026 — não conta no desempenho.");
    expect($("[data-justificar-atraso]")).toBeNull();

    await clicar($("[data-alterar-atraso]"));
    expect($<HTMLSelectElement>("[data-motivo]")!.value).toBe("CLIENTE_AUSENTE");
    expect($<HTMLTextAreaElement>("[data-observacao]")!.value).toBe("Ninguém na portaria.");

    // desfazer: "não" não chama nada; "sim" manda o DELETE
    await clicar($("[data-desfazer-atraso]"));
    expect(txt($("[data-confirmacao]"))).toContain("O atraso desta OS volta a contar no desempenho de quem executou.");
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    await clicar($("[data-desfazer-atraso]"));
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: URL_JUSTIFICAR, metodo: "DELETE", corpo: null }]);
    expect(atualizado).toHaveBeenCalledWith(expect.objectContaining({ atrasoJustificadoMotivo: null }));
    expect(toasts().at(-1)).toEqual(["Justificativa desfeita.", "sucesso"]);
  });

  it("quem NÃO revisa o desempenho (mesmo com tudo de OS): não justifica; mas lê a justificativa, sem Alterar nem Desfazer", async () => {
    await montarAtraso(osAtrasada(), OPERADOR);
    expect($("[data-atraso-justificado]")).toBeNull(); // OS atrasada sem justificativa: nada para ele
    act(() => root.unmount());
    await montarAtraso(osAtrasada(JUSTIFICADA), OPERADOR);
    expect(txt($("[data-motivo-atraso]"))).toBe("Cliente ausente");
    expect($("[data-alterar-atraso]")).toBeNull();
    expect($("[data-desfazer-atraso]")).toBeNull();
  });

  it("só quando há atraso: OS no prazo não oferece; atividade atrasada (com a OS no prazo) e OS concluída depois do prazo oferecem", async () => {
    await montarAtraso(osAtrasada({ prazoExecucao: "2026-11-25T00:00:00.000Z" }));
    expect($("[data-atraso-justificado]")).toBeNull();
    act(() => root.unmount());
    await montarAtraso(osAtrasada({ prazoExecucao: "2026-11-18T00:00:00.000Z" })); // vence hoje: ainda não atrasou
    expect($("[data-atraso-justificado]")).toBeNull();
    act(() => root.unmount());
    await montarAtraso(osAtrasada({ prazoExecucao: "2026-11-25T00:00:00.000Z", atividades: [{ status: "AGENDADA", prazo: null, dataAgendada: "2026-11-12T12:00:00.000Z", concluidaEm: null }] }));
    expect($("[data-justificar-atraso]")).not.toBeNull();
    act(() => root.unmount());
    await montarAtraso(osAtrasada({ status: "CONCLUIDA", prazoExecucao: "2026-11-10T00:00:00.000Z", dataConclusao: "2026-11-11T12:00:00.000Z" }));
    expect($("[data-justificar-atraso]")).not.toBeNull();
    act(() => root.unmount());
    await montarAtraso(osAtrasada({ status: "CANCELADA" }));
    expect($("[data-atraso-justificado]")).toBeNull();
  });
});

describe("App do técnico — o selo de prazo", () => {
  const AGORA = new Date("2026-11-18T18:00:00.000Z").getTime();
  async function montarSelo(props: { prazo?: string | null; status: string }) {
    const { SeloPrazo } = await import("@/components/tecnico/meu-dia");
    if (root) act(() => root.unmount());
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(SeloPrazo, { ...props, agora: AGORA })); });
    return $("[data-prazo]");
  }

  it("com folga é discreto (\"Prazo 25/11\"); no dia fica âmbar (\"Vence hoje\"); depois, vermelho (\"Atrasada 2 dias\")", async () => {
    const folga = (await montarSelo({ prazo: "2026-11-25", status: "AGENDADA" }))!;
    expect([folga.getAttribute("data-prazo"), txt(folga)]).toEqual(["NO_PRAZO", "Prazo 25/11"]);
    expect(folga.className).toContain("bg-surface-linha");
    const hoje = (await montarSelo({ prazo: "2026-11-18", status: "EM_ANDAMENTO" }))!;
    expect([hoje.getAttribute("data-prazo"), txt(hoje)]).toEqual(["VENCE_HOJE", "Vence hoje · 18/11"]);
    expect(hoje.className).toContain("bg-atencao-claro");
    const atrasada = (await montarSelo({ prazo: "2026-11-16", status: "AGENDADA" }))!;
    expect([atrasada.getAttribute("data-prazo"), txt(atrasada)]).toEqual(["ATRASADO", "Atrasada 2 dias · 16/11"]);
    expect(atrasada.className).toContain("bg-atrasado-claro");
  });

  it("sem prazo definido, ou com a atividade concluída ou cancelada, não aparece nada (o cartão já mostra o dia agendado)", async () => {
    expect(await montarSelo({ prazo: null, status: "AGENDADA" })).toBeNull();
    expect(await montarSelo({ status: "AGENDADA" })).toBeNull(); // cartão guardado antes desta versão
    expect(await montarSelo({ prazo: "2026-11-16", status: "CONCLUIDA" })).toBeNull();
    expect(await montarSelo({ prazo: "2026-11-16", status: "CANCELADA" })).toBeNull();
  });

  it("o cartão do Meu dia e a tela da OS usam o selo", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fonte = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
    expect(fonte("components/tecnico/meu-dia.tsx")).toContain("<SeloPrazo prazo={c.prazo} status={status} agora={agora} />");
    expect(fonte("components/tecnico/execucao.tsx")).toContain("<SeloPrazo prazo={c.prazo} status={x.atividade.status} agora={agora} />");
  });
});
