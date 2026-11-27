/**
 * Leva 6A — Contratos: as ROTAS num PostgreSQL real (schema descartável via `prisma db push`).
 *
 * A tela esconde o que a pessoa não pode fazer; aqui se prova o outro lado: com a requisição na mão,
 * o servidor RECUSA e o banco não muda.
 *
 *  - POST /api/contratos exige Contratos › criar (403 sem ela, 401 sem sessão) e nenhum contrato nasce;
 *  - PUT /api/contratos/[id] e PATCH .../status exigem Contratos › editar — nada muda no banco;
 *  - POST .../gerar-os aceita Ordens › criar OU Contratos › editar (e é idempotente no mês);
 *  - POST .../reajuste exige Contratos › editar — o valor do contrato fica como estava;
 *  - nada atravessa de outra empresa (404, não 403: a outra empresa não existe para quem pergunta).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva6a-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva6a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const deslogado = () => { sessao.atual = null; };

const corpoJson = (corpo: unknown, metodo: string) =>
  new NextRequest("http://localhost/api/contratos/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

async function criarContrato(corpo: unknown) {
  const mod = await import("@/app/api/contratos/route");
  const res: Response = await mod.POST(corpoJson(corpo, "POST"));
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function salvarContrato(id: string, corpo: unknown) {
  const mod = await import("@/app/api/contratos/[id]/route");
  const res: Response = await mod.PUT(corpoJson(corpo, "PUT"), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function mudarStatus(id: string, corpo: unknown) {
  const mod = await import("@/app/api/contratos/[id]/status/route");
  const res: Response = await mod.PATCH(corpoJson(corpo, "PATCH"), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function gerarOs(id: string, corpo: unknown) {
  const mod = await import("@/app/api/contratos/[id]/gerar-os/route");
  const res: Response = await mod.POST(corpoJson(corpo, "POST"), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function reajustar(id: string, corpo: unknown) {
  const mod = await import("@/app/api/contratos/[id]/reajuste/route");
  const res: Response = await mod.POST(corpoJson(corpo, "POST"), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva 6A — Contratos (PostgreSQL real)", () => {
  let prisma: any;

  const DADOS_NOVO = {
    clienteId: "c1", numero: "CT-99", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", periodicidade: "MENSAL",
    valorMensal: 900, dataInicio: "2026-02-01", dataFim: "2027-02-01",
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    for (const m of [
      () => import("@/app/api/contratos/route"),
      () => import("@/app/api/contratos/[id]/route"),
      () => import("@/app/api/contratos/[id]/status/route"),
      () => import("@/app/api/contratos/[id]/gerar-os/route"),
      () => import("@/app/api/contratos/[id]/reajuste/route"),
    ]) await m();

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "2" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
    ] });
  }, 240_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.ordemServico.deleteMany({});
    await prisma.reajusteContrato.deleteMany({});
    await prisma.contratoHistoricoStatus.deleteMany({}).catch(() => {});
    await prisma.contrato.deleteMany({});
    await prisma.contrato.create({ data: {
      id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-18", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
      periodicidade: "MENSAL", valorMensal: 1200, dataInicio: new Date("2025-01-10"), dataFim: new Date("2027-01-10"),
      recorrencia: true, frequenciaRecorrencia: "MENSAL", diaRecorrencia: 10,
      reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 5,
    } });
    await prisma.contrato.create({ data: {
      id: "ctE2", empresaId: "e2", clienteId: "cE2", numero: "CT-E2", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
      periodicidade: "MENSAL", valorMensal: 500, dataInicio: new Date("2025-01-10"),
    } });
    como();
  });

  const valorDe = async (id: string) => Number((await prisma.contrato.findUnique({ where: { id }, select: { valorMensal: true } })).valorMensal);
  const contratos = () => prisma.contrato.count({ where: { empresaId: "e1" } });

  /* ───── criar ───── */
  it("POST /api/contratos: sem Contratos › criar é 403 e nenhum contrato nasce", async () => {
    como(montarPermissoes({ contratos: ["visualizar", "editar"] }));
    const antes = await contratos();
    const r = await criarContrato(DADOS_NOVO);
    expect(r.status).toBe(403);
    expect(r.json.erro).toBe("Sem permissão para esta ação");
    expect(await contratos()).toBe(antes);
  });

  it("POST /api/contratos: sem sessão é 401 e nenhum contrato nasce", async () => {
    deslogado();
    const antes = await contratos();
    const r = await criarContrato(DADOS_NOVO);
    expect(r.status).toBe(401);
    expect(await contratos()).toBe(antes);
  });

  it("POST /api/contratos: com a permissão, cria", async () => {
    como(montarPermissoes({ contratos: ["criar"] }));
    const r = await criarContrato(DADOS_NOVO);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(await prisma.contrato.count({ where: { empresaId: "e1", numero: "CT-99" } })).toBe(1);
  });

  /* ───── editar e status ───── */
  it("PUT /api/contratos/[id]: sem Contratos › editar é 403 e o valor fica como estava", async () => {
    como(montarPermissoes({ contratos: ["visualizar", "criar"] }));
    const r = await salvarContrato("ct1", { ...DADOS_NOVO, numero: "CT-18", valorMensal: 5000 });
    expect(r.status).toBe(403);
    expect(await valorDe("ct1")).toBe(1200);
  });

  it("PATCH .../status: sem Contratos › editar é 403, o status fica e nada vai para o histórico", async () => {
    como(montarPermissoes({ contratos: ["visualizar"] }));
    const r = await mudarStatus("ct1", { status: "CANCELADO", motivo: "teste" });
    expect(r.status).toBe(403);
    const ct = await prisma.contrato.findUnique({ where: { id: "ct1" } });
    expect(ct.status).toBe("ATIVO");
    expect(await prisma.contratoHistoricoStatus.count({})).toBe(0);
  });

  it("PATCH .../status: com Contratos › editar muda e registra quem mudou", async () => {
    como(montarPermissoes({ contratos: ["editar"] }));
    const r = await mudarStatus("ct1", { status: "SUSPENSO", motivo: "inadimplência" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await prisma.contrato.findUnique({ where: { id: "ct1" } })).status).toBe("SUSPENSO");
    const h = await prisma.contratoHistoricoStatus.findFirst({});
    expect([h.statusAnterior, h.statusNovo, h.motivo, h.usuarioId]).toEqual(["ATIVO", "SUSPENSO", "inadimplência", "uA"]);
  });

  it("o contrato de outra empresa não existe para quem pergunta (404, e nada muda)", async () => {
    // cancelar pede Contratos › Excluir (leva 5 de cadastros): com ela, a outra empresa segue invisível
    como(montarPermissoes({ contratos: ["editar", "excluir"] }));
    const r = await mudarStatus("ctE2", { status: "CANCELADO" });
    expect(r.status).toBe(404);
    expect((await prisma.contrato.findUnique({ where: { id: "ctE2" } })).status).toBe("ATIVO");
  });

  /* ───── gerar OS do mês (relatório) ───── */
  it("POST .../gerar-os: sem Ordens › criar nem Contratos › editar é 403 e nenhuma OS nasce", async () => {
    como(montarPermissoes({ contratos: ["visualizar"] }));
    const r = await gerarOs("ct1", { mes: 3, ano: 2026 });
    expect(r.status).toBe(403);
    expect(await prisma.ordemServico.count({})).toBe(0);
  });

  it("POST .../gerar-os: Ordens › criar basta; Contratos › editar também; e repetir não duplica", async () => {
    como(montarPermissoes({ ordens: ["criar"] }));
    const r1 = await gerarOs("ct1", { mes: 3, ano: 2026 });
    expect(r1.status, JSON.stringify(r1.json)).toBe(201);
    expect(await prisma.ordemServico.count({})).toBe(1);

    // segunda chamada do mesmo mês: devolve a que existe, sem criar outra
    const r2 = await gerarOs("ct1", { mes: 3, ano: 2026 });
    expect(r2.json.jaExistia).toBe(true);
    expect(await prisma.ordemServico.count({})).toBe(1);

    // quem administra o contrato também gera (outro mês, para não cair na idempotência)
    como(montarPermissoes({ contratos: ["editar"] }));
    const r3 = await gerarOs("ct1", { mes: 4, ano: 2026 });
    expect(r3.status, JSON.stringify(r3.json)).toBe(201);
    expect(await prisma.ordemServico.count({})).toBe(2);
  });

  /* ───── reajuste ───── */
  it("POST .../reajuste: sem Contratos › editar é 403, o valor não muda e nada entra no histórico", async () => {
    como(montarPermissoes({ contratos: ["visualizar"] }));
    const r = await reajustar("ct1", { ano: 2026, acao: "APLICAR", valorEsperado: 1200 });
    expect(r.status).toBe(403);
    expect(await valorDe("ct1")).toBe(1200);
    expect(await prisma.reajusteContrato.count({})).toBe(0);
  });

  it("POST .../reajuste: com a permissão aplica, e o valor esperado protege de aplicar duas vezes", async () => {
    como(montarPermissoes({ contratos: ["editar"] }));
    const r = await reajustar("ct1", { ano: 2026, acao: "APLICAR", valorEsperado: 1200 });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await valorDe("ct1")).toBe(1260);

    // o mesmo pedido de novo: o valor de partida já não é 1200 — recusa e nada muda
    const r2 = await reajustar("ct1", { ano: 2026, acao: "APLICAR", valorEsperado: 1200 });
    expect(r2.status).not.toBe(200);
    expect(await valorDe("ct1")).toBe(1260);
  });

  it("POST .../reajuste: dispensar não mexe no valor, só registra a decisão", async () => {
    como(montarPermissoes({ contratos: ["editar"] }));
    const r = await reajustar("ct1", { ano: 2026, acao: "DISPENSAR", motivo: "cliente negociou manter" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await valorDe("ct1")).toBe(1200);
    const d = await prisma.reajusteContrato.findFirst({});
    expect([d.situacao, d.anoReferencia, d.motivo]).toEqual(["DISPENSADO", 2026, "cliente negociou manter"]);
  });
});
