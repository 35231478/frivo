/**
 * Build na Vercel sem estourar a memória (hotfix do deploy do #288): na Vercel o next build não checa tipos nem
 * lint e usa um heap menor; no CI e local continua checando, com o heap que a checagem pede. Ver docs/build-memoria.md.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HEAP_COM_TIPOS_MB, HEAP_VERCEL_MB, nodeOptionsDoBuild } from "../../scripts/build.mjs";

const raiz = new URL("../../", import.meta.url);
const ler = (f: string) => readFileSync(new URL(f, raiz), "utf8");

describe("heap do next build (scripts/build.mjs)", () => {
  it("na Vercel: o heap menor; no CI e local: o de quem checa os tipos", () => {
    expect(nodeOptionsDoBuild({ VERCEL: "1" })).toBe(`--max-old-space-size=${HEAP_VERCEL_MB}`);
    expect(nodeOptionsDoBuild({})).toBe(`--max-old-space-size=${HEAP_COM_TIPOS_MB}`);
    expect(nodeOptionsDoBuild({ VERCEL: "" })).toBe(`--max-old-space-size=${HEAP_COM_TIPOS_MB}`); // vazio = fora da Vercel
  });

  it("cabe na máquina de 8 GB da Vercel com folga; a checagem de tipos (CI) segue com 6 GB", () => {
    expect(HEAP_VERCEL_MB).toBeLessThanOrEqual(4096);
    expect(HEAP_VERCEL_MB).toBeGreaterThanOrEqual(2048);
    expect(HEAP_COM_TIPOS_MB).toBe(6144);
  });

  it("um --max-old-space-size já no NODE_OPTIONS (painel da Vercel, máquina local) vale; as outras opções ficam", () => {
    expect(nodeOptionsDoBuild({ VERCEL: "1", NODE_OPTIONS: "--max-old-space-size=3000" })).toBe("--max-old-space-size=3000");
    expect(nodeOptionsDoBuild({ NODE_OPTIONS: "--max-old-space-size 5000 --trace-warnings" })).toBe("--max-old-space-size 5000 --trace-warnings");
    expect(nodeOptionsDoBuild({ VERCEL: "1", NODE_OPTIONS: " --trace-warnings " })).toBe(`--trace-warnings --max-old-space-size=${HEAP_VERCEL_MB}`);
  });

  it("o npm run build passa pelo script (a Vercel roda o npm run build) e o CI não fixa outro heap por fora", () => {
    const pkg = JSON.parse(ler("package.json"));
    expect(pkg.scripts.build).toBe("prisma generate && node scripts/build.mjs");
    expect(ler(".github/workflows/ci.yml")).not.toMatch(/max-old-space-size/);
  });
});

describe("next.config: tipos e lint no next build", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const carregar = async () => (await import("../../next.config")).default as { typescript?: { ignoreBuildErrors?: boolean }; eslint?: { ignoreDuringBuilds?: boolean } };

  it("na Vercel não repete tipos e lint (o job Typecheck do CI é o portão)", async () => {
    vi.stubEnv("VERCEL", "1");
    const c = await carregar();
    expect(c.typescript?.ignoreBuildErrors).toBe(true);
    expect(c.eslint?.ignoreDuringBuilds).toBe(true);
  });

  it("fora da Vercel (CI e local) o next build continua checando", async () => {
    vi.stubEnv("VERCEL", "");
    const c = await carregar();
    expect(c.typescript?.ignoreBuildErrors).toBe(false);
    expect(c.eslint?.ignoreDuringBuilds).toBe(false);
  });

  it("compila num processo à parte (devolve a memória antes das páginas) e com a otimização de memória do webpack", async () => {
    const c = (await import("../../next.config")).default as { experimental?: { webpackBuildWorker?: boolean; webpackMemoryOptimizations?: boolean } };
    expect(c.experimental?.webpackBuildWorker).toBe(true);
    expect(c.experimental?.webpackMemoryOptimizations).toBe(true);
  });

  it("o CI mantém o job Typecheck (tsc --noEmit) no portão único", () => {
    const ci = ler(".github/workflows/ci.yml");
    expect(ci).toMatch(/- run: npm run typecheck/);
    expect(ci).toMatch(/needs: \[typecheck, testes, build\]/);
    expect(JSON.parse(ler("package.json")).scripts.typecheck).toBe("tsc --noEmit");
  });
});
