// @vitest-environment happy-dom
/**
 * App: assinatura do aceite NA TELA (o quadro do app do técnico e do escritório, `AssinaturaDoCliente`):
 *  - assinou e girou o celular (o quadro mudou de tamanho): o traço continua, redesenhado em escala;
 *  - abriu o teclado ou rolou (o quadro NÃO mudou): nada é refeito;
 *  - "Limpar" continua limpando; assinatura vazia (ou limpa e girada) não envia;
 *  - confirmar manda a imagem recortada (a mesma em qualquer orientação); dois toques rápidos, um aceite só.
 * O react-signature-canvas é trocado por um quadro falso que guarda os pontos (o happy-dom não desenha canvas).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MSG_ASSINATURA } from "@/lib/os/aceite";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const quadro = vi.hoisted(() => ({
  dados: [] as unknown[][], resize: 0, fromData: [] as unknown[], limpou: 0, props: null as any,
}));
vi.mock("react-signature-canvas", async () => {
  const React = await import("react");
  class QuadroFalso extends React.Component<any> {
    canvas: HTMLCanvasElement | null = null;
    componentDidMount() { quadro.props = this.props; this._resizeCanvas(); }
    getCanvas() { return this.canvas!; }
    isEmpty() { return quadro.dados.length === 0; }
    clear() { quadro.dados = []; quadro.limpou++; }
    toData() { return quadro.dados; }
    fromData(d: unknown[][]) { quadro.dados = d; quadro.fromData.push(d); }
    // a regra da biblioteca: tamanho interno = exibido × densidade, e o desenho é apagado
    _resizeCanvas() { const c = this.canvas!; const r = Math.max(window.devicePixelRatio || 1, 1); c.width = c.offsetWidth * r; c.height = c.offsetHeight * r; quadro.dados = []; quadro.resize++; }
    render() { return React.createElement("canvas", { ...this.props.canvasProps, ref: (c: HTMLCanvasElement | null) => { this.canvas = c; } }); }
  }
  return { default: QuadroFalso };
});

const tela = { largura: 312, altura: 176 };
const p = (x: number, y: number) => ({ x, y, time: 1, color: "#1A2230" });
const ASSINATURA = [[p(30, 100), p(60, 70), p(90, 120), p(120, 70), p(150, 120)], [p(170, 60), p(190, 130)]];

let raiz: Root; let caixa: HTMLDivElement; let aoConfirmar: ReturnType<typeof vi.fn>;
beforeEach(() => {
  quadro.dados = []; quadro.resize = 0; quadro.fromData = []; quadro.limpou = 0;
  tela.largura = 312; tela.altura = 176;
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
  Object.defineProperty(HTMLCanvasElement.prototype, "offsetWidth", { configurable: true, get: () => tela.largura });
  Object.defineProperty(HTMLCanvasElement.prototype, "offsetHeight", { configurable: true, get: () => tela.altura });
  // O canvas de saída: a imagem "diz" o tamanho do recorte (para conferir sem desenhar de verdade)
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value() { return { drawImage: () => undefined, getTransform: () => ({ a: 2 }) }; } });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", { configurable: true, value(this: HTMLCanvasElement) { return `data:image/png;base64,W${this.width}H${this.height}${"A".repeat(200)}`; } });
  aoConfirmar = vi.fn(async () => null);
  caixa = document.createElement("div"); document.body.appendChild(caixa); raiz = createRoot(caixa);
});
afterEach(() => { act(() => raiz.unmount()); caixa.remove(); });

const esperar = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const $ = (s: string) => caixa.querySelector(s) as HTMLElement | null;
async function montar() {
  const { AssinaturaDoCliente } = await import("@/components/os/aceite-assinatura");
  await act(async () => { raiz.render(createElement(AssinaturaDoCliente, { resumo: "OS-1301 · Clínica Exemplo", aoConfirmar, aoCancelar: vi.fn() })); });
  await esperar();
}
const nome = async (v: string) => {
  const el = caixa.querySelector("input[aria-label='Nome de quem recebeu o serviço']") as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const assinar = () => { quadro.dados = structuredClone(ASSINATURA); };
const evento = async (tipo: string) => { await act(async () => { window.dispatchEvent(new Event(tipo)); }); await esperar(); };
const girar = async (tipo = "resize") => { [tela.largura, tela.altura] = [466, 176]; await evento(tipo); };
const confirmar = async () => { await act(async () => { $("[data-confirmar-aceite]")!.click(); }); await esperar(); };

describe("o quadro do aceite muda de tamanho sem apagar o traço", () => {
  it("o quadro do app não se limpa sozinho ao redimensionar (clearOnResize desligado)", async () => {
    await montar();
    expect(quadro.props.clearOnResize).toBe(false);
    expect(caixa.querySelector("canvas")!.getAttribute("aria-label")).toBe("Quadro de assinatura");
  });

  it("assinou e girou: o quadro é refeito no tamanho novo e o traço volta, redesenhado em escala (sem distorcer)", async () => {
    await montar();
    assinar();
    await girar();
    expect(quadro.resize).toBe(2); // o da montagem e o do giro
    expect(caixa.querySelector("canvas")!.width).toBe(466 * 2);
    expect(quadro.dados).toHaveLength(2);
    const pts = (quadro.dados as { x: number; y: number }[][]).flat(), orig = ASSINATURA.flat();
    // mesmo desenho (mesmas distâncias entre os pontos: escala 1), só deslocado para o centro relativo
    const dx = pts[0].x - orig[0].x, dy = pts[0].y - orig[0].y;
    pts.forEach((q, i) => { expect(q.x - orig[i].x).toBeCloseTo(dx, 9); expect(q.y - orig[i].y).toBeCloseTo(dy, 9); });
    expect(dx).toBeGreaterThan(0);
  });

  it("girar de volta devolve a assinatura no lugar de antes", async () => {
    await montar();
    assinar();
    await girar();
    [tela.largura, tela.altura] = [312, 176]; await evento("resize");
    (quadro.dados as { x: number; y: number }[][]).flat().forEach((q, i) => { expect(q.x).toBeCloseTo(ASSINATURA.flat()[i].x, 9); expect(q.y).toBeCloseTo(ASSINATURA.flat()[i].y, 9); });
  });

  it("o evento de rotação (orientationchange) também redesenha", async () => {
    await montar();
    assinar();
    await girar("orientationchange");
    expect(quadro.resize).toBe(2);
    expect(quadro.dados).toHaveLength(2);
  });

  it("teclado abriu ou a tela rolou (o quadro tem o mesmo tamanho): nada é refeito, o traço fica como está", async () => {
    await montar();
    assinar();
    const antes = structuredClone(quadro.dados);
    await evento("resize");
    expect(quadro.resize).toBe(1); // só o da montagem
    expect(quadro.fromData).toEqual([]);
    expect(quadro.dados).toEqual(antes);
  });

  it("quadro vazio e girado: continua vazio (não inventa traço)", async () => {
    await montar();
    await girar();
    expect(quadro.dados).toEqual([]);
    expect(quadro.fromData).toEqual([]);
  });
});

describe("Limpar, vazia e confirmar", () => {
  it("assinatura vazia não envia", async () => {
    await montar();
    await nome("Carla Mendes");
    await confirmar();
    expect($("[data-erro-aceite]")!.textContent).toContain(MSG_ASSINATURA);
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it("'Limpar' continua limpando; limpou e girou: ainda vazia, não envia", async () => {
    await montar();
    await nome("Carla Mendes");
    assinar();
    await act(async () => { $("[data-limpar-assinatura]")!.click(); });
    expect(quadro.limpou).toBe(1);
    await girar();
    await confirmar();
    expect($("[data-erro-aceite]")!.textContent).toContain(MSG_ASSINATURA);
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it("confirmar depois de girar: manda o nome e a imagem RECORTADA (o mesmo recorte de quem não girou)", async () => {
    await montar();
    await nome("Carla Mendes");
    assinar();
    await girar();
    await confirmar();
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    const { nome: n, assinatura } = aoConfirmar.mock.calls[0][0];
    expect(n).toBe("Carla Mendes");
    // recorte com margem de 12 px em escala 2: a assinatura de 160 × 70 px vira ~368 × 188, em qualquer orientação
    const [, w, h] = assinatura.match(/W(\d+)H(\d+)/)!.map(Number);
    expect(Math.abs(w - 368)).toBeLessThanOrEqual(2);
    expect(Math.abs(h - 188)).toBeLessThanOrEqual(2);
  });

  it("dois toques rápidos em Confirmar: um aceite só", async () => {
    let soltar: () => void = () => undefined;
    aoConfirmar = vi.fn(() => new Promise<null>((ok) => { soltar = () => ok(null); }));
    await montar();
    await nome("Carla Mendes");
    assinar();
    await act(async () => { $("[data-confirmar-aceite]")!.click(); $("[data-confirmar-aceite]")!.click(); });
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    await act(async () => { soltar(); });
    await esperar();
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
  });
});
