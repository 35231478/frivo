/**
 * pj4 — pontas da Leva I / I.2, Prisma real, PostgreSQL real, rotas reais (dados fictícios):
 *  F01 faturar o ORÇAMENTO com a OS gerada espera a conferência do material de campo ("Cobrado à parte"), como a OS;
 *  F02 os CSV de contas a receber e de OS saem com o apóstrofo na célula que começa com = + - @ (números não);
 *  F07 conferir o material de campo segue a trava do preço de tabela (403 sem a permissão; 400 pede o motivo; trilha);
 *  F08 o histórico da empresa na área do dono do Frivo não mostra o preço de tabela alterado na fatura (PRECO_TABELA_FATURA);
 *  F10 Configurações › Dados da empresa: CNPJ trocado precisa ser válido e único (409 com a mensagem da casa).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pj4-levai-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_TRAVA_FATURAR_CAMPO } from "@/lib/os/material-campo-cobranca";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pj4_levai_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const como = (permissoes: Permissoes = permissoesTotais(), role = "ADMIN", id = "uA") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@clima.test`, empresaId: "e1", role, permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, busca = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${busca}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json().catch(() => null) : null, texto: tipo.includes("csv") ? await res.text() : null };
}

describe.skipIf(!URL_PG)("pj4 — pontas da Leva I / I.2 (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens/[id]/orcamento/[itemId]/conferir-campo", "empresa", "contas-receber/exportar", "ordens/export"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      // e1 com um CNPJ antigo inválido (cadastro de antes da validação): salvar os outros campos continua valendo
      { id: "e1", nome: "Clima Total (fictícia)", cnpj: "12.345.678/0001-90", email: "contato@clima.test" },
      { id: "e2", nome: "Outra (fictícia)", cnpj: "11.222.333/0001-81", email: "outra@x.test" },
    ] });
    await prisma.configuracao.create({ data: { empresaId: "e1", orcamentoCobrancaMateriais: "A_PARTE" } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "ana@clima.test", senha: "x", role: "ADMIN" },
      { id: "uO", empresaId: "e1", nome: "Otávio", email: "otavio@clima.test", senha: "x", role: "OPERADOR" },
    ] });
    await prisma.produto.create({ data: { id: "pCap", empresaId: "e1", codigo: 104, nome: "Capacitor 35 µF", unidade: "un", valorPadrao: 45 } });
    await prisma.tabelaPreco.create({ data: { id: "tab1", empresaId: "e1", nome: "Contrato Hospital (fictício)" } });
    await prisma.tabelaPrecoItem.create({ data: { tabelaId: "tab1", produtoId: "pCap", valorFinal: 60 } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital (fictício)", cpfCnpj: "1", tabelaPrecoId: "tab1" },
      { id: "cX", empresaId: "e1", nome: "=HYPERLINK(\"http://x.test\";\"Clique\")", cpfCnpj: "2" },
    ] });
    await prisma.orcamento.create({ data: { id: "orc1", empresaId: "e1", codigo: "ORC-1", nome: "Instalação", clienteId: "c1", criadoPorId: "uA", tokenPublico: "tk-orc1", status: "APROVADO", totalGeral: 500, equipamentosCobertos: [] } });
    await prisma.orcamentoServico.create({ data: { orcamentoId: "orc1", descricao: "Instalação split", quantidade: 1, valorUnitario: 500, valorTotal: 500, ordem: 0 } });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-0101", clienteId: "c1", criadoPorId: "uA", descricao: "Instalação", orcamentoOrigemId: "orc1", status: "CONCLUIDA" },
      { id: "osX", empresaId: "e1", numero: "OS-0102", clienteId: "cX", criadoPorId: "uA", descricao: "Manutenção" },
    ] });
    // o material lançado em campo, a conferir (o servidor pôs o preço da tabela do cliente: 60)
    await prisma.atividadeOs.create({ data: { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Instalação", status: "CONCLUIDA" } });
    await prisma.atividadeMaterial.createMany({ data: ["mc1", "mc2"].map((id) => ({ id, empresaId: "e1", ordemServicoId: "os1", atividadeId: "a1", produtoId: "pCap", descricao: "Capacitor 35 µF", quantidade: 1, clientId: id })) });
    await prisma.osItemOrcamento.createMany({ data: [
      { id: "iCampo", ordemServicoId: "os1", tipo: "PRODUTO", produtoId: "pCap", descricao: "Capacitor 35 µF", quantidade: 2, valorUnitario: 60, valorTotal: 120, executado: true, ordem: 1, materialCampoId: "mc1", conferirCampo: true },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("F01: faturar o orçamento com a OS gerada e material de campo a conferir é bloqueado com a mensagem da OS", async () => {
    const { faturarOrcamento } = await import("@/lib/faturamento/faturar-server");
    expect(await faturarOrcamento({ empresaId: "e1", usuarioId: "uA", orcamentoId: "orc1" })).toEqual({ tipo: "bloqueado", erro: MSG_TRAVA_FATURAR_CAMPO });
    expect(await prisma.medicao.count()).toBe(0);
  });

  it("F07: conferir com o preço fora da tabela — sem a permissão 403; com ela, pede o motivo (400) e deixa a trilha", async () => {
    // Otávio edita OS, mas não tem "Alterar preço de tabela"
    como(montarPermissoes({ ordens: ["visualizar", "editar"] }), "OPERADOR", "uO");
    const negado = await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "os1", itemId: "iCampo" }, { acao: "confirmar", quantidade: 2, valorUnitario: 50 });
    expect(negado.status).toBe(403);
    expect(negado.json).toMatchObject({ precoTabela: true });
    expect(negado.json.erro).toContain("Alterar preço de tabela");
    como();
    const semMotivo = await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "os1", itemId: "iCampo" }, { acao: "confirmar", quantidade: 2, valorUnitario: 50 });
    expect(semMotivo).toMatchObject({ status: 400, json: { precoTabela: true } });
    expect(semMotivo.json.erro).toMatch(/^Informe o motivo da alteração do preço de tabela/);
    expect((await prisma.osItemOrcamento.findUnique({ where: { id: "iCampo" } })).conferirCampo).toBe(true);
    const ok = await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "os1", itemId: "iCampo" }, { acao: "confirmar", quantidade: 2, valorUnitario: 50, motivoPrecoTabela: "Desconto negociado" });
    expect(ok.status).toBe(200);
    const it1 = await prisma.osItemOrcamento.findUnique({ where: { id: "iCampo" } });
    expect([Number(it1.valorUnitario), it1.conferirCampo]).toEqual([50, false]);
    const hist = (await prisma.osHistorico.findMany({ where: { ordemServicoId: "os1" }, orderBy: { criadoEm: "asc" } })).map((h: any) => `${h.acao} | ${h.detalhes}`);
    expect(hist).toContain("Preço de tabela alterado | Preço de tabela alterado: Capacitor 35 µF (R$ 60,00 → R$ 50,00). Motivo: Desconto negociado");
  });

  it("F07: confirmar no preço que o servidor pôs (o da tabela) não pede nada, nem a quem não tem a permissão", async () => {
    await prisma.osItemOrcamento.create({ data: { id: "iCampo2", ordemServicoId: "os1", tipo: "PRODUTO", produtoId: "pCap", descricao: "Capacitor 35 µF", quantidade: 1, valorUnitario: 60, valorTotal: 60, executado: true, ordem: 2, materialCampoId: "mc2", conferirCampo: true } });
    como(montarPermissoes({ ordens: ["visualizar", "editar"] }), "OPERADOR", "uO");
    expect((await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "os1", itemId: "iCampo2" }, { acao: "confirmar", quantidade: 3 })).status).toBe(200);
    // nada mais a conferir: o orçamento fatura (a trava do F01 só segura enquanto há o que conferir)
    const { faturarOrcamento } = await import("@/lib/faturamento/faturar-server");
    expect((await faturarOrcamento({ empresaId: "e1", usuarioId: "uA", orcamentoId: "orc1" })).tipo).toBe("criada");
  });

  it("F08: o histórico da empresa (área do dono do Frivo) não traz o preço de tabela alterado na fatura", async () => {
    await prisma.empresaEvento.createMany({ data: [
      { empresaId: "e1", tipo: "DADOS_EDITADOS", detalhe: "Telefone: (vazio) → (11) 4000-0000", criadoEm: new Date("2026-11-20T12:00:00Z") },
      { empresaId: "e1", usuarioId: "uA", tipo: "PRECO_TABELA_FATURA", detalhe: "Fatura MED-1: Capacitor (R$ 60,00 → R$ 50,00). Motivo: desconto", criadoEm: new Date("2026-11-21T12:00:00Z") },
    ] });
    const { detalheDaEmpresa } = await import("@/lib/empresa/criar-empresa");
    const d = await detalheDaEmpresa("e1");
    expect(d!.eventos.map((e) => e.tipo)).toEqual(["DADOS_EDITADOS"]);
    // o evento continua gravado (é da trilha da própria empresa)
    expect(await prisma.empresaEvento.count({ where: { empresaId: "e1", tipo: "PRECO_TABELA_FATURA" } })).toBe(1);
  });

  it("F10: Dados da empresa — CNPJ trocado inválido 400; de outra empresa 409 (a mensagem da casa); o antigo continua salvando o resto", async () => {
    const { MSG_CNPJ_EM_USO } = await import("@/lib/empresa/criar-empresa");
    como();
    expect(await chamar("empresa", "PUT", {}, { cnpj: "11.111.111/1111-11" })).toMatchObject({ status: 400, json: { erro: "CNPJ inválido." } });
    expect(await chamar("empresa", "PUT", {}, { cnpj: "11222333000181" })).toMatchObject({ status: 409, json: { erro: MSG_CNPJ_EM_USO } });
    // o mesmo CNPJ de antes (mesmo inválido, de um cadastro antigo) não impede salvar o telefone
    const r = await chamar("empresa", "PUT", {}, { cnpj: "12.345.678/0001-90", telefone: "(11) 4000-0000" });
    expect(r.status).toBe(200);
    expect(await prisma.empresa.findUnique({ where: { id: "e1" }, select: { cnpj: true, telefone: true } })).toEqual({ cnpj: "12.345.678/0001-90", telefone: "(11) 4000-0000" });
    // um CNPJ válido e livre: grava com a máscara da casa
    expect((await chamar("empresa", "PUT", {}, { cnpj: "45997418000153" })).status).toBe(200);
    expect((await prisma.empresa.findUnique({ where: { id: "e1" } })).cnpj).toBe("45.997.418/0001-53");
  });

  it("F02: os CSV de contas a receber e de OS protegem a célula que começaria uma fórmula (números não)", async () => {
    await prisma.contaReceber.create({ data: { id: "crX", empresaId: "e1", clienteId: "cX", numero: "CR-2026-0009", descricao: "@SUM(1+1)", valor: 100, status: "A_RECEBER", dataVencimento: new Date("2026-11-20T00:00:00Z") } });
    como();
    const cr = await chamar("contas-receber/exportar", "GET", {}, undefined, "?periodo=todos");
    expect(cr.status).toBe(200);
    expect(cr.texto).toContain(`"'=HYPERLINK(""http://x.test"";""Clique"")"`);
    expect(cr.texto).toContain(`"'@SUM(1+1)"`);
    expect(cr.texto).toContain(`"100"`);
    const os = await chamar("ordens/export", "GET", {}, undefined, "?periodo=todos");
    expect(os.status).toBe(200);
    expect(os.texto).toContain(`"'=HYPERLINK(""http://x.test"";""Clique"")"`);
    expect(os.texto).not.toMatch(/;"=HYPERLINK/);
  });
});
