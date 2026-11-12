// @vitest-environment happy-dom
/**
 * Operações › Mapa — a tela da gestão num DOM de verdade. O Leaflet em si (tiles, zoom) é conferido no
 * navegador; aqui o mapa é um substituto que mostra o que RECEBEU, e o teste confere a regra da tela:
 *  - só quem tem posição vai para o mapa; os outros ficam na lista "Sem localização";
 *  - frescor: atual / recente / antiga (cinza, apagada, com o horário);
 *  - o que aparece ao clicar no marcador: nome, OS, "visto às… · há…", coordenadas e bateria — "—"
 *    quando o aparelho não informa;
 *  - rastreamento desligado: mapa vazio e o porquê;
 *  - a chave em Equipes › App do colaborador (desligada por padrão) e o item do menu só para a gestão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { PRESETS, moduloDaRota, montarPermissoes, permissoesTotais, pode, type Permissoes } from "@/lib/permissoes";
import type { OsNoMapa, RespostaMapa, TecnicoNoMapa } from "@/lib/tecnico/posicao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/mapa", useSearchParams: () => new URLSearchParams() }));
// O mapa de verdade (Leaflet) não roda no DOM de teste: o substituto mostra exatamente o que a tela mandou para ele
vi.mock("next/dynamic", () => ({
  default: () => (p: { tecnicos: TecnicoNoMapa[]; selecionado: string | null; enquadrar: number; agora: number }) =>
    createElement("div", { "data-mapa-substituto": "", "data-marcadores": p.tecnicos.map((t) => t.id).join(","), "data-selecionado": p.selecionado ?? "", "data-pedidos-enquadrar": p.enquadrar, "data-agora": p.agora }),
}));

const MIN = 60_000;
const H = 60 * MIN;
const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const ha = (ms: number) => new Date(MEIO_DIA - ms).toISOString();

const OS: OsNoMapa = { osId: "os1", numero: "OS-0101", atividadeId: "a1", titulo: "Preventiva", cliente: "Hospital Santa Luzia", situacao: "EM_ANDAMENTO" };
const tecnico = (id: string, nome: string, idade: number | null, extra: Partial<TecnicoNoMapa> = {}, posicao: Record<string, unknown> = {}): TecnicoNoMapa => ({
  id, nome, os: null,
  posicao: idade === null ? null : { lat: -23.55052, lng: -46.633308, precisaoM: 12, bateria: 82, carregando: false, registradoEm: ha(idade), motivo: "ABRIU_APP", origem: "PWA", ...posicao },
  ...extra,
});
const resposta = (tecnicos: TecnicoNoMapa[], rastreio = true): RespostaMapa => ({ rastreio, tecnicos, geradoEm: new Date(MEIO_DIA).toISOString() });
const EQUIPE = [
  tecnico("tCarlos", "Carlos Oliveira", 5 * MIN, { os: OS }),
  tecnico("tBia", "Bia Reis", 80 * MIN, {}, { bateria: null, carregando: null, precisaoM: null }), // iPhone: sem bateria
  tecnico("tEdu", "Edu Prado", 26 * H, {}, { bateria: 9 }),
  tecnico("tZe", "Zé Lima", null, { os: { ...OS, numero: "OS-0102", situacao: "NO_LOCAL" } }),
  tecnico("tAna", "Ana Dias", null),
];

let root: Root; let caixa: HTMLDivElement;
let fetchFalso: ReturnType<typeof vi.fn>;
let proxima: RespostaMapa | "falha";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  proxima = resposta(EQUIPE);
  fetchFalso = vi.fn(async () => {
    if (proxima === "falha") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(proxima), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.useRealTimers(); });

const $ = <T extends Element = HTMLElement>(s: string) => caixa.querySelector(s) as T | null;
const $$ = (s: string) => [...caixa.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = caixa) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function montar(elemento: React.ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}
async function abrirMapa(inicial: RespostaMapa = resposta(EQUIPE), podeConfigurar = true) {
  const { MapaClient } = await import("@/components/mapa/mapa-client");
  await montar(createElement(MapaClient, { inicial, podeConfigurar }));
}
const mapa = () => $("[data-mapa-substituto]")!;
const linha = (id: string) => $(`[data-tecnico-no-mapa="${id}"]`)!;

/* ═════════════════════════ a tela ═════════════════════════ */
describe("Mapa: última posição conhecida de cada técnico", () => {
  it("só quem tem posição vira marcador; quem nunca enviou fica na lista 'Sem localização', fora do mapa", async () => {
    await abrirMapa();
    expect(texto($("h1"))).toBe("Mapa");
    expect(texto()).toContain("Última posição conhecida de cada técnico. Não é tempo real.");
    expect(mapa().getAttribute("data-marcadores")).toBe("tCarlos,tBia,tEdu"); // do visto há menos tempo para o mais antigo
    expect(texto($("[data-total-no-mapa]"))).toBe("· 3");
    expect($$("[data-tecnico-no-mapa]").map((l) => l.getAttribute("data-tecnico-no-mapa"))).toEqual(["tCarlos", "tBia", "tEdu"]);
    const sem = $("[data-sem-localizacao]")!;
    expect(texto(sem.querySelector("[data-total-sem-localizacao]"))).toBe("· 2");
    expect($$("[data-tecnico-sem-posicao]").map((l) => l.getAttribute("data-tecnico-sem-posicao"))).toEqual(["tAna", "tZe"]); // por nome
    expect(texto(sem)).toContain("Ainda não enviaram posição");
    // quem está sem posição, mas numa OS, mostra a OS
    expect(texto($('[data-tecnico-sem-posicao="tZe"] [data-os-do-tecnico]'))).toBe("No local: OS-0102 · Hospital Santa Luzia");
    expect($('[data-tecnico-sem-posicao="tAna"] [data-os-do-tecnico]')).toBeNull();
    expect(texto($("[data-atualizado-as]"))).toBe("Atualizado às 12:00");
  });

  it("frescor na lista: atual, recente e ANTIGA (apagada, com o dia e a hora) — e a legenda explica as três", async () => {
    await abrirMapa();
    expect([linha("tCarlos"), linha("tBia"), linha("tEdu")].map((l) => l.getAttribute("data-frescor"))).toEqual(["atual", "recente", "antiga"]);
    expect(texto(linha("tCarlos").querySelector("[data-visto]"))).toBe("visto às 11:55 · há 5 min");
    expect(texto(linha("tBia").querySelector("[data-visto]"))).toBe("visto às 10:40 · há 1 h 20 min");
    expect(texto(linha("tEdu").querySelector("[data-visto]"))).toBe("visto em 11/11 às 10:00 · há 1 dia");
    expect(linha("tEdu").className).toContain("opacity-70");
    expect(linha("tCarlos").className).not.toContain("opacity-70");
    expect(texto($("[data-legenda-frescor]"))).toBe("Até 15 min Até 3 h Mais antiga");
    // a OS em execução e a bateria na linha; sem bateria informada = "—"
    expect(texto(linha("tCarlos").querySelector("[data-os-do-tecnico]"))).toBe("Executando OS-0101 · Hospital Santa Luzia");
    expect(texto(linha("tBia"))).toContain("Sem OS em andamento");
    expect([linha("tCarlos"), linha("tBia"), linha("tEdu")].map((l) => texto(l.querySelector("[data-bateria]")))).toEqual(["82%", "—", "9%"]);
    for (const l of $$("[data-tecnico-no-mapa]")) expect(l.className).toContain("touch-target");
  });

  it("escolher um técnico na lista leva o mapa até ele; 'Enquadrar todos' volta a mostrar a equipe", async () => {
    await abrirMapa();
    expect(mapa().getAttribute("data-selecionado")).toBe("");
    await clicar(linha("tBia"));
    expect(mapa().getAttribute("data-selecionado")).toBe("tBia");
    expect(linha("tBia").getAttribute("aria-pressed")).toBe("true");
    const antes = mapa().getAttribute("data-pedidos-enquadrar");
    await clicar($("[data-enquadrar]"));
    expect(mapa().getAttribute("data-selecionado")).toBe("");
    expect(mapa().getAttribute("data-pedidos-enquadrar")).not.toBe(antes);
  });

  it("'Atualizar' busca as posições de novo: quem enviou posição sai da lista 'sem localização' e entra no mapa", async () => {
    await abrirMapa();
    vi.setSystemTime(MEIO_DIA + 3 * MIN);
    proxima = { ...resposta([...EQUIPE.slice(0, 4), tecnico("tAna", "Ana Dias", -2 * MIN)]), geradoEm: new Date(MEIO_DIA + 3 * MIN).toISOString() };
    await clicar($("[data-atualizar-mapa]"));
    expect(fetchFalso).toHaveBeenCalledWith("/api/mapa/posicoes", expect.objectContaining({ cache: "no-store" }));
    expect(mapa().getAttribute("data-marcadores")).toBe("tAna,tCarlos,tBia,tEdu");
    expect($$("[data-tecnico-sem-posicao]").map((l) => l.getAttribute("data-tecnico-sem-posicao"))).toEqual(["tZe"]);
    expect(texto($("[data-atualizado-as]"))).toBe("Atualizado às 12:03");
    expect(texto(linha("tCarlos").querySelector("[data-visto]"))).toBe("visto às 11:55 · há 8 min"); // o relógio andou
  });

  it("sem conexão ao atualizar: fica o que estava na tela, com o horário de quando foi buscado — nada some nem é inventado", async () => {
    await abrirMapa();
    proxima = "falha";
    await clicar($("[data-atualizar-mapa]"));
    expect(mapa().getAttribute("data-marcadores")).toBe("tCarlos,tBia,tEdu");
    expect(texto($("[data-atualizado-as]"))).toBe("Sem conexão · Atualizado às 12:00");
  });

  it("rastreamento LIGADO e ninguém enviou ainda: mapa vazio com a explicação, todos em 'sem localização'", async () => {
    await abrirMapa(resposta([tecnico("tAna", "Ana Dias", null), tecnico("tZe", "Zé Lima", null)]));
    expect(mapa().getAttribute("data-marcadores")).toBe("");
    expect(texto($("[data-sem-posicoes]"))).toBe("Nenhuma posição recebida ainda. Ela chega quando o técnico abre o app.");
    expect($("[data-enquadrar]")).toBeNull();
    expect($("[data-legenda-frescor]")).toBeNull();
    expect($$("[data-tecnico-sem-posicao]")).toHaveLength(2);
    expect($("[data-rastreio-desligado]")).toBeNull();
  });

  it("rastreamento DESLIGADO: mapa vazio e o porquê; o atalho para a configuração só aparece para quem pode mexer nela", async () => {
    await abrirMapa(resposta([], false));
    expect($("[data-mapa-tecnicos]")!.getAttribute("data-rastreio")).toBe("desligado");
    expect(mapa().getAttribute("data-marcadores")).toBe("");
    const aviso = $("[data-rastreio-desligado]")!;
    expect(texto(aviso)).toContain("O rastreamento está desligado");
    expect(texto(aviso)).toContain("Nenhuma posição é capturada.");
    expect($<HTMLAnchorElement>("[data-ir-app-colaborador]")!.getAttribute("href")).toBe("/equipes/app-colaborador");
    expect($("[data-sem-localizacao]")).toBeNull(); // não lista ninguém como "sem localização": não há o que esperar
    expect($("[data-sem-posicoes]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await abrirMapa(resposta([], false), false);
    expect($("[data-ir-app-colaborador]")).toBeNull();
  });
});

/* ═════════════════════════ o marcador ═════════════════════════ */
describe("ao clicar no marcador", () => {
  async function cartao(t: TecnicoNoMapa) {
    const { CartaoPosicao } = await import("@/components/mapa/cartao-posicao");
    await montar(createElement(CartaoPosicao, { nome: t.nome, os: t.os, posicao: t.posicao!, agora: MEIO_DIA }));
    return $("[data-cartao-posicao]")!;
  }

  it("nome, a OS em execução (com o link), 'visto às… · há…', as coordenadas com a precisão e a bateria", async () => {
    const c = await cartao(EQUIPE[0]);
    expect(texto(c.querySelector("[data-nome]"))).toBe("Carlos Oliveira");
    const os = c.querySelector<HTMLAnchorElement>("[data-os-do-tecnico]")!;
    expect(texto(os)).toBe("Executando OS-0101 · Hospital Santa Luzia");
    expect(os.getAttribute("href")).toBe("/ordens/os1");
    expect(texto(c.querySelector("[data-visto]"))).toBe("visto às 11:55 · há 5 min");
    expect(texto(c.querySelector("[data-coordenadas]"))).toBe("-23,550520, -46,633308");
    expect(texto(c.querySelector("[data-precisao]"))).toBe("· ±12 m");
    expect(texto(c.querySelector("[data-bateria]"))).toBe("82%");
    expect(c.getAttribute("data-frescor")).toBe("atual");
    expect(c.querySelector("[data-posicao-antiga]")).toBeNull();
    const maps = c.querySelector<HTMLAnchorElement>("[data-abrir-google-maps]")!;
    expect(maps.href).toBe("https://www.google.com/maps/search/?api=1&query=-23.55052,-46.633308");
    expect([maps.target, maps.rel]).toEqual(["_blank", "noopener noreferrer"]);
  });

  it("iPhone (a web não informa a bateria): 'Bateria: —' — nunca um número; sem precisão, só as coordenadas; sem OS, diz que não há", async () => {
    const c = await cartao(EQUIPE[1]);
    expect(texto(c.querySelector("[data-bateria]"))).toBe("—");
    expect(c.querySelector("[data-precisao]")).toBeNull();
    expect(texto(c.querySelector("[data-sem-os]"))).toBe("Sem OS em andamento");
    expect(texto(c)).not.toMatch(/\d+%/);
  });

  it("posição ANTIGA vem marcada, com o dia e a hora — não parece tempo real; bateria carregando aparece", async () => {
    const c = await cartao(tecnico("tEdu", "Edu Prado", 26 * H, {}, { bateria: 40, carregando: true }));
    expect(c.getAttribute("data-frescor")).toBe("antiga");
    expect(texto(c.querySelector("[data-posicao-antiga]"))).toBe("Posição antiga");
    expect(texto(c.querySelector("[data-visto]"))).toBe("visto em 11/11 às 10:00 · há 1 dia");
    expect(texto(c.querySelector("[data-bateria]"))).toBe("40% · carregando");
  });

  it("técnico que chegou e ainda não começou: 'No local'", async () => {
    const c = await cartao(tecnico("tZe", "Zé Lima", MIN, { os: { ...OS, situacao: "NO_LOCAL" } }));
    expect(texto(c.querySelector("[data-os-do-tecnico]"))).toBe("No local: OS-0101 · Hospital Santa Luzia");
  });
});

/* ═════════════════════════ consentimento ═════════════════════════ */
describe("Equipes › App do colaborador: 'Rastrear localização dos técnicos'", () => {
  const switchDe = (rotulo: string) => ($$("label").find((l) => l.textContent?.includes(rotulo))?.querySelector("button[role=switch]") ?? null) as HTMLButtonElement | null;
  async function abrir(inicial = CONFIG_APP_PADRAO) {
    const { AppColaboradorClient } = await import("@/components/equipes/app-colaborador-client");
    await montar(createElement(AppColaboradorClient, { inicial }));
  }

  it("nasce DESLIGADO, numa seção própria, com o aviso de dado pessoal (LGPD) e de consentimento", async () => {
    await abrir();
    const chave = switchDe("Rastrear localização dos técnicos")!;
    expect(chave.getAttribute("aria-checked")).toBe("false");
    expect($("[data-secao-localizacao]")!.contains(chave)).toBe(true);
    expect(texto($("[data-aviso-lgpd]"))).toBe("Localização é dado pessoal (LGPD). Ligue só depois de informar os colaboradores e ter o consentimento deles.");
    // é outra chave, diferente de "Exigir localização ativa" (a trava do app)
    expect(switchDe("Exigir localização ativa para usar o app")).not.toBe(chave);
  });

  it("ligar e salvar manda app_rastrear_localizacao = true; ligado, a tela avisa que o técnico vê o indicador", async () => {
    await abrir();
    await clicar(switchDe("Rastrear localização dos técnicos"));
    expect(texto($("[data-aviso-lgpd]"))).toContain("o app mostra ao técnico que a localização está sendo compartilhada");
    await clicar($("[data-salvar]"));
    const [url, init] = fetchFalso.mock.calls[0];
    expect([url, init.method]).toEqual(["/api/configuracoes", "PUT"]);
    const corpo = JSON.parse(init.body);
    expect(corpo.appRastrearLocalizacao).toBe(true);
    expect(corpo.appExigirLocalizacao).toBe(false); // a outra chave não foi junto
  });

  it("salvar sem mexer mantém desligado (não liga por engano)", async () => {
    await abrir();
    await clicar($("[data-salvar]"));
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body).appRastrearLocalizacao).toBe(false);
  });
});

