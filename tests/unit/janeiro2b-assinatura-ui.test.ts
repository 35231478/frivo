// @vitest-environment happy-dom
/**
 * D6 — "Assinar em tela cheia" no aceite do app do técnico (paisagem só nessa tela):
 *  - o botão só no app (o escritório segue com o quadro de sempre);
 *  - abre um quadro do tamanho da tela, entra em tela cheia e trava em paisagem (onde o aparelho deixa); ao sair, destrava;
 *  - em pé (iPhone, sem trava): pede para girar; assina assim mesmo;
 *  - "Usar assinatura": volta ao quadro do aceite EM ESCALA (sem distorcer, inteira dentro dele) e confirma como sempre;
 *  - "Voltar" e Esc: fecham só a tela cheia, nada muda (o aceite continua aberto).
 * O react-signature-canvas é trocado por um quadro falso (um por quadro) que guarda os pontos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { entrarPaisagem, sairPaisagem } from "@/lib/assinatura-quadro";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const quadros = vi.hoisted(() => ({ dados: {} as Record<string, unknown[][]>, onEnd: {} as Record<string, () => void> }));
vi.mock("react-signature-canvas", async () => {
  const React = await import("react");
  class QuadroFalso extends React.Component<any> {
    canvas: HTMLCanvasElement | null = null;
    get nome() { return this.props.canvasProps["aria-label"] as string; }
    componentDidMount() { quadros.dados[this.nome] ??= []; quadros.onEnd[this.nome] = () => this.props.onEnd?.(); }
    getCanvas() { return this.canvas!; }
    isEmpty() { return !(quadros.dados[this.nome] ?? []).length; }
    clear() { quadros.dados[this.nome] = []; }
    toData() { return quadros.dados[this.nome] ?? []; }
    fromData(d: unknown[][]) { quadros.dados[this.nome] = d; }
    _resizeCanvas() {}
    render() { return React.createElement("canvas", { ...this.props.canvasProps, ref: (c: HTMLCanvasElement | null) => { this.canvas = c; } }); }
  }
  return { default: QuadroFalso };
});

const PEQUENO = "Quadro de assinatura", GRANDE = "Quadro de assinatura em tela cheia";
const TAM: Record<string, { w: number; h: number }> = { [PEQUENO]: { w: 312, h: 176 }, [GRANDE]: { w: 780, h: 300 } };
const p = (x: number, y: number) => ({ x, y, time: 1, color: "#1A2230" });
// Uma assinatura larga, feita no quadro grande (deitado): 600 × 200 px
const LARGA = [[p(90, 50), p(300, 250), p(690, 60)]];

let raiz: Root; let caixa: HTMLDivElement; let aoConfirmar: ReturnType<typeof vi.fn>;
let travas: string[]; let emPe: boolean;
beforeEach(() => {
  quadros.dados = {}; quadros.onEnd = {}; travas = []; emPe = false;
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
  const tam = (el: HTMLCanvasElement) => TAM[el.getAttribute("aria-label") ?? ""] ?? { w: 0, h: 0 };
  Object.defineProperty(HTMLCanvasElement.prototype, "offsetWidth", { configurable: true, get() { return tam(this).w; } });
  Object.defineProperty(HTMLCanvasElement.prototype, "offsetHeight", { configurable: true, get() { return tam(this).h; } });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value() { return { drawImage: () => undefined, getTransform: () => ({ a: 2 }) }; } });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", { configurable: true, value(this: HTMLCanvasElement) { return `data:image/png;base64,W${this.width}H${this.height}${"A".repeat(200)}`; } });
  // Tela cheia e trava de orientação (o Android deixa)
  let cheia: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => cheia });
  (document.documentElement as any).requestFullscreen = vi.fn(async () => { cheia = document.documentElement; travas.push("tela-cheia"); });
  (document as any).exitFullscreen = vi.fn(async () => { cheia = null; travas.push("sair-tela-cheia"); });
  Object.defineProperty(screen, "orientation", { configurable: true, value: { lock: vi.fn(async (o: string) => { travas.push(`trava:${o}`); }), unlock: vi.fn(() => { travas.push("destrava"); }) } });
  window.matchMedia = ((q: string) => ({ matches: q.includes("portrait") && emPe, addEventListener: () => undefined, removeEventListener: () => undefined })) as any;
  aoConfirmar = vi.fn(async () => null);
  caixa = document.createElement("div"); document.body.appendChild(caixa); raiz = createRoot(caixa);
});
afterEach(() => { act(() => raiz.unmount()); caixa.remove(); document.body.innerHTML = ""; });

const esperar = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const $ = (s: string) => document.body.querySelector(s) as HTMLElement | null;
const clicar = async (s: string) => { expect($(s)).toBeTruthy(); await act(async () => { $(s)!.click(); }); await esperar(); };
async function montar(telaCheia = true) {
  const { AssinaturaDoCliente } = await import("@/components/os/aceite-assinatura");
  await act(async () => { raiz.render(createElement(AssinaturaDoCliente, { resumo: "OS-2601 · Clínica Exemplo", aoConfirmar, aoCancelar: vi.fn(), telaCheia })); });
  await esperar();
}
const nome = async (v: string) => {
  const el = document.querySelector("input[aria-label='Nome de quem recebeu o serviço']") as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const assinarNoGrande = async () => { quadros.dados[GRANDE] = structuredClone(LARGA); await act(async () => { quadros.onEnd[GRANDE](); }); };

describe("D6: assinar em tela cheia", () => {
  it("o botão só no app; no escritório, o quadro de sempre", async () => {
    await montar(false);
    expect($("[data-assinar-tela-cheia]")).toBeNull();
    act(() => raiz.unmount()); raiz = createRoot(caixa);
    await montar(true);
    expect($("[data-assinar-tela-cheia]")!.textContent).toContain("Assinar em tela cheia");
    expect($("[data-assinar-tela-cheia]")!.className).toContain("min-h-[44px]");
    expect($("[data-limpar-assinatura]")!.className).toContain("min-h-[44px]");
  });

  it("abre em tela cheia, trava em paisagem; assinou e usou: volta ao quadro do aceite em escala e confirma como sempre; destrava", async () => {
    await montar();
    await clicar("[data-assinar-tela-cheia]");
    expect($("[data-assinatura-tela-cheia]")).toBeTruthy();
    expect($("[data-assinatura-tela-cheia]")!.parentElement).toBe(document.body); // por cima de tudo (fora do modal)
    expect(travas).toEqual(["tela-cheia", "trava:landscape"]);
    expect($("[data-gire-celular]")).toBeNull(); // deitado: nada a pedir
    expect(($("[data-usar-tela-cheia]") as HTMLButtonElement).disabled).toBe(true); // vazio
    await assinarNoGrande();
    expect(($("[data-usar-tela-cheia]") as HTMLButtonElement).disabled).toBe(false);
    await clicar("[data-usar-tela-cheia]");
    expect($("[data-assinatura-tela-cheia]")).toBeNull();
    expect(travas).toEqual(["tela-cheia", "trava:landscape", "destrava", "sair-tela-cheia"]);
    // No quadro do aceite: a mesma assinatura, encolhida por igual nos dois eixos, inteira dentro dele
    const pts = (quadros.dados[PEQUENO] as any[]).flat();
    expect(pts).toHaveLength(3);
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(12); expect(Math.max(...xs)).toBeLessThanOrEqual(312 - 12);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0); expect(Math.max(...ys)).toBeLessThanOrEqual(176);
    const f = (Math.max(...xs) - Math.min(...xs)) / 600;
    expect((Math.max(...ys) - Math.min(...ys)) / 200).toBeCloseTo(f, 6); // sem distorcer
    await nome("Maria Souza");
    await clicar("[data-confirmar-aceite]");
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoConfirmar.mock.calls[0][0]).toMatchObject({ nome: "Maria Souza", assinatura: expect.stringMatching(/^data:image\/png;base64,/) });
  });

  it("o que já estava assinado no quadro pequeno abre no grande; Voltar não muda nada", async () => {
    await montar();
    const antes = [[p(40, 80), p(120, 60)]];
    quadros.dados[PEQUENO] = structuredClone(antes);
    await clicar("[data-assinar-tela-cheia]");
    expect(quadros.dados[GRANDE]).toEqual(antes);
    expect(($("[data-usar-tela-cheia]") as HTMLButtonElement).disabled).toBe(false);
    await assinarNoGrande();
    await clicar("[data-voltar-tela-cheia]");
    expect($("[data-assinatura-tela-cheia]")).toBeNull();
    expect(quadros.dados[PEQUENO]).toEqual(antes);
  });

  it("Esc fecha só a tela cheia: o aceite continua aberto", async () => {
    await montar();
    await clicar("[data-assinar-tela-cheia]");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await esperar();
    expect($("[data-assinatura-tela-cheia]")).toBeNull();
    expect($("[data-assinatura-cliente]")).toBeTruthy();
  });

  it("em pé e sem trava (iPhone): pede para girar e assina assim mesmo; Limpar limpa", async () => {
    emPe = true;
    (screen.orientation as any).lock = vi.fn(async () => { throw new Error("NotSupportedError"); });
    (document.documentElement as any).requestFullscreen = undefined;
    await montar();
    await clicar("[data-assinar-tela-cheia]");
    expect($("[data-gire-celular]")!.textContent).toContain("Gire o celular para assinar deitado.");
    await assinarNoGrande();
    await clicar("[data-limpar-tela-cheia]");
    expect(quadros.dados[GRANDE]).toEqual([]);
    expect(($("[data-usar-tela-cheia]") as HTMLButtonElement).disabled).toBe(true);
    await assinarNoGrande();
    await clicar("[data-usar-tela-cheia]");
    expect((quadros.dados[PEQUENO] as any[]).flat()).toHaveLength(3);
    expect(travas).toEqual([]); // não travou nem entrou em tela cheia: nada a desfazer
  });
});

describe("D6: tela cheia e paisagem (a regra)", () => {
  it("faz o que o aparelho deixa e desfaz só isso", async () => {
    const chamadas: string[] = [];
    let cheia = false;
    const amb = {
      raiz: { requestFullscreen: async () => { cheia = true; chamadas.push("cheia"); } },
      emTelaCheia: () => cheia, sairTelaCheia: async () => { cheia = false; chamadas.push("sair"); },
      orientacao: { lock: async (o: string) => { chamadas.push(o); }, unlock: () => { chamadas.push("destrava"); } },
    };
    const e = await entrarPaisagem(amb);
    expect(e).toEqual({ telaCheia: true, travou: true });
    await sairPaisagem(amb, e);
    expect(chamadas).toEqual(["cheia", "landscape", "destrava", "sair"]);
    // já estava em tela cheia (outro motivo): não entra nem sai
    chamadas.length = 0; cheia = true;
    const e2 = await entrarPaisagem({ ...amb, orientacao: null });
    expect(e2).toEqual({ telaCheia: false, travou: false });
    await sairPaisagem(amb, e2);
    expect(chamadas).toEqual([]);
    // o navegador recusa tudo: nunca quebra
    const e3 = await entrarPaisagem({ raiz: { requestFullscreen: async () => { throw new Error("x"); } }, emTelaCheia: () => false, orientacao: { lock: async () => { throw new Error("y"); } } });
    expect(e3).toEqual({ telaCheia: false, travou: false });
    expect(await entrarPaisagem({})).toEqual({ telaCheia: false, travou: false });
  });
});
