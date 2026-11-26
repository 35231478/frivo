/**
 * Implantação, levas 3 e 4 — com as rotas reais e o Prisma real num PostgreSQL real:
 *  - ESTOQUE INICIAL: o saldo de um produto que já existe (código → id_sistema → nome); sobe = ENTRADA de
 *    origem Inventário COM o custo (vira o último custo de compra); desce = ajuste sem custo; igual = nada
 *    (reimportar não lança de novo); nome repetido, produto que não existe, que não controla estoque ou
 *    inativo = erro; o custo só existe para quem vê custo; módulo Estoque desligado = 403;
 *  - COLABORADORES pelo CPF (só os dígitos): CPF novo precisa ser válido, o que já está no cadastro casa
 *    como está; telefone obrigatório só para criar; cargo pelo nome (só os da empresa); o CPF não muda pela
 *    planilha; nunca salário; baixar pede gerenciar a equipe;
 *  - VEÍCULOS pela placa (sem hífen/espaço, maiúsculas): placa inválida e repetida = erro; responsável pelo
 *    CPF de um colaborador DA EMPRESA; a placa não muda pela planilha; módulo Frota desligado = 403;
 *  - IMPLANTAÇÃO: as contagens reais da empresa, etapas de módulo desligado fora, progresso e próxima etapa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/implantacao-3-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { gerarCsv, lerXlsx } from "@/lib/folha/planilha";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_implantacao3_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", role = "OPERADOR") => {
  sessao.atual = { user: { id: "u1", name: "Zé", email: "ze@x.com", empresaId, role, permissoes } };
};

/** CPFs fictícios com dígitos verificadores válidos */
function cpf(base: string) {
  const d = base.split("").map(Number);
  const dv = (n: number) => { const s = d.slice(0, n).reduce((a, x, i) => a + x * (n + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  d.push(dv(9)); d.push(dv(10)); return d.join("");
}
const fmtCpf = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
const CPF_A = cpf("731004501"), CPF_B = cpf("731004502"), CPF_C = cpf("731004503"), CPF_VELHO = cpf("731004504");

type Planilha = (string | number | null)[][];
const csv = (linhas: Planilha) => new File([gerarCsv(linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))))], "dados.csv", { type: "text/csv" });