/* ═════════════════════════ quem acessa ═════════════════════════ */
describe("só a gestão acessa o Mapa", () => {
  /** O menu com o grupo "Operações" aberto: os links que a pessoa vê nele */
  const operacoes = async (permissoes: Permissoes, role = "OPERADOR") => {
    const { Sidebar } = await import("@/components/layout/sidebar");
    if (root) { act(() => root.unmount()); caixa.remove(); }
    await montar(createElement(Sidebar, { session: { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role, permissoes } } as any }));
    const grupo = $$("button[aria-expanded]").find((b) => texto(b) === "Operações");
    if (grupo && grupo.getAttribute("aria-expanded") !== "true") await clicar(grupo);
    return $$("nav a").map((a) => a.getAttribute("href"));
  };

  it("o item 'Mapa' (Operações) aparece para quem tem Equipes › Gerenciar; técnico, auxiliar, financeiro e quem só visualiza equipes não veem", async () => {
    expect(await operacoes(permissoesTotais())).toEqual(expect.arrayContaining(["/ordens", "/calendario", "/prazos", "/mapa"]));
    expect(await operacoes(PRESETS.SUPERVISOR)).toContain("/mapa");
    expect(await operacoes(montarPermissoes({}), "ADMIN")).toContain("/mapa");
    for (const sem of [PRESETS.TECNICO, PRESETS.AUXILIAR, PRESETS.FINANCEIRO, montarPermissoes({ equipes: ["visualizar"], ordens: ["visualizar"] })]) {
      const links = await operacoes(sem);
      expect(links).toContain("/ordens"); // o grupo abriu: o que falta é só o Mapa
      expect(links).not.toContain("/mapa");
    }
  });

  it("a rota /mapa é do módulo Equipes (o middleware barra quem não o tem) e a página exige 'gerenciar'", () => {
    expect(moduloDaRota("/mapa")).toBe("equipes");
    expect(pode(PRESETS.TECNICO, "equipes", "gerenciar", "TECNICO")).toBe(false);
    expect(pode(PRESETS.SUPERVISOR, "equipes", "gerenciar", "OPERADOR")).toBe(true);
    expect(pode(montarPermissoes({ equipes: ["visualizar"] }), "equipes", "gerenciar", "OPERADOR")).toBe(false);
  });
});
