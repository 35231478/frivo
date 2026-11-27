/**
 * Orçamento, leva D — impressão do orçamento, com as rotas e páginas reais e o Prisma real num PostgreSQL real:
 *  - o SQL pendente (prisma/sql/2027-01-27_orcamento_opcoes_documento.sql): aditivo, idempotente (3×), não mexe no
 *    que existe, colunas iguais às que o Prisma espera;
 *  - PUT /api/orcamentos/[id]/opcoes-documento: 401/403/400/404 (outra empresa)/409 (aprovado, cancelado);
 *  - padrão da empresa (Configurações › Orçamentos) copiado para o orçamento NOVO;
 *  - a PÁGINA DE IMPRESSÃO (= o PDF) renderizada de verdade no servidor: os materiais inclusos dentro do serviço;
 *    NUNCA o custo; o número da OS vira link para a versão do cliente da OS (só da mesma empresa); sem ela, só texto.
 * Revisto no "Orçamento E — Material × Peça": "mostrar materiais" nasce LIGADO e a opção "valores dos materiais"
 * saiu (o campo antigo ainda é aceito e ignorado; nem um registro antigo com ela ligada mostra valor).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-leva-d-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_leva_d_${process.pid}`;
const SQL_SCHEMA = `teste_orc_leva_d_sql_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-27_orcamento_opcoes_documento.sql");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes, empresaId = "e1", id = "u1", role = "OPERADOR") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role, permissoes } };
};
const ADMIN = (empresaId = "e1") => logar(permissoesTotais(), empresaId, empresaId === "e1" ? "u1" : "u2");
const VENDEDOR = () => logar(montarPermissoes({ orcamentos: ["visualizar", "criar", "editar"] }));

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/${rota}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  let json: any = null; try { json = JSON.parse(texto); } catch { /* sem corpo */ }
  return { status: res.status, json, texto };
}

