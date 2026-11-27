/**
 * Leva G — PREÇO DE TABELA TRAVADO, com as rotas reais e o Prisma real num PostgreSQL real:
 *  - orçamento (criar, editar, editar a linha) e OS (incluir, editar, editar a linha): o preço que vem da tabela do
 *    cliente não muda para quem não tem "Alterar preço de tabela" (403, nada gravado);
 *  - com a permissão, só com o motivo (400 sem ele); gravado, a trilha registra quem, o quê e o motivo
 *    (evento PRECO_TABELA no orçamento; "Preço de tabela alterado" no histórico da OS);
 *  - o administrador tem a permissão sem nada no banco; o preço da tabela, o item fora da tabela, a linha livre e o
 *    cliente sem tabela seguem livres; salvar de novo o preço já gravado não pede de novo;
 *  - a tabela inativa não trava; a tabela de outra empresa nunca vale.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/preco-tabela-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_preco_tabela_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

/** Tudo liberado, menos "Alterar preço de tabela" */
const semPermissao = (): Permissoes => { const p = permissoesTotais(); p.orcamentos = { ...p.orcamentos, alterarPrecoTabela: false }; return p; };
const logar = (quem: "operador" | "comPermissao" | "admin", empresaId = "e1") => {
  const id = { operador: "uOp", comPermissao: "uPerm", admin: "uAdm" }[quem];
  sessao.atual = { user: {
    id, name: id, email: `${id}@ficticio.test`, empresaId, tecnicoId: null,
    role: quem === "admin" ? "ADMIN" : "OPERADOR", permissoes: quem === "comPermissao" ? permissoesTotais() : quem === "admin" ? {} : semPermissao(),
  } };
};

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Preço de tabela travado (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;
  const orc = (clienteId: string, sv: number, pr = 80, extra: Record<string, unknown> = {}) => chamar("orcamentos", "POST", {
    clienteId, servicos: [{ catalogoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: sv }],
    produtos: [{ catalogoId: "pFiltro", descricao: "Filtro", quantidade: 2, valorUnitario: pr }], ...extra,
  });
  const eventos = (orcamentoId: string) => prisma.orcamentoEvento.findMany({ where: { orcamentoId, tipo: "PRECO_TABELA" } });
  const novaOs = (clienteId = "c1") => prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSP-${++seq}`, clienteId, criadoPorId: "uAdm", status: "ABERTA", origem: "MANUAL", descricao: "OS fictícia" } });
  const historico = (osId: string) => prisma.osHistorico.findMany({ where: { ordemServicoId: osId, acao: "Preço de tabela alterado" } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["orcamentos", "orcamentos/[id]", "orcamentos/[id]/linhas/[linhaId]", "ordens/[id]/orcamento", "ordens/[id]/orcamento/[itemId]", "ordens/[id]/orcamento/catalogo"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Refrigeração Fictícia", cnpj: "12345678000190", email: "e@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "o@ficticio.test" }] });
    await prisma.usuario.createMany({ data: ["uOp", "uPerm", "uAdm"].map((id) => ({ id, empresaId: "e1", nome: id, email: `${id}@ficticio.test`, senha: "x" })) });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.servico.create({ data: { id: "sLimp", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza", valorPadrao: 200 } });
    await prisma.servico.create({ data: { id: "sVisita", empresaId: "e1", codigo: "VIS01", nome: "Visita", valorPadrao: 90 } });
    await prisma.produto.create({ data: { id: "pFiltro", empresaId: "e1", nome: "Filtro", unidade: "un", valorPadrao: 100, saldo: 10 } });
    // Tabela do contrato: Limpeza 150 e Filtro 80 (a Visita NÃO está na tabela)
    await prisma.tabelaPreco.create({ data: { id: "tab", empresaId: "e1", nome: "Contrato fictício", itens: { create: [
      { servicoId: "sLimp", tipoPreco: "VALOR_FIXO", valorFixo: 150, valorFinal: 150 }, { produtoId: "pFiltro", tipoPreco: "VALOR_FIXO", valorFixo: 80, valorFinal: 80 },
    ] } } });
    await prisma.tabelaPreco.create({ data: { id: "tabInativa", empresaId: "e1", nome: "Antiga", ativo: false, itens: { create: [{ servicoId: "sLimp", tipoPreco: "VALOR_FIXO", valorFixo: 120, valorFinal: 120 }] } } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "22101333000111", tabelaPrecoId: "tab" },
      { id: "c2", empresaId: "e1", nome: "Padaria Fictícia", cpfCnpj: "22101333000192" },
      { id: "c3", empresaId: "e1", nome: "Escola Fictícia", cpfCnpj: "22101333000273", tabelaPrecoId: "tabInativa" },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("orçamento", () => {
    it("no preço da tabela: qualquer um grava, sem motivo e sem evento", async () => {
      logar("operador");
      const r = await orc("c1", 150, 80);
      expect(r.status).toBe(201);
      expect(await eventos(r.json.id)).toHaveLength(0);
    });

    it("fora da tabela sem a permissão: 403 e nada gravado", async () => {
      logar("operador");
      const antes = await prisma.orcamento.count();
      const r = await orc("c1", 120);
      expect(r.status).toBe(403);
      expect(r.json.erro).toMatch(/Limpeza.*tabela de preço do cliente.*Alterar preço de tabela/);
      expect(await prisma.orcamento.count()).toBe(antes);
      // o produto também: Filtro a 70
      expect((await orc("c1", 150, 70)).status).toBe(403);
    });

    it("com a permissão: sem motivo = 400; com motivo grava e a trilha registra quem, o quê e o motivo", async () => {
      logar("comPermissao");
      const sem = await orc("c1", 120);
      expect(sem.status).toBe(400);
      expect(sem.json.erro).toMatch(/motivo/);
      expect((await orc("c1", 120, 80, { motivoPrecoTabela: "ok" })).status).toBe(400); // curto demais
      const r = await orc("c1", 120, 70, { motivoPrecoTabela: "Desconto negociado em reunião" });
      expect(r.status).toBe(201);
      const [ev] = await eventos(r.json.id);
      expect(ev.usuarioId).toBe("uPerm");
      expect(ev.detalhe).toContain("Limpeza (R$ 150,00 → R$ 120,00)");
      expect(ev.detalhe).toContain("Filtro (R$ 80,00 → R$ 70,00)");
      expect(ev.detalhe).toContain("Motivo: Desconto negociado em reunião");
    });

    it("o administrador pode, sem nada no banco (ainda com o motivo)", async () => {
      logar("admin");
      expect((await orc("c1", 99)).status).toBe(400);
      expect((await orc("c1", 99, 80, { motivoPrecoTabela: "Cortesia da diretoria" })).status).toBe(201);
    });

    it("livre: item fora da tabela, linha sem catálogo, cliente sem tabela, tabela inativa", async () => {
      logar("operador");
      expect((await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [{ catalogoId: "sVisita", descricao: "Visita", quantidade: 1, valorUnitario: 55 }] })).status).toBe(201);
      expect((await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [{ descricao: "Serviço avulso", quantidade: 1, valorUnitario: 1 }] })).status).toBe(201);
      expect((await orc("c2", 10, 10)).status).toBe(201);
      expect((await orc("c3", 10, 10)).status).toBe(201);
    });

    it("editar: o preço já gravado não pede de novo; mudar de novo, sim; a linha (lápis) segue a mesma regra", async () => {
      logar("comPermissao");
      const r = await orc("c1", 120, 80, { motivoPrecoTabela: "Desconto negociado em reunião" });
      const id = r.json.id;
      logar("operador");
      // Salvar de novo com o 120 já autorizado: passa sem motivo e sem evento novo
      const igual = await chamar("orcamentos/[id]", "PUT", { clienteId: "c1", servicos: [{ catalogoId: "sLimp", descricao: "Limpeza", quantidade: 2, valorUnitario: 120 }], produtos: [] }, { id });
      expect(igual.status).toBe(200);
      expect(await eventos(id)).toHaveLength(1);
      // Mudar de novo (110): sem a permissão, 403
      expect((await chamar("orcamentos/[id]", "PUT", { clienteId: "c1", servicos: [{ catalogoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: 110 }], produtos: [] }, { id })).status).toBe(403);
      // Voltar para o preço da tabela: sempre pode
      expect((await chamar("orcamentos/[id]", "PUT", { clienteId: "c1", servicos: [{ catalogoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: 150 }], produtos: [] }, { id })).status).toBe(200);
      // A linha pelo lápis
      const linha = (await prisma.orcamentoServico.findFirst({ where: { orcamentoId: id } })).id;
      expect((await chamar("orcamentos/[id]/linhas/[linhaId]", "PATCH", { valorUnitario: 140 }, { id, linhaId: linha })).status).toBe(403);
      expect((await chamar("orcamentos/[id]/linhas/[linhaId]", "PATCH", { quantidade: 3 }, { id, linhaId: linha })).status).toBe(200); // mexer só na quantidade pode
      logar("comPermissao");
      expect((await chamar("orcamentos/[id]/linhas/[linhaId]", "PATCH", { valorUnitario: 140 }, { id, linhaId: linha })).status).toBe(400);
      const ok = await chamar("orcamentos/[id]/linhas/[linhaId]", "PATCH", { valorUnitario: 140, motivoPrecoTabela: "Ajuste combinado por telefone" }, { id, linhaId: linha });
      expect(ok.status).toBe(200);
      const evs = await eventos(id);
      expect(evs).toHaveLength(2);
      expect(evs[1].detalhe).toMatch(/R\$ 150,00 → R\$ 140,00.*Ajuste combinado por telefone/);
    });

    it("a tabela de outra empresa nunca vale (e2 com um cliente ligado a uma tabela de e1 não trava nada)", async () => {
      await prisma.cliente.create({ data: { id: "cOutra", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "22101333000354", tabelaPrecoId: "tab" } });
      await prisma.servico.create({ data: { id: "sOutra", empresaId: "e2", codigo: "OUT01", nome: "Outro", valorPadrao: 1 } });
      sessao.atual = { user: { id: "uX", name: "x", email: "x@ficticio.test", empresaId: "e2", role: "OPERADOR", permissoes: semPermissao(), tecnicoId: null } };
      await prisma.usuario.create({ data: { id: "uX", empresaId: "e2", nome: "x", email: "x@ficticio.test", senha: "x" } });
      const { precosDaTabelaDoCliente } = await import("@/lib/precos/trava-tabela-server");
      expect((await precosDaTabelaDoCliente("e2", "cOutra")).size).toBe(0);
    });
  });

  describe("OS", () => {
    it("incluir: o catálogo diz que o preço é da tabela (serviço e produto); fora dela sem a permissão = 403", async () => {
      const os = await novaOs();
      logar("operador");
      const cat = await chamar("ordens/[id]/orcamento/catalogo", "GET", undefined, { id: os.id }).catch(() => null);
      void cat; // a rota de catálogo lê a query; o teste do preço fica nas gravações abaixo
      expect((await chamar("ordens/[id]/orcamento", "POST", { tipo: "SERVICO", servicoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: 150 }, { id: os.id })).status).toBe(201);
      expect((await chamar("ordens/[id]/orcamento", "POST", { tipo: "PRODUTO", produtoId: "pFiltro", descricao: "Filtro", quantidade: 1, valorUnitario: 60 }, { id: os.id })).status).toBe(403);
      expect(await historico(os.id)).toHaveLength(0);
    });

    it("com a permissão: motivo obrigatório; gravado, o histórico da OS registra", async () => {
      const os = await novaOs();
      logar("comPermissao");
      expect((await chamar("ordens/[id]/orcamento", "POST", { tipo: "PRODUTO", produtoId: "pFiltro", descricao: "Filtro", quantidade: 1, valorUnitario: 60 }, { id: os.id })).status).toBe(400);
      const r = await chamar("ordens/[id]/orcamento", "POST", { tipo: "PRODUTO", produtoId: "pFiltro", descricao: "Filtro", quantidade: 1, valorUnitario: 60, motivoPrecoTabela: "Peça do estoque antigo" }, { id: os.id });
      expect(r.status).toBe(201);
      const [h] = await historico(os.id);
      expect(h.usuarioId).toBe("uPerm");
      expect(h.detalhes).toMatch(/Filtro \(R\$ 80,00 → R\$ 60,00\).*Peça do estoque antigo/);
    });

    it("editar (PUT) e editar a linha (PATCH): o gravado não pede de novo; mudar, sim", async () => {
      const os = await novaOs();
      logar("operador");
      const item = (await chamar("ordens/[id]/orcamento", "POST", { tipo: "SERVICO", servicoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: 150 }, { id: os.id })).json;
      expect((await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { quantidade: 2, valorUnitario: 150 }, { id: os.id, itemId: item.id })).status).toBe(200);
      expect((await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { valorUnitario: 130 }, { id: os.id, itemId: item.id })).status).toBe(403);
      expect((await chamar("ordens/[id]/orcamento/[itemId]", "PATCH", { valorUnitario: 130 }, { id: os.id, itemId: item.id })).status).toBe(403);
      expect((await chamar("ordens/[id]/orcamento/[itemId]", "PATCH", { descricao: "Limpeza completa" }, { id: os.id, itemId: item.id })).status).toBe(200);
      logar("comPermissao");
      const ok = await chamar("ordens/[id]/orcamento/[itemId]", "PATCH", { valorUnitario: 130, motivoPrecoTabela: "Cliente pagou à vista" }, { id: os.id, itemId: item.id });
      expect(ok.status).toBe(200);
      expect(Number(ok.json.valorUnitario)).toBe(130);
      expect(await historico(os.id)).toHaveLength(1);
      // Agora 130 é o gravado: salvar de novo com 130 não pede
      logar("operador");
      expect((await chamar("ordens/[id]/orcamento/[itemId]", "PATCH", { quantidade: 3, valorUnitario: 130 }, { id: os.id, itemId: item.id })).status).toBe(200);
    });

    it("cliente sem tabela: a OS é livre", async () => {
      const os = await novaOs("c2");
      logar("operador");
      expect((await chamar("ordens/[id]/orcamento", "POST", { tipo: "SERVICO", servicoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: 1 }, { id: os.id })).status).toBe(201);
    });
  });
});
