/**
 * "Orçamento E — Material × Peça" com as rotas reais e o Prisma real num PostgreSQL real (schema descartável):
 *  - cadastro do produto: sem Uso, a categoria sugere (Peças → Peça; Materiais ou nenhuma → Material); Uso informado
 *    vence a categoria; editar sem mandar o Uso não muda; valor fora do tipo = 400;
 *  - materiais do serviço (GET /api/orcamentos/materiais-padrao): o comportamento vem do Uso do produto, não da categoria;
 *  - orçamento: um Material trocado para Peça SÓ neste orçamento grava o snapshot como Peça, ganha a linha de produto
 *    derivada com valor e não mexe no cadastro do produto; custo interno continua somando os dois;
 *  - planilha de produtos (Implantação): coluna uso cria e atualiza; vazia não muda o que existe;
 *  - lista do estoque: filtro por Uso, só da empresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-e-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { gerarCsv } from "@/lib/folha/planilha";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_e_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const padrao = (qs: string) => chamar("orcamentos/materiais-padrao", "GET", undefined, {}, `http://localhost/api/orcamentos/materiais-padrao?${qs}`);
const criarProduto = (dados: Record<string, unknown>) => chamar("cadastros/[entidade]", "POST", { unidade: "un", ...dados }, { entidade: "produtos" });
const csv = (linhas: string[][]) => new File([gerarCsv(linhas)], "produtos.csv", { type: "text/csv" });
async function importarProdutos(linhas: string[][]) {
  const fd = new FormData();
  fd.append("arquivo", csv(linhas));
  fd.append("etapa", "confirmar");
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const res: Response = await mod.POST(new NextRequest("http://localhost/api/importacao/produtos", { method: "POST", body: fd }), { params: Promise.resolve({ entidade: "produtos" }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

describe.skipIf(!URL_PG)("Orçamento E — Material × Peça (PostgreSQL real)", () => {
  let prisma: any;
  const ids: Record<string, string> = {};
  const usoDe = async (id: string) => (await prisma.produto.findUnique({ where: { id }, select: { uso: true } })).uso;
  const porNome = async (nome: string) => prisma.produto.findFirst({ where: { empresaId: "e1", nome }, select: { id: true, uso: true } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["orcamentos", "orcamentos/[id]", "orcamentos/materiais-padrao", "cadastros/[entidade]", "cadastros/[entidade]/[id]", "importacao/[entidade]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Refrigeração Fictícia", cnpj: "12345678000190", email: "e@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "o@ficticio.test" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@ficticio.test", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@ficticio.test", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } }).catch(() => {});
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Padaria Fictícia", cpfCnpj: "22101333000111" } });
    const pecas = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Peças de reposição", comportamento: "VENDA_A_PARTE" } });
    const mat = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO" } });
    Object.assign(ids, { pecas: pecas.id, mat: mat.id });
    logar();
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cadastro: sem Uso, a categoria sugere; Uso informado vence; editar sem o Uso não muda; valor inválido = 400", async () => {
    expect((await criarProduto({ nome: "Compressor rotativo", categoriaProdutoId: ids.pecas })).status).toBe(201);
    expect((await criarProduto({ nome: "Fita PVC", categoriaProdutoId: ids.mat })).status).toBe(201);
    expect((await criarProduto({ nome: "Suporte de parede" })).status).toBe(201);
    expect((await criarProduto({ nome: "Gás R410A", categoriaProdutoId: ids.pecas, uso: "MATERIAL", unidade: "kg" })).status).toBe(201);
    expect((await criarProduto({ nome: "Capacitor 35uF", categoriaProdutoId: ids.mat, uso: "PECA" })).status).toBe(201);
    expect((await porNome("Compressor rotativo")).uso).toBe("PECA");
    expect((await porNome("Fita PVC")).uso).toBe("MATERIAL");
    expect((await porNome("Suporte de parede")).uso).toBe("MATERIAL");
    expect((await porNome("Gás R410A")).uso).toBe("MATERIAL");
    expect((await porNome("Capacitor 35uF")).uso).toBe("PECA");
    for (const n of ["Compressor rotativo", "Fita PVC", "Suporte de parede", "Gás R410A", "Capacitor 35uF"]) ids[n] = (await porNome(n)).id;

    // editar: sem o Uso, fica; trocar a categoria também não muda o Uso (ela só sugere ao criar)
    const editar = (id: string, dados: Record<string, unknown>) => chamar("cadastros/[entidade]/[id]", "PUT", dados, { entidade: "produtos", id });
    expect((await editar(ids["Compressor rotativo"], { nome: "Compressor rotativo 12k", categoriaProdutoId: ids.mat })).status).toBe(200);
    expect(await usoDe(ids["Compressor rotativo"])).toBe("PECA");
    expect((await editar(ids["Fita PVC"], { uso: "PECA" })).status).toBe(200);
    expect(await usoDe(ids["Fita PVC"])).toBe("PECA");
    expect((await editar(ids["Fita PVC"], { uso: "MATERIAL" })).status).toBe(200);
    expect((await criarProduto({ nome: "Inválido", uso: "SERVICO" })).status).toBe(400);
    expect((await editar(ids["Fita PVC"], { uso: "peca" })).status).toBe(400);
    expect(await usoDe(ids["Fita PVC"])).toBe("MATERIAL");
  });

  it("materiais do serviço: o comportamento vem do Uso do produto (não da categoria)", async () => {
    // Gás: categoria Peças, Uso Material → incluso; Capacitor: categoria Materiais, Uso Peça → à parte
    const gas = (await padrao(`produtoId=${ids["Gás R410A"]}&clienteId=c1`)).json.material;
    const cap = (await padrao(`produtoId=${ids["Capacitor 35uF"]}&clienteId=c1`)).json.material;
    expect(gas.comportamento).toBe("INCLUSO_NO_SERVICO");
    expect(cap.comportamento).toBe("VENDA_A_PARTE");
    const servico = await prisma.servico.create({ data: { empresaId: "e1", codigo: "INST", nome: "Instalação split", valorPadrao: 800, materiais: { create: [
      { produtoId: ids["Gás R410A"], quantidade: 1, ordem: 0 }, { produtoId: ids["Capacitor 35uF"], quantidade: 1, ordem: 1 },
    ] } } });
    ids.servico = servico.id;
    const { materiais } = (await padrao(`servicoId=${servico.id}&clienteId=c1`)).json;
    expect(materiais.map((m: any) => [m.descricao, m.comportamento])).toEqual([["Gás R410A", "INCLUSO_NO_SERVICO"], ["Capacitor 35uF", "VENDA_A_PARTE"]]);
  });

  it("orçamento: o gás (Material) trocado para Peça SÓ neste orçamento — snapshot como Peça, linha própria com valor; o cadastro não muda", async () => {
    await prisma.produto.update({ where: { id: ids["Gás R410A"] }, data: { valorPadrao: 120 } });
    await prisma.produto.update({ where: { id: ids["Capacitor 35uF"] }, data: { valorPadrao: 80 } });
    await prisma.movimentacaoEstoque.createMany({ data: [
      { empresaId: "e1", produtoId: ids["Gás R410A"], tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: 70 },
      { empresaId: "e1", produtoId: ids["Capacitor 35uF"], tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: 45 },
    ] });
    const { materiais } = (await padrao(`servicoId=${ids.servico}&clienteId=c1`)).json;
    // o gás cobrado por kg: 2 kg, trocado para Peça (VENDA_A_PARTE) só aqui
    const trocados = materiais.map((m: any) => (m.descricao === "Gás R410A" ? { ...m, quantidade: 2, comportamento: "VENDA_A_PARTE" } : m));
    const r = await chamar("orcamentos", "POST", {
      clienteId: "c1", servicos: [{ catalogoId: ids.servico, descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: trocados }], produtos: [],
    });
    expect(r.status).toBe(201);
    const g = await chamar("orcamentos/[id]", "GET", undefined, { id: r.json.id });
    const inst = g.json.servicos[0];
    expect(inst.materiais.map((m: any) => [m.descricao, m.comportamento, Number(m.quantidade)])).toEqual([["Gás R410A", "VENDA_A_PARTE", 2], ["Capacitor 35uF", "VENDA_A_PARTE", 1]]);
    // o serviço fica na base (nenhum Material mudou de quantidade); as duas peças em linhas próprias, com valor
    expect(Number(inst.valorTotal)).toBe(800);
    expect(g.json.produtos.map((p: any) => [p.descricao, Number(p.quantidade), Number(p.valorTotal), !!p.materialId])).toEqual([["Gás R410A", 2, 240, true], ["Capacitor 35uF", 1, 80, true]]);
    expect(Number(g.json.totalGeral)).toBe(1120);
    // custo interno continua somando os dois (2 × 70 + 1 × 45), gravado no snapshot
    const custos = (await prisma.orcamentoMaterial.findMany({ where: { orcamentoId: r.json.id }, select: { custoUnit: true, quantidade: true } }))
      .reduce((s: number, m: any) => s + Number(m.custoUnit) * Number(m.quantidade), 0);
    expect(custos).toBe(185);
    // o cadastro do produto não mudou
    expect(await usoDe(ids["Gás R410A"])).toBe("MATERIAL");
    expect((await padrao(`produtoId=${ids["Gás R410A"]}&clienteId=c1`)).json.material.comportamento).toBe("INCLUSO_NO_SERVICO");
  });

  it("planilha de produtos: coluna uso cria e atualiza; vazia não muda o que existe; valor desconhecido = erro na linha", async () => {
    const r = await importarProdutos([
      ["nome", "unidade", "uso", "id_sistema"],
      ["Motor ventilador", "un", "Peça", ""],
      ["Tubo de cobre 1/4", "m", "", ""],
      ["Placa eletrônica", "un", "peca", ""],
      ["Capacitor 35uF", "un", "Material", ids["Capacitor 35uF"]],
      ["Compressor rotativo 12k", "un", "", ids["Compressor rotativo"]],
      ["Isolamento térmico", "m", "consumo", ""],
      ["Coisa", "un", "serviço", ""],
    ]);
    expect(r.status).toBe(200);
    expect((await porNome("Motor ventilador")).uso).toBe("PECA");
    expect((await porNome("Tubo de cobre 1/4")).uso).toBe("MATERIAL");
    expect((await porNome("Placa eletrônica")).uso).toBe("PECA");
    expect((await porNome("Isolamento térmico")).uso).toBe("MATERIAL");
    expect(await usoDe(ids["Capacitor 35uF"])).toBe("MATERIAL");
    expect(await usoDe(ids["Compressor rotativo"])).toBe("PECA");
    expect(await porNome("Coisa")).toBeNull();
    expect(JSON.stringify(r.json)).toMatch(/uso “serviço” não existe/);
  });

  it("lista do estoque: filtro por Uso (só da empresa; valor estranho = sem filtro)", async () => {
    const { listarEstoque } = await import("@/lib/estoque/servidor");
    await prisma.produto.updateMany({ where: { empresaId: "e1" }, data: { controlaEstoque: true } });
    await prisma.produto.create({ data: { empresaId: "e2", nome: "Peça da outra", unidade: "un", uso: "PECA", controlaEstoque: true } });
    const nomes = async (uso?: string) => (await listarEstoque("e1", uso === undefined ? {} : { uso })).itens.map((p: any) => p.nome).sort();
    const pecas = await nomes("PECA");
    const materiais = await nomes("MATERIAL");
    expect(pecas).toEqual(["Compressor rotativo 12k", "Motor ventilador", "Placa eletrônica"]);
    expect(materiais).toEqual(["Capacitor 35uF", "Fita PVC", "Gás R410A", "Isolamento térmico", "Suporte de parede", "Tubo de cobre 1/4"]);
    expect(await nomes()).toEqual([...pecas, ...materiais].sort());
    expect(await nomes("x")).toEqual(await nomes());
    expect((await listarEstoque("e1", { uso: "PECA" })).itens.every((p: any) => p.uso === "PECA")).toBe(true);
  });
});
