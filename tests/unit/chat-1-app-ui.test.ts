// @vitest-environment happy-dom
/**
 * CHAT-1 — a tela Chat do APP DO TÉCNICO (a conversa "Escritório", por pessoa) num DOM de verdade, com o banco do
 * aparelho e o motor reais e um servidor simulado (a conversa, o long-polling de novidades e a fila /api/tecnico/sync):
 *  - UMA conversa, "Escritório": os balões com quem respondeu e as etiquetas da OS (agrupadas; "Sem OS");
 *  - o seletor de 1 toque começa na OS padrão do servidor e troca com um toque (sem "Outra OS" no app);
 *  - enviar com OS põe na FILA com a atividade da OS; "Sem OS" põe com SEM_OS; "Enviando…" → ✓; recusada: "Não
 *    enviada" com "Tentar de novo";
 *  - a mensagem nova do escritório chega pelo tempo real; a leitura do próprio técnico não faz a conversa recarregar
 *    em laço;
 *  - o contador do Chat na barra vem de `naoLidas` do tempo real (sem baixar a conversa, que marcaria como lida);
 *  - sem sinal: a conversa guardada no aparelho, com o aviso; escrever vai para a fila;
 *  - a etiqueta abre a execução da OS ("Abrir a OS"); dentro da OS, "Abrir no Chat" leva à conversa;
 *  - nada de "você"; lerVista/urlDaVista com ver=chat (o endereço do push).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { aplicarComentario, type ComentarioTela } from "@/lib/tecnico/comentarios";
import { SEM_OS } from "@/lib/tecnico/despesas";
import { MSG_CONVERSA_SEM_SINAL } from "@/lib/tecnico/chat";
import type { OsDoDia } from "@/lib/chat/regras";
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
// A marca do tempo real: mensagens · 1ª leitura · a leitura do próprio técnico (não reinicia entre os testes: o laço
// de novidades da aba é um só e lembra a última marca)
let marca = 0;
let leitura = 0;
let esperas = new Set<() => void>();
let pedidos: string[] = [];
let enviadas: any[] = [];
let mensagens: ComentarioTela[] = [];
let osDoDia: OsDoDia[] = [];
let osPadrao: string | null = null;
let naoLidas = 0;

const OS_A = { id: "osA", numero: "OS-1", cliente: "Hospital Central" };
const OS_B = { id: "osB", numero: "OS-2", cliente: "Mercado Bom Preço" };
const OS_V = { id: "osV", numero: "OS-9", cliente: "Escola Estadual" }; // de outro dia: sem atividade no aparelho
const msg = (id: string, texto: string, autor: string, criadoEm: string, os: ComentarioTela["os"], extra: Partial<ComentarioTela> = {}): ComentarioTela => ({
  id, clientId: null, texto, autor, origem: "ESCRITORIO", criadoEm, meu: false, os, ...extra,
});
function cenario() {
  osDoDia = [
    { osId: "osA", numero: "OS-1", cliente: "Hospital Central", emAndamento: true, atividadeId: "aA" },
    { osId: "osB", numero: "OS-2", cliente: "Mercado Bom Preço", emAndamento: false, atividadeId: "aB" },
  ];
  osPadrao = "osA";
  naoLidas = 2;
  mensagens = [
    msg("m1", "Bom dia, a peça atrasou.", "Ana Souza", "2026-11-12T15:00:00.000Z", OS_A),
    msg("m2", "Peça chega amanhã.", "Carlos Lima", "2026-11-12T15:30:00.000Z", OS_A),
    msg("m3", "Reunião às 17h no escritório.", "Ana Souza", "2026-11-12T16:00:00.000Z", null),
    msg("m4", "Compressor trocado.", "João Silva", "2026-11-12T16:30:00.000Z", OS_B, { origem: "APP", meu: true, clientId: "c4" }),
    msg("m5", "Sobre a OS de ontem: tudo certo.", "Ana Souza", "2026-11-12T17:00:00.000Z", OS_V),
  ];
}
const marcaAtual = () => `${marca}.0.${leitura}`;
/** Algo mudou no servidor: o long-polling responde na hora */
function acordar() { for (const f of [...esperas]) f(); }
function mudarServidor() { marca += 1; acordar(); }

