// @vitest-environment happy-dom
/**
 * CHAT-1 — a tela Chat do APP DO TÉCNICO num DOM de verdade, com o banco do aparelho e o motor reais e um servidor
 * simulado (lista, conversa, long-polling de novidades e a fila /api/tecnico/sync):
 *  - a lista: uma linha por OS (nº, cliente, técnicos, última mensagem, hora, contador), busca e "Não lidas";
 *  - tocar abre a conversa SEM entrar na OS; "Abrir a OS" leva à execução;
 *  - enviar põe a mensagem na FILA com a atividade da conversa ("Enviando…"); com sinal sobe e vira ✓ (Enviada);
 *  - recusada pelo servidor: "Não enviada" com "Tentar de novo", que chama o motor e reenvia;
 *  - sem sinal: a lista e a conversa guardadas no aparelho, com o aviso;
 *  - OS cancelada: sem caixa de escrever;
 *  - a barra inferior: o item Chat com o contador, em tempo real em qualquer vista;
 *  - a execução da OS: "Abrir no Chat"; lerVista/urlDaVista com ver=chat&os=.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { aplicarComentario, type ComentarioTela } from "@/lib/tecnico/comentarios";
import { MSG_OS_CANCELADA, type ConversaResumo } from "@/lib/chat/regras";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));

const MEIO_DIA = Date.parse("2026-11-12T18:00:00.000Z"); // 15:00 em Brasília
const HOJE = "2026-11-12";

/* ───────── servidor simulado ───────── */
let online = true;
let recusar: string | null = null;
let marca = 0;
let esperas = new Set<() => void>();
let pedidos: string[] = [];
let enviadas: any[] = [];
let conversas: ConversaResumo[] = [];
let mensagens: Record<string, ComentarioTela[]> = {};

const resumo = (osId: string, osNumero: string, cliente: string, extra: Partial<ConversaResumo> = {}): ConversaResumo => ({
  osId, osNumero, cliente, status: "ABERTA", tecnicos: ["João Silva"], ultima: null, naoLidas: 0, atividadeId: `a-${osId}`, atividadeIds: [`a-${osId}`], ...extra,
});
const msg = (id: string, texto: string, autor: string, criadoEm: string, extra: Partial<ComentarioTela> = {}): ComentarioTela => ({
  id, clientId: null, texto, autor, origem: "ESCRITORIO", criadoEm, meu: false, ...extra,
});
function cenario() {
  conversas = [
    resumo("osA", "OS-1", "Hospital Central", {
      tecnicos: ["João Silva", "Pedro Lima"], naoLidas: 2, atividadeId: "aA", atividadeIds: ["aA", "aA-antiga"],
      ultima: { texto: "Peça chega amanhã.\nConfirmo depois.", autor: "Ana", criadoEm: "2026-11-12T17:00:00.000Z", minha: false, foto: false },
    }),
    resumo("osB", "OS-2", "Mercado Bom Preço", { ultima: { texto: "Compressor trocado.", autor: "João Silva", criadoEm: "2026-11-11T12:00:00.000Z", minha: true, foto: false } }),
    resumo("osC", "OS-3", "Escola Estadual", { status: "CANCELADA", ultima: { texto: "OS cancelada pelo cliente.", autor: "Ana", criadoEm: "2026-11-02T12:00:00.000Z", minha: false, foto: false } }),
  ];
  mensagens = {
    osA: [msg("m1", "Bom dia, a peça atrasou.", "Ana", "2026-11-12T16:00:00.000Z", { lida: null }), msg("m2", "Peça chega amanhã.\nConfirmo depois.", "Ana", "2026-11-12T17:00:00.000Z")],
    osB: [msg("m3", "Compressor trocado.", "João Silva", "2026-11-11T12:00:00.000Z", { origem: "APP", meu: true })],
    osC: [msg("m4", "OS cancelada pelo cliente.", "Ana", "2026-11-02T12:00:00.000Z")],
  };
}
/** Algo mudou no servidor: o long-polling responde na hora */
function mudarServidor() { marca += 1; for (const f of [...esperas]) f(); }
const naoLidas = () => conversas.reduce((n, c) => n + c.naoLidas, 0);

