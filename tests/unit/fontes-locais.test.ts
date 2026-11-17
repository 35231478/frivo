/**
 * AS FONTES SÃO ARQUIVOS DO PROJETO — o build não busca nada no Google.
 *
 * Por que este arquivo existe: `next/font/google` baixa as fontes do Google Fonts DURANTE o build.
 * Quando essa busca falhava (rede intermitente), o deploy caía com "An error occurred in next/font"
 * sem nada de errado no código. As fontes passaram para `next/font/local`, com os mesmos arquivos
 * que o Google servia.
 *
 * O que se prova:
 *  - nenhum arquivo do sistema volta a usar `next/font/google` nem aponta para o Google Fonts;
 *  - cada fonte declarada existe, é um woff2 de verdade e é usada (nenhum arquivo solto);
 *  - a Inter segue variável (100–900) e o Archivo com 600 e 700, nas mesmas variáveis de antes;
 *  - os subconjuntos além do latim têm o intervalo de caracteres de cada um, e a pilha de fontes os
 *    consulta ANTES da face latina (senão um "Ω" cairia na fonte de reserva antes de achar o arquivo);
 *  - as licenças (OFL) acompanham os arquivos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import config from "../../tailwind.config";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (arquivo: string) => readFileSync(path.join(RAIZ, arquivo), "utf8");
const PASTA = path.join(RAIZ, "app/fonts");

/** Todos os arquivos de código do sistema (sem node_modules, .next, testes e documentação). */
function codigo(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "tests", "docs", "public"].includes(nome)) continue;
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) codigo(p, saida);
    else if (/\.(ts|tsx|css|mjs|js)$/.test(nome)) saida.push(p);
  }
  return saida;
}

const woff2 = readdirSync(PASTA).filter((f) => f.endsWith(".woff2")).sort();
const modulo = ler("app/fonts/index.ts");
const subconjuntos = ler("app/fonts/subconjuntos.css");
const todasAsFaces = [...subconjuntos.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]);
/** As fontes de reserva: a Arial do aparelho com as medidas ajustadas (sem arquivo). */
const reservas = todasAsFaces.filter((b) => b.includes('local("Arial")'));
const faces = todasAsFaces.filter((b) => !b.includes('local("Arial")')).map((b) => [null, b] as const).map((m) => ({
  familia: /font-family: "([^"]+)"/.exec(m[1])![1],
  peso: /font-weight: ([^;]+);/.exec(m[1])![1],
  arquivo: /url\("\.\/([^"]+)"\)/.exec(m[1])![1],
  intervalo: /unicode-range: ([^;]+);/.exec(m[1])?.[1] ?? "",
  display: /font-display: ([^;]+);/.exec(m[1])?.[1],
}));

