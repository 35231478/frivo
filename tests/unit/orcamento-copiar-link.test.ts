// @vitest-environment happy-dom
/**
 * "Copiar link" do orçamento — o bug e a correção (leva A do orçamento).
 *
 * A causa real (vista no navegador): a cópia era feita DEPOIS de esperar o servidor e o erro da área de
 * transferência era engolido — com a tela dizendo "Link copiado." mesmo quando o navegador recusou
 * (NotAllowedError: sem permissão, fora do gesto no Safari/iOS, ou `navigator.clipboard` inexistente em
 * http). Aqui:
 *  - a regra pura `copiarTexto` (lib/ui/copiar): API moderna em contexto seguro → comando clássico →
 *    `null` (nunca finge que copiou);
 *  - a tela: a cópia começa NO CLIQUE (antes do fetch — o teste emula a regra de gesto do Safari),
 *    confirma por toast, e quando nada copia mostra o link selecionado para copiar à mão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { copiarPorComando, copiarTexto, type AmbienteCopia } from "@/lib/ui/copiar";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/o1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast }));

/* ═════════ a regra pura ═════════ */
const amb = (p: Partial<AmbienteCopia> = {}): AmbienteCopia => ({ clipboard: null, seguro: true, copiarPorComando: vi.fn(() => false), ...p });

describe("copiarTexto — sem fingir que copiou", () => {
  it("API moderna aceitou: 'api' (e o comando clássico nem é tentado)", async () => {
    const writeText = vi.fn(async () => {});
    const e = amb({ clipboard: { writeText } });
    expect(await copiarTexto("https://x/orcamento/t", e)).toBe("api");
    expect(writeText).toHaveBeenCalledWith("https://x/orcamento/t");
    expect(e.copiarPorComando).not.toHaveBeenCalled();
  });
  it("API recusou (NotAllowedError): tenta o comando clássico; copiou → 'comando', não copiou → null", async () => {
    const recusa = vi.fn(async () => { throw new DOMException("Write permission denied.", "NotAllowedError"); });
    expect(await copiarTexto("t", amb({ clipboard: { writeText: recusa }, copiarPorComando: () => true }))).toBe("comando");
    expect(await copiarTexto("t", amb({ clipboard: { writeText: recusa }, copiarPorComando: () => false }))).toBeNull();
  });
  it("fora de contexto seguro (http) ou sem navigator.clipboard: nem tenta a API, vai direto ao comando", async () => {
    const writeText = vi.fn(async () => {});
    const e = amb({ clipboard: { writeText }, seguro: false, copiarPorComando: vi.fn(() => true) });
    expect(await copiarTexto("t", e)).toBe("comando");
    expect(writeText).not.toHaveBeenCalled();
    expect(await copiarTexto("t", amb({ clipboard: null, copiarPorComando: () => true }))).toBe("comando");
  });
  it("texto vazio não copia nada; comando que explode conta como não copiado", async () => {
    const e = amb({ clipboard: { writeText: vi.fn(async () => {}) }, copiarPorComando: vi.fn(() => true) });
    expect(await copiarTexto("", e)).toBeNull();
    expect(e.clipboard!.writeText).not.toHaveBeenCalled();
    expect(await copiarTexto("t", amb({ copiarPorComando: () => { throw new Error("sem execCommand"); } }))).toBeNull();
  });
  it("a escrita começa na hora da chamada (dentro do gesto), não depois de um await", () => {
    const writeText = vi.fn(async () => {});
    void copiarTexto("t", amb({ clipboard: { writeText } }));
    expect(writeText).toHaveBeenCalledTimes(1); // síncrono: ainda no mesmo tique do clique
  });
});

