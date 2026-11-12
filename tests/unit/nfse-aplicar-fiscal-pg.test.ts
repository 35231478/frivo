/**
 * NFS-e — "Aplicar dados fiscais (NFS-e)" em massa pela rota REAL /api/acoes-massa, com o Prisma num
 * PostgreSQL real:
 *  - só os campos preenchidos são gravados (o resto do serviço fica como estava), já normalizados;
 *  - serviço que já estava assim conta como aplicado ("Já estava assim") e não é regravado;
 *  - CNAE null = "usar o CNAE principal da empresa" (limpa o CNAE próprio);
 *  - id de outra empresa = "não encontrado" e intacto; resultado parcial "N aplicados · M não puderam";
 *  - RBAC na chamada: sem Financeiro › Fiscal ou sem Configurações › Gerenciar = 403 sem tocar no banco; ADMIN passa;
 *  - inválido, vazio ou campo que não é fiscal = 400 sem tocar no banco (validação do cadastro, uma vez só);
 *  - o log registra os campos aplicados (nunca os valores).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nfse-aplicar-fiscal-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nfse_aplicar_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const GESTOR_FISCAL = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });
const SO_FISCAL = montarPermissoes({ configuracoes: ["visualizar"], financeiro: ["visualizar", "fiscal"] });
const VE_FINANCEIRO = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar"] });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes, o: { empresaId?: string; role?: string } = {}) => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes } };
};

async function aplicar(ids: string[], dados?: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const mod = await import("@/app/api/acoes-massa/route");
  const corpo = { entidade: "servicos", acao: "aplicar-fiscal", ids, ...(dados !== undefined && { dados }), ...extra };
  const res: Response = await mod.POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const BASE = { unidade: "un", nfseTributacao: null, issRetido: false, discriminacaoPadrao: null, aliquotaISS: null, codigoMunicipal: null, cnae: null, codigoLc116: null };
const SEED = [
  { id: "s1", empresaId: "e1", codigo: "HIG", nome: "Higienização", ...BASE, codigoLc116: "14.01", codigoMunicipal: "140101", valorPadrao: 150, aliquotaPIS: 0.65 },
  { id: "s2", empresaId: "e1", codigo: "INS", nome: "Instalação", ...BASE, cnae: "4321500", aliquotaISS: 2 },
  { id: "s3", empresaId: "e1", codigo: "REC", nome: "Recarga de gás", ...BASE, issRetido: true, discriminacaoPadrao: "Recarga" },
  { id: "s4", empresaId: "e1", codigo: "OLD", nome: "Desativado", ...BASE, ativo: false },
  { id: "sB", empresaId: "e2", codigo: "HIG", nome: "Da outra empresa", ...BASE },
];

describe.skipIf(!URL_PG)("NFS-e: aplicar dados fiscais em massa (PostgreSQL real)", () => {
  let prisma: any;
  let log: ReturnType<typeof vi.spyOn>;
  const gravado = (id: string) => prisma.servico.findUnique({ where: { id } });
  const todos = async () => (await prisma.servico.findMany({ orderBy: { id: "asc" } })).map((s: any) => ({ ...s, atualizadoEm: undefined }));
  const eventos = () => log.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0]))).filter((e: any) => e.evento === "acao_em_massa");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await import("@/app/api/acoes-massa/route");
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com", cnaePrincipal: "4322302" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    await prisma.servico.deleteMany({});
    await prisma.servico.createMany({ data: SEED });
    logar(GESTOR_FISCAL);
    log = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  it("grava só os campos preenchidos, normalizados; o resto do serviço fica como estava", async () => {
    const antes = await gravado("s1");
    const r = await aplicar(["s1", "s2", "s3"], { codigoLc116: "1406", aliquotaISS: "3,5", codigoMunicipal: "", discriminacaoPadrao: "  " });
    expect(r.status).toBe(200);
    expect(r.json.resumo).toEqual({ total: 3, feitas: 3, naoPuderam: 0 });
    for (const id of ["s1", "s2", "s3"]) {
      const s = await gravado(id);
      expect(s.codigoLc116).toBe("14.06");
      expect(Number(s.aliquotaISS)).toBe(3.5);
    }
    const s1 = await gravado("s1");
    // Vazios não mexeram em nada; campos de fora do formulário intactos
    expect(s1).toMatchObject({ codigoMunicipal: "140101", nome: "Higienização", codigo: "HIG", unidade: "un", cnae: null, issRetido: false });
    expect(Number(s1.valorPadrao)).toBe(Number(antes.valorPadrao));
    expect(Number(s1.aliquotaPIS)).toBe(0.65);
    expect((await gravado("s2")).cnae).toBe("4321500");
    expect(await gravado("s3")).toMatchObject({ issRetido: true, discriminacaoPadrao: "Recarga" });
    expect(r.json.resultados.map((x: any) => [x.id, x.rotulo, x.ok, x.detalhe])).toEqual([
      ["s1", "Higienização", true, "Atualizado: Código do serviço (LC 116), Alíquota de ISS (%)"],
      ["s2", "Instalação", true, "Atualizado: Código do serviço (LC 116), Alíquota de ISS (%)"],
      ["s3", "Recarga de gás", true, "Atualizado: Código do serviço (LC 116), Alíquota de ISS (%)"],
    ]);
  });

  it("o que já está igual não é regravado: 'Já estava assim' (conta como aplicado); o detalhe lista só o que mudou", async () => {
    const antes = (await gravado("s1")).atualizadoEm;
    const r = await aplicar(["s1", "s2"], { codigoLc116: "14.01", codigoMunicipal: "140101" });
    expect(r.json.resumo).toEqual({ total: 2, feitas: 2, naoPuderam: 0 });
    expect(r.json.resultados[0]).toMatchObject({ id: "s1", ok: true, detalhe: "Já estava assim" });
    expect(r.json.resultados[1]).toMatchObject({ id: "s2", ok: true, detalhe: "Atualizado: Código do serviço (LC 116), Código municipal" });
    expect((await gravado("s1")).atualizadoEm).toEqual(antes);
  });

  it("CNAE null = usar o CNAE principal da empresa: limpa o CNAE próprio; CNAE próprio formatado grava os 7 dígitos", async () => {
    let r = await aplicar(["s2"], { cnae: null });
    expect(r.json.resultados[0]).toMatchObject({ ok: true, detalhe: "Atualizado: CNAE" });
    expect((await gravado("s2")).cnae).toBeNull();
    r = await aplicar(["s1", "s2"], { cnae: "4321-5/00" });
    expect(r.json.resumo.feitas).toBe(2);
    expect((await gravado("s1")).cnae).toBe("4321500");
    expect((await gravado("s2")).cnae).toBe("4321500");
  });

  it("copiar de um modelo: tributação 'Tributável' (padrão) grava vazio e retido 'não' desmarca", async () => {
    await prisma.servico.update({ where: { id: "s2" }, data: { nfseTributacao: "ISENTO" } });
    const r = await aplicar(["s1", "s2", "s3"], { codigoLc116: "14.01", cnae: null, nfseTributacao: "TRIBUTAVEL", issRetido: "false" });
    expect(r.json.resultados.map((x: any) => x.detalhe)).toEqual([
      "Já estava assim",
      "Atualizado: Código do serviço (LC 116), CNAE, Tributação do ISS",
      "Atualizado: Código do serviço (LC 116), ISS retido pelo tomador",
    ]);
    expect(await gravado("s2")).toMatchObject({ nfseTributacao: null, cnae: null, codigoLc116: "14.01" });
    expect((await gravado("s3")).issRetido).toBe(false);
  });

  it("id de outra empresa no meio: 'não encontrado' e intacto; resultado parcial", async () => {
    const outra = await gravado("sB");
    const r = await aplicar(["s1", "sB", "nao-existe"], { aliquotaISS: "5" });
    expect(r.json.resumo).toEqual({ total: 3, feitas: 1, naoPuderam: 2 });
    expect(r.json.resultados[1]).toMatchObject({ id: "sB", ok: false, codigo: "nao_encontrado" });
    expect(r.json.resultados[2]).toMatchObject({ id: "nao-existe", ok: false, codigo: "nao_encontrado" });
    expect(await gravado("sB")).toEqual(outra);
    expect(Number((await gravado("s1")).aliquotaISS)).toBe(5);
  });

  it("a empresa vem da sessão: logado na outra empresa, os serviços desta são 'não encontrado'", async () => {
    logar(GESTOR_FISCAL, { empresaId: "e2" });
    const antes = await todos();
    const r = await aplicar(["s1", "sB"], { codigoLc116: "14.06" });
    expect(r.json.resultados.map((x: any) => [x.id, x.ok])).toEqual([["s1", false], ["sB", true]]);
    expect((await gravado("s1")).codigoLc116).toBe("14.01");
    expect((await gravado("sB")).codigoLc116).toBe("14.06");
    expect((await todos()).filter((s: any) => s.id !== "sB")).toEqual(antes.filter((s: any) => s.id !== "sB"));
  });

  it("serviço inativo também recebe (a edição individual permite)", async () => {
    const r = await aplicar(["s4"], { codigoLc116: "14.01" });
    expect(r.json.resultados[0]).toMatchObject({ ok: true });
    expect((await gravado("s4")).codigoLc116).toBe("14.01");
  });

  it("RBAC: sem Financeiro › Fiscal, ou sem Configurações › Gerenciar = 403 e nada gravado; ADMIN passa", async () => {
    const antes = await todos();
    for (const p of [GESTOR, SO_FISCAL, VE_FINANCEIRO, montarPermissoes({})]) {
      logar(p);
      const r = await aplicar(["s1", "s2"], { codigoLc116: "14.06" });
      expect(r.status).toBe(403);
      expect(r.json.erro).toBe("Sem permissão para esta ação");
    }
    expect(await todos()).toEqual(antes);
    expect(eventos().map((e: any) => e.recusado)).toEqual(["sem_permissao", "sem_permissao", "sem_permissao", "sem_permissao"]);
    logar({}, { role: "ADMIN" });
    const r = await aplicar(["s1", "s2"], { codigoLc116: "14.06" });
    expect(r.json.resumo.feitas).toBe(2);
  });

  it("sem login: 401", async () => {
    sessao.atual = null;
    expect((await aplicar(["s1"], { codigoLc116: "14.06" })).status).toBe(401);
  });

  it("inválido, vazio ou campo que não é fiscal = 400 com a mensagem, sem tocar em nenhum serviço", async () => {
    const antes = await todos();
    const casos: [Record<string, unknown> | undefined, RegExp | string][] = [
      [undefined, "Preencha ao menos um campo para aplicar."],
      [{}, "Preencha ao menos um campo para aplicar."],
      [{ codigoLc116: "", aliquotaISS: " " }, "Preencha ao menos um campo para aplicar."],
      [{ codigoLc116: "14.06", nome: "Trocado" }, "Campo não permitido: nome."],
      [{ codigoLc116: "14.06", empresaId: "e2" }, "Campo não permitido: empresaId."],
      [{ codigoLc116: "14.06", aliquotaISS: "150" }, /^Alíquota de ISS \(%\): /],
      [{ cnae: "12" }, /^CNAE: /],
      [{ codigoLc116: "99.99" }, /^Código do serviço \(LC 116\): /],
    ];
    for (const [dados, msg] of casos) {
      const r = await aplicar(["s1", "s2"], dados);
      expect(r.status, JSON.stringify(dados)).toBe(400);
      if (typeof msg === "string") expect(r.json.erro).toBe(msg); else expect(r.json.erro).toMatch(msg);
    }
    expect(await todos()).toEqual(antes);
  });

  it("dados num formato que não é objeto: 400 (requisição inválida)", async () => {
    const r = await aplicar(["s1"], undefined, { dados: ["codigoLc116"] });
    expect(r.status).toBe(400);
    expect(r.json.erro).toBe("Requisição inválida");
  });

  it("o log registra quem, a ação, os campos aplicados (sem os valores) e o resumo", async () => {
    await aplicar(["s1", "sB"], { codigoLc116: "14.06", discriminacaoPadrao: "Texto que não vai para o log" });
    const [e] = eventos();
    expect(e).toMatchObject({ usuarioId: "u1", empresaId: "e1", entidade: "servicos", acao: "aplicar-fiscal", total: 2, feitas: 1, naoPuderam: 1, campos: ["codigoLc116", "discriminacaoPadrao"] });
    expect(JSON.stringify(e)).not.toContain("Texto que não vai para o log");
  });

  describe("o executor de cada serviço confere de novo (defesa além da rota)", () => {
    const ctx = (o: Record<string, unknown> = {}) => ({ empresaId: "e1", usuarioId: "u1", usuarioNome: "Ana", origem: "massa" as const, role: "OPERADOR", permissoes: GESTOR_FISCAL, ...o });
    const executor = async () => (await import("@/lib/acoes-massa/fiscal-servicos")).aplicarFiscalServico;

    it("serviço de outra empresa: não encontrado e intacto", async () => {
      const antes = await gravado("sB");
      expect(await (await executor())("sB", ctx({ dados: { codigoLc116: "14.06" } }))).toMatchObject({ ok: false, codigo: "nao_encontrado" });
      expect(await gravado("sB")).toEqual(antes);
      // Nem "já estava assim" (que confirmaria que o serviço existe): é não encontrado mesmo
      expect(await (await executor())("sB", ctx({ dados: { nfseTributacao: null } }))).toMatchObject({ ok: false, codigo: "nao_encontrado" });
    });

    it("sem Financeiro › Fiscal: a trava por campo do cadastro recusa (sem_permissao) e nada é gravado", async () => {
      const r = await (await executor())("s1", ctx({ permissoes: GESTOR, dados: { codigoLc116: "14.06" } }));
      expect(r).toMatchObject({ ok: false, codigo: "sem_permissao" });
      expect((r as any).motivo).toContain("Financeiro › Fiscal");
      expect((await gravado("s1")).codigoLc116).toBe("14.01");
    });

    it("valor inválido que chegue direto: recusado pela validação do cadastro (invalido)", async () => {
      const r = await (await executor())("s1", ctx({ dados: { codigoLc116: "99.99" } }));
      expect(r).toMatchObject({ ok: false, codigo: "invalido" });
      expect((await gravado("s1")).codigoLc116).toBe("14.01");
    });
  });

  it("as outras ações da lista de serviços continuam sem formulário (inativar ignora 'dados')", async () => {
    const mod = await import("@/app/api/acoes-massa/route");
    const res: Response = await mod.POST(new NextRequest("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entidade: "servicos", acao: "inativar", ids: ["s1"] }) }));
    expect(res.status).toBe(200);
    expect((await gravado("s1")).ativo).toBe(false);
    expect(eventos()[0]).not.toHaveProperty("campos");
  });
});
