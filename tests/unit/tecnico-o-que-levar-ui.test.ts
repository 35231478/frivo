// @vitest-environment happy-dom
/**
 * App do técnico — "O que levar" e "Como chegar" num DOM de verdade, com o banco do aparelho de
 * verdade (IndexedDB via fake-indexeddb), o motor de sincronização real e as vistas trocando pela URL.
 *
 *  O QUE LEVAR
 *  - no Meu dia: um bloco fechado com o resumo ("2 materiais para 2 OS"); um toque abre a soma do dia;
 *  - cada OS conta uma vez; OS concluída (no servidor ou no aparelho, ainda a enviar) sai da conta;
 *  - por OS: a marca no card, a lista ao abrir o card e, dentro da OS, recolhida;
 *  - na Agenda: um bloco por dia;
 *  - sem sinal: funciona com o que está no aparelho;
 *  - opção da empresa desligada: nada aparece, mesmo com a lista antiga guardada.
 *
 *  COMO CHEGAR
 *  - abre o app de mapas do aparelho (Google Maps, Waze e, no iPhone, Mapas da Apple);
 *  - sem endereço no cadastro: o botão fica apagado, com o porquê; com os dados do cliente ocultos, não aparece.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CONFIG_APP_PADRAO, type ConfigApp } from "@/lib/tecnico/config-app";
import type { MaterialPrevisto } from "@/lib/tecnico/o-que-levar";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/os/scanner-qr", () => ({ ScannerQR: () => null }));

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const HOJE = "2026-11-12";
const AMANHA = "2026-11-13";
const ROTA = "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5%2C-46.6";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

const filtro = (q: number): MaterialPrevisto => ({ chave: "p:pFiltro|un", descricao: "Filtro G4", unidade: "un", quantidade: q });
const gas = (q: number): MaterialPrevisto => ({ chave: "p:pGas|kg", descricao: "Gás R410A", unidade: "kg", quantidade: q });
const fita = (q: number): MaterialPrevisto => ({ chave: "p:pFita|rl", descricao: "Fita isolante", unidade: "rl", quantidade: q });
const dreno = (q: number): MaterialPrevisto => ({ chave: "d:dreno|m", descricao: "Dreno", unidade: "m", quantidade: q });

let online = true;
let comMateriais = true;
let ajustarCartao: (c: any) => any = (c) => c;
const CARTOES: Record<string, Record<string, unknown>> = {
  aC: { hora: "09:00", cliente: "Padaria Pão Quente", status: "CONCLUIDA", materiais: [fita(3)] },                              // concluída: fora da conta
  aA: { hora: "13:00", cliente: "Hospital Santa Luzia", materiais: [filtro(2), gas(1.5)] },
  aB: { hora: "15:00", cliente: "Escola Viva", status: "EM_ANDAMENTO", materiais: [filtro(1)] },
  aS: { hora: "16:00", cliente: "Hospital Santa Luzia", osId: "os-aA", materiais: [filtro(2), gas(1.5)] },                        // a MESMA OS do aA
  aN: { hora: "17:00", cliente: "Cliente sem endereço", unidade: null, endereco: "", rota: null, materiais: [] },                 // sem endereço no cadastro
  aD: { hora: "10:00", cliente: "Mercado Bom Preço", dia: AMANHA, materiais: [dreno(3)] },
};
const DO_DIA = ["aC", "aA", "aB", "aS", "aN"];
function cartao(id: string): CartaoTela {
  const { materiais, ...resto } = CARTOES[id];
  return ajustarCartao({
    atividadeId: id, osId: `os-${id}`, osNumero: `OS-${id}`, titulo: "Atendimento", tipoOs: null, status: "AGENDADA", prioridade: "NORMAL",
    dataAgendada: null, dia: HOJE, duracaoMin: 60, telefone: null, unidade: "Matriz", endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: ROTA,
    descricao: "Preventiva", equipamentos: 1, atendidos: 0, adicionais: 0, chamado: false, orientacao: "", avisos: {}, ...resto, ...(comMateriais && { materiais }),
  }) as CartaoTela;
}
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = { id: "eqA", titulo: "Split Sala 1", descricao: "Split Sala 1", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } };
function retrato(id: string): RetratoAtividade {
  const c = cartao(id);
  return {
    cartao: c,
    execucao: {
      atividade: { id, titulo: "Atendimento", status: c.status, tipoOs: null }, os: { id: c.osId, numero: c.osNumero, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: c.status === "CONCLUIDA", adicionais: [], avisos: {},
      equipamentos: [{ vinculoId: "v1", feito: false, observacao: null, equipamento: info, itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false }],
      conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 1, mensagem: null },
    },
    equipamentosUnidade: [{ ...info, tipoEquipamentoId: "te1", qr: null }], checklistsPorTipo: {}, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
  } as unknown as RetratoAtividade;
}

const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João Silva" }, dia: HOJE, atividades: DO_DIA.map(cartao), anteriores: [] });
  if (url.startsWith("/api/tecnico/agenda")) return json({ tecnico: { id: "t1", nome: "João Silva" }, dias: [{ dia: HOJE, atividades: [cartao("aA")] }, { dia: AMANHA, atividades: [cartao("aD")] }] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") return json({ resultados: JSON.parse(String(init!.body)).operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
const novoMotor = () => { motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() }); };
const usarAparelho = (ua: string) => Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => ua });
/** O teste confere o link, não sai da página: o toque num link de mapa não vira navegação de verdade (sem rede no teste) */
const naoNavegar = (e: Event) => { if ((e.target as Element | null)?.closest?.("a[target='_blank']")) e.preventDefault(); };

beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/rota"), import("@/components/ui/avisos")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; comMateriais = true; ajustarCartao = (c) => c; fetchFalso.mockClear();
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  usarAparelho(ANDROID);
  window.localStorage.clear();
  banco = await BancoTecnico.abrir("uT");
  novoMotor();
  window.history.replaceState(null, "", "/tecnico");
  window.addEventListener("click", naoNavegar, true);
});
afterEach(() => {
  window.removeEventListener("click", naoNavegar, true);
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = "";
  root = undefined as unknown as Root;
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") {
  for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const card = (id: string) => $(`[data-cartao="${id}"]`);
const linhas = (raiz: Element | null) => [...(raiz?.querySelectorAll("[data-material]") ?? [])].map((l) => `${l.getAttribute("data-material")}|${texto(l.querySelector("[data-material-quantidade]"))}`);
const acoes = (id: string) => [...(card(id)?.querySelectorAll("[data-acoes-cartao] a, [data-acoes-cartao] button") ?? [])].map((b) => texto(b));
const blocoDoDia = () => $("[data-o-que-levar-dia]");

async function abrirApp(config: Partial<ConfigApp> = {}, url = "/tecnico") {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia, Agenda } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { Avisos } = await import("@/components/ui/avisos");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e, camera: v.cam });
    return createElement(v.ver === "agenda" ? Agenda : MeuDia);
  }
  window.history.replaceState(null, "", url);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config: { ...CONFIG_APP_PADRAO, ...config }, motorPronto: motor, children: [createElement(Avisos, { key: "avisos" }), createElement(Vistas, { key: "vistas" })] })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela carregada");
  await esperar();
}
const abrirMeuDia = async (config: Partial<ConfigApp> = {}) => { await abrirApp(config); await esperarAte(() => $$("[data-cartao]").length === DO_DIA.length, "os cards do dia"); await esperar(); };
async function reabrir(config: Partial<ConfigApp> = {}, url = "/tecnico") {
  act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
  novoMotor();
  await abrirApp(config, url);
}