function psql(args: string[], schema: string) {
  return execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const colunas = (schema: string) => psql(["-c", `SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}'
   AND ((table_name = 'orcamentos' AND column_name IN ('mostrar_materiais', 'mostrar_valores_materiais'))
     OR (table_name = 'configuracoes' AND column_name IN ('orcamento_mostrar_materiais', 'orcamento_mostrar_valores_materiais')))
  ORDER BY 1`], schema);

describe.skipIf(!URL_PG)("Orçamento, leva D — impressão do orçamento (PostgreSQL real)", () => {
  let prisma: any;
  let orc = "";
  let token = "";
  const TK_REL = "5ff6ddb2-d03c-4865-b40a-1d433ddcc5d0";
  const TK_OUTRA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const opcoes = (corpo: unknown, id = orc) => chamar("orcamentos/[id]/opcoes-documento", "PUT", corpo, { id });
  const gravado = async (id = orc) => prisma.orcamento.findUnique({ where: { id }, select: { mostrarMateriais: true, mostrarValoresMateriais: true } });
  /** A página de impressão de verdade (o que o navegador salva em PDF), renderizada no servidor */
  async function impressao() {
    const { default: Pagina } = await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    const el = await Pagina({ params: Promise.resolve({ token }) });
    return renderToStaticMarkup(el as any);
  }
  const materiaisDoHtml = (html: string) => (html.match(/data-materiais-servico[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["orcamentos", "orcamentos/[id]/opcoes-documento", "configuracoes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "c2", empresaId: "e2", nome: "Outro", cpfCnpj: "22101333000192" }] });
    await prisma.produto.createMany({ data: [
      { id: "filtro", empresaId: "e1", nome: "Filtro G4", unidade: "un", valorPadrao: 89.9, saldo: 10 },
      { id: "fita", empresaId: "e1", nome: "Fita isolante", unidade: "rolo", valorPadrao: 12.5, saldo: 10 },
    ] });
    // último custo de compra (o servidor grava no material ao salvar): 38,50 e 6,90 — nunca podem aparecer no documento
    await prisma.movimentacaoEstoque.createMany({ data: [
      { empresaId: "e1", produtoId: "filtro", tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: 38.5 },
      { empresaId: "e1", produtoId: "fita", tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: 6.9 },
    ] });
    await prisma.servico.create({ data: { id: "sLimp", empresaId: "e1", codigo: "LIMP", nome: "Limpeza de split", valorPadrao: 220 } });
    // OS vinculadas: a da empresa com a versão do cliente (relatório GERAL) e uma de OUTRA empresa (nunca aparece)
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-8901", clienteId: "c1", criadoPorId: "u1", descricao: "Limpeza" },
      { id: "os2", empresaId: "e1", numero: "OS-8902", clienteId: "c1", criadoPorId: "u1", descricao: "Ainda aberta" },
      { id: "osX", empresaId: "e2", numero: "OS-9999", clienteId: "c2", criadoPorId: "u2", descricao: "Outra empresa" },
    ] });
    await prisma.relatorioOs.createMany({ data: [
      { empresaId: "e1", ordemServicoId: "os1", numero: "REL-1", escopo: "GERAL", mesReferencia: 11, anoReferencia: 2026, tokenPublico: TK_REL },
      { empresaId: "e1", ordemServicoId: "os2", numero: "REL-2", escopo: "ATIVIDADE", mesReferencia: 11, anoReferencia: 2026, tokenPublico: "so-atividade-123" },
      { empresaId: "e2", ordemServicoId: "osX", numero: "REL-X", escopo: "GERAL", mesReferencia: 11, anoReferencia: 2026, tokenPublico: TK_OUTRA },
    ] });
    // relatório de uma ATIVIDADE da os1, MAIS NOVO que o GERAL: a consulta tem de buscar o GERAL, não o último qualquer
    await prisma.relatorioOs.create({ data: { empresaId: "e1", ordemServicoId: "os1", numero: "REL-3", escopo: "ATIVIDADE", mesReferencia: 11, anoReferencia: 2026, tokenPublico: "atividade-mais-nova-123", criadoEm: new Date(Date.now() + 60_000) } });
    ADMIN();
    const mat = (produtoId: string, descricao: string, quantidade: number, valorVendaUnit: number, unidade = "un", comportamento = "INCLUSO_NO_SERVICO") =>
      ({ produtoId, descricao, unidade, comportamento, quantidade, quantidadePadrao: quantidade, valorVendaUnit, origem: "SOLTO", kitNome: null, custoUnit: 1234 });
    const r = await chamar("orcamentos", "POST", {
      clienteId: "c1", nome: "Leva D",
      servicos: [{ catalogoId: "sLimp", descricao: "Limpeza de split", quantidade: 2, valorUnitario: 220, materiais: [mat("filtro", "Filtro G4", 2, 89.9), mat("fita", "Fita isolante", 1, 12.5, "rolo")] }],
      produtos: [{ catalogoId: "filtro", descricao: "Filtro G4", quantidade: 4, valorUnitario: 89.9 }],
    });
    expect(r.status).toBe(201);
    orc = r.json.id;
    token = (await prisma.orcamento.findUnique({ where: { id: orc }, select: { tokenPublico: true } })).tokenPublico;
    await prisma.orcamentoOs.createMany({ data: [{ orcamentoId: orc, ordemServicoId: "os1" }, { orcamentoId: orc, ordemServicoId: "os2" }, { orcamentoId: orc, ordemServicoId: "osX" }] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${SQL_SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("SQL pendente: aditivo e idempotente (3×), não mexe no que existe, e as colunas são as que o Prisma espera", () => {
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SQL_SCHEMA} CASCADE; CREATE SCHEMA ${SQL_SCHEMA};`]);
    psql(["-c", `CREATE TABLE "orcamentos" ("id" TEXT PRIMARY KEY, "codigo" TEXT NOT NULL); INSERT INTO "orcamentos" VALUES ('o1', 'ORC-1');
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "orcamento_validade_dias" INT NOT NULL DEFAULT 10); INSERT INTO "configuracoes" VALUES ('c1', 'e1', 15);`], SQL_SCHEMA);
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO], SQL_SCHEMA);
    // as linhas que já existiam: desligadas (como sempre) e o resto intacto
    expect(psql(["-c", `SELECT "codigo" || '|' || "mostrar_materiais" || '|' || "mostrar_valores_materiais" FROM "orcamentos"`], SQL_SCHEMA)).toBe("ORC-1|false|false");
    expect(psql(["-c", `SELECT "orcamento_validade_dias" || '|' || "orcamento_mostrar_materiais" || '|' || "orcamento_mostrar_valores_materiais" FROM "configuracoes"`], SQL_SCHEMA)).toBe("15|false|false");
    // rodar de novo não desliga o que a empresa ligou
    psql(["-c", `UPDATE "configuracoes" SET "orcamento_mostrar_materiais" = true`], SQL_SCHEMA);
    psql(["-f", ARQUIVO], SQL_SCHEMA);
    expect(psql(["-c", `SELECT "orcamento_mostrar_materiais" FROM "configuracoes"`], SQL_SCHEMA)).toBe("t");
    // idênticas ao schema.prisma (aplicado por db push no esquema do teste), menos o PADRÃO das duas colunas de
    // "mostrar materiais", que o "Orçamento E" muda para ligado no SQL dele (tests/unit/sql-produto-uso.test.ts)
    expect(colunas(SCHEMA).split("\n")).toEqual([
      "configuracoes.orcamento_mostrar_materiais boolean NO true",
      "configuracoes.orcamento_mostrar_valores_materiais boolean NO false",
      "orcamentos.mostrar_materiais boolean NO true",
      "orcamentos.mostrar_valores_materiais boolean NO false",
    ]);
    expect(colunas(SQL_SCHEMA).split("\n")).toEqual([
      "configuracoes.orcamento_mostrar_materiais boolean NO false",
      "configuracoes.orcamento_mostrar_valores_materiais boolean NO false",
      "orcamentos.mostrar_materiais boolean NO false",
      "orcamentos.mostrar_valores_materiais boolean NO false",
    ]);
    // nada além de ADD COLUMN IF NOT EXISTS (sem DROP/UPDATE/DELETE)
    const sql = require("node:fs").readFileSync(ARQUIVO, "utf8").replace(/--.*$/gm, "");
    expect(sql.match(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i)).toBeNull();
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4);
  });

  it("padrão (Orçamento E): o orçamento nasce com materiais LIGADO; na impressão, dentro do serviço e sem valor; o número da OS já é link (versão do cliente)", async () => {
    expect(await gravado()).toEqual({ mostrarMateriais: true, mostrarValoresMateriais: false });
    const html = await impressao();
    expect(html).toContain("Limpeza de split");
    expect(materiaisDoHtml(html)).toBe("Materiais inclusos Filtro G4 · 2 un Fita isolante · 1 rolo");
    expect(html).not.toContain("data-valor-material");
    // OS: a da empresa com versão do cliente = link público; sem ela = texto; a de outra empresa nem aparece
    expect(html).toContain(`href="/relatorio/os/${TK_REL}"`);
    expect(html).toMatch(/data-link-os[^>]*>OS-8901<\/a>/);
    expect(html).toContain("OS-8902");
    expect(html).not.toMatch(/data-link-os[^>]*>OS-8902/);
    expect(html).not.toMatch(/so-atividade-123|atividade-mais-nova-123/);
    expect(html).not.toMatch(/OS-9999|aaaaaaaa-bbbb/);
    // nunca endereço interno
    expect(html).not.toMatch(/href="\/(ordens|orcamentos)\//);
  });

  it("PUT opções: 401, 403 sem editar orçamento, 400 corpo inválido, 404 de outra empresa", async () => {
    sessao.atual = null;
    expect((await opcoes({ mostrarMateriais: false })).status).toBe(401);
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await opcoes({ mostrarMateriais: false })).status).toBe(403);
    VENDEDOR();
    expect((await opcoes({ mostrarMateriais: "sim" })).status).toBe(400);
    expect((await opcoes({})).status).toBe(400);
    expect((await opcoes({ mostrarMateriais: false, custo: true })).status).toBe(400);
    ADMIN("e2");
    expect((await opcoes({ mostrarMateriais: false })).status).toBe(404);
    expect(await gravado()).toEqual({ mostrarMateriais: true, mostrarValoresMateriais: false });
  });

  it("desligar e ligar de novo grava; o antigo 'valores' ainda é aceito (tela velha aberta) e ignorado", async () => {
    VENDEDOR();
    const r = await opcoes({ mostrarMateriais: false, mostrarValoresMateriais: true });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, mostrarMateriais: false });
    expect(await gravado()).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
    expect(await impressao()).not.toContain("data-materiais-servico");
    expect((await opcoes({ mostrarMateriais: true, mostrarValoresMateriais: true })).status).toBe(200);
    expect(await gravado()).toEqual({ mostrarMateriais: true, mostrarValoresMateriais: false });
  });

  it("registro antigo com 'valores' ligado no banco: o valor do material não aparece mais; o custo em lugar nenhum; ISS e total intactos", async () => {
    await prisma.orcamento.update({ where: { id: orc }, data: { mostrarValoresMateriais: true } });
    try {
      let html = await impressao();
      expect(materiaisDoHtml(html)).toBe("Materiais inclusos Filtro G4 · 2 un Fita isolante · 1 rolo");
      expect(html).not.toContain("data-valor-material");
      // o custo gravado no material (38,50 / 6,90 do último custo; 1234 que o navegador tentou mandar) não sai
      const gravados = await prisma.orcamentoMaterial.findMany({ where: { orcamentoId: orc }, select: { custoUnit: true } });
      expect(gravados.map((m: any) => Number(m.custoUnit)).sort()).toEqual([38.5, 6.9]);
      expect(html).not.toMatch(/38,50|6,90|1\.234|1234|custoUnit|custo_unit/);
      expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\bcusto\b/i);
      // o total do orçamento não muda por mostrar materiais
      expect(html).toMatch(/R\$\s799,60/);
      // ISS 5% (versão do cliente): o serviço 440 → 462; materiais continuam sem valor; total 462 + 359,60
      await prisma.orcamento.update({ where: { id: orc }, data: { issAliquota: 5 } });
      html = await impressao();
      expect(html).toMatch(/data-total-item[^>]*>462,00</);
      expect(materiaisDoHtml(html)).not.toMatch(/R\$/);
      expect(html).toMatch(/R\$\s821,60/);
    } finally {
      await prisma.orcamento.update({ where: { id: orc }, data: { issAliquota: 0, mostrarValoresMateriais: false } });
    }
  });

  it("aprovado ou cancelado: 409 com o motivo, nada muda", async () => {
    VENDEDOR();
    await prisma.orcamento.update({ where: { id: orc }, data: { status: "APROVADO" } });
    const r = await opcoes({ mostrarMateriais: false });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/aprovado/i);
    await prisma.orcamento.update({ where: { id: orc }, data: { status: "CANCELADO" } });
    expect((await opcoes({ mostrarMateriais: false })).status).toBe(409);
    expect(await gravado()).toEqual({ mostrarMateriais: true, mostrarValoresMateriais: false });
    await prisma.orcamento.update({ where: { id: orc }, data: { status: "ENVIADO" } });
    expect((await opcoes({ mostrarMateriais: false })).status).toBe(200);
  });

  it("padrão da empresa (Configurações › Orçamentos): ligado por padrão; o orçamento NOVO herda; 'valores' é ignorado; outra empresa não é afetada", async () => {
    ADMIN();
    const cfg = () => prisma.configuracao.findUnique({ where: { empresaId: "e1" }, select: { orcamentoMostrarMateriais: true, orcamentoMostrarValoresMateriais: true } });
    // o campo antigo sozinho: aceito (200) e ignorado
    expect((await chamar("configuracoes", "PUT", { orcamentoMostrarValoresMateriais: true })).status).toBe(200);
    expect(await cfg()).toEqual({ orcamentoMostrarMateriais: true, orcamentoMostrarValoresMateriais: false });
    const criar = () => chamar("orcamentos", "POST", { clienteId: "c1", servicos: [{ descricao: "Visita", quantidade: 1, valorUnitario: 150 }], produtos: [] });
    // desligado na empresa: o novo nasce desligado
    expect((await chamar("configuracoes", "PUT", { orcamentoMostrarMateriais: false })).status).toBe(200);
    const novo = await criar();
    expect(novo.status).toBe(201);
    expect(await gravado(novo.json.id)).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
    // ligado de novo (com o campo antigo junto, ignorado)
    expect((await chamar("configuracoes", "PUT", { orcamentoMostrarMateriais: true, orcamentoMostrarValoresMateriais: true })).status).toBe(200);
    expect(await cfg()).toEqual({ orcamentoMostrarMateriais: true, orcamentoMostrarValoresMateriais: false });
    const novo2 = await criar();
    expect(await gravado(novo2.json.id)).toEqual({ mostrarMateriais: true, mostrarValoresMateriais: false });
    // mudar o padrão não mexe nos orçamentos que já existem
    expect(await gravado(novo.json.id)).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
    // multiempresa: a empresa 2 (sem configuração gravada) fica no padrão ligado
    ADMIN("e2");
    const deOutra = await chamar("orcamentos", "POST", { clienteId: "c2", servicos: [{ descricao: "Visita", quantidade: 1, valorUnitario: 150 }], produtos: [] });
    expect(deOutra.status).toBe(201);
    expect(await gravado(deOutra.json.id)).toEqual({ mostrarMateriais: true, mostrarValoresMateriais: false });
  });
});
