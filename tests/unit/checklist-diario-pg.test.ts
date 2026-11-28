/**
 * Checklist de veículo obrigatório no app (o "porteiro") com as rotas reais e o Prisma real num PostgreSQL real:
 *  - o SQL pendente (prisma/sql/2027-01-28_checklist_diario.sql) 3×: aditivo, idempotente, igual ao Prisma;
 *  - o resumo do porteiro (página do app): só para quem é obrigado, com veículo padrão em uso, modelo ativo, Frota
 *    ligada; o registro de hoje vem junto;
 *  - o envio do aparelho: cria o checklist como os outros (colaborador, veículo, alerta decidido no SERVIDOR), um
 *    registro por dia, reenvio não duplica, "não vou usar" → feito com rastro, feito nunca volta, corrida de dois
 *    envios = um checklist, enviado sem sinal, dia futuro recusado, multiempresa, Frota desligada = ignorado;
 *  - histórico do gestor ("Sem registro", "Ainda não fez", rastro) e o sino ("não vão usar"), que sai ao abrir;
 *  - configuração: permissão, modelo/colaborador de outra empresa, validações.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/checklist-diario-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, PRESETS, type Permissoes } from "@/lib/permissoes";
import { envioDiarioSchema } from "@/lib/checklist-diario/envio";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_checklist_diario_${process.pid}`;
const SQL_SCHEMA = `teste_checklist_diario_sql_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const ARQUIVO = path.join(RAIZ, "prisma/sql/2027-01-28_checklist_diario.sql");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes, o: { empresaId?: string; id?: string; role?: string; tecnicoId?: string | null } = {}) => {
  sessao.atual = { user: { id: o.id ?? "u1", name: "Carlos", email: "c@x.com", empresaId: o.empresaId ?? "e1", role: o.role ?? "TECNICO", permissoes, tecnicoId: o.tecnicoId === undefined ? "t1" : o.tecnicoId } };
};
const TECNICO = (tecnicoId = "t1", empresaId = "e1", id = "u1") => logar(PRESETS.TECNICO as Permissoes, { tecnicoId, empresaId, id });
const GESTOR = (empresaId = "e1") => logar(permissoesTotais(), { role: "ADMIN", tecnicoId: null, empresaId, id: empresaId === "e1" ? "g1" : "g2" });

async function chamar(rota: string, metodo: string, corpo?: unknown, busca = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/${rota}${busca}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({}) });
  const texto = await res.text();
  let json: any = null; try { json = JSON.parse(texto); } catch { /* sem corpo */ }
  return { status: res.status, json, texto };
}

