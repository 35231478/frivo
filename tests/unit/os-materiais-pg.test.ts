/**
 * Estoque E3.3b — materiais e peças na OS sem orçamento, com o Prisma real num PostgreSQL real:
 *  - catálogo para a OS (preço da tabela do cliente ou padrão; serviço com composição vem com o kit explodido);
 *  - POST do item: serviço com materiais = snapshot + peça derivada (item PRODUTO com material_id), valores base/ajuste/
 *    manual; PUT regrava (materiais e peças); DELETE em cascata; peça derivada não se edita/apaga sozinha;
 *  - linha livre antiga (descrição/qtd/unitário) continua igual; item antigo intacto; marcar executado como sempre;
 *  - snapshot imune ao cadastro; produto/serviço de outra empresa = 400; OS de outra empresa = 404;
 *  - OS gerada do orçamento: mesmos valores de antes + o snapshot copiado (só leitura na OS);
 *  - faturar a OS: serviço ajustado + peça como linha de PRODUTO; sem custo; sem baixa de estoque.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-materiais-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_materiais_${process.pid}`;
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
const itens = (osId: string) => ({
  criar: (corpo: unknown) => chamar("ordens/[id]/orcamento", "POST", corpo, { id: osId }),
  editar: (itemId: string, corpo: unknown) => chamar("ordens/[id]/orcamento/[itemId]", "PUT", corpo, { id: osId, itemId }),
  apagar: (itemId: string) => chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: osId, itemId }),
  catalogo: (qs: string) => chamar("ordens/[id]/orcamento/catalogo", "GET", undefined, { id: osId }, `http://localhost/x?${qs}`),
});

describe.skipIf(!URL_PG)("Materiais e peças na OS sem orçamento (PostgreSQL real)", () => {
  let prisma: any;
  const ids: Record<string, string> = {};
  let seq = 0;
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSA-${++seq}`, clienteId: "c1", criadoPorId: "u1", status: "ABERTA", origem: "MANUAL", descricao: "OS avulsa", ...dados } });
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens/[id]/orcamento", "ordens/[id]/orcamento/[itemId]", "ordens/[id]/orcamento/catalogo", "orcamentos", "orcamentos/[id]/gerar-os", "orcamentos/materiais-padrao"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } }).catch(() => {});
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "cTab", empresaId: "e1", nome: "Com tabela", cpfCnpj: "22101333000122" },
      { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    const pecas = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Peças", comportamento: "VENDA_A_PARTE" } });
    const mat = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO" } });
    const p = async (id: string, nome: string, unidade: string, cat: string | null, valorPadrao: number, empresaId = "e1") =>
      prisma.produto.create({ data: { id, empresaId, nome, unidade, categoriaProdutoId: cat, valorPadrao, saldo: 10 } });
    await p("tubo", "Tubo de cobre 1/4", "m", mat.id, 20); await p("filtro", "Filtro secador", "un", mat.id, 35); await p("suporte", "Suporte", "un", null, 60);
    await p("cap", "Capacitor 35uF", "un", pecas.id, 80); await p("fita", "Fita", "un", null, 15); await p("outro", "Da outra", "un", null, 9, "e2");
    const mov = (produtoId: string, custo: number) => prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: custo } });
    await mov("tubo", 12); await mov("filtro", 20); await mov("cap", 45);
    const kit = await prisma.kitMaterial.create({ data: { empresaId: "e1", nome: "Kit instalação", itens: { create: [{ produtoId: "tubo", quantidade: 3, ordem: 0 }, { produtoId: "filtro", quantidade: 1, ordem: 1 }] } } });
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800, materiais: { create: [{ kitId: kit.id, quantidade: 1, ordem: 0 }, { produtoId: "suporte", quantidade: 1, ordem: 1 }, { produtoId: "cap", quantidade: 1, ordem: 2 }] } } });
    await prisma.servico.create({ data: { id: "sLimp", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza", valorPadrao: 150 } });
    await prisma.servico.create({ data: { id: "sOutra", empresaId: "e2", codigo: "X01", nome: "Da outra", valorPadrao: 1 } });
    const tabela = await prisma.tabelaPreco.create({ data: { empresaId: "e1", nome: "Contrato", itens: { create: [{ servicoId: "sInst", tipoPreco: "VALOR_FIXO", valorFixo: 700, valorFinal: 700 }, { produtoId: "cap", tipoPreco: "VALOR_FIXO", valorFixo: 99, valorFinal: 99 }] } } });
    await prisma.cliente.update({ where: { id: "cTab" }, data: { tabelaPrecoId: tabela.id } });
    ids.os = (await novaOs()).id;
    ids.osTab = (await novaOs({ clienteId: "cTab" })).id;
    ids.osOutra = (await prisma.ordemServico.create({ data: { empresaId: "e2", numero: "OS-X", clienteId: "c9", criadoPorId: "u2", status: "ABERTA", origem: "MANUAL", descricao: "x" } })).id;
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("catálogo para a OS: serviço com a composição materializada (kit explodido) e o preço do cliente (tabela 700 / padrão 800); produto; outra empresa 404; OS de outra 404", async () => {
    const r = await itens(ids.os).catalogo("servicoId=sInst");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", valorUnitario: 800, origemPreco: "padrao" });
    expect(r.json.materiais.map((m: any) => [m.produtoId, m.quantidade, m.quantidadePadrao, m.valorVendaUnit, m.custoUnit, m.origem, m.comportamento]))
      .toEqual([["tubo", 3, 3, 20, 12, "KIT", "INCLUSO_NO_SERVICO"], ["filtro", 1, 1, 35, 20, "KIT", "INCLUSO_NO_SERVICO"], ["suporte", 1, 1, 60, null, "SOLTO", "INCLUSO_NO_SERVICO"], ["cap", 1, 1, 80, 45, "SOLTO", "VENDA_A_PARTE"]]);
    const t = await itens(ids.osTab).catalogo("servicoId=sInst");
    expect(t.json).toMatchObject({ valorUnitario: 700, origemPreco: "contrato" });
    expect(t.json.materiais.find((m: any) => m.produtoId === "cap").valorVendaUnit).toBe(99);
    expect((await itens(ids.os).catalogo("servicoId=sLimp")).json).toMatchObject({ valorUnitario: 150, materiais: [] });
    expect((await itens(ids.os).catalogo("produtoId=fita")).json).toMatchObject({ tipo: "PRODUTO", produtoId: "fita", descricao: "Fita", valorUnitario: 15, material: { comportamento: "INCLUSO_NO_SERVICO", quantidadePadrao: 0 } });
    expect((await itens(ids.os).catalogo("servicoId=sOutra")).status).toBe(404);
    expect((await itens(ids.os).catalogo("produtoId=outro")).status).toBe(404);
    expect((await itens(ids.osOutra).catalogo("servicoId=sInst")).status).toBe(404);
    logar(montarPermissoes({ ordens: ["visualizar"] }));
    expect((await itens(ids.os).catalogo("servicoId=sInst")).status).toBe(403);
    logar();
  });

  it("POST serviço com materiais: snapshot gravado, item = base + ajuste, peça como item PRODUTO derivado; PUT regrava; DELETE em cascata; peça derivada protegida", async () => {
    const { materiais } = (await itens(ids.os).catalogo("servicoId=sInst")).json;
    // Tubo 3→5 (+40), filtro 1→3 (+70), suporte 1→10 (+540); capacitor 1→2 (peça 160 à parte)
    const editados = materiais.map((m: any) => ({ ...m, quantidade: { tubo: 5, filtro: 3, suporte: 10, cap: 2 }[m.produtoId as string] }));
    const r = await itens(ids.os).criar({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: editados });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ tipo: "SERVICO", servicoId: "sInst", valorBase: "800", ajusteMateriais: "650", valorManual: false, valorTotal: "1450", valorUnitario: "1450", ordem: 0 });
    expect(r.json.materiais.map((m: any) => [m.produtoId, Number(m.quantidade), Number(m.quantidadePadrao), m.origem, m.kitNome, m.ordem])).toEqual([["tubo", 5, 3, "KIT", "Kit instalação", 0], ["filtro", 3, 1, "KIT", "Kit instalação", 1], ["suporte", 10, 1, "SOLTO", null, 2], ["cap", 2, 1, "SOLTO", null, 3]]);
    expect(r.json.pecas).toHaveLength(1);
    expect(r.json.pecas[0]).toMatchObject({ tipo: "PRODUTO", produtoId: "cap", descricao: "Capacitor 35uF", quantidade: "2", valorUnitario: "80", valorTotal: "160", ordem: 1 });
    expect(r.json.pecas[0].materialId).toBe(r.json.materiais[3].id);
    ids.item = r.json.id; ids.peca = r.json.pecas[0].id;
    const na = async () => prisma.osItemOrcamento.findMany({ where: { ordemServicoId: ids.os }, orderBy: { ordem: "asc" } });
    expect((await na()).map((i: any) => [i.tipo, Number(i.valorTotal)])).toEqual([["SERVICO", 1450], ["PRODUTO", 160]]);
    expect(await prisma.osMaterial.count({ where: { ordemServicoId: ids.os } })).toBe(4);
    // Peça derivada: não se edita nem apaga sozinha
    expect((await itens(ids.os).editar(ids.peca, { quantidade: 5 })).status).toBe(400);
    expect((await itens(ids.os).apagar(ids.peca)).status).toBe(400);
    // PUT: tubo volta ao padrão, capacitor não usado (0) → sem peça; o unitário é o base
    const g = r.json.materiais.map((m: any) => ({ produtoId: m.produtoId, descricao: m.descricao, unidade: m.unidade, comportamento: m.comportamento, quantidade: m.produtoId === "tubo" ? 3 : m.produtoId === "cap" ? 0 : Number(m.quantidade), quantidadePadrao: Number(m.quantidadePadrao), valorVendaUnit: Number(m.valorVendaUnit), custoUnit: m.custoUnit == null ? null : Number(m.custoUnit), origem: m.origem, kitNome: m.kitNome }));
    const e = await itens(ids.os).editar(ids.item, { quantidade: 1, valorUnitario: 800, materiais: g });
    expect(e.json?.erro ?? e.status).toBe(200);
    expect(e.json).toMatchObject({ ajusteMateriais: "610", valorTotal: "1410", pecas: [] });
    expect((await na()).map((i: any) => [i.tipo, Number(i.valorTotal)])).toEqual([["SERVICO", 1410]]);
    expect(await prisma.osMaterial.count({ where: { osItemId: ids.item } })).toBe(4);
    // Valor manual
    const man = await itens(ids.os).editar(ids.item, { quantidade: 1, valorUnitario: 800, valorTotal: 1000, valorManual: true, materiais: g });
    expect(man.json).toMatchObject({ valorManual: true, valorTotal: "1000", valorUnitario: "1000", valorBase: "800" });
    // Tipo/catálogo não mudam pela edição
    expect((await itens(ids.os).editar(ids.item, { tipo: "PRODUTO", produtoId: "fita", quantidade: 1, valorUnitario: 1 })).status).toBe(400);
    // Peça de volta e DELETE do serviço: materiais e peça caem juntos
    await itens(ids.os).editar(ids.item, { quantidade: 1, valorUnitario: 800, materiais: g.map((m: any) => (m.produtoId === "cap" ? { ...m, quantidade: 1 } : m)) });
    expect(await prisma.osItemOrcamento.count({ where: { ordemServicoId: ids.os } })).toBe(2);
    expect((await itens(ids.os).apagar(ids.item)).status).toBe(200);
    expect(await prisma.osItemOrcamento.count({ where: { ordemServicoId: ids.os } })).toBe(0);
    expect(await prisma.osMaterial.count({ where: { ordemServicoId: ids.os } })).toBe(0);
  });

  it("linha livre antiga continua igual; item antigo intacto; produto do catálogo é item PRODUTO; marcar executado como sempre; multiempresa; snapshot imune ao cadastro", async () => {
    const livre = await itens(ids.os).criar({ descricao: "Deslocamento", quantidade: 2, valorUnitario: 50 });
    expect(livre.status).toBe(201);
    expect(livre.json).toMatchObject({ tipo: "SERVICO", servicoId: null, produtoId: null, valorTotal: "100", valorBase: null, ajusteMateriais: "0", valorManual: false, materiais: [], pecas: [] });
    const antigo = await prisma.osItemOrcamento.create({ data: { ordemServicoId: ids.os, descricao: "Antigo", quantidade: 1, valorUnitario: 300, valorTotal: 300 } });
    expect(antigo).toMatchObject({ tipo: "SERVICO", valorBase: null, materialId: null, ordem: 0 });
    const prod = await itens(ids.os).criar({ tipo: "PRODUTO", produtoId: "fita", descricao: "Fita", quantidade: 3, valorUnitario: 15, materiais: [{ produtoId: "tubo", descricao: "x", comportamento: "INCLUSO_NO_SERVICO", quantidade: 1, quantidadePadrao: 0, valorVendaUnit: 1, custoUnit: null, origem: "AVULSO" }] });
    expect(prod.status).toBe(201);
    expect(prod.json).toMatchObject({ tipo: "PRODUTO", produtoId: "fita", valorTotal: "45", materiais: [], pecas: [] }); // produto nunca leva materiais
    expect((await itens(ids.os).editar(livre.json.id, { executado: true })).json).toMatchObject({ executado: true });
    expect((await itens(ids.os).editar(livre.json.id, { quantidade: 3 })).status).toBe(400); // executado não muda
    // Multiempresa
    expect((await itens(ids.os).criar({ tipo: "SERVICO", servicoId: "sOutra", descricao: "x", quantidade: 1, valorUnitario: 1 })).json).toEqual({ erro: "Serviço do catálogo inválido(a)." });
    expect((await itens(ids.os).criar({ tipo: "PRODUTO", produtoId: "outro", descricao: "x", quantidade: 1, valorUnitario: 1 })).json).toEqual({ erro: "Produto do catálogo inválido(a)." });
    expect((await itens(ids.os).criar({ descricao: "x", quantidade: 1, valorUnitario: 1, materiais: [{ produtoId: "outro", descricao: "x", comportamento: "INCLUSO_NO_SERVICO", quantidade: 1, quantidadePadrao: 0, valorVendaUnit: 1, origem: "AVULSO" }] })).json).toEqual({ erro: "Produto do material inválido(a)." });
    expect((await itens(ids.os).criar({ descricao: "x", quantidade: 1, valorUnitario: 1, materiais: [{ produtoId: "tubo", descricao: "x", comportamento: "GRATIS", quantidade: 1, quantidadePadrao: 0, valorVendaUnit: 1, origem: "AVULSO" }] })).status).toBe(400);
    expect((await itens(ids.os).criar({ descricao: "x", quantidade: 1, valorUnitario: 1, empresaId: "e2" })).status).toBe(400);
    expect((await itens(ids.osOutra).criar({ descricao: "x", quantidade: 1, valorUnitario: 1 })).status).toBe(404);
    logar(permissoesTotais(), "e2");
    expect((await itens(ids.os).criar({ descricao: "x", quantidade: 1, valorUnitario: 1 })).status).toBe(404);
    expect((await itens(ids.os).apagar(livre.json.id)).status).toBe(404);
    logar();
    // Snapshot imune: muda preço, categoria e kit depois; o item da OS não muda
    const { materiais } = (await itens(ids.os).catalogo("servicoId=sInst")).json;
    const serv = await itens(ids.os).criar({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação", quantidade: 1, valorUnitario: 800, materiais: materiais.map((m: any) => ({ ...m, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade })) });
    await prisma.produto.update({ where: { id: "tubo" }, data: { valorPadrao: 999, categoriaProdutoId: (await prisma.categoriaProduto.findFirst({ where: { nome: "Peças" } })).id } });
    await prisma.kitMaterialItem.deleteMany({ where: { produtoId: "tubo" } });
    const depois = await prisma.osItemOrcamento.findUnique({ where: { id: serv.json.id }, include: { materiais: { orderBy: { ordem: "asc" } } } });
    expect(Number(depois.valorTotal)).toBe(840);
    expect([depois.materiais[0].produtoId, Number(depois.materiais[0].valorVendaUnit), depois.materiais[0].comportamento, Number(depois.materiais[0].quantidade)]).toEqual(["tubo", 20, "INCLUSO_NO_SERVICO", 5]);
    await prisma.produto.update({ where: { id: "tubo" }, data: { valorPadrao: 20, categoriaProdutoId: (await prisma.categoriaProduto.findFirst({ where: { nome: "Materiais" } })).id } });
    await prisma.kitMaterialItem.create({ data: { kitId: (await prisma.kitMaterial.findFirst()).id, produtoId: "tubo", quantidade: 3, ordem: 0 } });
    // Sem baixa de estoque
    expect(Number((await prisma.produto.findUnique({ where: { id: "tubo" } })).saldo)).toBe(10);
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: { not: "ENTRADA" } } })).toBe(0);
  });

  it("OS gerada do orçamento: os mesmos valores + o snapshot copiado (só leitura); faturar a OS leva serviço ajustado e a peça como PRODUTO", async () => {
    const { materiais } = (await chamar("orcamentos/materiais-padrao", "GET", undefined, {}, "http://localhost/x?servicoId=sInst&clienteId=c1")).json;
    const orc = await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [{ catalogoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: materiais.map((m: any) => ({ ...m, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade })) }], produtos: [{ catalogoId: "fita", descricao: "Fita", quantidade: 1, valorUnitario: 15 }] });
    expect(orc.status).toBe(201);
    await prisma.orcamento.update({ where: { id: orc.json.id }, data: { status: "APROVADO" } });
    const mod = await import("@/app/api/orcamentos/[id]/gerar-os/route");
    const res = await mod.POST(new NextRequest("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } }) }), { params: Promise.resolve({ id: orc.json.id }) });
    expect(res.status).toBeLessThan(300);
    const os = await prisma.ordemServico.findFirst({ where: { orcamentoOrigemId: orc.json.id }, include: { itensOrcamento: { orderBy: { ordem: "asc" }, include: { materiais: { orderBy: { ordem: "asc" } }, material: true } } } });
    // Valores idênticos aos de antes da leva: serviço 840 (ajustado), produtos como vieram
    expect(os.itensOrcamento.map((i: any) => [i.tipo, i.descricao, Number(i.valorTotal), !!i.orcamentoServicoId, i.servicoId, i.produtoId, i.materiais.length, !!i.materialId]))
      .toEqual([["SERVICO", "Instalação split", 840, true, "sInst", null, 4, false], ["PRODUTO", "Fita", 15, false, null, "fita", 0, false], ["PRODUTO", "Capacitor 35uF", 80, false, null, "cap", 0, true]]);
    expect([Number(os.itensOrcamento[0].valorBase), Number(os.itensOrcamento[0].ajusteMateriais), os.itensOrcamento[0].valorManual]).toEqual([800, 40, false]);
    expect(os.itensOrcamento[2].material.osItemId).toBe(os.itensOrcamento[0].id); // a peça aponta para o material copiado na OS
    // Item do orçamento é só leitura na OS
    expect((await itens(os.id).editar(os.itensOrcamento[0].id, { quantidade: 2, valorUnitario: 800 })).json.erro).toMatch(/veio do orçamento/);
    // Faturar: marca executados e fatura — serviço ajustado + peça como PRODUTO, sem custo
    for (const i of os.itensOrcamento) await prisma.osItemOrcamento.update({ where: { id: i.id }, data: { executado: true } });
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CONCLUIDA", dataConclusao: new Date() } });
    const { faturarOs } = await import("@/lib/faturamento/faturar-server");
    const f = await faturarOs({ empresaId: "e1", usuarioId: "u1", osId: os.id });
    expect(f.tipo).toBe("criada");
    const medicao = await prisma.medicao.findFirst({ where: { empresaId: "e1" }, orderBy: { criadoEm: "desc" }, include: { itens: { orderBy: { id: "asc" } } } });
    expect(medicao.itens.map((l: any) => [l.tipo, l.descricao, Number(l.valorTotal), l.servicoId ?? null, l.produtoId ?? null])).toEqual(expect.arrayContaining([
      ["SERVICO", "Instalação split", 840, "sInst", null], ["PRODUTO", "Fita", 15, null, "fita"], ["PRODUTO", "Capacitor 35uF", 80, null, "cap"],
    ]));
    expect(Number(medicao.valorTotal)).toBe(935);
    expect(JSON.stringify(medicao)).not.toMatch(/custo/i);
    // OS avulsa: o serviço com materiais fatura do mesmo jeito (serviço + peça PRODUTO)
    const os2 = await novaOs({ status: "CONCLUIDA", dataConclusao: new Date() });
    const { materiais: m2 } = (await itens(os2.id).catalogo("servicoId=sInst")).json;
    const it2 = await itens(os2.id).criar({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: m2 });
    for (const i of [it2.json, ...it2.json.pecas]) await prisma.osItemOrcamento.update({ where: { id: i.id }, data: { executado: true } });
    const f2 = await faturarOs({ empresaId: "e1", usuarioId: "u1", osId: os2.id });
    expect(f2.tipo).toBe("criada");
    const med2 = await prisma.medicao.findFirst({ where: { empresaId: "e1" }, orderBy: { criadoEm: "desc" }, include: { itens: true } });
    expect(med2.itens.map((l: any) => [l.tipo, Number(l.valorTotal), l.servicoId ?? null, l.produtoId ?? null])).toEqual(expect.arrayContaining([["SERVICO", 800, "sInst", null], ["PRODUTO", 80, null, "cap"]]));
    expect(Number((await prisma.produto.findUnique({ where: { id: "cap" } })).saldo)).toBe(10);
  });
});
