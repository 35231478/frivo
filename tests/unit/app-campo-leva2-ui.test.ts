// @vitest-environment happy-dom
/**
 * App de campo, leva 2 (PR A) — a TELA num DOM de verdade, com o banco do aparelho e o motor reais:
 *  - garantia: o selo na lista de equipamentos da OS, na tela do equipamento e na ficha do QR;
 *  - comentários: escrever sem sinal (fica no aparelho, sobe sozinho), a resposta do escritório marcada como nova, o
 *    aviso no card do Meu dia que some depois de abrir a OS;
 *  - escritório: o card de comentários na OS (lê, responde; sem OS › Editar, só lê).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { aplicarComentario, type ComentarioTela } from "@/lib/tecnico/comentarios";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
const leitura = vi.hoisted(() => ({ valor: "" }));
vi.mock("@/components/os/scanner-qr", async () => {
  const { createElement: ce } = await import("react");
  return { ScannerQR: ({ onLer }: { onLer: (v: string) => void }) => ce("button", { type: "button", "data-ler-falso": "", onClick: () => onLer(leitura.valor) }, "ler") };
});

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z");
const HOJE = "2026-11-12";
let online = true;
let enviadas: any[] = [];
let comentariosServidor: ComentarioTela[] = [];
const info = (id: string, titulo: string, garantiaAte: string | null) => ({ id, titulo, descricao: titulo, fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" }, garantiaAte });
const EQS = [info("eqA", "Split Sala 1", "2028-03-24T11:00:00.000Z"), info("eqB", "Split Sala 2", "2026-12-01T11:00:00.000Z"), info("eqC", "Split Sala 3", "2025-01-10T11:00:00.000Z"), info("eqD", "Split Sala 4", null)];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const cartao = (): CartaoTela => ({
  atividadeId: "aA", osId: "osA", osNumero: "OS-1", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: HOJE, hora: "09:00",
  duracaoMin: 60, cliente: "Hospital", telefone: null, unidade: "Matriz", endereco: "Av. Paulista", rota: null, descricao: "Preventiva", equipamentos: 4, atendidos: 0, adicionais: 0, avisos: {},
} as CartaoTela);
const retrato = (): RetratoAtividade => ({
  cartao: cartao(),
  execucao: {
    atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "osA", numero: "OS-1", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, adicionais: [], avisos: {}, materiais: [], comentarios: comentariosServidor,
    equipamentos: EQS.map((e) => ({ vinculoId: `v-${e.id}`, feito: false, observacao: null, equipamento: e, itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false })),
    conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null, dispensa: null },
  },
  equipamentosUnidade: EQS.map((e) => ({ ...e, tipoEquipamentoId: "te1", qr: null })), checklistsPorTipo: {}, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
} as unknown as RetratoAtividade);
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João" }, dia: HOJE, atividades: [cartao()], anteriores: [] });
  if (url === "/api/tecnico/catalogo") return json({ produtos: [] });
  if (url.startsWith("/api/tecnico/equipamentos/qr")) return json({ equipamento: { ...EQS[0], cliente: "Hospital", tipo: "Split", garantiaAte: "2028-03-24T11:00:00.000Z" }, atividadeHoje: null, historico: [] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    enviadas.push(...corpo.operacoes);
    for (const o of corpo.operacoes) if (o.tipo === "comentario") {
      comentariosServidor = aplicarComentario(comentariosServidor, o.dados, "2026-11-12T15:05:00.000Z", "João").map((c) => ({ ...c, pendente: undefined, id: c.id ?? `s-${c.clientId}` }));
    }
    return json({ resultados: corpo.operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/qr-equipamento"), import("@/components/os/comentarios-os")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; comentariosServidor = [];
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  window.history.replaceState(null, "", "/tecnico");
  vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = "";
  root = undefined as unknown as Root;
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const USUARIO = { id: "uT", nome: "João", email: "joao@clima.com", empresaNome: "Clima", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") { for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
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
async function abrirApp(endereco = "/tecnico") {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { VistaFichaEquipamento } = await import("@/components/tecnico/qr-equipamento");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e });
    if (v.ver === "equipamento") return createElement(VistaFichaEquipamento, { valor: v.q });
    return createElement(MeuDia);
  }
  window.history.replaceState(null, "", endereco);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, motorPronto: motor, children: createElement(Vistas) })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela");
  await esperar();
}
const fechar = () => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; };

describe("garantia visível", () => {
  it("lista de equipamentos da OS: vigente, vencendo, vencida; sem garantia, nada", async () => {
    await abrirApp("/tecnico?ver=os&a=aA");
    const selo = (id: string) => $(`[data-equip-linha="${id}"] [data-garantia]`);
    expect([selo("eqA")!.getAttribute("data-garantia"), texto(selo("eqA"))]).toEqual(["vigente", "Em garantia até 24/03/2028"]);
    expect([selo("eqB")!.getAttribute("data-garantia"), texto(selo("eqB"))]).toEqual(["vencendo", "Garantia vence em 01/12/2026"]);
    expect([selo("eqC")!.getAttribute("data-garantia"), texto(selo("eqC"))]).toEqual(["vencida", "Garantia vencida em 10/01/2025"]);
    expect(selo("eqD")).toBeNull();
  });
  it("tela do equipamento e ficha do QR", async () => {
    await abrirApp("/tecnico?ver=os&a=aA&e=eqA");
    await esperarAte(() => !!$("[data-concluir-equipamento]"), "equipamento");
    expect(texto($("[data-garantia]"))).toBe("Em garantia até 24/03/2028");
    fechar();
    await abrirApp("/tecnico?ver=equipamento&q=QR-X");
    await esperarAte(() => !!$("[data-ficha]"), "ficha");
    expect(texto($("[data-ficha] [data-garantia]"))).toBe("Em garantia até 24/03/2028");
  });
});

describe("comentários no app", () => {
  it("sem sinal: fica no aparelho (pendente), vai para a fila com o texto; o botão só vale com texto", async () => {
    await abrirApp("/tecnico?ver=os&a=aA");
    online = false;
    expect(($("[data-enviar-comentario]") as HTMLButtonElement).disabled).toBe(true);
    await digitar($("[data-novo-comentario]") as HTMLTextAreaElement, "  Ruído no ventilador.  ");
    await clicar($("[data-enviar-comentario]"));
    const fila = (await banco.fila()).filter((o) => o.tipo === "comentario");
    expect(fila).toHaveLength(1);
    expect((fila[0] as any).dados).toMatchObject({ texto: "Ruído no ventilador.", clientId: expect.any(String) });
    await esperarAte(() => !!$("[data-comentario][data-pendente]"), "pendente na tela");
    expect(texto($("[data-comentario][data-pendente]"))).toContain("Você · no aparelho");
    expect(($("[data-novo-comentario]") as HTMLTextAreaElement).value).toBe("");
    // O sinal volta: sobe sozinho e deixa de ser pendente
    online = true;
    await act(async () => { await motor.sincronizar(true); });
    await esperarAte(() => !$("[data-comentario][data-pendente]") && !!$("[data-comentario]"), "sincronizado");
    expect(enviadas.filter((o) => o.tipo === "comentario")).toHaveLength(1);
  });
  it("resposta do escritório: aviso no card do Meu dia, destaque na OS; depois de abrir, o aviso some", async () => {
    comentariosServidor = [{ id: "c1", clientId: null, texto: "Peça chega amanhã.", autor: "Ana", origem: "ESCRITORIO", criadoEm: "2026-11-12T14:00:00.000Z", meu: false }];
    await abrirApp();
    await act(async () => { await motor.prepararSemSinal(["aA"]); });
    await esperarAte(() => !!$("[data-cartao-comentarios]"), "aviso no card");
    expect(texto($("[data-cartao-comentarios]"))).toBe("1 comentário novo");
    fechar();
    await abrirApp("/tecnico?ver=os&a=aA");
    await esperarAte(() => !!$("[data-comentarios-novos]"), "novo na OS");
    expect(texto($("[data-comentarios-novos]"))).toBe("1 novo");
    expect($("[data-comentario='ESCRITORIO']")!.hasAttribute("data-novo")).toBe(true);
    expect(texto($("[data-comentario='ESCRITORIO']"))).toContain("Ana · escritório");
    fechar();
    await abrirApp();
    await esperar(12);
    expect($("[data-cartao-comentarios]")).toBeNull();
  });
  it("mais de 4: mostra os últimos e 'Ver os N comentários'", async () => {
    comentariosServidor = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, clientId: null, texto: `Msg ${i}`, autor: "Ana", origem: "ESCRITORIO" as const, criadoEm: `2026-11-12T1${i}:00:00.000Z`, meu: false }));
    await abrirApp("/tecnico?ver=os&a=aA");
    expect($$("[data-comentario]").map((e) => texto(e.querySelector("p:last-child")))).toEqual(["Msg 2", "Msg 3", "Msg 4", "Msg 5"]);
    await clicar($("[data-ver-todos-comentarios]"));
    expect($$("[data-comentario]")).toHaveLength(6);
  });
});

describe("escritório: a conversa na OS (CHAT-1: a mesma da tela Conversas)", () => {
  let pedidos: { url: string; metodo: string; corpo: any }[] = [];
  const CONVERSA = { osId: "osA", osNumero: "OS-1", cliente: "Cliente", status: "AGENDADA", tecnicos: ["João Silva"], ultima: null, naoLidas: 0 };
  async function montar(podeResponder = true) {
    pedidos = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      pedidos.push({ url: u, metodo: init?.method ?? "GET", corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (u.startsWith("/api/conversas/novidades")) return new Promise<Response>(() => {}); // o tempo real fica esperando
      if (!init?.method) return json({ conversa: CONVERSA, mensagens: [{ id: "c1", clientId: "k", texto: "Ruído no ventilador.", autor: "João Silva", origem: "APP", criadoEm: "2026-11-12T13:00:00.000Z", meu: false }] });
      const corpo = JSON.parse(String(init.body));
      return json({ mensagem: { id: "c2", clientId: corpo.clientId, texto: corpo.texto, autor: "Ana", origem: "ESCRITORIO", criadoEm: "2026-11-12T15:00:00.000Z", meu: true } }, 201);
    }));
    const { ComentariosOs } = await import("@/components/os/comentarios-os");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(ComentariosOs, { osId: "osA", podeResponder })); });
    await esperarAte(() => !!$("[data-mensagem]"), "lista");
  }
  it("lê (o GET marca como lido) e responde (POST, com o clientId que não deixa duplicar)", async () => {
    await montar();
    expect(pedidos.find((p) => p.url === "/api/conversas/osA")).toEqual({ url: "/api/conversas/osA", metodo: "GET", corpo: null });
    expect(texto($("[data-origem='APP'] [data-autor]"))).toContain("João Silva · app");
    await digitar($("[data-texto-mensagem]") as HTMLTextAreaElement, "Peça chega amanhã.");
    await clicar($("[data-enviar-mensagem]"));
    await esperarAte(() => !!$("[data-origem='ESCRITORIO']"), "resposta na lista");
    expect(pedidos.find((p) => p.metodo === "POST")).toMatchObject({ url: "/api/conversas/osA", metodo: "POST", corpo: { texto: "Peça chega amanhã.", clientId: expect.any(String) } });
  });
  it("sem OS › Editar: só lê", async () => {
    await montar(false);
    expect($("[data-texto-mensagem]")).toBeNull();
    expect($("[data-somente-leitura]")).not.toBeNull();
  });
});