describe("O que levar — Meu dia", () => {
  it("um bloco FECHADO com o resumo do dia; um toque abre a soma — cada OS uma vez, concluída fora", async () => {
    await abrirMeuDia();
    const bloco = blocoDoDia()!;
    expect(bloco).toBeTruthy();
    expect(texto(bloco)).toBe("O que levar hoje2 materiais para 2 OS");
    expect(bloco.getAttribute("data-materiais")).toBe("2");
    expect(bloco.getAttribute("data-os")).toBe("2");
    expect($("[data-abrir-o-que-levar]")!.getAttribute("aria-expanded")).toBe("false");
    expect(bloco.querySelector("[data-lista-materiais]")).toBeNull(); // fechado: a lista não polui o Meu dia
    await clicar($("[data-abrir-o-que-levar]"));
    expect($("[data-abrir-o-que-levar]")!.getAttribute("aria-expanded")).toBe("true");
    // Filtro: 2 (OS do hospital, UMA vez — ela tem duas atividades hoje) + 1 (escola) = 3. A fita da OS concluída não entra
    expect(linhas(blocoDoDia())).toEqual(["Filtro G4|3 un", "Gás R410A|1,5 kg"]);
    expect(texto($("[data-nota-previsao]"))).toBe("Previsão pelo que foi lançado nas OS. O que for usado é registrado na OS.");
    await clicar($("[data-abrir-o-que-levar]"));
    expect(blocoDoDia()!.querySelector("[data-lista-materiais]")).toBeNull();
  });

  it("o bloco vem ANTES dos cards (é o que se lê antes de sair) e não mostra valor nenhum", async () => {
    await abrirMeuDia();
    const ordem = $$("[data-o-que-levar-dia], [data-cartao]").map((e) => (e.hasAttribute("data-o-que-levar-dia") ? "bloco" : "card"));
    expect(ordem[0]).toBe("bloco");
    await clicar($("[data-abrir-o-que-levar]"));
    expect(texto(blocoDoDia())).not.toMatch(/R\$|valor|custo/i);
  });

  it("POR OS: a marca no card (quantos materiais) e, ao abrir o card, a lista daquela OS", async () => {
    await abrirMeuDia();
    expect(card("aA")!.querySelector("[data-materiais-cartao]")?.textContent?.trim()).toBe("2 materiais");
    expect(card("aB")!.querySelector("[data-materiais-cartao]")?.textContent?.trim()).toBe("1 material");
    expect(card("aC")!.querySelector("[data-materiais-cartao]")).toBeNull(); // concluída: não há mais o que levar
    expect(card("aN")!.querySelector("[data-materiais-cartao]")).toBeNull(); // OS sem material previsto
    expect(card("aA")!.querySelector("[data-o-que-levar-os]")).toBeNull();
    await clicar(card("aA")!.querySelector("[data-corpo-cartao]"));
    const daOs = card("aA")!.querySelector("[data-o-que-levar-os]")!;
    expect(daOs.getAttribute("data-o-que-levar-os")).toBe("os-aA");
    expect(texto(daOs.querySelector("h4"))).toBe("O que levar");
    expect(linhas(daOs)).toEqual(["Filtro G4|2 un", "Gás R410A|1,5 kg"]);
    // Card sem material previsto: abre só com a descrição
    await clicar(card("aN")!.querySelector("[data-corpo-cartao]"));
    expect(card("aN")!.querySelector("[data-o-que-levar-os]")).toBeNull();
  });

  it("OS que o técnico já CONCLUIU no aparelho (sem sinal, ainda a enviar) sai da conta do dia", async () => {
    await abrirMeuDia();
    online = false;
    await act(async () => { await motor.registrar([{ tipo: "concluir", atividadeId: "aB", dados: {} } as any]); });
    await esperarAte(() => blocoDoDia()?.getAttribute("data-os") === "1", "a OS concluída no aparelho saiu da conta");
    expect(texto(blocoDoDia())).toBe("O que levar hoje2 materiais para 1 OS");
    await clicar($("[data-abrir-o-que-levar]"));
    expect(linhas(blocoDoDia())).toEqual(["Filtro G4|2 un", "Gás R410A|1,5 kg"]);
  });

  it("SEM SINAL: o que levar vem da lista guardada no aparelho", async () => {
    await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
    online = false;
    await abrirMeuDia();
    expect($("[data-origem='aparelho']")).toBeTruthy();
    expect(texto(blocoDoDia())).toBe("O que levar hoje2 materiais para 2 OS");
    await clicar($("[data-abrir-o-que-levar]"));
    expect(linhas(blocoDoDia())).toEqual(["Filtro G4|3 un", "Gás R410A|1,5 kg"]);
  });

  it("OPÇÃO DA EMPRESA DESLIGADA: nada aparece — nem com a lista antiga (com materiais) ainda guardada no aparelho", async () => {
    await motor.baixarLista("meuDia", "/api/tecnico/meu-dia"); // lista baixada quando a opção estava ligada
    online = false;
    await abrirMeuDia({ oQueLevar: false });
    expect(blocoDoDia()).toBeNull();
    expect($$("[data-materiais-cartao]")).toEqual([]);
    await clicar(card("aA")!.querySelector("[data-corpo-cartao]"));
    expect($("[data-o-que-levar-os]")).toBeNull();
    expect(texto()).not.toMatch(/O que levar|Filtro G4/);
  });

  it("o servidor não mandou material (opção desligada lá, ou lista de uma versão antiga): a tela segue inteira, sem bloco", async () => {
    comMateriais = false;
    await abrirMeuDia();
    expect($$("[data-cartao]")).toHaveLength(DO_DIA.length);
    expect(blocoDoDia()).toBeNull();
    expect($$("[data-materiais-cartao]")).toEqual([]);
  });

  it("dia sem material previsto (só OS sem composição): o bloco não aparece", async () => {
    ajustarCartao = (c) => ({ ...c, ...(c.materiais && { materiais: [] }) });
    await abrirMeuDia();
    expect(blocoDoDia()).toBeNull();
  });
});

