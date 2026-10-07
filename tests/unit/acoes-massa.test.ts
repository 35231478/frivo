/**
 * Ações em massa — rota real /api/acoes-massa com banco em memória de DUAS empresas.
 * Prova: (1) id de outra empresa nunca é alterado (vira "não encontrado"); (2) sem a permissão da
 * ação individual o lote é recusado sem tocar no banco; (3) as regras por item valem (OS com medição
 * não cancela, orçamento convertido não cancela…) e o resultado parcial vem item a item;
 * (4) limite por requisição; (5) exportar e "todos do filtro" também respeitam empresa e permissão;
 * (6) a rota individual usa a mesma regra.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

type Linha = Record<string, any>;
const db = vi.hoisted(() => ({ t: {} as Record<string, Linha[]>, escritas: [] as string[], wheres: [] as { modelo: string; where: any }[], seq: 0 }));

vi.mock("@/lib/prisma", () => {
  const casa = (row: Linha, where: Linha = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === "AND") return (v as Linha[]).every((w) => casa(row, w));
    if (k === "OR") return (v as Linha[]).some((w) => casa(row, w));
    if (v === undefined) return true;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("notIn" in v) return !v.notIn.includes(row[k]);
      if ("not" in v) return v.not === null ? row[k] != null : row[k] !== v.not;
      if ("equals" in v) return String(row[k] ?? "").toLowerCase() === String(v.equals).toLowerCase();
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      return true; // filtros por relação: o seed já é consistente com eles
    }
    return row[k] === v;
  });
  const T = (m: string) => (db.t[m] ??= []);
  // Relações que as regras leem
  const hidratar = (m: string, r: Linha): Linha => {
    switch (m) {
      case "orcamento": return { ...r, contratoGerado: r.contratoGerado ?? null, ordensServico: [], medicaoItens: [], contasReceber: [], pedidosCompra: [] };
      case "veiculo": return { ...r, responsavel: null, equipe: null, colaboradoresPadrao: [], _count: { checklists: 0, manutencoes: 0 } };
      case "tecnico": return { ...r, equipesLideradas: [], equipesMembro: [], veiculosResponsavel: [], contratosRecorrencia: [], contratosResponsavel: [], clientesResponsavel: [], atividadesOs: [], cargo: null };
      case "equipamento": return { ...r, qrcode: T("qrcode").find((q) => q.equipamentoId === r.id) ?? null, unidade: { nome: "Matriz", cliente: { nome: "Cliente" } }, tipoEquipamento: null };
      case "ordemServico": return { ...r, cliente: { nome: "Cliente" }, unidade: null, responsavel: null, contrato: null };
      case "contratoHistoricoStatus": return { ...r, usuario: { id: r.usuarioId, nome: "Teste" } };
      default: return { ...r };
    }
  };
  const escrever = (m: string, op: string, r?: Linha) => db.escritas.push(`${m}.${op}:${r?.empresaId ?? r?.id ?? ""}`);
  const model = (m: string) => ({
    findFirst: async ({ where }: any = {}) => { db.wheres.push({ modelo: m, where }); const r = T(m).find((x) => casa(x, where)); return r ? hidratar(m, r) : null; },
    findMany: async ({ where, take }: any = {}) => { db.wheres.push({ modelo: m, where }); const rs = T(m).filter((x) => casa(x, where)).map((r) => hidratar(m, r)); return take ? rs.slice(0, take) : rs; },
    count: async ({ where }: any = {}) => { db.wheres.push({ modelo: m, where }); return T(m).filter((x) => casa(x, where)).length; },
    update: async ({ where, data }: any) => {
      const r = T(m).find((x) => casa(x, where));
      if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(r, data); escrever(m, "update", r); return hidratar(m, r);
    },
    create: async ({ data }: any) => { const r = { id: `${m}-${++db.seq}`, ...data }; T(m).push(r); escrever(m, "create", r); return hidratar(m, r); },
  });
  const cache: Record<string, any> = {};
  const prisma: any = new Proxy({}, {
    get: (_t, m: string) => {
      if (m === "$transaction") return async (arg: any) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg));
      if (m === "$queryRaw") return async () => [{ max: 0 }];
      return (cache[m] ??= model(m));
    },
  });
  return { prisma };
});

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/status-financeiro", () => ({ calcularStatusFinanceiroEmLote: vi.fn(async () => ({})) }));

const logar = (permissoes: Permissoes, empresaId = "e1", role = "OPERADOR") => { sessao.atual = { user: { id: "u1", name: "Ana", email: "ana@x.com", empresaId, role, permissoes } }; };

function semear() {
  db.t = {
    ordemServico: [
      { id: "os1", empresaId: "e1", numero: "OS-2026-0001", status: "ABERTA", origem: "MANUAL", descricao: "Limpeza", criadoEm: new Date(), prioridade: "MEDIA" },
      { id: "os2", empresaId: "e1", numero: "OS-2026-0002", status: "ABERTA", origem: "MANUAL", descricao: "=HYPERLINK(\"x\")", criadoEm: new Date(), prioridade: "MEDIA" }, // faturada (medição)
      { id: "os3", empresaId: "e1", numero: "OS-2026-0003", status: "CANCELADA", origem: "MANUAL", descricao: "x", criadoEm: new Date(), prioridade: "MEDIA" },
      { id: "osX", empresaId: "e2", numero: "OS-2026-0001", status: "ABERTA", origem: "MANUAL", descricao: "da outra empresa", criadoEm: new Date(), prioridade: "MEDIA" },
    ],
    medicaoItem: [{ id: "mi1", ordemServicoId: "os2", medicao: { numero: "MED-2026-0007", status: "ABERTA" } }],
    osMedicao: [],
    osHistorico: [],
    orcamento: [
      { id: "or1", empresaId: "e1", codigo: "ORC-1", nome: "Prev", status: "ENVIADO" },
      { id: "or2", empresaId: "e1", codigo: "ORC-2", nome: "Convertido", status: "CONVERTIDA", contratoGerado: { numero: "CT-9", status: "ATIVO" } },
      { id: "orX", empresaId: "e2", codigo: "ORC-1", nome: "Outra", status: "ENVIADO" },
    ],
    contrato: [
      { id: "ct1", empresaId: "e1", numero: "CT-1", status: "ATIVO" },
      { id: "ct2", empresaId: "e1", numero: "CT-2", status: "ENCERRADO" },
      { id: "ctX", empresaId: "e2", numero: "CT-1", status: "ATIVO" },
    ],
    contratoHistoricoStatus: [],
    cliente: [
      { id: "c1", empresaId: "e1", nome: "Padaria", cpfCnpj: "1", ativo: true },
      { id: "c2", empresaId: "e1", nome: "Mercado", cpfCnpj: "2", ativo: false },
      { id: "cX", empresaId: "e2", nome: "Cliente da e2", cpfCnpj: "1", ativo: true },
    ],
    equipamento: [
      { id: "eq1", empresaId: "e1", marca: "LG", modelo: "Split", ativo: true },
      { id: "eq2", empresaId: "e1", marca: "Carrier", modelo: "VRF", ativo: true },
      { id: "eqX", empresaId: "e2", marca: "LG", modelo: "Split", ativo: true },
    ],
    qrcode: [{ id: "qr-velho", empresaId: "e1", codigo: "QR-2026-0001", equipamentoId: "eq2" }],
    veiculo: [{ id: "v1", empresaId: "e1", placa: "ABC1D23", modelo: "Strada", status: "ATIVO", observacoes: null }, { id: "vX", empresaId: "e2", placa: "XYZ", modelo: "Fiorino", status: "ATIVO" }],
    tecnico: [{ id: "t1", empresaId: "e1", nome: "Carlos", ativo: true, observacoes: null, statusColaborador: "ATIVO" }, { id: "tX", empresaId: "e2", nome: "Bia", ativo: true }],
    checklistPreenchido: [], atividadeTecnico: [], usuario: [],
  };
  db.escritas = []; db.wheres = [];
}
beforeEach(semear);

async function chamar(corpo: unknown) {
  const { POST } = await import("@/app/api/acoes-massa/route");
  return POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
}
const porId = (j: any) => Object.fromEntries(j.resultados.map((r: any) => [r.id, r]));

describe("isolamento por empresa", () => {
  it("OS de outra empresa no meio do lote: 'não encontrado' e intacta; as da empresa são canceladas", async () => {
    logar(permissoesTotais(), "e1", "ADMIN");
    const j = await (await chamar({ entidade: "ordens", acao: "inativar", ids: ["os1", "osX"] })).json();
    const r = porId(j);
    expect(r.os1).toMatchObject({ ok: true, rotulo: "OS-2026-0001" });
    expect(r.osX).toMatchObject({ ok: false, codigo: "nao_encontrado" });
    expect(r.osX.rotulo).toBe("osX"); // nem o número da OS da outra empresa vaza
    expect(db.t.ordemServico.find((o) => o.id === "osX")!.status).toBe("ABERTA");
    expect(db.escritas.some((e) => e.includes("osX") || e.endsWith(":e2"))).toBe(false);
  });

  it("vale para todas as listas (cliente, orçamento, contrato, equipamento, veículo, colaborador)", async () => {
    logar(permissoesTotais(), "e1", "ADMIN");
    const casos: [string, string][] = [["clientes", "cX"], ["orcamentos", "orX"], ["contratos", "ctX"], ["equipamentos", "eqX"], ["veiculos", "vX"], ["colaboradores", "tX"]];
    for (const [entidade, idOutra] of casos) {
      const j = await (await chamar({ entidade, acao: "inativar", ids: [idOutra] })).json();
      expect(j.resultados[0], entidade).toMatchObject({ ok: false, codigo: "nao_encontrado" });
    }
    expect(db.escritas).toEqual([]);
  });

  it("exportar só traz registros da empresa da sessão (e neutraliza fórmula do Excel)", async () => {
    logar(permissoesTotais(), "e1", "ADMIN");
    const res = await chamar({ entidade: "ordens", acao: "exportar", ids: ["os2", "osX"] });
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("OS-2026-0002");
    expect(csv).not.toContain("da outra empresa");
    expect(csv).toContain("'=HYPERLINK"); // não vira fórmula ao abrir no Excel
  });

  it("'todos do filtro' monta a consulta com o empresaId da sessão (ignora empresaId no filtro)", async () => {
    logar(permissoesTotais(), "e1", "ADMIN");
    const j = await (await chamar({ entidade: "ordens", acao: "ids-do-filtro", filtro: "empresaId=e2&status=ABERTA" })).json();
    expect(j.ids.sort()).toEqual(["os1", "os2"]);
    expect(db.wheres.filter((w) => w.modelo === "ordemServico").every((w) => w.where.empresaId === "e1")).toBe(true);
  });

  it("corpo com campos extras (ex.: empresaId) é recusado", async () => {
    logar(permissoesTotais(), "e1", "ADMIN");
    expect((await chamar({ entidade: "ordens", acao: "inativar", ids: ["osX"], empresaId: "e2" })).status).toBe(400);
  });
});

describe("permissão (a mesma da ação individual)", () => {
  it("técnico (sem 'excluir' OS) não cancela em massa: 403 sem tocar no banco", async () => {
    logar(PRESETS.TECNICO);
    const res = await chamar({ entidade: "ordens", acao: "inativar", ids: ["os1"] });
    expect(res.status).toBe(403);
    expect(db.escritas).toEqual([]);
    expect(db.t.ordemServico.find((o) => o.id === "os1")!.status).toBe("ABERTA");
  });

  it("quem só reativa não inativa (e vice-versa)", async () => {
    logar(montarPermissoes({ clientes: ["visualizar", "editar"] }));
    expect((await chamar({ entidade: "clientes", acao: "inativar", ids: ["c1"] })).status).toBe(403);
    expect((await chamar({ entidade: "clientes", acao: "reativar", ids: ["c2"] })).status).toBe(200);
    expect(db.t.cliente.find((c) => c.id === "c2")!.ativo).toBe(true);
    expect(db.t.cliente.find((c) => c.id === "c1")!.ativo).toBe(true);
  });

  it("veículos: inativar exige 'excluir'; reativar exige 'gerenciar'; colaboradores usam o módulo Equipes", async () => {
    logar(montarPermissoes({ veiculos: ["visualizar", "gerenciar"], equipes: ["visualizar", "gerenciar"] }));
    expect((await chamar({ entidade: "veiculos", acao: "inativar", ids: ["v1"] })).status).toBe(403);
    expect((await chamar({ entidade: "colaboradores", acao: "inativar", ids: ["t1"] })).status).toBe(403);
    expect((await chamar({ entidade: "veiculos", acao: "reativar", ids: ["v1"] })).status).toBe(200);
  });

  it("exportar exige ver a lista E 'Relatórios › Exportar'", async () => {
    logar(montarPermissoes({ ordens: ["visualizar"] }));
    expect((await chamar({ entidade: "ordens", acao: "exportar", ids: ["os1"] })).status).toBe(403);
    logar(montarPermissoes({ ordens: ["visualizar"], relatorios: ["visualizar", "exportar"] }));
    expect((await chamar({ entidade: "ordens", acao: "exportar", ids: ["os1"] })).status).toBe(200);
  });

  it("'todos do filtro' exige ver a lista", async () => {
    logar(PRESETS.TECNICO);
    expect((await chamar({ entidade: "clientes", acao: "ids-do-filtro", filtro: "" })).status).toBe(403);
  });

  it("sem login: 401", async () => {
    sessao.atual = null;
    expect((await chamar({ entidade: "ordens", acao: "inativar", ids: ["os1"] })).status).toBe(401);
  });
});

describe("regras por item e resultado parcial", () => {
  beforeEach(() => logar(permissoesTotais(), "e1", "ADMIN"));

  it("OS: a faturada (em medição) não cancela; a já cancelada conta como feita; resumo X feitas · Y não puderam", async () => {
    const j = await (await chamar({ entidade: "ordens", acao: "inativar", ids: ["os1", "os2", "os3"], motivo: "duplicadas" })).json();
    const r = porId(j);
    expect(r.os1.ok).toBe(true);
    expect(r.os2).toMatchObject({ ok: false, codigo: "bloqueado" });
    expect(r.os2.motivo).toContain("MED-2026-0007");
    expect(r.os3).toMatchObject({ ok: true, detalhe: "Já estava cancelada" });
    expect(j.resumo).toEqual({ total: 3, feitas: 2, naoPuderam: 1 });
    expect(db.t.ordemServico.find((o) => o.id === "os2")!.status).toBe("ABERTA");
    // Histórico da OS registra a ação em massa e o motivo
    expect(db.t.osHistorico).toEqual([expect.objectContaining({ ordemServicoId: "os1", acao: "OS inativada (cancelada) (ação em massa)", detalhes: "ABERTA → CANCELADA — Motivo: duplicadas" })]);
  });

  it("orçamento convertido em contrato não cancela; o outro cancela", async () => {
    const r = porId(await (await chamar({ entidade: "orcamentos", acao: "inativar", ids: ["or1", "or2"] })).json());
    expect(r.or1.ok).toBe(true);
    expect(r.or2).toMatchObject({ ok: false, codigo: "bloqueado" });
    expect(r.or2.motivo).toContain("CT-9");
    expect(db.t.orcamento.find((o) => o.id === "or1")).toMatchObject({ status: "CANCELADO", lembretesAtivos: false });
  });

  it("contrato: suspende o ativo com histórico; encerrado não muda; reativar volta só o suspenso", async () => {
    const r = porId(await (await chamar({ entidade: "contratos", acao: "inativar", ids: ["ct1", "ct2"] })).json());
    expect(r.ct1.ok).toBe(true);
    expect(r.ct2).toMatchObject({ ok: false, codigo: "bloqueado" });
    expect(db.t.contratoHistoricoStatus).toEqual([expect.objectContaining({ contratoId: "ct1", statusAnterior: "ATIVO", statusNovo: "SUSPENSO", empresaId: "e1" })]);
    const r2 = porId(await (await chamar({ entidade: "contratos", acao: "reativar", ids: ["ct1", "ct2"] })).json());
    expect(r2.ct1.ok).toBe(true);
    expect(r2.ct2.ok).toBe(false);
    expect(db.t.contrato.find((c) => c.id === "ct1")!.status).toBe("ATIVO");
  });

  it("veículo e colaborador: inativação anotada nas observações como ação em massa", async () => {
    await chamar({ entidade: "veiculos", acao: "inativar", ids: ["v1"], motivo: "vendido" });
    expect(db.t.veiculo.find((v) => v.id === "v1")!.observacoes).toMatch(/\[Inativado \(ação em massa\) em .* por Ana\] Motivo: vendido/);
    await chamar({ entidade: "colaboradores", acao: "inativar", ids: ["t1"] });
    expect(db.t.tecnico.find((t) => t.id === "t1")).toMatchObject({ ativo: false, statusColaborador: "INATIVO" });
  });

  it("gerar QR: cria para quem não tem e devolve o QR de quem já tinha (para imprimir)", async () => {
    const j = await (await chamar({ entidade: "equipamentos", acao: "gerar-qr", ids: ["eq1", "eq2"] })).json();
    const r = porId(j);
    expect(r.eq1).toMatchObject({ ok: true });
    expect(r.eq1.qrcodeId).toBeTruthy();
    expect(r.eq2).toMatchObject({ ok: true, qrcodeId: "qr-velho", detalhe: "Já tinha o QR QR-2026-0001" });
    expect(db.t.qrcode.filter((q) => q.equipamentoId === "eq1")).toHaveLength(1);
  });

  it("erro inesperado em um item não derruba o lote: vira 'não pôde' com motivo", async () => {
    const { prisma } = await import("@/lib/prisma");
    const orig = (prisma as any).cliente.update;
    (prisma as any).cliente.update = async ({ where }: any) => { if (where.id === "c1") throw new Error("falha de banco"); return orig({ where, data: { ativo: true } }); };
    try {
      const j = await (await chamar({ entidade: "clientes", acao: "reativar", ids: ["c2"] })).json();
      expect(j.resumo.feitas).toBe(1);
      db.t.cliente.find((c) => c.id === "c1")!.ativo = false;
      const j2 = await (await chamar({ entidade: "clientes", acao: "reativar", ids: ["c1"] })).json();
      expect(j2.resultados[0]).toMatchObject({ ok: false, codigo: "erro" });
      expect(j2.resumo).toEqual({ total: 1, feitas: 0, naoPuderam: 1 });
    } finally {
      (prisma as any).cliente.update = orig;
    }
  });
});

describe("limites e registro", () => {
  beforeEach(() => logar(permissoesTotais(), "e1", "ADMIN"));

  it("mais de 500 ids por requisição: 413 sem processar; ids repetidos contam uma vez", async () => {
    const res = await chamar({ entidade: "clientes", acao: "inativar", ids: Array.from({ length: 501 }, (_, i) => `id${i}`) });
    expect(res.status).toBe(413);
    expect(db.escritas).toEqual([]);
    const j = await (await chamar({ entidade: "clientes", acao: "inativar", ids: ["c1", "c1", "c1"] })).json();
    expect(j.resumo.total).toBe(1);
  });

  it("ação que a lista não tem (ex.: gerar QR em clientes) e lista vazia: 400", async () => {
    expect((await chamar({ entidade: "clientes", acao: "gerar-qr", ids: ["c1"] })).status).toBe(400);
    expect((await chamar({ entidade: "clientes", acao: "inativar", ids: [] })).status).toBe(400);
    expect((await chamar({ entidade: "clientes", acao: "excluir", ids: ["c1"] })).status).toBe(400); // não existe exclusão definitiva
  });

  it("registra quem, quando, o quê e quantos", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await chamar({ entidade: "ordens", acao: "inativar", ids: ["os1", "os2"], lote: { id: "L1", parte: 1, partes: 1 } });
    const log = JSON.parse(spy.mock.calls.map((c) => c[0]).find((c) => String(c).includes("acao_em_massa")) as string);
    expect(log).toMatchObject({ evento: "acao_em_massa", usuarioId: "u1", usuario: "Ana", empresaId: "e1", entidade: "ordens", acao: "inativar", total: 2, feitas: 1, naoPuderam: 1, lote: { id: "L1" } });
    expect(log.quando).toBeTruthy();
    spy.mockRestore();
  });
});

describe("a ação individual usa a mesma regra", () => {
  it("DELETE /api/ordens/[id] de OS em medição: 409 com a mesma mensagem do lote", async () => {
    logar(permissoesTotais(), "e1", "ADMIN");
    const { DELETE } = await import("@/app/api/ordens/[id]/route");
    const res = await DELETE(new NextRequest("http://localhost/api/ordens/os2", { method: "DELETE" }), { params: Promise.resolve({ id: "os2" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).erro).toContain("MED-2026-0007");
    const lote = await (await chamar({ entidade: "ordens", acao: "inativar", ids: ["os2"] })).json();
    expect(lote.resultados[0].motivo).toContain("MED-2026-0007");
  });
});
