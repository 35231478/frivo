/**
 * Leva 9 — Desempenho: o DINHEIRO no servidor, num PostgreSQL real (schema descartável).
 *
 * A leva mexeu na tela; aqui se prova o outro lado, que é o que importa num módulo com bônus:
 *  - sem "Desempenho › Gerenciar", TODA rota de dinheiro (fechar, reabrir, exportar, configuração,
 *    perfis, regra, participantes, premiações, TV) responde 403 e o banco fica IDÊNTICO;
 *  - sem "Desempenho › Revisar", decidir, registrar, editar e excluir item da revisão: 403, banco igual;
 *  - sem sessão, 401 — e também nada muda;
 *  - valor em reais: quem só visualiza recebe o painel e a ficha SEM bônus e SEM valor de faixa;
 *  - mês fechado continua travado: a decisão da revisão é recusada (409) e nada muda;
 *  - fechar e reabrir continuam funcionando para quem gerencia (a leva não mexeu no fluxo).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva9-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, type Acao, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva9_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const AGORA = new Date("2026-11-13T15:00:00Z");
const MES = "2026-11";
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const entrar = (permissoes: Permissoes, empresaId = "e1") => {
  sessao.atual = { user: { id: "uG", name: "Gil Gestor", email: "gil@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const com = (acoes: Acao[]) => entrar(montarPermissoes({ desempenho: acoes }));
const gestao = () => com(["visualizar", "revisar", "gerenciar"]);
const SO_VE = () => com(["visualizar"]);

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`https://app.exemplo.com/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const json = (res.headers.get("content-type") ?? "").includes("json") ? await res.clone().json() : null;
  return { status: res.status, json };
}

const R = {
  painel: "desempenho", ficha: "desempenho/colaboradores/[id]", config: "desempenho/configuracao", tv: "desempenho/tv",
  perfis: "desempenho/perfis", perfil: "desempenho/perfis/[id]", regra: "desempenho/perfis/[id]/regra",
  participantes: "desempenho/participantes", participante: "desempenho/participantes/[tecnicoId]",
  penalidades: "desempenho/penalidades", penalidade: "desempenho/penalidades/[id]", decisao: "desempenho/penalidades/[id]/decisao",
  premiacoes: "desempenho/premiacoes", premiacao: "desempenho/premiacoes/[id]",
  fechamentos: "desempenho/fechamentos", fechamento: "desempenho/fechamentos/[id]",
  reabrir: "desempenho/fechamentos/[id]/reabrir", exportar: "desempenho/fechamentos/[id]/exportar",
};
const REGRA = {
  pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70,
  faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }, { nome: "Ouro", minimo: 90, valor: 350 }],
};

describe.skipIf(!URL_PG)("Leva 9 — Desempenho: o dinheiro atrás da permissão (PostgreSQL real)", () => {
  let prisma: any;
  let perfilId = "";

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "uG", empresaId: "e1", nome: "Gil Gestor", email: "gil@x.com", senha: "x" } });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Ana Dias", cpf: "1", telefone: "1" },
      { id: "t2", empresaId: "e1", nome: "Bia Reis", cpf: "2", telefone: "2" },
    ] });

    // o módulo nasce quando a gestão abre a configuração
    gestao();
    await chamar(R.config, "GET");
    perfilId = (await prisma.desempenhoPerfil.findFirstOrThrow({ where: { empresaId: "e1" } })).id;
    expect((await chamar(R.regra, "PUT", { id: perfilId }, REGRA)).status).toBe(200);
    expect((await chamar(R.participantes, "POST", {}, { tecnicoId: "t1", perfilId })).status).toBe(200);
    expect((await chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "Kit de ferramentas", descricao: null, perfilId: null })).status).toBe(201);
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    if (URL_PG) execFileSync("psql", [URL_PG, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(() => { vi.setSystemTime(AGORA); gestao(); });

  /** O retrato do módulo: nada disso pode mudar quando o servidor recusa. */
  const retrato = async () => ({
    config: await prisma.desempenhoConfig.findMany().then((l: any[]) => l.map((c) => [c.empresaId, c.retornoDias, c.tvToken])),
    perfis: await prisma.desempenhoPerfil.findMany({ orderBy: { id: "asc" } }).then((l: any[]) => l.map((p) => [p.id, p.nome, p.tipo])),
    regras: await prisma.desempenhoRegra.findMany({ orderBy: { id: "asc" } }).then((l: any[]) => l.map((r) => [r.perfilId, r.vigenteDesde, Number(r.metaMinima), JSON.stringify(r.faixas)])),
    participantes: await prisma.desempenhoParticipante.findMany({ orderBy: { tecnicoId: "asc" } }).then((l: any[]) => l.map((p) => [p.tecnicoId, p.perfilId])),
    premiacoes: await prisma.desempenhoPremiacao.findMany({ orderBy: { id: "asc" } }).then((l: any[]) => l.map((p) => [p.titulo, p.competencia, p.perfilId])),
    fechamentos: await prisma.desempenhoFechamento.findMany({ orderBy: { id: "asc" } }).then((l: any[]) => l.map((f) => [f.competencia, f.versao, f.situacao, Number(f.totalBonus)])),
    linhas: await prisma.desempenhoFechamentoLinha.count(),
    penalidades: await prisma.desempenhoPenalidade.findMany({ orderBy: { id: "asc" } }).then((l: any[]) => l.map((p) => [p.tecnicoId, p.tipo, p.situacao, p.motivo])),
  });

  /* ───────── prioridade 1: 403 com o banco intacto ───────── */

  const ROTAS_DE_DINHEIRO = () => [
    ["fechar o mês", () => chamar(R.fechamentos, "POST", {}, { competencia: MES })],
    ["ver a folha do mês", () => chamar(R.fechamentos, "GET", {}, undefined, `?mes=${MES}`)],
    ["abrir a configuração", () => chamar(R.config, "GET")],
    ["salvar os ajustes", () => chamar(R.config, "PUT", {}, { retornoDias: 45, tiposRetorno: [] })],
    ["criar perfil", () => chamar(R.perfis, "POST", {}, { nome: "Novo", tipo: "TECNICO" })],
    ["editar perfil", () => chamar(R.perfil, "PUT", { id: perfilId }, { nome: "Outro", tipo: "TECNICO" })],
    ["excluir perfil", () => chamar(R.perfil, "DELETE", { id: perfilId })],
    ["mudar a regra (valor do bônus)", () => chamar(R.regra, "PUT", { id: perfilId }, { ...REGRA, faixas: [{ nome: "Ouro", minimo: 70, valor: 9999 }] })],
    ["descartar a regra agendada", () => chamar(R.regra, "DELETE", { id: perfilId })],
    ["adicionar participante", () => chamar(R.participantes, "POST", {}, { tecnicoId: "t2", perfilId })],
    ["tirar do ranking", () => chamar(R.participante, "DELETE", { tecnicoId: "t1" })],
    ["cadastrar premiação", () => chamar(R.premiacoes, "POST", {}, { competencia: MES, titulo: "Outro prêmio", descricao: null, perfilId: null })],
    ["ligar o modo TV", () => chamar(R.tv, "POST")],
  ] as const;

  it("sem Desempenho › Gerenciar, toda rota de dinheiro é 403 — e o banco fica idêntico", async () => {
    const antes = await retrato();
    SO_VE();
    for (const [nome, chamada] of ROTAS_DE_DINHEIRO()) {
      const r = await chamada();
      expect([nome, r.status, r.json?.erro]).toEqual([nome, 403, "Sem permissão para esta ação"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("sem Desempenho › Revisar, decidir e mexer na lista de revisão é 403 — e o banco fica idêntico", async () => {
    const antes = await retrato();
    SO_VE();
    for (const [nome, chamada] of [
      ["ver a lista", () => chamar(R.penalidades, "GET")],
      ["registrar reclamação", () => chamar(R.penalidades, "POST", {}, { tecnicoId: "t1", data: "2026-11-05", descricao: "Cliente ligou reclamando" })],
      ["editar reclamação", () => chamar(R.penalidade, "PUT", { id: "qualquer" }, { tecnicoId: "t1", data: "2026-11-05", descricao: "Outra coisa" })],
      ["excluir reclamação", () => chamar(R.penalidade, "DELETE", { id: "qualquer" })],
      ["decidir que conta", () => chamar(R.decisao, "POST", { id: "qualquer" }, { situacao: "CONTA", motivo: "o defeito era do serviço anterior" })],
    ] as const) {
      const r = await chamada();
      expect([nome, r.status, r.json?.erro]).toEqual([nome, 403, "Sem permissão para esta ação"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("sem sessão, 401 em tudo — e nada muda", async () => {
    const antes = await retrato();
    sessao.atual = null;
    for (const [nome, chamada] of ROTAS_DE_DINHEIRO()) {
      const r = await chamada();
      expect([nome, r.status, r.json?.erro]).toEqual([nome, 401, "Não autorizado"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  /* ───────── valor em reais só para quem gerencia ───────── */

  it("quem só visualiza recebe o painel e a ficha sem bônus e sem valor de faixa", async () => {
    SO_VE();
    const painel = (await chamar(R.painel, "GET", {}, undefined, `?mes=${MES}`)).json;
    const linhas = painel.grupos.flatMap((g: any) => g.linhas);
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((l: any) => l.bonus === null)).toBe(true);
    expect(painel.grupos.flatMap((g: any) => g.regra?.faixas ?? []).every((f: any) => f.valor === null)).toBe(true);
    const ficha = (await chamar(R.ficha, "GET", { id: "t1" }, undefined, `?mes=${MES}`)).json;
    expect(ficha.linha.bonus).toBeNull();
    expect(JSON.stringify(painel)).not.toContain("350");

    // a mesma leitura, com Gerenciar, traz os valores
    gestao();
    const comValores = (await chamar(R.painel, "GET", {}, undefined, `?mes=${MES}`)).json;
    expect(comValores.grupos.flatMap((g: any) => g.regra?.faixas ?? []).map((f: any) => f.valor)).toEqual([100, 350]);
  });

  /* ───────── o fluxo continua o mesmo para quem gerencia ───────── */

  it("fechar o mês grava a folha; reabrir pede motivo e deixa registro — e a revisão trava no mês fechado", async () => {
    // uma reclamação à mão, para a revisão ter o que decidir
    const nova = await chamar(R.penalidades, "POST", {}, { tecnicoId: "t1", data: "2026-11-05", descricao: "Cliente ligou dizendo que voltou a pingar" });
    expect(nova.status).toBe(201);
    const penalidadeId = (await prisma.desempenhoPenalidade.findFirstOrThrow({})).id;

    const fechou = await chamar(R.fechamentos, "POST", {}, { competencia: MES, ciente: true });
    expect(fechou.status).toBe(201);
    const f = await prisma.desempenhoFechamento.findFirstOrThrow({ where: { competencia: MES } });
    expect([f.situacao, f.versao, f.fechadoPorNome]).toEqual(["FECHADO", 1, "Gil Gestor"]);

    // mês fechado: a decisão é recusada e nada muda
    const antes = await retrato();
    const recusada = await chamar(R.decisao, "POST", { id: penalidadeId }, { situacao: "CONTA", motivo: "o defeito era do serviço anterior" });
    expect(recusada.status).toBe(409);
    expect(await retrato()).toEqual(antes);

    // reabrir exige motivo; com motivo, fica registrado e o mês volta a ser calculado
    expect((await chamar(R.reabrir, "POST", { id: f.id }, { motivo: "oi" })).status).toBe(400);
    const reabriu = await chamar(R.reabrir, "POST", { id: f.id }, { motivo: "Avaliação lançada na OS errada" });
    expect(reabriu.status).toBe(200);
    const depois = await prisma.desempenhoFechamento.findUniqueOrThrow({ where: { id: f.id } });
    expect([depois.situacao, depois.reaberturaMotivo, depois.reabertoPorNome]).toEqual(["REABERTO", "Avaliação lançada na OS errada", "Gil Gestor"]);
    // o fechamento continua no histórico: reabrir não apaga
    expect(await prisma.desempenhoFechamento.count()).toBe(1);

    // com o mês aberto de novo, a decisão passa
    expect((await chamar(R.decisao, "POST", { id: penalidadeId }, { situacao: "NAO_CONTA", motivo: "equipamento sofreu queda de energia" })).status).toBe(200);
    await prisma.desempenhoPenalidade.deleteMany({});
    await prisma.desempenhoFechamentoLinha.deleteMany({});
    await prisma.desempenhoFechamento.deleteMany({});
  });
});
