/**
 * PADRONIZAÇÃO — LEVA 4A: Clientes, Equipamentos e QR Codes, pelas ROTAS reais com PostgreSQL real.
 *
 * Prioridade nº 1 da leva: botão destrutivo (Inativar) ou de ação sensível só para quem pode — e o
 * SERVIDOR recusa de qualquer jeito. Aqui fica travado o lado do servidor:
 *
 *  - quem só VISUALIZA clientes, equipamentos e QR Codes leva 403 em TODA rota que grava, inativa,
 *    reativa, vincula ou desvincula — e o banco inteiro fica idêntico (todas as tabelas);
 *  - sem login, 401;
 *  - QR Codes › gerenciar: desvincular solta a etiqueta (o equipamento fica), inativar não apaga e
 *    reativar devolve; equipamento que já tem etiqueta não recebe outra; etiqueta de outra empresa: 404;
 *  - Clientes: inativar exige "excluir" (reversível, o registro fica); reativar basta "editar";
 *  - Equipamentos: inativar exige "excluir"; reativar basta "editar"; quem só CRIA gera o QR mas não
 *    desvincula;
 *  - consulta de CNPJ (a do cadastro rápido de cliente): exige login, recusa CNPJ incompleto e devolve
 *    o que o cadastro rápido aproveita.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva4a-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { sugestaoDoCnpj } from "@/lib/cadastros/autofill-cnpj";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva4a_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "u1" : "u2", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

/** Vê os três cadastros; não cria, não edita, não inativa, não gerencia */
const SO_VE = montarPermissoes({ clientes: ["visualizar"], equipamentos: ["visualizar"], qrcodes: ["visualizar"] });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const CLIENTE = { tipoPessoa: "JURIDICA", nome: "Invadido Ltda", cpfCnpj: "11.444.777/0001-61" };
const EQUIPAMENTO = { unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Invadida", modelo: "X" };

/** Toda chamada que GRAVA nas telas da leva: [nome, rota, método, corpo, params] */
const GRAVACOES: [string, string, string, unknown, Record<string, string>][] = [
  ["cliente: criar (o cadastro rápido usa esta)", "clientes", "POST", CLIENTE, {}],
  ["cliente: editar", "clientes/[id]", "PUT", CLIENTE, { id: "c1" }],
  ["cliente: editar no contexto", "clientes/[id]", "PATCH", { telefone: "(11) 0000-0000" }, { id: "c1" }],
  ["cliente: inativar pela lista", "clientes/[id]", "DELETE", undefined, { id: "c1" }],
  ["cliente: inativar pela ficha", "clientes/[id]", "PATCH", { ativo: false }, { id: "c1" }],
  ["cliente: reativar", "clientes/[id]", "PATCH", { ativo: true }, { id: "c2" }],
  ["unidade: criar", "unidades", "POST", { clienteId: "c1", nome: "Invadida" }, {}],
  ["unidade: editar no contexto", "unidades/[id]", "PATCH", { nome: "Invadida" }, { id: "un1" }],
  ["unidade: excluir", "unidades/[id]", "DELETE", undefined, { id: "un1" }],
  ["equipamento: criar", "equipamentos", "POST", EQUIPAMENTO, {}],
  ["equipamento: editar", "equipamentos/[id]", "PUT", EQUIPAMENTO, { id: "eq1" }],
  ["equipamento: editar no contexto", "equipamentos/[id]", "PATCH", { marca: "Invadida" }, { id: "eq1" }],
  ["equipamento: inativar", "equipamentos/[id]", "DELETE", undefined, { id: "eq1" }],
  ["equipamento: reativar", "equipamentos/[id]", "PATCH", { ativo: true }, { id: "eq3" }],
  ["equipamento: gerar QR Code", "equipamentos/[id]/qrcode", "POST", {}, { id: "eq2" }],
  ["equipamento: desvincular o QR Code", "equipamentos/[id]/qrcode", "DELETE", undefined, { id: "eq1" }],
  ["equipamento: ler a etiqueta pela foto", "equipamentos/ocr", "POST", { imagem: "data:image/png;base64,AAAA" }, {}],
  ["QR Codes: gerar lote", "qrcodes", "POST", { quantidade: 5 }, {}],
  ["QR Code: vincular", "qrcodes/[id]", "PATCH", { equipamentoId: "eq2" }, { id: "q2" }],
  ["QR Code: desvincular", "qrcodes/[id]", "PATCH", { equipamentoId: null }, { id: "q1" }],
  ["QR Code: inativar", "qrcodes/[id]", "PATCH", { ativo: false }, { id: "q1" }],
  ["QR Code: reativar", "qrcodes/[id]", "PATCH", { ativo: true }, { id: "q3" }],
  ["QR Code: excluir de vez (a tela não oferece)", "qrcodes/[id]", "DELETE", undefined, { id: "q2" }],
];

describe.skipIf(!URL_PG)("Leva 4A: Clientes, Equipamentos e QR Codes — o servidor recusa quem não pode (PostgreSQL real)", () => {
  let prisma: any;

  /** O banco INTEIRO num retrato: uma assinatura por tabela (qualquer linha que mude, em qualquer tabela, aparece) */
  async function retrato(): Promise<Record<string, string>> {
    const tabelas: { table_name: string }[] = await prisma.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_type = 'BASE TABLE' ORDER BY table_name`);
    const r: Record<string, string> = {};
    for (const { table_name: t } of tabelas) {
      const [{ h }]: { h: string }[] = await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${SCHEMA}"."${t}" x`);
      r[t] = h;
    }
    return r;
  }
  /** Volta os registros ao estado inicial (os testes que gravam não vazam para os seguintes) */
  async function estadoInicial() {
    await prisma.qrcode.deleteMany({ where: { id: { notIn: ["q1", "q2", "q3", "q9"] } } });
    await prisma.qrcode.update({ where: { id: "q1" }, data: { equipamentoId: "eq1", ativo: true } });
    await prisma.qrcode.update({ where: { id: "q2" }, data: { equipamentoId: null, ativo: true } });
    await prisma.qrcode.update({ where: { id: "q3" }, data: { equipamentoId: null, ativo: false } });
    await prisma.cliente.update({ where: { id: "c1" }, data: { ativo: true } });
    await prisma.cliente.update({ where: { id: "c2" }, data: { ativo: false } });
    await prisma.equipamento.update({ where: { id: "eq1" }, data: { ativo: true } });
    await prisma.equipamento.update({ where: { id: "eq3" }, data: { ativo: false } });
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([...new Set([...GRAVACOES.map(([, rota]) => rota), "cnpj/[cnpj]"])].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", tipoPessoa: "JURIDICA", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "11.222.333/0001-81" },
      { id: "c2", empresaId: "e1", tipoPessoa: "JURIDICA", nome: "Padaria Antiga Ltda", cpfCnpj: "45.723.174/0001-10", ativo: false },
      { id: "c9", empresaId: "e2", tipoPessoa: "JURIDICA", nome: "Da outra empresa", cpfCnpj: "06.990.590/0001-23" },
    ] });
    await prisma.unidade.createMany({ data: [{ id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz", principal: true }, { id: "un9", empresaId: "e2", clienteId: "c9", nome: "Sede" }] });
    await prisma.equipamento.createMany({ data: [
      { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4-W12" },
      { id: "eq2", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTXS" },
      { id: "eq3", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Carrier", modelo: "Antigo", ativo: false },
      { id: "eq9", empresaId: "e2", unidadeId: "un9", tipo: "AR_CONDICIONADO_SPLIT", marca: "Outra", modelo: "Z" },
    ] });
    await prisma.qrcode.createMany({ data: [
      { id: "q1", empresaId: "e1", codigo: "QR-1", equipamentoId: "eq1" },
      { id: "q2", empresaId: "e1", codigo: "QR-2" },
      { id: "q3", empresaId: "e1", codigo: "QR-3", ativo: false },
      { id: "q9", empresaId: "e2", codigo: "QR-1", equipamentoId: "eq9" },
    ] });
  }, 240_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });
  beforeEach(() => logar());
  afterEach(() => vi.unstubAllGlobals());

  describe("quem só visualiza: 403 em toda gravação, e nada muda no banco", () => {
    it.each(GRAVACOES)("%s", async (_nome, rota, metodo, corpo, params) => {
      const antes = await retrato();
      logar(SO_VE);
      const r = await chamar(rota, metodo, corpo, params);
      expect(r.status).toBe(403);
      expect(typeof r.json?.erro).toBe("string");
      expect(await retrato()).toEqual(antes);
    });
  });

  it("sem login: 401 em toda gravação, e nada muda no banco", async () => {
    const antes = await retrato();
    sessao.atual = null;
    for (const [nome, rota, metodo, corpo, params] of GRAVACOES) {
      expect([nome, (await chamar(rota, metodo, corpo, params)).status]).toEqual([nome, 401]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("quem só visualiza continua LENDO as três listas", async () => {
    logar(SO_VE);
    for (const rota of ["clientes", "equipamentos", "qrcodes"]) expect([rota, (await chamar(rota, "GET")).status]).toEqual([rota, 200]);
    expect((await chamar("qrcodes/[id]", "GET", undefined, { id: "q1" })).status).toBe(200);
  });

  describe("QR Codes › gerenciar (as ações novas da lista)", () => {
    const GERENCIA = montarPermissoes({ qrcodes: ["visualizar", "gerenciar"] });
    beforeEach(async () => { await estadoInicial(); logar(GERENCIA); });
    afterAll(estadoInicial);

    it("desvincular solta a etiqueta: ela fica no acervo, ativa, e o equipamento não muda", async () => {
      const equipamento = await prisma.equipamento.findUnique({ where: { id: "eq1" } });
      const r = await chamar("qrcodes/[id]", "PATCH", { equipamentoId: null }, { id: "q1" });
      expect(r.status).toBe(200);
      expect(await prisma.qrcode.findUnique({ where: { id: "q1" } })).toMatchObject({ equipamentoId: null, ativo: true, codigo: "QR-1" });
      expect(await prisma.equipamento.findUnique({ where: { id: "eq1" } })).toEqual(equipamento);
    });

    it("inativar NÃO apaga (reversível): a etiqueta continua, com o vínculo; reativar devolve", async () => {
      expect((await chamar("qrcodes/[id]", "PATCH", { ativo: false }, { id: "q1" })).status).toBe(200);
      expect(await prisma.qrcode.findUnique({ where: { id: "q1" } })).toMatchObject({ ativo: false, equipamentoId: "eq1" });
      expect((await chamar("qrcodes/[id]", "PATCH", { ativo: true }, { id: "q1" })).status).toBe(200);
      expect(await prisma.qrcode.findUnique({ where: { id: "q1" } })).toMatchObject({ ativo: true, equipamentoId: "eq1" });
    });

    it("vincular: etiqueta livre a equipamento sem etiqueta; equipamento que já tem uma é recusado", async () => {
      expect((await chamar("qrcodes/[id]", "PATCH", { equipamentoId: "eq2" }, { id: "q2" })).status).toBe(200);
      expect((await prisma.qrcode.findUnique({ where: { id: "q2" } })).equipamentoId).toBe("eq2");
      const r = await chamar("qrcodes/[id]", "PATCH", { equipamentoId: "eq1" }, { id: "q3" });
      expect(r.status).toBe(400);
      expect(r.json.erro).toContain("já possui um QR Code");
      expect((await prisma.qrcode.findUnique({ where: { id: "q3" } })).equipamentoId).toBeNull();
    });

    it("etiqueta ou equipamento de OUTRA empresa: não encontra, e nada muda lá", async () => {
      const antes = await prisma.qrcode.findUnique({ where: { id: "q9" } });
      expect((await chamar("qrcodes/[id]", "PATCH", { ativo: false }, { id: "q9" })).status).toBe(404);
      expect((await chamar("qrcodes/[id]", "PATCH", { equipamentoId: "eq9" }, { id: "q2" })).status).toBe(400);
      expect(await prisma.qrcode.findUnique({ where: { id: "q9" } })).toEqual(antes);
      expect((await prisma.qrcode.findUnique({ where: { id: "q2" } })).equipamentoId).toBeNull();
    });

    it("corpo vazio ou inválido: 400 com mensagem (não derruba a rota)", async () => {
      const mod = await import("@/app/api/qrcodes/[id]/route");
      const res = await mod.PATCH(new NextRequest("http://localhost/api/x", { method: "PATCH" }), { params: Promise.resolve({ id: "q1" }) });
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).erro).toBe("string");
      const lote = await (await import("@/app/api/qrcodes/route")).POST(new NextRequest("http://localhost/api/x", { method: "POST" }));
      expect(lote.status).toBe(400);
    });

    it("gerar lote: cria as etiquetas pedidas, livres e ativas", async () => {
      const r = await chamar("qrcodes", "POST", { quantidade: 3 });
      expect(r.status).toBe(201);
      expect(r.json).toHaveLength(3);
      expect(r.json.every((q: any) => q.ativo && q.equipamentoId === null)).toBe(true);
    });

    it("gerenciar QR Codes não dá poder sobre clientes nem equipamentos", async () => {
      expect((await chamar("clientes/[id]", "DELETE", undefined, { id: "c1" })).status).toBe(403);
      expect((await chamar("equipamentos/[id]", "DELETE", undefined, { id: "eq1" })).status).toBe(403);
    });
  });

  describe("Clientes: inativar exige excluir; reativar basta editar", () => {
    beforeEach(estadoInicial);
    afterAll(estadoInicial);

    it("com editar e SEM excluir: não inativa (por nenhum dos dois caminhos), mas reativa", async () => {
      logar(montarPermissoes({ clientes: ["visualizar", "editar"] }));
      expect((await chamar("clientes/[id]", "DELETE", undefined, { id: "c1" })).status).toBe(403);
      expect((await chamar("clientes/[id]", "PATCH", { ativo: false }, { id: "c1" })).status).toBe(403);
      expect((await prisma.cliente.findUnique({ where: { id: "c1" } })).ativo).toBe(true);
      expect((await chamar("clientes/[id]", "PATCH", { ativo: true }, { id: "c2" })).status).toBe(200);
      expect((await prisma.cliente.findUnique({ where: { id: "c2" } })).ativo).toBe(true);
    });

    it("com excluir: inativa sem apagar (o cadastro e os endereços ficam)", async () => {
      logar(montarPermissoes({ clientes: ["visualizar", "excluir"] }));
      expect((await chamar("clientes/[id]", "DELETE", undefined, { id: "c1" })).status).toBe(200);
      expect(await prisma.cliente.findUnique({ where: { id: "c1" } })).toMatchObject({ ativo: false, nome: "Hospital Santa Clara Ltda" });
      expect(await prisma.unidade.count({ where: { clienteId: "c1" } })).toBe(1);
    });

    it("cliente de outra empresa: não encontra", async () => {
      expect((await chamar("clientes/[id]", "DELETE", undefined, { id: "c9" })).status).toBe(404);
      expect((await prisma.cliente.findUnique({ where: { id: "c9" } })).ativo).toBe(true);
    });
  });

  describe("Equipamentos: inativar exige excluir; reativar basta editar; quem só cria gera o QR", () => {
    beforeEach(estadoInicial);
    afterAll(estadoInicial);

    it("com editar e SEM excluir: não inativa, mas reativa", async () => {
      logar(montarPermissoes({ equipamentos: ["visualizar", "editar"] }));
      expect((await chamar("equipamentos/[id]", "DELETE", undefined, { id: "eq1" })).status).toBe(403);
      expect((await chamar("equipamentos/[id]", "PATCH", { ativo: false }, { id: "eq1" })).status).toBe(403);
      expect((await prisma.equipamento.findUnique({ where: { id: "eq1" } })).ativo).toBe(true);
      expect((await chamar("equipamentos/[id]", "PATCH", { ativo: true }, { id: "eq3" })).status).toBe(200);
      expect((await prisma.equipamento.findUnique({ where: { id: "eq3" } })).ativo).toBe(true);
    });

    it("com excluir: inativa sem apagar, e a etiqueta continua vinculada", async () => {
      logar(montarPermissoes({ equipamentos: ["visualizar", "excluir"] }));
      expect((await chamar("equipamentos/[id]", "DELETE", undefined, { id: "eq1" })).status).toBe(200);
      expect((await prisma.equipamento.findUnique({ where: { id: "eq1" } })).ativo).toBe(false);
      expect((await prisma.qrcode.findUnique({ where: { id: "q1" } })).equipamentoId).toBe("eq1");
    });

    it("quem só CRIA: gera o QR do equipamento sem etiqueta, mas não desvincula", async () => {
      logar(montarPermissoes({ equipamentos: ["visualizar", "criar"] }));
      const r = await chamar("equipamentos/[id]/qrcode", "POST", {}, { id: "eq2" });
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({ equipamentoId: "eq2", ativo: true });
      expect(typeof r.json.codigo).toBe("string");
      expect((await chamar("equipamentos/[id]/qrcode", "DELETE", undefined, { id: "eq2" })).status).toBe(403);
      expect(await prisma.qrcode.count({ where: { equipamentoId: "eq2" } })).toBe(1);
    });
  });

  describe("consulta de CNPJ (a do cadastro rápido de cliente)", () => {
    const BRASIL_API = { razao_social: "PADARIA PAO QUENTE LTDA", nome_fantasia: "PAO QUENTE", ddd_telefone_1: "1133339000", email: "contato@paoquente.com.br", municipio: "SAO PAULO", uf: "SP" };

    it("exige login e recusa CNPJ incompleto sem consultar ninguém", async () => {
      const rede = vi.fn();
      vi.stubGlobal("fetch", rede);
      sessao.atual = null;
      expect((await chamar("cnpj/[cnpj]", "GET", undefined, { cnpj: "45723174000110" })).status).toBe(401);
      logar(SO_VE);
      const r = await chamar("cnpj/[cnpj]", "GET", undefined, { cnpj: "4572317400011" });
      expect(r.status).toBe(400);
      expect(r.json.erro).toContain("14 dígitos");
      expect(rede).not.toHaveBeenCalled();
    });

    it("devolve razão social, fantasia e telefone — o que o cadastro rápido aproveita", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BRASIL_API), { status: 200, headers: { "content-type": "application/json" } })));
      const r = await chamar("cnpj/[cnpj]", "GET", undefined, { cnpj: "45.723.174/0001-10" });
      expect(r.status).toBe(200);
      expect(sugestaoDoCnpj(r.json)).toEqual({ nome: "PADARIA PAO QUENTE LTDA", nomeFantasia: "PAO QUENTE", telefone: "(11) 3333-9000" });
    });

    it("CNPJ que a Receita não conhece: 404 com a mensagem que a tela mostra", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
      const r = await chamar("cnpj/[cnpj]", "GET", undefined, { cnpj: "45723174000110" });
      expect(r.status).toBe(404);
      expect(r.json.erro).toContain("não encontrado");
    });
  });
});