const cartao = (): CartaoTela => ({
  atividadeId: "aA", osId: "osA", osNumero: "OS-1", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: HOJE, hora: "09:00",
  duracaoMin: 60, cliente: "Hospital Central", telefone: null, unidade: "Matriz", endereco: "Av. Paulista", rota: null, descricao: "Preventiva", equipamentos: 0, atendidos: 0, adicionais: 0, avisos: {},
} as CartaoTela);
const retrato = (): RetratoAtividade => ({
  cartao: cartao(),
  execucao: {
    atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "osA", numero: "OS-1", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, adicionais: [], avisos: {}, materiais: [], comentarios: mensagens.osA ?? [], equipamentos: [],
    conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null, dispensa: null },
  },
  equipamentosUnidade: [], checklistsPorTipo: {}, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
} as unknown as RetratoAtividade);

const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchFalso = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  if (!online) throw new TypeError("Failed to fetch");
  const u = new URL(url, "http://app.local");
  if (u.pathname === "/api/tecnico/conversas/novidades") {
    const desde = u.searchParams.get("desde");
    const atual = `${marca}.0`;
    if (!desde || desde !== atual) return json({ marca: atual, mudou: !!desde });
    return new Promise((ok, falha) => {
      const f = () => { esperas.delete(f); ok(json({ marca: `${marca}.0`, mudou: true })); };
      esperas.add(f);
      init?.signal?.addEventListener("abort", () => { esperas.delete(f); falha(new DOMException("abortado", "AbortError")); });
    });
  }
  pedidos.push(`${init?.method ?? "GET"} ${url}`);
  if (url === "/api/tecnico/conversas") return json({ conversas, naoLidas: naoLidas() });
  const m = u.pathname.match(/^\/api\/tecnico\/conversas\/([^/]+)$/);
  if (m) {
    const c = conversas.find((x) => x.osId === m[1]);
    if (!c) return json({ erro: "Conversa não encontrada." }, 404);
    c.naoLidas = 0; // ler marca como lidas
    return json({ conversa: c, mensagens: mensagens[c.osId] ?? [] });
  }
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João Silva" }, dia: HOJE, atividades: [cartao()], anteriores: [] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    enviadas.push(...corpo.operacoes);
    const resultados = corpo.operacoes.map((o: any) => {
      if (o.tipo !== "comentario") return { id: o.id, ok: true, status: 200 };
      if (recusar) return { id: o.id, ok: false, status: 422, erro: recusar };
      const osId = conversas.find((c) => c.atividadeIds?.includes(o.atividadeId))!.osId;
      mensagens[osId] = aplicarComentario(mensagens[osId] ?? [], o.dados, "2026-11-12T18:00:00.000Z", "João Silva")
        .map((c) => ({ ...c, pendente: undefined, id: c.id ?? `s-${c.clientId}` }));
      return { id: o.id, ok: true, status: 200, dados: {} };
    });
    return json({ resultados });
  }
  return json({}, 404);
});

/* ───────── montagem ───────── */
let root: Root | undefined; let caixa: HTMLDivElement | undefined; let banco: BancoTecnico; let motor: MotorSync;
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/chat"), import("@/components/tecnico/execucao"), import("@/components/tecnico/app-tecnico")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; recusar = null; pedidos = []; enviadas = []; esperas = new Set(); fetchFalso.mockClear();
  cenario();
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  window.history.replaceState(null, "", "/tecnico");
  vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
});
afterEach(() => {
  fechar();
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean | Promise<boolean>, msg = "condição") { for (let i = 0; i < 200; i++) { if (await cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (el: HTMLTextAreaElement | HTMLInputElement | null, valor: string) => {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
};
function fechar() {
  if (root) act(() => root!.unmount());
  caixa?.remove(); document.body.innerHTML = "";
  root = undefined; caixa = undefined;
}
async function abrirVistas(endereco: string) {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { VistaChat } = await import("@/components/tecnico/chat");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "chat") return createElement(VistaChat, { os: v.os });
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e });
    return createElement("div", { "data-vista": v.ver });
  }
  window.history.replaceState(null, "", endereco);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(ProvedorTecnico, { usuario: USUARIO, motorPronto: motor, children: createElement(Vistas) })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela");
  await esperar();
}
const linhas = () => $$("[data-conversa-linha]").map((l) => l.getAttribute("data-conversa-linha"));
const balao = (t: string) => $$("[data-mensagem]").find((b) => texto(b).includes(t)) ?? null;
async function escrever(t: string) {
  await digitar($("[data-texto-mensagem]") as HTMLTextAreaElement, t);
  await clicar($("[data-enviar-mensagem]"));
}

