/**
 * App: assinatura do aceite (regra pura) — o quadro muda de tamanho sem perder nem distorcer o traço:
 *  - os dois formatos de traço da biblioteca (lista de pontos no signature_pad 2.x; { points } nas novas);
 *  - girar e voltar devolve a assinatura EXATAMENTE igual (cabe: escala 1, centro na mesma posição relativa);
 *  - não cabe: encolhe só o necessário, a MESMA escala nos dois eixos, inteira dentro do quadro;
 *  - a imagem salva é recortada com margem (a mesma em qualquer orientação) e a mesma no PDF, sem distorcer.
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ESCALA_ASSINATURA, MARGEM_ASSINATURA, caixaDosTracos, escalarTracos, precisaRedimensionar, tamanhoInterno, type PontoTraco, type Traco,
} from "@/lib/assinatura-quadro";
import { gerarRelatorioAtividadePdf } from "@/lib/relatorio-atividade-pdf";

const RETRATO = { largura: 312, altura: 176 };
const PAISAGEM = { largura: 466, altura: 176 };
const p = (x: number, y: number): PontoTraco => ({ x, y, time: 1, color: "#1A2230" });
/** Assinatura fictícia: um zigue-zague e um risco, no formato do signature_pad 2.x (lista de pontos) */
const ASSINATURA: PontoTraco[][] = [[p(30, 100), p(60, 70), p(90, 120), p(120, 70), p(150, 120)], [p(170, 60), p(190, 130)]];
const pontos = (t: Traco[]) => t.flatMap((x) => (Array.isArray(x) ? x : x.points));
const caixa = (t: Traco[]) => {
  const ps = pontos(t); const xs = ps.map((q) => q.x), ys = ps.map((q) => q.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const perto = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe("redesenhar ao mudar o tamanho do quadro", () => {
  it("mesmo tamanho (rolar, abrir o teclado): não mexe em nada", () => {
    expect(escalarTracos(ASSINATURA, RETRATO, { ...RETRATO })).toBe(ASSINATURA);
  });

  it("girar para paisagem e voltar: a assinatura volta exatamente igual", () => {
    const paisagem = escalarTracos(ASSINATURA, RETRATO, PAISAGEM);
    const volta = escalarTracos(paisagem, PAISAGEM, RETRATO);
    pontos(volta).forEach((q, i) => { perto(q.x, pontos(ASSINATURA)[i].x); perto(q.y, pontos(ASSINATURA)[i].y); });
  });

  it("cabe no quadro novo: mantém o tamanho (sem esticar) e o centro na mesma posição relativa", () => {
    const antes = caixa(ASSINATURA), depois = caixa(escalarTracos(ASSINATURA, RETRATO, PAISAGEM));
    perto(depois.x1 - depois.x0, antes.x1 - antes.x0);
    perto(depois.y1 - depois.y0, antes.y1 - antes.y0);
    perto((depois.x0 + depois.x1) / 2 / PAISAGEM.largura, (antes.x0 + antes.x1) / 2 / RETRATO.largura);
    perto((depois.y0 + depois.y1) / 2, (antes.y0 + antes.y1) / 2); // a altura não mudou
  });

  it("não cabe: encolhe com a MESMA escala nos dois eixos e fica inteira dentro do quadro, com margem", () => {
    const larga: PontoTraco[][] = [[p(20, 40), p(440, 150)], [p(200, 30), p(260, 160)]]; // assinada em paisagem
    const antes = caixa(larga), depois = caixa(escalarTracos(larga, PAISAGEM, RETRATO));
    const fx = (depois.x1 - depois.x0) / (antes.x1 - antes.x0), fy = (depois.y1 - depois.y0) / (antes.y1 - antes.y0);
    perto(fx, fy); // sem distorcer
    expect(fx).toBeLessThan(1);
    perto(depois.x1 - depois.x0, RETRATO.largura - 2 * MARGEM_ASSINATURA); // só o necessário
    expect(depois.x0).toBeGreaterThanOrEqual(MARGEM_ASSINATURA - 1e-9);
    expect(depois.x1).toBeLessThanOrEqual(RETRATO.largura - MARGEM_ASSINATURA + 1e-9);
    expect(depois.y0).toBeGreaterThanOrEqual(0);
    expect(depois.y1).toBeLessThanOrEqual(RETRATO.altura);
  });

  it("assinatura no canto: depois de mudar, continua inteira dentro do quadro", () => {
    const canto: PontoTraco[][] = [[p(400, 20), p(460, 60)]];
    const depois = caixa(escalarTracos(canto, PAISAGEM, RETRATO));
    expect(depois.x1).toBeLessThanOrEqual(RETRATO.largura - MARGEM_ASSINATURA + 1e-9);
    expect(depois.x0).toBeGreaterThanOrEqual(MARGEM_ASSINATURA - 1e-9);
  });

  it("formato novo ({ points }) também, preservando os outros campos do traço", () => {
    const novo = ASSINATURA.map((pts) => ({ points: pts, penColor: "#1A2230" }));
    const r = escalarTracos(novo, RETRATO, PAISAGEM);
    expect(r[0].penColor).toBe("#1A2230");
    expect(pontos(r)).toEqual(pontos(escalarTracos(ASSINATURA, RETRATO, PAISAGEM)));
    expect((pontos(r)[0] as PontoTraco).color).toBe("#1A2230"); // o ponto mantém a cor
  });

  it("quadro escondido (tamanho zero) ou sem traço: não mexe", () => {
    expect(escalarTracos(ASSINATURA, { largura: 0, altura: 0 }, PAISAGEM)).toBe(ASSINATURA);
    expect(escalarTracos(ASSINATURA, RETRATO, { largura: 0, altura: 176 })).toBe(ASSINATURA);
    expect(escalarTracos([], RETRATO, PAISAGEM)).toEqual([]);
  });

  it("o quadro só é refeito quando o tamanho exibido mudou de fato (com a densidade da tela)", () => {
    expect(tamanhoInterno(RETRATO, 3)).toEqual({ largura: 936, altura: 528 });
    expect(tamanhoInterno(RETRATO, undefined)).toEqual(RETRATO);
    expect(tamanhoInterno(RETRATO, 0.5)).toEqual(RETRATO); // nunca menos que 1
    expect(precisaRedimensionar({ largura: 936, altura: 528 }, RETRATO, 3)).toBe(false); // teclado abriu: o quadro é o mesmo
    expect(precisaRedimensionar({ largura: 936, altura: 528 }, PAISAGEM, 3)).toBe(true); // girou
    expect(precisaRedimensionar({ largura: 936, altura: 528 }, { largura: 312, altura: 200 }, 3)).toBe(true);
  });
});

describe("a imagem salva", () => {
  it("recorta a assinatura com margem, presa ao quadro; sem traço, nada a recortar", () => {
    expect(caixaDosTracos(ASSINATURA, MARGEM_ASSINATURA, RETRATO)).toEqual({ x: 18, y: 48, largura: 184, altura: 94 });
    expect(caixaDosTracos([[p(2, 3), p(310, 175)]], MARGEM_ASSINATURA, RETRATO)).toEqual({ x: 0, y: 0, largura: 312, altura: 176 });
    expect(caixaDosTracos([], MARGEM_ASSINATURA, RETRATO)).toBeNull();
    expect(caixaDosTracos([[]], MARGEM_ASSINATURA, RETRATO)).toBeNull();
  });

  it("a mesma assinatura em retrato ou paisagem dá o mesmo recorte (a imagem não depende da orientação)", () => {
    const r = caixaDosTracos(ASSINATURA, MARGEM_ASSINATURA, RETRATO)!;
    const l = caixaDosTracos(escalarTracos(ASSINATURA, RETRATO, PAISAGEM), MARGEM_ASSINATURA, PAISAGEM)!;
    expect(Math.abs(l.largura - r.largura)).toBeLessThanOrEqual(1); // arredondamento do pixel
    expect(Math.abs(l.altura - r.altura)).toBeLessThanOrEqual(1);
    expect(ESCALA_ASSINATURA).toBe(2);
  });

  it("no PDF do relatório, a assinatura entra com a proporção dela (sem esticar)", async () => {
    const png = pngLiso(184 * 2, 94 * 2); // o tamanho que o recorte acima gera
    const { bytes } = await gerarRelatorioAtividadePdf({
      empresa: { nome: "Polar Clima" }, os: { numero: "OS-1", criadoEm: new Date(), cliente: { nome: "Clínica Exemplo" } },
      atividade: { titulo: "Preventiva", tecnico: { nome: "Rafael Moura" } }, equipamentos: [], adicionais: [], fotosServico: [], materiais: [],
      aceite: { nome: "Carla Mendes", assinatura: `data:image/png;base64,${png.toString("base64")}`, confirmadoEm: new Date(), noLocal: true },
      numero: "REL-1", geradoEm: new Date(),
    });
    const [w, h] = await desenhoDaImagem(bytes);
    perto(Math.round((w / h) * 1000) / 1000, Math.round((184 / 94) * 1000) / 1000);
  });

  it("no aceite e no relatório (tela), a imagem é exibida sem distorcer (object-contain)", () => {
    const ler = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
    expect(ler("components/relatorio/atividade-documento.tsx")).toMatch(/className="[^"]*object-contain[^"]*" data-assinatura-atividade/);
    expect(ler("components/os/os-aceite.tsx")).toMatch(/className="[^"]*object-contain[^"]*" data-aceite-assinatura/);
  });
});

/* ───────── apoio: um PNG liso e a matriz com que o PDF desenha a imagem ───────── */
function pngLiso(largura: number, altura: number): Buffer {
  const crcTab = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloco = (tipo: string, dados: Buffer) => {
    const t = Buffer.concat([Buffer.from(tipo), dados]); const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([tam, t, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 0;
  const linhas = Buffer.alloc((largura + 1) * altura, 255); for (let y = 0; y < altura; y++) linhas[y * (largura + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(linhas)), bloco("IEND", Buffer.alloc(0))]);
}
async function desenhoDaImagem(bytes: Uint8Array): Promise<[number, number]> {
  const doc = await PDFDocument.load(bytes);
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string; try { s = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1"); } catch { continue; }
    // pdf-lib: translada, gira (identidade), ESCALA (largura × altura), inclina (identidade), desenha
    const m = s.match(/([\d.]+) 0 0 ([\d.]+) 0 0 cm\n1 0 0 1 0 0 cm\n\/Image[\w-]* Do/);
    if (m) return [Number(m[1]), Number(m[2])];
  }
  throw new Error("imagem não desenhada no PDF");
}
