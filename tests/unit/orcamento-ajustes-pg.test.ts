/**
 * Ajustes finos do orçamento — rotas reais com o Prisma real num PostgreSQL real:
 *  - nome em branco = nome automático (tipo da OS — equipamento — cliente · unidade, ou itens);
 *    nome digitado é respeitado; a prévia da tela (form-dados) usa o mesmo contexto da OS;
 *  - prazo de execução e forma de pagamento gravados (aparados; vazio = nulo) e no documento;
 *  - dados bancários: cadastro da empresa (PUT/GET) e no documento do cliente (impressão pública);
 *    sem dados bancários, o bloco não aparece; orçamento antigo (sem os campos novos) continua igual.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-ajustes-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_ajustes_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes } };
};

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe.skipIf(!URL_PG)("Orçamento: nome automático, condições e dados bancários (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["orcamentos", "orcamentos/[id]", "orcamentos/form-dados", "empresa"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Ltda", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia Ltda", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "22333444000190" },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Bloco A" } });
    await prisma.equipamento.createMany({ data: [
      { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Samsung", modelo: "WindFree 18k" },
      { id: "eq2", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "Dual", nome: "Split da UTI" },
    ] });
    await prisma.tipoOs.create({ data: { id: "t1", empresaId: "e1", nome: "Manutenção Corretiva" } });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-2026-0001", clienteId: "c1", unidadeId: "un1", criadoPorId: "u1", descricao: "Não gela" },
      { id: "os2", empresaId: "e1", numero: "OS-2026-0002", clienteId: "c1", criadoPorId: "u1", equipamentoId: "eq2", descricao: "Barulho" },
    ] });
    await prisma.atividadeOs.create({ data: { id: "a1", empresaId: "e1", ordemServicoId: "os1", tipoOsId: "t1", titulo: "Visita" } });
    await prisma.atividadeEquipamento.create({ data: { atividadeId: "a1", equipamentoId: "eq1" } });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const ITEM = { descricao: "Troca de capacitor", quantidade: 1, valorUnitario: 380 };

  it("nome em branco, criado da OS: tipo — cliente (curto, cabe numa linha da lista)", async () => {
    const r = await chamar("orcamentos", "POST", { nome: "  ", clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [] });
    expect(r.status).toBe(201);
    expect(r.json.nome).toBe("Manutenção Corretiva — Hospital Santa Luzia");
  });

  it("sem tipo na OS: o 1º item (+N) — cliente; sem OS: itens — cliente", async () => {
    let r = await chamar("orcamentos", "POST", { clienteId: "c1", ordensServicoIds: ["os2"], servicos: [ITEM, { ...ITEM, descricao: "Limpeza" }], produtos: [] });
    expect(r.json.nome).toBe("Troca de capacitor +1 — Hospital Santa Luzia");
    r = await chamar("orcamentos", "POST", { nome: null, clienteId: "c2", servicos: [], produtos: [{ descricao: "Capacitor 35uF", quantidade: 2, valorUnitario: 50 }] });
    expect(r.json.nome).toBe("Capacitor 35uF — Padaria Pão Quente");
  });

  it("nome digitado é respeitado (aparado); na edição, apagar o nome volta ao automático", async () => {
    const r = await chamar("orcamentos", "POST", { nome: "  Proposta especial  ", clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [] });
    expect(r.json.nome).toBe("Proposta especial");
    const e = await chamar("orcamentos/[id]", "PUT", { nome: "", clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [] }, { id: r.json.id });
    expect(e.json.nome).toBe("Manutenção Corretiva — Hospital Santa Luzia");
  });

  it("a prévia da tela recebe o mesmo contexto da OS (tipo, unidade, equipamento)", async () => {
    const r = await chamar("orcamentos/form-dados", "GET", undefined, {}, "?osId=os1");
    expect(r.json.contextoNome).toEqual({ tipoOs: "Manutenção Corretiva", unidade: "Bloco A", equipamento: "Samsung WindFree 18k" });
    const { nomeAutomaticoOrcamento } = await import("@/lib/orcamentos/nome");
    expect(nomeAutomaticoOrcamento({ ...r.json.contextoNome, cliente: "Hospital Santa Luzia", itens: ["Troca de capacitor"] }))
      .toBe("Manutenção Corretiva — Hospital Santa Luzia");
  });

  let orcId = "";
  it("prazo de execução e forma de pagamento: gravados aparados; vazio = nulo", async () => {
    const r = await chamar("orcamentos", "POST", {
      clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [],
      prazoExecucao: "  5 dias úteis após aprovação ", formaPagamento: "PIX à vista",
    });
    orcId = r.json.id;
    expect([r.json.prazoExecucao, r.json.formaPagamento]).toEqual(["5 dias úteis após aprovação", "PIX à vista"]);
    const e = await chamar("orcamentos/[id]", "PUT", { clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [], prazoExecucao: "", formaPagamento: "Boleto em 2x" }, { id: orcId });
    expect([e.json.prazoExecucao, e.json.formaPagamento]).toEqual([null, "Boleto em 2x"]);
    expect((await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [ITEM], produtos: [], formaPagamento: "x".repeat(201) })).status).toBe(400);
  });

  it("cadastro da empresa: dados bancários salvos e devolvidos; vazio vira nulo", async () => {
    const r = await chamar("empresa", "PUT", { bancoNome: " Banco Inter (077) ", bancoAgencia: "0001", bancoConta: "12345-6", bancoTipoConta: "Corrente", bancoTitular: "", pixChave: "12.345.678/0001-90" });
    expect(r.status).toBe(200);
    const g = await chamar("empresa", "GET");
    expect(g.json).toMatchObject({ bancoNome: "Banco Inter (077)", bancoAgencia: "0001", bancoConta: "12345-6", bancoTipoConta: "Corrente", bancoTitular: null, pixChave: "12.345.678/0001-90" });
    logar(permissoesTotais(), "e2");
    expect((await chamar("empresa", "GET")).json.bancoNome).toBeNull(); // cada empresa vê só a sua
    logar();
  });

  const imprimir = async (id: string) => {
    const o = await prisma.orcamento.findUnique({ where: { id }, select: { tokenPublico: true } });
    const { default: P } = await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    return renderToStaticMarkup(await P({ params: Promise.resolve({ token: o.tokenPublico }) }));
  };

  it("documento do cliente (impressão pública): condições e dados bancários do cadastro", async () => {
    await chamar("orcamentos/[id]", "PUT", { clienteId: "c1", ordensServicoIds: ["os1"], servicos: [ITEM], produtos: [], prazoExecucao: "5 dias úteis", formaPagamento: "PIX à vista" }, { id: orcId });
    const h = await imprimir(orcId);
    expect(h).toContain("data-condicoes-documento");
    expect(texto(h)).toContain("Prazo de execução dos serviços 5 dias úteis");
    expect(texto(h)).toContain("Forma de pagamento PIX à vista");
    expect(texto(h)).toContain("Banco Banco Inter (077) Agência 0001 Conta corrente 12345-6");
    expect(texto(h)).toContain("Titular Clima Total Ltda CNPJ 12.345.678/0001-90 Chave PIX 12.345.678/0001-90");
    // Duas colunas: conta à esquerda, favorecido à direita
    expect(h).toMatch(/data-coluna-banco="conta"[\s\S]*Conta corrente[\s\S]*data-coluna-banco="favorecido"[\s\S]*Chave PIX/);
  });

  it("sem dados bancários e sem condições: nenhum bloco (nem campo vazio); orçamento antigo segue igual", async () => {
    await prisma.empresa.update({ where: { id: "e1" }, data: { bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTipoConta: null, pixChave: null } });
    // "Antigo": gravado direto, sem os campos novos
    const antigo = await prisma.orcamento.create({ data: {
      empresaId: "e1", codigo: "ORC-2025-0001", nome: "Antigo", clienteId: "c1", criadoPorId: "u1", tokenPublico: "tok-antigo",
      totalServicos: 100, totalProdutos: 0, totalGeral: 100,
      servicos: { create: [{ descricao: "Serviço antigo", quantidade: 1, valorUnitario: 100, valorTotal: 100, ordem: 0 }] },
    } });
    const h = await imprimir(antigo.id);
    expect(h).not.toContain("data-dados-bancarios");
    expect(h).not.toContain("data-condicoes-documento");
    expect(texto(h)).toContain("Serviço antigo");
    expect(texto(h)).toContain("R$ 100,00");
  });
});