const cartao = (atividadeId: string, os: typeof OS_A): CartaoTela => ({
  atividadeId, osId: os.id, osNumero: os.numero, titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: HOJE, hora: "09:00",
  duracaoMin: 60, cliente: os.cliente, telefone: null, unidade: "Matriz", endereco: "Av. Paulista", rota: null, descricao: "Preventiva", equipamentos: 0, atendidos: 0, adicionais: 0, avisos: {},
} as CartaoTela);
const retrato = (atividadeId: string): RetratoAtividade => {
  const os = atividadeId === "aB" ? OS_B : OS_A;
  return {
    cartao: cartao(atividadeId, os),
    execucao: {
      atividade: { id: atividadeId, titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: os.id, numero: os.numero, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false, adicionais: [], avisos: {}, materiais: [], comentarios: mensagens.filter((m) => m.os?.id === os.id), equipamentos: [],
      conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null, dispensa: null },
    },
    equipamentosUnidade: [], checklistsPorTipo: {}, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
  } as unknown as RetratoAtividade;
};

const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchFalso = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  if (!online) throw new TypeError("Failed to fetch");
  const u = new URL(url, "http://app.local");
  if (u.pathname === "/api/tecnico/conversas/novidades") {
    const desde = u.searchParams.get("desde");
    if (!desde || desde !== marcaAtual()) return json({ marca: marcaAtual(), mudou: !!desde, naoLidas });
    return new Promise((ok, falha) => {
      const f = () => { esperas.delete(f); ok(json({ marca: marcaAtual(), mudou: true, naoLidas })); };
      esperas.add(f);
      init?.signal?.addEventListener("abort", () => { esperas.delete(f); falha(new DOMException("abortado", "AbortError")); });
    });
  }
  pedidos.push(`${init?.method ?? "GET"} ${url}`);
  if (url === "/api/tecnico/conversas") {
    // Ler marca como lidas: a leitura do técnico avança (muda a 3ª parte da marca) e o contador zera
    naoLidas = 0; leitura += 1; acordar();
    return json({ mensagens, osDoDia, osPadrao });
  }
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João Silva" }, dia: HOJE, atividades: [cartao("aA", OS_A), cartao("aB", OS_B)], anteriores: [] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    enviadas.push(...corpo.operacoes);
    let mudou = false;
    const resultados = corpo.operacoes.map((o: any) => {
      if (o.tipo !== "comentario") return { id: o.id, ok: true, status: 200 };
      if (recusar) return { id: o.id, ok: false, status: 422, erro: recusar };
      const os = o.atividadeId === SEM_OS ? null : o.atividadeId === "aB" ? OS_B : OS_A;
      mensagens = aplicarComentario(mensagens, o.dados, "2026-11-12T18:00:00.000Z", "João Silva")
        .map((c) => (c.clientId === o.dados.clientId ? { ...c, pendente: undefined, id: c.id ?? `s-${c.clientId}`, os: c.os === undefined ? os : c.os } : c));
      mudou = true;
      return { id: o.id, ok: true, status: 201, dados: {} };
    });
    if (mudou) mudarServidor();
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
  marca += 1; // o laço da aba lembra a marca do teste anterior: a 1ª pergunta deste já traz o estado novo
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
async function abrirVistas(endereco: string, config = CONFIG_APP_PADRAO) {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { VistaChat } = await import("@/components/tecnico/chat");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "chat") return createElement(VistaChat);
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e });
    return createElement("div", { "data-vista": v.ver });
  }
  window.history.replaceState(null, "", endereco);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(ProvedorTecnico, { usuario: USUARIO, motorPronto: motor, config, children: createElement(Vistas) })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$("[data-mensagens] .animate-spin"), "tela");
  await esperar();
}
const balao = (t: string) => $$("[data-mensagem]").find((b) => texto(b).includes(t)) ?? null;
const etiquetas = () => $$("[data-etiqueta-os]").map((e) => e.getAttribute("data-etiqueta-os"));
const opcoes = () => $$("[data-os-opcao]").map((o) => o.getAttribute("data-os-opcao"));
const marcada = () => $$("[data-os-opcao]").filter((o) => o.getAttribute("aria-checked") === "true").map((o) => o.getAttribute("data-os-opcao"));
const pedidosConversa = () => pedidos.filter((p) => p === "GET /api/tecnico/conversas").length;
async function escrever(t: string) {
  await digitar($("[data-texto-mensagem]") as HTMLTextAreaElement, t);
  await clicar($("[data-enviar-mensagem]"));
}
const comentariosNaFila = async () => (await banco.fila()).filter((o) => o.tipo === "comentario");

