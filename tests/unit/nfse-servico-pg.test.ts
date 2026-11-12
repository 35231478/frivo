/**
 * NFS-e PR2 — dados fiscais do serviço pelas rotas REAIS do cadastro e da planilha, com o Prisma num
 * PostgreSQL real (schema do Prisma = o que o SQL de produção cria):
 *  - criar/editar com os campos fiscais (normalizados: "1401" → "14.01", "4321-5/00" → "4321500");
 *  - salvar SEM dado fiscal continua valendo (só a emissão, na PR3, exige); o padrão é tributável/não retido;
 *  - inválidos = 400 (LC 116, CNAE, alíquota > 100, tributação fora da lista);
 *  - RBAC: sem Financeiro › Fiscal, quem gerencia o cadastro edita nome/preço mas NÃO os dados fiscais
 *    (403 e nada gravado), mesmo mandando o mesmo valor junto com outro campo (passa) ou um valor novo (barra);
 *    o ADMIN pode; outra empresa = 404; a planilha recusa a linha com dado fiscal sem a permissão;
 *  - o que ficou gravado monta o objeto `servico` do PlugNotas (pronto para a PR3).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nfse-servico-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { gerarXlsx } from "@/lib/folha/planilha";
import { servicoPlugNotas } from "@/lib/nfse/servico";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nfse_servico_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const GESTOR_FISCAL = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });
const SO_FISCAL = montarPermissoes({ financeiro: ["visualizar", "fiscal"] });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes, o: { empresaId?: string; role?: string } = {}) => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const criar = (corpo: unknown) => chamar("cadastros/[entidade]", "POST", { entidade: "servicos" }, corpo);
const editar = (id: string, corpo: unknown) => chamar("cadastros/[entidade]/[id]", "PATCH", { entidade: "servicos", id }, corpo);
async function importar(linhas: string[][]) {
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const fd = new FormData();
  fd.append("arquivo", new File([new Uint8Array(gerarXlsx([{ nome: "Dados", linhas }]))], "dados.xlsx"));
  fd.append("etapa", "confirmar");
  const res: Response = await mod.POST(new NextRequest("http://localhost/x", { method: "POST", body: fd }), { params: Promise.resolve({ entidade: "servicos" }) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const MSG_403 = "Sem permissão para alterar: Código do serviço (LC 116), CNAE. Exige a permissão Financeiro › Fiscal (NFS-e).";

describe.skipIf(!URL_PG)("NFS-e: dados fiscais do serviço (PostgreSQL real)", () => {
  let prisma: any;
  const gravado = (id: string) => prisma.servico.findUnique({ where: { id } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["cadastros/[entidade]", "cadastros/[entidade]/[id]", "importacao/[entidade]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.servico.createMany({ data: [
      { id: "s1", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza de split", unidade: "un", codigoLc116: "14.01", aliquotaISS: 5 },
      { id: "sB", empresaId: "e2", codigo: "LIMP01", nome: "Da outra", unidade: "un" },
    ] });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(() => logar(GESTOR_FISCAL));

  it("serviço existente (antes do SQL) fica sem os dados novos: não retido, tributação vazia = padrão", async () => {
    const s = await gravado("s1");
    expect([s.nfseTributacao, s.issRetido, s.cnae, s.discriminacaoPadrao]).toEqual([null, false, null, null]);
  });

  it("criar com os dados fiscais: normaliza e grava; a resposta traz os campos", async () => {
    const r = await criar({
      nome: "Instalação de split", codigoLc116: "1406", codigoMunicipal: " 140601 ", aliquotaISS: "2,5", nfseTributacao: "ISENTO",
      issRetido: "true", cnae: "4322-3/02", discriminacaoPadrao: "Instalação conforme proposta",
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ codigoLc116: "14.06", codigoMunicipal: "140601", nfseTributacao: "ISENTO", issRetido: true, cnae: "4322302", discriminacaoPadrao: "Instalação conforme proposta" });
    const s = await gravado(r.json.id);
    expect(Number(s.aliquotaISS)).toBe(2.5);
    expect(servicoPlugNotas({ ...s, aliquotaISS: Number(s.aliquotaISS) }, { valor: 900 })).toEqual({
      codigo: "14.06", codigoTributacao: "140601", discriminacao: "Instalação conforme proposta", cnae: "4322302",
      iss: { tipoTributacao: 1, exigibilidade: 3, aliquota: 2.5, retido: true }, responsavelRetencao: 1, valor: { servico: 900 },
    });
  });

  it("criar sem nenhum dado fiscal continua valendo (só a emissão exige)", async () => {
    const r = await criar({ nome: "Visita técnica", nfseTributacao: "", issRetido: "false", cnae: "", codigoLc116: "" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ codigoLc116: null, nfseTributacao: null, issRetido: false, cnae: null, aliquotaISS: null });
  });

  it("inválidos = 400 com a mensagem do campo, nada gravado", async () => {
    const antes = await prisma.servico.count();
    expect(await criar({ nome: "X", codigoLc116: "14-01" })).toMatchObject({ status: 400, json: { erro: expect.stringMatching(/^Código do serviço \(LC 116\): Código LC 116 inválido/) } });
    expect(await criar({ nome: "X", cnae: "43221" })).toMatchObject({ status: 400, json: { erro: expect.stringMatching(/^CNAE: CNAE inválido/) } });
    expect(await criar({ nome: "X", aliquotaISS: 101 })).toMatchObject({ status: 400, json: { erro: "Alíquota de ISS (%): Alíquota de ISS deve estar entre 0 e 100%." } });
    expect(await criar({ nome: "X", nfseTributacao: "TRIBUTAVEL_FORA" })).toMatchObject({ status: 400, json: { erro: "Tributação do ISS: Tributação do ISS inválida." } });
    expect((await editar("s1", { aliquotaISS: "100,01" })).status).toBe(400);
    expect(await prisma.servico.count()).toBe(antes);
    expect(Number((await gravado("s1")).aliquotaISS)).toBe(5);
  });

  it("editar: parcial, normaliza e limpa", async () => {
    expect((await editar("s1", { codigoLc116: "7.02", nfseTributacao: "SUSPENSA_JUDICIAL" })).status).toBe(200);
    let s = await gravado("s1");
    expect([s.codigoLc116, s.nfseTributacao, s.nome, Number(s.aliquotaISS)]).toEqual(["07.02", "SUSPENSA_JUDICIAL", "Limpeza de split", 5]);
    expect((await editar("s1", { codigoLc116: "14.01", nfseTributacao: "", aliquotaISS: "" })).status).toBe(200);
    s = await gravado("s1");
    expect([s.codigoLc116, s.nfseTributacao, s.aliquotaISS]).toEqual(["14.01", null, null]);
    await prisma.servico.update({ where: { id: "s1" }, data: { aliquotaISS: 5 } });
  });

  it("sem Financeiro › Fiscal: edita nome/preço, mas dado fiscal NOVO = 403 e nada gravado", async () => {
    logar(GESTOR);
    expect((await editar("s1", { nome: "Limpeza de split 9000", valorPadrao: 120 })).status).toBe(200);
    const r = await editar("s1", { nome: "Outro nome", codigoLc116: "14.02", cnae: "4322302" });
    expect(r).toEqual({ status: 403, json: { erro: MSG_403 } });
    const s = await gravado("s1");
    expect([s.nome, s.codigoLc116, s.cnae]).toEqual(["Limpeza de split 9000", "14.01", null]);
    // mandar o MESMO valor junto (formulário antigo, planilha) não é mudança
    expect((await editar("s1", { codigoLc116: "1401", aliquotaISS: 5, issRetido: "false", nome: "Limpeza de split" })).status).toBe(200);
    expect((await editar("s1", { issRetido: "true" })).json.erro).toBe("Sem permissão para alterar: ISS retido pelo tomador. Exige a permissão Financeiro › Fiscal (NFS-e).");
    expect((await editar("s1", { aliquotaISS: "" })).status).toBe(403);
  });

  it("sem Financeiro › Fiscal: criar com dado fiscal = 403; com os padrões = 201", async () => {
    logar(GESTOR);
    const antes = await prisma.servico.count();
    expect(await criar({ nome: "Novo", codigoLc116: "14.01", cnae: "4322-3/02" })).toEqual({ status: 403, json: { erro: MSG_403 } });
    expect(await prisma.servico.count()).toBe(antes);
    // o formulário sem permissão manda os campos travados com os valores padrão
    const r = await criar({ nome: "Novo sem fiscal", codigoLc116: "", codigoMunicipal: "", aliquotaISS: "", nfseTributacao: "", issRetido: "false", cnae: "", discriminacaoPadrao: "" });
    expect(r.status).toBe(201);
  });

  it("ADMIN pode tudo; quem só tem o Fiscal (sem gerenciar cadastros) não edita o serviço; outra empresa = 404", async () => {
    logar(GESTOR, { role: "ADMIN" });
    expect((await editar("s1", { cnae: "4321500" })).status).toBe(200);
    logar(SO_FISCAL);
    expect((await editar("s1", { cnae: "4322302" })).status).toBe(403);
    expect((await gravado("s1")).cnae).toBe("4321500");
    logar(GESTOR_FISCAL);
    expect((await editar("sB", { cnae: "4322302" })).status).toBe(404);
    expect((await gravado("sB")).cnae).toBeNull();
  });

  it("planilha: sem o Fiscal, linha com dado fiscal vira erro (nada gravado); com ele, grava normalizado", async () => {
    const cab = ["nome", "codigo_lc116", "aliquota_iss"];
    logar(GESTOR);
    const r = await importar([cab, ["Pintura", "1401", "3"], ["Sem fiscal", "", ""]]);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ criados: 1, comErro: 1 });
    expect(await prisma.servico.findFirst({ where: { nome: "Pintura" } })).toBeNull();
    logar(GESTOR_FISCAL);
    expect((await importar([cab, ["Pintura", "1401", "3"]])).json).toMatchObject({ criados: 1, comErro: 0 });
    const p = await prisma.servico.findFirst({ where: { nome: "Pintura", empresaId: "e1" } });
    expect([p.codigoLc116, Number(p.aliquotaISS)]).toEqual(["14.01", 3]);
  });
});
