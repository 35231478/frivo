/**
 * Custo de Pessoal — rotas reais com banco em memória de DUAS empresas e sessão simulada.
 * Prova: (1) só quem tem "Financeiro › Custo de pessoal" vê/edita salário e benefícios (inclusive na
 * ficha do colaborador); (2) nada de outra empresa é lido, alterado ou deduplicado; (3) a importação
 * só grava depois de confirmar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

// ───────────── banco em memória ─────────────
type Linha = Record<string, any>;
const db = vi.hoisted(() => ({ tabelas: {} as Record<string, any[]>, escritas: [] as string[], seq: 0 }));

vi.mock("@/lib/prisma", () => {
  const casa = (row: Linha, where: Linha = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === "AND") return (v as Linha[]).every((w) => casa(row, w));
    if (v === undefined) return true;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return v.not === null ? row[k] != null : row[k] !== v.not;
      if ("gte" in v || "lte" in v) return (v.gte == null || row[k] >= v.gte) && (v.lte == null || row[k] <= v.lte);
      if ("some" in v) return true;
      return true;
    }
    return row[k] === v;
  });
  const t = (nome: string) => (db.tabelas[nome] ??= []);
  const novoId = (p: string) => `${p}${++db.seq}`;
  const comRelacoes = (nome: string, r: Linha) => nome !== "tecnico" ? { ...r } : {
    ...r,
    folha: t("colaboradorFolha").find((f) => f.colaboradorId === r.id) ?? null,
    cargo: t("cargo").find((c) => c.id === r.cargoId) ?? null,
    equipesLideradas: [], equipesMembro: (r._equipes ?? []).map((id: string) => t("equipe").find((e) => e.id === id)).filter(Boolean),
    competencias: [], documentos: [],
  };
  const escrever = (nome: string, metodo: string, dados?: Linha) => db.escritas.push(`${nome}.${metodo}:${dados?.empresaId ?? ""}`);
  const criar = (nome: string, data: Linha): Linha => {
    const { folha, equipesMembro, ...resto } = data;
    const r: Linha = { id: novoId(nome.slice(0, 3)), ativo: true, criadoEm: new Date(), ...resto };
    if (equipesMembro?.connect) r._equipes = [equipesMembro.connect.id];
    t(nome).push(r);
    escrever(nome, "create", r);
    if (folha?.create) criar("colaboradorFolha", { ...folha.create, colaboradorId: r.id });
    return r;
  };
  const model = (nome: string) => ({
    findFirst: async ({ where }: any = {}) => { const r = t(nome).find((x) => casa(x, where)); return r ? comRelacoes(nome, r) : null; },
    findUnique: async ({ where }: any = {}) => {
      const w = where.cpf_empresaId ?? where;
      const r = t(nome).find((x) => casa(x, w)); return r ? comRelacoes(nome, r) : null;
    },
    findMany: async ({ where }: any = {}) => t(nome).filter((x) => casa(x, where)).map((r) => comRelacoes(nome, r)),
    count: async ({ where }: any = {}) => t(nome).filter((x) => casa(x, where)).length,
    create: async ({ data }: any) => comRelacoes(nome, criar(nome, data)),
    createMany: async ({ data }: any) => { for (const d of data) { t(nome).push({ id: novoId(nome.slice(0, 3)), ativo: true, ...d }); escrever(nome, "createMany", d); } return { count: data.length }; },
    update: async ({ where, data }: any) => {
      const r = t(nome).find((x) => casa(x, where));
      if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
      for (const [k, v] of Object.entries(data)) {
        if (k === "cargo") r.cargoId = (v as any).connect.id;
        else if (k === "equipesMembro") r._equipes = [...(r._equipes ?? []), (v as any).connect.id];
        else if (!["competencias", "documentos"].includes(k)) r[k] = v;
      }
      escrever(nome, "update", r);
      return comRelacoes(nome, r);
    },
    updateMany: async ({ where, data }: any) => { const rs = t(nome).filter((x) => casa(x, where)); rs.forEach((r) => Object.assign(r, data)); return { count: rs.length }; },
    upsert: async ({ where, create, update }: any) => {
      const r = t(nome).find((x) => casa(x, where));
      if (r) { Object.assign(r, update); escrever(nome, "upsert", r); return r; }
      return criar(nome, create);
    },
    delete: async ({ where }: any) => { const i = t(nome).findIndex((x) => casa(x, where)); const [r] = t(nome).splice(i, 1); escrever(nome, "delete", r); return r; },
    deleteMany: async ({ where }: any) => { const antes = t(nome).length; db.tabelas[nome] = t(nome).filter((x) => !casa(x, where)); escrever(nome, "deleteMany", where); return { count: antes - t(nome).length }; },
    groupBy: async ({ by, where }: any) => {
      const g = new Map<string, Linha[]>();
      for (const r of t(nome).filter((x) => casa(x, where))) { const k = r[by[0]]; g.set(k, [...(g.get(k) ?? []), r]); }
      return [...g.entries()].map(([k, rs]) => ({ [by[0]]: k, _sum: { custoTotal: rs.reduce((s, r) => s + Number(r.custoTotal ?? 0), 0), encargos: rs.reduce((s, r) => s + Number(r.encargos ?? 0), 0) }, _count: { _all: rs.length } }));
    },
  });
  const modelos: Record<string, any> = {};
  const prisma: any = new Proxy({}, {
    get: (_t, nome: string) => {
      if (nome === "$transaction") return async (arg: any) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg));
      if (nome === "$queryRaw") return async () => [];
      return (modelos[nome] ??= model(nome));
    },
  });
  return { prisma };
});

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes, empresaId = "e1", role = "OPERADOR") => { sessao.atual = { user: { id: "u1", name: "Teste", empresaId, role, permissoes } }; };
const FINANCEIRO = PRESETS.FINANCEIRO; // inclui financeiro.folha
const FINANCEIRO_SEM_FOLHA = montarPermissoes({ financeiro: ["visualizar", "contasReceber", "fluxoCaixa", "medicoes"] });
const SUPERVISOR = PRESETS.SUPERVISOR; // gerencia colaboradores, sem folha

function semear() {
  db.tabelas = {
    tecnico: [
      { id: "t1", empresaId: "e1", nome: "Ana E1", cpf: "529.982.247-25", telefone: "3199", tipo: "TECNICO_CAMPO", salario: 3000, ativo: true, statusColaborador: "ATIVO", cargoId: null, observacoes: null },
      { id: "t2", empresaId: "e2", nome: "Bia E2", cpf: "111.444.777-35", telefone: "3198", tipo: "TECNICO_CAMPO", salario: 9999, ativo: true, statusColaborador: "ATIVO", cargoId: null, observacoes: null },
    ],
    colaboradorFolha: [
      { id: "f2", empresaId: "e2", colaboradorId: "t2", regime: "CLT", planoSaude: 777, descontaVt: true, horasMes: 220, adicionalTipo: "NENHUM" },
    ],
    modeloEncargos: [
      { id: "m-e2", empresaId: "e2", nome: "CLT (padrão)", regime: "CLT", padrao: true, ativo: true, itens: [{ nome: "INSS", percentual: 99 }] },
    ],
    folhaSnapshot: [
      { id: "s-e2", empresaId: "e2", competencia: "2026-09", colaboradorId: "t2", custoTotal: 50000, encargos: 1 },
    ],
    cargo: [{ id: "c-e2", empresaId: "e2", nome: "Técnico" }],
    equipe: [{ id: "q-e2", empresaId: "e2", nome: "Equipe Alfa", status: "ATIVA" }, { id: "q-e1", empresaId: "e1", nome: "Equipe Beta", status: "ATIVA" }],
  };
  db.escritas = [];
}
beforeEach(semear);

const req = (metodo: string, corpo?: unknown, url = "http://localhost/api/x") =>
  new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const rotas = {
  folha: () => import("@/app/api/folha/colaboradores/[id]/route"),
  modelos: () => import("@/app/api/folha/modelos/route"),
  modelo: () => import("@/app/api/folha/modelos/[id]/route"),
  fechar: () => import("@/app/api/folha/fechar-mes/route"),
  planilha: () => import("@/app/api/folha/modelo-planilha/route"),
  importar: () => import("@/app/api/folha/importar/route"),
  tecnico: () => import("@/app/api/tecnicos/[id]/route"),
  tecnicos: () => import("@/app/api/tecnicos/route"),
};

const corpoFolha = { regime: "CLT", salario: "4.500,00", valeTransporte: "200", descontaVt: true, planoSaude: 300, adicionalTipo: "NENHUM" };

function formImport(csv: string, etapa: "previa" | "confirmar", atualizar = false) {
  const fd = new FormData();
  fd.append("arquivo", new Blob([csv], { type: "text/csv" }), "colaboradores.csv");
  fd.append("etapa", etapa);
  fd.append("atualizar", atualizar ? "1" : "0");
  return new NextRequest("http://localhost/api/folha/importar", { method: "POST", body: fd });
}

describe("permissão: só RH/financeiro (financeiro.folha) vê salário e custo", () => {
  const semFolha: [string, Permissoes][] = [["supervisor (gerencia colaboradores)", SUPERVISOR], ["financeiro sem 'Custo de pessoal'", FINANCEIRO_SEM_FOLHA], ["técnico", PRESETS.TECNICO]];

  for (const [quem, perm] of semFolha) {
    it(`${quem}: 403 em todas as rotas de folha, sem ler o banco`, async () => {
      logar(perm);
      const casos: [() => Promise<any>, string, any, any?][] = [
        [rotas.folha, "GET", req("GET"), params("t1")],
        [rotas.folha, "PUT", req("PUT", corpoFolha), params("t1")],
        [rotas.modelos, "GET", req("GET")],
        [rotas.modelos, "POST", req("POST", { nome: "X", regime: "CLT", itens: [] })],
        [rotas.modelo, "PUT", req("PUT", { nome: "X", regime: "CLT", itens: [] }), params("m-e2")],
        [rotas.modelo, "DELETE", req("DELETE"), params("m-e2")],
        [rotas.fechar, "POST", req("POST", { competencia: "2026-09" })],
        [rotas.planilha, "GET", req("GET")],
        [rotas.importar, "POST", formImport("nome;cpf;tipo_contrato\nA;529.982.247-25;CLT", "confirmar")],
      ];
      for (const [mod, metodo, r, p] of casos) {
        const res = await (await mod())[metodo](r, p);
        expect(res.status, `${metodo}`).toBe(403);
      }
      expect(db.escritas).toEqual([]);
    });
  }

  it("ficha do colaborador (GET /api/tecnicos/[id]): supervisor recebe SEM salário; financeiro com folha recebe com salário", async () => {
    logar(SUPERVISOR);
    const semSal = await (await (await rotas.tecnico()).GET(req("GET"), params("t1"))).json();
    expect(semSal.nome).toBe("Ana E1");
    expect(semSal).not.toHaveProperty("salario");

    logar(montarPermissoes({ equipes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "folha"] }));
    const comSal = await (await (await rotas.tecnico()).GET(req("GET"), params("t1"))).json();
    expect(comSal.salario).toBe(3000);
  });

  it("editar o cadastro geral (PUT /api/tecnicos/[id]) não mexe no salário nem o devolve", async () => {
    logar(SUPERVISOR);
    const corpo = { nome: "Ana E1", cpf: "529.982.247-25", telefone: "31999999999", tipo: "TECNICO_CAMPO", salario: 1, statusColaborador: "ATIVO" };
    const res = await (await rotas.tecnico()).PUT(req("PUT", corpo), params("t1"));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("salario");
    expect(db.tabelas.tecnico.find((t) => t.id === "t1")!.salario).toBe(3000);
  });

  it("cadastro novo (POST /api/tecnicos) ignora salário enviado e não o devolve", async () => {
    logar(SUPERVISOR);
    const res = await (await rotas.tecnicos()).POST(req("POST", { nome: "Novo", cpf: "153.509.460-56", telefone: "31999999999", salario: 5000 }));
    expect(res.status).toBe(201);
    expect(await res.json()).not.toHaveProperty("salario");
    expect(db.tabelas.tecnico.find((t) => t.nome === "Novo")!.salario).toBeUndefined();
  });
});

describe("isolamento por empresa", () => {
  beforeEach(() => logar(FINANCEIRO, "e1"));

  it("dados de folha de colaborador de outra empresa: 404 (ler e gravar)", async () => {
    const mod = await rotas.folha();
    expect((await mod.GET(req("GET"), params("t2"))).status).toBe(404);
    expect((await mod.PUT(req("PUT", corpoFolha), params("t2"))).status).toBe(404);
    expect(db.tabelas.colaboradorFolha.find((f) => f.colaboradorId === "t2")!.planoSaude).toBe(777);
    expect(db.tabelas.tecnico.find((t) => t.id === "t2")!.salario).toBe(9999);
  });

  it("grava folha do próprio colaborador; modelos padrão criados para a empresa da sessão; custo calculado", async () => {
    const res = await (await rotas.folha()).PUT(req("PUT", corpoFolha), params("t1"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.folha.salario).toBe(4500);
    expect(d.custo.base).toBe(4500);
    expect(d.custo.descontoVt).toBe(200); // 6% de 4500 = 270 > VT 200
    expect(d.modelos.every((m: any) => !String(m.id).startsWith("m-e2"))).toBe(true);
    expect(d.modeloAplicado).toBe("CLT (padrão)");
    expect(d.custo.percentualEncargos).toBe(55.24); // modelo da e1, não o de 99% da e2
    expect(db.tabelas.modeloEncargos.filter((m) => m.empresaId === "e1")).toHaveLength(4);
    expect(db.tabelas.colaboradorFolha.find((f) => f.colaboradorId === "t1")).toMatchObject({ empresaId: "e1", planoSaude: 300 });
  });

  it("não aceita modelo de encargos de outra empresa nem campos extras (empresaId)", async () => {
    const mod = await rotas.folha();
    expect((await mod.PUT(req("PUT", { ...corpoFolha, modeloEncargosId: "m-e2" }), params("t1"))).status).toBe(400);
    expect((await mod.PUT(req("PUT", { ...corpoFolha, empresaId: "e2" }), params("t1"))).status).toBe(400);
  });

  it("modelos de outra empresa: não aparecem, não editam, não excluem", async () => {
    const lista = await (await (await rotas.modelos()).GET()).json();
    expect(lista.map((m: any) => m.id)).not.toContain("m-e2");
    const mod = await rotas.modelo();
    expect((await mod.PUT(req("PUT", { nome: "Hack", regime: "CLT", padrao: false, itens: [] }), params("m-e2"))).status).toBe(404);
    expect((await mod.DELETE(req("DELETE"), params("m-e2"))).status).toBe(404);
    expect(db.tabelas.modeloEncargos.find((m) => m.id === "m-e2")!.nome).toBe("CLT (padrão)");
  });

  it("fechar mês: grava só colaboradores da empresa da sessão e não apaga a foto da outra empresa", async () => {
    const res = await (await rotas.fechar()).POST(req("POST", { competencia: "2026-09" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ colaboradores: 1 });
    const snaps = db.tabelas.folhaSnapshot;
    expect(snaps.filter((s) => s.empresaId === "e1").map((s) => s.colaboradorId)).toEqual(["t1"]);
    expect(snaps.find((s) => s.id === "s-e2")).toBeTruthy();
    expect(db.escritas.filter((e) => e.startsWith("folhaSnapshot.createMany")).every((e) => e.endsWith(":e1"))).toBe(true);
  });

  it("fechar mês valida a competência e recusa mês futuro", async () => {
    const mod = await rotas.fechar();
    expect((await mod.POST(req("POST", { competencia: "09/2026" }))).status).toBe(400);
    expect((await mod.POST(req("POST", { competencia: "2099-01" }))).status).toBe(400);
  });
});

describe("importação por planilha", () => {
  beforeEach(() => logar(FINANCEIRO, "e1"));
  const csv = [
    "nome;cpf;funcao_cargo;tipo_contrato;salario_base;equipe;vale_transporte",
    "Ana Atualizada;529.982.247-25;Técnico;CLT;3.500,00;Equipe Beta;180",   // já existe na e1
    "Bia Outra Empresa;111.444.777-35;Técnico;PJ;7000;Equipe Alfa;",         // CPF existe só na e2 → novo na e1
    "Linha ruim;123;;estagio;;;",
  ].join("\n");

  it("prévia não grava nada e mostra novos/existentes/erros (CPF de outra empresa não conta como duplicado)", async () => {
    const res = await (await rotas.importar()).POST(formImport(csv, "previa"));
    expect(res.status).toBe(200);
    const { analise } = await res.json();
    expect(analise.resumo).toMatchObject({ total: 3, novos: 1, existentes: 1, erros: 1 });
    expect(analise.linhas[1].avisos.join(" ")).toMatch(/Equipe Alfa.*não encontrada/); // equipe da e2 não é visível
    expect(analise.cargosNovos).toEqual(["Técnico"]); // o cargo "Técnico" da e2 não é reaproveitado
    expect(db.escritas).toEqual([]);
  });

  it("confirmar: cria só o novo (na empresa da sessão), ignora o existente e a linha com erro", async () => {
    const res = await (await rotas.importar()).POST(formImport(csv, "confirmar"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ criados: 1, atualizados: 0, ignorados: 1, comErro: 1, cargosCriados: ["Técnico"] });
    const nova = db.tabelas.tecnico.find((t) => t.nome === "Bia Outra Empresa")!;
    expect(nova).toMatchObject({ empresaId: "e1", cpf: "111.444.777-35", salario: 7000, tipo: "TECNICO_CAMPO" });
    expect(db.tabelas.colaboradorFolha.find((f) => f.colaboradorId === nova.id)).toMatchObject({ empresaId: "e1", regime: "PJ" });
    expect(db.tabelas.cargo.find((c) => c.id === nova.cargoId)!.empresaId).toBe("e1");
    // A colaboradora da e2 com o mesmo CPF continua intacta
    expect(db.tabelas.tecnico.find((t) => t.id === "t2")).toMatchObject({ empresaId: "e2", nome: "Bia E2", salario: 9999 });
    expect(db.tabelas.tecnico.find((t) => t.id === "t1")!.salario).toBe(3000); // não marcou "atualizar"
    expect(db.escritas.every((e) => e.endsWith(":e1"))).toBe(true);
  });

  it("confirmar com 'atualizar existentes': atualiza o colaborador da própria empresa (e só ele)", async () => {
    const res = await (await rotas.importar()).POST(formImport(csv, "confirmar", true));
    expect(await res.json()).toMatchObject({ criados: 1, atualizados: 1 });
    const ana = db.tabelas.tecnico.find((t) => t.id === "t1")!;
    expect(ana.salario).toBe(3500);
    expect(ana.nome).toBe("Ana E1"); // nome não é sobrescrito pela planilha
    expect(ana._equipes).toEqual(["q-e1"]);
    expect(db.tabelas.colaboradorFolha.find((f) => f.colaboradorId === "t1")).toMatchObject({ empresaId: "e1", valeTransporte: 180 });
  });

  it("arquivo inválido ou sem colunas obrigatórias: 400 com mensagem clara", async () => {
    const mod = await rotas.importar();
    const r1 = await mod.POST(formImport("nome;email\nA;a@a.com", "previa"));
    expect(r1.status).toBe(400);
    expect((await r1.json()).erro).toMatch(/Faltam colunas obrigatórias/);
    const r2 = await mod.POST(new NextRequest("http://localhost/api/folha/importar", { method: "POST", body: new FormData() }));
    expect(r2.status).toBe(400);
  });

  it("modelo da planilha: xlsx e csv com as colunas do modelo", async () => {
    const mod = await rotas.planilha();
    const x = await mod.GET(req("GET", undefined, "http://localhost/api/folha/modelo-planilha"));
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    expect(new Uint8Array(await x.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    const c = await mod.GET(req("GET", undefined, "http://localhost/api/folha/modelo-planilha?formato=csv"));
    expect(await c.text()).toContain("nome;cpf;funcao_cargo;tipo_contrato;salario_base");
  });

  it("ADMIN (administrador master) tem acesso", async () => {
    logar(permissoesTotais(), "e1", "ADMIN");
    expect((await (await rotas.folha()).GET(req("GET"), params("t1"))).status).toBe(200);
  });
});