/* ───────── testes ───────── */
describe("a conversa Escritório", () => {
  it("UMA conversa: balões com quem respondeu, etiquetas da OS só quando a OS muda (agrupadas) e 'Sem OS'; sem 'você'", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "mensagens");
    expect($("[data-vista]")!.getAttribute("data-vista")).toBe("chat");
    expect(texto($("[data-chat-titulo]"))).toBe("Escritório");
    // m1 e m2 (mesma OS) agrupam numa etiqueta só; a sem OS, a da OS-2 e a de outro dia têm a sua
    expect(etiquetas()).toEqual(["osA", "sem-os", "osB", "osV"]);
    expect(texto($("[data-etiqueta-os='osA']"))).toBe("OS-1 · Hospital Central");
    expect(texto($("[data-etiqueta-os='sem-os']"))).toBe("Sem OS");
    expect(texto($("[data-etiqueta-os='osB']"))).toBe("OS-2 · Mercado Bom Preço");
    expect($$("[data-dia]").map((d) => texto(d))).toEqual(["Hoje"]);
    // Qualquer pessoa do escritório responde: o balão mostra quem
    expect(texto(balao("a peça atrasou")!.querySelector("[data-autor]"))).toBe("Ana Souza · escritório");
    expect(texto(balao("Peça chega amanhã.")!.querySelector("[data-autor]"))).toBe("Carlos Lima · escritório");
    expect(balao("Compressor trocado.")!.getAttribute("data-minha")).toBe("true");
    // Não há mais lista de conversas no app
    expect($("[data-conversa-linha]")).toBeNull();
    expect(pedidos).toEqual(["GET /api/tecnico/conversas"]);
    expect(texto(document.body).toLowerCase()).not.toMatch(/\bvocê\b/);
    expect(($("[data-texto-mensagem]") as HTMLTextAreaElement).placeholder).toBe("Escreva para o escritório");
    // Ler marcou como lidas (a leitura do técnico mudou a marca): a conversa NÃO recarrega por isso (sem laço)
    await esperar(20);
    expect(pedidosConversa()).toBe(1);
  });

  it("o seletor (1 toque) com as OS do dia + 'Sem OS', sem 'Outra OS'; começa na OS padrão do servidor e troca com um toque", async () => {
    osPadrao = "osB";
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => opcoes().length === 3, "seletor");
    expect(opcoes()).toEqual(["osA", "osB", "sem-os"]);
    expect($$("[data-os-opcao]").map((o) => texto(o))).toEqual(["OS-1 · Hospital Central", "OS-2 · Mercado Bom Preço", "Sem OS"]);
    expect($("[data-os-opcao='osA']")!.getAttribute("title")).toBe("Atividade em andamento");
    expect($("[data-outra-os]")).toBeNull();
    expect(marcada()).toEqual(["osB"]);
    await clicar($("[data-os-opcao='osA']"));
    expect(marcada()).toEqual(["osA"]);
    await clicar($("[data-os-opcao='sem-os']"));
    expect(marcada()).toEqual(["sem-os"]);
    expect($("[data-os-opcao='osB']")!.className).toContain("touch-target");
  });

  it("sem OS padrão (nada em andamento, nada hoje): começa em 'Sem OS'", async () => {
    osPadrao = null;
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => opcoes().length === 3, "seletor");
    expect(marcada()).toEqual(["sem-os"]);
  });

  it("sem 'Exibir dados do cliente': o nome do cliente não aparece nas etiquetas nem no seletor", async () => {
    await abrirVistas("/tecnico?ver=chat", { ...CONFIG_APP_PADRAO, exibirDadosCliente: false });
    await esperarAte(() => $$("[data-mensagem]").length === 5, "mensagens");
    expect(texto($("[data-etiqueta-os='osA']"))).toBe("OS-1");
    expect($$("[data-os-opcao]").map((o) => texto(o))).toEqual(["OS-1", "OS-2", "Sem OS"]);
    expect(texto(document.body)).not.toContain("Hospital");
  });
});

