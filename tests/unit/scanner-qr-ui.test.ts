// @vitest-environment happy-dom
/**
 * Leitor de QR Code (components/os/scanner-qr.tsx) — o componente num DOM de verdade, com QR codes de
 * verdade nos "quadros da câmera" (o jsQR decodifica os pixels; só a câmera e o canvas são simulados).
 *
 * O BUG: no iPhone (Safari e Chrome do iOS) aparecia "o navegador não suporta leitura de QR" — o
 * leitor só usava o BarcodeDetector, que o WebKit não tem. Agora:
 *  - iPhone (sem BarcodeDetector): abre a câmera e lê com o jsQR;
 *  - Android/Chrome (com BarcodeDetector que lê QR): usa o nativo; se falhar, passa para o jsQR;
 *  - câmera bloqueada, inexistente ou sem a API: explica e deixa DUAS saídas — foto do QR e código
 *    digitado — além de "tentar de novo";
 *  - tudo local: lê com a rede fora do ar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MSG_FOTO_INVALIDA, MSG_FOTO_SEM_QR, MSG_SEM_API_CAMERA } from "@/lib/qr/leitor";
import { imagemLisa, imagemQr, type ImagemQr } from "./qr-exemplo";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/* ───────── o "aparelho" simulado ───────── */
/** O que a câmera (ou a foto) está vendo: o canvas devolve estes pixels, no tamanho pedido */
let cena: (largura: number, altura: number) => ImagemQr;
let quadros = 0;
let faixas: { stop: ReturnType<typeof vi.fn> }[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;
let desenhos: unknown[] = [];
const fetchFalso = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

const erro = (name: string) => Object.assign(new Error(name), { name });
const cameraQueAbre = () => vi.fn(async () => { const f = [{ stop: vi.fn() }]; faixas.push(...f); return { getTracks: () => f }; });

function ligarAparelho(op: { midia?: boolean } = {}) {
  Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: op.midia === false ? undefined : { getUserMedia: (...a: unknown[]) => getUserMedia(...a) } });
  // Vídeo: "tocando", 1280×720 (o leitor recorta o quadrado central e reduz para 480)
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: async () => undefined });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1280 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 720 });
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { configurable: true, writable: true, value: null });
  // Canvas: desenhar registra a fonte; ler os pixels devolve a cena no tamanho pedido
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      drawImage: (...a: unknown[]) => { desenhos.push(a[0]); },
      getImageData: (_x: number, _y: number, w: number, h: number) => { quadros += 1; return { data: cena(w, h).dados, width: w, height: h }; },
    }),
  });
}

let root: Root; let caixa: HTMLDivElement;
let onLer: ReturnType<typeof vi.fn>; let onFechar: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cena = (w, h) => imagemQr("QR-2026-0500", w, h);
  quadros = 0; faixas = []; desenhos = []; getUserMedia = cameraQueAbre();
  onLer = vi.fn(); onFechar = vi.fn(); fetchFalso.mockClear();
  delete (globalThis as any).BarcodeDetector; // o padrão dos testes é o iPhone: sem detector nativo
  vi.stubGlobal("fetch", fetchFalso);
  ligarAparelho();
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = ""; root = undefined as unknown as Root;
  delete (globalThis as any).BarcodeDetector; delete (globalThis as any).createImageBitmap;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

const esperar = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function esperarAte(cond: () => boolean, msg: string) {
  for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(10); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const leitor = () => $("[data-scanner-qr]")!;
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

async function abrir(props: Record<string, unknown> = {}) {
  const { ScannerQR } = await import("@/components/os/scanner-qr");
  if (!root) { caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa); }
  await act(async () => { root.render(createElement(ScannerQR, { onLer, onFechar, ...props } as any)); });
  await esperar();
}
async function escolherFoto(nome = "qr.jpg") {
  const input = $<HTMLInputElement>("[data-scanner-foto]")!;
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], nome, { type: "image/jpeg" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar(40);
}

