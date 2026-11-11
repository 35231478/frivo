/**
 * Leitura de QR Code — o motor que funciona em QUALQUER navegador (lib/qr/leitor.ts):
 *  - o jsQR lê QR codes de verdade a partir dos pixels (o caminho do iPhone, onde não há BarcodeDetector);
 *  - o detector nativo só é usado quando existe E lê QR;
 *  - a câmera é pedida do jeito certo (getUserMedia, traseira, sem áudio) e cada erro vira uma
 *    mensagem que SEMPRE aponta a saída (foto do QR ou código digitado);
 *  - nada aqui usa a rede.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LADOS_FOTO, LADO_QUADRO, MSG_FOTO_INVALIDA, MSG_FOTO_SEM_QR, MSG_SEM_API_CAMERA, abrirCamera, detectorNativo, lerQrDosPixels, motivoSemCamera, pararCamera,
  recorteCentral, reducao,
} from "@/lib/qr/leitor";
import { imagemLisa, imagemQr } from "./qr-exemplo";

afterEach(() => { vi.unstubAllGlobals(); delete (globalThis as any).BarcodeDetector; });

const ler = (i: { dados: Uint8ClampedArray; largura: number; altura: number }, completo = false) => lerQrDosPixels(i.dados, i.largura, i.altura, completo);

describe("jsQR: lê o QR dos pixels (o caminho do iPhone)", () => {
  it("lê os QR que o sistema imprime: o link público da etiqueta e os códigos (inclusive depois do 9999)", () => {
    for (const valor of ["https://app.frivo.com.br/qr/tok-avulso-500", "QR-2026-0500", "QR-10000", "QR-104"]) {
      expect(ler(imagemQr(valor)), valor).toBe(valor);
    }
  });

  it("lê no tamanho do quadro da câmera (480 px) e também pequeno no meio de um quadro grande", () => {
    expect(ler(imagemQr("QR-2026-0500", LADO_QUADRO))).toBe("QR-2026-0500");
    expect(ler(imagemQr("QR-2026-0500", 480, 480, { ocupacao: 0.45 }))).toBe("QR-2026-0500"); // QR longe: ocupa menos da metade
    expect(ler(imagemQr("https://app.frivo.com.br/qr/abc", 1000, 750))).toBe("https://app.frivo.com.br/qr/abc"); // foto retangular
  });

  it("QR invertido (claro sobre escuro): só na leitura completa (a da foto); na câmera, o quadro seguinte tenta de novo", () => {
    const invertido = imagemQr("QR-104", 480, 480, { invertido: true });
    expect(ler(invertido)).toBeNull();
    expect(ler(invertido, true)).toBe("QR-104");
  });

  it("sem QR na imagem: null — e entradas quebradas (tamanho zero, pixels a menos) não lançam", () => {
    expect(ler(imagemLisa())).toBeNull();
    expect(lerQrDosPixels(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(lerQrDosPixels(new Uint8ClampedArray(16), 480, 480)).toBeNull();
  });

  it("devolve o texto sem espaços nas pontas", () => {
    expect(ler(imagemQr("  QR-104  "))).toBe("QR-104");
  });
});

describe("detector nativo (BarcodeDetector): só quando existe e lê QR", () => {
  it("iPhone / WebKit — a classe não existe: null (vale o jsQR)", async () => {
    expect("BarcodeDetector" in globalThis).toBe(false);
    expect(await detectorNativo()).toBeNull();
  });

  it("existe e lê QR (Chrome no Android): usa, pedindo só o formato qr_code", async () => {
    const detect = vi.fn(async () => [{ rawValue: " QR-104 " }]);
    const construtor = vi.fn();
    (globalThis as any).BarcodeDetector = class { static getSupportedFormats = async () => ["ean_13", "qr_code"]; constructor(o: unknown) { construtor(o); } detect = detect; };
    const d = await detectorNativo();
    expect(construtor).toHaveBeenCalledWith({ formats: ["qr_code"] });
    expect(await d!("video" as any)).toBe("QR-104");
    detect.mockResolvedValueOnce([]);
    expect(await d!("video" as any)).toBeNull();
  });

  it("a classe existe mas NÃO lê QR (alguns navegadores de desktop): null — antes isso travava a leitura", async () => {
    (globalThis as any).BarcodeDetector = class { static getSupportedFormats = async () => [] as string[]; detect = async () => []; };
    expect(await detectorNativo()).toBeNull();
    (globalThis as any).BarcodeDetector = class { static getSupportedFormats = async () => ["ean_13", "code_128"]; detect = async () => []; };
    expect(await detectorNativo()).toBeNull();
  });

  it("a classe existe mas quebra ao consultar ou construir: null, sem lançar", async () => {
    (globalThis as any).BarcodeDetector = class { static getSupportedFormats = async () => { throw new Error("não suportado"); }; };
    expect(await detectorNativo()).toBeNull();
    (globalThis as any).BarcodeDetector = class { static getSupportedFormats = async () => ["qr_code"]; constructor() { throw new Error("falhou"); } };
    expect(await detectorNativo()).toBeNull();
  });
});

describe("recortes", () => {
  it("câmera: o quadrado central do vídeo (o que o visor mostra), reduzido para 480", () => {
    expect(recorteCentral(1280, 720)).toEqual({ sx: 280, sy: 0, lado: 720, destino: 480 });
    expect(recorteCentral(720, 1280)).toEqual({ sx: 0, sy: 280, lado: 720, destino: 480 }); // celular em pé
    expect(recorteCentral(320, 240)).toEqual({ sx: 40, sy: 0, lado: 240, destino: 240 }); // câmera pequena: não amplia
  });

  it("foto: reduz mantendo a proporção e nunca amplia; tenta do maior para o menor", () => {
    expect(reducao(4032, 3024, 1600)).toEqual({ largura: 1600, altura: 1200 });
    expect(reducao(800, 600, 1600)).toEqual({ largura: 800, altura: 600 });
    expect([...LADOS_FOTO]).toEqual([1600, 1000, 600]);
  });
});

describe("câmera: pedir do jeito certo e explicar quando não abre", () => {
  const comMidia = (getUserMedia: unknown) => vi.stubGlobal("navigator", { mediaDevices: getUserMedia ? { getUserMedia } : undefined });
  const erro = (name: string) => Object.assign(new Error(name), { name });

  it("pede a câmera TRASEIRA (como preferência), só vídeo, sem áudio", async () => {
    const stream = { getTracks: () => [] };
    const gum = vi.fn(async () => stream); comMidia(gum);
    expect(await abrirCamera()).toBe(stream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
  });

  it("aparelho sem câmera 'traseira' (notebook): aceita qualquer câmera", async () => {
    const stream = { getTracks: () => [] };
    const gum = vi.fn().mockRejectedValueOnce(erro("OverconstrainedError")).mockResolvedValueOnce(stream); comMidia(gum);
    expect(await abrirCamera()).toBe(stream);
    expect(gum.mock.calls[1][0]).toEqual({ video: true, audio: false });
  });

  it("permissão negada: o erro sobe (a tela mostra as saídas) — não insiste sozinho", async () => {
    const gum = vi.fn().mockRejectedValue(erro("NotAllowedError")); comMidia(gum);
    await expect(abrirCamera()).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("navegador sem a API de câmera (página fora de HTTPS, webview antiga): erro próprio, sem quebrar", async () => {
    comMidia(null);
    await expect(abrirCamera()).rejects.toMatchObject({ name: "SemApiCamera" });
    vi.stubGlobal("navigator", undefined);
    await expect(abrirCamera()).rejects.toMatchObject({ name: "SemApiCamera" });
  });

  it("cada motivo vira uma frase curta que SEMPRE aponta as duas saídas: foto do QR ou código digitado", () => {
    const frases = [
      motivoSemCamera(erro("NotAllowedError")), motivoSemCamera(erro("SecurityError")), motivoSemCamera(erro("NotFoundError")), motivoSemCamera(erro("OverconstrainedError")),
      motivoSemCamera(erro("NotReadableError")), motivoSemCamera(erro("AbortError")), motivoSemCamera(erro("Outro")), motivoSemCamera(null), MSG_SEM_API_CAMERA,
    ];
    for (const f of frases) {
      expect(f, f).toMatch(/foto do QR/i);
      expect(f, f).toMatch(/digite o código/i);
      expect(f.length, f).toBeLessThan(110);
      expect(f, f).not.toMatch(/não suporta/i); // a mensagem do bug
    }
    expect(motivoSemCamera(erro("NotAllowedError"))).toBe("Câmera bloqueada neste navegador. Libere o acesso, tire uma foto do QR ou digite o código.");
    expect(motivoSemCamera(erro("NotFoundError"))).toMatch(/^Nenhuma câmera encontrada/);
    expect(motivoSemCamera(erro("NotReadableError"))).toMatch(/em uso por outro app/);
    for (const f of [MSG_FOTO_SEM_QR, MSG_FOTO_INVALIDA]) expect(f.length).toBeLessThan(110);
  });

  it("fechar o leitor desliga a câmera (todas as faixas)", () => {
    const faixas = [{ stop: vi.fn() }, { stop: vi.fn() }];
    pararCamera({ getTracks: () => faixas } as any);
    expect(faixas.every((f) => f.stop.mock.calls.length === 1)).toBe(true);
    expect(() => pararCamera(null)).not.toThrow();
  });
});

describe("leitura local: funciona sem sinal", () => {
  it("o motor não usa a rede: nenhum fetch, XMLHttpRequest, WebSocket ou import remoto no código", () => {
    const fonte = fs.readFileSync(path.resolve(__dirname, "../../lib/qr/leitor.ts"), "utf8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    expect(fonte).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|https?:\/\/|import\(/);
    // E a biblioteca é uma dependência do próprio app (vai no pacote), não um script de fora
    const pacote = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pacote.dependencies.jsqr).toBe("1.4.0");
  });

  it("lê com a rede fora do ar (fetch que sempre falha nunca é chamado)", () => {
    const fetchFalso = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetchFalso);
    expect(ler(imagemQr("QR-2026-0500"))).toBe("QR-2026-0500");
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
