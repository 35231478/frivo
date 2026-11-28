#!/usr/bin/env node
/**
 * `npm run build` → `next build` com o teto de memória (heap do V8) certo para cada lugar. Ver docs/build-memoria.md.
 *
 * - Na Vercel (VERCEL definido): a máquina tem 8 GB e o next build NÃO checa tipos nem lint (next.config; o job
 *   Typecheck do CI é o portão). Teto menor: o heap não passa da RAM do container e sobra para os outros processos.
 * - No CI e local: o next build checa os tipos, e essa etapa sozinha passa de 4 GB neste projeto.
 * - NODE_OPTIONS com --max-old-space-size já definido (no painel da Vercel, por exemplo) vale e não é trocado.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const HEAP_VERCEL_MB = 4096;
export const HEAP_COM_TIPOS_MB = 6144;

/** O NODE_OPTIONS do next build, a partir do ambiente. */
export function nodeOptionsDoBuild(env) {
  const atual = (env.NODE_OPTIONS ?? "").trim();
  if (/--max-old-space-size(=|\s)/.test(atual)) return atual;
  const mb = env.VERCEL ? HEAP_VERCEL_MB : HEAP_COM_TIPOS_MB;
  return `${atual} --max-old-space-size=${mb}`.trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const NODE_OPTIONS = nodeOptionsDoBuild(process.env);
  console.log(`[build] NODE_OPTIONS=${NODE_OPTIONS}${process.env.VERCEL ? " (Vercel: sem tipos e lint no next build)" : ""}`);
  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const r = spawnSync(process.execPath, [next, "build", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS } });
  process.exit(r.status ?? 1);
}