describe("O que levar — Agenda e dentro da OS", () => {
  it("AGENDA: um bloco por dia, com o que levar naquele dia", async () => {
    await abrirApp({}, "/tecnico?ver=agenda");
    await esperarAte(() => $$("[data-cartao]").length === 2, "agenda");
    const blocos = $$("[data-o-que-levar-dia]");
    expect(blocos.map((b) => texto(b))).toEqual(["O que levar neste dia2 materiais para 1 OS", "O que levar neste dia1 material para 1 OS"]);
    await clicar(blocos[1].querySelector("[data-abrir-o-que-levar]"));
    expect(linhas($$("[data-o-que-levar-dia]")[1])).toEqual(["Dreno|3 m"]);
    expect(linhas($$("[data-o-que-levar-dia]")[0])).toEqual([]); // o outro dia continua fechado
  });

  it("DENTRO DA OS: recolhido (uma linha com a contagem); um toque mostra os materiais daquela OS", async () => {
    await abrirApp({}, "/tecnico?ver=os&a=aB");
    await esperarAte(() => $("[data-vista]")?.getAttribute("data-vista") === "os" && !!$("[data-o-que-levar-os]"), "OS aberta");
    const daOs = $("[data-o-que-levar-os]")!;
    expect(texto(daOs)).toBe("O que levar · 1 material");
    expect($("[data-abrir-o-que-levar-os]")!.getAttribute("aria-expanded")).toBe("false");
    expect(linhas(daOs)).toEqual([]);
    await clicar($("[data-abrir-o-que-levar-os]"));
    expect(linhas($("[data-o-que-levar-os]"))).toEqual(["Filtro G4|1 un"]);
    // Com a opção desligada, a OS abre sem o bloco
    await reabrir({ oQueLevar: false }, "/tecnico?ver=os&a=aB");
    await esperarAte(() => $("[data-vista]")?.getAttribute("data-vista") === "os", "OS aberta");
    expect($("[data-o-que-levar-os]")).toBeNull();
  });
});

