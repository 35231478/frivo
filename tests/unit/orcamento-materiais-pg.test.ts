/**
 * Estoque E3.3 — materiais e peças no orçamento com o Prisma real num PostgreSQL real (schema descartável):
 *  - materializar (GET /api/orcamentos/materiais-padrao): kit explodido, venda pela tabela do cliente (quando o
 *    produto está nela) ou padrão, custo interno; produto avulso; só a empresa da sessão;
 *  - POST/PUT/GET do orçamento: o snapshot gravado por linha de serviço, a linha de serviço com base/ajuste/manual
 *    e o total que vale, a peça como linha de PRODUTO derivada (material_id), totais serviço × produtos separados;
 *    regravar na edição; snapshot imune a mudanças no cadastro; produto de outra empresa = 400;
 *  - Gerar OS e a fatura leem o serviço já ajustado e a peça como item/produto (sem material, sem custo);
 *  - sem baixa de estoque (saldo e movimentações intactos);
 *  - "Definir categoria" em massa: só produtos da empresa, permissão do cadastro, categoria inválida/inativa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-materiais-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { faturaDoOrcamento } from "@/lib/faturamento/fatura";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_materiais_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const padrao = (qs: string) => chamar("orcamentos/materiais-padrao", "GET", undefined, {}, `http://localhost/api/orcamentos/materiais-padrao?${qs}`);
const massa = (corpo: unknown) => chamar("acoes-massa", "POST", corpo);

describe.skipIf(!URL_PG)("Materiais e peças no orçamento (PostgreSQL real)", () => {
  let prisma: any;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["orcamentos", "orcamentos/[id]", "orcamentos/materiais-padrao", "orcamentos/[id]/gerar-os", "acoes-massa", "cadastros/[entidade]/[id]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } }).catch(() => {});
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "cTab", empresaId: "e1", nome: "Cliente com tabela", cpfCnpj: "22101333000122" },
      { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" },
    ] });
    const pecas = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Peças", comportamento: "VENDA_A_PARTE" } });
    const mat = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO" } });
    const inativa = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Inativa", comportamento: "INCLUSO_NO_SERVICO", ativo: false } });
    const daOutra = await prisma.categoriaProduto.create({ data: { empresaId: "e2", nome: "Da outra", comportamento: "VENDA_A_PARTE" } });
    Object.assign(ids, { pecas: pecas.id, mat: mat.id, inativa: inativa.id, daOutra: daOutra.id });
    const p = async (id: string, nome: string, unidade: string, cat: string | null, valorPadrao: number, empresaId = "e1") =>
      prisma.produto.create({ data: { id, empresaId, nome, unidade, categoriaProdutoId: cat, valorPadrao, saldo: 10 } });
    await p("tubo", "Tubo de cobre 1/4", "m", mat.id, 20); await p("filtro", "Filtro secador", "un", mat.id, 35); await p("suporte", "Suporte", "un", null, 60);
    await p("cap", "Capacitor 35uF", "un", pecas.id, 80); await p("fita", "Fita", "un", null, 15); await p("outro", "Da outra empresa", "un", null, 9, "e2");
    const mov = (produtoId: string, custo: number) => prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: custo } });
    await mov("tubo", 12); await mov("filtro", 20); await mov("cap", 45);
    const kit = await prisma.kitMaterial.create({ data: { empresaId: "e1", nome: "Kit instalação", itens: { create: [{ produtoId: "tubo", quantidade: 3, ordem: 0 }, { produtoId: "filtro", quantidade: 1, ordem: 1 }] } } });
    const servico = await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800, materiais: { create: [{ kitId: kit.id, quantidade: 1, ordem: 0 }, { produtoId: "suporte", quantidade: 1, ordem: 1 }, { produtoId: "cap", quantidade: 1, ordem: 2 }] } } });
    await prisma.servico.create({ data: { id: "sLimp", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza", valorPadrao: 150 } });
    ids.servico = servico.id;
    // Cliente com tabela de preços ativa: o capacitor sai por 99 nela
    const tabela = await prisma.tabelaPreco.create({ data: { empresaId: "e1", nome: "Contrato", itens: { create: [{ produtoId: "cap", tipoPreco: "VALOR_FIXO", valorFixo: 99, valorFinal: 99 }] } } });
    await prisma.cliente.update({ where: { id: "cTab" }, data: { tabelaPrecoId: tabela.id } });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("materializar: kit explodido em itens, venda pela tabela do cliente ou padrão, custo interno; avulso; outra empresa = 404", async () => {
    const r = await padrao(`servicoId=${ids.servico}&clienteId=c1`);
    expect(r.status).toBe(200);
    expect(r.json.materiais.map((m: any) => [m.produtoId, m.quantidade, m.quantidadePadrao, m.valorVendaUnit, m.custoUnit, m.origem, m.kitNome, m.comportamento])).toEqual([
      ["tubo", 3, 3, 20, 12, "KIT", "Kit instalação", "INCLUSO_NO_SERVICO"], ["filtro", 1, 1, 35, 20, "KIT", "Kit instalação", "INCLUSO_NO_SERVICO"],
      ["suporte", 1, 1, 60, null, "SOLTO", null, "INCLUSO_NO_SERVICO"], ["cap", 1, 1, 80, 45, "SOLTO", null, "VENDA_A_PARTE"],
    ]);
    expect((await padrao(`servicoId=${ids.servico}&clienteId=cTab`)).json.materiais.find((m: any) => m.produtoId === "cap").valorVendaUnit).toBe(99);
    expect((await padrao("servicoId=sLimp")).json).toEqual({ materiais: [] });
    expect((await padrao("produtoId=fita&clienteId=c1")).json.material).toMatchObject({ produtoId: "fita", descricao: "Fita", quantidade: 1, quantidadePadrao: 0, valorVendaUnit: 15, custoUnit: null, origem: "AVULSO", comportamento: "INCLUSO_NO_SERVICO" });
    expect((await padrao("produtoId=outro")).status).toBe(404);
    expect((await padrao("")).status).toBe(400);
    logar(permissoesTotais(), "e2");
    expect((await padrao(`servicoId=${ids.servico}`)).status).toBe(404);
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    expect((await padrao(`servicoId=${ids.servico}`)).status).toBe(403);
    logar();
  });

  it("orçamento: snapshot gravado por linha, serviço = base + ajuste, peça = linha de produto derivada, totais separados; GET devolve tudo; a edição regrava", async () => {
    const { materiais } = (await padrao(`servicoId=${ids.servico}&clienteId=c1`)).json;
    // Tubo 3→5, filtro 1→3, suporte 1→10 (+650); capacitor 1→2 (peça: 2 × 80 à parte)
    const editados = materiais.map((m: any) => ({ ...m, quantidade: { tubo: 5, filtro: 3, suporte: 10, cap: 2 }[m.produtoId as string] }));
    const r = await chamar("orcamentos", "POST", {
      clienteId: "c1", servicos: [{ catalogoId: ids.servico, descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: editados }, { catalogoId: "sLimp", descricao: "Limpeza", quantidade: 2, valorUnitario: 150 }],
      produtos: [{ catalogoId: "fita", descricao: "Fita", quantidade: 1, valorUnitario: 15 }],
    });
    expect(r.status).toBe(201);
    ids.orc = r.json.id;
    expect(r.json).toMatchObject({ totalServicos: "1750", totalProdutos: "175", totalGeral: "1925" });
    const g = await chamar("orcamentos/[id]", "GET", undefined, { id: ids.orc });
    const inst = g.json.servicos[0];
    expect(inst).toMatchObject({ descricao: "Instalação split", valorBase: "800", ajusteMateriais: "650", valorManual: false, valorTotal: "1450", valorUnitario: "1450" });
    expect(inst.materiais.map((m: any) => [m.produtoId, Number(m.quantidade), Number(m.quantidadePadrao), Number(m.valorVendaUnit), m.custoUnit == null ? null : Number(m.custoUnit), m.origem, m.ordem]))
      .toEqual([["tubo", 5, 3, 20, 12, "KIT", 0], ["filtro", 3, 1, 35, 20, "KIT", 1], ["suporte", 10, 1, 60, null, "SOLTO", 2], ["cap", 2, 1, 80, 45, "SOLTO", 3]]);
    expect(g.json.servicos[1]).toMatchObject({ descricao: "Limpeza", valorBase: null, ajusteMateriais: "0", materiais: [] });
    // Produtos: o do usuário e a peça derivada (apontando para o material), nessa ordem
    expect(g.json.produtos.map((p: any) => [p.descricao, Number(p.quantidade), Number(p.valorTotal), !!p.materialId])).toEqual([["Fita", 1, 15, false], ["Capacitor 35uF", 2, 160, true]]);
    const capMat = inst.materiais.find((m: any) => m.produtoId === "cap");
    expect(g.json.produtos[1].materialId).toBe(capMat.id);
    expect(await prisma.orcamentoMaterial.count({ where: { orcamentoId: ids.orc } })).toBe(4);

    // Edição: tubo volta ao padrão, capacitor não usado (0), valor manual na Limpeza não se aplica (sem materiais)
    const g2 = await chamar("orcamentos/[id]", "PUT", {
      clienteId: "c1",
      servicos: [{ catalogoId: ids.servico, descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: inst.materiais.map((m: any) => ({ ...m, id: undefined, orcamentoId: undefined, orcamentoServicoId: undefined, ordem: undefined, quantidade: m.produtoId === "tubo" ? 3 : m.produtoId === "cap" ? 0 : Number(m.quantidade), quantidadePadrao: Number(m.quantidadePadrao), valorVendaUnit: Number(m.valorVendaUnit), custoUnit: m.custoUnit == null ? null : Number(m.custoUnit) })) }],
      produtos: [],
    }, { id: ids.orc });
    expect(g2.json?.erro ?? g2.status).toBe(200);
    expect(g2.json).toMatchObject({ totalServicos: "1410", totalProdutos: "0", totalGeral: "1410" }); // 800 + 70 + 540
    expect(await prisma.orcamentoProduto.count({ where: { orcamentoId: ids.orc } })).toBe(0);
    expect(await prisma.orcamentoMaterial.count({ where: { orcamentoId: ids.orc } })).toBe(4);
    expect(await prisma.orcamentoServico.count({ where: { orcamentoId: ids.orc } })).toBe(1);
  });

  it("valor manual vale; snapshot imune ao cadastro; produto de outra empresa ou material inválido = 400 (nada gravado); orçamento sem materiais igual a antes", async () => {
    const base = { clienteId: "c1", produtos: [] };
    const linha = (extra: Record<string, unknown>) => ({ catalogoId: ids.servico, descricao: "Instalação", quantidade: 1, valorUnitario: 800, materiais: [{ produtoId: "tubo", descricao: "Tubo", unidade: "m", comportamento: "INCLUSO_NO_SERVICO", quantidade: 5, quantidadePadrao: 3, valorVendaUnit: 20, custoUnit: 12, origem: "KIT", kitNome: "Kit" }], ...extra });
    const manual = await chamar("orcamentos", "POST", { ...base, servicos: [linha({ valorTotal: 1000, valorManual: true })] });
    expect(manual.status).toBe(201);
    expect(manual.json.totalServicos).toBe("1000");
    const gm = await chamar("orcamentos/[id]", "GET", undefined, { id: manual.json.id });
    expect(gm.json.servicos[0]).toMatchObject({ valorManual: true, valorTotal: "1000", valorBase: "800", ajusteMateriais: "40" });
    // Snapshot: mudar o cadastro (preço, categoria, kit) depois não altera o orçamento
    await prisma.produto.update({ where: { id: "tubo" }, data: { valorPadrao: 999, categoriaProdutoId: ids.pecas } });
    await prisma.kitMaterialItem.deleteMany({ where: { produtoId: "tubo" } });
    expect((await chamar("orcamentos/[id]", "GET", undefined, { id: manual.json.id })).json.servicos[0].materiais[0]).toMatchObject({ valorVendaUnit: "20", comportamento: "INCLUSO_NO_SERVICO", quantidade: "5" });
    await prisma.produto.update({ where: { id: "tubo" }, data: { valorPadrao: 20, categoriaProdutoId: ids.mat } });
    await prisma.kitMaterialItem.create({ data: { kitId: (await prisma.kitMaterial.findFirst({ where: { empresaId: "e1" } })).id, produtoId: "tubo", quantidade: 3, ordem: 0 } });
    const antes = await prisma.orcamento.count({ where: { empresaId: "e1" } });
    const outra = await chamar("orcamentos", "POST", { ...base, servicos: [linha({ materiais: [{ produtoId: "outro", descricao: "X", comportamento: "INCLUSO_NO_SERVICO", quantidade: 1, quantidadePadrao: 0, valorVendaUnit: 1, custoUnit: null, origem: "AVULSO" }] })] });
    expect(outra.status).toBe(400);
    expect(outra.json.erro).toMatch(/Produto do material inválido/);
    expect((await chamar("orcamentos", "POST", { ...base, servicos: [linha({ materiais: [{ produtoId: "tubo", descricao: "X", comportamento: "GRATIS", quantidade: 1, quantidadePadrao: 0, valorVendaUnit: 1, origem: "AVULSO" }] })] })).status).toBe(400);
    expect(await prisma.orcamento.count({ where: { empresaId: "e1" } })).toBe(antes);
    const simples = await chamar("orcamentos", "POST", { ...base, servicos: [{ descricao: "Antigo", quantidade: 3, valorUnitario: 33.33, valorTotal: 100 }] });
    expect(simples.status).toBe(201);
    expect((await chamar("orcamentos/[id]", "GET", undefined, { id: simples.json.id })).json.servicos[0]).toMatchObject({ valorTotal: "100", valorUnitario: "33.33", valorBase: null, ajusteMateriais: "0", valorManual: false, materiais: [] });
  });

  it("Gerar OS e a fatura leem o serviço já ajustado e a peça como item/linha de produto (sem material, sem custo); nada de baixa de estoque", async () => {
    const { materiais } = (await padrao(`servicoId=${ids.servico}&clienteId=c1`)).json;
    const r = await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [{ catalogoId: ids.servico, descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: materiais.map((m: any) => ({ ...m, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade })) }], produtos: [] });
    await prisma.orcamento.update({ where: { id: r.json.id }, data: { status: "APROVADO" } });
    const mod = await import("@/app/api/orcamentos/[id]/gerar-os/route");
    const res = await mod.POST(new NextRequest("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } }) }), { params: Promise.resolve({ id: r.json.id }) });
    expect(res.status).toBeLessThan(300);
    const os = await prisma.ordemServico.findFirst({ where: { orcamentoOrigemId: r.json.id }, include: { itensOrcamento: true } });
    expect(os.itensOrcamento.map((i: any) => [i.descricao, Number(i.quantidade), Number(i.valorTotal)])).toEqual([["Instalação split", 1, 840], ["Capacitor 35uF", 1, 80]]);
    // A fatura (regra pura sobre o que está gravado): serviço ajustado + peça como produto; nenhum custo
    const orc = await prisma.orcamento.findUnique({ where: { id: r.json.id }, include: { servicos: true, produtos: true } });
    const f = faturaDoOrcamento({ ...orc, servicos: orc.servicos.map((s: any) => ({ ...s, servicoId: s.servicoId })), produtos: orc.produtos });
    expect(f.linhas.map((l: any) => [l.descricao, Number(l.valorTotal ?? l.valor ?? 0)])).toEqual(expect.arrayContaining([["Instalação split", 840], ["Capacitor 35uF", 80]]));
    expect(JSON.stringify(f)).not.toMatch(/custo/i);
    // Sem baixa: saldo e movimentações como estavam
    expect(Number((await prisma.produto.findUnique({ where: { id: "tubo" } })).saldo)).toBe(10);
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: { not: "ENTRADA" } } })).toBe(0);
  });

  it("'Definir categoria' em massa: aplica só nos produtos da empresa (os de fora não puderam), categoria inválida/inativa/de outra empresa = 400, sem permissão 403, 'Sem categoria' tira", async () => {
    const r = await massa({ entidade: "produtos", acao: "definir-categoria", ids: ["suporte", "fita", "outro"], dados: { categoriaProdutoId: ids.mat } });
    expect(r.status).toBe(200);
    expect(r.json.resumo).toMatchObject({ total: 3, feitas: 2, naoPuderam: 1 });
    expect(r.json.resultados.find((x: any) => x.id === "outro")).toMatchObject({ ok: false });
    expect((await prisma.produto.findMany({ where: { id: { in: ["suporte", "fita"] } } })).map((p: any) => p.categoriaProdutoId)).toEqual([ids.mat, ids.mat]);
    expect((await prisma.produto.findUnique({ where: { id: "outro" } })).categoriaProdutoId).toBeNull();
    expect((await massa({ entidade: "produtos", acao: "definir-categoria", ids: ["suporte"], dados: { categoriaProdutoId: ids.mat } })).json.resultados[0].detalhe).toMatch(/Já estava assim/);
    for (const cat of [ids.inativa, ids.daOutra, "nao-existe"]) {
      const x = await massa({ entidade: "produtos", acao: "definir-categoria", ids: ["suporte"], dados: { categoriaProdutoId: cat } });
      expect(x.json.resumo.naoPuderam, cat).toBe(1);
    }
    expect((await massa({ entidade: "produtos", acao: "definir-categoria", ids: ["suporte"], dados: {} })).status).toBe(400);
    expect((await massa({ entidade: "produtos", acao: "definir-categoria", ids: ["suporte"], dados: { categoriaProdutoId: null } })).json.resumo.feitas).toBe(1);
    expect((await prisma.produto.findUnique({ where: { id: "suporte" } })).categoriaProdutoId).toBeNull();
    logar(montarPermissoes({ configuracoes: ["visualizar"] }));
    expect((await massa({ entidade: "produtos", acao: "definir-categoria", ids: ["fita"], dados: { categoriaProdutoId: null } })).status).toBe(403);
    logar();
  });
});
