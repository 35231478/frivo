/**
 * Códigos + planilha de ida e volta — rotas reais com o Prisma num PostgreSQL real (índice único de
 * verdade, duas empresas):
 *  - produto novo ganha o próximo código da EMPRESA (maior + 1, buraco não repete; outra empresa não
 *    conta); serviço ganha "LIMP01"… pelo nome, ou o digitado (normalizado), único na empresa (409);
 *    editar o código do serviço; vazio mantém; a busca acha pelo código;
 *  - criar produtos ao mesmo tempo (fora e dentro de transação) não repete código;
 *  - baixar a planilha: permissão de ver o módulo; só a empresa da sessão; todas as linhas;
 *  - reupload da planilha baixada: casa por id_sistema/código/CNPJ — nome editado ATUALIZA (não
 *    duplica); linha apagada não apaga nada; linha nova cria com o próximo código; vários novos na
 *    mesma planilha ganham códigos seguidos; id de outra empresa e código inexistente = erro.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/codigos-exportacao-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { gerarXlsx, lerXlsx } from "@/lib/folha/planilha";
import { IMPORTACOES } from "@/lib/importacao/entidades";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_codigos_export_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "u1" : "u2", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const criar = (entidade: string, corpo: unknown) => chamar("cadastros/[entidade]", "POST", { entidade }, corpo);
const editar = (entidade: string, id: string, corpo: unknown) => chamar("cadastros/[entidade]/[id]", "PATCH", { entidade, id }, corpo);
const listar = (entidade: string, q: string) => chamar("cadastros/[entidade]", "GET", { entidade }, undefined, `http://localhost/api/cadastros/${entidade}?ativo=todos&q=${encodeURIComponent(q)}`);

async function baixar(entidade: string) {
  const mod = await import("@/app/api/importacao/[entidade]/exportar/route");
  const res: Response = await mod.GET(new Request("http://localhost/x"), { params: Promise.resolve({ entidade }) });
  const bruto = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  return { status: res.status, res, bruto: bruto?.toString("utf8") ?? "", tabela: bruto ? lerXlsx(bruto).map((l) => l.map((c) => (c == null ? "" : String(c)))) : null };
}
const arquivo = (linhas: string[][]) => new File([new Uint8Array(gerarXlsx([{ nome: "Dados", linhas }]))], "dados.xlsx");
async function importar(entidade: string, linhas: string[][], etapa: "previa" | "confirmar") {
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const fd = new FormData();
  fd.append("arquivo", arquivo(linhas));
  fd.append("etapa", etapa);
  const res: Response = await mod.POST(new NextRequest("http://localhost/x", { method: "POST", body: fd }), { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const col = (tabela: string[][], titulo: string) => tabela[0].indexOf(titulo);

describe.skipIf(!URL_PG)("Códigos e planilha de ida e volta (PostgreSQL real)", () => {
  let prisma: any;
  const produtos = (empresaId = "e1") => prisma.produto.findMany({ where: { empresaId }, orderBy: { codigo: "asc" } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["cadastros/[entidade]", "cadastros/[entidade]/[id]", "importacao/[entidade]", "importacao/[entidade]/exportar"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    // Produtos já com código (como depois do SQL de backfill); a outra empresa tem códigos altos
    await prisma.produto.createMany({ data: [
      { id: "p1", empresaId: "e1", codigo: 1, nome: "Gás R410A", unidade: "kg", valorPadrao: 800 },
      { id: "p5", empresaId: "e1", codigo: 5, nome: "Filtro", unidade: "un", ativo: false },
      { id: "pB", empresaId: "e2", codigo: 900, nome: "Da outra", unidade: "un" },
    ] });
    await prisma.servico.createMany({ data: [
      { id: "s1", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza de Filtro", unidade: "un", valorPadrao: 80 },
      { id: "sB", empresaId: "e2", codigo: "LIMP05", nome: "Limpeza da outra", unidade: "un" },
    ] });
    await prisma.fornecedor.createMany({ data: [
      { id: "fSemDoc", empresaId: "e1", nome: "Posto Ipiranga" },
      { id: "fB", empresaId: "e2", nome: "Da outra", documento: "11444777000161" },
    ] });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(() => logar());

  it("produto novo: o próximo código da EMPRESA (maior + 1; a outra empresa não conta; não vem do corpo)", async () => {
    const r = await criar("produtos", { nome: "Capacitor 35uF", unidade: "un" });
    expect(r.status).toBe(201);
    expect(r.json.codigo).toBe(6);
    expect((await criar("produtos", { nome: "Contactor", codigo: 50 })).status).toBe(400); // código não entra pelo corpo
    logar(permissoesTotais(), "e2");
    expect((await criar("produtos", { nome: "Outro da outra" })).json.codigo).toBe(901);
  });

  it("criar produtos ao mesmo tempo não repete código (fora e dentro de transação)", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => criar("produtos", { nome: `Paralelo ${i}` })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const cods = rs.map((r) => r.json.codigo).sort((a, b) => a - b);
    expect(new Set(cods).size).toBe(8);
    const { criarProdutoComCodigo } = await import("@/lib/cadastros/codigos-server");
    const emTx = await Promise.all(Array.from({ length: 4 }, (_, i) => prisma.$transaction((tx: any) =>
      criarProdutoComCodigo("e1", (codigo) => tx.produto.create({ data: { empresaId: "e1", codigo, nome: `TX ${i}` } }), tx))));
    expect(new Set(emTx.map((p: any) => p.codigo)).size).toBe(4);
    const todos = (await produtos()).map((p: any) => p.codigo);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("serviço: código pelo nome (LIMP02…), digitado normalizado, único na empresa (409), outra empresa pode", async () => {
    expect((await criar("servicos", { nome: "Limpeza química" })).json.codigo).toBe("LIMP02");
    expect((await criar("servicos", { nome: "Manutenção preventiva" })).json.codigo).toBe("MANU01");
    expect((await criar("servicos", { nome: "Higienização", codigo: " higi 10 " })).json.codigo).toBe("HIGI10");
    const dup = await criar("servicos", { nome: "Outra limpeza", codigo: "limp01" });
    expect(dup).toMatchObject({ status: 409, json: { erro: "O código LIMP01 já é do serviço “Limpeza de Filtro”. Escolha outro." } });
    expect((await criar("servicos", { nome: "X", codigo: "LIMP-9" })).status).toBe(400);
    // LIMP05 é da outra empresa: aqui pode
    expect((await criar("servicos", { nome: "Limpeza de dreno", codigo: "LIMP05" })).json.codigo).toBe("LIMP05");
    // E o próximo gerado continua do maior DESTA empresa
    expect((await criar("servicos", { nome: "Limpeza de bandeja" })).json.codigo).toBe("LIMP06");
  });

  it("editar o código do serviço: muda, normaliza, recusa repetido; vazio mantém o atual", async () => {
    const s = await prisma.servico.findFirst({ where: { empresaId: "e1", codigo: "MANU01" } });
    expect((await editar("servicos", s.id, { codigo: "prev01" })).json.codigo).toBe("PREV01");
    expect(await editar("servicos", s.id, { codigo: "limp01" })).toMatchObject({ status: 409, json: { erro: "O código LIMP01 já é do serviço “Limpeza de Filtro”. Escolha outro." } });
    expect(await editar("servicos", s.id, { codigo: "PREV-1" })).toMatchObject({ status: 400, json: { erro: "Código “PREV-1”: use só letras e números (ex.: LIMP01)." } });
    expect((await prisma.servico.findUnique({ where: { id: s.id } })).codigo).toBe("PREV01");
    const v = await editar("servicos", s.id, { codigo: "", nome: "Manutenção preventiva split" });
    expect(v.json).toMatchObject({ codigo: "PREV01", nome: "Manutenção preventiva split" });
    expect((await editar("servicos", s.id, { codigo: "PREV01" })).status).toBe(200); // o próprio código: ok
  });

  it("busca pelo código: produto pelo número exato, serviço pelo começo do código", async () => {
    const p = await listar("produtos", "6");
    expect(p.json.itens?.map((x: any) => x.nome) ?? p.json.map((x: any) => x.nome)).toContain("Capacitor 35uF");
    const s = await listar("servicos", "limp0");
    const nomes = (s.json.itens ?? s.json).map((x: any) => x.codigo);
    expect(nomes).toEqual(expect.arrayContaining(["LIMP01", "LIMP02", "LIMP05", "LIMP06"]));
    expect(nomes).not.toContain("HIGI10");
    // De-para da NF de compra: o número basta (até com 1 dígito); só a empresa da sessão
    const nf = async (q: string) => (await chamar("compras/produtos", "GET", {}, undefined, `http://localhost/api/compras/produtos?q=${q}`)).json.produtos;
    // acha pelo código (e pelo nome que tem “6”)
    const r6 = await nf("6");
    expect([r6[0].codigo, r6[0].nome]).toEqual([6, "Capacitor 35uF"]);
    expect(r6.map((x: any) => x.nome)).toEqual(["Capacitor 35uF", "Paralelo 6"]); // o código da “Paralelo 6” depende da corrida
    expect(await nf("900")).toEqual([]);
    expect((await nf("gás")).map((x: any) => x.codigo)).toEqual([1]);
  });

  it("baixar: permissão de ver o módulo; colunas do modelo; todos os registros DA EMPRESA (inativos também)", async () => {
    logar(montarPermissoes({ clientes: ["visualizar"] }));
    expect((await baixar("produtos")).status).toBe(403);
    expect((await baixar("clientes")).status).toBe(200);
    expect((await baixar("usuarios")).status).toBe(404);
    sessao.atual = null;
    expect((await baixar("clientes")).status).toBe(401);
    logar(montarPermissoes({ configuracoes: ["visualizar"] }));
    const { status, res, tabela, bruto } = await baixar("produtos");
    // Aba "Instruções" da planilha EXPORTADA (não a do modelo); o .xlsx é gravado sem compressão
    expect(bruto).toContain("Esta planilha veio do sistema");
    expect(bruto).not.toContain("A linha de exemplo (linha 2)");
    expect(status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="produtos-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(tabela![0]).toEqual(IMPORTACOES.produtos.colunas.map((c) => c.titulo));
    const ids = tabela!.slice(1).map((l) => l[col(tabela!, "id_sistema")]);
    expect(ids).toContain("p5"); // inativo
    expect(ids).not.toContain("pB"); // outra empresa
    expect(ids).toHaveLength((await produtos()).length);
    const gas = tabela!.find((l) => l[col(tabela!, "id_sistema")] === "p1")!;
    expect([gas[col(tabela!, "codigo")], gas[col(tabela!, "nome")], gas[col(tabela!, "valor_padrao")]]).toEqual(["1", "Gás R410A", "800,00"]);
  });

  it("reupload: nome editado ATUALIZA (não duplica); linha apagada não apaga; nova cria com o próximo código", async () => {
    const { tabela } = await baixar("produtos");
    const t = tabela!;
    const iNome = col(t, "nome");
    const total = (await produtos()).length;
    const gas = t.find((l) => l[col(t, "id_sistema")] === "p1")!;
    gas[iNome] = "Gás R410A cilindro 11,35 kg";
    // Apaga a linha do "Filtro" (p5) e acrescenta dois produtos novos (sem código, sem id)
    const corpo = t.slice(1).filter((l) => l[col(t, "id_sistema")] !== "p5");
    const novo = (nome: string) => t[0].map((c) => (c === "nome" ? nome : c === "unidade" ? "un" : ""));
    const linhas = [t[0], ...corpo, novo("Relé"), novo("Termostato")];
    const p = await importar("produtos", linhas, "previa");
    expect(p.json.analise.resumo).toMatchObject({ criar: 2, atualizar: corpo.length, erros: 0 });
    const c = await importar("produtos", linhas, "confirmar");
    expect(c.json).toMatchObject({ criados: 2, atualizados: corpo.length, comErro: 0 });
    const depois = await produtos();
    expect(depois).toHaveLength(total + 2);
    expect(depois.find((x: any) => x.id === "p1")).toMatchObject({ codigo: 1, nome: "Gás R410A cilindro 11,35 kg" });
    expect(depois.find((x: any) => x.id === "p5")).toMatchObject({ nome: "Filtro", codigo: 5 }); // continua lá
    const maior = Math.max(...depois.filter((x: any) => !["Relé", "Termostato"].includes(x.nome)).map((x: any) => x.codigo));
    expect(depois.filter((x: any) => ["Relé", "Termostato"].includes(x.nome)).map((x: any) => x.codigo).sort()).toEqual([maior + 1, maior + 2]);
  });

  it("reupload: código inexistente, id de outra empresa e id×código de cadastros diferentes = erro; nada muda", async () => {
    const cab = IMPORTACOES.produtos.colunas.map((c) => c.titulo);
    const l = (codigo: string, nome: string, id: string) => cab.map((c) => (c === "codigo" ? codigo : c === "nome" ? nome : c === "id_sistema" ? id : ""));
    const antes = JSON.stringify(await produtos());
    const r = await importar("produtos", [cab, l("777", "Inventado", ""), l("", "Invasor", "pB"), l("5", "Troca", "p1")], "confirmar");
    expect(r.status).toBe(400); // nenhuma linha válida
    const p = await importar("produtos", [cab, l("777", "Inventado", ""), l("", "Invasor", "pB"), l("5", "Troca", "p1")], "previa");
    expect(p.json.analise.linhas.map((x: any) => x.erros[0])).toEqual([
      "codigo: não há produto com o código 777 nesta empresa. Para um produto novo, deixe o código vazio (o sistema gera).",
      "id_sistema “pB” não é de nenhum produto desta empresa. Não altere essa coluna; para cadastrar um novo, deixe-a vazia.",
      "Esta linha aponta para produtos diferentes: o id_sistema p1 e o código 5 são de cadastros distintos. Confira a planilha.",
    ]);
    expect(JSON.stringify(await produtos())).toBe(antes);
    expect((await prisma.produto.findUnique({ where: { id: "pB" } })).nome).toBe("Da outra");
  });

  it("id_sistema da outra empresa (formato válido) não toca nela", async () => {
    await prisma.produto.create({ data: { id: "cmoutraempresaprod000001", empresaId: "e2", codigo: 902, nome: "Protegido" } });
    const cab = IMPORTACOES.produtos.colunas.map((c) => c.titulo);
    const p = await importar("produtos", [cab, cab.map((c) => (c === "nome" ? "Hackeado" : c === "id_sistema" ? "cmoutraempresaprod000001" : ""))], "previa");
    expect(p.json.analise.linhas[0].erros[0]).toBe("id_sistema “cmoutraempresaprod000001” não é de nenhum produto desta empresa. Não altere essa coluna; para cadastrar um novo, deixe-a vazia.");
    expect((await prisma.produto.findUnique({ where: { id: "cmoutraempresaprod000001" } })).nome).toBe("Protegido");
  });

  it("serviços: reupload troca o código pelo id_sistema; novo com código usa o dele; novo sem código ganha o do prefixo", async () => {
    const { tabela } = await baixar("servicos");
    const t = tabela!;
    const linhaS1 = t.find((l) => l[col(t, "id_sistema")] === "s1")!;
    linhaS1[col(t, "codigo")] = "filt01";
    linhaS1[col(t, "nome")] = "Limpeza de filtro (renomeada)";
    const novo = (codigo: string, nome: string) => t[0].map((c) => (c === "codigo" ? codigo : c === "nome" ? nome : ""));
    const c = await importar("servicos", [t[0], linhaS1, novo("INST07", "Instalação split"), novo("", "Instalação cassete"), novo("", "Limpeza de duto"), novo("", "Limpeza de serpentina")], "confirmar");
    expect(c.json).toMatchObject({ criados: 4, atualizados: 1, comErro: 0 });
    expect(await prisma.servico.findUnique({ where: { id: "s1" } })).toMatchObject({ codigo: "FILT01", nome: "Limpeza de filtro (renomeada)" });
    const cod = async (nome: string) => (await prisma.servico.findFirst({ where: { empresaId: "e1", nome } })).codigo;
    // dois novos do mesmo prefixo na mesma planilha: códigos seguidos, sem repetir
    expect([await cod("Instalação split"), await cod("Instalação cassete"), await cod("Limpeza de duto"), await cod("Limpeza de serpentina")]).toEqual(["INST07", "INST08", "LIMP07", "LIMP08"]);
  });

  it("fornecedor sem CNPJ: renomeado na planilha casa pelo id_sistema (antes viraria outro cadastro)", async () => {
    logar(montarPermissoes({ financeiro: ["visualizar", "fluxoCaixa"] }));
    const { tabela } = await baixar("fornecedores");
    const t = tabela!;
    expect(t.slice(1).map((l) => l[col(t, "id_sistema")])).toEqual(["fSemDoc"]);
    t[1][col(t, "nome")] = "Posto Ipiranga Centro";
    const c = await importar("fornecedores", t, "confirmar");
    expect(c.json).toMatchObject({ criados: 0, atualizados: 1 });
    expect(await prisma.fornecedor.count({ where: { empresaId: "e1" } })).toBe(1);
    expect((await prisma.fornecedor.findUnique({ where: { id: "fSemDoc" } })).nome).toBe("Posto Ipiranga Centro");
  });

  it("clientes: baixar → reupload sem mudança = só atualizar; troca de CNPJ casa pelo id_sistema", async () => {
    await prisma.tabelaPreco.create({ data: { id: "tp1", empresaId: "e1", nome: "Tabela VIP" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.222.333/0001-81", segmento: "SAUDE", tabelaPrecoId: "tp1" } });
    await prisma.cliente.create({ data: { id: "c2", empresaId: "e1", nome: "Clínica antiga", cpfCnpj: "11.444.777/0001-61", ativo: false } });
    const { tabela } = await baixar("clientes");
    const t = tabela!;
    const linhaC1 = t.find((l) => l[col(t, "id_sistema")] === "c1")!;
    expect(t.slice(1).map((l) => l[col(t, "id_sistema")]).sort()).toEqual(["c1", "c2"]); // o inativo também
    expect(linhaC1[col(t, "tabela_preco")]).toBe("Tabela VIP"); // o nome da tabela, que a importação lê de volta
    const p = await importar("clientes", t, "previa");
    expect(p.json.analise.resumo).toMatchObject({ criar: 0, atualizar: 2, erros: 0 });
    linhaC1[col(t, "cnpj_cpf")] = "529.982.247-25";
    linhaC1[col(t, "tipo_pessoa")] = "";
    const c = await importar("clientes", t, "confirmar");
    expect(c.json).toMatchObject({ criados: 0, atualizados: 2 });
    expect(await prisma.cliente.findUnique({ where: { id: "c1" } })).toMatchObject({ cpfCnpj: "529.982.247-25", segmento: "SAUDE" });
  });
});
