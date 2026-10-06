/**
 * Dashboard: fuso de Brasília, blocos por permissão, preferência do usuário e consultas
 * (sempre filtradas pela empresa; só os blocos pedidos são consultados; bloco com erro não derruba os outros).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chaveDiaBR, inicioHojeBR, inicioMesBR } from "@/lib/fuso";
import { PRESETS, permissoesTotais, permissoesVazias } from "@/lib/permissoes";
import { aplicarPreferencia, blocosPermitidos, lerPreferencia, PREF_PADRAO, serializarPreferencia } from "@/lib/dashboard/blocos";

const chamadas = vi.hoisted(() => [] as { alvo: string; args: any }[]);
const falhar = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/prisma", () => {
  const model = (nome: string) => new Proxy({}, {
    get: (_t, metodo: string) => async (args: any) => {
      const alvo = `${nome}.${metodo}`;
      chamadas.push({ alvo, args });
      if (falhar.has(alvo)) throw new Error("tabela inexistente (simulado)");
      if (metodo === "findMany" || metodo === "groupBy") return [];
      if (metodo === "count") return 0;
      if (metodo === "aggregate") return { _sum: {}, _count: { _all: 0 } };
      if (metodo === "updateMany") return { count: 0 };
      return null;
    },
  });
  return { prisma: new Proxy({}, { get: (_t, nome: string) => model(nome) }) };
});

beforeEach(() => { chamadas.length = 0; falhar.clear(); });

describe("fuso de Brasília", () => {
  it("23h30 de Brasília ainda é o mesmo dia (servidor em UTC já virou)", () => {
    const agora = new Date("2026-10-07T02:30:00Z"); // 06/10 23:30 em Brasília
    expect(chaveDiaBR(agora)).toBe("2026-10-06");
    expect(inicioHojeBR(agora).toISOString()).toBe("2026-10-06T03:00:00.000Z");
    expect(inicioHojeBR(agora, 1).toISOString()).toBe("2026-10-07T03:00:00.000Z");
    expect(inicioMesBR(agora).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("virada de mês e de ano", () => {
    expect(inicioMesBR(new Date("2027-01-01T02:00:00Z")).toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(inicioMesBR(new Date("2026-12-15T12:00:00Z"), 1).toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
});

describe("blocos por permissão", () => {
  const ids = (p: any, role?: string) => blocosPermitidos(p, role).map((b) => b.id);

  it("técnico não vê Financeiro nem Comercial", () => {
    const t = ids(PRESETS.TECNICO);
    expect(t).not.toContain("financeiro");
    expect(t).not.toContain("comercial");
    expect(t).toEqual(expect.arrayContaining(["operacional", "os-do-dia", "agenda", "equipamentos", "frota"]));
  });

  it("financeiro vê Financeiro e Comercial, mas não Frota nem Equipamentos", () => {
    const f = ids(PRESETS.FINANCEIRO);
    expect(f).toEqual(expect.arrayContaining(["financeiro", "comercial", "operacional"]));
    expect(f).not.toContain("frota");
    expect(f).not.toContain("equipamentos");
  });

  it("Financeiro exige também 'contas a receber'", () => {
    const semCR = { ...PRESETS.FINANCEIRO, financeiro: { ...PRESETS.FINANCEIRO.financeiro, contasReceber: false } };
    expect(ids(semCR)).not.toContain("financeiro");
  });

  it("sem perfil não vê bloco nenhum; ADMIN vê todos", () => {
    expect(ids(permissoesVazias(), "OPERADOR")).toEqual([]);
    expect(ids(permissoesVazias(), "ADMIN")).toHaveLength(PREF_PADRAO.ordem.length);
  });
});

describe("preferência (cookie)", () => {
  it("cookie inválido ou vazio vira o padrão", () => {
    expect(lerPreferencia(undefined)).toEqual(PREF_PADRAO);
    expect(lerPreferencia("%%%nao-e-json")).toEqual(PREF_PADRAO);
  });

  it("ids desconhecidos e repetidos são descartados", () => {
    const p = lerPreferencia(encodeURIComponent(JSON.stringify({ ordem: ["frota", "hack", "frota", 3], ocultos: ["financeiro", "<script>"] })));
    expect(p).toEqual({ ordem: ["frota"], ocultos: ["financeiro"] });
  });

  it("aplica ordem e ocultos; bloco que não estava na ordem entra no fim", () => {
    const permitidos = blocosPermitidos(permissoesTotais());
    const pref = lerPreferencia(serializarPreferencia({ ordem: ["frota", "operacional"], ocultos: ["agenda"] }));
    const { todos, visiveis } = aplicarPreferencia(permitidos, pref);
    expect(todos.slice(0, 2).map((b) => b.id)).toEqual(["frota", "operacional"]);
    expect(todos).toHaveLength(permitidos.length);
    expect(visiveis.map((b) => b.id)).not.toContain("agenda");
  });

  it("preferência nunca libera bloco sem permissão", () => {
    const pref = lerPreferencia(serializarPreferencia({ ordem: ["financeiro", "operacional"], ocultos: [] }));
    const { visiveis } = aplicarPreferencia(blocosPermitidos(PRESETS.TECNICO), pref);
    expect(visiveis.map((b) => b.id)).not.toContain("financeiro");
  });
});

describe("consultas do dashboard", () => {
  const ctx = (podeTudo = true) => ({ empresaId: "e1", podeVer: () => podeTudo });

  /** Procura `empresaId` em qualquer nível do argumento da consulta. */
  function filtraEmpresa(args: any, empresa = "e1"): boolean {
    if (!args || typeof args !== "object") return false;
    if (args.empresaId === empresa) return true;
    return Object.values(args).some((v) => filtraEmpresa(v, empresa));
  }

  it("toda consulta filtra pela empresa do usuário", async () => {
    const { carregarBlocos } = await import("@/lib/dashboard/dados");
    await carregarBlocos(PREF_PADRAO.ordem, ctx());
    expect(chamadas.length).toBeGreaterThan(20);
    const semEmpresa = chamadas.filter((c) => !filtraEmpresa(c.args));
    expect(semEmpresa.map((c) => c.alvo)).toEqual([]);
  });

  it("só consulta os blocos pedidos (financeiro não roda para quem não o vê)", async () => {
    const { carregarBlocos } = await import("@/lib/dashboard/dados");
    await carregarBlocos(blocosPermitidos(PRESETS.TECNICO).map((b) => b.id), ctx());
    expect(chamadas.some((c) => c.alvo.startsWith("contaReceber."))).toBe(false);
    expect(chamadas.some((c) => c.alvo.startsWith("orcamento.") || c.alvo.startsWith("contrato."))).toBe(false);
  });

  it("listas são curtas (take) — nada de carregar tabelas inteiras", async () => {
    const { carregarBlocos } = await import("@/lib/dashboard/dados");
    await carregarBlocos(PREF_PADRAO.ordem, ctx());
    const listas = chamadas.filter((c) => c.alvo.endsWith(".findMany") && !c.alvo.startsWith("tecnico.") && !c.alvo.startsWith("equipe.") && !c.alvo.startsWith("veiculo.") && !c.alvo.startsWith("checklistPreenchido."));
    for (const l of listas) expect(l.args?.take, l.alvo).toBeGreaterThan(0);
  });

  it("um bloco com erro (ex.: coluna faltando no banco) não derruba os outros", async () => {
    falhar.add("contaReceber.aggregate");
    const { carregarBlocos } = await import("@/lib/dashboard/dados");
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const dados = await carregarBlocos(["operacional", "financeiro"], ctx());
    erro.mockRestore();
    expect(dados.financeiro).toEqual({ erro: true });
    expect(dados.operacional).toMatchObject({ abertas: 0 });
  });

  it("Comercial respeita contratos × orçamentos separadamente", async () => {
    const { carregarBlocos } = await import("@/lib/dashboard/dados");
    const dados: any = await carregarBlocos(["comercial"], { empresaId: "e1", podeVer: (m) => m === "orcamentos" });
    expect(dados.comercial.contratosAtivos).toBeNull();
    expect(dados.comercial.orcamentosAbertos).toBe(0);
    expect(chamadas.some((c) => c.alvo.startsWith("contrato."))).toBe(false);
  });
});
