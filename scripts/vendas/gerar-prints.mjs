#!/usr/bin/env node
/**
 * PRINTS DA HOME DE VENDAS — `npm run prints:vendas`
 *
 * Regenera as telas de public/marketing/prints a partir da EMPRESA DE DEMONSTRAÇÃO (dados fictícios,
 * scripts/vendas/seed-demo.ts), nunca da produção. Passos:
 *   1. confere que DATABASE_URL é um banco local (localhost) e roda o seed (pule com --sem-seed);
 *   2. usa o app em PRINTS_URL ou sobe `next dev` numa porta própria;
 *   3. entra como a gestora (computador) e como o técnico (celular) e fotografa cada tela em 2x,
 *      sem a barra lateral e sem a barra do topo (que mostra o e-mail), só a área de conteúdo;
 *   4. grava WebP otimizado com o nome que a página espera (components/marketing/conteudo.ts).
 *
 * Pré-requisitos: Postgres local com o schema (`npx prisma db push`) e o Playwright com o Chromium
 * (`npx playwright install chromium`, se ainda não houver). Variáveis:
 *   DATABASE_URL  banco local de prints (obrigatório)
 *   PRINTS_URL    app já rodando (opcional; sem ela, o script sobe `next dev` na porta 3123)
 *   PRINTS_SO     só estes prints, separados por vírgula (ex.: 07-mapa-equipe,12-pmoc)
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SAIDA = path.join(RAIZ, "public/marketing/prints");
const args = new Set(process.argv.slice(2));
const so = process.env.PRINTS_SO ? new Set(process.env.PRINTS_SO.split(",").map((s) => s.trim())) : null;

const GESTORA = { email: "marina@polarclima.exemplo", senha: "demo-prints-polar" };
const TECNICO = { email: "rafael@polarclima.exemplo", senha: "demo-prints-polar" };
const CNPJ_DEMO_PREFIXO = "90.341.722/0001";

/* ───────── trava: banco local (a mesma regra de scripts/vendas/banco-local.ts) ───────── */
function exigirBancoLocal() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    const u = new URL(url);
    host = u.hostname || (u.searchParams.get("host")?.startsWith("/") ? "localhost" : "");
  } catch { /* URL inválida: cai na recusa */ }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    console.error(`Recusado: DATABASE_URL precisa ser um banco local (localhost), não "${host || "?"}". Os prints saem da empresa de demonstração, nunca da produção.`);
    process.exit(1);
  }
}

/* ───────── Playwright: o do projeto ou o instalado no sistema ───────── */
async function carregarPlaywright() {
  try { return await import("playwright"); } catch { /* tenta o global */ }
  const global = execSync("npm root -g", { encoding: "utf8" }).trim();
  return createRequire(path.join(global, "_"))("playwright");
}

/* ───────── servidor ───────── */
async function esperarServidor(url, ms = 300_000) {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    try { if ((await fetch(`${url}/login`)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`O app não respondeu em ${url}`);
}

async function subirServidor() {
  if (process.env.PRINTS_URL) return { url: process.env.PRINTS_URL.replace(/\/$/, ""), parar: () => {} };
  const porta = 3123;
  const url = `http://localhost:${porta}`;
  const filho = spawn("npx", ["next", "dev", "-p", String(porta)], {
    cwd: RAIZ, stdio: "ignore", detached: true,
    env: { ...process.env, AUTH_SECRET: process.env.AUTH_SECRET ?? "prints-vendas-segredo-local-32-caracteres", NEXTAUTH_URL: url, AUTH_TRUST_HOST: "true", NEXT_TELEMETRY_DISABLED: "1" },
  });
  await esperarServidor(url);
  return { url, parar: () => { try { process.kill(-filho.pid); } catch { /* já saiu */ } } };
}

/* ───────── fotografia ───────── */
// Esconde o que não é conteúdo: barra lateral, barra do topo (e-mail), botões flutuantes e o indicador do Next
const CSS_LIMPO = `
  .h-screen.overflow-hidden > aside, .h-screen.overflow-hidden > div > header { display: none !important; }
  [data-acao="abrir-frivo-ia"], [data-gaveta-aba], [data-gaveta-aba-mobile], nextjs-portal { display: none !important; }
  *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
`;

async function assentar(page, extra = 900) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(extra);
}

async function entrar(contexto, url, quem) {
  const page = await contexto.newPage();
  await page.goto(`${url}/login`, { waitUntil: "load", timeout: 240_000 });
  await page.fill('input[type="email"]', quem.email);
  await page.fill('input[type="password"]', quem.senha);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 240_000 }), page.click('button[type="submit"]')]);
  return page;
}

