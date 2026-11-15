/**
 * Leva 6B — Orçamentos, leads e sugestões: as ROTAS num PostgreSQL real (schema descartável).
 *
 * A tela esconde o que a pessoa não pode fazer; aqui se prova o outro lado: com a requisição na mão,
 * o servidor RECUSA e o banco não muda.
 *
 *  - GET /api/orcamentos/sugestoes exige Orçamentos › criar (403 sem ela) e pede o cliente (400);
 *  - sugere o que repetiu em dois orçamentos, com o último preço; ignora cancelado, o orçamento
 *    aberto, o catálogo inativo e o que é de outra empresa;
 *  - DELETE /api/orcamentos/[id] (Descartar) exige Orçamentos › excluir — sem ela, 403 e o lead
 *    continua como estava; com ela, vira CANCELADO e a linha do tempo guarda quem e quando;
 *  - PATCH /api/orcamentos/[id] (Reabrir) exige Orçamentos › editar — sem ela, 403 e nada muda.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva6b-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva6b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana Souza", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function sugestoes(query: string) {
  const mod = await import("@/app/api/orcamentos/sugestoes/route");
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/orcamentos/sugestoes?${query}`));
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function descartar(id: string) {
  const mod = await import("@/app/api/orcamentos/[id]/route");
  const res: Response = await mod.DELETE(new NextRequest(`http://localhost/api/orcamentos/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function reabrir(id: string, corpo: unknown = { ativo: true }) {
  const mod = await import("@/app/api/orcamentos/[id]/route");
  const req = new NextRequest(`http://localhost/api/orcamentos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const res: Response = await mod.PATCH(req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva 6B — Orçamentos e leads (PostgreSQL real)", () => {
  let prisma: any;

  const ontem = (dias: number) => new Date(Date.now() - dias * 86400000);

  /** Um orçamento do cliente com as linhas pedidas. */
  async function orcamento(id: string, o: {
    clienteId?: string; empresaId?: string; status?: string; criadoEm?: Date;
    servicos?: { servicoId?: string | null; descricao: string; valorUnitario: number }[];
    produtos?: { produtoId?: string | null; descricao: string; valorUnitario: number }[];
  }) {
    await prisma.orcamento.create({
      data: {
        id, empresaId: o.empresaId ?? "e1", clienteId: o.clienteId ?? "c1", codigo: `ORC-${id}`,
        nome: `Orçamento ${id}`, criadoPorId: o.empresaId === "e2" ? "uB" : "uA",
        status: (o.status ?? "ENVIADO") as any, tokenPublico: `tok-${id}`,
        criadoEm: o.criadoEm ?? ontem(10), atualizadoEm: new Date(),
        servicos: { create: (o.servicos ?? []).map((s, i) => ({
          servicoId: s.servicoId ?? null, descricao: s.descricao, quantidade: 1,
          valorUnitario: s.valorUnitario, valorTotal: s.valorUnitario, ordem: i,
        })) },
        produtos: { create: (o.produtos ?? []).map((p, i) => ({
          produtoId: p.produtoId ?? null, descricao: p.descricao, quantidade: 1,
          valorUnitario: p.valorUnitario, valorTotal: p.valorUnitario, ordem: i,
        })) },
      },
    });
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    for (const m of [
      () => import("@/app/api/orcamentos/sugestoes/route"),
      () => import("@/app/api/orcamentos/[id]/route"),
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
      { id: "c2", empresaId: "e1", nome: "Colégio Viva", cpfCnpj: "2" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" },
    ] });
    await prisma.servico.createMany({ data: [
      { id: "s1", empresaId: "e1", nome: "Limpeza de split", valorPadrao: 200, ativo: true },
      { id: "sInativo", empresaId: "e1", nome: "Serviço descontinuado", valorPadrao: 100, ativo: false },
    ] });
    await prisma.produto.createMany({ data: [
      { id: "p1", empresaId: "e1", nome: "Filtro de ar", valorPadrao: 60, ativo: true },
    ] });
  }, 240_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.orcamentoEvento.deleteMany({});
    await prisma.orcamentoServico.deleteMany({});
    await prisma.orcamentoProduto.deleteMany({});
    await prisma.orcamento.deleteMany({});
    como();
  });

  const statusDe = async (id: string) => (await prisma.orcamento.findUnique({ where: { id }, select: { status: true } })).status;

  /* ───── sugestões: permissão ───── */
  it("GET sugestões: sem Orçamentos › criar é 403", async () => {
    como(montarPermissoes({ orcamentos: ["visualizar", "editar"] }));
    const r = await sugestoes("clienteId=c1");
    expect(r.status).toBe(403);
    expect(r.json.erro).toBe("Sem permissão para esta ação");
  });

  it("GET sugestões: sem cliente é 400 (não adivinha de quem é o histórico)", async () => {
    const r = await sugestoes("");
    expect(r.status).toBe(400);
  });

  /* ───── sugestões: as regras no banco ───── */
  it("um orçamento só não sugere; dois sugerem, com o último preço praticado", async () => {
    await orcamento("o1", { criadoEm: ontem(40), servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 180 }] });
    expect((await sugestoes("clienteId=c1")).json.itens).toEqual([]);

    await orcamento("o2", { criadoEm: ontem(5), servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 240 }] });
    const itens = (await sugestoes("clienteId=c1")).json.itens;
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ tipo: "SERVICO", catalogoId: "s1", valorUnitario: 240, vezes: 2 });
  });

  it("orçamento CANCELADO não conta (caminho que não vingou)", async () => {
    await orcamento("o1", { servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 180 }] });
    await orcamento("o2", { status: "CANCELADO", servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 900 }] });
    expect((await sugestoes("clienteId=c1")).json.itens).toEqual([]);
  });

  it("fora da janela de 6 meses não conta", async () => {
    await orcamento("o1", { criadoEm: ontem(400), servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 180 }] });
    await orcamento("o2", { criadoEm: ontem(3), servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 240 }] });
    expect((await sugestoes("clienteId=c1")).json.itens).toEqual([]);
  });

  it("o orçamento aberto não se sugere a si mesmo", async () => {
    await orcamento("o1", { servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 180 }] });
    await orcamento("o2", { servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 240 }] });
    expect((await sugestoes("clienteId=c1")).json.itens).toHaveLength(1);
    expect((await sugestoes("clienteId=c1&excluir=o2")).json.itens).toEqual([]);
  });

  it("o histórico é do cliente pedido, e só da empresa de quem pergunta", async () => {
    await orcamento("o1", { clienteId: "c2", servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 180 }] });
    await orcamento("o2", { clienteId: "c2", servicos: [{ servicoId: "s1", descricao: "Limpeza de split", valorUnitario: 240 }] });
    await orcamento("oE2a", { empresaId: "e2", clienteId: "cE2", servicos: [{ descricao: "Serviço da outra empresa", valorUnitario: 99 }] });
    await orcamento("oE2b", { empresaId: "e2", clienteId: "cE2", servicos: [{ descricao: "Serviço da outra empresa", valorUnitario: 99 }] });

    expect((await sugestoes("clienteId=c1")).json.itens).toEqual([]);
    expect((await sugestoes("clienteId=c2")).json.itens).toHaveLength(1);
    // perguntando pelo cliente da outra empresa, o histórico dela não vaza
    expect((await sugestoes("clienteId=cE2")).json.itens).toEqual([]);
  });

  it("serviço do catálogo inativado no meio do caminho não é sugerido", async () => {
    await orcamento("o1", { servicos: [{ servicoId: "sInativo", descricao: "Serviço descontinuado", valorUnitario: 100 }] });
    await orcamento("o2", { servicos: [{ servicoId: "sInativo", descricao: "Serviço descontinuado", valorUnitario: 120 }] });
    expect((await sugestoes("clienteId=c1")).json.itens).toEqual([]);
  });

  it("produto também entra, e o item escrito à mão vale pelo texto", async () => {
    await orcamento("o1", { produtos: [{ produtoId: "p1", descricao: "Filtro de ar", valorUnitario: 55 }], servicos: [{ descricao: "Visita técnica", valorUnitario: 120 }] });
    await orcamento("o2", { produtos: [{ produtoId: "p1", descricao: "Filtro de ar", valorUnitario: 60 }], servicos: [{ descricao: "visita  TÉCNICA", valorUnitario: 130 }] });
    const itens = (await sugestoes("clienteId=c1")).json.itens;
    expect(itens.map((i: any) => [i.tipo, i.valorUnitario, i.vezes]).sort()).toEqual(
      [["PRODUTO", 60, 2], ["SERVICO", 130, 2]].sort(),
    );
  });

  /* ───── descartar e reabrir o lead ───── */
  it("Descartar: sem Orçamentos › excluir é 403 e o lead continua como estava", async () => {
    await orcamento("lead1", { status: "RASCUNHO" });
    como(montarPermissoes({ orcamentos: ["visualizar", "editar", "criar"] }));
    const r = await descartar("lead1");
    expect(r.status).toBe(403);
    expect(await statusDe("lead1")).toBe("RASCUNHO");
    expect(await prisma.orcamentoEvento.count({})).toBe(0);
  });

  it("Descartar: com a permissão, vira CANCELADO e a linha do tempo guarda quem e quando", async () => {
    await orcamento("lead1", { status: "RASCUNHO" });
    const antes = new Date();
    const r = await descartar("lead1");
    expect(r.status).toBe(200);
    expect(await statusDe("lead1")).toBe("CANCELADO");
    const ev = await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: "lead1" }, include: { usuario: { select: { nome: true } } } });
    expect(ev.tipo).toBe("STATUS");
    expect(ev.detalhe).toMatch(/cancelad/i);
    expect(ev.usuario.nome).toBe("Ana Souza");
    expect(new Date(ev.criadoEm).getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
  });

  it("Reabrir: sem Orçamentos › editar é 403; com ela, volta para RASCUNHO com evento", async () => {
    await orcamento("lead1", { status: "CANCELADO" });
    como(montarPermissoes({ orcamentos: ["visualizar", "criar", "excluir"] }));
    expect((await reabrir("lead1")).status).toBe(403);
    expect(await statusDe("lead1")).toBe("CANCELADO");

    como();
    const r = await reabrir("lead1");
    expect(r.status).toBe(200);
    expect(await statusDe("lead1")).toBe("RASCUNHO");
    const ev = await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: "lead1" } });
    expect(ev.detalhe).toBe("Reaberto");
  });

  it("o lead de outra empresa não é descartado por quem não é dela (404) e nada muda", async () => {
    await orcamento("leadE2", { empresaId: "e2", clienteId: "cE2", status: "RASCUNHO" });
    const r = await descartar("leadE2");
    expect(r.status).toBe(404);
    expect(await statusDe("leadE2")).toBe("RASCUNHO");
  });
});