/* ═════════════════════════ iPhone: o bug ═════════════════════════ */
describe("iPhone (Safari e Chrome do iOS): sem BarcodeDetector", () => {
  it("NÃO diz mais que o navegador não suporta: abre a câmera e lê o QR com o jsQR", async () => {
    expect("BarcodeDetector" in window).toBe(false);
    await abrir();
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    expect(onLer).toHaveBeenCalledTimes(1);
    expect(onLer).toHaveBeenCalledWith("QR-2026-0500");
    expect(leitor().getAttribute("data-motor")).toBe("jsqr");
    expect(texto()).not.toMatch(/não suporta/i);
    // Leu o vídeo da câmera, pelo canvas
    expect(desenhos[0]).toBe($("video"));
  });

  it("pede a câmera do jeito certo: getUserMedia, traseira, sem áudio; o vídeo vai com playsinline e mudo (exigência do iOS)", async () => {
    await abrir();
    await esperarAte(() => getUserMedia.mock.calls.length > 0, "câmera pedida");
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const video = $<HTMLVideoElement>("video")!;
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.muted).toBe(true);
  });

  it("lê o link público da etiqueta (o que o QR impresso carrega), não só o código curto", async () => {
    cena = (w, h) => imagemQr("https://app.frivo.com.br/qr/tok-avulso-500", w, h);
    await abrir();
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    expect(onLer).toHaveBeenCalledWith("https://app.frivo.com.br/qr/tok-avulso-500");
  });

  it("câmera apontada para o nada: continua olhando quadro a quadro; quando o QR aparece, lê — uma vez só", async () => {
    cena = (w, h) => imagemLisa(w, h);
    await abrir();
    await esperarAte(() => quadros >= 3, "alguns quadros sem QR");
    expect(onLer).not.toHaveBeenCalled();
    expect(leitor().getAttribute("data-fase")).toBe("lendo");
    expect(texto($("[data-scanner-dica]"))).toBe("Aponte para o QR Code. A leitura é feita no aparelho, mesmo sem sinal.");
    cena = (w, h) => imagemQr("QR-104", w, h);
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    const lidos = quadros;
    await esperar(400); // o mesmo QR continua na frente da câmera
    expect(onLer).toHaveBeenCalledTimes(1);
    expect(quadros).toBe(lidos); // parou de ler depois de entregar
  });

  it("SEM SINAL: lê igual — nenhuma chamada de rede", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    await abrir();
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    expect(onLer).toHaveBeenCalledWith("QR-2026-0500");
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("fechar o leitor desliga a câmera", async () => {
    cena = (w, h) => imagemLisa(w, h);
    await abrir();
    await esperarAte(() => faixas.length > 0 && leitor().getAttribute("data-fase") === "lendo", "câmera aberta");
    await clicar($("[aria-label='Fechar']"));
    expect(onFechar).toHaveBeenCalledTimes(1);
    act(() => root.unmount()); root = undefined as unknown as Root;
    expect(faixas[0].stop).toHaveBeenCalledTimes(1);
  });

  it("o pai redesenha com outra função (acontece a cada render): a câmera NÃO reinicia, e a leitura chega na função nova", async () => {
    cena = (w, h) => imagemLisa(w, h);
    await abrir();
    await esperarAte(() => leitor().getAttribute("data-fase") === "lendo", "lendo");
    const novo = vi.fn();
    await abrir({ onLer: novo });
    await abrir({ onLer: novo, onFechar: vi.fn() });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    cena = (w, h) => imagemQr("QR-104", w, h);
    await esperarAte(() => novo.mock.calls.length > 0, "QR lido");
    expect(novo).toHaveBeenCalledWith("QR-104");
    expect(onLer).not.toHaveBeenCalled();
  });
});

/* ═════════════════════════ Android / Chrome ═════════════════════════ */
describe("Chrome / Android: com BarcodeDetector", () => {
  const comDetector = (detect: (...a: unknown[]) => Promise<{ rawValue?: string }[]>, formatos = ["qr_code"]) => {
    (globalThis as any).BarcodeDetector = class { static getSupportedFormats = async () => formatos; detect = detect; };
  };

  it("que lê QR: usa o detector do navegador direto no vídeo (sem passar pelo canvas)", async () => {
    const detect = vi.fn(async (..._fonte: unknown[]) => [{ rawValue: "QR-NATIVO-7" }]); comDetector(detect);
    await abrir();
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    expect(onLer).toHaveBeenCalledWith("QR-NATIVO-7");
    expect(leitor().getAttribute("data-motor")).toBe("nativo");
    expect(detect.mock.calls[0][0]).toBe($("video"));
    expect(quadros).toBe(0);
  });

  it("que NÃO lê QR (a classe existe, sem o formato): cai no jsQR e lê — antes ficava olhando para sempre", async () => {
    const detect = vi.fn(async () => []); comDetector(detect, ["ean_13"]);
    await abrir();
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    expect(onLer).toHaveBeenCalledWith("QR-2026-0500");
    expect(leitor().getAttribute("data-motor")).toBe("jsqr");
    expect(detect).not.toHaveBeenCalled();
  });

  it("detector que começa a falhar no meio: depois de 3 falhas seguidas, a leitura passa para o jsQR", async () => {
    const detect = vi.fn(async () => { throw new Error("serviço de detecção indisponível"); }); comDetector(detect);
    await abrir();
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    expect(detect).toHaveBeenCalledTimes(3);
    expect(leitor().getAttribute("data-motor")).toBe("jsqr");
    expect(onLer).toHaveBeenCalledWith("QR-2026-0500");
  });
});

