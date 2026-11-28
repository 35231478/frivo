// @vitest-environment happy-dom
/**
 * HOTFIX 2 do chat (o teste do Zé no iPhone) — as regras puras e as telas:
 *  - a recusa diz o PORQUÊ, em português e sem "você"; a de regra não vira "Tentar de novo" sem fim;
 *  - a mensagem recusada não trava a fila da atividade (como o QR do C13);
 *  - responder é ler PARA TRÁS: a mensagem que o outro lado respondeu fica lida por quem respondeu, na hora;
 *  - o ponto do seletor: "Atividade em andamento", com legenda e nome acessível;
 *  - o balão recusado: o motivo à vista; Enviar sem OS, Trocar a OS (as outras OS), Descartar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { lidasPelaResposta } from "@/lib/chat/regras";
import { mensagensDaFila, motivoDaRecusa, numeroDaOs, rotuloMensagemDaFila } from "@/lib/tecnico/chat";
import { travaAtividade } from "@/lib/tecnico/offline/motor";
import { NAO_TRAVAM } from "@/lib/tecnico/offline/trava";
import { SEM_OS } from "@/lib/tecnico/despesas";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("a recusa: o porquê e o que fazer", () => {
  it("o motivo em português, sem \"você\"; com OS, diz para enviar sem OS ou trocar; o resto, o texto do servidor", () => {
    expect(motivoDaRecusa(403, "Esta atividade não está atribuída a você.", true)).toBe("Esta OS não está atribuída a este técnico. Envie sem OS ou troque a OS.");
    expect(motivoDaRecusa(404, null, true)).toBe("OS não encontrada. Envie sem OS ou troque a OS.");
    expect(motivoDaRecusa(409, "OS cancelada: a conversa fica só para leitura.", true)).toBe("OS cancelada: não recebe mais mensagens. Envie sem OS ou troque a OS.");
    expect(motivoDaRecusa(400, "A foto passa de 1,5 MB mesmo reduzida.", true)).toBe("A foto passa de 1,5 MB mesmo reduzida.");
    expect(motivoDaRecusa(403, null, false)).toBe("Esta OS não está atribuída a este técnico.");
    expect(motivoDaRecusa(null, null, true)).toBe("Recusada pelo servidor.");
    for (const s of [400, 403, 404, 409, 422]) expect(motivoDaRecusa(s, "x", true).toLowerCase()).not.toMatch(/\bvocê\b/);
  });

  it("a fila mostra a recusada com o motivo e a marca de recusa (para Enviar sem OS / Trocar / Descartar)", () => {
    const op = { id: "o1", seq: 7, tipo: "comentario", atividadeId: "aA", criadoEm: "2026-11-12T12:00:00.000Z", estado: "erro", status: 403, erro: "Esta atividade não está atribuída a você.", tentativas: 1,
      dados: { clientId: "c1", texto: "Opa" } } as unknown as OperacaoFila;
    const [m] = mensagensDaFila([op], new Map([["aA", { id: "osA", numero: "OS-4440", cliente: "" }]]), "João");
    expect(m).toMatchObject({ falhou: "Esta OS não está atribuída a este técnico. Envie sem OS ou troque a OS.", recusa: { seq: 7, status: 403, comOs: true }, pendente: false });
    const [semOs] = mensagensDaFila([{ ...op, atividadeId: SEM_OS } as OperacaoFila], new Map(), "João");
    expect(semOs.falhou).toBe("Esta OS não está atribuída a este técnico.");
    const [pendente] = mensagensDaFila([{ ...op, estado: "pendente" } as OperacaoFila], new Map(), "João");
    expect(pendente.recusa).toBeUndefined();
  });

  it("a OS fica guardada com a mensagem: o balão e o Perfil dizem qual é, mesmo fora das OS do dia", () => {
    const osDia = [{ osId: "osA", numero: "OS-4442", cliente: "", emAndamento: true, atividadeId: "aA" }, { osId: "osX", numero: "OS-9", cliente: "", emAndamento: false }];
    expect(numeroDaOs("osA", osDia)).toBe("OS-4442");
    expect(numeroDaOs("osX", osDia)).toBeNull(); // sem atividade dele: a mensagem iria sem OS
    expect(numeroDaOs(null, osDia)).toBeNull();
    const op = { seq: 1, tipo: "comentario", atividadeId: "aFora", criadoEm: "2026-11-12T12:00:00.000Z", estado: "erro", status: 403, tentativas: 1, osNumero: "OS-4440",
      dados: { clientId: "c1", texto: "Opa" } } as unknown as OperacaoFila;
    expect(mensagensDaFila([op], new Map(), "João")[0].os).toEqual({ id: "", numero: "OS-4440", cliente: "" });
    expect(mensagensDaFila([{ ...op, osNumero: undefined } as OperacaoFila], new Map(), "João")[0].os).toBeNull();
  });

  it("o rótulo no Perfil: \"Mensagem do chat · OS · começo do texto\" (ou Foto; sem OS, \"Sem OS\")", () => {
    const o = (over: object) => ({ atividadeId: "aA", osNumero: "OS-4440", dados: { texto: "Opa" }, ...over });
    expect(rotuloMensagemDaFila(o({}))).toBe("Mensagem do chat · OS-4440 · “Opa”");
    expect(rotuloMensagemDaFila(o({ dados: { texto: "", foto: "data:image/jpeg;base64,xx" } }))).toBe("Mensagem do chat · OS-4440 · Foto");
    expect(rotuloMensagemDaFila(o({ atividadeId: SEM_OS, osNumero: null }))).toBe("Mensagem do chat · Sem OS · “Opa”");
    expect(rotuloMensagemDaFila(o({ osNumero: undefined }), "OS-77 · Mercado Exemplo")).toBe("Mensagem do chat · OS-77 · Mercado Exemplo · “Opa”");
    expect(rotuloMensagemDaFila(o({ osNumero: undefined }))).toBe("Mensagem do chat · “Opa”");
    const longo = rotuloMensagemDaFila(o({ dados: { texto: "A peça do compressor chegou com defeito,   vou precisar voltar amanhã cedo" } }));
    expect(longo).toBe("Mensagem do chat · OS-4440 · “A peça do compressor chegou com defeito…”");
  });

  it("a mensagem recusada não trava a atividade (nem o QR); as outras recusas travam", () => {
    // + a correção/exclusão da despesa (D7, janeiro 2): recusada porque o escritório já decidiu, não segura o serviço
    expect([...NAO_TRAVAM].sort()).toEqual(["comentario", "despesaEditar", "despesaExcluir", "scan"]);
    expect(travaAtividade({ estado: "erro", tipo: "despesaEditar" })).toBe(false);
    expect(travaAtividade({ estado: "erro", tipo: "comentario" })).toBe(false);
    expect(travaAtividade({ estado: "erro", tipo: "scan" })).toBe(false);
    expect(travaAtividade({ estado: "erro", tipo: "foto" })).toBe(true);
    expect(travaAtividade({ estado: "pendente", tipo: "foto" })).toBe(false);
  });
});

describe("responder é ler, para trás", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 10, 12, 9, min));
  const m = (id: string, origem: "APP" | "ESCRITORIO", min: number, lida = false, usuarioId = origem === "APP" ? "uT" : "uA") =>
    ({ id, origem, usuarioId, criadoEm: t(min), lidaEm: lida ? t(min) : null });

  it("as do app sem ✓✓ antes da resposta do escritório ficam lidas por quem respondeu, na hora da resposta", () => {
    // 06:42–06:45 do técnico; 06:46 o escritório responde; 06:50 o técnico de novo (esta ainda sem resposta)
    const g = lidasPelaResposta([m("a1", "APP", 42), m("a2", "APP", 43), m("a3", "APP", 45), m("e1", "ESCRITORIO", 46), m("a4", "APP", 50)]);
    // …e a resposta do escritório ficou lida pelo técnico, que escreveu depois dela (06:50)
    expect(g).toEqual([{ ids: ["a1", "a2", "a3"], lidaEm: t(46), lidaPorId: "uA" }, { ids: ["e1"], lidaEm: t(50), lidaPorId: "uT" }]);
  });

  it("dos dois lados; a já lida não volta; o mesmo lado não conta como leitura; fora de ordem, ordena", () => {
    const g = lidasPelaResposta([m("e2", "ESCRITORIO", 47), m("a1", "APP", 42, true), m("e1", "ESCRITORIO", 46, false, "uB"), m("a2", "APP", 48), m("a3", "APP", 44)]);
    // a3 (44) só tem a1 (já lida) antes; e1 (46, uB) responde a3; e1 e e2 do escritório: lidas pela resposta do técnico às 48
    expect(g).toEqual([
      { ids: ["a3"], lidaEm: t(46), lidaPorId: "uB" },
      { ids: ["e1", "e2"], lidaEm: t(48), lidaPorId: "uT" },
    ]);
    expect(lidasPelaResposta([m("a1", "APP", 42), m("a2", "APP", 43)])).toEqual([]);
  });
});

/* ───────── telas ───────── */
let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
async function montar(el: React.ReactElement) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(el); });
}
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("o ponto do seletor", () => {
  it("\"Atividade em andamento\": legenda visível e no nome acessível do chip; sem OS em andamento, sem legenda", async () => {
    const { SeletorOs } = await import("@/components/chat/seletor-os");
    const opcoes = [
      { osId: "osB", numero: "OS-4441", cliente: "Mercado Exemplo", emAndamento: true, atividadeId: "aB" },
      { osId: "osA", numero: "OS-4442", cliente: "Padaria Fictícia", emAndamento: false, atividadeId: "aA" },
    ];
    await montar(createElement(SeletorOs, { opcoes, valor: "osB", onValor: () => {} }));
    expect(txt($("[data-legenda-em-andamento]"))).toBe("Atividade em andamento");
    expect($("[data-os-opcao='osB']")!.getAttribute("aria-label")).toBe("OS-4441 · Mercado Exemplo (atividade em andamento)");
    expect($("[data-os-opcao='osA']")!.getAttribute("aria-label")).toBe("OS-4442 · Padaria Fictícia");
    act(() => root!.unmount()); root = undefined; document.body.innerHTML = "";
    await montar(createElement(SeletorOs, { opcoes: [{ ...opcoes[1] }], valor: "osA", onValor: () => {} }));
    expect($("[data-legenda-em-andamento]")).toBeNull();
  });
});

