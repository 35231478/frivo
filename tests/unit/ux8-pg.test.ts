/**
 * UX-8 "Consistência miúda" — rotas e telas de servidor num PostgreSQL real (schema descartável):
 *  - G4: "TUDO OK" no desktop marca OK só os itens OK/Atenção/N.A. SEM resposta (não toca a
 *    Atenção já dada, não inventa número de medição), numa chamada; respeita permissão/empresa;
 *  - Y6: habilitar a competência inline é ADITIVO (não apaga as outras), exige "gerenciar
 *    colaboradores" e não cruza empresa;
 *  - Y16: no portal, visita AGENDADA que ficou no passado aparece como "a reagendar" (agenda e
 *    card do início) em vez de sumir ou virar "—".
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/ux8-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_ux8_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any, portal: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/portal-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/portal-server")>()),
  requirePortalSession: vi.fn(async () => sessao.portal),
}));

vi.setConfig({ testTimeout: 60_000 });

const logar = (empresaId = "e1", permissoes: Permissoes = permissoesTotais()) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "u1" : "u2", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const so = (...pares: [string, string][]) => {
  const p = permissoesVazias() as any;
  for (const [m, a] of pares) p[m] = { ...(p[m] ?? {}), [a]: true };
  return p as Permissoes;
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const TUDO_OK = "ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/tudo-ok";
const ITEM = "ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/itens/[itemId]";
const COMPETENCIAS = "tecnicos/[id]/competencias";

describe.skipIf(!URL_PG)("UX-8 — consistência miúda (PostgreSQL real)", () => {
  let prisma: any;
  let osId: string, atId: string;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens", TUDO_OK, ITEM, COMPETENCIAS].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x", role: "ADMIN" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tipoOs.createMany({ data: [
      { id: "to1", empresaId: "e1", nome: "Preventiva" },
      { id: "to2", empresaId: "e1", nome: "Higienização" },
      { id: "toE2", empresaId: "e2", nome: "Da outra" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000", competencias: { connect: [{ id: "to1" }] } } });
    await prisma.tecnico.create({ data: { id: "tE2", empresaId: "e2", nome: "Da outra", cpf: "55566677788", telefone: "11999990001" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11222333000181" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Limpeza dos filtros", ordem: 0 },
      { id: "i2", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Dreno", ordem: 1 },
      { id: "i3", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Teste de funcionamento", ordem: 2 },
      { id: "m1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Corrente do compressor", tipoResposta: "MEDICAO", ordem: 3 },
      { id: "iX", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Item que saiu do checklist", ativo: false, ordem: 4 },
    ] });
    await prisma.equipamento.create({ data: { id: "eqA", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "te1", marca: "Daikin", modelo: "FTXS" } });
    logar();
    const r = await chamar("ordens", "POST", {}, {
      clienteId: "c1", unidadeId: "un1", descricao: "Preventiva", prioridade: "NORMAL",
      execucao: { tecnicoIds: ["t1"], responsavelId: "t1" }, equipamentoIds: ["eqA"],
    });
    expect(r.status).toBe(201);
    osId = r.json.id;
    atId = (await prisma.atividadeOs.findFirst({ where: { ordemServicoId: osId } })).id;
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  const params = () => ({ id: osId, atividadeId: atId, equipamentoId: "eqA" });
  const statusDe = async () => Object.fromEntries(
    (await prisma.checklistResposta.findMany({ where: { atividadeId: atId, equipamentoId: "eqA" } })).map((r: any) => [r.itemId, r.status]),
  );

  it("G4: TUDO OK marca só os sem resposta — Atenção dada continua, medição e item inativo ficam de fora", async () => {
    // Uma Atenção já dada antes
    const at = await chamar(ITEM, "PUT", { ...params(), itemId: "i2" }, { status: "ATENCAO", observacao: "Dreno entupido" });
    expect(at.status).toBe(200);

    const r = await chamar(TUDO_OK, "POST", params());
    expect(r.status).toBe(200);
    expect([...r.json.marcados].sort()).toEqual(["i1", "i3"]);
    expect(r.json.feito).toBe(true);
    const s = await statusDe();
    expect(s).toMatchObject({ i1: "OK", i2: "ATENCAO", i3: "OK" });
    expect(s.m1 ?? null).toBeNull();   // medição precisa do número — não é inventada
    expect(s.iX).toBeUndefined();      // item que saiu do checklist não é respondido

    // De novo: nada mais a marcar (idempotente)
    const de = await chamar(TUDO_OK, "POST", params());
    expect(de.json.marcados).toEqual([]);
  });

  it("G4: sem permissão de executar/editar OS ou de outra empresa, o TUDO OK é recusado", async () => {
    logar("e1", so(["clientes", "visualizar"]));
    expect((await chamar(TUDO_OK, "POST", params())).status).toBe(403);
    logar("e2");
    expect([403, 404]).toContain((await chamar(TUDO_OK, "POST", params())).status);
    logar();
  });

  it("Y6: habilitar competência inline é ADITIVO e respeita permissão e empresa", async () => {
    const r = await chamar(COMPETENCIAS, "POST", { id: "t1" }, { tipoOsId: "to2" });
    expect(r.status).toBe(200);
    const t = await prisma.tecnico.findUnique({ where: { id: "t1" }, include: { competencias: { select: { id: true } } } });
    expect(t.competencias.map((c: any) => c.id).sort()).toEqual(["to1", "to2"]); // a antiga continua

    // Tipo de OS de outra empresa / técnico de outra empresa: 404
    expect((await chamar(COMPETENCIAS, "POST", { id: "t1" }, { tipoOsId: "toE2" })).status).toBe(404);
    expect((await chamar(COMPETENCIAS, "POST", { id: "tE2" }, { tipoOsId: "to1" })).status).toBe(404);
    // Quem só vê colaboradores não habilita
    logar("e1", so(["equipes", "visualizar"]));
    expect((await chamar(COMPETENCIAS, "POST", { id: "t1" }, { tipoOsId: "to1" })).status).toBe(403);
    logar();
  });

  it("Y16: visita AGENDADA no passado aparece como 'a reagendar' na agenda e no início do portal", async () => {
    const ontem = new Date(Date.now() - 2 * 864e5);
    const amanha = new Date(Date.now() + 3 * 864e5);
    await prisma.ordemServico.update({ where: { id: osId }, data: { status: "AGENDADA", previsaoConclusao: ontem, descricao: "Visita que ficou para trás" } });
    sessao.portal = { user: { id: "ct1", empresaId: "e1", clienteId: "c1", permissoes: { verOS: true, abrirChamados: true } } };

    const { default: Agenda } = await import("@/app/(portal)/portal/(protegido)/agenda/page");
    let html = renderToStaticMarkup(await Agenda());
    expect(html).toContain("Visitas a reagendar");
    expect(html).toContain("Visita que ficou para trás");
    expect(html).toContain("a reagendar");

    const { default: Inicio } = await import("@/app/(portal)/portal/(protegido)/dashboard/page");
    html = renderToStaticMarkup(await Inicio());
    expect(html).toContain("Visita a reagendar");
    expect(html).not.toMatch(/Próxima manutenção[\s\S]{0,200}>—</);

    // Com uma visita FUTURA, o card volta a ser "Próxima manutenção" e a agenda não tem bloco de atraso para ela
    await prisma.ordemServico.update({ where: { id: osId }, data: { previsaoConclusao: amanha } });
    html = renderToStaticMarkup(await Inicio());
    expect(html).toContain("Próxima manutenção");
    expect(html).not.toContain("Visita a reagendar");
    html = renderToStaticMarkup(await Agenda());
    expect(html).not.toContain("Visitas a reagendar");
  });
});
