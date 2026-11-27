/**
 * "Exportar dados da empresa (backup portátil)" com a rota real, o Prisma real e um PostgreSQL real:
 *  - DUAS empresas com dados em todas as tabelas exportadas: o pacote de uma não traz NADA da outra (nem nome,
 *    nem id), inclusive nos itens sem coluna própria de empresa (itens da OS e do orçamento);
 *  - o conteúdo de cada CSV (cabeçalho, valores, formato), as colunas iguais às da importação e a planilha de
 *    colaboradores sem salário, senha, dados bancários ou documentos pessoais;
 *  - a permissão: só o administrador ATIVO da empresa (conferido no banco); operador com tudo liberado, técnico,
 *    administrador inativo e sem sessão não baixam;
 *  - a trilha: registrada antes do 1º byte, concluída com as contagens no fim, "interrompida" se o download cai;
 *  - volume grande simulado (generate_series): sai em lotes, o download começa antes de o banco ser lido inteiro;
 *  - o SQL de produção (prisma/sql/2027-02-09): 2×, aditivo, igual ao Prisma.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/exportar-dados-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { lerCsv } from "@/lib/folha/planilha";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_exportar_dados_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const SQL = path.join(RAIZ, "prisma/sql/2027-02-09_exportacoes_dados.sql");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const logar = (id: string, empresaId: string, role = "ADMIN") => {
  sessao.atual = { user: { id, name: "x", email: "x@ficticio.test", empresaId, role, permissoes: {} } };
};

/** Lê o zip (com o zipfile do Python, que confere o CRC de cada arquivo) → { nome: texto } */
function abrirZip(bytes: Uint8Array): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), "exportar-"));
  try {
    const arq = path.join(dir, "pacote.zip");
    writeFileSync(arq, bytes);
    const json = execFileSync("python3", ["-I", "-c", [
      "import sys, json, zipfile",
      "z = zipfile.ZipFile(sys.argv[1])",
      "assert z.testzip() is None",
      "print(json.dumps({n: z.read(n).decode('utf-8') for n in z.namelist()}))",
    ].join("\n"), arq], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    return JSON.parse(json);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function baixar(parte?: string) {
  const mod = await import("@/app/api/configuracoes/exportar-dados/baixar/route");
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/configuracoes/exportar-dados/baixar${parte ? `?parte=${parte}` : ""}`));
  return res;
}
async function baixarTudo(parte?: string) {
  const res = await baixar(parte);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { res, arquivos: res.status === 200 ? abrirZip(bytes) : {}, bytes };
}
/** CSV → linhas (sem o BOM), pelo MESMO leitor da importação */
const tabela = (texto: string) => lerCsv(texto).map((l) => l.map((c) => (c == null ? "" : String(c))));
const comoObjetos = (texto: string) => {
  const [cab, ...ls] = tabela(texto);
  return ls.map((l) => Object.fromEntries(cab.map((c, i) => [c, l[i] ?? ""])));
};

describe.skipIf(!URL_PG)("Exportar dados da empresa — PostgreSQL real", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    for (const [e, letra, cnpj] of [["e1", "A", "11.222.333/0001-81"], ["e2", "B", "11.444.777/0001-61"]] as const) {
      const M = `EMPRESA-${letra}`;
      await prisma.empresa.create({ data: { id: e, nome: `Refrigeração ${M} (fictícia)`, cnpj, email: `${e}@ficticio.test` } });
      await prisma.usuario.create({ data: { id: `${e}-admin`, empresaId: e, nome: `Admin ${M}`, email: `admin-${e}@ficticio.test`, senha: "x", role: "ADMIN" } });
      const tabelaPreco = await prisma.tabelaPreco.create({ data: { id: `${e}-tp`, empresaId: e, nome: `Tabela ${M}` } });
      const cliente = await prisma.cliente.create({ data: {
        id: `${e}-cli`, empresaId: e, nome: `Cliente ${M}; Ltda`, cpfCnpj: letra === "A" ? "73.100.660/0001-18" : "45.723.174/0001-10",
        tipoPessoa: "JURIDICA", tabelaPrecoId: tabelaPreco.id, observacoes: `Linha 1\nLinha "2"`,
      } });
      const principal = await prisma.unidade.create({ data: { id: `${e}-u1`, empresaId: e, clienteId: cliente.id, nome: "Principal", principal: true } });
      const ala = await prisma.unidade.create({ data: { id: `${e}-u2`, empresaId: e, clienteId: cliente.id, nome: `Ala ${M}` } });
      await prisma.contatoCliente.create({ data: { id: `${e}-ct`, empresaId: e, clienteId: cliente.id, nome: `Contato ${M}`, senha: `SENHA-PORTAL-${M}`, senhaProvisoria: `PROVISORIA-${M}` } });
      const tipo = await prisma.tipoEquipamentoCustom.create({ data: { id: `${e}-te`, empresaId: e, nome: `Tipo ${M}` } });
      const eq = await prisma.equipamento.create({ data: { id: `${e}-eq`, empresaId: e, unidadeId: ala.id, tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: tipo.id, marca: `Marca ${M}`, modelo: "M1", numeroSerie: `SN-${M}` } });
      await prisma.fornecedor.create({ data: { id: `${e}-forn`, empresaId: e, nome: `Fornecedor ${M}` } });
      const servico = await prisma.servico.create({ data: { id: `${e}-sv`, empresaId: e, nome: `Serviço ${M}`, codigo: `S-${letra}` } });
      const produto = await prisma.produto.create({ data: { id: `${e}-pr`, empresaId: e, nome: `Produto ${M}`, codigo: letra === "A" ? 1 : 2, controlaEstoque: true, saldo: 7.5 } });
      const cargo = await prisma.cargo.create({ data: { id: `${e}-cg`, empresaId: e, nome: `Cargo ${M}` } });
      await prisma.tecnico.create({ data: {
        id: `${e}-tec`, empresaId: e, nome: `Técnico ${M}`, cpf: "529.982.247-25", telefone: "(11) 90000-0000", cargoId: cargo.id,
        salario: 98765.43, banco: `BANCO-${M}`, agencia: "AG-SECRETA", conta: "CONTA-SECRETA", pixChave: "PIX-SECRETO", rg: "RG-SECRETO",
        pis: "PIS-SECRETO", ctpsNumero: "CTPS-SECRETA", nomeMae: "MAE-SECRETA", dataNascimento: new Date("1990-01-01T12:00:00Z"),
      } });
      await prisma.veiculo.create({ data: { id: `${e}-vc`, empresaId: e, placa: letra === "A" ? "AAA1A11" : "BBB2B22", modelo: `Modelo ${M}` } });
      const contrato = await prisma.contrato.create({ data: {
        id: `${e}-ctr`, empresaId: e, clienteId: cliente.id, numero: `CT-${M}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", periodicidade: "MENSAL",
        valorMensal: 1250.5, dataInicio: new Date("2026-02-01T12:00:00Z"), diaVencimento: 10,
        unidades: { create: [{ unidadeId: principal.id }, { unidadeId: ala.id }] },
      } });
      await prisma.pmoc.create({ data: {
        id: `${e}-pmoc`, empresaId: e, clienteId: cliente.id, unidadeId: ala.id, nome: `PMOC ${M}`, dataInicio: new Date("2026-02-01T12:00:00Z"),
        dataExpiracao: new Date("2027-02-01T12:00:00Z"), equipamentos: { create: [{ equipamentoId: eq.id }] },
      } });
      await prisma.pmoc.create({ data: {
        id: `${e}-pmoc-excluido`, empresaId: e, clienteId: cliente.id, unidadeId: ala.id, nome: `PMOC EXCLUIDO ${M}`, ativo: false,
        dataInicio: new Date("2026-02-01T12:00:00Z"), dataExpiracao: new Date("2027-02-01T12:00:00Z"),
      } });
      const orc = await prisma.orcamento.create({ data: {
        id: `${e}-orc`, empresaId: e, codigo: `ORC-${letra}`, nome: `Orçamento ${M}`, clienteId: cliente.id, criadoPorId: `${e}-admin`, tipo: "COMUM",
        status: "APROVADO", totalServicos: 300, totalProdutos: 50, desconto: 10, tipoDesconto: "PERCENTUAL", totalGeral: 315, tokenPublico: `tok-${e}`,
        servicos: { create: [{ id: `${e}-orc-s`, servicoId: servico.id, descricao: `Item serviço ${M}`, quantidade: 2, valorUnitario: 150, valorTotal: 300, ordem: 1 }] },
        produtos: { create: [{ id: `${e}-orc-p`, produtoId: produto.id, descricao: `Item produto ${M}`, quantidade: 1, valorUnitario: 50, valorTotal: 50, ordem: 2 }] },
      } });
      const os = await prisma.ordemServico.create({ data: {
        id: `${e}-os`, empresaId: e, numero: `OS-${letra}1`, clienteId: cliente.id, unidadeId: ala.id, contratoId: contrato.id, orcamentoOrigemId: orc.id,
        criadoPorId: `${e}-admin`, responsavelId: `${e}-admin`, descricao: `Preventiva ${M}`, status: "CONCLUIDA",
        itensOrcamento: { create: [
          { id: `${e}-osi1`, descricao: `Mão de obra ${M}`, tipo: "SERVICO", quantidade: 1, valorUnitario: 200, valorTotal: 200, ordem: 1, executado: true },
          { id: `${e}-osi2`, descricao: `Filtro ${M}`, tipo: "PRODUTO", quantidade: 2, valorUnitario: 12.25, valorTotal: 24.5, ordem: 2 },
        ] },
      } });
      await prisma.atividadeOs.create({ data: { id: `${e}-at`, empresaId: e, ordemServicoId: os.id, tecnicoId: `${e}-tec`, titulo: `Visita ${M}`, status: "CONCLUIDA", tokenRelatorio: `rel-${e}` } });
      await prisma.contaReceber.create({ data: { id: `${e}-cr`, empresaId: e, clienteId: cliente.id, contratoId: contrato.id, numero: `CR-${letra}`, descricao: `Receita ${M}`, valor: 1250.5, status: "A_RECEBER", dataVencimento: new Date("2026-03-10T12:00:00Z") } });
      await prisma.contaReceber.create({ data: { id: `${e}-cr-excluida`, empresaId: e, clienteId: cliente.id, numero: `CR-EXC-${letra}`, descricao: `EXCLUIDA ${M}`, valor: 1, status: "A_RECEBER", excluidaEm: new Date() } });
      await prisma.contaPagar.create({ data: { id: `${e}-cp`, empresaId: e, numero: `CP-${letra}`, fornecedor: `Fornecedor ${M}`, descricao: `Despesa ${M}`, valorTotal: 80, valorPago: 30, saldoRestante: 50, status: "PAGO_PARCIAL" } });
    }
    // Quem NÃO pode exportar, na empresa A
    await prisma.usuario.create({ data: { id: "e1-op", empresaId: "e1", nome: "Operador", email: "op@ficticio.test", senha: "x", role: "OPERADOR" } });
    await prisma.usuario.create({ data: { id: "e1-tecu", empresaId: "e1", nome: "Técnico", email: "tec@ficticio.test", senha: "x", role: "TECNICO" } });
    await prisma.usuario.create({ data: { id: "e1-ex", empresaId: "e1", nome: "Ex-admin", email: "ex@ficticio.test", senha: "x", role: "ADMIN", ativo: false } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("o pacote da empresa A", () => {
    let arquivos: Record<string, string>;
    let res: Response;
    beforeAll(async () => {
      logar("e1-admin", "e1");
      ({ res, arquivos } = await baixarTudo());
    });

    it("é um zip válido com o LEIA-ME e os 19 arquivos, na ordem", async () => {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="frivo-dados-refrigeracao-empresa-a-ficticia-\d{4}-\d{2}-\d{2}\.zip"$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { ARQUIVOS } = await import("@/lib/exportacao/arquivos");
      expect(Object.keys(arquivos)).toEqual(["LEIA-ME.txt", ...ARQUIVOS.map((a) => a.nome)]);
    });

    it("NADA da empresa B: nem nome, nem id, nem nos itens sem coluna de empresa", () => {
      const tudo = Object.values(arquivos).join("\n");
      expect(tudo).toContain("EMPRESA-A");
      expect(tudo).not.toContain("EMPRESA-B");
      expect(tudo).not.toMatch(/\be2-/);
      expect(arquivos["14-os-itens.csv"]).toContain("e1-osi1");
      expect(arquivos["17-orcamentos-itens.csv"]).toContain("e1-orc-s");
    });

    it("cada CSV: UTF-8 com BOM, separador ;, CRLF, aspas só onde precisa", () => {
      for (const [nome, texto] of Object.entries(arquivos)) {
        if (!nome.endsWith(".csv")) continue;
        expect(texto.startsWith("﻿"), nome).toBe(true);
        expect(texto.split("\r\n")[0], nome).toContain(";");
      }
      const [cliente] = comoObjetos(arquivos["01-clientes.csv"]);
      // ";" e quebra de linha no meio do texto: o leitor da importação devolve igualzinho
      expect(cliente.nome).toBe("Cliente EMPRESA-A; Ltda");
      expect(cliente.observacoes).toBe(`Linha 1\nLinha "2"`);
      expect(cliente.tabela_preco).toBe("Tabela EMPRESA-A");
      expect(cliente.id_sistema).toBe("e1-cli");
    });

    it("cadastros da Implantação: as MESMAS colunas da planilha de importação", async () => {
      const { ARQUIVOS } = await import("@/lib/exportacao/arquivos");
      const { defExportacao } = await import("@/lib/exportacao/servidor");
      for (const a of ARQUIVOS.filter((x) => x.importacao)) {
        const cab = tabela(arquivos[a.nome])[0];
        expect(cab, a.nome).toEqual(defExportacao(a.importacao!).colunas.map((c) => c.titulo));
      }
    });

    it("colaboradores: sem salário, senha, dados bancários ou documentos pessoais", () => {
      const texto = arquivos["09-colaboradores.csv"];
      for (const proibido of ["98765", "BANCO-", "AG-SECRETA", "CONTA-SECRETA", "PIX-SECRETO", "RG-SECRETO", "PIS-SECRETO", "CTPS-SECRETA", "MAE-SECRETA", "1990"])
        expect(texto, proibido).not.toContain(proibido);
      expect(tabela(texto)[0].join(";")).not.toMatch(/salari|senha|banco|agencia|pix|rg\b|pis|ctps|mae|nascimento/i);
      const [t] = comoObjetos(texto);
      expect(t).toMatchObject({ nome: "Técnico EMPRESA-A", cpf: "529.982.247-25", cargo: "Cargo EMPRESA-A", id_sistema: "e1-tec" });
      // E a senha do portal do contato também não
      expect(arquivos["03-contatos.csv"]).not.toMatch(/SENHA-PORTAL|PROVISORIA/);
    });

    it("unidades, equipamentos (tipo personalizado) e estoque (saldo)", () => {
      expect(comoObjetos(arquivos["02-unidades.csv"]).map((u) => u.nome).sort()).toEqual(["Ala EMPRESA-A", "Principal"]);
      const [eq] = comoObjetos(arquivos["04-equipamentos.csv"]);
      expect(eq).toMatchObject({ tipo: "Tipo EMPRESA-A", marca: "Marca EMPRESA-A", numero_serie: "SN-EMPRESA-A", unidade: "Ala EMPRESA-A", id_sistema: "e1-eq" });
      const [est] = comoObjetos(arquivos["08-estoque.csv"]);
      expect(est).toMatchObject({ codigo: "1", quantidade: "7,5", id_sistema: "e1-pr" });
    });

    it("contratos e PMOC nas colunas da importação (unidades por nome; plano excluído não volta)", () => {
      const [c] = comoObjetos(arquivos["11-contratos.csv"]);
      expect(c).toMatchObject({
        numero: "CT-EMPRESA-A", cnpj_cpf: "73.100.660/0001-18", tipo: "Manutenção Preventiva", situacao: "Ativo", data_inicio: "01/02/2026",
        valor_mensal: "1250,50", periodicidade: "Mensal", dia_vencimento: "10",
      });
      expect(c.unidades.split("; ").sort()).toEqual(["Ala EMPRESA-A", "Principal"]);
      const ps = comoObjetos(arquivos["12-pmoc.csv"]);
      expect(ps).toHaveLength(1);
      expect(ps[0]).toMatchObject({ nome: "PMOC EMPRESA-A", unidade: "Ala EMPRESA-A", equipamentos: "SN-EMPRESA-A", data_expiracao: "01/02/2027" });
    });

    it("OS: cabeçalho com totais pelos itens, itens e atividades", () => {
      const [os] = comoObjetos(arquivos["13-os.csv"]);
      expect(os).toMatchObject({
        numero: "OS-A1", cliente: "Cliente EMPRESA-A; Ltda", unidade: "Ala EMPRESA-A", contrato: "CT-EMPRESA-A", orcamento_origem: "ORC-A",
        situacao: "Concluída", responsavel: "Admin EMPRESA-A", total_servicos: "200,00", total_produtos: "24,50", total: "224,50", id_sistema: "e1-os",
      });
      const itens = comoObjetos(arquivos["14-os-itens.csv"]);
      expect(itens.map((i) => [i.os_numero, i.tipo, i.quantidade, i.valor_total, i.executado])).toEqual(expect.arrayContaining([
        ["OS-A1", "Serviço", "1", "200,00", "Sim"], ["OS-A1", "Produto", "2", "24,50", "Não"],
      ]));
      const [at] = comoObjetos(arquivos["15-os-atividades.csv"]);
      expect(at).toMatchObject({ os_numero: "OS-A1", titulo: "Visita EMPRESA-A", situacao: "Concluída", tecnico: "Técnico EMPRESA-A" });
    });

    it("orçamentos: cabeçalho (desconto percentual) e itens de serviço e produto", () => {
      const [o] = comoObjetos(arquivos["16-orcamentos.csv"]);
      expect(o).toMatchObject({ codigo: "ORC-A", cliente: "Cliente EMPRESA-A; Ltda", desconto: "10%", total_geral: "315,00", id_sistema: "e1-orc" });
      const itens = comoObjetos(arquivos["17-orcamentos-itens.csv"]);
      expect(itens.map((i) => [i.orcamento_codigo, i.tipo, i.descricao, i.valor_total])).toEqual([
        ["ORC-A", "Serviço", "Item serviço EMPRESA-A", "300,00"], ["ORC-A", "Produto", "Item produto EMPRESA-A", "50,00"],
      ]);
    });

    it("financeiro: a receber (sem a excluída) e a pagar", () => {
      const rs = comoObjetos(arquivos["18-contas-receber.csv"]);
      expect(rs).toHaveLength(1);
      expect(rs[0]).toMatchObject({ numero: "CR-A", valor: "1250,50", vencimento: "10/03/2026", contrato: "CT-EMPRESA-A", id_sistema: "e1-cr" });
      const [p] = comoObjetos(arquivos["19-contas-pagar.csv"]);
      expect(p).toMatchObject({ numero: "CP-A", fornecedor: "Fornecedor EMPRESA-A", valor: "80,00", valor_pago: "30,00", saldo: "50,00", id_sistema: "e1-cp" });
    });

    it("o LEIA-ME: empresa, data, quem gerou e o que cada arquivo tem", () => {
      const l = arquivos["LEIA-ME.txt"];
      expect(l).toContain("Empresa: Refrigeração EMPRESA-A (fictícia) (CNPJ 11.222.333/0001-81)");
      expect(l).toContain("Gerado por: Admin EMPRESA-A");
      expect(l).toMatch(/Gerado em: \d{2}\/\d{2}\/\d{4}/);
      expect(l).toContain("- 01-clientes.csv: Clientes");
      expect(l).toContain("Fotos, anexos");
    });
  });

  it("a empresa B baixa só o que é dela", async () => {
    logar("e2-admin", "e2");
    const { arquivos } = await baixarTudo();
    const tudo = Object.values(arquivos).join("\n");
    expect(tudo).toContain("EMPRESA-B");
    expect(tudo).not.toContain("EMPRESA-A");
    expect(tudo).not.toMatch(/\be1-/);
  });

  it("por parte: só os arquivos daquela parte", async () => {
    logar("e1-admin", "e1");
    const { res, arquivos } = await baixarTudo("financeiro");
    expect(res.headers.get("content-disposition")).toContain("-financeiro-");
    expect(Object.keys(arquivos)).toEqual(["LEIA-ME.txt", "18-contas-receber.csv", "19-contas-pagar.csv"]);
    expect((await baixar("tudo-e-mais")).status).toBe(400);
  });

  describe("permissão (conferida no banco, não no cookie)", () => {
    it.each([
      ["operador com tudo liberado", "e1-op", "OPERADOR"],
      ["técnico", "e1-tecu", "TECNICO"],
      ["administrador inativo (o cookie ainda diz ADMIN)", "e1-ex", "ADMIN"],
      ["usuário de outra empresa com a sessão apontando para esta", "e2-admin", "ADMIN"],
    ])("%s: 403, nada é registrado", async (_, id, role) => {
      const antes = await prisma.exportacaoDados.count();
      logar(id, "e1", role);
      const r = await baixar();
      expect(r.status).toBe(403);
      expect((await r.json()).erro).toMatch(/administrador/);
      expect(await prisma.exportacaoDados.count()).toBe(antes);
    });
    it("sem sessão: 401; o histórico também é só do administrador", async () => {
      sessao.atual = null;
      expect((await baixar()).status).toBe(401);
      logar("e1-op", "e1", "OPERADOR");
      const mod = await import("@/app/api/configuracoes/exportar-dados/route");
      expect((await mod.GET()).status).toBe(403);
    });
  });

  describe("a trilha", () => {
    it("registrada ANTES do 1º byte; concluída no fim com as contagens; o histórico mostra só a empresa", async () => {
      logar("e1-admin", "e1");
      await prisma.exportacaoDados.deleteMany({});
      const res = await baixar("cadastros");
      const leitor = res.body!.getReader();
      await leitor.read();
      const [aberta] = await prisma.exportacaoDados.findMany();
      expect(aberta).toMatchObject({ empresaId: "e1", usuarioId: "e1-admin", usuarioNome: "Admin EMPRESA-A", parte: "cadastros", concluidaEm: null, erro: null });
      while (!(await leitor.read()).done);
      const fechada = await prisma.exportacaoDados.findUnique({ where: { id: aberta.id } });
      expect(fechada.concluidaEm).toBeInstanceOf(Date);
      expect(fechada.arquivos).toBe(13); // LEIA-ME + 12 cadastros
      expect(fechada.linhas).toBeGreaterThan(10);

      logar("e2-admin", "e2");
      await (await baixar("financeiro")).arrayBuffer();
      logar("e1-admin", "e1");
      const mod = await import("@/app/api/configuracoes/exportar-dados/route");
      const { exportacoes } = await (await mod.GET()).json();
      expect(exportacoes.map((x: any) => x.parte)).toEqual(["cadastros"]);
    });

    it("download interrompido: fica registrado como não concluído", async () => {
      logar("e1-admin", "e1");
      await prisma.exportacaoDados.deleteMany({});
      const res = await baixar();
      const leitor = res.body!.getReader();
      await leitor.read();
      await leitor.cancel();
      const [r] = await prisma.exportacaoDados.findMany();
      expect(r.concluidaEm).toBeNull();
      expect(r.erro).toMatch(/interrompido/);
    });
  });

  it("volume grande simulado: 30 mil contas em lotes; o download começa antes de o banco ser lido inteiro", async () => {
    const N = 30_000;
    execFileSync("psql", [URL_PG!, "-q", "-c", `
      SET search_path = ${SCHEMA};
      INSERT INTO contas_pagar (id, empresa_id, numero, fornecedor, descricao, valor_total, valor_pago, saldo_restante, status, criado_em, atualizado_em)
      SELECT 'gp-' || lpad(g::text, 6, '0'), 'e1', 'CP-G' || g, 'Fornecedor em massa', 'Despesa ' || g || '; com "aspas"', g, 0, g, 'PENDENTE', now(), now()
      FROM generate_series(1, ${N}) g;
      INSERT INTO contas_pagar (id, empresa_id, numero, fornecedor, descricao, valor_total, valor_pago, saldo_restante, status, criado_em, atualizado_em)
      SELECT 'gq-' || lpad(g::text, 6, '0'), 'e2', 'CP-H' || g, 'EMPRESA-B em massa', 'x', 1, 0, 1, 'PENDENTE', now(), now()
      FROM generate_series(1, 2000) g;`], { stdio: "pipe" });

    const { LOTE } = await import("@/lib/exportacao/servidor");
    const original = prisma.contaPagar.findMany.bind(prisma.contaPagar);
    const espia = vi.spyOn(prisma.contaPagar, "findMany").mockImplementation((a: unknown) => original(a));
    logar("e1-admin", "e1");
    const t0 = Date.now();
    const res = await baixar("financeiro");
    const leitor = res.body!.getReader();
    const pedacos: Uint8Array[] = [];
    let chamadasNoPrimeiroPedacoDoArquivo: number | null = null;
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      pedacos.push(value);
      // Assim que o 19-contas-pagar começa a sair, o banco ainda não foi lido inteiro
      if (chamadasNoPrimeiroPedacoDoArquivo === null && espia.mock.calls.length > 0) chamadasNoPrimeiroPedacoDoArquivo = espia.mock.calls.length;
    }
    const ms = Date.now() - t0;
    const chamadas = espia.mock.calls.map((c) => c[0]);
    espia.mockRestore();

    // Em lotes: nenhuma consulta pede mais que LOTE, todas filtram a empresa e andam pelo cursor
    expect(chamadas.length).toBeGreaterThanOrEqual(Math.ceil((N + 1) / LOTE));
    for (const c of chamadas) {
      expect(c.take).toBe(LOTE);
      expect(c.where.empresaId).toBe("e1");
    }
    // O 1º pedaço comprimido sai quando o zlib junta ~16 KB: alguns lotes, muito antes do fim da leitura
    expect(chamadasNoPrimeiroPedacoDoArquivo).toBeGreaterThan(0);
    expect(chamadasNoPrimeiroPedacoDoArquivo!).toBeLessThan(chamadas.length / 4);
    expect(pedacos.length).toBeGreaterThan(20);

    const bytes = new Uint8Array(pedacos.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of pedacos) { bytes.set(p, o); o += p.length; }
    const arquivos = abrirZip(bytes);
    const linhas = comoObjetos(arquivos["19-contas-pagar.csv"]);
    expect(linhas).toHaveLength(N + 1);
    expect(new Set(linhas.map((l) => l.id_sistema)).size).toBe(N + 1);
    expect(linhas.find((l) => l.id_sistema === "gp-012345")?.descricao).toBe('Despesa 12345; com "aspas"');
    expect(arquivos["19-contas-pagar.csv"]).not.toContain("EMPRESA-B");
    console.log(`[volume] ${N + 1} contas a pagar em ${ms} ms, ${chamadas.length} consultas, zip de ${(bytes.length / 1024).toFixed(0)} KB`);
  });

  it("o SQL de produção: 2×, aditivo, igual ao Prisma", () => {
    const s2 = `${SCHEMA}_sql`;
    const urlS2 = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${s2}`;
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s2} CASCADE; CREATE SCHEMA ${s2};`], { stdio: "pipe" });
    try {
      execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: urlS2 }, stdio: "pipe" });
      // Produção HOJE: sem a tabela
      const psql = (args: string[]) => execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
        env: { ...process.env, PGOPTIONS: `--search_path=${s2} --client_min_messages=warning` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      psql(["-c", "DROP TABLE exportacoes_dados;"]);
      psql(["-f", SQL]);
      psql(["-c", "INSERT INTO empresas (id, nome, cnpj, email, atualizado_em) VALUES ('e9', 'X', '1', 'x@x', now()); INSERT INTO exportacoes_dados (id, empresa_id, usuario_id, usuario_nome, parte) VALUES ('x1', 'e9', 'u', 'U', 'tudo');"]);
      psql(["-f", SQL]);
      expect(psql(["-c", "SELECT count(*) FROM exportacoes_dados"])).toBe("1");
      // Apagar a empresa leva o histórico junto (sem órfão)
      psql(["-c", "DELETE FROM empresas WHERE id = 'e9'"]);
      expect(psql(["-c", "SELECT count(*) FROM exportacoes_dados"])).toBe("0");
      const diff = execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["migrate", "diff", "--from-url", urlS2, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
        { cwd: RAIZ, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: urlS2 } });
      expect(diff.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
      const comandos = readFileSync(SQL, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      // "ON DELETE/UPDATE CASCADE" é da chave estrangeira; fora disso, nada apaga, atualiza ou altera outra tabela
      expect(comandos).not.toMatch(/\bDROP\b|(?<!ON )\bDELETE\b|\bTRUNCATE\b|(?<!ON )\bUPDATE\b|\bALTER TABLE (?!"exportacoes_dados")/i);
    } finally {
      execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${s2} CASCADE;`], { stdio: "pipe" });
    }
  });
});