/* ═════════════════════════ a câmera não abre ═════════════════════════ */
describe("a câmera não abre: o técnico nunca fica sem saída", () => {
  const saidas = () => ({ foto: $("[data-scanner-tirar-foto]"), tentar: $("[data-scanner-tentar]"), manual: $<HTMLInputElement>("[data-scanner-manual]") });

  it("permissão NEGADA: explica e oferece foto do QR, tentar de novo e digitar — tudo com 44 px", async () => {
    getUserMedia = vi.fn().mockRejectedValue(erro("NotAllowedError"));
    await abrir();
    await esperarAte(() => leitor().getAttribute("data-fase") === "sem-camera", "sem câmera");
    expect(texto($("[data-scanner-aviso]"))).toBe("Câmera bloqueada neste navegador. Libere o acesso, tire uma foto do QR ou digite o código.");
    expect($("[data-scanner-aviso]")!.getAttribute("role")).toBe("alert");
    expect($("video")).toBeNull(); // sem o quadrado preto inútil
    const s = saidas();
    expect(texto(s.foto)).toBe("Tirar foto do QR");
    expect(texto(s.tentar)).toBe("Tentar a câmera de novo");
    expect(s.manual).toBeTruthy();
    for (const b of [s.foto!, s.tentar!, $("[aria-label='Fechar']")!]) expect(b.className).toContain("touch-target");
    expect(s.manual!.className).toContain("min-h-[44px]");
    expect(texto()).not.toMatch(/não suporta/i);
    expect(onLer).not.toHaveBeenCalled();
  });

  it("cada motivo com a sua frase: sem câmera no aparelho, câmera em uso, e navegador sem a API", async () => {
    for (const [nome, inicio] of [["NotFoundError", "Nenhuma câmera encontrada."], ["NotReadableError", "A câmera está em uso por outro app."], ["Qualquer", "Não foi possível abrir a câmera."]] as const) {
      getUserMedia = vi.fn().mockRejectedValue(erro(nome));
      await abrir();
      await esperarAte(() => !!$("[data-scanner-aviso]"), nome);
      expect(texto($("[data-scanner-aviso]")), nome).toContain(inicio);
      expect(saidas().foto, nome).toBeTruthy();
      act(() => root.unmount()); root = undefined as unknown as Root; document.body.innerHTML = "";
    }
    ligarAparelho({ midia: false });
    await abrir();
    await esperarAte(() => !!$("[data-scanner-aviso]"), "sem API");
    expect(texto($("[data-scanner-aviso]"))).toBe(MSG_SEM_API_CAMERA);
    expect(saidas().foto).toBeTruthy();
    expect(saidas().manual).toBeTruthy();
  });

  it("liberou a câmera e tocou 'Tentar a câmera de novo': abre e lê", async () => {
    getUserMedia = vi.fn().mockRejectedValueOnce(erro("NotAllowedError")).mockImplementation(cameraQueAbre());
    await abrir();
    await esperarAte(() => !!$("[data-scanner-tentar]"), "sem câmera");
    await clicar($("[data-scanner-tentar]"));
    await esperarAte(() => onLer.mock.calls.length > 0, "QR lido");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(onLer).toHaveBeenCalledWith("QR-2026-0500");
  });
});