describe("as fontes moram no projeto", () => {
  it("nenhum arquivo do sistema usa next/font/google nem busca fonte no Google", () => {
    const arquivos = codigo(RAIZ);
    expect(arquivos.length).toBeGreaterThan(500);
    const ofensores = arquivos.filter((f) => /from ["']next\/font\/google["']|require\(["']next\/font\/google["']\)|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(RAIZ, f));
    expect(ofensores).toEqual([]);
  });

  it("os dez arquivos estão lá, são woff2 de verdade e têm o tamanho de uma fonte", () => {
    expect(woff2).toEqual([
      "archivo-latim-ext.woff2", "archivo-latim.woff2", "archivo-vietnamita.woff2",
      "inter-cirilico-ext.woff2", "inter-cirilico.woff2", "inter-grego-ext.woff2", "inter-grego.woff2",
      "inter-latim-ext.woff2", "inter-latim.woff2", "inter-vietnamita.woff2",
    ]);
    for (const f of woff2) {
      const bytes = readFileSync(path.join(PASTA, f));
      expect(bytes.subarray(0, 4).toString("latin1"), `${f}: assinatura de woff2`).toBe("wOF2");
      expect(bytes.length, `${f}: não é um arquivo vazio nem uma página de erro`).toBeGreaterThan(8_000);
    }
  });

  it("todo arquivo é usado, e todo arquivo usado existe (nenhum solto, nenhum faltando)", () => {
    const usados = new Set([...modulo.matchAll(/"\.\/([a-z-]+\.woff2)"/g)].map((m) => m[1]).concat(faces.map((f) => f.arquivo)));
    expect([...usados].sort()).toEqual(woff2);
  });

  it("as licenças acompanham as fontes", () => {
    for (const f of ["OFL-inter.txt", "OFL-archivo.txt"]) expect(ler(`app/fonts/${f}`), f).toContain("SIL Open Font License, Version 1.1");
  });
});

describe("mesma fonte, mesma configuração de antes", () => {
  it("a Inter segue variável (todos os pesos) e o Archivo com 600 e 700, nas mesmas variáveis", () => {
    expect(modulo).toContain('import localFont from "next/font/local";');
    const inter = modulo.slice(modulo.indexOf("export const inter"), modulo.indexOf("export const archivo"));
    expect(inter).toContain('src: "./inter-latim.woff2"');
    expect(inter).toContain('weight: "100 900"');
    expect(inter).toContain('variable: "--font-inter"');
    const archivo = modulo.slice(modulo.indexOf("export const archivo"));
    expect([...archivo.matchAll(/path: "\.\/archivo-latim\.woff2", weight: "(\d+)"/g)].map((m) => m[1])).toEqual(["600", "700"]);
    expect(archivo).toContain('variable: "--font-archivo"');
    expect(modulo.match(/display: "swap"/g), "o texto aparece na fonte de reserva enquanto a fonte carrega").toHaveLength(2);
  });

  it("o layout usa as duas fontes e carrega os subconjuntos", () => {
    const layout = ler("app/layout.tsx");
    expect(layout).toContain('import { archivo, inter } from "./fonts";');
    expect(layout).toContain('import "./fonts/subconjuntos.css";');
    expect(layout).toContain("className={`${inter.variable} ${archivo.variable}`}");
  });

  it("cada subconjunto além do latim tem o intervalo de caracteres dele — sem isso o navegador baixaria todos", () => {
    expect(faces).toHaveLength(10); // 6 da Inter + 2 × 2 pesos do Archivo
    for (const f of faces) {
      expect(f.intervalo, `${f.arquivo}: unicode-range`).toMatch(/^U\+[0-9A-F?]+/);
      expect(f.display, f.arquivo).toBe("swap");
      expect(f.arquivo.startsWith(f.familia.toLowerCase()), `${f.arquivo} é da família ${f.familia}`).toBe(true);
    }
    expect(faces.filter((f) => f.familia === "Inter").every((f) => f.peso === "100 900")).toBe(true);
    expect(faces.filter((f) => f.familia === "Archivo").map((f) => f.peso).sort()).toEqual(["600", "600", "700", "700"]);
    // o latim NÃO está aqui: ele é a face pré-carregada do módulo
    expect(faces.some((f) => f.arquivo.includes("-latim.woff2"))).toBe(false);
    // amostras: o grego cobre Δ (U+0394) e Ω (U+03A9); o latim estendido cobre Ł (U+0141)
    const de = (trecho: string) => faces.find((f) => f.arquivo === trecho)!.intervalo;
    expect(de("inter-grego.woff2")).toContain("U+0384-038A");
    expect(de("inter-latim-ext.woff2")).toContain("U+0100-02BA");
  });

  it("a pilha de fontes consulta os subconjuntos ANTES da face latina e da fonte de reserva", () => {
    const familias = (config.theme!.extend as { fontFamily: Record<string, string[]> }).fontFamily;
    expect(familias.sans).toEqual(["Inter", "var(--font-inter)", "Inter Fallback", "system-ui", "sans-serif"]);
    expect(familias.display).toEqual(["Archivo", "var(--font-archivo)", "Archivo Fallback", "Inter", "var(--font-inter)", "Inter Fallback", "system-ui", "sans-serif"]);
  });

  it("a fonte de reserva (enquanto a fonte carrega) tem as mesmas medidas de antes — o texto não pula", () => {
    const medidas = (familia: string) => {
      const b = reservas.find((r) => r.includes(`font-family: "${familia}"`))!;
      return ["ascent-override", "descent-override", "line-gap-override", "size-adjust"].map((k) => new RegExp(`${k}: ([^;]+);`).exec(b)![1]);
    };
    expect(reservas).toHaveLength(2);
    expect(medidas("Inter Fallback")).toEqual(["90.44%", "22.52%", "0%", "107.12%"]);
    expect(medidas("Archivo Fallback")).toEqual(["88.96%", "21.28%", "0%", "98.7%"]);
    // a automática do next/font/local fica desligada: teria medidas diferentes e o mesmo nome
    expect(modulo.match(/adjustFontFallback: false/g)).toHaveLength(2);
  });
});