describe("enviar", () => {
  it("com OS: entra na FILA com a atividade da OS escolhida, 'Enviando…' com a etiqueta dela; o seletor fica na escolha; com sinal vira ✓", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => marcada().length === 1, "seletor");
    expect(marcada()).toEqual(["osA"]);
    await clicar($("[data-os-opcao='osB']"));
    online = false;
    await escrever("  Cheguei no mercado.  ");
    const fila = await comentariosNaFila();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ atividadeId: "aB", estado: "pendente", dados: { texto: "Cheguei no mercado.", clientId: expect.any(String) } });
    await esperarAte(() => !!balao("Cheguei no mercado."), "balão pendente");
    const b = balao("Cheguei no mercado.")!;
    expect(b.getAttribute("data-estado")).toBe("enviando");
    expect(b.querySelector("[data-estado-icone]")!.getAttribute("aria-label")).toContain("Enviando…");
    expect(etiquetas().at(-1)).toBe("osB"); // a de outro dia (osV) vinha antes: a nova leva a etiqueta da OS-2
    expect(($("[data-texto-mensagem]") as HTMLTextAreaElement).value).toBe("");
    expect(marcada()).toEqual(["osB"]); // depois de enviar, fica na mesma escolha
    // O sinal volta: sobe sozinho; a conversa recarrega e a mensagem fica Enviada (✓), uma vez só
    online = true;
    await act(async () => { await motor.sincronizar(true); });
    await esperarAte(() => balao("Cheguei no mercado.")?.getAttribute("data-estado") === "enviada", "enviada (✓)");
    expect(enviadas.filter((o) => o.tipo === "comentario").map((o) => o.atividadeId)).toEqual(["aB"]);
    expect($$("[data-mensagem]").filter((m) => texto(m).includes("Cheguei no mercado."))).toHaveLength(1);
    expect(marcada()).toEqual(["osB"]);
  });

  it("'Sem OS': entra na fila com SEM_OS, aparece sob a etiqueta 'Sem OS' e sobe (sem retrato de atividade)", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => marcada().length === 1, "seletor");
    await clicar($("[data-os-opcao='sem-os']"));
    online = false;
    await escrever("Preciso de uniforme novo.");
    expect(await comentariosNaFila()).toMatchObject([{ atividadeId: SEM_OS, estado: "pendente", dados: { texto: "Preciso de uniforme novo." } }]);
    await esperarAte(() => balao("uniforme novo")?.getAttribute("data-estado") === "enviando", "enviando");
    expect(etiquetas().at(-1)).toBe("sem-os");
    expect(marcada()).toEqual(["sem-os"]);
    online = true;
    await act(async () => { await motor.sincronizar(true); });
    await esperarAte(() => balao("uniforme novo")?.getAttribute("data-estado") === "enviada", "enviada (✓)");
    expect(enviadas.filter((o) => o.tipo === "comentario").map((o) => o.atividadeId)).toEqual([SEM_OS]);
    expect(pedidos.some((p) => p.includes(`/api/tecnico/atividades/${SEM_OS}`))).toBe(false);
    expect(await comentariosNaFila()).toEqual([]);
    expect($$("[data-mensagem]").filter((m) => texto(m).includes("uniforme novo"))).toHaveLength(1);
  });

  it("recusada pelo servidor: 'Não enviada' com o motivo e 'Tentar de novo', que chama o motor e reenvia (mesmo clientId)", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => marcada().length === 1, "seletor");
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
    const env = enviadas.filter((o) => o.tipo === "comentario");
    expect(env.map((o) => o.atividadeId)).toEqual(["aA", "aA"]); // a recusada e a reenviada
    expect(new Set(env.map((o) => o.dados.clientId)).size).toBe(1);
  });
});