/* ═════════════════════════ foto do QR ═════════════════════════ */
describe("saída 1 — tirar uma FOTO do QR", () => {
  const comFoto = (largura = 4032, altura = 3024) => { (globalThis as any).createImageBitmap = vi.fn(async () => ({ width: largura, height: altura, close: vi.fn() })); };

  it("o botão abre a câmera do sistema (capture) e aceita só imagem; está lá mesmo com a câmera ao vivo funcionando", async () => {
    cena = (w, h) => imagemLisa(w, h);
    await abrir();
    await esperarAte(() => leitor().getAttribute("data-fase") === "lendo", "lendo");
    const input = $<HTMLInputElement>("[data-scanner-foto]")!;
    expect([input.type, input.accept, input.getAttribute("capture")]).toEqual(["file", "image/*", "environment"]);
    expect($("[data-scanner-tirar-foto]")).toBeTruthy();
    expect($("[data-scanner-tentar]")).toBeNull(); // "tentar de novo" só quando a câmera não abriu
  });

  it("com a câmera BLOQUEADA: a foto é lida no aparelho (jsQR) e o QR é entregue", async () => {
    getUserMedia = vi.fn().mockRejectedValue(erro("NotAllowedError"));
    comFoto();
    cena = (w, h) => imagemQr("https://app.frivo.com.br/qr/tok-da-foto", w, h, { ocupacao: 0.5 });
    await abrir();
    await esperarAte(() => !!$("[data-scanner-tentar]"), "sem câmera");
    await escolherFoto();
    await esperarAte(() => onLer.mock.calls.length > 0, "QR da foto");
    expect(onLer).toHaveBeenCalledWith("https://app.frivo.com.br/qr/tok-da-foto");
    expect(fetchFalso).not.toHaveBeenCalled(); // a foto não sai do aparelho
  });

  it("foto SEM QR: avisa o que fazer e continua aberto para tentar de novo — nada é entregue", async () => {
    getUserMedia = vi.fn().mockRejectedValue(erro("NotAllowedError"));
    comFoto();
    cena = (w, h) => imagemLisa(w, h);
    await abrir();
    await esperarAte(() => !!$("[data-scanner-tentar]"), "sem câmera");
    await escolherFoto();
    await esperarAte(() => texto($("[data-scanner-aviso]")) === MSG_FOTO_SEM_QR, "aviso da foto");
    expect(onLer).not.toHaveBeenCalled();
    expect(quadros).toBe(3); // tentou nos três tamanhos
    expect($<HTMLButtonElement>("[data-scanner-tirar-foto]")!.disabled).toBe(false);
    // A segunda foto, boa, lê
    cena = (w, h) => imagemQr("QR-104", w, h);
    await escolherFoto("outra.jpg");
    await esperarAte(() => onLer.mock.calls.length > 0, "QR da 2ª foto");
    expect(onLer).toHaveBeenCalledWith("QR-104");
  });

  it("arquivo que não abre como imagem: avisa, sem quebrar, e as outras saídas continuam", async () => {
    getUserMedia = vi.fn().mockRejectedValue(erro("NotAllowedError"));
    (globalThis as any).createImageBitmap = vi.fn(async () => { throw new Error("formato"); });
    vi.stubGlobal("Image", class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_v: string) { queueMicrotask(() => this.onerror?.()); } });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
    await abrir();
    await esperarAte(() => !!$("[data-scanner-tentar]"), "sem câmera");
    await escolherFoto("quebrada.heic");
    await esperarAte(() => texto($("[data-scanner-aviso]")) === MSG_FOTO_INVALIDA, "aviso de foto inválida");
    expect(onLer).not.toHaveBeenCalled();
    expect($("[data-scanner-manual]")).toBeTruthy();
  });
});

/* ═════════════════════════ digitar ═════════════════════════ */
describe("saída 2 — digitar o código", () => {
  const digitar = async (v: string) => {
    const el = $<HTMLInputElement>("[data-scanner-manual]")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await esperar();
  };
  const confirmar = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => texto(b) === "Confirmar")!;

  it("sempre disponível (com ou sem câmera): confirma o código digitado, sem espaços nas pontas; vazio não confirma", async () => {
    getUserMedia = vi.fn().mockRejectedValue(erro("NotAllowedError"));
    await abrir();
    await esperarAte(() => !!$("[data-scanner-tentar]"), "sem câmera");
    expect(confirmar().disabled).toBe(true);
    await digitar("   ");
    expect(confirmar().disabled).toBe(true);
    await digitar("  QR-2026-0500 ");
    await clicar(confirmar());
    expect(onLer).toHaveBeenCalledTimes(1);
    expect(onLer).toHaveBeenCalledWith("QR-2026-0500");
  });

  it("com a câmera aberta e sem conseguir focar: digitar funciona do mesmo jeito (Enter confirma)", async () => {
    cena = (w, h) => imagemLisa(w, h);
    await abrir();
    await esperarAte(() => leitor().getAttribute("data-fase") === "lendo", "lendo");
    await digitar("QR-104");
    await act(async () => { $("[data-scanner-manual]")!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(onLer).toHaveBeenCalledWith("QR-104");
  });
});

describe("acessibilidade", () => {
  it("é um diálogo com nome; o fechar tem rótulo; o campo de digitar tem rótulo ligado a ele", async () => {
    await abrir();
    expect(leitor().getAttribute("role")).toBe("dialog");
    expect(leitor().getAttribute("aria-modal")).toBe("true");
    expect(leitor().getAttribute("aria-label")).toBe("Ler QR Code do equipamento");
    expect($("[aria-label='Fechar']")!.getAttribute("type")).toBe("button");
    const campo = $<HTMLInputElement>("[data-scanner-manual]")!;
    expect(texto($(`label[for='${campo.id}']`))).toBe("Ou digite o código (ou cole o link do QR)");
  });
});
