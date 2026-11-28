// @vitest-environment happy-dom
/**
 * CHAT-1 — as telas do escritório (happy-dom; o servidor simulado):
 *  - a conversa: balões meus à direita e dos outros à esquerda (com o nome), o separador de dia, o estado da minha
 *    mensagem (enviando, ✓, ✓✓ com quem leu na dica, não enviada com "Tentar de novo"), a foto que amplia, Enter envia,
 *    a foto escolhida aparece antes de enviar, só leitura e sem permissão sem a caixa de escrever;
 *  - a conversa do escritório: envia na hora ("Enviando…" → a do servidor), falha de rede fica "Não enviada" e tentar
 *    de novo reenvia o MESMO clientId (não duplica), recusa (OS cancelada) volta à caixa; o tempo real recarrega;
 *  - a tela Conversas: lista com nº, cliente, técnicos, última, hora e não lidas; "Não lidas"; a busca vai ao servidor e
 *    oferece começar conversa; tocar abre a conversa e põe ?os= no endereço; no celular, a lista some e há "voltar";
 *  - o ícone do topo com as conversas por ler; a OS mostra a mesma conversa com o link para a tela de conversas;
 *  - a visão POR PESSOA: a chave Pessoas | OS, a lista de técnicos, a etiqueta da OS que agrupa, o seletor de OS e o envio com e sem OS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const tempoReal = vi.hoisted(() => ({ ouvintes: [] as ((r: any) => void)[] }));
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
const foto = vi.hoisted(() => ({ resultado: { ok: true, foto: "data:image/jpeg;base64,Rk9UTw==", miniatura: "data:image/jpeg;base64,TUlOSQ==" } as any }));
vi.mock("@/components/chat/use-novidades", async () => {
  const React = await import("react");
  return {
    // como o de verdade: assina uma vez por montagem (sem abrir conexão: o teste dispara as novidades)
    useNovidades: (_url: string, cb: (r: any) => void) => {
      const ref = React.useRef(cb);
      ref.current = cb;
      React.useEffect(() => {
        const o = (r: any) => ref.current(r);
        tempoReal.ouvintes.push(o);
        return () => { tempoReal.ouvintes = tempoReal.ouvintes.filter((x) => x !== o); };
      }, []);
    },
    avisarNovidades: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => createElement("a", { href, ...p }, children) }));
vi.mock("@/lib/ui/sino", () => ({ atualizarSino: vi.fn() }));
vi.mock("@/lib/chat/foto-cliente", () => ({ prepararFoto: vi.fn(async () => foto.resultado) }));

let root: Root | undefined;
let chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, (() => Response) | { status: number; corpo: unknown }> = {};
beforeEach(() => {
  chamadas = []; respostas = {}; tempoReal.ouvintes = []; nav.replace.mockClear();
  foto.resultado = { ok: true, foto: "data:image/jpeg;base64,Rk9UTw==", miniatura: "data:image/jpeg;base64,TUlOSQ==" };
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
async function clicar(el: Element | null) { await act(async () => { (el as HTMLElement).click(); }); await esperar(); }
async function digitar(el: Element | null, valor: string) {
  const e = el as HTMLTextAreaElement | HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), "value")!.set!;
  await act(async () => { set.call(e, valor); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}

const HOJE = new Date().toISOString();
const msg = (over: Partial<ComentarioTela>): ComentarioTela => ({ id: "m", clientId: "m", texto: "Oi", autor: "Carlos Oliveira", origem: "APP", criadoEm: HOJE, meu: false, ...over });
const MENSAGENS: ComentarioTela[] = [
  msg({ id: "a", clientId: "a", texto: "Cheguei no cliente.", criadoEm: "2026-11-20T13:00:00.000Z", atividade: "Visita técnica" }),
  msg({ id: "b", clientId: "b", texto: "Dreno entupido", foto: { id: "f1", miniatura: "data:image/jpeg;base64,TUlOSQ==" } }),
  msg({ id: "c", clientId: "c", texto: "Liberado.", autor: "Ana", origem: "ESCRITORIO", meu: true, lida: { por: "Carlos Oliveira", em: HOJE } }),
  msg({ id: "d", clientId: "d", texto: "Ainda não lida", autor: "Ana", origem: "ESCRITORIO", meu: true }),
];
const CONVERSA = { osId: "os1", osNumero: "OS-2026-0314", cliente: "Bom Preço", status: "AGENDADA", tecnicos: ["Carlos Oliveira"], ultima: null, naoLidas: 0 };

describe("a conversa (o mesmo componente no escritório e no app)", () => {
  async function conversa(props: Record<string, unknown> = {}) {
    const { ConversaChat } = await import("@/components/chat/conversa");
    const onEnviar = vi.fn(async () => null);
    await montar(createElement(ConversaChat, { mensagens: MENSAGENS, onEnviar, urlFoto: (id: string) => `/api/conversas/fotos/${id}`, ...props }));
    return onEnviar;
  }

  it("balões: os meus à direita, os dos outros com o nome e de onde escreveu; separador de dia; ✓ e ✓✓ (quem leu na dica)", async () => {
    await conversa();
    expect($$("[data-dia]").map(txt)).toEqual(["20/11/2026", "Hoje"]);
    expect($$("[data-mensagem]").map((m) => m.hasAttribute("data-minha"))).toEqual([false, false, true, true]);
    expect(txt($("[data-mensagem='a'] [data-autor]"))).toBe("Carlos Oliveira · Visita técnica");
    expect($("[data-mensagem='c'] [data-estado-icone]")!.getAttribute("data-estado-icone")).toBe("lida");
    expect($("[data-mensagem='c'] [data-estado-icone]")!.getAttribute("title")).toMatch(/^Lida por Carlos Oliveira às \d{2}:\d{2}$/);
    expect($("[data-mensagem='d'] [data-estado-icone]")!.getAttribute("data-estado-icone")).toBe("enviada");
    expect($("[data-mensagem='a'] [data-estado-icone]")).toBeNull(); // dos outros não há ✓
    expect(txt(document.body)).not.toMatch(/você/i);
  });

  it("a foto: miniatura no balão; tocar amplia (a foto inteira pelo endereço)", async () => {
    await conversa();
    expect($("[data-mensagem='b'] [data-foto-mensagem] img")!.getAttribute("src")).toMatch(/^data:image/);
    await clicar($("[data-mensagem='b'] [data-foto-mensagem]"));
    expect(document.querySelector("img[src='/api/conversas/fotos/f1']")).not.toBeNull();
  });

  it("enviando e não enviada: o relógio; a recusa com o motivo e \"Tentar de novo\"", async () => {
    const tentar = vi.fn();
    await conversa({ mensagens: [msg({ id: null, clientId: "p", meu: true, pendente: true }), msg({ id: null, clientId: "x", meu: true, falhou: "Sem conexão" })], onTentarDeNovo: tentar });
    expect($("[data-mensagem='p']")!.getAttribute("data-estado")).toBe("enviando");
    expect(txt($("[data-mensagem='x'] [data-falhou]"))).toBe("Não enviada");
    await clicar($("[data-mensagem='x'] [data-tentar-de-novo]"));
    expect(tentar).toHaveBeenCalledWith(expect.objectContaining({ clientId: "x" }));
  });

  it("escrever: vazio não envia; Enter envia (Shift+Enter não); a foto escolhida aparece antes de enviar e vai junto", async () => {
    const onEnviar = await conversa();
    expect(($("[data-enviar-mensagem]") as HTMLButtonElement).disabled).toBe(true);
    await digitar($("[data-texto-mensagem]"), "Pode desobstruir");
    await act(async () => { $("[data-texto-mensagem]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })); });
    expect(onEnviar).not.toHaveBeenCalled();
    await act(async () => { $("[data-texto-mensagem]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await esperar();
    expect(onEnviar).toHaveBeenCalledWith({ texto: "Pode desobstruir" }, undefined);
    // foto
    const input = $("[data-input-foto]") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "f.jpg", { type: "image/jpeg" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    expect($("[data-foto-escolhida] img")!.getAttribute("src")).toBe(foto.resultado.miniatura);
    await clicar($("[data-enviar-mensagem]"));
    expect(onEnviar).toHaveBeenLastCalledWith({ texto: "", foto: foto.resultado.foto, miniatura: foto.resultado.miniatura }, undefined);
    expect($("[data-foto-escolhida]")).toBeNull();
  });

  it("foto que não dá: o aviso com o limite, sem enviar", async () => {
    foto.resultado = { ok: false, erro: "A foto passa de 1,5 MB mesmo reduzida. Tire outra ou escolha uma menor." };
    const onEnviar = await conversa();
    const input = $("[data-input-foto]") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "f.jpg", { type: "image/jpeg" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    expect(txt($("[data-aviso-chat]"))).toMatch(/1,5 MB/);
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("só leitura (OS cancelada) e sem permissão: sem a caixa de escrever, com o motivo", async () => {
    await conversa({ somenteLeitura: "OS cancelada: a conversa fica só para leitura." });
    expect($("[data-escrever]")).toBeNull();
    expect(txt($("[data-somente-leitura]"))).toBe("OS cancelada: a conversa fica só para leitura.");
    act(() => root!.unmount()); root = undefined;
    await conversa({ podeEscrever: false, semPermissao: "Para escrever nesta conversa é preciso poder editar a OS." });
    expect(txt($("[data-somente-leitura]"))).toMatch(/editar a OS/);
  });
});

describe("a conversa do escritório", () => {
  async function abrir(mensagens = MENSAGENS.slice(0, 1), status = "AGENDADA") {
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: { ...CONVERSA, status }, mensagens } };
    const { ConversaEscritorio } = await import("@/components/chat/conversa-escritorio");
    await montar(createElement(ConversaEscritorio, { alvo: { tipo: "os", osId: "os1" }, podeEscrever: true }));
  }

  it("envia na hora: \"Enviando…\" e depois a do servidor; o corpo leva um clientId", async () => {
    await abrir();
    let liberar!: () => void;
    respostas["POST /api/conversas/os1"] = () => { const r = new Response(JSON.stringify({ mensagem: msg({ id: "s1", clientId: chamadas.at(-1)!.corpo.clientId, texto: "Ok", meu: true }) }), { status: 201 }); return r; };
    void liberar;
    await digitar($("[data-texto-mensagem]"), "Ok");
    await clicar($("[data-enviar-mensagem]"));
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.corpo).toMatchObject({ texto: "Ok", clientId: expect.stringMatching(/^[a-z0-9]{8,}$/i) });
    expect($$("[data-mensagem]").map((m) => m.getAttribute("data-estado"))).toEqual([null, "enviada"]);
  });

  it("falha de rede: fica \"Não enviada\"; tentar de novo reenvia o MESMO clientId", async () => {
    await abrir();
    respostas["POST /api/conversas/os1"] = () => { throw new Error("rede"); };
    await digitar($("[data-texto-mensagem]"), "Sem sinal");
    await clicar($("[data-enviar-mensagem]"));
    expect($$("[data-mensagem][data-estado='falhou']")).toHaveLength(1);
    const primeiro = chamadas.find((c) => c.metodo === "POST")!.corpo.clientId;
    respostas["POST /api/conversas/os1"] = { status: 201, corpo: { mensagem: msg({ id: "s2", clientId: primeiro, texto: "Sem sinal", meu: true }) } };
    await clicar($("[data-tentar-de-novo]"));
    const posts = chamadas.filter((c) => c.metodo === "POST");
    expect(posts.map((p) => p.corpo.clientId)).toEqual([primeiro, primeiro]);
    expect($$("[data-mensagem][data-estado='falhou']")).toHaveLength(0);
  });

  it("recusa (OS cancelada agora): o motivo volta para a caixa e o balão sai", async () => {
    await abrir();
    respostas["POST /api/conversas/os1"] = { status: 409, corpo: { erro: "OS cancelada: a conversa fica só para leitura." } };
    await digitar($("[data-texto-mensagem]"), "Oi");
    await clicar($("[data-enviar-mensagem]"));
    expect(txt($("[data-aviso-chat]"))).toBe("OS cancelada: a conversa fica só para leitura.");
    expect($$("[data-mensagem]")).toHaveLength(1);
  });

  it("OS cancelada ao abrir: só leitura; o tempo real recarrega a conversa quando muda", async () => {
    await abrir(MENSAGENS.slice(0, 1), "CANCELADA");
    expect($("[data-escrever]")).toBeNull();
    const antes = chamadas.filter((c) => c.url === "/api/conversas/os1").length;
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: CONVERSA, mensagens: MENSAGENS.slice(0, 2) } };
    await act(async () => { tempoReal.ouvintes.forEach((o) => o({ marca: "2.0", mudou: true })); });
    await esperar();
    expect(chamadas.filter((c) => c.url === "/api/conversas/os1").length).toBe(antes + 1);
    expect($$("[data-mensagem]")).toHaveLength(2);
    // sem mudança, não recarrega
    await act(async () => { tempoReal.ouvintes.forEach((o) => o({ marca: "2.0", mudou: false })); });
    expect(chamadas.filter((c) => c.url === "/api/conversas/os1").length).toBe(antes + 1);
  });
});

describe("a tela Conversas", () => {
  const LISTA = [
    { ...CONVERSA, ultima: { texto: "A unidade da sala 3 está com o dreno entupido.", autor: "Carlos Oliveira", criadoEm: HOJE, minha: false, foto: false }, naoLidas: 2 },
    { ...CONVERSA, osId: "os2", osNumero: "OS-2026-0315", cliente: "Padaria Sol", ultima: { texto: "Combinado.", autor: "Ana", criadoEm: "2026-11-02T12:00:00.000Z", minha: true, foto: false }, naoLidas: 0 },
  ];
  async function tela(osInicial: string | null = null) {
    respostas["GET /api/conversas"] = { status: 200, corpo: { conversas: LISTA, semConversa: [], naoLidas: 1 } };
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: LISTA[0], mensagens: MENSAGENS.slice(0, 1) } };
    const { ConversasEscritorio } = await import("@/components/chat/conversas-escritorio");
    // sem "Conversas": só a visão por OS (como era)
    await montar(createElement(ConversasEscritorio, { osInicial, pessoaInicial: null, podeEscrever: true, podeConversas: false, podeEnviarConversas: false }));
  }

  it("a lista: nº, cliente, técnicos, a última (com quem escreveu), a hora e o contador de não lidas", async () => {
    await tela();
    const [a, b] = $$("[data-conversa-item]");
    for (const parte of ["OS-2026-0314 · Bom Preço", "Carlos Oliveira", "Carlos:", "A unidade da sala 3 está com o dreno entupido."]) expect(txt(a)).toContain(parte);
    expect(txt(a)).toMatch(/\d{2}:\d{2}/);
    expect(txt(a.querySelector("[data-nao-lidas]"))).toBe("2");
    expect(a.querySelector("[data-nao-lidas]")!.getAttribute("aria-label")).toBe("2 mensagens não lidas");
    expect(txt(b)).toMatch(/02\/11/);
    expect(b.querySelector("[data-nao-lidas]")).toBeNull();
    expect($("[data-nenhuma-aberta]")).not.toBeNull();
  });

  it("\"Não lidas\" deixa só as com contador; a busca vai ao servidor e oferece começar conversa nas OS sem conversa", async () => {
    await tela();
    await clicar($("[data-filtro-conversas='nao-lidas']"));
    expect($$("[data-conversa-item]").map((e) => e.getAttribute("data-conversa-item"))).toEqual(["os1"]);
    await clicar($("[data-filtro-conversas='todas']"));
    respostas["GET /api/conversas?busca=0316"] = { status: 200, corpo: { conversas: [], semConversa: [{ osId: "os9", osNumero: "OS-2026-0316", cliente: "Mercado Azul" }] } };
    await digitar($("[data-busca-conversas]"), "0316");
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    await esperar();
    expect(chamadas.some((c) => c.url === "/api/conversas?busca=0316")).toBe(true);
    expect(txt($("[data-comecar-conversa='os9']"))).toBe("OS-2026-0316 · Mercado Azul");
  });

  it("tocar abre a conversa (e põe ?os= no endereço); no celular a lista some e há \"voltar\"", async () => {
    await tela();
    await clicar($("[data-conversa-item='os1']"));
    expect(nav.replace).toHaveBeenCalledWith("/conversas?os=os1", { scroll: false });
    expect($("[data-conversa-aberta='os:os1']")).not.toBeNull();
    expect($("[data-lista-conversas]")!.className).toMatch(/hidden lg:flex/);
    expect(txt($("[data-link-os]"))).toBe("OS-2026-0314 · Bom Preço");
    await clicar($("[data-voltar-conversas]"));
    expect(nav.replace).toHaveBeenLastCalledWith("/conversas", { scroll: false });
    expect($("[data-conversa-aberta]")).toBeNull();
  });

  it("aberta pelo endereço (push e sino): já abre a conversa e zera o contador dela", async () => {
    await tela("os1");
    expect($("[data-conversa-aberta='os:os1']")).not.toBeNull();
    expect($("[data-conversa-item='os1'] [data-nao-lidas]")).toBeNull();
  });
});

describe("o ícone do topo e a OS", () => {
  it("o ícone mostra as conversas por ler (do tempo real) e leva a Conversas", async () => {
    const { IconeConversas } = await import("@/components/chat/icone-conversas");
    await montar(createElement(IconeConversas));
    expect($("[data-icone-conversas]")!.getAttribute("href")).toBe("/conversas");
    expect(txt($("[data-icone-conversas]"))).toBe("");
    await act(async () => { tempoReal.ouvintes.forEach((o) => o({ marca: "1.0", mudou: false, naoLidas: 3 })); });
    expect(txt($("[data-icone-conversas]"))).toBe("3");
    expect($("[data-icone-conversas]")!.getAttribute("aria-label")).toBe("Conversas: 3 conversas por ler");
  });

  it("a OS mostra a mesma conversa, com o link para a tela de conversas", async () => {
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: CONVERSA, mensagens: MENSAGENS.slice(0, 2) } };
    const { ComentariosOs } = await import("@/components/os/comentarios-os");
    await montar(createElement(ComentariosOs, { osId: "os1", podeResponder: false }));
    expect($("[data-abrir-em-conversas]")!.getAttribute("href")).toBe("/conversas?os=os1");
    expect($$("[data-mensagem]")).toHaveLength(2);
    expect($("[data-escrever]")).toBeNull();
  });
});

describe("a tela Conversas por PESSOA (o desenho aprovado)", () => {
  const OS1 = { id: "os1", numero: "OS-2026-0314", cliente: "Bom Preço" };
  const OS2 = { id: "os2", numero: "OS-2026-0315", cliente: "Padaria Sol" };
  const PESSOAS = [
    { usuarioId: "uM", tecnicoId: "tM", nome: "Maria Souza", avatar: null, naoLidas: 0, ultima: { texto: "Ok", autor: "Maria Souza", criadoEm: "2026-11-02T12:00:00.000Z", minha: false, foto: false, osNumero: null } },
    { usuarioId: "uC", tecnicoId: "tC", nome: "Carlos Oliveira", avatar: null, naoLidas: 2, ultima: { texto: "Dreno entupido", autor: "Carlos Oliveira", criadoEm: HOJE, minha: false, foto: false, osNumero: "OS-2026-0314" } },
  ];
  const DA_PESSOA = [
    msg({ id: "a", clientId: "a", texto: "Cheguei.", os: OS1 }),
    msg({ id: "b", clientId: "b", texto: "Dreno entupido.", os: OS1 }),
    msg({ id: "c", clientId: "c", texto: "Chego em 10 minutos.", os: null }),
    msg({ id: "d", clientId: "d", texto: "Pode desobstruir.", autor: "Ana", origem: "ESCRITORIO", meu: true, os: OS2, para: "Carlos Oliveira" }),
  ];
  const DO_DIA = [{ osId: "os1", numero: OS1.numero, cliente: OS1.cliente, emAndamento: true }, { osId: "os2", numero: OS2.numero, cliente: OS2.cliente, emAndamento: false }];
  async function tela(pessoaInicial: string | null = null) {
    respostas["GET /api/conversas/pessoas"] = { status: 200, corpo: { pessoas: PESSOAS, naoLidas: 1 } };
    respostas["GET /api/conversas/pessoas/uC"] = { status: 200, corpo: { pessoa: { usuarioId: "uC", nome: "Carlos Oliveira", avatar: null }, mensagens: DA_PESSOA, osDoDia: DO_DIA, osPadrao: "os1" } };
    respostas["GET /api/conversas"] = { status: 200, corpo: { conversas: [], semConversa: [], naoLidas: 0 } };
    const { ConversasEscritorio } = await import("@/components/chat/conversas-escritorio");
    await montar(createElement(ConversasEscritorio, { osInicial: null, pessoaInicial, podeEscrever: true, podeConversas: true, podeEnviarConversas: true }));
  }

  it("com \"Conversas\", abre em Pessoas: a lista de técnicos (iniciais, nome, a OS da última, não lidas); a chave troca para OS", async () => {
    await tela();
    expect($("[data-visao-chave='pessoas']")!.getAttribute("aria-selected")).toBe("true");
    expect(chamadas[0].url).toBe("/api/conversas/pessoas");
    const itens = $$("[data-pessoa-item]");
    expect(itens.map((e) => e.getAttribute("data-pessoa-item"))).toEqual(["uM", "uC"]); // a ordem vem do servidor
    expect(txt(itens[1])).toContain("CO");
    expect(txt(itens[1])).toContain("OS-2026-0314");
    expect(txt(itens[1].querySelector("[data-nao-lidas]"))).toBe("2");
    await clicar($("[data-visao-chave='os']"));
    expect(chamadas.some((c) => c.url === "/api/conversas")).toBe(true);
    expect($("[data-pessoa-item]")).toBeNull();
  });

  it("a conversa com a pessoa: a etiqueta da OS só quando a OS muda (seguidas agrupam), \"Sem OS\", o destinatário no balão", async () => {
    await tela("uC");
    expect(nav.replace).not.toHaveBeenCalled();
    expect($$("[data-etiqueta-os]").map((e) => [e.getAttribute("data-etiqueta-os"), txt(e)])).toEqual([
      ["os1", "OS-2026-0314 · Bom Preço"], ["sem-os", "Sem OS"], ["os2", "OS-2026-0315 · Padaria Sol"],
    ]);
    expect(txt($("[data-mensagem='d'] [data-para]"))).toBe("para Carlos ·");
    expect(txt($("[data-titulo-conversa]"))).toBe("Carlos Oliveira");
    // a etiqueta abre a OS
    await clicar($("[data-etiqueta-os='os2'] button"));
  });

  it("o seletor começa na OS padrão (a em andamento); um toque troca; enviar leva a OS escolhida ou nenhuma (Sem OS)", async () => {
    await tela("uC");
    expect($("[data-os-opcao='os1']")!.getAttribute("aria-checked")).toBe("true");
    respostas["POST /api/conversas/pessoas/uC"] = () => new Response(JSON.stringify({ mensagem: msg({ id: "s1", clientId: chamadas.at(-1)!.corpo.clientId, texto: chamadas.at(-1)!.corpo.texto, meu: true }) }), { status: 201 });
    await digitar($("[data-texto-mensagem]"), "Ok, siga.");
    await clicar($("[data-enviar-mensagem]"));
    expect(chamadas.filter((c) => c.metodo === "POST").at(-1)!.corpo).toMatchObject({ texto: "Ok, siga.", osId: "os1" });
    await clicar($("[data-os-opcao='sem-os']"));
    expect($("[data-os-opcao='sem-os']")!.getAttribute("aria-checked")).toBe("true");
    await digitar($("[data-texto-mensagem]"), "Passa no escritório.");
    await clicar($("[data-enviar-mensagem]"));
    expect(chamadas.filter((c) => c.metodo === "POST").at(-1)!.corpo).toMatchObject({ texto: "Passa no escritório.", osId: null });
  });

  it("\"Outra OS\": a busca vai ao servidor e a OS achada entra no seletor, já escolhida", async () => {
    await tela("uC");
    respostas["GET /api/conversas?busca=0999"] = { status: 200, corpo: { conversas: [], semConversa: [{ osId: "os9", osNumero: "OS-2026-0999", cliente: "Mercado Azul" }] } };
    await clicar($("[data-outra-os]"));
    await digitar($("[data-busca-os-texto]"), "0999");
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    await esperar();
    await clicar($("[data-os-achada='os9']"));
    expect($("[data-os-opcao='os9']")!.getAttribute("aria-checked")).toBe("true");
  });

  it("tocar na pessoa abre a conversa e põe ?pessoa= no endereço", async () => {
    await tela();
    await clicar($("[data-pessoa-item='uC']"));
    expect(nav.replace).toHaveBeenCalledWith("/conversas?pessoa=uC", { scroll: false });
    expect($("[data-conversa-aberta='p:uC']")).not.toBeNull();
    expect($("[data-pessoa-item='uC'] [data-nao-lidas]")).toBeNull(); // abrir zera o contador dela
  });

  it("CHAT-1.2: a linha de situação e o ponto (lista e cabeçalho); o tempo real atualiza sem recarregar a lista", async () => {
    const agora = Date.now();
    const atras = (min: number) => new Date(agora - min * 60_000).toISOString();
    const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const comEstado = [
      { ...PESSOAS[0], ultima: { ...PESSOAS[0].ultima, origem: "ESCRITORIO", lida: false },
        estado: { usuarioId: "uM", contatoEm: atras(25), situacao: { tipo: "PAUSADA", motivo: "Falta de peça/material", impedimento: true, os: { id: "os1", numero: "OS-2026-0314" } } } },
      { ...PESSOAS[1], estado: { usuarioId: "uC", contatoEm: atras(1), situacao: { tipo: "EM_EXECUCAO", os: { id: "os2", numero: "OS-2026-0315" } } } },
    ];
    respostas["GET /api/conversas/pessoas"] = { status: 200, corpo: { pessoas: comEstado, naoLidas: 1 } };
    const { ConversasEscritorio } = await import("@/components/chat/conversas-escritorio");
    respostas["GET /api/conversas/pessoas/uC"] = { status: 200, corpo: { pessoa: { usuarioId: "uC", nome: "Carlos Oliveira", avatar: null, estado: comEstado[1].estado }, mensagens: DA_PESSOA, osDoDia: DO_DIA, osPadrao: "os1" } };
    respostas["GET /api/conversas"] = { status: 200, corpo: { conversas: [], semConversa: [], naoLidas: 0 } };
    await montar(createElement(ConversasEscritorio, { osInicial: null, pessoaInicial: null, podeEscrever: true, podeConversas: true, podeEnviarConversas: true }));
    // embaixo do nome: UMA linha; a Maria sem sinal com mensagem do escritório esperando; o Carlos no app agora (o ponto)
    const maria = $("[data-pessoa-item='uM']")!;
    expect(txt(maria.querySelector("[data-situacao]"))).toBe("Pausada — Falta de peça/material · OS-2026-0314 · Sem sinal há 25 min");
    expect(maria.querySelector("[data-ponto-presenca]")).toBeNull();
    expect(maria.querySelector("a")).toBeNull(); // na lista, o nº não é link (a linha já é o botão)
    const carlos = $("[data-pessoa-item='uC']")!;
    expect(txt(carlos.querySelector("[data-situacao]"))).toBe("Em execução · OS-2026-0315");
    expect(carlos.querySelector("[data-ponto-presenca]")!.getAttribute("aria-label")).toBe("No app agora");
    expect($("[data-legenda-situacao]")).not.toBeNull(); // a legenda no ⓘ
    // o tempo real traz a situação nova (sem "mudou": a lista não é recarregada)
    const pedidosAntes = chamadas.filter((c) => c.url === "/api/conversas/pessoas").length;
    const visto = atras(40);
    await act(async () => { tempoReal.ouvintes.forEach((o) => o({ marca: "1.0", mudou: false, tecnicos: [{ usuarioId: "uC", contatoEm: visto, situacao: { tipo: "SEM_ATIVIDADE" } }] })); });
    expect(txt($("[data-pessoa-item='uC'] [data-situacao]"))).toBe(`Sem atividade agora · visto por último às ${hora(visto)}`);
    expect($("[data-pessoa-item='uC'] [data-ponto-presenca]")).toBeNull();
    expect(chamadas.filter((c) => c.url === "/api/conversas/pessoas").length).toBe(pedidosAntes);
    // o cabeçalho da conversa: a mesma linha, com o nº da OS clicável e o ⓘ
    await act(async () => { tempoReal.ouvintes.forEach((o) => o({ marca: "1.0", mudou: false, tecnicos: [{ usuarioId: "uC", contatoEm: atras(0), situacao: { tipo: "A_CAMINHO", os: { id: "os2", numero: "OS-2026-0315" } } }] })); });
    await clicar($("[data-pessoa-item='uC']"));
    const cab = $("[data-situacao-cabecalho]")!;
    expect(txt(cab.querySelector("[data-situacao]"))).toBe("A caminho · OS-2026-0315");
    expect(cab.querySelector("a[data-situacao-os]")!.getAttribute("href")).toBe("/ordens/os2");
    expect(txt(document.body)).not.toMatch(/\bvocê\b/i);
  });
});
