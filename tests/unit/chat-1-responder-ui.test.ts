// @vitest-environment happy-dom
/**
 * CHAT-1 — RESPONDER uma mensagem específica (como no WhatsApp), nas telas do escritório (happy-dom; servidor simulado):
 *  - computador: o ícone Responder no balão (aparece ao passar o mouse) e o menu do botão direito;
 *  - celular: arrastar o balão para a direita responde; o toque longo abre o mesmo menu;
 *  - acima do campo: a citação (quem falou + uma linha, ou a miniatura) com X para cancelar (Esc também);
 *  - o balão da resposta mostra a citação no topo; tocar rola até a original e a destaca por um instante; fora do que
 *    foi carregado, a tela carrega desde ela (?ate=) e vai até ela;
 *  - a resposta HERDA a OS da citada (não a da atividade em andamento), a menos que a pessoa troque; cancelar volta;
 *  - a recusada ("Não enviada") e a conversa só leitura não respondem; a "Enviando…" responde pelo clientId;
 *  - dentro da OS a citação aparece igual; nada de "você".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComentarioTela } from "@/lib/tecnico/comentarios";
import { ARRASTE_RESPONDER_PX, DESTAQUE_MS, MSG_CITADA_NAO_ENCONTRADA, TOQUE_LONGO_MS } from "@/lib/chat/regras";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const tempoReal = vi.hoisted(() => ({ ouvintes: [] as ((r: any) => void)[] }));
vi.mock("@/components/chat/use-novidades", async () => {
  const React = await import("react");
  return {
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: any) => createElement("a", { href, ...p }, children) }));
vi.mock("@/lib/ui/sino", () => ({ atualizarSino: vi.fn() }));

let root: Root | undefined;
let chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, (() => Response) | { status: number; corpo: unknown }> = {};
const rolou = vi.fn();
beforeEach(() => {
  chamadas = []; respostas = {}; tempoReal.ouvintes = []; rolou.mockClear();
  (HTMLElement.prototype as any).scrollIntoView = function () { rolou(this.getAttribute("data-mensagem")); };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    if (typeof r === "function") return r();
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function montar(el: React.ReactElement) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(el); });
  await esperar();
}
async function clicar(el: Element | null) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); }
async function digitar(el: Element | null, valor: string) {
  const e = el as HTMLTextAreaElement;
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), "value")!.set!;
  await act(async () => { set.call(e, valor); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
const toque = (tipo: string, el: Element, x: number, y = 100) =>
  act(async () => { el.dispatchEvent(new PointerEvent(tipo, { pointerType: "touch", clientX: x, clientY: y, bubbles: true })); });
const corpoDe = (id: string) => $(`[data-mensagem='${id}'] [data-corpo-balao]`)!;
const citando = () => txt($("[data-citando] [data-citacao]"));

const HOJE = new Date().toISOString();
const msg = (over: Partial<ComentarioTela>): ComentarioTela => ({ id: "m", clientId: "m", texto: "Oi", autor: "Carlos Oliveira", origem: "APP", criadoEm: HOJE, meu: false, ...over });
const OS1 = { id: "os1", numero: "OS-2026-0314", cliente: "Bom Preço" };
const OS2 = { id: "os2", numero: "OS-2026-0315", cliente: "Padaria Sol" };
const OS9 = { id: "os9", numero: "OS-2026-0290", cliente: "Escola Estadual" }; // de outro dia: fora do seletor
const LONGO = "A unidade da sala 3 está com o dreno entupido e a bandeja transbordando; faço a desobstrução agora ou espero o síndico liberar o acesso?";
const MENSAGENS: ComentarioTela[] = [
  msg({ id: "a", clientId: "a", texto: LONGO, os: OS1 }),
  msg({ id: "b", clientId: "b", texto: "", foto: { id: "f1", miniatura: "data:image/jpeg;base64,TUlOSQ==" }, os: OS2 }),
  msg({ id: "c", clientId: "c", texto: "Chego em 10 minutos.", os: null }),
  msg({ id: "d", clientId: "d", texto: "Sobre a OS de ontem: tudo certo.", os: OS9 }),
  msg({ id: "r", clientId: "r", texto: "Pode desobstruir.", autor: "Ana Souza", origem: "ESCRITORIO", meu: true, os: OS1,
    respostaA: { id: "a", clientId: "a", autor: "Carlos Oliveira", meu: false, texto: "A unidade da sala 3…", miniatura: null } }),
];

describe("responder: o balão e a caixa de escrever (computador e celular)", () => {
  async function conversa(props: Record<string, unknown> = {}) {
    const { ConversaChat } = await import("@/components/chat/conversa");
    const onEnviar = vi.fn(async () => null);
    const onCitar = vi.fn();
    await montar(createElement(ConversaChat, { mensagens: MENSAGENS, onEnviar, onCitar, urlFoto: (id: string) => `/f/${id}`, ...props }));
    return { onEnviar, onCitar };
  }

  it("computador: o ícone Responder em cada balão; a citação acima do campo (quem falou + UMA linha); X cancela", async () => {
    const { onCitar } = await conversa();
    expect($$("[data-mensagem] [data-responder]").length).toBe(MENSAGENS.length);
    expect($("[data-responder]")!.getAttribute("title")).toBe("Responder");
    await clicar($("[data-mensagem='a'] [data-responder]"));
    expect(txt($("[data-citando] [data-citacao-autor]"))).toBe("Carlos Oliveira");
    const linha = txt($("[data-citando] [data-citacao-texto]"));
    expect(linha.endsWith("…")).toBe(true);
    expect(linha.length).toBeLessThanOrEqual(90);
    expect(onCitar).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a" }));
    expect(document.activeElement).toBe($("[data-texto-mensagem]"));
    await clicar($("[data-cancelar-citacao]"));
    expect($("[data-citando]")).toBeNull();
    expect(onCitar).toHaveBeenLastCalledWith(null);
    expect(txt(document.body)).not.toMatch(/você/i);
  });

  it("foto citada: a miniatura na citação (e \"Foto\" no lugar do texto)", async () => {
    await conversa();
    await clicar($("[data-mensagem='b'] [data-responder]"));
    expect($("[data-citando] [data-citacao-foto]")!.getAttribute("src")).toBe("data:image/jpeg;base64,TUlOSQ==");
    expect(txt($("[data-citando] [data-citacao-texto]"))).toBe("Foto");
  });

  it("computador: o botão direito abre o menu com Responder; Esc no campo cancela a citação", async () => {
    await conversa();
    await act(async () => { corpoDe("c").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect($("[data-menu-mensagem]")).not.toBeNull();
    await clicar($("[data-menu-responder]"));
    expect($("[data-menu-mensagem]")).toBeNull();
    expect(citando()).toContain("Chego em 10 minutos.");
    await act(async () => { $("[data-texto-mensagem]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect($("[data-citando]")).toBeNull();
  });

  it("celular: arrastar o balão para a direita responde (pouco não); rolar a conversa na vertical não", async () => {
    await conversa();
    const el = corpoDe("c");
    await toque("pointerdown", el, 20); await toque("pointermove", el, 20 + ARRASTE_RESPONDER_PX - 20); await toque("pointerup", el, 20 + ARRASTE_RESPONDER_PX - 20);
    await esperar();
    expect($("[data-citando]")).toBeNull();
    // rolando: o dedo desce mais do que anda para o lado (mesmo passando da distância): não responde
    await toque("pointerdown", el, 20); await toque("pointermove", el, 20 + ARRASTE_RESPONDER_PX + 6, 100 + ARRASTE_RESPONDER_PX + 40); await toque("pointerup", el, 20 + ARRASTE_RESPONDER_PX + 6, 100 + ARRASTE_RESPONDER_PX + 40);
    await esperar();
    expect($("[data-citando]")).toBeNull();
    await toque("pointerdown", el, 20);
    await toque("pointermove", el, 20 + ARRASTE_RESPONDER_PX / 2);
    expect(el.style.transform).toBe(`translateX(${ARRASTE_RESPONDER_PX / 2}px)`); // o balão acompanha o dedo
    expect($("[data-arraste-responder]")).not.toBeNull();
    await toque("pointermove", el, 20 + ARRASTE_RESPONDER_PX + 4); await toque("pointerup", el, 20 + ARRASTE_RESPONDER_PX + 4);
    await esperar();
    expect(citando()).toContain("Chego em 10 minutos.");
    expect(el.style.transform).toBe("");
  });

  it("celular: o toque longo abre o menu Responder (e não abre a foto ao soltar)", async () => {
    await conversa();
    const el = corpoDe("b");
    await toque("pointerdown", el, 30);
    await act(async () => { await new Promise((r) => setTimeout(r, TOQUE_LONGO_MS + 60)); });
    expect($("[data-menu-mensagem]")).not.toBeNull();
    await toque("pointerup", el, 30);
    await clicar($("[data-mensagem='b'] [data-foto-mensagem]"));
    expect(document.querySelector("img[src='/f/f1']")).toBeNull(); // o "clique" do toque longo não amplia a foto
    await clicar($("[data-menu-responder]"));
    expect($("[data-citando] [data-citacao-foto]")).not.toBeNull();
  });

  it("enviar leva a referência da citada (pelo id; a \"Enviando…\" pelo clientId) e a citada inteira para o balão na hora", async () => {
    const pendente = msg({ id: null, clientId: "loc1", texto: "Saindo agora.", meu: true, pendente: true, origem: "ESCRITORIO" });
    const { onEnviar } = await conversa({ mensagens: [...MENSAGENS, pendente] });
    await clicar($("[data-mensagem='c'] [data-responder]"));
    await digitar($("[data-texto-mensagem]"), "Combinado.");
    await clicar($("[data-enviar-mensagem]"));
    expect(onEnviar).toHaveBeenLastCalledWith({ texto: "Combinado.", respostaA: { id: "c" } }, expect.objectContaining({ id: "c" }));
    expect($("[data-citando]")).toBeNull(); // enviou: a citação sai da caixa
    await clicar($("[data-mensagem='loc1'] [data-responder]"));
    await digitar($("[data-texto-mensagem]"), "Corrigindo: saio em 5.");
    await clicar($("[data-enviar-mensagem]"));
    expect(onEnviar).toHaveBeenLastCalledWith({ texto: "Corrigindo: saio em 5.", respostaA: { clientId: "loc1" } }, expect.objectContaining({ clientId: "loc1" }));
  });

  it("não responde: a recusada (\"Não enviada\") nem a conversa só leitura (OS cancelada ou sem permissão)", async () => {
    await conversa({ mensagens: [...MENSAGENS, msg({ id: null, clientId: "x", meu: true, falhou: "Sem conexão" })] });
    expect($("[data-mensagem='x'] [data-responder]")).toBeNull();
    await act(async () => { corpoDe("x").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect($("[data-menu-mensagem]")).toBeNull();
    act(() => root!.unmount()); root = undefined; document.body.innerHTML = "";
    await conversa({ somenteLeitura: "OS cancelada: a conversa fica só para leitura." });
    expect($("[data-responder]")).toBeNull();
    await act(async () => { corpoDe("c").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect($("[data-menu-mensagem]")).toBeNull();
    // a citação continua aparecendo (e leva até a original) mesmo só para leitura
    expect(txt($("[data-mensagem='r'] [data-citacao]"))).toContain("Carlos Oliveira");
  });

  it("a citação no topo do balão; tocar rola até a original e a destaca por um instante", async () => {
    await conversa();
    expect(txt($("[data-mensagem='r'] [data-citacao-autor]"))).toBe("Carlos Oliveira");
    expect($("[data-mensagem='r'] [data-corpo-balao]")!.firstElementChild!.hasAttribute("data-citacao")).toBe(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => { ($("[data-mensagem='r'] [data-citacao]") as HTMLElement).click(); });
    expect(rolou).toHaveBeenLastCalledWith("a");
    expect($("[data-mensagem='a']")!.getAttribute("data-destacada")).toBe("true");
    await act(async () => { vi.advanceTimersByTime(DESTAQUE_MS + 10); });
    expect($("[data-mensagem='a']")!.hasAttribute("data-destacada")).toBe(false);
  });

  it("original fora do que foi carregado: a tela carrega desde ela e vai até ela; não achou: avisa", async () => {
    const antiga = msg({ id: "z", clientId: "z", texto: "Mensagem antiga da semana passada.", criadoEm: "2026-11-01T12:00:00.000Z", os: OS1 });
    const resposta = msg({ id: "r2", clientId: "r2", texto: "Respondendo a antiga.", meu: true, origem: "ESCRITORIO", os: OS1,
      respostaA: { id: "z", clientId: "z", autor: "Carlos Oliveira", meu: false, texto: "Mensagem antiga…", miniatura: null } });
    const { ConversaChat } = await import("@/components/chat/conversa");
    let lista = [resposta];
    const carregarAte = vi.fn(async () => { lista = [antiga, resposta]; await act(async () => { root!.render(el()); }); });
    const el = () => createElement(ConversaChat, { mensagens: lista, onEnviar: vi.fn(async () => null), urlFoto: () => "", carregarAte });
    await montar(el());
    await clicar($("[data-mensagem='r2'] [data-citacao]"));
    await esperar();
    expect(carregarAte).toHaveBeenCalledWith("z");
    expect(rolou).toHaveBeenLastCalledWith("z");
    expect($("[data-mensagem='z']")!.getAttribute("data-destacada")).toBe("true");
    // não achou nem carregando desde ela (outra conversa): o aviso
    lista = [msg({ ...resposta, id: "r3", clientId: "r3", respostaA: { ...resposta.respostaA!, id: "fora", clientId: null } })];
    carregarAte.mockImplementation(async () => {});
    await act(async () => { root!.render(el()); });
    await clicar($("[data-mensagem='r3'] [data-citacao]"));
    await esperar();
    expect(txt($("[data-aviso-chat]"))).toBe(MSG_CITADA_NAO_ENCONTRADA);
  });

  it("citação indisponível (quem vê não pode ver a original): sem conteúdo e sem ir até ela", async () => {
    await conversa({ mensagens: [msg({ id: "r", clientId: "r", texto: "Ok.", respostaA: { id: null, clientId: null, autor: "", meu: false, texto: "Mensagem indisponível", miniatura: null, indisponivel: true } })] });
    expect(txt($("[data-citacao]"))).toBe("Mensagem indisponível");
    expect($("[data-citacao]")!.tagName).toBe("DIV"); // não é botão
  });
});

describe("responder no escritório: a OS herdada e o envio", () => {
  const DO_DIA = [{ osId: "os1", numero: OS1.numero, cliente: OS1.cliente, emAndamento: true }, { osId: "os2", numero: OS2.numero, cliente: OS2.cliente, emAndamento: false }];
  const marcada = () => $$("[data-os-opcao]").filter((o) => o.getAttribute("aria-checked") === "true").map((o) => o.getAttribute("data-os-opcao"));
  async function pessoa() {
    respostas["GET /api/conversas/pessoas/uC"] = { status: 200, corpo: { pessoa: { usuarioId: "uC", nome: "Carlos Oliveira", avatar: null }, mensagens: MENSAGENS, osDoDia: DO_DIA, osPadrao: "os1" } };
    respostas["POST /api/conversas/pessoas/uC"] = () => {
      const c = chamadas.at(-1)!.corpo;
      return new Response(JSON.stringify({ mensagem: msg({ id: "s1", clientId: c.clientId, texto: c.texto, meu: true, origem: "ESCRITORIO", os: c.osId === "os9" ? OS9 : null,
        respostaA: { id: c.respostaA.id, clientId: null, autor: "Carlos Oliveira", meu: false, texto: "x", miniatura: null } }) }), { status: 201 });
    };
    const { ConversaEscritorio } = await import("@/components/chat/conversa-escritorio");
    await montar(createElement(ConversaEscritorio, { alvo: { tipo: "pessoa", usuarioId: "uC" }, podeEscrever: true }));
  }

  it("a resposta herda a OS da citada (não a da atividade em andamento); de outro dia, a OS entra no seletor", async () => {
    await pessoa();
    expect(marcada()).toEqual(["os1"]); // a padrão: a em andamento
    await clicar($("[data-mensagem='b'] [data-responder]"));
    expect(marcada()).toEqual(["os2"]);
    await clicar($("[data-mensagem='c'] [data-responder]"));
    expect(marcada()).toEqual(["sem-os"]);
    await clicar($("[data-mensagem='d'] [data-responder]"));
    expect(marcada()).toEqual(["os9"]);
    expect(txt($("[data-os-opcao='os9']"))).toBe("OS-2026-0290 · Escola Estadual");
    await digitar($("[data-texto-mensagem]"), "Que bom.");
    await clicar($("[data-enviar-mensagem]"));
    const post = chamadas.filter((c) => c.metodo === "POST").at(-1)!;
    expect(post.corpo).toMatchObject({ texto: "Que bom.", osId: "os9", respostaA: { id: "d" } });
    expect(Object.keys(post.corpo).sort()).toEqual(["clientId", "osId", "respostaA", "texto"]); // só o que o servidor aceita
  });

  it("cancelar a resposta volta à OS de antes; se a pessoa trocou a OS, a troca fica", async () => {
    await pessoa();
    await clicar($("[data-mensagem='b'] [data-responder]"));
    expect(marcada()).toEqual(["os2"]);
    await clicar($("[data-cancelar-citacao]"));
    expect(marcada()).toEqual(["os1"]);
    await clicar($("[data-mensagem='c'] [data-responder]"));
    expect(marcada()).toEqual(["sem-os"]);
    await clicar($("[data-os-opcao='os2']")); // a pessoa troca
    await clicar($("[data-cancelar-citacao]"));
    expect(marcada()).toEqual(["os2"]);
  });

  it("o balão da resposta aparece na hora com a citação (\"Enviando…\")", async () => {
    await pessoa();
    let liberar!: () => void;
    respostas["POST /api/conversas/pessoas/uC"] = () => new Response(new ReadableStream({ start(c) { liberar = () => c.close(); } }), { status: 201 });
    await clicar($("[data-mensagem='c'] [data-responder]"));
    await digitar($("[data-texto-mensagem]"), "Ok, aguardo.");
    await act(async () => { ($("[data-enviar-mensagem]") as HTMLElement).click(); });
    await esperar();
    const local = $$("[data-mensagem]").find((b) => txt(b).includes("Ok, aguardo."))!;
    expect(local.getAttribute("data-estado")).toBe("enviando");
    expect(txt(local.querySelector("[data-citacao]"))).toContain("Chego em 10 minutos.");
    liberar?.();
  });

  it("dentro da OS: a citação aparece igual; a resposta vai pela OS (sem escolher OS) com a referência", async () => {
    respostas["GET /api/conversas/os1"] = { status: 200, corpo: { conversa: { osId: "os1", osNumero: OS1.numero, cliente: OS1.cliente, status: "AGENDADA", tecnicos: [], ultima: null, naoLidas: 0 }, mensagens: MENSAGENS.filter((m) => m.os?.id === "os1") } };
    respostas["POST /api/conversas/os1"] = () => new Response(JSON.stringify({ mensagem: msg({ id: "s2", clientId: chamadas.at(-1)!.corpo.clientId, texto: "Feito.", meu: true }) }), { status: 201 });
    const { ConversaEscritorio } = await import("@/components/chat/conversa-escritorio");
    await montar(createElement(ConversaEscritorio, { alvo: { tipo: "os", osId: "os1" }, podeEscrever: true }));
    expect(txt($("[data-mensagem='r'] [data-citacao-autor]"))).toBe("Carlos Oliveira");
    expect($("[data-seletor-os]")).toBeNull();
    await clicar($("[data-mensagem='a'] [data-responder]"));
    await digitar($("[data-texto-mensagem]"), "Feito.");
    await clicar($("[data-enviar-mensagem]"));
    expect(chamadas.filter((c) => c.metodo === "POST").at(-1)!.corpo).toMatchObject({ texto: "Feito.", respostaA: { id: "a" } });
    expect(chamadas.filter((c) => c.metodo === "POST").at(-1)!.corpo.osId).toBeUndefined();
  });

  it("ir até uma citada antiga: pede a conversa desde ela (?ate=) e as próximas leituras continuam desde ela", async () => {
    const resposta = msg({ id: "r9", clientId: "r9", texto: "Sobre aquela.", os: OS1, respostaA: { id: "z", clientId: "z", autor: "Carlos Oliveira", meu: false, texto: "Antiga…", miniatura: null } });
    const antiga = msg({ id: "z", clientId: "z", texto: "Antiga da semana passada.", criadoEm: "2026-11-01T12:00:00.000Z", os: OS1 });
    respostas["GET /api/conversas/pessoas/uC"] = { status: 200, corpo: { pessoa: { usuarioId: "uC", nome: "Carlos Oliveira", avatar: null }, mensagens: [resposta], osDoDia: DO_DIA, osPadrao: "os1" } };
    respostas["GET /api/conversas/pessoas/uC?ate=z"] = { status: 200, corpo: { pessoa: { usuarioId: "uC", nome: "Carlos Oliveira", avatar: null }, mensagens: [antiga, resposta], osDoDia: DO_DIA, osPadrao: "os1" } };
    const { ConversaEscritorio } = await import("@/components/chat/conversa-escritorio");
    await montar(createElement(ConversaEscritorio, { alvo: { tipo: "pessoa", usuarioId: "uC" }, podeEscrever: true }));
    await clicar($("[data-mensagem='r9'] [data-citacao]"));
    await esperar();
    expect(chamadas.map((c) => c.url)).toContain("/api/conversas/pessoas/uC?ate=z");
    expect($("[data-mensagem='z']")!.getAttribute("data-destacada")).toBe("true");
    // chegou mensagem (tempo real): a recarga continua desde a citada (a antiga não some)
    await act(async () => { for (const o of tempoReal.ouvintes) o({ mudou: true, marca: "2.0.0" }); });
    await esperar();
    expect(chamadas.at(-1)!.url).toBe("/api/conversas/pessoas/uC?ate=z");
    expect($("[data-mensagem='z']")).not.toBeNull();
  });
});