describe("tempo real e contador", () => {
  it("a mensagem nova do escritório aparece na conversa aberta sem tocar em nada, com a etiqueta da OS dela", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "mensagens");
    await esperar(6);
    mensagens = [...mensagens, msg("m9", "Pode fechar a OS.", "Carlos Lima", "2026-11-12T18:00:00.000Z", OS_A)];
    mudarServidor();
    await esperarAte(() => !!balao("Pode fechar a OS."), "chegou");
    expect(etiquetas().at(-1)).toBe("osA");
    expect(texto(balao("Pode fechar a OS.")!.querySelector("[data-autor]"))).toBe("Carlos Lima · escritório");
  });

  async function abrirApp(endereco = "/tecnico", usuario: Record<string, unknown> = USUARIO) {
    window.history.replaceState(null, "", endereco);
    const { AppTecnico } = await import("@/components/tecnico/app-tecnico");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    const perfilInicial = { nome: "João Silva", email: "joao@clima.com", avatar: null, empresaNome: "Clima", perfilNome: null, cargo: "Técnico" };
    await act(async () => { root!.render(createElement(AppTecnico, { usuario: usuario as any, config: CONFIG_APP_PADRAO, perfilInicial })); });
    await esperarAte(() => !!$("[data-nav]"), "app");
  }
  const botoes = () => $$("[data-nav]").map((b) => b.getAttribute("data-nav"));

  it("barra: o Chat com o contador de `naoLidas` do tempo real, em qualquer vista, sem baixar a conversa (que marcaria como lida)", async () => {
    await abrirApp();
    expect(botoes()).toEqual(["dia", "agenda", "chat", "perfil"]);
    const chat = $("[data-nav='chat']")!;
    expect(texto(chat)).toContain("Chat");
    expect(chat.className).toContain("touch-target");
    await esperarAte(() => chat.querySelector("[data-nao-lidas]")?.textContent === "2", "contador");
    expect(chat.querySelector("[data-nao-lidas]")!.getAttribute("aria-label")).toBe("2 mensagens não lidas");
    // Chegou mensagem com o app no Meu dia: o contador acompanha sozinho
    await esperar(6);
    naoLidas = 5;
    mudarServidor();
    await esperarAte(() => chat.querySelector("[data-nao-lidas]")?.textContent === "5", "contador em tempo real");
    expect($("[data-vista]")!.getAttribute("data-vista")).toBe("dia");
    expect(pedidos).not.toContain("GET /api/tecnico/conversas");
    // Abrir o Chat lê (marca como lidas): o contador apaga
    await clicar(chat);
    expect(window.location.search).toBe("?ver=chat");
    expect(chat.getAttribute("aria-current")).toBe("page");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "conversa");
    await esperarAte(() => !chat.querySelector("[data-nao-lidas]"), "contador zerado");
    fechar();
    await abrirApp("/tecnico", { ...USUARIO, desempenho: true });
    expect(botoes()).toEqual(["dia", "agenda", "chat", "desempenho", "perfil"]);
    expect($("[data-nav='dia']")!.parentElement!.className).toContain("grid-cols-5");
  });

  it("o push abre /tecnico?ver=chat direto na conversa (o endereço antigo com &os= também), com o Chat marcado na barra", async () => {
    await abrirApp("/tecnico?ver=chat");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "conversa");
    expect($("[data-nav='chat']")!.getAttribute("aria-current")).toBe("page");
    fechar();
    await abrirApp("/tecnico?ver=chat&os=osA");
    await esperarAte(() => !!$("[data-chat-conversa]") && texto($("[data-chat-titulo]")) === "Escritório", "conversa pelo endereço antigo");
  });
});

