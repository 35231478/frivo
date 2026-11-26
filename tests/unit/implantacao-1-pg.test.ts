/**
 * Implantação, leva 1 — clientes completos, com as rotas reais e o Prisma real num PostgreSQL real:
 *  - cliente novo (e cliente sem nenhuma unidade) ganha a unidade "Principal" com o endereço dele, na mesma
 *    transação; reimportar não cria outra; cliente que já tem unidade não ganha nada;
 *  - planilha de outro sistema: sem a coluna obrigatória, o 400 traz o cabeçalho para ligar; com as colunas
 *    ligadas, grava; "não importar" desliga uma coluna reconhecida; ligação inválida → 400;
 *  - unidades (CNPJ/CPF + nome): cria, atualiza sem renomear, troca a principal na mesma transação, "Não" não
 *    tira a principal, cliente sem unidade → a 1ª vira principal, dois "Sim" no mesmo cliente → erro,
 *    id_sistema de outro cliente → erro, cliente de outra empresa → erro, reimportar não duplica;
 *  - contatos (CNPJ/CPF + e-mail ou nome): cria, casa o e-mail sem maiúsculas, troca o principal, apelido do
 *    tipo, nunca cria acesso ao portal;
 *  - permissão (unidade e contato pedem Clientes › Editar), baixar → editar → subir de novo (round-trip),
 *    modelo de cada planilha, multiempresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/implantacao-1-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { gerarCsv, gerarXlsx, lerXlsx } from "@/lib/folha/planilha";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_implantacao1_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Zé", email: "ze@x.com", empresaId, role: "OPERADOR", permissoes } };
};

// Documentos válidos (dígitos verificadores certos)
const CNPJ_NOVO1 = "48372015000107";
const CNPJ_NOVO2 = "59381027000114";
const CNPJ_VELHO = "11222333000181"; // cliente antigo, SEM unidade
const CNPJ_OK = "11444777000161"; // cliente com unidades (Principal + Loja A)
const CPF_OUTRA = "52998224725"; // cliente só da empresa 2
const fmt = (d: string) => (d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4"));

type Planilha = (string | number | null)[][];
const csv = (linhas: Planilha) => new File([gerarCsv(linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))))], "dados.csv", { type: "text/csv" });
const xlsx = (linhas: string[][]) => new File([new Uint8Array(gerarXlsx([{ nome: "Dados", linhas }]))], "dados.xlsx");

async function importar(entidade: string, arquivo: File, etapa: "previa" | "confirmar", ligacoes?: unknown) {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("etapa", etapa);
  if (ligacoes !== undefined) fd.append("ligacoes", typeof ligacoes === "string" ? ligacoes : JSON.stringify(ligacoes));
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const res: Response = await mod.POST(new NextRequest(`http://localhost/api/importacao/${entidade}`, { method: "POST", body: fd }), { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const previa = (e: string, a: File, l?: unknown) => importar(e, a, "previa", l);
const confirmar = (e: string, a: File, l?: unknown) => importar(e, a, "confirmar", l);
async function baixar(entidade: string, tipo: "exportar" | "modelo") {
  const mod = await import(/* @vite-ignore */ `@/app/api/importacao/[entidade]/${tipo}/route`);
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/importacao/${entidade}/${tipo}`), { params: Promise.resolve({ entidade }) });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}
const statusDa = (r: any, n: number) => r.json.analise.linhas.find((l: any) => l.linha === n);

describe.skipIf(!URL_PG)("Implantação, leva 1 — clientes completos (PostgreSQL real)", () => {
  let prisma: any;
  const unidadesDe = async (clienteId: string) => (await prisma.unidade.findMany({ where: { clienteId } })).sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));
  const clientePorDoc = (doc: string, empresaId = "e1") => prisma.cliente.findFirst({ where: { empresaId, cpfCnpj: fmt(doc) } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["", "/exportar", "/modelo"].map((r) => import(/* @vite-ignore */ `@/app/api/importacao/[entidade]${r}/route`)));
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    await prisma.contatoCliente.deleteMany({});
    await prisma.unidade.deleteMany({});
    await prisma.cliente.deleteMany({});
    await prisma.empresa.deleteMany({});
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.cliente.createMany({ data: [
      { id: "c-velho", empresaId: "e1", nome: "Cliente Antigo", cpfCnpj: fmt(CNPJ_VELHO), tipoPessoa: "JURIDICA", endereco: "Rua Velha", numero: "10", cidade: "Contagem", estado: "MG", cep: "32000-000" },
      { id: "c-ok", empresaId: "e1", nome: "Rede Boa", cpfCnpj: fmt(CNPJ_OK), tipoPessoa: "JURIDICA", endereco: "Av. Central", numero: "1", cidade: "BH", estado: "MG" },
      { id: "c-B", empresaId: "e2", nome: "Cliente da Outra", cpfCnpj: fmt(CPF_OUTRA), tipoPessoa: "FISICA" },
      // O MESMO CNPJ de um cliente novo da empresa 1, cadastrado na empresa 2: nunca casa
      { id: "c-B2", empresaId: "e2", nome: "Homônimo da Outra", cpfCnpj: fmt(CNPJ_NOVO1), tipoPessoa: "JURIDICA" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u-ok-p", empresaId: "e1", clienteId: "c-ok", nome: "Principal", principal: true, logradouro: "Av. Central", cidade: "BH" },
      { id: "u-ok-a", empresaId: "e1", clienteId: "c-ok", nome: "Loja Águas Claras", principal: false, cidade: "BH" },
      { id: "u-B", empresaId: "e2", clienteId: "c-B", nome: "Casa", principal: true },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "k-ok", empresaId: "e1", clienteId: "c-ok", nome: "Ana Souza", email: "ana@redeboa.com.br", principal: true, tipo: "FINANCEIRO" },
      { id: "k-B", empresaId: "e2", clienteId: "c-B", nome: "Bruno", email: "b@b.com", principal: true },
    ] });
    logar();
  });

  /* ───────── Clientes + unidade "Principal" ───────── */
  const CLIENTES: Planilha = [
    ["nome", "cnpj_cpf", "endereco", "numero", "bairro", "cidade", "estado", "cep", "telefone"],
    ["Hospital Vale Verde", fmt(CNPJ_NOVO1), "Rua das Acácias", "120", "Centro", "Belo Horizonte", "MG", "30140000", "(31) 3222-1000"],
    ["Supermercado Bom Preço", CNPJ_NOVO2, "", "", "", "", "", "", ""],
    ["Cliente Antigo Ltda", CNPJ_VELHO, "", "", "", "", "", "", "(31) 2222-0000"],
    ["Rede Boa", CNPJ_OK, "", "", "", "", "", "", ""],
  ];

  it("cliente novo e cliente sem unidade ganham a unidade 'Principal' com o endereço; quem já tem unidade não; reimportar não cria outra", async () => {
    const p = await previa("clientes", csv(CLIENTES));
    expect(p.json.analise.resumo).toMatchObject({ criar: 2, atualizar: 2, erros: 0 });
    expect(await prisma.unidade.count()).toBe(3); // prévia não grava

    const r = await confirmar("clientes", csv(CLIENTES));
    expect(r.json).toMatchObject({ criados: 2, atualizados: 2, comErro: 0 });
    expect(r.json.observacoes).toEqual(["3 clientes ganharam a unidade “Principal” com o endereço do cadastro."]);

    const novo = await clientePorDoc(CNPJ_NOVO1);
    const [u] = await unidadesDe(novo.id);
    expect(u).toMatchObject({ empresaId: "e1", nome: "Principal", principal: true, logradouro: "Rua das Acácias", numero: "120", bairro: "Centro", cidade: "Belo Horizonte", estado: "MG", cep: "30140-000", telefone: "(31) 3222-1000" });
    // sem endereço na planilha: a unidade nasce mesmo assim (vazia), para ter onde pendurar equipamentos
    const semEnd = await unidadesDe((await clientePorDoc(CNPJ_NOVO2)).id);
    expect(semEnd).toHaveLength(1);
    expect(semEnd[0]).toMatchObject({ nome: "Principal", principal: true, logradouro: null, cidade: null });
    // cliente antigo sem unidade: a "Principal" com o endereço que JÁ estava no cadastro (e o telefone novo)
    const velhas = await unidadesDe("c-velho");
    expect(velhas).toHaveLength(1);
    expect(velhas[0]).toMatchObject({ nome: "Principal", principal: true, logradouro: "Rua Velha", numero: "10", cidade: "Contagem", cep: "32000-000", telefone: "(31) 2222-0000" });
    // quem já tinha unidade: nada novo
    expect((await unidadesDe("c-ok")).map((x: any) => x.nome)).toEqual(["Loja Águas Claras", "Principal"]);
    // empresa 2: o homônimo com o mesmo CNPJ não foi tocado e não ganhou unidade
    expect(await prisma.unidade.count({ where: { clienteId: "c-B2" } })).toBe(0);
    expect((await prisma.cliente.findUnique({ where: { id: "c-B2" } })).nome).toBe("Homônimo da Outra");

    // reimportar a mesma planilha: tudo "atualizar" e nenhuma unidade nova
    const r2 = await confirmar("clientes", csv(CLIENTES));
    expect(r2.json).toMatchObject({ criados: 0, atualizados: 4, observacoes: [] });
    expect(await prisma.unidade.count({ where: { empresaId: "e1" } })).toBe(5); // 2 que já existiam + 3 "Principal"
  });

  it("se a unidade não puder ser criada, o cliente também não fica (mesma transação)", async () => {
    // Força a falha da unidade: um gatilho que recusa qualquer unidade nova
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${SCHEMA}.recusa_unidade() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'sem unidade'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER recusa BEFORE INSERT ON ${SCHEMA}.unidades FOR EACH ROW EXECUTE FUNCTION ${SCHEMA}.recusa_unidade()`);
    try {
      const r = await confirmar("clientes", csv([CLIENTES[0], CLIENTES[1]]));
      expect(r.json).toMatchObject({ criados: 0, comErro: 1 });
      expect(await clientePorDoc(CNPJ_NOVO1)).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER recusa ON ${SCHEMA}.unidades`);
    }
  });

  /* ───────── Ligar colunas (planilha de outro sistema) ───────── */
  const OUTRO: Planilha = [
    ["Nome do Cliente", "CPF/CNPJ", "Logradouro", "Cidade", "UF", "Telefone principal"],
    ["Hospital Vale Verde", fmt(CNPJ_NOVO1), "Rua das Acácias", "Belo Horizonte", "MG", "(31) 3222-1000"],
    ["Supermercado Bom Preço", fmt(CNPJ_NOVO2), "Av. Amazonas", "Contagem", "MG", "(31) 3333-2000"],
  ];

  it("planilha de outro sistema: sem a coluna obrigatória, o 400 traz o cabeçalho para ligar; ligadas, grava", async () => {
    const sem = await previa("clientes", csv(OUTRO));
    expect(sem.status).toBe(400);
    expect(sem.json.erro).toMatch(/Faltam colunas obrigatórias: nome/);
    expect(sem.json.ligar.cabecalho).toEqual(OUTRO[0]);
    expect(sem.json.ligar.faltando).toEqual(["nome"]);
    // o que o motor já ligou sozinho vem junto (CPF/CNPJ, Logradouro, Cidade, UF)
    expect(sem.json.ligar.ligadas).toMatchObject({ nome: null, cnpj_cpf: "CPF/CNPJ", endereco: "Logradouro", cidade: "Cidade", estado: "UF", telefone: null });

    const lig = { nome: "Nome do Cliente", telefone: "Telefone principal" };
    const p = await previa("clientes", csv(OUTRO), lig);
    expect(p.status).toBe(200);
    expect(p.json.analise.resumo).toMatchObject({ criar: 2, erros: 0 });
    expect(p.json.analise.colunas.ligadas).toMatchObject({ nome: "Nome do Cliente", telefone: "Telefone principal", cnpj_cpf: "CPF/CNPJ" });
    expect(p.json.analise.colunasIgnoradas).toEqual([]);
    expect(await prisma.cliente.count({ where: { empresaId: "e1" } })).toBe(2);

    const r = await confirmar("clientes", csv(OUTRO), lig);
    expect(r.json).toMatchObject({ criados: 2, comErro: 0 });
    expect(await clientePorDoc(CNPJ_NOVO2)).toMatchObject({ nome: "Supermercado Bom Preço", telefone: "(31) 3333-2000", endereco: "Av. Amazonas", cidade: "Contagem" });
  });

  it("'não importar' desliga uma coluna que o motor reconheceria; ligação inválida → 400 sem gravar", async () => {
    const r = await confirmar("clientes", csv(OUTRO), { nome: "Nome do Cliente", cidade: null });
    expect(r.json.criados).toBe(2);
    expect((await clientePorDoc(CNPJ_NOVO1)).cidade).toBeNull();
    expect((await clientePorDoc(CNPJ_NOVO1)).estado).toBe("MG");

    for (const ruim of [{ empresa_id: "Nome do Cliente" }, { nome: 12 }, ["nome"], "{x", { nome: "a".repeat(201) }]) {
      const x = await previa("clientes", csv(OUTRO), ruim);
      expect(x.status).toBe(400);
      expect(x.json.erro).toMatch(/Ligação de colunas inválida/);
    }
    expect(await prisma.cliente.count({ where: { empresaId: "e1" } })).toBe(4);
  });

  /* ───────── Unidades ───────── */
  it("unidades: cria, atualiza pelo nome (sem renomear), troca a principal; erros claros linha a linha", async () => {
    const r = await confirmar("unidades", csv([
      ["cnpj_cpf", "nome", "principal", "endereco", "cidade", "estado", "cep"],
      [fmt(CNPJ_OK), "Loja Contagem", "", "Av. João César", "Contagem", "MG", "32310-000"], // 2: cria
      [CNPJ_OK, "LOJA AGUAS CLARAS", "sim", "Rua Nova", "", "", ""], // 3: atualiza a Loja Águas Claras e vira principal
      ["99.999.999/0001-99", "Fantasma", "", "", "", "", ""], // 4: CNPJ inválido
      [fmt(CNPJ_NOVO1), "Filial", "", "", "", "", ""], // 5: CNPJ válido, mas sem cliente nesta empresa (é da empresa 2)
      [CPF_OUTRA, "Casa", "", "", "", "", ""], // 6: cliente só da outra empresa
      [CNPJ_OK, "Loja Betim", "sim", "", "", "", ""], // 7: segundo "Sim" no mesmo cliente → erro
      [CNPJ_OK, "Loja Sete", "", "", "", "XX", "123"], // 8: UF e CEP inválidos
    ]));
    expect(r.json).toMatchObject({ criados: 1, atualizados: 1, comErro: 5 });
    const erro = (n: number) => r.json.erros.find((e: any) => e.linha === n).erros.join(" ");
    expect(erro(4)).toMatch(/não é um CNPJ/);
    expect(erro(5)).toMatch(/nenhum cliente com o CNPJ 48\.372\.015\/0001-07 nesta empresa\. Importe a planilha de clientes primeiro/);
    expect(erro(6)).toMatch(/nenhum cliente com o CPF/);
    expect(erro(7)).toMatch(/a linha 3 já marca a unidade principal deste cliente/);
    expect(erro(8)).toMatch(/estado “XX” não existe/);
    expect(erro(8)).toMatch(/cep: “123” precisa ter 8 dígitos/);
    expect(r.json.observacoes).toEqual(["1 unidade deixou de ser a principal: a planilha marcou outro."]);

    const us = await unidadesDe("c-ok");
    expect(us.map((u: any) => [u.nome, u.principal, u.logradouro])).toEqual([
      ["Loja Águas Claras", true, "Rua Nova"], // casou pelo nome: não renomeou para "LOJA AGUAS CLARAS"
      ["Loja Contagem", false, "Av. João César"],
      ["Principal", false, "Av. Central"],
    ]);
    // a empresa 2 continua igual
    expect(await prisma.unidade.findUnique({ where: { id: "u-B" } })).toMatchObject({ nome: "Casa", principal: true });
    expect(await prisma.unidade.count({ where: { empresaId: "e2" } })).toBe(1);
  });

  it("unidades: 'Não' não tira a principal; cliente sem unidade → a 1ª vira principal; id de outro cliente → erro; reimportar não duplica", async () => {
    const planilha = csv([
      ["cnpj_cpf", "nome", "principal", "id_sistema"],
      [CNPJ_OK, "Principal", "não", ""], // 2: a principal atual: "Não" não tira a marcação
      [CNPJ_VELHO, "Galpão", "", ""], // 3: cliente sem unidade → vira a principal
      [CNPJ_VELHO, "Escritório", "", ""], // 4: a 2ª não
      [CNPJ_VELHO, "Mudou de cliente", "", "u-ok-a"], // 5: unidade de outro cliente
      [CNPJ_OK, "Da outra empresa", "", "u-B"], // 6: id da outra empresa
    ]);
    const r = await confirmar("unidades", planilha);
    expect(r.json).toMatchObject({ criados: 2, atualizados: 1, comErro: 2 });
    expect(r.json.erros.find((e: any) => e.linha === 5).erros.join(" ")).toMatch(/é de uma unidade de outro cliente/);
    expect(r.json.erros.find((e: any) => e.linha === 6).erros.join(" ")).toMatch(/não é de nenhuma unidade desta empresa\. Não altere essa coluna; para cadastrar uma nova/);
    expect((await prisma.unidade.findUnique({ where: { id: "u-ok-p" } })).principal).toBe(true);
    expect((await unidadesDe("c-velho")).map((u: any) => [u.nome, u.principal])).toEqual([["Escritório", false], ["Galpão", true]]);
    expect((await prisma.unidade.findUnique({ where: { id: "u-ok-a" } })).clienteId).toBe("c-ok");
    expect(await prisma.unidade.findUnique({ where: { id: "u-B" } })).toMatchObject({ nome: "Casa", clienteId: "c-B" });

    // de novo: o que entrou agora só atualiza
    const p = await previa("unidades", planilha);
    expect(p.json.analise.resumo).toMatchObject({ criar: 0, atualizar: 3, erros: 2 });
    const antes = await prisma.unidade.count();
    await confirmar("unidades", planilha);
    expect(await prisma.unidade.count()).toBe(antes);
  });

  it("unidades: baixar → editar → subir de novo atualiza pelo id_sistema (mesmo renomeando)", async () => {
    const b = await baixar("unidades", "exportar");
    expect(b.status).toBe(200);
    const tabela = lerXlsx(b.buf).map((l) => l.map((c) => (c == null ? "" : String(c))));
    expect(tabela[0]).toEqual(["cnpj_cpf", "nome", "principal", "cep", "endereco", "numero", "complemento", "bairro", "cidade", "estado", "telefone", "observacoes", "id_sistema"]);
    // só as da empresa da sessão
    expect(tabela.slice(1).map((l) => l[1]).sort()).toEqual(["Loja Águas Claras", "Principal"]);
    const iNome = 1, iId = 12;
    const linhaA = tabela.find((l) => l[iId] === "u-ok-a")!;
    linhaA[iNome] = "Loja Águas Claras — Térreo";
    const r = await confirmar("unidades", xlsx(tabela));
    expect(r.json).toMatchObject({ criados: 0, atualizados: 2, comErro: 0 });
    expect((await prisma.unidade.findUnique({ where: { id: "u-ok-a" } })).nome).toBe("Loja Águas Claras — Térreo");
    expect(await prisma.unidade.count({ where: { empresaId: "e1" } })).toBe(2);
  });

  /* ───────── Contatos ───────── */
  it("contatos: cria, casa pelo e-mail (sem maiúsculas) e pelo nome, troca o principal, apelido do tipo, nunca cria acesso ao portal", async () => {
    const r = await confirmar("contatos", csv([
      ["cnpj_cpf", "nome", "cargo", "tipo", "email", "whatsapp", "principal"],
      [CNPJ_OK, "Ana S. (financeiro)", "", "", "ANA@RedeBoa.com.br", "(31) 99999-0000", ""], // 2: mesmo e-mail → atualiza (e renomeia)
      [CNPJ_OK, "Paula Andrade", "gerente", "chamados", "paula@redeboa.com.br", "", "sim"], // 3: novo e principal
      [CNPJ_VELHO, "Rogério", "", "Diretor", "", "", ""], // 4: sem e-mail, tipo por apelido
      [CNPJ_VELHO, "R", "", "", "", "", ""], // 5: nome curto demais
      [CNPJ_OK, "Mário", "", "Gerente geral", "", "", ""], // 6: tipo que não existe
      [CNPJ_OK, "Teo", "", "", "teo@", "", ""], // 7: e-mail inválido
    ]));
    expect(r.json).toMatchObject({ criados: 2, atualizados: 1, comErro: 3 });
    expect(r.json.erros.find((e: any) => e.linha === 6).erros.join(" ")).toMatch(/tipo “Gerente geral” não existe\. Opções válidas: Financeiro, Operacional \/ Chamados/);
    expect(r.json.observacoes).toEqual(["1 contato deixou de ser o principal: a planilha marcou outro."]);
    expect(await prisma.contatoCliente.findUnique({ where: { id: "k-ok" } })).toMatchObject({ nome: "Ana S. (financeiro)", whatsapp: "(31) 99999-0000", principal: false, tipo: "FINANCEIRO" });
    const paula = await prisma.contatoCliente.findFirst({ where: { clienteId: "c-ok", email: "paula@redeboa.com.br" } });
    expect(paula).toMatchObject({ nome: "Paula Andrade", cargo: "Gerente", tipo: "OPERACIONAL", principal: true, senha: null, acessoConcedidoEm: null, permissoes: null });
    expect(await prisma.contatoCliente.findFirst({ where: { clienteId: "c-velho" } })).toMatchObject({ nome: "Rogério", tipo: "DIRETORIA", principal: false });
    // a outra empresa: intacta
    expect(await prisma.contatoCliente.findUnique({ where: { id: "k-B" } })).toMatchObject({ nome: "Bruno", principal: true });

    // reimportar só as linhas boas: nada duplica (Rogério casa pelo nome)
    const p = await previa("contatos", csv([
      ["cnpj_cpf", "nome", "email"], [CNPJ_OK, "Paula Andrade", "Paula@redeboa.com.br"], [CNPJ_VELHO, "rogerio", ""],
    ]));
    expect(p.json.analise.resumo).toMatchObject({ criar: 0, atualizar: 2 });
  });

  it("contatos: e-mail de um contato e nome de outro na mesma linha → erro (não adivinha); id de outro cliente → erro", async () => {
    await prisma.contatoCliente.create({ data: { id: "k-ok2", empresaId: "e1", clienteId: "c-ok", nome: "Carla Dias", email: "carla@redeboa.com.br" } });
    await prisma.contatoCliente.create({ data: { id: "k-velho", empresaId: "e1", clienteId: "c-velho", nome: "Zeca" } });
    const r = await previa("contatos", csv([
      ["cnpj_cpf", "nome", "email", "id_sistema"],
      [CNPJ_OK, "Carla Dias", "ana@redeboa.com.br", ""],
      [CNPJ_OK, "Zeca", "", "k-velho"],
    ]));
    expect(statusDa(r, 2).erros.join(" ")).toMatch(/aponta para contatos diferentes: o e-mail no mesmo cliente ana@redeboa\.com\.br e o nome no mesmo cliente carla dias/);
    expect(statusDa(r, 3).erros.join(" ")).toMatch(/é de um contato de outro cliente/);
  });

  it("linha que casa e não tem nada a mudar não vira erro falso (fornecedor pelo nome; unidade só com o nome)", async () => {
    await prisma.fornecedor.deleteMany({});
    await prisma.fornecedor.create({ data: { id: "f1", empresaId: "e1", nome: "Frigelar", ativo: true } });
    const f = await confirmar("fornecedores", csv([["nome"], ["frigelar"]]));
    expect(f.json).toMatchObject({ criados: 0, atualizados: 1, comErro: 0 });
    expect((await prisma.fornecedor.findUnique({ where: { id: "f1" } })).nome).toBe("Frigelar");
    const u = await confirmar("unidades", csv([["cnpj_cpf", "nome"], [CNPJ_OK, "principal"]]));
    expect(u.json).toMatchObject({ criados: 0, atualizados: 1, comErro: 0 });
  });

  it("e-mail de contato antigo gravado com maiúsculas ainda casa (não duplica)", async () => {
    await prisma.contatoCliente.create({ data: { id: "k-velho", empresaId: "e1", clienteId: "c-ok", nome: "Carla Dias", email: "Carla@RedeBoa.com.br" } });
    const r = await confirmar("contatos", csv([["cnpj_cpf", "nome", "email", "cargo"], [CNPJ_OK, "Carla D.", "carla@redeboa.com.br", "compras"]]));
    expect(r.json).toMatchObject({ criados: 0, atualizados: 1, comErro: 0 });
    expect(await prisma.contatoCliente.findUnique({ where: { id: "k-velho" } })).toMatchObject({ cargo: "Compras", nome: "Carla D." });
  });

  it("a gravação confere o cliente de novo na empresa (se ele sumiu ou é de outra empresa, a linha vira erro)", async () => {
    const { gravarImportacao } = await import("@/lib/importacao/servidor");
    const linha = (n: number, clienteId: string) => ({ linha: n, status: "criar", rotulo: "X", erros: [], valores: {}, dados: { clienteId, nome: "Xavier" } });
    for (const e of ["contatos", "unidades"] as const) {
      const r = await gravarImportacao(e, { linhas: [linha(2, "c-B"), linha(3, "nao-existe")], resumo: { total: 2, criar: 2, atualizar: 0, erros: 0 }, colunasIgnoradas: [], colunas: { cabecalho: [], ligadas: {}, faltando: [] } } as any, "e1");
      expect(r.criados).toBe(0);
      expect(r.erros.map((x) => x.erros.join())).toEqual(["O cliente desta linha não foi encontrado na sua empresa.", "O cliente desta linha não foi encontrado na sua empresa."]);
    }
    expect(await prisma.contatoCliente.count({ where: { nome: "Xavier" } })).toBe(0);
    expect(await prisma.unidade.count({ where: { nome: "Xavier" } })).toBe(0);
  });

  /* ───────── Permissão, modelo, multiempresa ───────── */
  it("unidade e contato pedem Clientes › Editar (criar cliente não basta); baixar pede ver clientes", async () => {
    logar(montarPermissoes({ clientes: ["visualizar", "criar"] }));
    for (const e of ["unidades", "contatos"]) {
      const r = await previa(e, csv([["cnpj_cpf", "nome"], [CNPJ_OK, "X"]]));
      expect(r.status).toBe(403);
      expect((await baixar(e, "modelo")).status).toBe(403);
      expect((await baixar(e, "exportar")).status).toBe(200);
    }
    expect((await previa("clientes", csv(CLIENTES))).status).toBe(200);
    logar(montarPermissoes({ ordens: ["visualizar"] }));
    expect((await baixar("unidades", "exportar")).status).toBe(403);
    sessao.atual = null;
    expect((await previa("unidades", csv([["cnpj_cpf", "nome"]]))).status).toBe(401);
  });

  it("modelo de unidades e de contatos: o exemplo da linha 2 casa com as colunas; na outra empresa, o mesmo arquivo não toca a empresa 1", async () => {
    for (const e of ["unidades", "contatos"]) {
      const m = await baixar(e, "modelo");
      expect(m.status).toBe(200);
      const [cab, ex] = lerXlsx(m.buf);
      expect(cab[0]).toBe("cnpj_cpf");
      expect(cab).toContain("nome");
      expect(cab[cab.length - 1]).toBe("id_sistema");
      expect(ex.length).toBe(cab.length);
    }
    logar(permissoesTotais(), "e2");
    const r = await confirmar("contatos", csv([["cnpj_cpf", "nome", "email"], [CPF_OUTRA, "Bruno", "B@B.com"], [CNPJ_OK, "Ana", ""]]));
    expect(r.json).toMatchObject({ criados: 0, atualizados: 1, comErro: 1 });
    expect(r.json.erros[0].erros.join(" ")).toMatch(/nenhum cliente com o CNPJ 11\.444\.777\/0001-61 nesta empresa/);
    expect(await prisma.contatoCliente.count({ where: { empresaId: "e1" } })).toBe(1);
  });
});