/** PNG em 2x → WebP na largura final (proporção preservada) */
async function gravar(arquivo, png, largura) {
  const webp = await sharp(png).resize({ width: largura, withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toBuffer();
  writeFileSync(path.join(SAIDA, `${arquivo}.webp`), webp);
  const m = await sharp(webp).metadata();
  console.log(`  ${arquivo}.webp  ${m.width}×${m.height}  ${(webp.length / 1024).toFixed(0)} KB`);
}

async function main() {
  exigirBancoLocal();
  if (!args.has("--sem-seed")) {
    console.log("1/3 Empresa de demonstração (seed)…");
    const r = spawnSync("npx", ["vite-node", "--config", "vitest.config.ts", "scripts/vendas/seed-demo.ts"], { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: { ...process.env, NODE_ENV: "production" } });
    const saida = `${r.stdout}`.split("\n").filter((l) => l && !l.startsWith("prisma:")).join("\n");
    if (r.status !== 0) { console.error(saida, r.stderr); process.exit(1); }
    console.log(saida.split("\n").filter((l) => /Pronto|Empresa de demonstração|PMOC|Orçamento/.test(l)).map((l) => `  ${l}`).join("\n"));
  }

  // Os endereços das telas de detalhe vêm do banco de demonstração
  const db = new PrismaClient();
  const empresa = await db.empresa.findFirst({ where: { cnpj: { startsWith: CNPJ_DEMO_PREFIXO } }, select: { id: true } });
  if (!empresa) throw new Error("Empresa de demonstração não encontrada: rode sem --sem-seed.");
  const e = empresa.id;
  const [orc, vitrine, pmoc, equip, aceite, tv, qr] = await Promise.all([
    db.orcamento.findFirst({ where: { empresaId: e, status: "APROVADO", osGerada: { isNot: null } }, orderBy: { criadoEm: "desc" }, select: { id: true } }),
    db.ordemServico.findFirst({ where: { empresaId: e, orcamentoOrigemId: { not: null } }, select: { id: true } }),
    db.pmoc.findFirst({ where: { empresaId: e }, select: { id: true } }),
    db.equipamento.findFirst({ where: { empresaId: e, nome: "Split consultório 1" }, select: { id: true } }),
    db.osAceite.findFirst({ where: { empresaId: e, situacao: "PENDENTE" }, select: { token: true } }),
    db.desempenhoConfig.findUnique({ where: { empresaId: e }, select: { tvToken: true } }),
    db.qrcode.findFirst({ where: { empresaId: e, equipamento: { nome: "Split consultório 1" } }, select: { tokenPublico: true } }),
  ]);
  await db.$disconnect();

  console.log("2/3 App…");
  const servidor = await subirServidor();
  const { chromium } = await carregarPlaywright();
  const navegador = await chromium.launch();
  mkdirSync(SAIDA, { recursive: true });

  try {
    console.log("3/3 Prints…");
    const computador = await navegador.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 2, reducedMotion: "reduce", serviceWorkers: "block", locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    await computador.addInitScript((css) => { addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }); }, CSS_LIMPO);
    const page = await entrar(computador, servidor.url, GESTORA);

    /** Uma tela do computador: abre, prepara e fotografa a janela (ou um recorte) */
    async function tela(arquivo, rota, { preparar, janela = 1200, altura = 750, largura = 1600, recorte } = {}) {
      if (so && !so.has(arquivo)) return;
      await page.setViewportSize({ width: janela, height: altura });
      await page.goto(`${servidor.url}${rota}`, { waitUntil: "load", timeout: 240_000 });
      await assentar(page);
      if (preparar) { await preparar(page); await assentar(page, 600); }
      const png = await page.screenshot(recorte ? { clip: await recorte(page) } : {});
      await gravar(arquivo, png, largura);
    }

    await tela("01-dashboard", "/dashboard");
    await tela("02-calendario-os", "/calendario");
    // O painel de Atividades fica ao lado do resumo a partir de 1280 px de janela
    await tela("15-os-atividades", `/ordens/${vitrine?.id}`, { janela: 1440, altura: 900 });
    await tela("03-orcamento-aprovado", `/orcamentos/${orc?.id}`, {
      preparar: async (p) => { await p.locator("text=Andamento da proposta").first().scrollIntoViewIfNeeded().catch(() => {}); },
    });
    await tela("04-orcamentos", "/orcamentos");
    await tela("05-contratos", "/contratos");
    await tela("06-estoque-saldos", "/estoque");
    await tela("07-mapa-equipe", "/mapa", {
      preparar: async (p) => {
        await p.waitForFunction(() => document.querySelectorAll(".leaflet-tile-loaded").length >= 6, null, { timeout: 60_000 }).catch(() => {});
        await p.locator(".leaflet-marker-icon").nth(2).click().catch(() => {});
      },
    });
    await tela("08-desempenho", "/desempenho");
    await tela("09-equipes", "/colaboradores");
    await tela("10-financeiro-painel", "/financeiro");
    await tela("12-pmoc", `/pmoc/${pmoc?.id}`, {
      preparar: async (p) => {
        await p.getByRole("tab", { name: /Cronograma/ }).or(p.getByRole("button", { name: /Cronograma/ })).first().click().catch(() => {});
        await p.waitForFunction(() => !document.body.innerText.includes("Carregando o cronograma"), null, { timeout: 60_000 }).catch(() => {});
      },
    });
    await tela("14-equipamento-qr", `/equipamentos/${equip?.id}`);
    if (!so || so.has("08-desempenho-tv")) {
      await page.setViewportSize({ width: 1200, height: 750 });
      await page.goto(`${servidor.url}/relatorio/desempenho/${tv?.tvToken}`, { waitUntil: "load", timeout: 240_000 });
      await assentar(page, 1500);
      await gravar("08-desempenho-tv", await page.screenshot(), 1600);
    }
    await computador.close();

    // Celular: o app do técnico e o aceite do cliente (9:19, 390 px de largura)
    const celular = await navegador.newContext({ viewport: { width: 390, height: 823 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block", locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    await celular.addInitScript((css) => { addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }); }, CSS_LIMPO);
    if (!so || so.has("11-app-tecnico")) {
      const app = await entrar(celular, servidor.url, TECNICO);
      await app.goto(`${servidor.url}/tecnico`, { waitUntil: "load", timeout: 240_000 });
      await assentar(app, 1500);
      await gravar("11-app-tecnico", await app.screenshot(), 780);
      await app.close();
    }
    if (!so || so.has("13-aceite")) {
      // O cliente confirma pelo link: rola até a confirmação, escreve o nome e dá 5 estrelas (sem enviar)
      const cliente = await celular.newPage();
      await cliente.goto(`${servidor.url}/relatorio/aceite/${aceite?.token}`, { waitUntil: "load", timeout: 240_000 });
      await assentar(cliente, 1200);
      await cliente.fill('input[aria-label="Nome completo"]', "Paulo Ferraz").catch(() => {});
      await cliente.click('[data-estrela="5"]').catch(() => {});
      await cliente.evaluate(() => { const s = document.getElementById("confirmar"); if (s) scrollTo(0, s.getBoundingClientRect().top + scrollY - (innerHeight - s.offsetHeight) / 2); });
      await assentar(cliente, 600);
      await gravar("13-aceite", await cliente.screenshot(), 780);
      await cliente.close();
    }
    if (!so || so.has("14-qr-celular")) {
      // O que abre quando alguém lê o QR da etiqueta no equipamento
      const leitura = await celular.newPage();
      await leitura.goto(`${servidor.url}/qr/${qr?.tokenPublico}`, { waitUntil: "load", timeout: 240_000 });
      await assentar(leitura, 1200);
      await gravar("14-qr-celular", await leitura.screenshot(), 780);
      await leitura.close();
    }
    await celular.close();
  } finally {
    await navegador.close();
    servidor.parar();
  }
  console.log(`Pronto: ${SAIDA}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