describe("copiarPorComando — área de texto selecionada + execCommand", () => {
  afterEach(() => { delete (document as any).execCommand; document.body.innerHTML = ""; });
  it("copia o texto selecionado, tira a área de texto e devolve o foco", () => {
    const botao = document.createElement("button");
    document.body.appendChild(botao);
    botao.focus();
    let selecionado = "";
    let focadoNaCopia: Element | null = null;
    (document as any).execCommand = vi.fn((cmd: string) => { focadoNaCopia = document.activeElement; selecionado = document.querySelector("textarea")?.value ?? ""; return cmd === "copy"; });
    expect(copiarPorComando("https://x/orcamento/t")).toBe(true);
    expect((document as any).execCommand).toHaveBeenCalledWith("copy");
    expect(selecionado).toBe("https://x/orcamento/t");
    expect(document.querySelector("textarea")).toBeNull();
    expect(focadoNaCopia).toBeInstanceOf(HTMLTextAreaElement); // na hora de copiar, o foco estava na área de texto
    expect(document.activeElement).toBe(botao); // e voltou para onde estava
  });
  it("sem execCommand, ou ele recusando: false", () => {
    expect(copiarPorComando("t")).toBe(false);
    (document as any).execCommand = () => false;
    expect(copiarPorComando("t")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

/* ═════════ a tela ═════════ */
let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const eventos: string[] = [];
const URL_LINK = () => `${window.location.origin}/orcamento/tk1`;

beforeEach(() => {
  eventos.length = 0;
  nav.refresh.mockClear();
  avisos.toast.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    eventos.push(`fetch ${url}`);
    const r = respostas[`${String(init.method ?? "GET")} ${url}`] ?? { status: 200, corpo: { publicUrl: URL_LINK() } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => {
  act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals();
  delete (document as any).execCommand;
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  document.body.innerHTML = "";
});

const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
async function montar() {
  const { AcoesEnvio } = await import("@/components/orcamento/acoes-envio");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(AcoesEnvio, { orcamentoId: "o1", codigo: "ORC-2026-0147", tokenPublico: "tk1", status: "RASCUNHO", etapa: "RASCUNHO", podeEditar: true } as any)); });
  await esperar();
}
const clicarCopiar = async () => { await act(async () => { $("[data-copiar-link]")!.click(); }); await esperar(); };
const comClipboard = (writeText: (t: string) => Promise<void>) => Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
const toasts = () => avisos.toast.mock.calls.map(([msg, tipo]) => `${tipo ?? "sucesso"}: ${msg}`);

describe("Copiar link na tela do orçamento", () => {
  it("copia o link NO CLIQUE (antes de ir ao servidor), registra o envio e confirma por toast", async () => {
    const writeText = vi.fn(async (t: string) => { eventos.push(`copiar ${t}`); });
    comClipboard(writeText);
    await montar();
    await clicarCopiar();
    expect(eventos).toEqual([`copiar ${URL_LINK()}`, "fetch /api/orcamentos/o1/enviar"]); // a cópia vem antes do fetch
    expect(toasts()).toEqual(["sucesso: Link copiado."]);
    expect($("[data-link-manual]")).toBeNull();
    expect($("[data-feedback-envio]")).toBeNull(); // nada de caixa inline: a confirmação é o toast
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("regra de gesto do Safari/iOS (só aceita escrever dentro do toque): copia — antes recusava e dizia 'copiado'", async () => {
    let noGesto = false;
    document.addEventListener("click", () => { noGesto = true; setTimeout(() => { noGesto = false; }, 0); }, { capture: true, once: true });
    const gravado: string[] = [];
    comClipboard(async (t) => { if (!noGesto) throw new DOMException("Write permission denied.", "NotAllowedError"); gravado.push(t); });
    await montar();
    await clicarCopiar();
    expect(gravado).toEqual([URL_LINK()]);
    expect(toasts()).toEqual(["sucesso: Link copiado."]);
  });

  it("navegador recusou a API: cai no comando clássico e copia do mesmo jeito", async () => {
    comClipboard(async () => { throw new DOMException("Write permission denied.", "NotAllowedError"); });
    (document as any).execCommand = vi.fn(() => true);
    await montar();
    await clicarCopiar();
    expect((document as any).execCommand).toHaveBeenCalledWith("copy");
    expect(toasts()).toEqual(["sucesso: Link copiado."]);
    expect($("[data-link-manual]")).toBeNull();
  });

  it("nada copiou (API recusou e o comando também): NÃO diz 'copiado' — mostra o link selecionado para copiar à mão", async () => {
    comClipboard(async () => { throw new DOMException("Write permission denied.", "NotAllowedError"); });
    (document as any).execCommand = vi.fn(() => false);
    await montar();
    await clicarCopiar();
    expect(toasts()).toEqual(["info: Não foi possível copiar. Copie o link selecionado abaixo."]);
    const campo = $<HTMLInputElement>("[data-link-manual]")!;
    expect(campo.value).toBe(URL_LINK());
    expect(campo.readOnly).toBe(true);
    expect(document.activeElement).toBe(campo); // já focado e selecionado
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([0, URL_LINK().length]);
  });

  it("http sem navigator.clipboard (contexto não seguro): copia pelo comando clássico", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    (document as any).execCommand = vi.fn(() => true);
    await montar();
    await clicarCopiar();
    expect(toasts()).toEqual(["sucesso: Link copiado."]);
  });

  it("o servidor recusou (validade vencida): mostra o erro dele e não diz 'copiado'", async () => {
    comClipboard(vi.fn(async () => {}));
    respostas["POST /api/orcamentos/o1/enviar"] = { status: 400, corpo: { erro: "A validade deste orçamento já venceu." } };
    await montar();
    await clicarCopiar();
    expect(toasts()).toEqual(["erro: A validade deste orçamento já venceu."]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("o servidor devolveu outro endereço (proxy/domínio): vale o do servidor, à vista para copiar", async () => {
    comClipboard(vi.fn(async () => {}));
    respostas["POST /api/orcamentos/o1/enviar"] = { status: 200, corpo: { publicUrl: "https://propostas.empresa.com.br/orcamento/tk1" } };
    await montar();
    await clicarCopiar();
    expect($<HTMLInputElement>("[data-link-manual]")!.value).toBe("https://propostas.empresa.com.br/orcamento/tk1");
    expect(toasts()).not.toContain("sucesso: Link copiado.");
  });

  it("erro de conexão: avisa e não diz 'copiado'", async () => {
    comClipboard(vi.fn(async () => {}));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await montar();
    await clicarCopiar();
    expect(toasts()).toEqual(["erro: Erro de conexão."]);
  });
});