/* ───────── testes ───────── */
describe("lista de conversas", () => {
  it("uma linha por OS: nº, cliente, técnicos, última mensagem (1ª linha), hora e contador; a minha com a marca, sem 'você'", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => linhas().length === 3, "lista");
    expect(linhas()).toEqual(["osA", "osB", "osC"]);
    const a = $("[data-conversa-linha='osA']")!;
    expect(texto(a.querySelector("[data-os-numero]"))).toBe("OS-1");
    expect(texto(a.querySelector("[data-cliente]"))).toBe("· Hospital Central");
    expect(texto(a.querySelector("[data-tecnicos]"))).toBe("João Silva, Pedro Lima");
    expect(texto(a.querySelector("[data-ultima]"))).toBe("Peça chega amanhã.");
    expect(texto(a.querySelector("[data-hora]"))).toBe("14:00");
    expect(a.querySelector("[data-nao-lidas]")!.textContent).toBe("2");
    expect(a.querySelector("[data-minha-ultima]")).toBeNull();
    const b = $("[data-conversa-linha='osB']")!;
    expect(b.querySelector("[data-minha-ultima]")!.getAttribute("aria-label")).toBe("Minha mensagem");
    expect(texto(b.querySelector("[data-hora]"))).toBe("Ontem");
    expect(b.querySelector("[data-nao-lidas]")).toBeNull();
    expect(texto($("[data-conversa-linha='osC'] [data-hora]"))).toBe("02/11");
    expect(a.className).toContain("touch-target");
    expect(texto($("[data-chat-lista]")).toLowerCase()).not.toMatch(/\bvocê\b/);
  });

  it("busca (nº, cliente, técnico, mensagem; sem acento) e o filtro 'Não lidas'", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => linhas().length === 3, "lista");
    const busca = $("[data-busca-chat]") as HTMLInputElement;
    await digitar(busca, "mercado"); expect(linhas()).toEqual(["osB"]);
    await digitar(busca, "pedro"); expect(linhas()).toEqual(["osA"]);
    await digitar(busca, "PECA CHEGA"); expect(linhas()).toEqual(["osA"]);
    await digitar(busca, "os-3"); expect(linhas()).toEqual(["osC"]);
    await digitar(busca, "nada disso"); expect(linhas()).toEqual([]);
    expect(texto($("[data-chat-vazio]"))).toBe("Nenhuma conversa encontrada.");
    await digitar(busca, "");
    expect(texto($("[data-filtro-chat='nao-lidas']"))).toBe("Não lidas (1)");
    await clicar($("[data-filtro-chat='nao-lidas']"));
    expect($("[data-filtro-chat='nao-lidas']")!.getAttribute("aria-pressed")).toBe("true");
    expect(linhas()).toEqual(["osA"]);
    await clicar($("[data-filtro-chat='todas']"));
    expect(linhas()).toEqual(["osA", "osB", "osC"]);
  });

  it("sem 'Exibir dados do cliente': o nome do cliente não aparece nem é achado pela busca", async () => {
    const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
    const { VistaChat } = await import("@/components/tecnico/chat");
    window.history.replaceState(null, "", "/tecnico?ver=chat");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root!.render(createElement(ProvedorTecnico, { usuario: USUARIO, motorPronto: motor, config: { ...CONFIG_APP_PADRAO, exibirDadosCliente: false }, children: createElement(VistaChat, {}) })); });
    await esperarAte(() => linhas().length === 3, "lista");
    expect($("[data-cliente]")).toBeNull();
    await digitar($("[data-busca-chat]") as HTMLInputElement, "hospital");
    expect(linhas()).toEqual([]);
  });
});

