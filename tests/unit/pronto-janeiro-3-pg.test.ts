/**
 * Pronto pra janeiro 3 — as correções do servidor, com Prisma e PostgreSQL reais (dados fictícios):
 *  - Empresas (dono do Frivo): inativar e reativar; o ADMIN de uma empresa recebe 403; a empresa do próprio dono não se
 *    inativa; corpo inválido 400; id que não existe 404;
 *  - Pedido do cliente pelo portal: "em conferência" só conta pedido com algum item AINDA esperando (o resolvido por
 *    outro caminho sai do sino, do filtro e da lista); um pedido só de orçamento leva ao orçamento; a lista de OS conta
 *    o filtro "conferir";
 *  - o cliente abre o arquivo que ELE enviou pelo portal (o de outro cliente, ou o lançado pelo escritório, dá 404);
 *  - Cliente › Portal: e-mail inválido diz "E-mail inválido" (não "Dados inválidos");
 *  - o arquivo do pedido acima de 3 MB é recusado no servidor também.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pronto-janeiro-3-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { MSG_TROCA_PENDENTE_PORTAL } from "@/lib/portal/senha-provisoria";
import { PDF, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pj3_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
const portal = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/auth-portal", () => ({
  getPortalSession: vi.fn(async (op: { comTroca?: boolean } = {}) => (portal.atual && (!portal.atual.user.trocarSenha || op.comTroca) ? portal.atual : null)),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const como = (role: string, empresaId = "e1", id = "uA") => { sessao.atual = { user: { id, name: "Ana", email: "ana@x.test", empresaId, role, permissoes: permissoesTotais(), tecnicoId: null } }; };
const DIA = (d: number) => new Date(Date.UTC(2026, 10, d, 15));

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, busca = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${busca}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, tipo: res.headers.get("content-type") ?? "", json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}

describe.skipIf(!URL_PG)("Pronto pra janeiro 3 — correções do servidor (PostgreSQL real)", () => {
  let prisma: any;
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["admin/empresas/[id]", "portal/pedidos-compra/[id]/anexo", "clientes/[id]/contatos/[contatoId]/acesso-portal", "pedidos-cliente"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Frivo Dono (fictícia)", cnpj: "12.345.678/0001-90", email: "e@x.test" },
      { id: "e2", nome: "Aurora Clima (fictícia)", cnpj: "45.678.912/0001-55", email: "a@x.test" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: [{ id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.test", senha: "x", role: "ADMIN" }] });
    await prisma.cliente.createMany({ data: [
      { id: "cA", empresaId: "e1", nome: "Hospital A (fictício)", cpfCnpj: "a", exigePcAntesNf: true },
      { id: "cB", empresaId: "e1", nome: "Clínica B (fictícia)", cpfCnpj: "b", exigePcAntesNf: true },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ctA", empresaId: "e1", clienteId: "cA", nome: "Paula", email: "paula@a.test" },
      { id: "ctB", empresaId: "e1", clienteId: "cB", nome: "Bia", email: "bia@b.test" },
    ] });
    const os = (id: string, clienteId = "cA") => ({ id, empresaId: "e1", numero: `OS-${id}`, clienteId, criadoPorId: "uA", descricao: "x", status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(5) });
    await prisma.ordemServico.createMany({ data: [os("o1"), os("o2"), os("oB", "cB")] });
    await prisma.orcamento.create({ data: { id: "orc1", empresaId: "e1", codigo: "ORC-1", nome: "Troca (fictícia)", clienteId: "cA", criadoPorId: "uA", tokenPublico: "tk1", status: "APROVADO", assinadoEm: DIA(3), totalGeral: 100, equipamentosCobertos: [] } });
  }, 240_000);
  afterAll(async () => { await prisma?.$disconnect(); execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  it("Empresas: inativar e reativar (só o dono do Frivo); a própria empresa não; corpo inválido e id inexistente", async () => {
    como("ADMIN");
    expect((await chamar("admin/empresas/[id]", "PATCH", { id: "e2" }, { ativo: false })).status).toBe(403);
    expect((await prisma.empresa.findUnique({ where: { id: "e2" } })).ativo).toBe(true);
    como("SUPER_ADMIN");
    // importado aqui (não no topo): o módulo carrega o Prisma, que só pode nascer depois de apontar para o schema do teste
    const { MSG_NAO_INATIVA_PROPRIA } = await import("@/lib/empresa/criar-empresa");
    expect(await chamar("admin/empresas/[id]", "PATCH", { id: "e1" }, { ativo: false })).toMatchObject({ status: 409, json: { erro: MSG_NAO_INATIVA_PROPRIA } });
    expect((await chamar("admin/empresas/[id]", "PATCH", { id: "e2" }, { ativo: "não" })).status).toBe(400);
    expect((await chamar("admin/empresas/[id]", "PATCH", { id: "nao-existe" }, { ativo: false })).status).toBe(404);
    expect((await chamar("admin/empresas/[id]", "PATCH", { id: "e2" }, { ativo: false })).json).toEqual({ ok: true, ativo: false });
    expect((await prisma.empresa.findUnique({ where: { id: "e2" } })).ativo).toBe(false);
    expect((await chamar("admin/empresas/[id]", "PATCH", { id: "e2" }, { ativo: true })).json).toEqual({ ok: true, ativo: true });
    expect((await prisma.empresa.findUnique({ where: { id: "e2" } })).ativo).toBe(true);
  });

  it("em conferência só o pedido com algum item ainda esperando; só de orçamento leva ao orçamento; a lista conta o filtro", async () => {
    const ps = await import("@/lib/pedido-cliente/portal-server");
    const ped = (id: string, os: string[], orc: string[], criadoEm: Date) => ({ id, empresaId: "e1", clienteId: "cA", numero: id, data: DIA(6), origem: "PORTAL", situacao: "CONFERIR", osPropostas: os, orcamentosPropostos: orc, criadoEm });
    await prisma.pedidoCliente.createMany({ data: [ped("pOrc", [], ["orc1"], DIA(7))] });
    // um pedido só, só de orçamento: o sino vai ao orçamento (a lista de OS não o mostraria)
    expect(await ps.contarPedidosConferir("e1")).toEqual({ pedidosConferir: 1, pedidoConferirId: "pOrc", pedidoConferirOsId: null, pedidoConferirOrcamentoId: "orc1" });
    const { PENDENCIAS } = await import("@/lib/alertas/pendencias");
    expect(PENDENCIAS.pedidosConferir.href({ pedidoConferirOrcamentoId: "orc1" } as any)).toBe("/orcamentos/orc1");
    await prisma.pedidoCliente.createMany({ data: [ped("pO1", ["o1"], [], DIA(8)), ped("pO2", ["o2"], [], DIA(9))] });
    expect((await ps.contarPedidosConferir("e1")).pedidosConferir).toBe(3);
    expect((await ps.osEmConferencia("e1")).sort()).toEqual(["o1", "o2"]);
    // a o2 se resolveu por outro caminho (o escritório informou o pedido): o pO2 sai do sino e do filtro
    const esc = await prisma.pedidoCliente.create({ data: { empresaId: "e1", clienteId: "cA", numero: "ESC-1", data: DIA(9) } });
    await prisma.ordemServico.update({ where: { id: "o2" }, data: { pedidoClienteId: esc.id } });
    expect(await ps.contarPedidosConferir("e1")).toMatchObject({ pedidosConferir: 2, pedidoConferirId: "pO1" });
    expect(await ps.osEmConferencia("e1")).toEqual(["o1"]);
    // a lista de OS: o filtro "conferir" mostra só a o1, e o resumo conta 1 para o filtro rápido
    const { carregarListaOs } = await import("@/lib/os/lista-server");
    const lista = await carregarListaOs("e1", { pedido: "conferir", periodo: "todos" });
    expect(lista.linhas.map((l: any) => l.id)).toEqual(["o1"]);
    expect(lista.resumoPedido).toMatchObject({ conferir: 1 });
  });

  it("portal: o cliente abre o arquivo que ELE enviou; de outro cliente ou lançado pelo escritório, 404; sem sessão 401; troca pendente 403", async () => {
    const anexo = "data:application/pdf;base64,JVBERi0xLjQK";
    await prisma.pedidoCliente.createMany({ data: [
      { id: "pA", empresaId: "e1", clienteId: "cA", numero: "A-1", data: DIA(6), origem: "PORTAL", situacao: "RECUSADO", anexo, anexoNome: "pedido-a.pdf", anexoTipo: "application/pdf" },
      { id: "pB", empresaId: "e1", clienteId: "cB", numero: "B-1", data: DIA(6), origem: "PORTAL", situacao: "CONFERIR", anexo, anexoNome: "pedido-b.pdf", anexoTipo: "application/pdf" },
      { id: "pEsc", empresaId: "e1", clienteId: "cA", numero: "E-1", data: DIA(6), anexo, anexoNome: "interno.pdf", anexoTipo: "application/pdf" },
    ] });
    portal.atual = null;
    expect((await chamar("portal/pedidos-compra/[id]/anexo", "GET", { id: "pA" })).status).toBe(401);
    portal.atual = { user: { id: "ctA", clienteId: "cA", empresaId: "e1", permissoes: {}, trocarSenha: false } };
    const ok = await chamar("portal/pedidos-compra/[id]/anexo", "GET", { id: "pA" }, undefined, "?inline=1");
    expect([ok.status, ok.tipo]).toEqual([200, "application/pdf"]);
    expect((await chamar("portal/pedidos-compra/[id]/anexo", "GET", { id: "pB" })).status).toBe(404);
    expect((await chamar("portal/pedidos-compra/[id]/anexo", "GET", { id: "pEsc" })).status).toBe(404);
    portal.atual = { user: { ...portal.atual.user, trocarSenha: true } };
    expect(await chamar("portal/pedidos-compra/[id]/anexo", "GET", { id: "pA" })).toMatchObject({ status: 403, json: { erro: MSG_TROCA_PENDENTE_PORTAL } });
  });

  it("Cliente › Portal: e-mail inválido diz o campo (\"E-mail inválido\")", async () => {
    como("ADMIN");
    const r = await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "PUT", { id: "cA", contatoId: "ctA" }, { email: "paula@", ativo: true, permissoes: {} });
    expect([r.status, r.json.erro]).toEqual([400, "E-mail inválido"]);
  });

  it("o arquivo do pedido acima de 3 MB é recusado no servidor (o mesmo limite da tela)", async () => {
    como("ADMIN");
    const grande = dataUrl("application/pdf", Buffer.concat([Buffer.from(PDF), Buffer.alloc(3 * 1024 * 1024)]));
    const r = await chamar("pedidos-cliente", "POST", {}, { numero: "G-1", osIds: ["oB"], anexo: { conteudo: grande, nome: "grande.pdf" } });
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/3 MB/);
    const pequeno = await chamar("pedidos-cliente", "POST", {}, { numero: "P-1", osIds: ["oB"], anexo: { conteudo: dataUrl("application/pdf", PDF), nome: "p.pdf" } });
    expect(pequeno.status).toBe(201);
  });
});