async function importar(entidade: string, arquivo: File, etapa: "previa" | "confirmar", ligacoes?: unknown) {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("etapa", etapa);
  if (ligacoes !== undefined) fd.append("ligacoes", JSON.stringify(ligacoes));
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const res: Response = await mod.POST(new NextRequest(`http://localhost/api/importacao/${entidade}`, { method: "POST", body: fd }), { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function baixar(entidade: string, tipo: "exportar" | "modelo") {
  const mod = await import(/* @vite-ignore */ `@/app/api/importacao/[entidade]/${tipo}/route`);
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/importacao/${entidade}/${tipo}?formato=xlsx`), { params: Promise.resolve({ entidade }) });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}
const linhaDa = (r: any, n: number) => r.json.analise.linhas.find((l: any) => l.linha === n);
const erroDa = (r: any, n: number) => (linhaDa(r, n)?.erros ?? []).join(" ");
/** A planilha baixada, subida de volta como veio (célula vazia continua vazia) */
const devolta = (linhas: unknown[][]) => new File([gerarCsv(linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))))], "volta.csv");
const erroGravado = (r: any, n: number) => (r.json.erros.find((e: any) => e.linha === n)?.erros ?? []).join(" ");

describe.skipIf(!URL_PG)("Implantação, levas 3 e 4 (PostgreSQL real)", () => {
  let prisma: any;
  let esquecerModulos: (e?: string) => void;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ esquecerModulos } = await import("@/lib/modulos/servidor"));
    await Promise.all(["", "/exportar", "/modelo", "/erros"].map((r) => import(/* @vite-ignore */ `@/app/api/importacao/[entidade]${r}/route`)));
    await import("@/app/api/implantacao/etapas/route");
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    await prisma.movimentacaoEstoque.deleteMany({});
    await prisma.produto.deleteMany({});
    await prisma.veiculo.deleteMany({});
    await prisma.tecnico.deleteMany({});
    await prisma.cargo.deleteMany({});
    await prisma.configuracao.deleteMany({});
    await prisma.usuario.deleteMany({});
    await prisma.empresaModulo.deleteMany({});
    await prisma.empresa.deleteMany({});
    esquecerModulos();
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Zé", email: "ze@x.com", senha: "x" } });
    await prisma.produto.createMany({ data: [
      { id: "p-gas", empresaId: "e1", codigo: 1, nome: "Gás R22", unidade: "kg" },
      { id: "p-filtro", empresaId: "e1", codigo: 2, nome: "Filtro de ar", saldo: 10 },
      { id: "p-dup1", empresaId: "e1", codigo: 3, nome: "Capacitor" },
      { id: "p-dup2", empresaId: "e1", codigo: 4, nome: "capacitor" },
      { id: "p-sem", empresaId: "e1", codigo: 5, nome: "Serviço embalado", controlaEstoque: false },
      { id: "p-inativo", empresaId: "e1", codigo: 6, nome: "Peça antiga", ativo: false },
      { id: "p-B", empresaId: "e2", codigo: 1, nome: "Gás R22" },
    ] });
    await prisma.cargo.createMany({ data: [
      { id: "cg-tec", empresaId: "e1", nome: "Técnico de Refrigeração" },
      { id: "cg-off", empresaId: "e1", nome: "Cargo antigo", ativo: false },
      { id: "cg-B", empresaId: "e2", nome: "Gerente" },
    ] });
    await prisma.tecnico.createMany({ data: [
      // CPF guardado formatado e com dígitos que não fecham (cadastro antigo): casa do mesmo jeito
      { id: "t-velho", empresaId: "e1", nome: "Carlos Antigo", cpf: "900.000.000-01", telefone: "(11) 90000-0001", salario: 3200 },
      { id: "t-dup1", empresaId: "e1", nome: "Duplo Um", cpf: fmtCpf(CPF_VELHO), telefone: "1190000002" },
      { id: "t-dup2", empresaId: "e1", nome: "Duplo Dois", cpf: CPF_VELHO, telefone: "1190000003" },
      { id: "t-B", empresaId: "e2", nome: "Da Outra", cpf: fmtCpf(CPF_A), telefone: "1190000004" },
    ] });
    await prisma.veiculo.createMany({ data: [
      { id: "v-velho", empresaId: "e1", placa: "ABC-1234", modelo: "Saveiro", fotos: [] },
      { id: "v-B", empresaId: "e2", placa: "FRV1A23", modelo: "Uno", fotos: [] },
    ] });
    logar();
  });

  /* ───────────────────────── Estoque inicial ───────────────────────── */

  it("estoque: sobe com ENTRADA de inventário e o custo; desce com ajuste sem custo; igual não lança; erros claros", async () => {
    const r = await importar("estoque", csv([
      ["codigo", "produto", "quantidade", "custo_unitario"],
      ["1", "", "12,5", "389,90"], // 2: 0 → 12,5 com custo
      ["", "filtro de ar", "4", "50"], // 3: 10 → 4 (baixa: o custo não entra)
      ["", "Capacitor", "3", ""], // 4: nome em 2 produtos
      ["", "Produto Que Não Existe", "1", ""], // 5
      ["5", "", "1", ""], // 6: não controla estoque
      ["6", "", "1", ""], // 7: inativo
      ["99", "", "1", ""], // 8: código que não existe
      ["", "Gás R22", "-2", ""], // 9: negativo
      ["", "Gás R22", "abc", ""], // 10: não é número (e repete o produto da linha 2 pelo nome? não: linha 2 casou pelo código)
    ]), "confirmar");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ criados: 0, atualizados: 2 });
    expect(erroGravado(r, 4)).toMatch(/há 2 produtos com o nome “Capacitor”\. Use o código/);
    expect(erroGravado(r, 5)).toMatch(/produto “Produto Que Não Existe” não está cadastrado/);
    expect(erroGravado(r, 6)).toMatch(/não controla estoque/);
    expect(erroGravado(r, 7)).toMatch(/está inativo/);
    expect(erroGravado(r, 8)).toMatch(/não há produto com o código 99/);
    expect(erroGravado(r, 9)).toMatch(/não pode ser negativo/);
    expect(erroGravado(r, 10)).toMatch(/quantidade: “abc” não é um número/);

    const movs = await prisma.movimentacaoEstoque.findMany({ where: { empresaId: "e1" }, orderBy: { produtoId: "asc" } });
    expect(movs.map((m: any) => ({ p: m.produtoId, tipo: m.tipo, origem: m.origem, q: Number(m.quantidade), custo: m.custoUnitario == null ? null : Number(m.custoUnitario), u: m.usuarioId, obs: m.observacao })))
      .toEqual([
        { p: "p-filtro", tipo: "AJUSTE", origem: "INVENTARIO", q: -6, custo: null, u: "u1", obs: "Saldo inicial (planilha de implantação)" },
        { p: "p-gas", tipo: "ENTRADA", origem: "INVENTARIO", q: 12.5, custo: 389.9, u: "u1", obs: "Saldo inicial (planilha de implantação)" },
      ]);
    expect(Number((await prisma.produto.findUnique({ where: { id: "p-gas" } })).saldo)).toBe(12.5);
    expect(Number((await prisma.produto.findUnique({ where: { id: "p-filtro" } })).saldo)).toBe(4);
    // A outra empresa não foi tocada (mesmo código, mesmo nome)
    expect(Number((await prisma.produto.findUnique({ where: { id: "p-B" } })).saldo)).toBe(0);
    // O custo vira o último custo de compra do produto (é o que alimenta custo e margem do orçamento)
    const { ultimosCustos } = await import("@/lib/estoque/custo");
    expect([...(await ultimosCustos("e1", ["p-gas", "p-filtro"]))]).toEqual([["p-gas", 389.9]]);
  });

  it("estoque: reimportar não lança de novo — a prévia avisa e o resultado conta os que já estavam", async () => {
    const plan = csv([["codigo", "produto", "quantidade"], ["1", "", "7"], ["2", "", "10"]]);
    const p = await importar("estoque", plan, "previa");
    expect(linhaDa(p, 3).avisos.join(" ")).toMatch(/O saldo já é 10: nada a lançar/);
    const a = await importar("estoque", plan, "confirmar");
    expect(a.json).toMatchObject({ atualizados: 1 });
    expect(a.json.observacoes.join(" ")).toMatch(/1 produto já estava com esse saldo: nada foi lançado/);
    const b = await importar("estoque", plan, "confirmar");
    expect(b.json).toMatchObject({ atualizados: 0, comErro: 0 });
    expect(b.json.observacoes.join(" ")).toMatch(/2 produtos já estavam com esse saldo/);
    expect(await prisma.movimentacaoEstoque.count({ where: { empresaId: "e1" } })).toBe(1);
  });

  it("estoque: produto que já tem movimentação entra só pela diferença (com aviso), e o id de outra empresa não casa", async () => {
    await prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId: "p-gas", tipo: "ENTRADA", origem: "COMPRA", quantidade: 3, saldoApos: 3 } });
    await prisma.produto.update({ where: { id: "p-gas" }, data: { saldo: 3 } });
    const p = await importar("estoque", csv([["produto", "quantidade", "id_sistema"], ["Gás R22", "5", ""], ["Gás R22", "1", "p-B"]]), "previa");
    expect(linhaDa(p, 2).avisos.join(" ")).toMatch(/já tem movimentações: entra só a diferença \(\+2\)/);
    expect(erroDa(p, 3)).toMatch(/id_sistema “p-B” não é de nenhum produto desta empresa/);
    await importar("estoque", csv([["produto", "quantidade"], ["Gás R22", "5"]]), "confirmar");
    const ult = await prisma.movimentacaoEstoque.findFirst({ where: { produtoId: "p-gas", origem: "INVENTARIO" } });
    expect(Number(ult.quantidade)).toBe(2);
    expect(Number(ult.saldoApos)).toBe(5);
  });

  it("estoque: sem permissão de ver custo, a coluna some do modelo e da leitura (e o custo não é gravado)", async () => {
    // Só Estoque › gerenciar (sem visualizar) e sem Orçamentos › ver custo
    logar(montarPermissoes({ estoque: ["gerenciar"] }));
    const m = await baixar("estoque", "modelo");
    expect(m.status).toBe(200);
    expect(lerXlsx(m.buf)[0]).not.toContain("custo_unitario");
    const r = await importar("estoque", csv([["codigo", "produto", "quantidade", "custo_unitario"], ["1", "", "2", "999"]]), "confirmar");
    expect(r.json).toMatchObject({ atualizados: 1 });
    const mov = await prisma.movimentacaoEstoque.findFirst({ where: { produtoId: "p-gas" } });
    expect(mov.custoUnitario).toBeNull();
    // Com a permissão de ver custo, a coluna existe
    logar(montarPermissoes({ estoque: ["gerenciar"], orcamentos: ["verCusto"] }));
    expect(lerXlsx((await baixar("estoque", "modelo")).buf)[0]).toContain("custo_unitario");
    // Papel TECNICO nunca vê custo, mesmo com as permissões
    logar(permissoesTotais(), "e1", "TECNICO");
    expect(lerXlsx((await baixar("estoque", "modelo")).buf)[0]).not.toContain("custo_unitario");
  });

  it("estoque: baixar traz o saldo (e o último custo só para quem vê custo) e subir de volta não lança nada", async () => {
    await importar("estoque", csv([["codigo", "produto", "quantidade", "custo_unitario"], ["1", "", "3", "40,5"]]), "confirmar");
    const x = await baixar("estoque", "exportar");
    expect(x.status).toBe(200);
    const linhas = lerXlsx(x.buf);
    expect(linhas[0]).toEqual(["codigo", "produto", "quantidade", "custo_unitario", "id_sistema"]);
    const gas = linhas.find((l) => l[4] === "p-gas")!;
    expect(gas.slice(0, 4)).toEqual(["1", "Gás R22", "3", "40,5"]);
    // Só os produtos ativos que controlam estoque
    expect(linhas.slice(1).map((l) => l[4]).sort()).toEqual(["p-dup1", "p-dup2", "p-filtro", "p-gas"]);
    const volta = await importar("estoque", devolta(linhas), "confirmar");
    expect(volta.json).toMatchObject({ atualizados: 0, comErro: 0 });
    expect(await prisma.movimentacaoEstoque.count({ where: { empresaId: "e1" } })).toBe(1);
    logar(montarPermissoes({ estoque: ["visualizar"] }));
    // Estoque › visualizar já vê o último custo (lib/estoque/custo-acesso): a coluna vem
    expect(lerXlsx((await baixar("estoque", "exportar")).buf)[0]).toContain("custo_unitario");
  });

  it("estoque: permissão (lançar estoque = gerenciar) e módulo Estoque desligado = 403", async () => {
    logar(montarPermissoes({ estoque: ["visualizar"] }));
    expect((await importar("estoque", csv([["codigo", "produto", "quantidade"], ["1", "", "1"]]), "previa")).status).toBe(403);
    logar();
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "estoque", ativo: false } }); esquecerModulos();
    const d = await importar("estoque", csv([["codigo", "produto", "quantidade"], ["1", "", "1"]]), "confirmar");
    expect(d.status).toBe(403);
    expect(d.json.modulo).toBe("estoque");
    expect((await baixar("estoque", "exportar")).status).toBe(403);
    expect(await prisma.movimentacaoEstoque.count()).toBe(0);
  });

  /* ───────────────────────── Colaboradores ───────────────────────── */

  it("colaboradores: cria pelo CPF (formatado), atualiza o antigo pelos dígitos, sem telefone entra com aviso, cargo novo é criado uma vez", async () => {
    const r = await importar("colaboradores", csv([
      ["nome", "cpf", "telefone", "email", "funcao", "equipe", "cargo", "cidade", "estado"],
      ["rafael teixeira", CPF_A, "(31) 98888-0101", "RAFAEL@EXEMPLO.COM", "", "", "tecnico de refrigeracao", "belo horizonte", "mg"], // 2: cria
      ["Juliana Prado", fmtCpf(CPF_B), "31988880102", "", "Administrativo", "", "", "", ""], // 3: cria, equipe pela função
      ["Carlos Atualizado", "90000000001", "", "carlos@exemplo.com", "", "", "", "Contagem", ""], // 4: atualiza o antigo (dígitos), sem telefone
      ["Sem Telefone", CPF_C, "", "", "", "", "", "", ""], // 5: novo sem telefone: entra com aviso (decisão do Zé)
      ["CPF Errado", "111.222.333-44", "31988880104", "", "", "", "", "", ""], // 6: CPF novo inválido
      ["Cargo Novo", cpf("731004505"), "31988880105", "", "", "", "Gerente", "", ""], // 7: "Gerente" só existe na outra empresa: aqui é criado
      ["Cargo Inativo", cpf("731004506"), "31988880106", "", "", "", "Cargo antigo", "", ""], // 8: cargo inativo
      ["Duplo", CPF_VELHO, "31988880107", "", "", "", "", "", ""], // 9: CPF em 2 cadastros
      ["Função Errada", cpf("731004507"), "31988880108", "", "Gerente geral", "", "", "", ""], // 10
      ["UF Errada", cpf("731004508"), "31988880109", "", "", "", "", "", "XX"], // 11
      ["Outro Gerente", cpf("731004509"), "31988880110", "", "", "", "GERENTE", "", ""], // 12: o mesmo cargo novo, outra grafia
    ]), "confirmar");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ criados: 5, atualizados: 1, comErro: 5 });
    expect(erroGravado(r, 6)).toMatch(/cpf: “111\.222\.333-44” não é um CPF válido/);
    expect(erroGravado(r, 8)).toMatch(/cargo “Cargo antigo” está inativo\. Reative em Configurações › Cargos/);
    // Sem telefone: gravado (telefone vazio) e listado nos avisos do resultado
    expect(await prisma.tecnico.findFirst({ where: { empresaId: "e1", cpf: fmtCpf(CPF_C) } })).toMatchObject({ telefone: "" });
    expect(r.json.avisos.find((a: any) => a.linha === 5).avisos.join(" ")).toMatch(/Sem telefone: o colaborador entra/);
    expect(r.json.avisos.find((a: any) => a.linha === 7).avisos.join(" ")).toMatch(/cargo “Gerente” não existe: será criado/);
    // O cargo novo: criado UMA vez, nesta empresa, e listado no resultado
    const gerentes = await prisma.cargo.findMany({ where: { empresaId: "e1", nome: { equals: "gerente", mode: "insensitive" } } });
    expect(gerentes).toHaveLength(1);
    expect(await prisma.tecnico.count({ where: { empresaId: "e1", cargoId: gerentes[0].id } })).toBe(2);
    expect(await prisma.cargo.count({ where: { empresaId: "e2" } })).toBe(1);
    expect(r.json.observacoes).toContain("Cargo criado (revise em Configurações › Cargos): Gerente.");
    // O inativo não foi recriado nem reativado
    expect(await prisma.cargo.findMany({ where: { empresaId: "e1", nome: "Cargo antigo" } })).toEqual([expect.objectContaining({ id: "cg-off", ativo: false })]);
    expect(erroGravado(r, 9)).toMatch(/está em 2 colaboradores desta empresa.*id_sistema/);
    expect(erroGravado(r, 10)).toMatch(/funcao “Gerente geral” não existe/);
    expect(erroGravado(r, 11)).toMatch(/estado: “XX” não é uma UF/);

    const a = await prisma.tecnico.findFirst({ where: { empresaId: "e1", cpf: fmtCpf(CPF_A) } });
    expect(a).toMatchObject({ nome: "Rafael Teixeira", telefone: "(31) 98888-0101", email: "rafael@exemplo.com", tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO", cargoId: "cg-tec", cidade: "Belo Horizonte", estado: "MG", ativo: true });
    expect(a.salario).toBeNull();
    expect(await prisma.tecnico.findFirst({ where: { cpf: fmtCpf(CPF_B) } })).toMatchObject({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
    // O antigo: atualizado pelos dígitos; telefone, CPF e salário intocados
    expect(await prisma.tecnico.findUnique({ where: { id: "t-velho" } })).toMatchObject({ nome: "Carlos Atualizado", email: "carlos@exemplo.com", cidade: "Contagem", telefone: "(11) 90000-0001", cpf: "900.000.000-01" });
    expect(Number((await prisma.tecnico.findUnique({ where: { id: "t-velho" } })).salario)).toBe(3200);
    // O mesmo CPF na OUTRA empresa não casou: lá continua só o dela
    expect(await prisma.tecnico.count({ where: { empresaId: "e2" } })).toBe(1);
  });

  it("colaboradores: o CPF não muda pela planilha; baixar (gerenciar a equipe) e subir de volta atualiza pelo id", async () => {
    const p = await importar("colaboradores", csv([["nome", "cpf", "id_sistema"], ["Carlos", CPF_C, "t-velho"]]), "previa");
    expect(erroDa(p, 2)).toMatch(/O CPF não muda pela planilha/);
    const x = await baixar("colaboradores", "exportar");
    expect(x.status).toBe(200);
    const linhas = lerXlsx(x.buf);
    expect(linhas[0]).not.toContain("salario");
    expect(linhas[0].join(",")).toBe("nome,cpf,telefone,email,funcao,equipe,cargo,crea,endereco,numero,complemento,bairro,cidade,estado,cep,observacoes,id_sistema");
    const volta = await importar("colaboradores", devolta(linhas), "confirmar");
    // Os dois do CPF repetido casam pelo id_sistema (a planilha exportada resolve a ambiguidade)
    expect(volta.json).toMatchObject({ criados: 0, atualizados: 3, comErro: 0 });
    logar(montarPermissoes({ equipes: ["visualizar"] }));
    expect((await baixar("colaboradores", "exportar")).status).toBe(403);
    expect((await importar("colaboradores", csv([["nome", "cpf", "telefone"], ["X", CPF_C, "31988880101"]]), "previa")).status).toBe(403);
  });

  it("colaboradores: reimportar com o cargo que já foi criado não cria de novo", async () => {
    const plan = csv([["nome", "cpf", "telefone", "cargo"], ["Rafael", CPF_A, "31988880101", "Encarregado"]]);
    const a = await importar("colaboradores", plan, "confirmar");
    expect(a.json.observacoes).toContain("Cargo criado (revise em Configurações › Cargos): Encarregado.");
    const p = await importar("colaboradores", plan, "previa");
    expect(linhaDa(p, 2).avisos ?? []).toEqual([]); // agora é um cargo que existe
    const b = await importar("colaboradores", plan, "confirmar");
    expect(b.json.observacoes).toEqual([]);
    expect(await prisma.cargo.count({ where: { empresaId: "e1", nome: "Encarregado" } })).toBe(1);
  });

  it("cargos novos: um por nome (sem acento e maiúsculas); o que outra importação acabou de criar é reaproveitado", async () => {
    const { resolverCargos } = await import("@/lib/importacao/servidor");
    // "Supervisor" criado por outra importação depois da análise desta
    await prisma.cargo.create({ data: { id: "cg-sup", empresaId: "e1", nome: "Supervisor" } });
    const linhas: any[] = [
      { linha: 2, dados: { cargoNovo: "Técnico Sênior" } },
      { linha: 3, dados: { cargoNovo: "tecnico senior" } },
      { linha: 4, dados: { cargoNovo: "SUPERVISOR" } },
      { linha: 5, dados: { cargoId: "cg-tec" } },
    ];
    expect(await resolverCargos(linhas, "e1")).toEqual(["Técnico Sênior"]);
    const senior = await prisma.cargo.findFirst({ where: { empresaId: "e1", nome: "Técnico Sênior" } });
    expect(linhas.map((l) => l.dados.cargoId)).toEqual([senior.id, senior.id, "cg-sup", "cg-tec"]);
    expect(await prisma.cargo.count({ where: { empresaId: "e1" } })).toBe(4); // tec, antigo, supervisor, sênior
  });

  it("colaboradores: planilha de outro sistema com as colunas ligadas", async () => {
    const cab = ["Nome completo", "Nº do documento", "Celular", "Função"];
    const plan = csv([cab, ["Rafael", fmtCpf(CPF_A), "31988880101", "Técnico de campo"]]);
    const sem = await importar("colaboradores", plan, "previa");
    expect(sem.status).toBe(400);
    expect(sem.json.ligar.faltando).toEqual(["cpf"]);
    const com = await importar("colaboradores", plan, "confirmar", { cpf: "Nº do documento" });
    expect(com.json).toMatchObject({ criados: 1 });
  });

  /* ───────────────────────── Veículos ───────────────────────── */

  it("veículos: placa normalizada, o antigo casa sem hífen, responsável pelo CPF, e erros claros", async () => {
    await prisma.tecnico.create({ data: { id: "t-a", empresaId: "e1", nome: "Rafael", cpf: fmtCpf(CPF_A), telefone: "31988880101" } });
    const r = await importar("veiculos", csv([
      ["placa", "modelo", "marca", "ano", "tipo", "quilometragem", "responsavel_cpf"],
      ["frv-9a11", "Fiorino", "Fiat", "2022", "furgão", "45.300", CPF_A], // 2: cria, Mercosul
      ["abc1234", "Saveiro Cross", "", "", "", "88000", ""], // 3: atualiza ABC-1234
      ["FRV 9A11", "Fiorino", "", "", "", "", ""], // 4: repete a linha 2
      ["12345", "Uno", "", "", "", "", ""], // 5: placa inválida
      ["FRV9B22", "Strada", "", "1890", "", "", ""], // 6: ano inválido
      ["FRV9C33", "Strada", "", "", "Avião", "", ""], // 7: tipo inválido
      ["FRV9D44", "Strada", "", "", "", "", CPF_C], // 8: responsável que não existe
      ["FRV1A23", "Uno", "", "", "", "", ""], // 9: placa da OUTRA empresa: aqui é nova
    ]), "confirmar");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ criados: 2, atualizados: 1, comErro: 5 });
    expect(erroGravado(r, 4)).toMatch(/Repete a linha 2/);
    expect(erroGravado(r, 5)).toMatch(/placa: “12345” não é uma placa/);
    expect(erroGravado(r, 6)).toMatch(/ano: “1890” não é um ano/);
    expect(erroGravado(r, 7)).toMatch(/tipo “Avião” não existe/);
    expect(erroGravado(r, 8)).toMatch(/nenhum colaborador com o CPF .* Importe os colaboradores antes/);
    expect(await prisma.veiculo.findFirst({ where: { empresaId: "e1", placa: "FRV9A11" } })).toMatchObject({ modelo: "Fiorino", marca: "Fiat", ano: "2022", tipo: "VAN", quilometragemAtual: 45300, responsavelId: "t-a", status: "ATIVO" });
    expect(await prisma.veiculo.findUnique({ where: { id: "v-velho" } })).toMatchObject({ placa: "ABC-1234", modelo: "Saveiro Cross", quilometragemAtual: 88000, tipo: "CARRO" });
    expect(await prisma.veiculo.count({ where: { placa: "FRV1A23" } })).toBe(2);
  });

  it("veículos: responsável de outra empresa não liga; a placa não muda pela planilha; placa repetida pede o id; baixar e subir de volta", async () => {
    // A mesma placa gravada de dois jeitos (o cadastro aceita): sem o id_sistema não dá para saber qual
    await prisma.veiculo.createMany({ data: [{ id: "v-d1", empresaId: "e1", placa: "XYZ-1A11", modelo: "Kombi", fotos: [] }, { id: "v-d2", empresaId: "e1", placa: "XYZ1A11", modelo: "Kombi", fotos: [] }] });
    const p = await importar("veiculos", csv([["placa", "modelo", "responsavel_cpf", "id_sistema"], ["FRV9E55", "Uno", CPF_A, ""], ["XYZ9Z99", "Saveiro", "", "v-velho"], ["xyz 1a11", "Kombi", "", ""]]), "previa");
    expect(erroDa(p, 2)).toMatch(/nenhum colaborador com o CPF/); // o CPF_A só existe na outra empresa
    expect(erroDa(p, 3)).toMatch(/A placa não muda pela planilha/);
    expect(erroDa(p, 4)).toMatch(/está em 2 veículos desta empresa.*Use o id_sistema/);
    const x = await baixar("veiculos", "exportar");
    const linhas = lerXlsx(x.buf);
    expect(linhas[0].join(",")).toBe("placa,modelo,marca,ano,ano_modelo,tipo,combustivel,cor,chassi,renavam,quilometragem,responsavel_cpf,observacoes,id_sistema");
    const volta = await importar("veiculos", devolta(linhas), "confirmar");
    // Os dois da placa repetida casam pelo id_sistema
    expect(volta.json).toMatchObject({ criados: 0, atualizados: 3, comErro: 0 });
  });

  it("veículos: permissão (Frota › gerenciar) e módulo Frota desligado = 403", async () => {
    logar(montarPermissoes({ veiculos: ["visualizar"] }));
    expect((await importar("veiculos", csv([["placa", "modelo"], ["FRV9F66", "Uno"]]), "previa")).status).toBe(403);
    logar();
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "veiculos", ativo: false } }); esquecerModulos();
    const d = await importar("veiculos", csv([["placa", "modelo"], ["FRV9F66", "Uno"]]), "confirmar");
    expect(d.status).toBe(403);
    expect(await prisma.veiculo.count({ where: { placa: "FRV9F66" } })).toBe(0);
  });

  /* ───────────────────────── Implantação ───────────────────────── */

  it("implantação: 'não se aplica / fazer depois' conta como concluída, reabre, só com Configurações › Gerenciar", async () => {
    const { carregarImplantacao } = await import("@/lib/implantacao/servidor");
    const marcar = async (corpo: unknown) => {
      const mod = await import("@/app/api/implantacao/etapas/route");
      const res: Response = await mod.PATCH(new NextRequest("http://localhost/api/implantacao/etapas", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
      return { status: res.status, json: (await res.json().catch(() => null)) as any };
    };
    // A empresa ainda não tem linha de configuração: a 1ª marcação cria
    expect(await prisma.configuracao.count({ where: { empresaId: "e1" } })).toBe(0);
    expect(await marcar({ etapa: "contratos", dispensada: true })).toEqual({ status: 200, json: { ok: true, dispensadas: ["contratos"] } });
    expect((await marcar({ etapa: "empresa", dispensada: true })).json.dispensadas).toEqual(["empresa", "contratos"]);
    const a = await carregarImplantacao("e1");
    expect(a.etapas.filter((e) => e.dispensada).map((e) => e.id)).toEqual(["empresa", "contratos"]);
    expect(a.progresso).toMatchObject({ feitas: 4, total: 7, pct: 57 });
    // Reabrir tira da lista; marcar de novo não duplica
    expect((await marcar({ etapa: "empresa", dispensada: false })).json.dispensadas).toEqual(["contratos"]);
    expect((await marcar({ etapa: "contratos", dispensada: true })).json.dispensadas).toEqual(["contratos"]);
    // A outra empresa não é tocada
    logar(permissoesTotais(), "e2");
    expect((await carregarImplantacao("e2")).etapas.some((e) => e.dispensada)).toBe(false);
    // Etapa que não existe e sem permissão
    logar();
    expect((await marcar({ etapa: "financeiro", dispensada: true })).status).toBe(400);
    expect((await marcar({ etapa: "contratos", dispensada: "sim" })).status).toBe(400);
    logar(montarPermissoes({ configuracoes: ["visualizar"] }));
    expect((await marcar({ etapa: "veiculos", dispensada: true })).status).toBe(403);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).implantacaoDispensadas).toEqual(["contratos"]);
    // Valor desconhecido na coluna (dado velho, digitado à mão) é ignorado na leitura
    const { etapasDispensadas } = await import("@/lib/implantacao/servidor");
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { implantacaoDispensadas: ["contratos", "financeiro", "veiculos"] } });
    expect(await etapasDispensadas("e1")).toEqual(["contratos", "veiculos"]);
  });

  it("SQL pendente (2027-01-29_implantacao_dispensadas): 3×, aditivo, não apaga marcações, igual ao que o Prisma espera", () => {
    const ARQ = path.join(RAIZ, "prisma/sql/2027-01-29_implantacao_dispensadas.sql");
    const SQLS = `${SCHEMA}_sql`;
    const psql = (args: string[]) => execFileSync("psql", [URL_PG!, "-q", "-At", "-v", "ON_ERROR_STOP=1", ...args], { env: { ...process.env, PGOPTIONS: `-c search_path=${SQLS}` } }).toString().trim();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SQLS} CASCADE; CREATE SCHEMA ${SQLS};`]);
    psql(["-c", `CREATE TABLE "configuracoes" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL); INSERT INTO "configuracoes" VALUES ('c1', 'e1');`]);
    for (let i = 0; i < 3; i++) psql(["-f", ARQ]);
    expect(psql(["-c", `SELECT cardinality("implantacao_dispensadas") FROM "configuracoes"`])).toBe("0");
    psql(["-c", `UPDATE "configuracoes" SET "implantacao_dispensadas" = ARRAY['contratos']`]);
    psql(["-f", ARQ]);
    expect(psql(["-c", `SELECT array_to_string("implantacao_dispensadas", ',') FROM "configuracoes"`])).toBe("contratos");
    const coluna = (schema: string) => execFileSync("psql", [URL_PG!, "-q", "-At", "-c",
      `SELECT data_type || '|' || udt_name || '|' || is_nullable || '|' || coalesce(column_default, '') FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'configuracoes' AND column_name = 'implantacao_dispensadas'`]).toString().trim();
    expect(coluna(SQLS)).toBe(coluna(SCHEMA));
    expect(coluna(SQLS)).not.toBe("");
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SQLS} CASCADE;`]);
  });

  it("implantação: contagens reais da empresa; etapa de módulo desligado sai; 100% quando tudo existe", async () => {
    const { contarImplantacao, carregarImplantacao } = await import("@/lib/implantacao/servidor");
    const c = await contarImplantacao("e1");
    expect(c).toMatchObject({ dadosEmpresa: false, logo: false, tiposOs: 0, usuarios: 1, clientes: 0, equipamentos: 0, produtosEstoque: 4, produtosComSaldo: 0, colaboradores: 3, veiculos: 1, contratos: 0, pmocs: 0 });
    const a = await carregarImplantacao("e1");
    expect(a.etapas.map((e) => e.id)).toEqual(["empresa", "clientes", "equipamentos", "estoque", "colaboradores", "veiculos", "contratos"]);
    expect(a.progresso).toMatchObject({ feitas: 2, total: 7, pct: 28, completa: false });
    expect(a.progresso.proxima?.id).toBe("empresa");
    // Frota e Estoque desligados: as etapas somem e a conta muda
    await prisma.empresaModulo.createMany({ data: [{ empresaId: "e1", modulo: "veiculos", ativo: false }, { empresaId: "e1", modulo: "estoque", ativo: false }] }); esquecerModulos();
    const b = await carregarImplantacao("e1");
    expect(b.etapas.map((e) => e.id)).toEqual(["empresa", "clientes", "equipamentos", "colaboradores", "contratos"]);
    expect(b.progresso).toMatchObject({ feitas: 1, total: 5, pct: 20 });
    // A outra empresa não entra na conta
    expect((await contarImplantacao("e2")).colaboradores).toBe(1);
  });
});