describe("a conversa", () => {
  it("tocar abre a conversa SEM entrar na OS (nem baixar o retrato); 'Abrir a OS' leva à execução", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => linhas().length === 3, "lista");
    await clicar($("[data-conversa-linha='osA']"));
    expect(window.location.search).toBe("?ver=chat&os=osA");
    await esperarAte(() => $$("[data-mensagem]").length === 2, "mensagens");
    expect($("[data-vista]")!.getAttribute("data-vista")).toBe("chat");
    expect($("[data-chat-conversa]")!.getAttribute("data-chat-conversa")).toBe("osA");
    expect(texto($("[data-chat-titulo]"))).toBe("OS-1 · Hospital Central");
    expect(texto($("[data-chat-tecnicos]"))).toBe("João Silva, Pedro Lima");
    expect(texto(balao("a peça atrasou"))).toContain("Ana · escritório");
    expect(pedidos).toContain("GET /api/tecnico/conversas/osA");
    expect(pedidos.some((p) => p.includes("/api/tecnico/atividades/"))).toBe(false);
    // Ler marcou como lidas: a lista guardada já não conta esta conversa
    await esperarAte(() => pedidos.filter((p) => p === "GET /api/tecnico/conversas").length >= 2, "lista atualizada depois de ler");
    expect($("[data-voltar-chat]")!.className).toContain("touch-target");
    await clicar($("[data-voltar-chat]"));
    expect(window.location.search).toBe("?ver=chat");
    await esperarAte(() => linhas().length === 3, "lista de novo");
    expect($("[data-conversa-linha='osA'] [data-nao-lidas]")).toBeNull();
    await clicar($("[data-conversa-linha='osA']"));
    await esperarAte(() => !!$("[data-abrir-os]"), "abrir a OS");
    expect(texto($("[data-abrir-os]"))).toBe("Abrir a OS");
    await clicar($("[data-abrir-os]"));
    expect(window.location.search).toBe("?ver=os&a=aA");
  });

  it("enviar: entra na FILA com a atividade da conversa e aparece 'Enviando…'; com sinal sobe e vira ✓ (Enviada)", async () => {
    await abrirVistas("/tecnico?ver=chat&os=osA");
    await esperarAte(() => $$("[data-mensagem]").length === 2, "mensagens");
    online = false;
    await escrever("  Cheguei no local.  ");
    const fila = (await banco.fila()).filter((o) => o.tipo === "comentario");
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ atividadeId: "aA", estado: "pendente", dados: { texto: "Cheguei no local.", clientId: expect.any(String) } });
    await esperarAte(() => !!balao("Cheguei no local."), "balão pendente");
    const b = balao("Cheguei no local.")!;
    expect(b.getAttribute("data-estado")).toBe("enviando");
    expect(b.querySelector("[data-estado-icone]")!.getAttribute("aria-label")).toContain("Enviando…");
    expect(($("[data-texto-mensagem]") as HTMLTextAreaElement).value).toBe("");
    // O sinal volta: sobe sozinho; a conversa recarrega e a mensagem fica Enviada (✓), uma vez só
    online = true;
    await act(async () => { await motor.sincronizar(true); });
    await esperarAte(() => balao("Cheguei no local.")?.getAttribute("data-estado") === "enviada", "enviada (✓)");
    expect(enviadas.filter((o) => o.tipo === "comentario")).toHaveLength(1);
    expect($$("[data-mensagem]").filter((m) => texto(m).includes("Cheguei no local."))).toHaveLength(1);
  });

  it("recusada pelo servidor: 'Não enviada' com o motivo e 'Tentar de novo', que chama o motor e reenvia", async () => {
    await abrirVistas("/tecnico?ver=chat&os=osA");
    await esperarAte(() => $$("[data-mensagem]").length === 2, "mensagens");
    recusar = "Atividade bloqueada pelo escritório.";
    await escrever("Preciso da senha do quadro.");
    await act(async () => { await motor.aguardar(); });
    await esperarAte(() => balao("Preciso da senha")?.getAttribute("data-estado") === "falhou", "falhou");
    const b = balao("Preciso da senha")!;
    expect(texto(b.querySelector("[data-falhou]"))).toBe("Não enviada");
    expect(b.querySelector("[data-estado-icone]")!.getAttribute("aria-label")).toBe("Atividade bloqueada pelo escritório.");
    expect(texto(b.querySelector("[data-tentar-de-novo]"))).toBe("Tentar de novo");
    recusar = null;
    const tentar = vi.spyOn(motor, "tentarDeNovo");
    await clicar(b.querySelector("[data-tentar-de-novo]"));
    expect(tentar).toHaveBeenCalledTimes(1);
    await act(async () => { await motor.aguardar(); });
    await esperarAte(() => balao("Preciso da senha")?.getAttribute("data-estado") === "enviada", "reenviada");
    expect(enviadas.filter((o) => o.tipo === "comentario")).toHaveLength(2); // a recusada e a reenviada (mesmo clientId)
    expect(new Set(enviadas.filter((o) => o.tipo === "comentario").map((o) => o.dados.clientId)).size).toBe(1);
  });

  it("tempo real: mensagem nova do escritório aparece na conversa aberta sem tocar em nada", async () => {
    await abrirVistas("/tecnico?ver=chat&os=osA");
    await esperarAte(() => $$("[data-mensagem]").length === 2, "mensagens");
    await esperar(6);
    mensagens.osA = [...mensagens.osA, msg("m9", "Pode fechar a OS.", "Ana", "2026-11-12T18:00:00.000Z")];
    mudarServidor();
    await esperarAte(() => !!balao("Pode fechar a OS."), "chegou");
  });

  it("sem sinal: a lista e a conversa guardadas no aparelho, com o aviso de que são da última sincronização", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => linhas().length === 3, "lista");
    await clicar($("[data-conversa-linha='osA']"));
    await esperarAte(() => $$("[data-mensagem]").length === 2, "mensagens");
    expect($("[data-aviso-aparelho]")).toBeNull();
    fechar();
    online = false;
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => linhas().length === 3, "lista guardada");
    expect(texto($("[data-aviso-aparelho]"))).toMatch(/^Sem sinal: lista da última sincronização \(às \d\d:\d\d\)\.$/);
    await clicar($("[data-conversa-linha='osA']"));
    await esperarAte(() => $$("[data-mensagem]").length === 2, "conversa guardada");
    expect(texto($("[data-aviso-aparelho]"))).toContain("Sem sinal: conversa da última sincronização");
    expect(texto(balao("a peça atrasou"))).toContain("Ana");
    // Conversa nunca aberta neste aparelho: diz por quê, mas deixa escrever (a lista guardada sabe a atividade)
    await clicar($("[data-voltar-chat]"));
    await esperarAte(() => linhas().length === 3, "lista");
    await clicar($("[data-conversa-linha='osB']"));
    await esperarAte(() => !!$("[data-escrever]"), "caixa de escrever");
    expect(texto($("[data-aviso-aparelho]"))).toContain("as mensagens anteriores aparecem quando o sinal voltar");
    await escrever("Sem sinal aqui.");
    expect((await banco.fila()).find((o) => o.tipo === "comentario")).toMatchObject({ atividadeId: "a-osB" });
  });

  it("OS cancelada: só leitura, sem caixa de escrever", async () => {
    await abrirVistas("/tecnico?ver=chat&os=osC");
    await esperarAte(() => $$("[data-mensagem]").length === 1, "mensagens");
    expect($("[data-escrever]")).toBeNull();
    expect($("[data-texto-mensagem]")).toBeNull();
    expect(texto($("[data-somente-leitura]"))).toBe(MSG_OS_CANCELADA);
  });

  it("OS de outro técnico (404): 'Conversa não encontrada.'", async () => {
    await abrirVistas("/tecnico?ver=chat&os=osZ");
    await esperarAte(() => !!$("[data-sem-dados]"), "sem conversa");
    expect(texto($("[data-sem-dados]"))).toBe("Conversa não encontrada.");
    expect($("[data-escrever]")).toBeNull();
  });
});

