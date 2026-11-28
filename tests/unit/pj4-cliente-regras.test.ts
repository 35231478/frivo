/**
 * pj4 — pontas da ficha do cliente (Leva H), as regras e rotas sem banco:
 *  - H01: sem o financeiro, o cabeçalho não mostra valores, e a página nem os manda ("Inadimplente", sem o valor);
 *  - H17: "N contratos ativos" só vira link com Contratos › Visualizar, e com o filtro de ativos;
 *  - H05: o endereço da consulta do CNPJ é tudo ou nada (rua ou CEP já preenchidos: não mexe);
 *  - H08: cliente novo cujo local informado é o próprio endereço principal: esse local vira o principal;
 *  - H13: o histórico agrupa o dia civil (meia-noite UTC do dia 1º) no próprio mês;
 *  - H03: CPF/CNPJ conferido pelos dígitos verificadores, com mensagem clara;
 *  - H04: a BrasilAPI caiu (rede/tempo esgotado): a consulta do CNPJ vai ao próximo provedor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { montarPermissoes, pode, type Permissoes } from "@/lib/permissoes";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const ficha = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/clientes/ficha-server", () => ({ carregarFichaCliente: vi.fn(async () => ficha.atual) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const logar = (permissoes: Permissoes, role = "OPERADOR") => { sessao.atual = { user: { id: "u1", empresaId: "e1", role, permissoes } }; };

describe("H01 — valores do financeiro no cabeçalho", () => {
  it("sem o financeiro: \"Inadimplente\" sem o valor, e nada de \"a receber\"", async () => {
    const { sinaisDoCliente } = await import("@/lib/clientes/cabecalho");
    const s = sinaisDoCliente({ clienteId: "c1", ativo: true, valorEmAtraso: 0, totalProximos30Dias: 0, contratosAtivos: 0, emAtraso: true });
    expect(s).toEqual([{ id: "inadimplente", rotulo: "Inadimplente", tom: "atrasado" }]);
  });

  it("veFinanceiroDoCliente: contas a receber ou faturas; valoresDoCabecalho: sem ele, só se há atraso", async () => {
    const { valoresDoCabecalho, veFinanceiroDoCliente } = await import("@/lib/clientes/cabecalho");
    const com = (p: Permissoes) => veFinanceiroDoCliente((m, a) => pode(p, m, a, "OPERADOR"));
    expect(com(montarPermissoes({ clientes: ["visualizar"] }))).toBe(false);
    expect(com(montarPermissoes({ financeiro: ["contasReceber"] }))).toBe(true);
    expect(com(montarPermissoes({ financeiro: ["medicoes"] }))).toBe(true);
    const f = { valorEmAtraso: 2950, totalProximos30Dias: 1200 };
    expect(valoresDoCabecalho(f, true)).toEqual({ valorEmAtraso: 2950, totalProximos30Dias: 1200, emAtraso: true });
    expect(valoresDoCabecalho(f, false)).toEqual({ emAtraso: true });
    expect(valoresDoCabecalho({ valorEmAtraso: 0.004, totalProximos30Dias: 9 }, false)).toEqual({ emAtraso: false });
  });

  it("a página da ficha (e a da edição) não manda os valores para quem não vê o financeiro", async () => {
    ficha.atual = { dados: { id: "c1" }, valorEmAtraso: 2950, totalProximos30Dias: 1200, perdas12m: null, satisfacao: null };
    const args = { params: Promise.resolve({ id: "c1" }), searchParams: Promise.resolve({}) };
    const ficha$ = (await import("@/app/(dashboard)/clientes/[id]/page")).default;
    const editar$ = (await import("@/app/(dashboard)/clientes/[id]/editar/page")).default;
    const propsDe = (el: any) => (el.props.initialData ? el.props : el.props.children.props);

    logar(montarPermissoes({ clientes: ["visualizar", "editar"] }));
    for (const pagina of [ficha$, editar$]) {
      const p = propsDe(await pagina(args));
      expect(p).not.toHaveProperty("valorEmAtraso");
      expect(p).not.toHaveProperty("totalProximos30Dias");
      expect(p.emAtraso).toBe(true);
    }
    logar(montarPermissoes({ clientes: ["visualizar"], financeiro: ["contasReceber"] }));
    const p = propsDe(await ficha$(args));
    expect([p.valorEmAtraso, p.totalProximos30Dias, p.emAtraso]).toEqual([2950, 1200, true]);
  });
});

describe("H17 — link dos contratos ativos", () => {
  it("só com Contratos › Visualizar, e já filtrando os ativos do cliente", async () => {
    const { sinaisDoCliente } = await import("@/lib/clientes/cabecalho");
    const base = { clienteId: "c1", ativo: true, valorEmAtraso: 0, totalProximos30Dias: 0, contratosAtivos: 2 };
    expect(sinaisDoCliente(base)[0]).toEqual({ id: "contratos", rotulo: "2 contratos ativos", tom: "ok" });
    expect(sinaisDoCliente({ ...base, podeVerContratos: true })[0].href).toBe("/contratos?clienteId=c1&status=ATIVO");
  });
});

describe("H05 — endereço da consulta do CNPJ: tudo ou nada", () => {
  const CONSULTA = { cep: "74000-000", endereco: "Avenida Central", numero: "1000", bairro: "Setor Central", cidade: "Goiânia", estado: "GO" };
  it("com rua ou CEP já preenchidos, não preenche nada (não mistura a rua digitada com o CEP da Receita)", async () => {
    const { enderecoDaConsulta } = await import("@/lib/clientes/endereco-principal");
    expect(enderecoDaConsulta(CONSULTA, { endereco: "Rua Velha", numero: "5" })).toEqual({});
    expect(enderecoDaConsulta(CONSULTA, { cep: "01310-100" })).toEqual({});
    // sem rua e sem CEP: preenche os vazios, como antes
    expect(enderecoDaConsulta(CONSULTA, { numero: "12", endereco: "  " })).toEqual({ cep: "74000-000", endereco: "Avenida Central", bairro: "Setor Central", cidade: "Goiânia", estado: "GO" });
  });
});

describe("H08 — cliente novo: o local igual ao endereço principal vira o principal", () => {
  it("o local informado sem selo Principal (a tela marca os extras como secundários) passa a ser o principal", async () => {
    const { locaisDoClienteNovo } = await import("@/lib/clientes/endereco-principal");
    const e = { endereco: "Avenida Central", numero: "1000", cidade: "Goiânia" };
    const r = locaisDoClienteNovo(e, [
      { nome: "Depósito", logradouro: "Rua B", numero: "9", principal: true },
      { nome: "Matriz", logradouro: "avenida central", numero: "1000", principal: false },
    ]);
    expect(r.principal).toBeNull();
    expect(r.locais.map((l) => [l.nome, l.principal])).toEqual([["Depósito", false], ["Matriz", true]]);
  });
});

describe("H13 — histórico por mês: dia civil no próprio mês", () => {
  it("pagamento gravado à meia-noite UTC do dia 1º fica no mês dele (não no anterior)", async () => {
    const { agruparPorMes } = await import("@/lib/clientes/historico");
    const ev = (id: string, iso: string) => ({ id, tipo: "financeiro" as const, titulo: id, quando: new Date(iso) });
    const g = agruparPorMes([ev("pag", "2026-12-01T00:00:00Z"), ev("os", "2026-12-01T01:00:00Z")]);
    expect(g.map((x) => [x.chave, x.rotulo, x.eventos.map((e) => e.id)])).toEqual([
      ["2026-12", "Dezembro de 2026", ["pag"]],
      ["2026-11", "Novembro de 2026", ["os"]], // instante: 22h do dia 30/11 em Brasília
    ]);
  });
});

describe("H03 — CPF/CNPJ válido de verdade", () => {
  it("dígito verificador errado: mensagem clara para CNPJ e para CPF; válido: nada", async () => {
    const { erroDocumentoCliente, mesmoDocumento } = await import("@/lib/clientes/documento-server");
    expect(erroDocumentoCliente("JURIDICA", "11.222.333/0001-82")).toBe("CNPJ inválido: confira os 14 dígitos.");
    expect(erroDocumentoCliente("JURIDICA", "11.222.333/0001-81")).toBeNull();
    expect(erroDocumentoCliente("FISICA", "111.444.777-36")).toBe("CPF inválido: confira os 11 dígitos.");
    expect(erroDocumentoCliente("FISICA", "111.444.777-35")).toBeNull();
    expect(mesmoDocumento("11.222.333/0001-81", "11222333000181")).toBe(true);
  });
});

describe("H04 — consulta do CNPJ: a BrasilAPI caiu, vai ao próximo provedor", () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => { sessao.atual = { user: { id: "u1", empresaId: "e1" } }; });
  afterEach(() => { globalThis.fetch = fetchOriginal; });

  async function consultar() {
    const { GET } = await import("@/app/api/cnpj/[cnpj]/route");
    const res = await GET(new NextRequest("http://localhost/api/cnpj/11222333000181"), { params: Promise.resolve({ cnpj: "11222333000181" }) });
    return { status: res.status, json: await res.json() };
  }
  const receitaWs = () => new Response(JSON.stringify({ status: "OK", nome: "Termofrio Ltda", fantasia: "Termofrio", municipio: "Goiânia", uf: "GO" }), { status: 200 });

  for (const [caso, erro] of [
    ["rede fora", new TypeError("fetch failed")],
    ["tempo esgotado", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })],
  ] as const) {
    it(`${caso}: responde com o ReceitaWS (não 500/504)`, async () => {
      const urls: string[] = [];
      globalThis.fetch = vi.fn(async (u: any) => {
        urls.push(String(u));
        if (String(u).includes("brasilapi")) throw erro;
        return receitaWs();
      }) as any;
      const r = await consultar();
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ nome: "Termofrio Ltda", nomeFantasia: "Termofrio", cidade: "Goiânia", estado: "GO" });
      expect(urls.map((u) => new URL(u).hostname)).toEqual(["brasilapi.com.br", "receitaws.com.br"]);
    });
  }
});