function psql(args: string[], schema: string) {
  return execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${schema} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const colunas = (schema: string) => psql(["-c", `SELECT table_name || '.' || column_name || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '-')
  FROM information_schema.columns WHERE table_schema = '${schema}' AND (table_name = 'checklist_diario' OR (table_name = 'configuracoes' AND column_name LIKE 'checklist_diario%')) ORDER BY 1`], schema);
const indices = (schema: string) => psql(["-c", `SELECT replace(indexdef, '${schema}.', '') FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = 'checklist_diario' ORDER BY indexname`], schema);
const chaves = (schema: string) => psql(["-c", `SELECT c.conname || ' ' || replace(pg_get_constraintdef(c.oid), '${schema}.', '') FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = '${schema}' AND (c.conrelid = '${schema}.checklist_diario'::regclass OR c.conname = 'configuracoes_checklist_diario_template_id_fkey') ORDER BY 1`], schema);
const tipo = (schema: string) => psql(["-c", `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = '${schema}' AND t.typname = 'SituacaoChecklistDiario'`], schema);

describe.skipIf(!URL_PG)("Checklist obrigatório no app (PostgreSQL real)", () => {
  let prisma: any;
  let esquecerModulos: (e?: string) => void;
  let resumoPorteiro: typeof import("@/lib/checklist-diario/servidor").resumoPorteiro;
  let registrarEnvioDiario: typeof import("@/lib/checklist-diario/servidor").registrarEnvioDiario;
  let hoje = "";
  let ontem = "";
  const ITENS = ["i-pneu", "i-oleo", "i-foto"];
  const enviar = (corpo: unknown) => chamar("tecnico/checklist-diario", "POST", corpo);
  const feito = (extra: Record<string, unknown> = {}) => ({
    clientId: randomUUID(), dia: hoje, feitoEm: new Date().toISOString(), veiculoId: "v1", situacao: "FEITO", templateId: "tpl",
    itens: [{ itemTemplateId: "i-pneu", valor: "OK" }, { itemTemplateId: "i-oleo", valor: "Normal" }, { itemTemplateId: "i-foto", foto: "data:image/jpeg;base64,AAAA" }],
    ...extra,
  });
  const naoVou = (extra: Record<string, unknown> = {}) => ({ clientId: randomUUID(), dia: hoje, feitoEm: new Date().toISOString(), veiculoId: "v1", situacao: "NAO_VAI_USAR", motivo: "Serviço a pé", ...extra });
  const registros = (tecnicoId = "t1") => prisma.checklistDiario.findMany({ where: { tecnicoId }, orderBy: { dia: "asc" } });
  async function config(dados: Record<string, unknown>) { await prisma.configuracao.update({ where: { empresaId: "e1" }, data: dados }); }
  async function desligarFrota(fn: () => Promise<void>) {
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "veiculos", ativo: false } }); esquecerModulos();
    try { await fn(); } finally { await prisma.empresaModulo.deleteMany({ where: { empresaId: "e1", modulo: "veiculos" } }); esquecerModulos(); }
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ esquecerModulos } = await import("@/lib/modulos/servidor"));
    ({ resumoPorteiro, registrarEnvioDiario } = await import("@/lib/checklist-diario/servidor"));
    const { hojeBR, somarDias } = await import("@/lib/checklist-diario/regras");
    hoje = hojeBR(); ontem = somarDias(hoje, -1);
    await Promise.all(["tecnico/checklist-diario", "checklist-diario", "checklist-diario/config"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Carlos", email: "c@x.com", senha: "x", role: "TECNICO" }, { id: "u3", empresaId: "e1", nome: "Dani", email: "d@x.com", senha: "x", role: "TECNICO" },
      { id: "g1", empresaId: "e1", nome: "Gestor", email: "g@x.com", senha: "x" }, { id: "g2", empresaId: "e2", nome: "Gestor 2", email: "g2@x.com", senha: "x" },
    ] });
    await prisma.veiculo.createMany({ data: [
      { id: "v1", empresaId: "e1", placa: "ABC1D23", modelo: "Strada" }, { id: "v2", empresaId: "e1", placa: "XYZ9K87", modelo: "Fiorino", status: "MANUTENCAO" },
      { id: "v3", empresaId: "e1", placa: "DEF4G56", modelo: "Saveiro" }, { id: "vx", empresaId: "e2", placa: "OUT0R00", modelo: "Outro" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Carlos", cpf: "1", telefone: "1", veiculoId: "v1" },
      { id: "t2", empresaId: "e1", nome: "Bruno", cpf: "2", telefone: "2", veiculoId: "v2" }, // veículo em manutenção
      { id: "t3", empresaId: "e1", nome: "Dani", cpf: "3", telefone: "3", veiculoId: "v3" },
      { id: "t4", empresaId: "e1", nome: "Edu", cpf: "4", telefone: "4" }, // sem veículo padrão
      { id: "tx", empresaId: "e2", nome: "Outro", cpf: "5", telefone: "5", veiculoId: "vx" },
    ] });
    await prisma.checklistTemplate.create({ data: { id: "tpl", empresaId: "e1", nome: "Diário", itens: { create: [
      { id: "i-pneu", categoria: "Pneus", descricao: "Calibragem", tipo: "OK_NOK", opcoes: ["OK", "NOK"], ordem: 0 },
      { id: "i-oleo", categoria: "Motor", descricao: "Nível do óleo", tipo: "NIVEL", opcoes: ["Normal", "Baixo"], ordem: 1 },
      { id: "i-foto", categoria: "Geral", descricao: "Foto do painel", tipo: "FOTO", opcoes: [], ordem: 2 },
      { id: "i-velho", categoria: "Geral", descricao: "Item removido", tipo: "OK_NOK", opcoes: ["OK", "NOK"], ordem: 3, ativo: false },
    ] } } });
    await prisma.checklistTemplate.create({ data: { id: "tpl-x", empresaId: "e2", nome: "Outra", itens: { create: [{ categoria: "G", descricao: "x", tipo: "OK_NOK", opcoes: ["OK", "NOK"] }] } } });
    await prisma.configuracao.createMany({ data: [
      { empresaId: "e1", checklistDiarioAtivo: true, checklistDiarioDias: [0, 1, 2, 3, 4, 5, 6], checklistDiarioTemplateId: "tpl" },
      { empresaId: "e2" },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; DROP SCHEMA IF EXISTS ${SQL_SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    await prisma.checklistDiario.deleteMany({});
    await prisma.checklistPreenchido.deleteMany({});
    await config({ checklistDiarioAtivo: true, checklistDiarioDias: [0, 1, 2, 3, 4, 5, 6], checklistDiarioTemplateId: "tpl", checklistDiarioTodos: true, checklistDiarioTecnicos: [] });
  });

  it("SQL pendente: 3×, aditivo, sem retroativo, e idêntico ao que o Prisma espera (colunas, tipo, índices, chaves)", () => {
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SQL_SCHEMA} CASCADE; CREATE SCHEMA ${SQL_SCHEMA};`]);
    psql(["-c", `
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY); CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY); CREATE TABLE "tecnicos" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "veiculos" ("id" TEXT PRIMARY KEY); CREATE TABLE "checklist_templates" ("id" TEXT PRIMARY KEY); CREATE TABLE "checklist_preenchidos" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "app_um_dispositivo" BOOLEAN NOT NULL DEFAULT true);
      INSERT INTO "configuracoes" VALUES ('c1', 'e1', false);`], SQL_SCHEMA);
    for (let i = 0; i < 3; i++) psql(["-f", ARQUIVO], SQL_SCHEMA);
    // a empresa que já existia: desligada, segunda a sexta, todos, nada mais muda
    expect(psql(["-c", `SELECT "checklist_diario_ativo" || '|' || array_to_string("checklist_diario_dias", ',') || '|' || coalesce("checklist_diario_template_id", '-') || '|' || "checklist_diario_todos" || '|' || cardinality("checklist_diario_tecnicos") || '|' || "app_um_dispositivo" FROM "configuracoes"`], SQL_SCHEMA))
      .toBe("false|1,2,3,4,5|-|true|0|false");
    expect(psql(["-c", `SELECT count(*) FROM "checklist_diario"`], SQL_SCHEMA)).toBe("0");
    // rodar de novo não desliga o que a empresa ligou
    psql(["-c", `UPDATE "configuracoes" SET "checklist_diario_ativo" = true`], SQL_SCHEMA);
    psql(["-f", ARQUIVO], SQL_SCHEMA);
    expect(psql(["-c", `SELECT "checklist_diario_ativo" FROM "configuracoes"`], SQL_SCHEMA)).toBe("t");
    expect(colunas(SQL_SCHEMA)).toBe(colunas(SCHEMA));
    expect(indices(SQL_SCHEMA)).toBe(indices(SCHEMA));
    expect(chaves(SQL_SCHEMA)).toBe(chaves(SCHEMA));
    expect(tipo(SQL_SCHEMA)).toBe("FEITO,NAO_VAI_USAR");
    expect(tipo(SQL_SCHEMA)).toBe(tipo(SCHEMA));
    const sql = fs.readFileSync(ARQUIVO, "utf8").replace(/--.*$/gm, "");
    // nada destrutivo nem preenchimento (o "ON DELETE/ON UPDATE" das chaves estrangeiras não conta)
    expect(sql.match(/\b(DROP\s|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|TRUNCATE|ALTER\s+COLUMN)/i)).toBeNull();
  });

  it("resumo do porteiro: só para quem é obrigado, com veículo padrão em uso e modelo ativo; Frota desligada = nada", async () => {
    const r = await resumoPorteiro("e1", "t1");
    expect(r).toMatchObject({ dias: [0, 1, 2, 3, 4, 5, 6], diaServidor: hoje, veiculo: { id: "v1", placa: "ABC1D23", modelo: "Strada" }, modelo: { id: "tpl", nome: "Diário" }, registro: null });
    expect(r!.modelo.itens.map((i) => i.id)).toEqual(ITENS); // só itens ativos, na ordem
    expect(await resumoPorteiro("e1", "t2")).toBeNull(); // veículo em manutenção
    expect(await resumoPorteiro("e1", "t4")).toBeNull(); // sem veículo padrão
    expect(await resumoPorteiro("e1", null)).toBeNull(); // login sem colaborador
    expect(await resumoPorteiro("e2", "t1")).toBeNull(); // multiempresa: colaborador de outra empresa
    await config({ checklistDiarioTodos: false, checklistDiarioTecnicos: ["t3"] });
    expect(await resumoPorteiro("e1", "t1")).toBeNull(); // não está entre os escolhidos
    expect(await resumoPorteiro("e1", "t3")).not.toBeNull();
    await config({ checklistDiarioTodos: true, checklistDiarioAtivo: false });
    expect(await resumoPorteiro("e1", "t1")).toBeNull(); // desligado
    await config({ checklistDiarioAtivo: true, checklistDiarioTemplateId: null });
    expect(await resumoPorteiro("e1", "t1")).toBeNull(); // sem modelo
    await config({ checklistDiarioTemplateId: "tpl" });
    await desligarFrota(async () => { expect(await resumoPorteiro("e1", "t1")).toBeNull(); });
  });

  it("envio FEITO: grava o checklist como os outros (colaborador, veículo, itens, fotos) e o registro do dia; o alerta é decidido no servidor", async () => {
    TECNICO();
    const r = await enviar(feito({ itens: [{ itemTemplateId: "i-pneu", valor: "NOK" }, { itemTemplateId: "i-oleo", valor: "Normal" }, { itemTemplateId: "i-foto", foto: "data:image/jpeg;base64,AAAA" }] }));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, acao: "criar", registro: { dia: hoje, situacao: "FEITO" } });
    const [reg] = await registros();
    expect(reg).toMatchObject({ empresaId: "e1", tecnicoId: "t1", usuarioId: "u1", veiculoId: "v1", situacao: "FEITO", enviadoOffline: false, motivo: null, situacaoAnterior: null });
    const c = await prisma.checklistPreenchido.findUnique({ where: { id: reg.checklistId }, include: { itens: { orderBy: { itemTemplateId: "asc" } } } });
    expect(c).toMatchObject({ empresaId: "e1", veiculoId: "v1", templateId: "tpl", colaboradorId: "t1", status: "COM_ALERTAS" });
    expect(c.itens.map((i: any) => [i.itemTemplateId, i.valor, !!i.foto, i.alerta])).toEqual([["i-foto", null, true, false], ["i-oleo", "Normal", false, false], ["i-pneu", "NOK", false, true]]);
    // o resumo do dia agora traz o registro (o porteiro não abre mais)
    expect((await resumoPorteiro("e1", "t1"))!.registro).toEqual({ dia: hoje, situacao: "FEITO" });
  });

  it("janeiro: item OK/NOK salvo SEM opções (o técnico ficava preso): 'OK' é a resposta saudável, 'NOK' gera o alerta", async () => {
    await prisma.checklistItemTemplate.update({ where: { id: "i-pneu" }, data: { opcoes: [] } });
    try {
      TECNICO();
      const r = await enviar(feito({ itens: [{ itemTemplateId: "i-pneu", valor: "OK" }, { itemTemplateId: "i-oleo", valor: "Normal" }, { itemTemplateId: "i-foto", foto: "data:image/jpeg;base64,AAAA" }] }));
      expect(r.status).toBe(200);
      const [reg] = await registros();
      const c = await prisma.checklistPreenchido.findUnique({ where: { id: reg.checklistId }, include: { itens: true } });
      expect(c.status).toBe("CONCLUIDO"); // antes: sem opções, qualquer resposta... e nem havia botão para responder
      expect(c.itens.find((i: any) => i.itemTemplateId === "i-pneu")).toMatchObject({ valor: "OK", alerta: false });
      // o porteiro manda o item como está (o app mostra OK e NOK pela regra opcoesDoItem)
      expect((await resumoPorteiro("e1", "t3"))!.modelo.itens.find((i: any) => i.id === "i-pneu")).toMatchObject({ tipo: "OK_NOK", opcoes: [] });
      TECNICO("t3", "e1", "u3");
      await enviar(feito({ itens: [{ itemTemplateId: "i-pneu", valor: "NOK" }, { itemTemplateId: "i-oleo", valor: "Normal" }, { itemTemplateId: "i-foto", foto: "data:image/jpeg;base64,AAAA" }] }));
      const [reg3] = await registros("t3");
      const c3 = await prisma.checklistPreenchido.findUnique({ where: { id: reg3.checklistId }, include: { itens: true } });
      expect(c3.status).toBe("COM_ALERTAS");
      expect(c3.itens.find((i: any) => i.itemTemplateId === "i-pneu")).toMatchObject({ valor: "NOK", alerta: true });
    } finally {
      await prisma.checklistItemTemplate.update({ where: { id: "i-pneu" }, data: { opcoes: ["OK", "NOK"] } });
    }
  });

  it("o mesmo envio de novo não duplica; segundo FEITO (outro aparelho) não cria outro checklist; corrida de dois envios = um checklist", async () => {
    TECNICO();
    const corpo = feito();
    expect((await enviar(corpo)).json.acao).toBe("criar");
    expect((await enviar(corpo)).json.acao).toBe("repetido");
    expect((await enviar(feito())).json.acao).toBe("manter");
    expect(await prisma.checklistPreenchido.count()).toBe(1);
    await prisma.checklistDiario.deleteMany({}); await prisma.checklistPreenchido.deleteMany({});
    const corrida = await Promise.all([enviar(feito()), enviar(feito()), enviar(feito())]);
    expect(corrida.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(corrida.filter((r) => r.json.acao === "criar")).toHaveLength(1);
    expect(await prisma.checklistPreenchido.count()).toBe(1);
    expect(await prisma.checklistDiario.count()).toBe(1);
  });

  it("'não vou usar' → depois o checklist: troca, com o rastro (situação anterior, motivo e hora da troca); o feito nunca volta", async () => {
    TECNICO();
    expect((await enviar(naoVou())).json).toEqual({ ok: true, acao: "criar", registro: { dia: hoje, situacao: "NAO_VAI_USAR" } });
    const [antes] = await registros();
    expect(antes).toMatchObject({ situacao: "NAO_VAI_USAR", motivo: "Serviço a pé", checklistId: null });
    expect((await enviar(feito())).json.acao).toBe("trocar");
    const [depois] = await registros();
    expect(depois).toMatchObject({ id: antes.id, situacao: "FEITO", situacaoAnterior: "NAO_VAI_USAR", motivo: "Serviço a pé" });
    expect(depois.trocadoEm).not.toBeNull();
    expect(depois.checklistId).not.toBeNull();
    expect((await enviar(naoVou())).json).toMatchObject({ acao: "manter", registro: { situacao: "FEITO" } });
    expect((await registros())[0].situacao).toBe("FEITO");
  });

  it("enviado sem sinal (chegou bem depois do toque): marcado; dia futuro ou velho demais: recusado; item de outro modelo: recusado", async () => {
    TECNICO();
    const cedo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect((await enviar(feito({ feitoEm: cedo }))).status).toBe(200);
    const [r] = await registros();
    expect(r.enviadoOffline).toBe(true);
    expect(r.feitoEm.toISOString()).toBe(cedo);
    const { somarDias } = await import("@/lib/checklist-diario/regras");
    expect((await enviar(naoVou({ dia: somarDias(hoje, 1) }))).status).toBe(400);
    expect((await enviar(naoVou({ dia: somarDias(hoje, -31) }))).status).toBe(400);
    const r2 = await enviar(feito({ dia: ontem, itens: [{ itemTemplateId: "item-de-fora", valor: "OK" }] }));
    expect(r2.status).toBe(400);
    expect(r2.json.erro).toMatch(/Item de checklist inválido/);
    // item que saiu do modelo, preenchido sem sinal antes da mudança: aceito
    expect((await enviar(feito({ dia: ontem, itens: [{ itemTemplateId: "i-velho", valor: "OK" }] }))).status).toBe(200);
  });

  it("permissão, colaborador e multiempresa: 401, 403, login sem colaborador, veículo/modelo de outra empresa, client_id de outro colaborador", async () => {
    sessao.atual = null;
    expect((await enviar(feito())).status).toBe(401);
    logar(montarPermissoes({ ordens: ["visualizar"] }), { role: "OPERADOR" });
    expect((await enviar(feito())).status).toBe(403);
    TECNICO();
    logar(PRESETS.TECNICO as Permissoes, { tecnicoId: null });
    expect((await enviar(feito())).status).toBe(400);
    TECNICO();
    expect((await enviar(feito({ veiculoId: "vx" }))).status).toBe(400);
    expect((await enviar(feito({ templateId: "tpl-x" }))).status).toBe(400);
    // o modelo de outra empresa com os itens DELE (não é o "item de fora" que barra: é a empresa do modelo)
    const itemX = await prisma.checklistItemTemplate.findFirst({ where: { templateId: "tpl-x" }, select: { id: true } });
    const outro = await enviar(feito({ templateId: "tpl-x", itens: [{ itemTemplateId: itemX.id, valor: "OK" }] }));
    expect(outro.status).toBe(400);
    expect(outro.json.erro).toMatch(/Modelo de checklist não encontrado/);
    expect(await prisma.checklistPreenchido.count({ where: { templateId: "tpl-x" } })).toBe(0);
    expect((await enviar({ ...feito(), extra: 1 })).status).toBe(400);
    const corpo = naoVou();
    expect((await enviar(corpo)).status).toBe(200);
    TECNICO("t3", "e1", "u3");
    expect((await enviar(corpo)).status).toBe(400); // o client_id já é de outro colaborador
    expect(await prisma.checklistDiario.count({ where: { tecnicoId: "t3" } })).toBe(0);
  });

  it("Frota desligada: o envio que estava no aparelho é aceito sem gravar (a fila esvazia, nunca 403)", async () => {
    TECNICO();
    await desligarFrota(async () => {
      const r = await enviar(feito());
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ ok: true, acao: "ignorado", registro: null });
      // o serviço também se protege sozinho (não depende só da rota)
      const direto = await registrarEnvioDiario({ empresaId: "e1", usuarioId: "u1", tecnicoId: "t1", envio: envioDiarioSchema.parse(feito()) });
      expect(direto).toEqual({ ok: true, acao: "ignorado", registro: null });
    });
    expect(await prisma.checklistDiario.count()).toBe(0);
  });

  it("histórico do gestor: feito, com alertas, não vai usar, 'Sem registro' de ontem, 'Ainda não fez' hoje; abrir dá ciência e tira do sino", async () => {
    TECNICO(); await enviar(naoVou());
    TECNICO("t3", "e1", "u3"); await enviar(feito({ dia: ontem }));
    GESTOR();
    const { contarAlertasVeiculos } = await import("@/lib/veiculo-server");
    expect((await contarAlertasVeiculos("e1")).checklistNaoVaiUsar).toBe(1);
    const h = await chamar("checklist-diario", "GET", undefined, `?de=${ontem}&ate=${hoje}`);
    expect(h.status).toBe(200);
    expect(h.json.linhas.map((l: any) => [l.dia, l.nome, l.situacao])).toEqual([
      [hoje, "Carlos", "NAO_VAI_USAR"], [hoje, "Dani", "PENDENTE"],
      [ontem, "Carlos", "SEM_REGISTRO"], [ontem, "Dani", "FEITO"],
    ]); // Bruno (veículo em manutenção) e Edu (sem veículo) não aparecem
    expect(h.json.linhas[0].registro).toMatchObject({ motivo: "Serviço a pé", veiculo: "ABC1D23" });
    expect((await contarAlertasVeiculos("e1")).checklistNaoVaiUsar).toBe(0);
    // multiempresa: a outra empresa não vê nada
    GESTOR("e2");
    expect((await chamar("checklist-diario", "GET", undefined, `?de=${ontem}&ate=${hoje}`)).json.linhas).toEqual([]);
    // período inválido
    GESTOR();
    expect((await chamar("checklist-diario", "GET", undefined, `?de=${hoje}&ate=${ontem}`)).status).toBe(400);
    // quem só preenche checklist (sem ver a frota) não vê o histórico
    logar(montarPermissoes({ veiculos: ["checklist"], ordens: ["visualizar"] }), { role: "OPERADOR" });
    expect((await chamar("checklist-diario", "GET")).status).toBe(403);
  });

  it("configuração: gestor salva; técnico não; modelo/colaborador de outra empresa e ligar sem modelo são recusados", async () => {
    const corpo = { ativo: true, dias: [1, 3, 5, 3], templateId: "tpl", todos: false, tecnicos: ["t1", "t3"] };
    TECNICO();
    expect((await chamar("checklist-diario/config", "PUT", corpo)).status).toBe(403);
    GESTOR();
    const r = await chamar("checklist-diario/config", "PUT", corpo);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ativo: true, dias: [1, 3, 5], templateId: "tpl", todos: false, tecnicos: ["t1", "t3"] });
    expect((await chamar("checklist-diario/config", "GET")).json).toEqual(r.json);
    expect((await chamar("checklist-diario/config", "PUT", { ...corpo, templateId: "tpl-x" })).status).toBe(400);
    expect((await chamar("checklist-diario/config", "PUT", { ...corpo, tecnicos: ["tx"] })).status).toBe(400);
    expect((await chamar("checklist-diario/config", "PUT", { ...corpo, templateId: null })).json.erro).toMatch(/modelo/i);
    expect((await chamar("checklist-diario/config", "PUT", { ...corpo, dias: [] })).status).toBe(400);
    expect((await chamar("checklist-diario/config", "PUT", { ...corpo, tecnicos: [] })).status).toBe(400);
    // desligar não exige nada
    expect((await chamar("checklist-diario/config", "PUT", { ...corpo, ativo: false, templateId: null, tecnicos: [] })).status).toBe(200);
    // a outra empresa continua como estava
    GESTOR("e2");
    expect((await chamar("checklist-diario/config", "GET")).json).toMatchObject({ ativo: false, templateId: null });
  });
});
