/**
 * Tabela de preços × seletor de itens do orçamento — a rota real `/api/clientes/{id}/tabela-preco` num
 * PostgreSQL real (schema descartável). Prova:
 *  - cliente COM tabela ativa: só a tabela dele, com os preços dela;
 *  - cliente SEM tabela: `null` = catálogo padrão. Nem os itens, nem os preços da tabela de OUTRO cliente
 *    (antes, a tabela de tipo "Padrão" da empresa virava a tabela de todo mundo sem tabela);
 *  - cliente com tabela INATIVA: também o catálogo padrão, avisando qual tabela estava ligada;
 *  - empresa sempre da sessão: cliente de outra empresa é "não encontrado"; RBAC (Clientes › Visualizar).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/tabela-preco-cliente-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_tabela_preco_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (empresaId = "e1", perms?: Record<string, string[]>) => {
  sessao.atual = { user: {
    id: `u-${empresaId}`, name: "Ana", email: "ana@x.com", empresaId, role: perms ? "OPERADOR" : "ADMIN",
    permissoes: perms ? montarPermissoes(perms as any) : permissoesTotais(), tecnicoId: null,
  } };
};
async function tabelaDe(clienteId: string) {
  const mod = await import("@/app/api/clientes/[id]/tabela-preco/route");
  const res: Response = await mod.GET(new NextRequest("http://localhost/api/x"), { params: Promise.resolve({ id: clienteId }) });
  return { status: res.status, json: await res.json() };
}

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Tabela de preços do cliente — o que o seletor do orçamento recebe (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u-e1", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "u-e2", empresaId: "e2", nome: "Bia", email: "bia@x.com", senha: "x", role: "ADMIN" },
    ] });
    // Catálogo da e1: 2 serviços e 2 produtos (um produto inativo); e a e2 tem o seu
    await prisma.servico.createMany({ data: [
      { id: "s-limp", empresaId: "e1", nome: "Limpeza de split", valorPadrao: 500 },
      { id: "s-inst", empresaId: "e1", nome: "Instalação", valorPadrao: 900 },
      { id: "s-e2", empresaId: "e2", nome: "Serviço da outra", valorPadrao: 1 },
    ] });
    await prisma.produto.createMany({ data: [
      { id: "p-cap", empresaId: "e1", codigo: 1, nome: "Capacitor", valorPadrao: 50 },
      { id: "p-gas", empresaId: "e1", codigo: 2, nome: "Gás R410", valorPadrao: 300 },
      { id: "p-velho", empresaId: "e1", codigo: 3, nome: "Peça descontinuada", valorPadrao: 10, ativo: false },
    ] });
    // Tabelas: a do Hospital (tipo "Padrão", como alguém pode marcar), a do Shopping (bloqueada) e uma inativa
    await prisma.tabelaPreco.createMany({ data: [
      { id: "t-hosp", empresaId: "e1", nome: "Hospital 2026", tipo: "PADRAO", precosBloqueados: false },
      { id: "t-shop", empresaId: "e1", nome: "Contrato Shopping", tipo: "CONTRATO", precosBloqueados: true },
      { id: "t-velha", empresaId: "e1", nome: "Tabela 2023", tipo: "PERSONALIZADA", ativo: false },
      { id: "t-e2", empresaId: "e2", nome: "Da outra empresa", tipo: "PADRAO" },
    ] });
    await prisma.tabelaPrecoItem.createMany({ data: [
      { tabelaId: "t-hosp", servicoId: "s-limp", tipoPreco: "VALOR_FIXO", valorFixo: 420, valorFinal: 420 },
      { tabelaId: "t-hosp", produtoId: "p-cap", tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10, valorFinal: 45, bloqueado: true },
      { tabelaId: "t-shop", servicoId: "s-inst", tipoPreco: "VALOR_FIXO", valorFixo: 800, valorFinal: 800, bloqueado: true },
      { tabelaId: "t-velha", servicoId: "s-limp", tipoPreco: "VALOR_FIXO", valorFixo: 350, valorFinal: 350 },
      { tabelaId: "t-e2", servicoId: "s-e2", tipoPreco: "VALOR_FIXO", valorFixo: 2, valorFinal: 2 },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c-hosp", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11", tabelaPrecoId: "t-hosp" },
      { id: "c-shop", empresaId: "e1", nome: "Shopping", cpfCnpj: "22.222.222/0001-22", tabelaPrecoId: "t-shop" },
      { id: "c-sem", empresaId: "e1", nome: "Padaria (sem tabela)", cpfCnpj: "33.333.333/0001-33", tabelaPrecoId: null },
      { id: "c-velha", empresaId: "e1", nome: "Escola (tabela inativa)", cpfCnpj: "44.444.444/0001-44", tabelaPrecoId: "t-velha" },
      { id: "c-e2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "55.555.555/0001-55", tabelaPrecoId: "t-e2" },
      // Dado torto: cliente da e1 apontando para a tabela da e2 (não dá para gravar pela tela; defesa da rota)
      { id: "c-cruzado", empresaId: "e1", nome: "Apontando para fora", cpfCnpj: "66.666.666/0001-66", tabelaPrecoId: "t-e2" },
    ] });
    logar();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("cliente COM tabela: só a tabela dele, com os preços dela (serviço e produto); outro cliente com tabela vê só a sua", async () => {
    const hosp = await tabelaDe("c-hosp");
    expect(hosp.status).toBe(200);
    expect(hosp.json).toMatchObject({ id: "t-hosp", nome: "Hospital 2026", precosBloqueados: false, vinculadaInativa: null });
    expect(Object.keys(hosp.json.itens).sort()).toEqual(["p-cap", "s-limp"]);
    expect(hosp.json.itens["s-limp"]).toMatchObject({ valorFinal: 420, bloqueado: false, tipoPreco: "VALOR_FIXO" });
    expect(hosp.json.itens["p-cap"]).toMatchObject({ valorFinal: 45, bloqueado: true, tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10 });

    const shop = await tabelaDe("c-shop");
    expect(shop.json).toMatchObject({ id: "t-shop", precosBloqueados: true });
    expect(Object.keys(shop.json.itens)).toEqual(["s-inst"]); // nada do Hospital
  });

  it("cliente SEM tabela: catálogo padrão (null) — NÃO vê a tabela de outro cliente, mesmo a de tipo “Padrão”", async () => {
    const r = await tabelaDe("c-sem");
    expect(r.status).toBe(200);
    expect(r.json).toBeNull(); // a tela usa o catálogo da empresa com o preço padrão (500, 900, 50, 300)
  });

  it("cliente com tabela INATIVA: catálogo padrão, avisando qual tabela estava ligada; reativar volta a valer a dela", async () => {
    const r = await tabelaDe("c-velha");
    expect(r.json).toEqual({ id: null, nome: null, tipo: null, precosBloqueados: false, itens: null, vinculadaInativa: { id: "t-velha", nome: "Tabela 2023" } });
    await prisma.tabelaPreco.update({ where: { id: "t-velha" }, data: { ativo: true } });
    try {
      const de = await tabelaDe("c-velha");
      expect(de.json).toMatchObject({ id: "t-velha", vinculadaInativa: null });
      expect(de.json.itens["s-limp"].valorFinal).toBe(350);
    } finally {
      await prisma.tabelaPreco.update({ where: { id: "t-velha" }, data: { ativo: false } });
    }
  });

  it("empresa da sessão: cliente de outra empresa = não encontrado; a outra empresa vê a tabela dela, e só", async () => {
    expect((await tabelaDe("c-e2")).status).toBe(404);
    expect((await tabelaDe("c-cruzado")).json).toBeNull(); // a tabela da outra empresa nunca sai, nem apontada
    logar("e2");
    try {
      expect((await tabelaDe("c-hosp")).status).toBe(404);
      const r = await tabelaDe("c-e2");
      expect([r.json.id, Object.keys(r.json.itens)]).toEqual(["t-e2", ["s-e2"]]);
    } finally { logar(); }
  });

  it("RBAC: sem Clientes › Visualizar = 403; sem sessão = 401", async () => {
    logar("e1", { orcamentos: ["visualizar", "criar"] });
    try { expect((await tabelaDe("c-hosp")).status).toBe(403); } finally { logar(); }
    sessao.atual = null;
    try { expect((await tabelaDe("c-hosp")).status).toBe(401); } finally { logar(); }
  });
});