describe("o balão recusado", () => {
  const recusada = (over: Partial<ComentarioTela> = {}): ComentarioTela => ({
    id: null, clientId: "c1", texto: "Opa", autor: "João", origem: "APP", criadoEm: "2026-11-12T12:00:00.000Z", meu: true, pendente: false,
    falhou: "Esta OS não está atribuída a este técnico. Envie sem OS ou troque a OS.", recusa: { seq: 3, status: 403, comOs: true }, os: { id: "osA", numero: "OS-4440", cliente: "" }, ...over,
  });
  const OPCOES = [{ osId: "osA", numero: "OS-4440", cliente: "", emAndamento: false }, { osId: "osB", numero: "OS-4442", cliente: "", emAndamento: true }];

  it("o motivo à vista; Enviar sem OS, Trocar a OS (as outras), Descartar; nada de \"Tentar de novo\"", async () => {
    const { Balao } = await import("@/components/chat/balao");
    const reenviar = vi.fn(), descartar = vi.fn(), tentar = vi.fn();
    await montar(createElement("ul", null, createElement(Balao, { m: recusada(), mostrarAutor: false, onTentarDeNovo: tentar, recusa: { opcoesOs: OPCOES, reenviar, descartar } })));
    expect(txt($("[data-motivo-recusa]"))).toBe("Esta OS não está atribuída a este técnico. Envie sem OS ou troque a OS.");
    expect($("[data-tentar-de-novo]")).toBeNull();
    await act(async () => { $("[data-enviar-sem-os]")!.click(); });
    expect(reenviar).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: "c1" }), null);
    await act(async () => { $("[data-trocar-os]")!.click(); });
    expect([...document.querySelectorAll("[data-trocar-para]")].map((e) => e.getAttribute("data-trocar-para"))).toEqual(["osB"]);
    await act(async () => { $("[data-trocar-para='osB']")!.click(); });
    expect(reenviar).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: "c1" }), "osB");
    await act(async () => { $("[data-descartar]")!.click(); });
    expect(descartar).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1" }));
  });

  it("sem OS, não há \"Enviar sem OS\"; falha de REDE (escritório, sem recusa): o motivo e \"Tentar de novo\"", async () => {
    const { Balao } = await import("@/components/chat/balao");
    await montar(createElement("ul", null, createElement(Balao, { m: recusada({ os: null, falhou: "Recusada pelo servidor.", recusa: { seq: 3, status: 403, comOs: false } }), mostrarAutor: false, recusa: { opcoesOs: OPCOES, reenviar: vi.fn(), descartar: vi.fn() } })));
    expect($("[data-enviar-sem-os]")).toBeNull();
    expect($("[data-trocar-os]")).not.toBeNull();
    act(() => root!.unmount()); root = undefined; document.body.innerHTML = "";
    const tentar = vi.fn();
    await montar(createElement("ul", null, createElement(Balao, { m: recusada({ recusa: undefined, falhou: "Sem conexão: a mensagem não foi enviada." }), mostrarAutor: false, onTentarDeNovo: tentar })));
    expect(txt($("[data-motivo-recusa]"))).toBe("Sem conexão: a mensagem não foi enviada.");
    await act(async () => { $("[data-tentar-de-novo]")!.click(); });
    expect(tentar).toHaveBeenCalled();
  });
});
