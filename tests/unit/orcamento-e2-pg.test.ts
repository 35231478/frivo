/**
 * "Orçamento E2 — regra de materiais por empresa" com as rotas reais e o Prisma real num PostgreSQL real
 * (schema descartável), nos DOIS modos:
 *  - Configurações: PUT grava a regra; valor fora do tipo = 400; sem nada gravado, INCLUSO;
 *  - orçamento novo nasce com a regra da empresa; A_PARTE: serviço na base + cada material em linha de produto com o
 *    preço de venda (Material continua Material no snapshot); mudar a configuração NÃO altera o orçamento já criado,
 *    nem ao editar; o novo nasce com a regra nova;
 *  - Gerar OS copia a regra e os valores; OS sem orçamento fixa a regra no 1º item com materiais (e não muda mais);
 *  - faturar a OS: o material à parte vai como linha de PRODUTO, sem custo e sem baixa de estoque;
 *  - documento (link/PDF do cliente): os materiais com valor, sem a lista "dentro do serviço"; no INCLUSO, a lista.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-e2-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_e2_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@ficticio.test`, empresaId, role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const config = (corpo: unknown) => chamar("configuracoes", "PUT", corpo);
const padrao = (qs: string) => chamar("orcamentos/materiais-padrao", "GET", undefined, {}, `http://localhost/api/orcamentos/materiais-padrao?${qs}`);
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/\s+/g, " ").trim();

describe.skipIf(!URL_PG)("Orçamento E2 — regra de materiais por empresa (PostgreSQL real)", () => {
  let prisma: any;
  const ids: Record<string, string> = {};
  let seq = 0;
  const regraDaEmpresa = async () => (await prisma.configuracao.findUnique({ where: { empresaId: "e1" }, select: { orcamentoCobrancaMateriais: true } })).orcamentoCobrancaMateriais;
  // Instalação (800) com o kit: tubo 3→5 (20/un), filtro 1 (35), suporte 1 (60); capacitor (Peça) 1 × 80
  async function criarOrcamento() {
    const { materiais } = (await padrao("servicoId=sInst&clienteId=c1")).json;
    return chamar("orcamentos", "POST", {
      clienteId: "c1", servicos: [{ catalogoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: materiais.map((m: any) => ({ ...m, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade })) }],
      produtos: [{ catalogoId: "fita", descricao: "Fita", quantidade: 1, valorUnitario: 15 }],
    });
  }
  const linhasProduto = async (id: string) => (await chamar("orcamentos/[id]", "GET", undefined, { id })).json.produtos.map((p: any) => [p.descricao, Number(p.quantidade), Number(p.valorTotal), !!p.materialId]);
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSA-${++seq}`, clienteId: "c1", criadoPorId: "u1", status: "ABERTA", origem: "MANUAL", descricao: "OS avulsa", ...dados } });
  const itemOs = (osId: string, corpo: unknown) => chamar("ordens/[id]/orcamento", "POST", corpo, { id: osId });
  const imprimir = async (token: string) => {
    const { default: Imprimir } = await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    return renderToStaticMarkup(await Imprimir({ params: Promise.resolve({ token }) }) as any);
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["configuracoes", "orcamentos", "orcamentos/[id]", "orcamentos/materiais-padrao", "orcamentos/[id]/gerar-os", "ordens/[id]/orcamento", "ordens/[id]/orcamento/catalogo"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Refrigeração Fictícia", cnpj: "12345678000190", email: "e@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "o@ficticio.test" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@ficticio.test", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@ficticio.test", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.configuracao.create({ data: { empresaId: "e2" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Padaria Fictícia", cpfCnpj: "22101333000111" } });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Fictício", cpf: "11122233344", telefone: "11999990000" } });
    const p = (id: string, nome: string, uso: string, valorPadrao: number) => prisma.produto.create({ data: { id, empresaId: "e1", nome, unidade: "un", valorPadrao, saldo: 10, uso } });
    await p("tubo", "Tubo de cobre 1/4", "MATERIAL", 20); await p("filtro", "Filtro secador", "MATERIAL", 35); await p("suporte", "Suporte", "MATERIAL", 60);
    await p("cap", "Capacitor 35uF", "PECA", 80); await p("fita", "Fita", "MATERIAL", 15);
    const mov = (produtoId: string, custo: number) => prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: custo } });
    await mov("tubo", 12); await mov("filtro", 20); await mov("cap", 45);
    const kit = await prisma.kitMaterial.create({ data: { empresaId: "e1", nome: "Kit instalação", itens: { create: [{ produtoId: "tubo", quantidade: 3, ordem: 0 }, { produtoId: "filtro", quantidade: 1, ordem: 1 }] } } });
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800, materiais: { create: [{ kitId: kit.id, quantidade: 1, ordem: 0 }, { produtoId: "suporte", quantidade: 1, ordem: 1 }, { produtoId: "cap", quantidade: 1, ordem: 2 }] } } });
    logar();
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("Configurações: sem nada gravado = INCLUSO; PUT grava a regra só da empresa; valor fora do tipo = 400", async () => {
    expect(await regraDaEmpresa()).toBe("INCLUSO");
    // Incluso (o de hoje) primeiro: um orçamento nasce INCLUSO
    const r = await criarOrcamento();
    expect(r.status).toBe(201);
    ids.orcIncluso = r.json.id;
    expect(await config({ orcamentoCobrancaMateriais: "GRATIS" })).toMatchObject({ status: 400 });
    expect(await config({ orcamentoCobrancaMateriais: "a_parte" })).toMatchObject({ status: 400 });
    expect(await regraDaEmpresa()).toBe("INCLUSO");
    const ok = await config({ orcamentoCobrancaMateriais: "A_PARTE" });
    expect(ok.status).toBe(200);
    expect(ok.json.orcamentoCobrancaMateriais).toBe("A_PARTE");
    expect(await regraDaEmpresa()).toBe("A_PARTE");
    // a outra empresa não muda
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e2" } })).orcamentoCobrancaMateriais).toBe("INCLUSO");
    // e o campo antigo não foi reaproveitado: mandar a regra não mexe nele, e mandá-lo não mexe na regra
    const antigo = (await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).orcamentoMostrarValoresMateriais;
    expect((await config({ orcamentoCobrancaMateriais: "A_PARTE", orcamentoMostrarValoresMateriais: !antigo })).status).toBe(200);
    const depois = await prisma.configuracao.findUnique({ where: { empresaId: "e1" } });
    expect([depois.orcamentoMostrarValoresMateriais, depois.orcamentoCobrancaMateriais]).toEqual([antigo, "A_PARTE"]);
  });

  it("INCLUSO: o orçamento que nasceu antes fica como no Orçamento E (serviço ajustado, só a Peça à parte)", async () => {
    const o = await prisma.orcamento.findUnique({ where: { id: ids.orcIncluso } });
    expect(o.cobrancaMateriais).toBe("INCLUSO");
    expect([Number(o.totalServicos), Number(o.totalProdutos), Number(o.totalGeral)]).toEqual([840, 95, 935]);
    expect(await linhasProduto(ids.orcIncluso)).toEqual([["Fita", 1, 15, false], ["Capacitor 35uF", 1, 80, true]]);
  });

  it("A_PARTE: nasce com a regra; serviço na base; cada material vira linha com o preço de venda e soma no total; o snapshot continua Material", async () => {
    const r = await criarOrcamento();
    expect(r.status).toBe(201);
    ids.orcAParte = r.json.id;
    ids.tokenAParte = r.json.tokenPublico;
    expect(r.json).toMatchObject({ cobrancaMateriais: "A_PARTE", totalServicos: "800", totalProdutos: "290", totalGeral: "1090" });
    const g = await chamar("orcamentos/[id]", "GET", undefined, { id: ids.orcAParte });
    expect(g.json.servicos[0]).toMatchObject({ valorBase: "800", ajusteMateriais: "0", valorTotal: "800" });
    expect(await linhasProduto(ids.orcAParte)).toEqual([
      ["Fita", 1, 15, false], ["Tubo de cobre 1/4", 5, 100, true], ["Filtro secador", 1, 35, true], ["Suporte", 1, 60, true], ["Capacitor 35uF", 1, 80, true],
    ]);
    expect(g.json.servicos[0].materiais.map((m: any) => [m.produtoId, m.comportamento])).toEqual([
      ["tubo", "INCLUSO_NO_SERVICO"], ["filtro", "INCLUSO_NO_SERVICO"], ["suporte", "INCLUSO_NO_SERVICO"], ["cap", "VENDA_A_PARTE"],
    ]);
  });

  it("mudar a configuração não altera o orçamento já criado — nem ao editar; o novo nasce com a regra nova", async () => {
    expect((await config({ orcamentoCobrancaMateriais: "INCLUSO" })).status).toBe(200);
    // o A_PARTE continua A_PARTE, com os mesmos valores
    const antes = await prisma.orcamento.findUnique({ where: { id: ids.orcAParte } });
    expect([antes.cobrancaMateriais, Number(antes.totalGeral)]).toEqual(["A_PARTE", 1090]);
    // editar (reenvia os mesmos itens): segue a regra com que nasceu
    const g = (await chamar("orcamentos/[id]", "GET", undefined, { id: ids.orcAParte })).json;
    const mats = g.servicos[0].materiais.map((m: any) => ({ ...m, id: undefined, orcamentoId: undefined, orcamentoServicoId: undefined, ordem: undefined, quantidade: Number(m.quantidade), quantidadePadrao: Number(m.quantidadePadrao), valorVendaUnit: Number(m.valorVendaUnit), custoUnit: m.custoUnit == null ? null : Number(m.custoUnit) }));
    const e = await chamar("orcamentos/[id]", "PUT", {
      clienteId: "c1", servicos: [{ catalogoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: mats }],
      produtos: [{ catalogoId: "fita", descricao: "Fita", quantidade: 1, valorUnitario: 15 }],
    }, { id: ids.orcAParte });
    expect(e.json?.erro ?? e.status).toBe(200);
    expect(e.json).toMatchObject({ cobrancaMateriais: "A_PARTE", totalServicos: "800", totalProdutos: "290", totalGeral: "1090" });
    // nem o PUT aceita trocar a regra do orçamento por fora
    await chamar("orcamentos/[id]", "PUT", { clienteId: "c1", cobrancaMateriais: "INCLUSO", servicos: [{ catalogoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: mats }], produtos: [] }, { id: ids.orcAParte });
    expect((await prisma.orcamento.findUnique({ where: { id: ids.orcAParte } })).cobrancaMateriais).toBe("A_PARTE");
    // o novo nasce INCLUSO
    const novo = await criarOrcamento();
    expect(novo.json).toMatchObject({ cobrancaMateriais: "INCLUSO", totalGeral: "935" });
    expect((await config({ orcamentoCobrancaMateriais: "A_PARTE" })).status).toBe(200);
  });

  it("Gerar OS copia a regra e os valores; faturar leva o material à parte como PRODUTO, sem custo e sem baixa", async () => {
    // reenviar o orçamento à parte inteiro (o PUT acima sem a fita): recria com fita
    const r = await criarOrcamento();
    expect(r.json.cobrancaMateriais).toBe("A_PARTE");
    await prisma.orcamento.update({ where: { id: r.json.id }, data: { status: "APROVADO" } });
    // aprovado: mudar a configuração não mexe nele
    expect((await config({ orcamentoCobrancaMateriais: "INCLUSO" })).status).toBe(200);
    const mod = await import("@/app/api/orcamentos/[id]/gerar-os/route");
    const res = await mod.POST(new NextRequest("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } }) }), { params: Promise.resolve({ id: r.json.id }) });
    expect(res.status).toBeLessThan(300);
    const os = await prisma.ordemServico.findFirst({ where: { orcamentoOrigemId: r.json.id }, include: { itensOrcamento: { orderBy: { ordem: "asc" } } } });
    expect(os.cobrancaMateriais).toBe("A_PARTE");
    expect(os.itensOrcamento.map((i: any) => [i.tipo, i.descricao, Number(i.valorTotal), !!i.materialId])).toEqual([
      ["SERVICO", "Instalação split", 800, false], ["PRODUTO", "Fita", 15, false], ["PRODUTO", "Tubo de cobre 1/4", 100, true],
      ["PRODUTO", "Filtro secador", 35, true], ["PRODUTO", "Suporte", 60, true], ["PRODUTO", "Capacitor 35uF", 80, true],
    ]);
    for (const i of os.itensOrcamento) await prisma.osItemOrcamento.update({ where: { id: i.id }, data: { executado: true } });
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CONCLUIDA", dataConclusao: new Date() } });
    const { faturarOs } = await import("@/lib/faturamento/faturar-server");
    expect((await faturarOs({ empresaId: "e1", usuarioId: "u1", osId: os.id })).tipo).toBe("criada");
    const medicao = await prisma.medicao.findFirst({ where: { empresaId: "e1" }, orderBy: { criadoEm: "desc" }, include: { itens: true } });
    expect(medicao.itens.map((l: any) => [l.tipo, l.descricao, Number(l.valorTotal), l.produtoId ?? null])).toEqual(expect.arrayContaining([
      ["SERVICO", "Instalação split", 800, null], ["PRODUTO", "Tubo de cobre 1/4", 100, "tubo"], ["PRODUTO", "Suporte", 60, "suporte"], ["PRODUTO", "Capacitor 35uF", 80, "cap"],
    ]));
    expect(Number(medicao.valorTotal)).toBe(1090);
    expect(JSON.stringify(medicao)).not.toMatch(/custo/i);
    expect(Number((await prisma.produto.findUnique({ where: { id: "tubo" } })).saldo)).toBe(10);
  });

  it("OS sem orçamento: a regra é fixada no 1º item com materiais e não muda com a configuração", async () => {
    expect((await config({ orcamentoCobrancaMateriais: "A_PARTE" })).status).toBe(200);
    const os = await novaOs();
    // item sem materiais não fixa
    expect((await itemOs(os.id, { tipo: "PRODUTO", produtoId: "fita", descricao: "Fita", quantidade: 1, valorUnitario: 15 })).status).toBeLessThan(300);
    expect((await prisma.ordemServico.findUnique({ where: { id: os.id } })).cobrancaMateriais).toBeNull();
    const { materiais } = (await chamar("ordens/[id]/orcamento/catalogo", "GET", undefined, { id: os.id }, "http://localhost/x?servicoId=sInst")).json;
    const it1 = await itemOs(os.id, { tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais });
    expect(it1.status).toBeLessThan(300);
    expect(Number(it1.json.valorTotal)).toBe(800);
    expect(it1.json.pecas.map((p: any) => [p.descricao, Number(p.valorTotal)])).toEqual([["Tubo de cobre 1/4", 60], ["Filtro secador", 35], ["Suporte", 60], ["Capacitor 35uF", 80]]);
    expect((await prisma.ordemServico.findUnique({ where: { id: os.id } })).cobrancaMateriais).toBe("A_PARTE");
    // a empresa muda para INCLUSO: o 2º item da mesma OS continua à parte
    expect((await config({ orcamentoCobrancaMateriais: "INCLUSO" })).status).toBe(200);
    const it2 = await itemOs(os.id, { tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais });
    expect([Number(it2.json.valorTotal), it2.json.pecas.length]).toEqual([800, 4]);
    expect((await prisma.ordemServico.findUnique({ where: { id: os.id } })).cobrancaMateriais).toBe("A_PARTE");
    // OS nova já nasce na regra nova (INCLUSO): serviço ajustado só com a Peça à parte
    const os2 = await novaOs();
    const it3 = await itemOs(os2.id, { tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais });
    expect([Number(it3.json.valorTotal), it3.json.pecas.map((p: any) => p.descricao)]).toEqual([800, ["Capacitor 35uF"]]);
    expect((await prisma.ordemServico.findUnique({ where: { id: os2.id } })).cobrancaMateriais).toBe("INCLUSO");
  });

  it("documento do cliente (link e PDF): à parte, os materiais saem com valor e sem a lista dentro do serviço; incluso, a lista sem valor", async () => {
    const aParte = await imprimir(ids.tokenAParte);
    const t = texto(aParte);
    expect(aParte).not.toContain("data-materiais-servico");
    expect(t).toMatch(/Tubo de cobre 1\/4 .*100,00/);
    // (a última edição deste orçamento tirou a Fita: 800 + 100 + 35 + 60 + 80)
    expect(t).toMatch(/Total geral R\$ 1\.075,00/);
    const tokenIncluso = (await prisma.orcamento.findUnique({ where: { id: ids.orcIncluso }, select: { tokenPublico: true } })).tokenPublico;
    const incluso = await imprimir(tokenIncluso);
    expect(incluso).toContain("data-materiais-servico");
    expect(texto(incluso)).toMatch(/Total geral R\$ 935,00/);
    expect(texto(incluso)).not.toMatch(/Tubo de cobre 1\/4 .*100,00/);
  });
});