describe("na execução da OS", () => {
  it("'Abrir no Chat' leva à conversa desta OS", async () => {
    await abrirVistas("/tecnico?ver=os&a=aA");
    await esperarAte(() => !!$("[data-abrir-chat]"), "link");
    expect(texto($("[data-abrir-chat]"))).toBe("Abrir no Chat");
    expect($("[data-abrir-chat]")!.className).toContain("touch-target");
    await clicar($("[data-abrir-chat]"));
    expect(window.location.search).toBe("?ver=chat&os=osA");
    await esperarAte(() => $("[data-chat-conversa]")?.getAttribute("data-chat-conversa") === "osA", "conversa");
  });
});

describe("barra inferior do app", () => {
  async function abrirApp(endereco = "/tecnico", usuario: Record<string, unknown> = USUARIO) {
    window.history.replaceState(null, "", endereco);
    const { AppTecnico } = await import("@/components/tecnico/app-tecnico");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    const perfilInicial = { nome: "João Silva", email: "joao@clima.com", avatar: null, empresaNome: "Clima", perfilNome: null, cargo: "Técnico" };
    await act(async () => { root!.render(createElement(AppTecnico, { usuario: usuario as any, config: CONFIG_APP_PADRAO, perfilInicial })); });
    await esperarAte(() => !!$("[data-nav]"), "app");
  }
  const botoes = () => $$("[data-nav]").map((b) => b.getAttribute("data-nav"));

  it("Meu dia · Agenda · Chat · Perfil (+ Desempenho); o Chat com o contador de não lidas, em tempo real em qualquer vista", async () => {
    await abrirApp();
    expect(botoes()).toEqual(["dia", "agenda", "chat", "perfil"]);
    const chat = $("[data-nav='chat']")!;
    expect(texto(chat)).toContain("Chat");
    expect(chat.className).toContain("touch-target");
    await esperarAte(() => !!chat.querySelector("[data-nao-lidas]"), "contador");
    expect(chat.querySelector("[data-nao-lidas]")!.textContent).toBe("2");
    expect(chat.querySelector("[data-nao-lidas]")!.getAttribute("aria-label")).toBe("2 mensagens não lidas");
    // Chegou mensagem com o app no Meu dia: o contador acompanha sozinho
    await esperar(6);
    conversas[1].naoLidas = 3;
    mudarServidor();
    await esperarAte(() => chat.querySelector("[data-nao-lidas]")?.textContent === "5", "contador em tempo real");
    expect($("[data-vista]")!.getAttribute("data-vista")).toBe("dia");
    await clicar(chat);
    expect(window.location.search).toBe("?ver=chat");
    expect(chat.getAttribute("aria-current")).toBe("page");
    await esperarAte(() => linhas().length === 3, "lista");
    fechar();
    await abrirApp("/tecnico", { ...USUARIO, desempenho: true });
    expect(botoes()).toEqual(["dia", "agenda", "chat", "desempenho", "perfil"]);
    expect($("[data-nav='dia']")!.parentElement!.className).toContain("grid-cols-5");
  });

  it("o push abre /tecnico?ver=chat&os=<osId> direto na conversa, com o Chat marcado na barra", async () => {
    await abrirApp("/tecnico?ver=chat&os=osA");
    await esperarAte(() => $("[data-chat-conversa]")?.getAttribute("data-chat-conversa") === "osA", "conversa");
    expect($("[data-nav='chat']")!.getAttribute("aria-current")).toBe("page");
  });
});

describe("lerVista / urlDaVista", () => {
  it("ver=chat (lista) e ver=chat&os= (conversa), ida e volta, com o mesmo endereço do push", async () => {
    const { lerVista, urlDaVista } = await import("@/components/tecnico/contexto");
    const { urlConversaApp } = await import("@/lib/chat/regras");
    expect(lerVista("?ver=chat")).toEqual({ ver: "chat" });
    expect(lerVista("?ver=chat&os=osA")).toEqual({ ver: "chat", os: "osA" });
    expect(lerVista("?ver=chat&os=")).toEqual({ ver: "chat" });
    expect(urlDaVista({ ver: "chat" })).toBe("/tecnico?ver=chat");
    expect(urlDaVista({ ver: "chat", os: "os/1 x" })).toBe(urlConversaApp("os/1 x"));
    expect(lerVista(new URL(`http://x${urlDaVista({ ver: "chat", os: "os/1 x" })}`).search)).toEqual({ ver: "chat", os: "os/1 x" });
  });
});
