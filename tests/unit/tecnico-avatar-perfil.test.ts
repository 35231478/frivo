// @vitest-environment happy-dom
/**
 * App do técnico — foto de perfil no cabeçalho e Perfil enxuto:
 *  - o topo do app e o cabeçalho do Perfil mostram a FOTO de perfil; sem foto, as INICIAIS (antes era
 *    um ícone vazio); trocar a foto em "Meus dados" atualiza os dois na hora, sem recarregar;
 *  - a foto vem de "Meus dados › Foto de perfil" e, na falta dela, do cadastro do colaborador;
 *  - o card "App de rota" saiu da frente do Perfil: a escolha fica dentro de "Meus dados"
 *    (Preferências), e o botão de rota das OS continua igual.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { PRESETS } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams(),
  redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); },
}));
// "Meus dados" (tela do painel reaproveitada): aqui basta saber a foto que ela recebeu e simular a troca
vi.mock("@/components/perfil/perfil-client", () => ({
  PerfilClient: ({ initial, onAvatar, topoFixo }: { initial: { avatar: string | null }; onAvatar?: (a: string) => void; topoFixo?: boolean }) =>
    createElement("div", { "data-meus-dados": "", "data-foto-inicial": initial.avatar ?? "", "data-topo-fixo": String(topoFixo) },
      createElement("button", { type: "button", "data-trocar-foto": "", onClick: () => onAvatar?.("data:image/jpeg;base64,NOVA") }, "Salvar foto")),
}));

const FOTO = "data:image/jpeg;base64,FOTO-DO-JOAO";
const perfilInicial = { nome: "João Silva", email: "joao@clima.com", avatar: null, empresaNome: "Clima Total", perfilNome: null, cargo: "Técnico" };
const usuario = (extra: Record<string, unknown> = {}) => ({ id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true, ...extra });

let root: Root; let caixa: HTMLDivElement;
beforeAll(async () => { await Promise.all([import("@/components/tecnico/app-tecnico"), import("@/components/tecnico/perfil"), import("@/components/tecnico/rota")]); }, 120_000);
beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tecnico: null, dia: "2026-12-05", atividades: [], anteriores: [] }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); document.body.innerHTML = ""; root = undefined as unknown as Root; vi.unstubAllGlobals(); });

const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg: string) { for (let i = 0; i < 120; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

async function abrirApp(u: Record<string, unknown>, vista = "") {
  window.history.replaceState(null, "", `/tecnico${vista}`);
  const { AppTecnico } = await import("@/components/tecnico/app-tecnico");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(AppTecnico, { usuario: u as any, config: CONFIG_APP_PADRAO, perfilInicial })); });
  await esperarAte(() => !!$("[data-vista]"), "app carregado");
}

describe("topo do app: quem está logado", () => {
  it("com foto de perfil: mostra a FOTO; toca e abre o Perfil; alvo de toque de 44 px", async () => {
    await abrirApp(usuario({ avatar: FOTO }));
    const topo = $("[data-avatar-topo]")!;
    expect(topo.querySelector("img")!.getAttribute("src")).toBe(FOTO);
    expect(topo.querySelector("img")!.getAttribute("alt")).toBe("João Silva");
    expect(topo.getAttribute("aria-label")).toBe("Perfil de João Silva");
    expect(topo.className).toContain("touch-target");
    expect(topo.hasAttribute("data-com-foto")).toBe(true);
    await clicar(topo);
    expect(window.location.search).toBe("?ver=perfil");
    expect($("[data-vista]")!.getAttribute("data-vista")).toBe("perfil");
  });

  it("sem foto: as INICIAIS (primeiro e último nome) — nunca um avatar vazio", async () => {
    await abrirApp(usuario({ avatar: null }));
    const topo = $("[data-avatar-topo]")!;
    expect(topo.querySelector("img")).toBeNull();
    expect(texto(topo)).toBe("JS");
    expect(topo.hasAttribute("data-com-foto")).toBe(false);
  });

  it("iniciais: nome composto usa primeiro + último; um nome só usa as duas primeiras letras; sem a foto no cadastro antigo também", async () => {
    await abrirApp(usuario({ nome: "Carlos Eduardo de Oliveira" })); // `avatar` ausente (página antiga guardada no aparelho)
    expect(texto($("[data-avatar-topo]"))).toBe("CO");
    act(() => root.unmount()); document.body.innerHTML = "";
    await abrirApp(usuario({ nome: "Marina" }));
    expect(texto($("[data-avatar-topo]"))).toBe("MA");
  });

  it("o indicador de sincronização continua no topo, ao lado da foto", async () => {
    await abrirApp(usuario({ avatar: FOTO }));
    const cabecalho = $("header")!;
    expect(cabecalho.querySelector("[data-sync]")).toBeTruthy();
    expect(texto(cabecalho)).toContain("Frivo");
  });
});

describe("Perfil enxuto", () => {
  const secoes = () => $$("[data-vista='perfil'] > *").map((el) => {
    if (el.matches("header")) return "cabeçalho";
    if (el.hasAttribute("data-painel-sync")) return "Sincronização";
    return texto(el).split(" ").slice(0, 3).join(" ");
  });

  it("cabeçalho do Perfil: a mesma foto (ou as iniciais), com nome, e-mail e empresa", async () => {
    await abrirApp(usuario({ avatar: FOTO }), "?ver=perfil");
    expect($("[data-avatar-perfil] img")!.getAttribute("src")).toBe(FOTO);
    expect(texto($("[data-vista='perfil'] header"))).toContain("João Silva");
    expect(texto($("[data-vista='perfil'] header"))).toContain("joao@clima.com · Clima Total");
    act(() => root.unmount()); document.body.innerHTML = "";
    await abrirApp(usuario(), "?ver=perfil");
    expect($("[data-avatar-perfil] img")).toBeNull();
    expect(texto($("[data-avatar-perfil]"))).toBe("JS");
  });

  it("o card 'App de rota' saiu da frente (e o 'Trocar senha' solto também): ficam Sincronização, Checklist do veículo, Meus dados e Sair", async () => {
    await abrirApp(usuario(), "?ver=perfil");
    expect($("[data-preferencia-rota]")).toBeNull();
    expect(texto()).not.toContain("App de rota");
    expect(secoes()).toEqual(["cabeçalho", "Sincronização", "Checklist do veículo", "Meus dados", "Sair"]);
    expect(texto()).not.toContain("Trocar senha"); // a troca de senha vive só em Meus dados › Segurança
  });

  it("a escolha do app de rota está DENTRO de 'Meus dados' (Preferências): mesmas três opções, 44 px, e continua gravando neste aparelho", async () => {
    await abrirApp(usuario(), "?ver=perfil");
    await clicar([...document.querySelectorAll("button")].find((b) => texto(b) === "Meus dados"));
    const pref = $("[data-preferencia-rota]")!;
    expect(pref.closest("section")!.querySelector("[data-meus-dados]")).toBeTruthy(); // dentro da mesma seção, depois dos dados
    expect(texto(pref)).toContain("Preferências");
    expect(texto(pref)).toContain("App que abre em “Rota no mapa”, neste aparelho.");
    const opcoes = [...pref.querySelectorAll("[data-opcao-rota]")] as HTMLElement[];
    expect(opcoes.map((o) => [o.getAttribute("data-opcao-rota"), texto(o), o.className.includes("touch-target")])).toEqual([
      ["perguntar", "Perguntar", true], ["google", "Google Maps", true], ["waze", "Waze", true],
    ]);
    expect(opcoes[0].getAttribute("aria-pressed")).toBe("true"); // padrão: perguntar
    await clicar(opcoes[2]);
    expect(window.localStorage.getItem("frivo:app-rota")).toBe("waze");
    expect(opcoes[2].getAttribute("aria-pressed")).toBe("true");
    await clicar(opcoes[0]);
    expect(window.localStorage.getItem("frivo:app-rota")).toBeNull();
  });

  it("trocar a foto em 'Meus dados' atualiza o topo e o cabeçalho do Perfil NA HORA (sem recarregar)", async () => {
    await abrirApp(usuario({ avatar: FOTO }), "?ver=perfil");
    await clicar([...document.querySelectorAll("button")].find((b) => texto(b) === "Meus dados"));
    expect($("[data-meus-dados]")!.getAttribute("data-foto-inicial")).toBe(FOTO); // "Foto de perfil" abre com a foto atual
    expect($("[data-meus-dados]")!.getAttribute("data-topo-fixo")).toBe("false"); // a faixa de "Meus dados" não gruda por cima do topo do app
    await clicar($("[data-trocar-foto]"));
    expect($("[data-avatar-topo] img")!.getAttribute("src")).toBe("data:image/jpeg;base64,NOVA");
    expect($("[data-avatar-perfil] img")!.getAttribute("src")).toBe("data:image/jpeg;base64,NOVA");
  });

  it("quem não tinha foto e coloca uma: as iniciais dão lugar à foto", async () => {
    await abrirApp(usuario(), "?ver=perfil");
    expect(texto($("[data-avatar-topo]"))).toBe("JS");
    await clicar([...document.querySelectorAll("button")].find((b) => texto(b) === "Meus dados"));
    await clicar($("[data-trocar-foto]"));
    expect($("[data-avatar-topo] img")).toBeTruthy();
    expect(texto($("[data-avatar-topo]"))).toBe("");
  });
});

describe("botão de rota das OS: igual a antes", () => {
  // O link abre o app de mapas: no teste, a navegação em si é barrada (depois de o app tratar o toque)
  const semNavegar = (e: Event) => e.preventDefault();
  beforeEach(() => window.addEventListener("click", semNavegar));
  afterEach(() => window.removeEventListener("click", semNavegar));

  async function montarRota() {
    const { BotaoRota } = await import("@/components/tecnico/rota");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(BotaoRota, { rota: "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5%2C-46.6" })); });
    await esperar();
  }

  it("sem preferência pergunta o app e lembra; o aviso diz onde trocar agora (Perfil › Meus dados)", async () => {
    await montarRota();
    expect(texto($("[data-rota]"))).toBe("Rota no mapa");
    await clicar($("[data-rota]"));
    expect(texto($("[data-escolher-rota]"))).toContain("O app escolhido fica lembrado neste aparelho. Troque em Perfil › Meus dados.");
    await clicar($('[data-abrir-rota="waze"]'));
    expect(window.localStorage.getItem("frivo:app-rota")).toBe("waze");
  });

  it("com a preferência gravada, abre direto no app escolhido", async () => {
    window.localStorage.setItem("frivo:app-rota", "waze");
    await montarRota();
    expect($("[data-rota]")!.getAttribute("data-app-rota")).toBe("waze");
    expect($("[data-rota]")!.getAttribute("href")).toContain("waze.com");
  });
});

describe("de onde vem a foto (página do app)", () => {
  const sessao = vi.hoisted(() => ({ atual: null as any }));
  const banco = vi.hoisted(() => ({ usuario: null as any, tecnico: null as any, consultasTecnico: [] as any[] }));
  const visto = vi.hoisted(() => ({ props: null as any }));
  vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
  vi.mock("@/lib/prisma", () => ({
    prisma: {
      usuario: { findUnique: async () => banco.usuario },
      tecnico: { findFirst: async (q: any) => { banco.consultasTecnico.push(q); return banco.tecnico; } },
      configuracao: { findUnique: async () => null },
    },
  }));

  async function propsDoApp() {
    const { default: Pagina } = await import("@/app/tecnico/page");
    const arvore: any = await Pagina();
    const achar = (n: any): any => (!n || typeof n !== "object" ? null : n.props?.usuario && n.props?.perfilInicial ? n.props : achar(n.props?.children));
    return achar(arvore);
  }
  beforeEach(() => {
    banco.consultasTecnico = [];
    sessao.atual = { user: { id: "uT", name: "João Silva", email: "joao@clima.com", empresaId: "e1", empresaNome: "Clima Total", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1", perfilNome: null } };
  });

  it("a de 'Meus dados › Foto de perfil' vale primeiro", async () => {
    banco.usuario = { avatar: "data:image/jpeg;base64,DO-USUARIO" }; banco.tecnico = { avatar: "data:image/jpeg;base64,DO-CADASTRO" };
    expect((await propsDoApp()).usuario.avatar).toBe("data:image/jpeg;base64,DO-USUARIO");
  });

  it("sem ela, a foto do cadastro do colaborador (da MESMA empresa); sem nenhuma, null → iniciais", async () => {
    banco.usuario = { avatar: null }; banco.tecnico = { avatar: "data:image/jpeg;base64,DO-CADASTRO" };
    const props = await propsDoApp();
    expect(props.usuario.avatar).toBe("data:image/jpeg;base64,DO-CADASTRO");
    expect(banco.consultasTecnico.at(-1).where).toEqual({ id: "t1", empresaId: "e1" });
    expect(props.perfilInicial.avatar).toBeNull(); // uma cópia só da foto na página: "Meus dados" pega do app
    banco.tecnico = { avatar: null };
    expect((await propsDoApp()).usuario.avatar).toBeNull();
  });

  it("usuário sem colaborador ligado: nem consulta o cadastro", async () => {
    sessao.atual.user.tecnicoId = null;
    banco.usuario = { avatar: null }; banco.tecnico = { avatar: "data:image/jpeg;base64,NAO-DEVE-USAR" };
    expect((await propsDoApp()).usuario.avatar).toBeNull();
    expect(banco.consultasTecnico).toEqual([]);
  });
});