describe("Como chegar — o botão de rota", () => {
  it("o botão se chama 'Como chegar', é um link de verdade para o mapa e pergunta o app na primeira vez", async () => {
    await abrirMeuDia();
    expect(acoes("aA")).toEqual(["Como chegar", "Cheguei", "Avisar que estou a caminho"]);
    const link = card("aA")!.querySelector<HTMLAnchorElement>("[data-rota]")!;
    expect(link.getAttribute("href")).toBe(ROTA);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.className).toContain("touch-target");
    await clicar(link);
    // Android: Google Maps e Waze (o Mapas da Apple não existe nesse aparelho)
    expect($$("[data-abrir-rota]").map((a) => `${a.getAttribute("data-abrir-rota")}|${texto(a)}`)).toEqual(["google|Google Maps", "waze|Waze"]);
    expect($("[data-abrir-rota='waze']")!.getAttribute("href")).toBe("https://waze.com/ul?ll=-23.5%2C-46.6&navigate=yes");
  });

  it("no iPHONE o Mapas da Apple entra na escolha; escolhido, fica lembrado e o botão passa a abrir direto nele", async () => {
    usarAparelho(IPHONE);
    await abrirMeuDia();
    await clicar(card("aA")!.querySelector("[data-rota]"));
    expect($$("[data-abrir-rota]").map((a) => texto(a))).toEqual(["Google Maps", "Waze", "Mapas da Apple"]);
    const apple = $<HTMLAnchorElement>("[data-abrir-rota='apple']")!;
    expect(apple.getAttribute("href")).toBe("https://maps.apple.com/?daddr=-23.5%2C-46.6&dirflg=d");
    await clicar(apple);
    expect(window.localStorage.getItem("frivo:app-rota")).toBe("apple");
    expect($("[data-escolher-rota]")).toBeNull();
    const link = card("aA")!.querySelector<HTMLAnchorElement>("[data-rota]")!;
    expect(link.getAttribute("data-app-rota")).toBe("apple");
    expect(link.getAttribute("href")).toBe("https://maps.apple.com/?daddr=-23.5%2C-46.6&dirflg=d");
  });

  it("'Mapas da Apple' lembrado num aparelho que NÃO é Apple: o botão volta a perguntar (e o link segue sendo o do Google)", async () => {
    window.localStorage.setItem("frivo:app-rota", "apple");
    await abrirMeuDia();
    const link = card("aA")!.querySelector<HTMLAnchorElement>("[data-rota]")!;
    expect(link.getAttribute("data-app-rota")).toBeNull();
    expect(link.getAttribute("href")).toBe(ROTA);
    await clicar(link);
    expect($$("[data-abrir-rota]").map((a) => a.getAttribute("data-abrir-rota"))).toEqual(["google", "waze"]);
  });

  it("SEM ENDEREÇO no cadastro: o botão fica no lugar, apagado, com o porquê — e o 'Cheguei' continua valendo", async () => {
    await abrirMeuDia();
    const semEndereco = card("aN")!.querySelector<HTMLButtonElement>("[data-rota-sem-endereco]")!;
    expect(semEndereco).toBeTruthy();
    expect(semEndereco.disabled).toBe(true);
    expect(texto(semEndereco)).toBe("Como chegarSem endereço no cadastro");
    expect(texto(semEndereco.querySelector("[data-aviso-sem-endereco]"))).toBe("Sem endereço no cadastro");
    expect(card("aN")!.querySelector("[data-rota]")).toBeNull();
    expect(card("aN")!.querySelector("[data-cheguei]")).toBeTruthy();
    // Os cards com endereço não ganham o aviso
    expect(card("aA")!.querySelector("[data-rota-sem-endereco]")).toBeNull();
  });

  it("PRIVACIDADE: com 'Exibir dados do cliente' desligado não há rota nem aviso de endereço (não é falta de cadastro)", async () => {
    await abrirMeuDia({ exibirDadosCliente: false });
    for (const id of DO_DIA) { expect(card(id)!.querySelector("[data-rota]"), id).toBeNull(); expect(card(id)!.querySelector("[data-rota-sem-endereco]"), id).toBeNull(); }
    expect(texto()).not.toMatch(/Como chegar|Sem endereço|Paulista/);
  });

  it("cartão que o servidor já mandou SEM os dados do cliente (chave desligada depois): também não é 'sem endereço'", async () => {
    ajustarCartao = (c) => ({ ...c, cliente: "", unidade: null, endereco: "", rota: null });
    await abrirMeuDia();
    expect($$("[data-rota-sem-endereco]")).toEqual([]);
    expect($$("[data-rota]")).toEqual([]);
  });

  it("DENTRO DA OS: com endereço, 'Como chegar'; sem endereço no cadastro, o botão apagado com o aviso", async () => {
    await abrirApp({}, "/tecnico?ver=os&a=aB");
    await esperarAte(() => $("[data-vista]")?.getAttribute("data-vista") === "os" && !!$("header [data-rota]"), "OS com rota");
    expect(texto($("header [data-rota]"))).toBe("Como chegar");
    expect($("header [data-rota-sem-endereco]")).toBeNull();
    ajustarCartao = (c) => (c.atividadeId === "aB" ? { ...c, endereco: "", rota: null } : c);
    await reabrir({}, "/tecnico?ver=os&a=aB");
    await esperarAte(() => !!$("header [data-rota-sem-endereco]"), "OS sem endereço");
    expect(texto($("header [data-rota-sem-endereco]"))).toBe("Como chegarSem endereço no cadastro");
    expect($("header [data-rota]")).toBeNull();
  });

  it("PERFIL: a preferência do app de rota oferece o Mapas da Apple só em aparelho Apple", async () => {
    const { PreferenciaRota } = await import("@/components/tecnico/rota");
    const montar = async () => {
      caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
      await act(async () => { root.render(createElement(PreferenciaRota)); });
      await esperar(2);
    };
    await montar();
    expect($$("[data-opcao-rota]").map((b) => texto(b))).toEqual(["Perguntar", "Google Maps", "Waze"]);
    expect(texto($("[data-preferencia-rota]"))).toContain("App que abre em “Como chegar”, neste aparelho.");
    act(() => root.unmount()); caixa.remove();
    usarAparelho(IPHONE);
    await montar();
    expect($$("[data-opcao-rota]").map((b) => texto(b))).toEqual(["Perguntar", "Google Maps", "Waze", "Mapas da Apple"]);
    await clicar($("[data-opcao-rota='apple']"));
    expect(window.localStorage.getItem("frivo:app-rota")).toBe("apple");
    expect($("[data-opcao-rota='apple']")!.getAttribute("aria-pressed")).toBe("true");
  });
});
