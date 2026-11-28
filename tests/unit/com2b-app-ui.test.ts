// @vitest-environment happy-dom
/**
 * COM-2B — o app do técnico de verdade (IndexedDB falso, motor de sync, fila), dados fictícios:
 *  - sem sinal, concluir o equipamento faz a comissão dele aparecer NA HORA ("Prevista (aguardando envio)"), na tela
 *    do equipamento e na lista da OS; o incompleto e o não feito não mostram nada;
 *  - o card "Minhas comissões" do Meu dia: o último extrato guardado e o que está aguardando envio;
 *  - o servidor confirmou (retrato novo): "Prevista";
 *  - empresa sem comissão de técnico: nada no app.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CHAVE_TOTAIS, type ComissaoRetrato } from "@/lib/tecnico/comissao";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z");
const HOJE = "2026-11-12";
let online = true;
let comissao: ComissaoRetrato | null = null;
/** O que o servidor já tem como feito e completo (o retrato baixado reflete) */
let feitosNoServidor: string[] = [];
let extrato: unknown = { ativo: true, totais: { prevista: 30, liberada: 105, paga: 0 }, vendas: [] };
const info = (id: string, titulo: string) => ({ id, titulo, descricao: titulo, fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" }, garantiaAte: null });
const EQS = [info("eqA", "Split Sala 1"), info("eqB", "Split Sala 2")];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const cartao = (): CartaoTela => ({
  atividadeId: "aA", osId: "osA", osNumero: "OS-1", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: HOJE, hora: "09:00",
  duracaoMin: 60, cliente: "Hospital Fictício", telefone: null, unidade: "Matriz", endereco: "Av. Fictícia", rota: null, descricao: "Preventiva", equipamentos: 2, atendidos: 0, adicionais: 0, avisos: {},
} as CartaoTela);
const retrato = (): RetratoAtividade => ({
  cartao: cartao(),
  execucao: {
    atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "osA", numero: "OS-1", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, adicionais: [], avisos: {}, materiais: [], comentarios: [],
    equipamentos: EQS.map((e) => ({ vinculoId: `v-${e.id}`, feito: feitosNoServidor.includes(e.id), observacao: null, equipamento: e, itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: feitosNoServidor.includes(e.id) })),
    conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null, dispensa: null },
  },
  equipamentosUnidade: EQS.map((e) => ({ ...e, tipoEquipamentoId: "te1", qr: null })), checklistsPorTipo: {}, cadastro: null, avisoCliente: null,
  comissao, geradoEm: new Date().toISOString(),
} as unknown as RetratoAtividade);
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João" }, dia: HOJE, atividades: [cartao()], anteriores: [] });
  if (url === "/api/tecnico/catalogo") return json({ produtos: [] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  if (url === "/api/perfil/comissoes") return json(extrato);
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    return json({ resultados: corpo.operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true;
  comissao = { porEquipamento: { eqA: 15, eqB: 12.5 }, confirmadas: {} };
  feitosNoServidor = [];
  extrato = { ativo: true, totais: { prevista: 30, liberada: 105, paga: 0 }, vendas: [] };
  localStorage.clear();
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

const USUARIO = { id: "uT", nome: "João", email: "joao@ficticio.test", empresaNome: "Clima Fictícia", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") { for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** O rótulo e o valor de um total do card (dois spans) */
const total = (chave: string) => [...($(`[data-total-comissao='${chave}']`)?.children ?? [])].map((c) => texto(c));
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function abrirApp(endereco = "/tecnico") {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e });
    return createElement(MeuDia);
  }
  window.history.replaceState(null, "", endereco);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, motorPronto: motor, children: createElement(Vistas) })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela");
  await esperar();
}
const irPara = async (url: string) => {
  const { irPara: ir, lerVista } = await import("@/components/tecnico/contexto");
  await act(async () => { ir(lerVista(new URL(url, "http://x").search)); });
  await esperar(10);
};

describe("COM-2B — a comissão ao vivo no app", () => {
  it("sem sinal: concluir o equipamento mostra a comissão dele NA HORA (aguardando envio), na tela do equipamento e na lista da OS", async () => {
    await abrirApp("/tecnico?ver=os&a=aA");
    // nada feito: nenhuma comissão
    expect($("[data-comissao-equip]")).toBeNull();
    online = false;
    await clicar($("[data-equip-linha='eqA']"));
    await esperarAte(() => !!$("[data-concluir-equipamento]"), "equipamento");
    expect($("[data-comissao-equip]")).toBeNull();
    await clicar($("[data-concluir-equipamento]"));
    await esperar(10);
    // foi para o próximo (eqB): na volta à OS, o eqA mostra a comissão
    await irPara("/tecnico?ver=os&a=aA");
    await esperarAte(() => !!$("[data-comissao-equip='eqA']"), "comissão na lista");
    const chip = $("[data-comissao-equip='eqA']")!;
    expect(chip.getAttribute("data-situacao-comissao")).toBe("AGUARDANDO_ENVIO");
    expect(texto(chip)).toBe("R$ 15,00 · Prevista (aguardando envio)");
    expect(chip.className).toContain("anim-comissao");
    expect($("[data-comissao-equip='eqB']")).toBeNull();
    // na tela do equipamento, também
    await irPara("/tecnico?ver=os&a=aA&e=eqA");
    await esperarAte(() => !!$("header [data-comissao-equip='eqA']"), "comissão no equipamento");
    expect(texto($("header [data-comissao-equip='eqA']"))).toBe("Sua comissão: R$ 15,00 · Prevista (aguardando envio)");
  });

  it("o card do Meu dia: o último extrato guardado (sem sinal) e o que está aguardando envio; tocar abre o Perfil", async () => {
    // com sinal, o card busca e guarda o extrato
    await abrirApp("/tecnico");
    await esperarAte(() => !!$("[data-comissoes-dia]"), "card");
    expect(total("prevista")).toEqual(["Prevista", "R$ 30,00"]);
    expect(total("liberada")).toEqual(["A receber", "R$ 105,00"]);
    expect(total("paga")).toEqual(["Paga", "R$ 0,00"]);
    expect(JSON.parse(localStorage.getItem(CHAVE_TOTAIS)!)).toMatchObject({ ativo: true, prevista: 30, liberada: 105 });
    expect($("[data-aguardando-envio]")).toBeNull();
    // sem sinal: conclui o eqB e volta ao Meu dia — o card soma o aguardando envio
    await irPara("/tecnico?ver=os&a=aA&e=eqB");
    online = false;
    await esperarAte(() => !!$("[data-concluir-equipamento]"), "equipamento");
    await clicar($("[data-concluir-equipamento]"));
    await irPara("/tecnico");
    await esperarAte(() => !!$("[data-aguardando-envio]"), "aguardando no card");
    expect(texto($("[data-aguardando-envio]"))).toBe("+ R$ 12,50 prevista (aguardando envio)");
    expect(total("prevista")).toEqual(["Prevista", "R$ 30,00"]); // o guardado, sem sinal
    await clicar($("[data-comissoes-dia]"));
    expect(window.location.search).toBe("?ver=perfil&sec=comissoes"); // janeiro: o Perfil abre com a seção aberta
  });

  it("o extrato só é buscado de novo depois de 5 minutos (o Meu dia abre muitas vezes)", async () => {
    localStorage.setItem(CHAVE_TOTAIS, JSON.stringify({ ativo: true, prevista: 1, liberada: 2, paga: 3, em: new Date(MEIO_DIA - 60_000).toISOString() }));
    fetchFalso.mockClear();
    await abrirApp("/tecnico");
    await esperarAte(() => !!$("[data-comissoes-dia]"), "card");
    expect(fetchFalso.mock.calls.some(([u]) => u === "/api/perfil/comissoes")).toBe(false);
    expect(total("paga")).toEqual(["Paga", "R$ 3,00"]);
  });

  it("o servidor confirmou (retrato novo, com o equipamento feito lá): 'Prevista'", async () => {
    comissao = { porEquipamento: { eqA: 15, eqB: 12.5 }, confirmadas: { eqA: 15 } };
    feitosNoServidor = ["eqA"];
    await abrirApp("/tecnico?ver=os&a=aA");
    await esperarAte(() => !!$("[data-comissao-equip='eqA']"), "comissão");
    expect($("[data-comissao-equip='eqA']")!.getAttribute("data-situacao-comissao")).toBe("PREVISTA");
    expect(texto($("[data-comissao-equip='eqA']"))).toBe("R$ 15,00 · Prevista");
  });

  it("empresa sem comissão de técnico: nada no app (nem chip, nem card)", async () => {
    comissao = null;
    extrato = { ativo: false, vendas: [], totais: { prevista: 0, liberada: 0, paga: 0 } };
    await abrirApp("/tecnico?ver=os&a=aA&e=eqA");
    await esperarAte(() => !!$("[data-concluir-equipamento]"), "equipamento");
    await clicar($("[data-concluir-equipamento]"));
    await irPara("/tecnico?ver=os&a=aA");
    expect($("[data-comissao-equip]")).toBeNull();
    await irPara("/tecnico");
    await esperar(10);
    expect($("[data-comissoes-dia]")).toBeNull();
  });
});
