/**
 * Leva 8C — folha e fiscal: as ROTAS num PostgreSQL real (schema descartável).
 *
 * A leva mexeu só na aparência; por ser dinheiro, aqui se prova o que NÃO mudou:
 *  - sem "Financeiro › Custo de pessoal", toda rota de folha responde 403 e o banco fica IDÊNTICO
 *    (foto do mês, dados financeiros do colaborador e cadastro);
 *  - sem "Financeiro › Fiscal", o emitente de NFS-e e a emissão respondem 403, sem tocar no banco;
 *  - sem sessão, 401 — e também nada muda;
 *  - o cálculo da folha é o mesmo de lib/folha/calculo: a foto gravada bate, centavo por centavo,
 *    com calcularCusto sobre os mesmos dados;
 *  - fechar de novo SUBSTITUI a foto da competência (não duplica) e não encosta nas outras;
 *  - nada atravessa de outra empresa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva8c-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { calcularCusto, type ItemEncargo } from "@/lib/folha/calculo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva8c_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana Souza", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

/** Só vê o Financeiro: nem folha, nem fiscal. */
const SO_VE = montarPermissoes({ financeiro: ["visualizar", "contasReceber", "fluxoCaixa"] });

const req = (corpo: unknown) =>
  new NextRequest("http://localhost/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
const reqForm = (form: FormData) => new NextRequest("http://localhost/api/x", { method: "POST", body: form });
const resposta = async (res: Response) => ({ status: res.status, json: await res.json().catch(() => null) });

describe.skipIf(!URL_PG)("Leva 8C — folha e fiscal (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
  }, 240_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  /** Um colaborador CLT com dados de folha, e um modelo de encargos padrão da empresa. */
  beforeEach(async () => {
    await prisma.folhaSnapshot.deleteMany({});
    await prisma.colaboradorFolha.deleteMany({});
    await prisma.tecnico.deleteMany({});
    await prisma.modeloEncargos.deleteMany({});
    await prisma.empresaFiscal.deleteMany({});

    await prisma.modeloEncargos.create({ data: {
      id: "mod1", empresaId: "e1", nome: "CLT com 13º e férias", regime: "CLT", padrao: true,
      itens: [{ nome: "INSS patronal", percentual: 20 }, { nome: "FGTS", percentual: 8 }] as any,
    } });
    await prisma.tecnico.create({ data: {
      id: "t1", empresaId: "e1", nome: "Carlos Dias", cpf: "529.982.247-25", telefone: "11999990000", tipo: "TECNICO_CAMPO", salario: 3200, jornadaDias: ["SEG", "TER"],
      folha: { create: {
        empresaId: "e1", regime: "CLT", horasMes: 220, valeTransporte: 220, descontaVt: true,
        valeAlimentacao: 400, planoSaude: 180, modeloEncargosId: "mod1",
      } },
    } });
    como();
  });

  /* ───────── o retrato: o que não pode mudar quando o servidor recusa ───────── */

  const retrato = async () => ({
    fotos: await prisma.folhaSnapshot.findMany({ orderBy: [{ competencia: "asc" }, { colaboradorId: "asc" }] })
      .then((fs: any[]) => fs.map((f) => [f.competencia, f.colaboradorId, Number(f.custoTotal)])),
    folha: await prisma.colaboradorFolha.findMany({ orderBy: { colaboradorId: "asc" } })
      .then((fs: any[]) => fs.map((f) => [f.colaboradorId, f.regime, Number(f.valeTransporte), Number(f.valeAlimentacao), f.modeloEncargosId])),
    salarios: await prisma.tecnico.findMany({ orderBy: { id: "asc" } }).then((ts: any[]) => ts.map((t) => [t.id, Number(t.salario)])),
    colaboradores: await prisma.tecnico.count(),
    modelos: await prisma.modeloEncargos.count(),
    fiscal: await prisma.empresaFiscal.findMany().then((fs: any[]) => fs.map((f) => [f.empresaId, f.status, f.ambiente, f.certificadoId])),
    notas: await prisma.notaFiscal.count(),
  });

  const fecharMes = async (competencia: string) => {
    const mod = await import("@/app/api/folha/fechar-mes/route");
    return resposta(await mod.POST(req({ competencia })));
  };
  const importar = async () => {
    const mod = await import("@/app/api/folha/importar/route");
    const form = new FormData();
    form.append("arquivo", new File(["nome;cpf;salario\nAna Nova;529.982.247-25;2500"], "folha.csv", { type: "text/csv" }));
    form.append("etapa", "confirmar");
    form.append("atualizar", "1");
    return resposta(await mod.POST(reqForm(form)));
  };
  const salvarFolha = async (corpo: Record<string, unknown>) => {
    const mod = await import("@/app/api/folha/colaboradores/[id]/route");
    const r = new NextRequest("http://localhost/api/x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    return resposta(await mod.PUT(r, { params: Promise.resolve({ id: "t1" }) }));
  };
  const lerFolha = async (id = "t1") => {
    const mod = await import("@/app/api/folha/colaboradores/[id]/route");
    const r = new NextRequest("http://localhost/api/x");
    return resposta(await mod.GET(r, { params: Promise.resolve({ id }) }));
  };
  const salvarEmitente = async () => {
    const mod = await import("@/app/api/fiscal/emitente/route");
    const form = new FormData();
    form.append("regimeTributario", "SIMPLES_NACIONAL");
    form.append("ambiente", "PRODUCAO");
    form.append("codigoMunicipio", "3550308");
    return resposta(await mod.POST(reqForm(form)));
  };
  const emitirNota = async () => {
    const mod = await import("@/app/api/fiscal/notas/route");
    return resposta(await mod.POST(req({ medicaoId: "m1" })));
  };

  const CORPO_FOLHA = { salario: "9999", regime: "CLT", adicionalTipo: "NENHUM", descontaVt: false, horasMes: "180", valeTransporte: "0" };

  /* ───────── prioridade 1: 403 com o banco intacto ───────── */

  it("sem Financeiro › Custo de pessoal: 403 em fechar o mês, importar e salvar a folha — e o banco fica igual", async () => {
    const antes = await retrato();
    como(SO_VE);
    for (const [nome, chamar] of [
      ["fechar o mês", () => fecharMes("2026-10")],
      ["importar planilha", () => importar()],
      ["salvar dados financeiros", () => salvarFolha(CORPO_FOLHA)],
      ["ler dados financeiros", () => lerFolha()],
    ] as const) {
      const r = await chamar();
      expect([nome, r.status, r.json?.erro]).toEqual([nome, 403, "Sem permissão para esta ação"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("sem Financeiro › Fiscal: 403 no emitente de NFS-e e na emissão — e o banco fica igual", async () => {
    const antes = await retrato();
    como(SO_VE);
    for (const [nome, chamar] of [["emitente", salvarEmitente], ["emitir", emitirNota]] as const) {
      const r = await chamar();
      expect([nome, r.status, r.json?.erro]).toEqual([nome, 403, "Sem permissão para esta ação"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("sem sessão: 401 em tudo, e nada muda", async () => {
    const antes = await retrato();
    sessao.atual = null;
    for (const chamar of [() => fecharMes("2026-10"), () => importar(), () => salvarFolha(CORPO_FOLHA), () => salvarEmitente(), () => emitirNota()]) {
      const r = await chamar();
      expect([r.status, r.json?.erro]).toEqual([401, "Não autorizado"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("o colaborador da e1 não existe para a e2 (ler nem gravar a folha dele)", async () => {
    como(permissoesTotais(), "e2");
    expect((await lerFolha()).status).toBe(404);
    expect((await salvarFolha(CORPO_FOLHA)).status).toBe(404);
    expect(Number((await prisma.tecnico.findUnique({ where: { id: "t1" } })).salario)).toBe(3200);
  });

  /* ───────── o cálculo e a foto do mês continuam os mesmos ───────── */

  const custoEsperado = (itens: ItemEncargo[]) => calcularCusto({
    regime: "CLT", salario: 3200, valorDiaria: null, diasMes: null, horasMes: 220,
    adicionalTipo: "NENHUM", adicionalPercent: null, adicionalValor: null, horasExtrasValor: null,
    valeTransporte: 220, descontaVt: true, valeAlimentacao: 400, planoSaude: 180, outrosBeneficios: null, descontos: null,
  }, itens);

  it("a foto do mês bate centavo por centavo com o cálculo de lib/folha/calculo", async () => {
    const r = await fecharMes("2026-10");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, colaboradores: 1, comDados: 1 });

    const esperado = custoEsperado([{ nome: "INSS patronal", percentual: 20 }, { nome: "FGTS", percentual: 8 }]);
    const foto = await prisma.folhaSnapshot.findFirst({ where: { competencia: "2026-10", colaboradorId: "t1" } });
    expect({
      base: Number(foto.base), encargos: Number(foto.encargos), beneficios: Number(foto.beneficios),
      descontos: Number(foto.descontos), total: Number(foto.custoTotal), horas: foto.horasMes, hora: Number(foto.custoHora),
    }).toEqual({
      base: esperado.base, encargos: esperado.encargos, beneficios: esperado.beneficios,
      descontos: esperado.descontos, total: esperado.total, horas: esperado.horasMes, hora: esperado.custoHora,
    });
    // e o que a tela soma é o que a rota devolve
    expect(r.json.total).toBe(esperado.total);
  });

  it("a foto guarda o detalhamento dos encargos (auditoria) e quem fechou", async () => {
    await fecharMes("2026-10");
    const foto = await prisma.folhaSnapshot.findFirst({ where: { competencia: "2026-10" } });
    expect(foto.detalhe.modelo).toBe("CLT com 13º e férias");
    expect(foto.detalhe.percentualEncargos).toBe(28);
    expect(foto.detalhe.encargos.map((e: ItemEncargo) => e.nome)).toEqual(["INSS patronal", "FGTS"]);
    expect(foto.criadoPor).toBe("Ana Souza");
  });

  it("reajuste depois do fechamento não muda mês fechado; refazer substitui a foto sem duplicar", async () => {
    await fecharMes("2026-10");
    const antes = Number((await prisma.folhaSnapshot.findFirst({ where: { competencia: "2026-10" } })).custoTotal);

    await prisma.tecnico.update({ where: { id: "t1" }, data: { salario: 4000 } });
    expect(Number((await prisma.folhaSnapshot.findFirst({ where: { competencia: "2026-10" } })).custoTotal)).toBe(antes);

    const r = await fecharMes("2026-10");
    expect(r.status).toBe(200);
    expect(await prisma.folhaSnapshot.count({ where: { competencia: "2026-10" } })).toBe(1);
    expect(Number((await prisma.folhaSnapshot.findFirst({ where: { competencia: "2026-10" } })).custoTotal)).toBeGreaterThan(antes);
  });

  it("fechar um mês não encosta na foto de outro mês nem na de outra empresa", async () => {
    await prisma.folhaSnapshot.create({ data: {
      empresaId: "e2", competencia: "2026-10", colaboradorId: "outro", nome: "De fora", regime: "CLT",
      base: 1000, adicionais: 0, encargos: 0, beneficios: 0, descontos: 0, custoTotal: 1000, horasMes: 220, custoHora: 4.55,
    } });
    await fecharMes("2026-09");
    await fecharMes("2026-10");
    expect(await prisma.folhaSnapshot.count({ where: { empresaId: "e1" } })).toBe(2);
    const outra = await prisma.folhaSnapshot.findFirst({ where: { empresaId: "e2" } });
    expect([outra.colaboradorId, Number(outra.custoTotal)]).toEqual(["outro", 1000]);
  });

  it("quem está sem dados de folha entra na foto com custo zero, e a rota devolve as duas contagens", async () => {
    await prisma.tecnico.create({ data: {
      id: "t2", empresaId: "e1", nome: "Sem folha", cpf: "168.995.350-09", telefone: "11988880000",
      tipo: "ADMINISTRATIVO", jornadaDias: ["SEG"],
    } });
    const r = await fecharMes("2026-10");
    expect(r.json).toMatchObject({ colaboradores: 2, comDados: 1 });
    const foto = await prisma.folhaSnapshot.findFirst({ where: { colaboradorId: "t2" } });
    expect([Number(foto.custoTotal), foto.detalhe.semDados]).toEqual([0, true]);
  });

  it("mês futuro é recusado (400) e não grava foto nenhuma", async () => {
    const r = await fecharMes("2099-01");
    expect([r.status, r.json.erro]).toEqual([400, "Não dá para fechar um mês futuro"]);
    expect(await prisma.folhaSnapshot.count()).toBe(0);
  });

  /* ───────── salvar a folha continua gravando o que a tela mostra ───────── */

  it("com a permissão, salvar os dados financeiros grava e devolve o custo recalculado", async () => {
    const r = await salvarFolha({ ...CORPO_FOLHA, salario: "4000", valeAlimentacao: "500", modeloEncargosId: "mod1" });
    expect(r.status).toBe(200);
    const f = await prisma.colaboradorFolha.findUnique({ where: { colaboradorId: "t1" } });
    expect([Number((await prisma.tecnico.findUnique({ where: { id: "t1" } })).salario), Number(f.valeAlimentacao), f.horasMes]).toEqual([4000, 500, 180]);
    expect(r.json.custo.total).toBeGreaterThan(4000);
  });

  it("nenhuma rota de folha apaga lançamento: a foto do mês só é substituída por outro fechamento", async () => {
    const folha = await import("@/app/api/folha/fechar-mes/route");
    const colab: Record<string, unknown> = await import("@/app/api/folha/colaboradores/[id]/route");
    const imp: Record<string, unknown> = await import("@/app/api/folha/importar/route");
    expect((folha as Record<string, unknown>).DELETE).toBeUndefined();
    expect(colab.DELETE).toBeUndefined();
    expect(imp.DELETE).toBeUndefined();
  });
});