describe("sem sinal", () => {
  it("a conversa guardada no aparelho, com o aviso de que é da última sincronização; escrever vai para a fila", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "mensagens");
    expect($("[data-aviso-aparelho]")).toBeNull();
    fechar();
    online = false;
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "conversa guardada");
    expect(texto($("[data-aviso-aparelho]"))).toMatch(/^Sem sinal: conversa da última sincronização \(às \d\d:\d\d\)\.$/);
    expect(etiquetas()).toEqual(["osA", "sem-os", "osB", "osV"]);
    expect(marcada()).toEqual(["osA"]);
    await escrever("Sem sinal aqui.");
    expect(await comentariosNaFila()).toMatchObject([{ atividadeId: "aA", estado: "pendente" }]);
    await esperarAte(() => balao("Sem sinal aqui.")?.getAttribute("data-estado") === "enviando", "enviando");
  });

  it("nunca aberta neste aparelho: diz por quê e deixa escrever (Sem OS)", async () => {
    online = false;
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => !!$("[data-aviso-aparelho]"), "aviso");
    expect(texto($("[data-aviso-aparelho]"))).toBe(MSG_CONVERSA_SEM_SINAL);
    expect(opcoes()).toEqual(["sem-os"]);
    expect(marcada()).toEqual(["sem-os"]);
    await escrever("Chego em 20 minutos.");
    expect(await comentariosNaFila()).toMatchObject([{ atividadeId: SEM_OS }]);
    await esperarAte(() => balao("Chego em 20 minutos.")?.getAttribute("data-estado") === "enviando", "enviando");
  });
});

describe("a etiqueta e a execução da OS", () => {
  it("'Abrir a OS' pela etiqueta leva à execução (a atividade dele no dia); OS sem atividade no aparelho não leva a lugar nenhum", async () => {
    await abrirVistas("/tecnico?ver=chat");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "mensagens");
    const osV = $("[data-etiqueta-os='osV'] button")!;
    expect(osV.getAttribute("title")).toBe("Abrir a OS");
    await clicar(osV);
    expect(window.location.search).toBe("?ver=chat");
    await clicar($("[data-etiqueta-os='osB'] button"));
    expect(window.location.search).toBe("?ver=os&a=aB");
  });

  it("dentro da OS: 'Abrir no Chat' leva à conversa Escritório", async () => {
    await abrirVistas("/tecnico?ver=os&a=aA");
    await esperarAte(() => !!$("[data-abrir-chat]"), "link");
    expect(texto($("[data-abrir-chat]"))).toBe("Abrir no Chat");
    expect($("[data-abrir-chat]")!.className).toContain("touch-target");
    await clicar($("[data-abrir-chat]"));
    expect(window.location.search).toBe("?ver=chat");
    await esperarAte(() => $$("[data-mensagem]").length === 5, "conversa");
  });
});

describe("lerVista / urlDaVista", () => {
  it("ver=chat, ida e volta, com o mesmo endereço do push; o endereço antigo (&os=) abre a mesma conversa", async () => {
    const { lerVista, urlDaVista } = await import("@/components/tecnico/contexto");
    const { urlConversaApp } = await import("@/lib/chat/regras");
    expect(lerVista("?ver=chat")).toEqual({ ver: "chat" });
    expect(lerVista("?ver=chat&os=osA")).toEqual({ ver: "chat" });
    expect(urlDaVista({ ver: "chat" })).toBe("/tecnico?ver=chat");
    expect(urlDaVista({ ver: "chat" })).toBe(urlConversaApp());
    expect(lerVista(new URL(`http://x${urlDaVista({ ver: "chat" })}`).search)).toEqual({ ver: "chat" });
  });
});
