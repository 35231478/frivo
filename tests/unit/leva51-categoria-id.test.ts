/**
 * Leva 5.1 — categoria financeira por ID nas contas a receber e a pagar. Rotas reais, banco em
 * memória (duas empresas), no estado DEPOIS do SQL de migração (o SQL em si é testado num
 * PostgreSQL de verdade em sql-categoria-financeira-por-id.test.ts). Prova:
 *  - conta antiga migrada mostra a categoria certa (agora por id); sem vínculo, mostra o texto antigo;
 *  - renomear a categoria mantém as contas ligadas (nome novo, mesma cor, mesmo filtro) — era o bug;
 *  - conta a pagar agora tem categoria (criar, editar, listar);
 *  - categoriaId de outra empresa é recusado; categoria inativa já usada continua “(inativa)”, mas
 *    não é oferecida nem aceita em escolha nova;
 *  - inativar categoria em uso avisa “usada em N contas” e deixa inativar (as contas seguem ligadas);
 *  - editar outra coisa de uma conta antiga não apaga o texto; escolher a categoria liga a conta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const cat = (T: (m: string) => any[], id: string | null) => T("categoriaFinanceira").find((c) => c.id === id) ?? null;
  return {
    prisma: criarPrisma(db, {
      contaReceber: (r, T) => ({ categoriaFinanceira: cat(T, r.categoriaId) }),
      contaPagar: (r, T) => ({ categoriaFinanceira: cat(T, r.categoriaId), pedidoCompra: null, pagamentos: [] }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}) }));

const logar = (empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes: permissoesTotais() } };
};

const CATEGORIAS = () => db.t.categoriaFinanceira.filter((c) => c.empresaId === "e1").map((c) => ({ id: c.id, nome: c.nome, cor: c.cor, ativo: c.ativo }));

function semear() {
  db.escritas = [];
  db.t = {
    categoriaFinanceira: [
      { id: "cat-mensal", empresaId: "e1", nome: "Contrato mensal", cor: "#16A34A", ativo: true },
      { id: "cat-pecas", empresaId: "e1", nome: "Peças (tabela antiga)", cor: "#F59E0B", ativo: false },
      { id: "cat-avulso", empresaId: "e1", nome: "Serviço avulso", cor: "#2563EB", ativo: true },
      { id: "cat-contrato", empresaId: "e1", nome: "Contrato", cor: "#7C3AED", ativo: true },
      { id: "cat-B", empresaId: "e2", nome: "Contrato mensal", cor: "#000000", ativo: true },
    ],
    cliente: [{ id: "cli1", empresaId: "e1", nome: "Hospital", cpfCnpj: "12345678000199" }, { id: "cliB", empresaId: "e2", nome: "Outro", cpfCnpj: "1" }],
    // Estado DEPOIS do SQL: nome casou → categoriaId preenchido; não casou → só o texto
    contaReceber: [
      { id: "cr-mensal", empresaId: "e1", clienteId: "cli1", numero: "CR-2026-0001", descricao: "Mensalidade março", valor: 500, status: "A_RECEBER", categoriaId: "cat-mensal", categoria: "Contrato mensal" },
      { id: "cr-mensal2", empresaId: "e1", clienteId: "cli1", numero: "CR-2026-0002", descricao: "Mensalidade abril", valor: 500, status: "A_RECEBER", categoriaId: "cat-mensal", categoria: "Contrato mensal" },
      { id: "cr-pecas", empresaId: "e1", clienteId: "cli1", numero: "CR-2026-0003", descricao: "Peças", valor: 80, status: "A_RECEBER", categoriaId: "cat-pecas", categoria: "Peças (tabela antiga)" },
      { id: "cr-texto", empresaId: "e1", clienteId: "cli1", numero: "CR-2026-0004", descricao: "Antiga", valor: 10, status: "A_RECEBER", categoriaId: null, categoria: "Manutenção 2019" },
      { id: "cr-B", empresaId: "e2", clienteId: "cliB", numero: "CR-2026-0001", descricao: "Da outra", valor: 1, status: "A_RECEBER", categoriaId: "cat-B", categoria: "Contrato mensal" },
    ],
    contaPagar: [
      { id: "cp1", empresaId: "e1", numero: "CP-2026-0001", fornecedor: "Frigelar", descricao: "Gás", valorTotal: 300, valorPago: 0, saldoRestante: 300, status: "PENDENTE", categoriaId: "cat-pecas" },
    ],
    pagamentoContaPagar: [],
    fornecedor: [{ id: "forn1", empresaId: "e1", nome: "Frigelar", documento: null, ativo: true }],
    medicao: [],
  };
}
beforeEach(() => { semear(); logar(); });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await carregar();
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const receber = () => import("@/app/api/contas-receber/route");
const receberItem = () => import("@/app/api/contas-receber/[id]/route");
const pagar = () => import("@/app/api/contas-pagar/route");
const pagarItem = () => import("@/app/api/contas-pagar/[id]/route");
const categoriaItem = () => import("@/app/api/cadastros/[entidade]/[id]/route");
const impacto = () => import("@/app/api/cadastros/[entidade]/[id]/impacto/route");
const linha = (m: string, id: string) => db.t[m].find((r) => r.id === id)!;
const selo = async (conta: { categoriaId?: string | null; categoria?: string | null }) => {
  const { CategoriaBadge } = await import("@/components/financeiro/categoria-badge");
  return renderToStaticMarkup(createElement(CategoriaBadge, { conta, categorias: CATEGORIAS() }));
};

// ═════════════════════════ Depois da migração ═════════════════════════
describe("conta antiga depois da migração", () => {
  it("mostra a categoria certa, agora pela ligação por id (nome e cor da categoria)", async () => {
    const html = await selo(linha("contaReceber", "cr-mensal"));
    expect(html).toContain("Contrato mensal");
    expect(html).toContain("color:#16A34A");
    expect(html).toContain('data-categoria="cat-mensal"');
  });
  it("categoria inativa já usada aparece “(inativa)” e continua ligada", async () => {
    const html = await selo(linha("contaReceber", "cr-pecas"));
    expect(html).toContain("Peças (tabela antiga) (inativa)");
    expect(html).toContain("color:#F59E0B");
  });
  it("conta cujo nome não casou: mostra o texto antigo, sem inventar categoria", async () => {
    const html = await selo(linha("contaReceber", "cr-texto"));
    expect(html).toContain("Manutenção 2019 (sem cadastro)");
    expect(html).toContain('data-categoria="sem-cadastro"');
    expect(db.t.categoriaFinanceira.some((c) => c.nome === "Manutenção 2019")).toBe(false);
  });
});

// ═════════════════════════ O bug: renomear desligava ═════════════════════════
describe("renomear a categoria mantém as contas ligadas", () => {
  it("nome novo nas contas, mesma cor, mesma contagem de uso — e o filtro (por id) continua achando", async () => {
    const r = await chamar(categoriaItem, "PATCH", { entidade: "categorias-financeiras", id: "cat-mensal" }, { nome: "Mensalidade de contrato" });
    expect(r.status).toBe(200);
    // As contas não mudaram: continuam apontando para a mesma categoria
    expect(linha("contaReceber", "cr-mensal").categoriaId).toBe("cat-mensal");
    const html = await selo(linha("contaReceber", "cr-mensal"));
    expect(html).toContain("Mensalidade de contrato");
    expect(html).toContain("color:#16A34A");
    const i = (await chamar(impacto, "GET", { entidade: "categorias-financeiras", id: "cat-mensal" })).json;
    expect(i.avisos[0]).toBe("Em uso: 2 contas a receber.");
    // Filtro e agrupamento usam o id
    const { categoriaDaConta } = await import("@/lib/financeiro/categoria");
    const porCategoria = db.t.contaReceber.filter((c) => c.empresaId === "e1" && categoriaDaConta(c, CATEGORIAS())?.id === "cat-mensal");
    expect(porCategoria.map((c) => c.id)).toEqual(["cr-mensal", "cr-mensal2"]);
  });
});

// ═════════════════════════ Conta a pagar ═════════════════════════
describe("conta a pagar agora tem categoria", () => {
  const base = { fornecedorId: "forn1", descricao: "Compressor", valorTotal: 900 }; // Leva 5.2: fornecedor pelo cadastro
  it("criar com categoria (por id), listar com a categoria, editar trocando de categoria", async () => {
    const r = await chamar(pagar, "POST", {}, { ...base, categoriaId: "cat-avulso" });
    expect(r.status).toBe(201);
    expect(linha("contaPagar", r.json.id)).toMatchObject({ categoriaId: "cat-avulso", empresaId: "e1" });
    const lista = (await chamar(pagar, "GET", {})).json as any[];
    expect(lista.find((c) => c.id === r.json.id).categoriaFinanceira).toMatchObject({ id: "cat-avulso", nome: "Serviço avulso" });
    expect((await chamar(pagarItem, "PUT", { id: r.json.id }, { categoriaId: "cat-mensal" })).status).toBe(200);
    expect(linha("contaPagar", r.json.id).categoriaId).toBe("cat-mensal");
    expect((await chamar(pagarItem, "PUT", { id: r.json.id }, { categoriaId: null })).status).toBe(200);
    expect(linha("contaPagar", r.json.id).categoriaId).toBeNull();
    const sem = await chamar(pagar, "POST", {}, base);
    expect(linha("contaPagar", sem.json.id).categoriaId).toBeNull();
  });
  it("categoria de outra empresa = 400; inativa em escolha nova = 400; manter a inativa que já tinha = 200", async () => {
    const outra = await chamar(pagar, "POST", {}, { ...base, categoriaId: "cat-B" });
    expect(outra.status).toBe(400);
    expect(outra.json.erro).toBe("Categoria financeira inválido(a).");
    expect((await chamar(pagar, "POST", {}, { ...base, categoriaId: "cat-pecas" })).status).toBe(400);
    expect((await chamar(pagarItem, "PUT", { id: "cp1" }, { categoriaId: "cat-pecas", descricao: "Gás R410" })).status).toBe(200);
    expect(linha("contaPagar", "cp1")).toMatchObject({ categoriaId: "cat-pecas", descricao: "Gás R410" });
    expect((await chamar(pagarItem, "PUT", { id: "cp1" }, { categoriaId: "cat-B" })).status).toBe(400);
    expect(linha("contaPagar", "cp1").categoriaId).toBe("cat-pecas");
  });
  it("selo da conta a pagar usa a categoria ligada", async () => {
    expect(await selo(linha("contaPagar", "cp1"))).toContain("Peças (tabela antiga) (inativa)");
  });
});

// ═════════════════════════ Conta a receber ═════════════════════════
describe("conta a receber grava e lê por id", () => {
  it("criar: grava o id (e o nome só como histórico); outra empresa ou inativa = 400", async () => {
    const r = await chamar(receber, "POST", {}, { clienteId: "cli1", descricao: "Visita", valor: 120, categoriaId: "cat-avulso" });
    expect(r.status).toBe(201);
    expect(linha("contaReceber", r.json.id)).toMatchObject({ categoriaId: "cat-avulso", categoria: "Serviço avulso" });
    expect((await chamar(receber, "POST", {}, { clienteId: "cli1", descricao: "X", valor: 1, categoriaId: "cat-B" })).status).toBe(400);
    expect((await chamar(receber, "POST", {}, { clienteId: "cli1", descricao: "X", valor: 1, categoriaId: "cat-pecas" })).json.erro)
      .toBe("Categoria financeira inativo(a): escolha um(a) ativo(a).");
  });
  it("nome no corpo não liga nada (o vínculo é o id)", async () => {
    const r = await chamar(receber, "POST", {}, { clienteId: "cli1", descricao: "Visita", valor: 120, categoria: "Serviço avulso" });
    expect(r.status).toBe(201);
    expect(linha("contaReceber", r.json.id)).toMatchObject({ categoriaId: null, categoria: null });
  });
  it("editar: inativa nova = 400; manter a inativa = 200; de outra empresa = 400", async () => {
    expect((await chamar(receberItem, "PUT", { id: "cr-mensal" }, { categoriaId: "cat-pecas" })).status).toBe(400);
    expect((await chamar(receberItem, "PUT", { id: "cr-pecas" }, { categoriaId: "cat-pecas", descricao: "Peças 2" })).status).toBe(200);
    expect((await chamar(receberItem, "PUT", { id: "cr-mensal" }, { categoriaId: "cat-B" })).status).toBe(400);
    expect(linha("contaReceber", "cr-mensal").categoriaId).toBe("cat-mensal");
  });
  it("conta antiga sem vínculo: editar outra coisa não apaga o texto; escolher a categoria liga a conta", async () => {
    expect((await chamar(receberItem, "PUT", { id: "cr-texto" }, { descricao: "Antiga (revisada)" })).status).toBe(200);
    expect(linha("contaReceber", "cr-texto")).toMatchObject({ categoriaId: null, categoria: "Manutenção 2019", descricao: "Antiga (revisada)" });
    expect((await chamar(receberItem, "PUT", { id: "cr-texto" }, { categoriaId: "cat-avulso" })).status).toBe(200);
    expect(linha("contaReceber", "cr-texto")).toMatchObject({ categoriaId: "cat-avulso", categoria: "Serviço avulso" });
  });
  it("conta gerada pelo contrato liga a categoria ativa “Contrato” da empresa", async () => {
    const hoje = new Date();
    db.t.contrato = [{
      id: "ct1", empresaId: "e1", clienteId: "cli1", numero: "CT-001", status: "ATIVO", valorMensal: 800,
      dataInicio: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1), dataFim: new Date(hoje.getFullYear(), hoje.getMonth() + 2, 28),
      periodicidade: "MENSAL", diaFaturamento: 10, tipoVencimento: "DIAS_APOS", diasAposVencimento: 5, ajusteFinsDeSemana: "NENHUM",
      cliente: { cpfCnpj: "12345678000199" },
    }];
    const { gerarPrevisaoContratoContasReceber } = await import("@/lib/financeiro-server");
    expect(await gerarPrevisaoContratoContasReceber("ct1")).toBeGreaterThan(0);
    const geradas = db.t.contaReceber.filter((c) => c.numero?.startsWith("CT-001/"));
    expect(geradas.length).toBeGreaterThan(0);
    expect(geradas.every((c) => c.categoriaId === "cat-contrato" && c.categoria === "Contrato")).toBe(true);
  });
});

// ═════════════════════════ Seletor e inativação ═════════════════════════
describe("seletor de categoria e inativação", () => {
  it("SeletorCadastro: a inativa já usada aparece “(inativa)”; em nova escolha não é oferecida (valor = id)", async () => {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const html = (valor: string) => renderToStaticMarkup(createElement(SeletorCadastro, { entidade: "categorias-financeiras", itens: CATEGORIAS(), valor, vazio: "Sem categoria", onChange: () => {} }));
    expect(html("cat-pecas")).toMatch(/<option value="cat-pecas"[^>]*selected[^>]*>Peças \(tabela antiga\) \(inativa\)/);
    expect(html("")).not.toContain("Peças");
    expect(html("")).toContain('<option value="cat-mensal">Contrato mensal</option>');
  });
  it("inativar categoria em uso: avisa “usada em N contas” e deixa inativar; as contas seguem ligadas", async () => {
    db.t.contaPagar.push({ id: "cp2", empresaId: "e1", numero: "CP-2026-0002", fornecedor: "X", descricao: "Y", valorTotal: 1, valorPago: 0, saldoRestante: 1, status: "PENDENTE", categoriaId: "cat-mensal" });
    const i = (await chamar(impacto, "GET", { entidade: "categorias-financeiras", id: "cat-mensal" })).json;
    expect(i.bloqueio).toBeNull();
    expect(i.avisos[0]).toBe("Em uso: 2 contas a receber e 1 conta a pagar.");
    expect((await chamar(categoriaItem, "DELETE", { entidade: "categorias-financeiras", id: "cat-mensal" })).status).toBe(200);
    expect(linha("categoriaFinanceira", "cat-mensal").ativo).toBe(false);
    expect(linha("contaReceber", "cr-mensal").categoriaId).toBe("cat-mensal");
    expect(linha("contaPagar", "cp2").categoriaId).toBe("cat-mensal");
    expect(await selo(linha("contaReceber", "cr-mensal"))).toContain("Contrato mensal (inativa)");
  });
  it("impacto conta só as contas da empresa (a categoria homônima da outra empresa não entra)", async () => {
    const i = (await chamar(impacto, "GET", { entidade: "categorias-financeiras", id: "cat-avulso" })).json;
    expect(i.avisos[0]).toBe("Não está em uso em nenhum registro.");
  });
});
