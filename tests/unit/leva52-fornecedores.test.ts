/**
 * Leva 5.2 — cadastro de Fornecedor (padrão único) e ligação por ID na conta a pagar. Rotas reais,
 * banco em memória (duas empresas), no estado DEPOIS do SQL (o SQL em si é testado num PostgreSQL de
 * verdade em sql-fornecedores.test.ts). Prova:
 *  - criar/editar/inativar/reativar fornecedor com empresa da sessão e permissão; nada é apagado;
 *  - CNPJ/CPF único na empresa (só dígitos; outra empresa pode repetir; vazio não conflita);
 *  - conta a pagar antiga migrada mostra o fornecedor certo (pelo id); sem vínculo mostra o texto;
 *  - SeletorCadastro mantém o inativo já usado e não o oferece em nova escolha (tela e servidor);
 *  - fornecedorId de outra empresa é recusado; conta nova exige fornecedor do cadastro.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRESETS, permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return {
    prisma: criarPrisma(db, {
      fornecedor: (r, T) => ({ _count: { contasPagar: T("contaPagar").filter((c) => c.fornecedorId === r.id).length } }),
      contaPagar: (r, T) => ({
        fornecedorCadastro: T("fornecedor").find((f) => f.id === r.fornecedorId) ?? null,
        categoriaFinanceira: null, pedidoCompra: null, pagamentos: [],
      }),
      pedidoCompraInterno: (r, T) => ({ itens: T("pedidoCompraItem").filter((i) => i.pedidoId === r.id) }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const SO_FINANCEIRO_VER: Permissoes = { ...permissoesVazias(), financeiro: { visualizar: true } };
const LANCA_CONTAS: Permissoes = { ...permissoesVazias(), financeiro: { visualizar: true, fluxoCaixa: true } };

function semear() {
  db.escritas = [];
  db.t = {
    // Estado DEPOIS do SQL: fornecedores criados a partir do texto + contas ligadas
    fornecedor: [
      { id: "f-frigelar", empresaId: "e1", nome: "Frigelar Distribuidora", documento: "12345678000199", telefone: "1133334444", email: null, observacoes: "Gás e peças", ativo: true },
      { id: "f-posto", empresaId: "e1", nome: "Posto Ipiranga", documento: null, telefone: null, email: null, observacoes: null, ativo: true },
      { id: "f-velho", empresaId: "e1", nome: "Refrigeração Antiga", documento: "98765432000188", telefone: null, email: null, observacoes: null, ativo: false },
      { id: "f-B", empresaId: "e2", nome: "Frigelar Distribuidora", documento: "12345678000199", telefone: null, email: null, observacoes: null, ativo: true },
    ],
    contaPagar: [
      { id: "cp-frig", empresaId: "e1", numero: "CP-2026-0001", fornecedorId: "f-frigelar", fornecedor: "frigelar  distribuidora", fornecedorCnpj: "12.345.678/0001-99", descricao: "Gás", valorTotal: 300, valorPago: 0, saldoRestante: 300, status: "PENDENTE" },
      { id: "cp-frig2", empresaId: "e1", numero: "CP-2026-0002", fornecedorId: "f-frigelar", fornecedor: "Frigelar Distribuidora", fornecedorCnpj: null, descricao: "Peças", valorTotal: 100, valorPago: 100, saldoRestante: 0, status: "PAGO_TOTAL" },
      { id: "cp-velho", empresaId: "e1", numero: "CP-2026-0003", fornecedorId: "f-velho", fornecedor: "Refrigeração Antiga", fornecedorCnpj: null, descricao: "Compressor", valorTotal: 900, valorPago: 0, saldoRestante: 900, status: "PENDENTE" },
      { id: "cp-texto", empresaId: "e1", numero: "CP-2026-0004", fornecedorId: null, fornecedor: "Fornecedor a definir", fornecedorCnpj: null, descricao: "Pedido sem fornecedor", valorTotal: 50, valorPago: 0, saldoRestante: 50, status: "PENDENTE" },
      { id: "cp-B", empresaId: "e2", numero: "CP-2026-0001", fornecedorId: "f-B", fornecedor: "Frigelar Distribuidora", fornecedorCnpj: null, descricao: "Da outra", valorTotal: 1, valorPago: 0, saldoRestante: 1, status: "PENDENTE" },
    ],
    pagamentoContaPagar: [],
  };
}
beforeEach(() => { semear(); logar(); });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const col = () => import("@/app/api/cadastros/[entidade]/route");
const item = () => import("@/app/api/cadastros/[entidade]/[id]/route");
const impacto = () => import("@/app/api/cadastros/[entidade]/[id]/impacto/route");
const pagar = () => import("@/app/api/contas-pagar/route");
const pagarItem = () => import("@/app/api/contas-pagar/[id]/route");
const P = { entidade: "fornecedores" };
const linha = (m: string, id: string) => db.t[m].find((r) => r.id === id)!;
const listar = async (ativo = "sim") => (await chamar(col, "GET", P, undefined, `http://localhost/api/cadastros/fornecedores?ativo=${ativo}`)).json as any[];
const apagou = () => db.escritas.some((e) => e.startsWith("fornecedor.delete"));

// ═════════════════════════ Cadastro ═════════════════════════
describe("cadastro de fornecedor no padrão", () => {
  it("criar (documento só com dígitos, empresa da sessão, ativo) → editar parcial → inativar → reativar sem zerar nada", async () => {
    const r = await chamar(col, "POST", P, { nome: "Leroy Merlin", documento: "01.438.784/0001-05", telefone: "(11) 4000-0000", email: "COMPRAS@LEROY.COM.BR" });
    expect(r.status).toBe(201);
    const id = r.json.id;
    expect(linha("fornecedor", id)).toMatchObject({ empresaId: "e1", ativo: true, documento: "01438784000105", email: "compras@leroy.com.br" });
    expect((await chamar(item, "PATCH", { ...P, id }, { nome: "Leroy Merlin Brasil" })).status).toBe(200);
    expect(linha("fornecedor", id)).toMatchObject({ nome: "Leroy Merlin Brasil", documento: "01438784000105", telefone: "(11) 4000-0000" });
    expect((await chamar(item, "DELETE", { ...P, id })).status).toBe(200);
    expect(linha("fornecedor", id).ativo).toBe(false);
    expect((await listar()).map((f) => f.id)).not.toContain(id);
    expect((await listar("nao")).map((f) => f.id)).toContain(id);
    expect((await chamar(item, "PATCH", { ...P, id }, { ativo: true })).status).toBe(200);
    expect(linha("fornecedor", id)).toMatchObject({ ativo: true, nome: "Leroy Merlin Brasil", documento: "01438784000105", email: "compras@leroy.com.br" });
    expect(apagou()).toBe(false);
  });

  it("empresaId no corpo = 400; registro de outra empresa = 404 (e não muda)", async () => {
    expect((await chamar(col, "POST", P, { nome: "X", empresaId: "e2" })).status).toBe(400);
    logar(permissoesTotais(), "e2");
    expect((await chamar(item, "PATCH", { ...P, id: "f-frigelar" }, { nome: "Invadido" })).status).toBe(404);
    expect((await chamar(item, "DELETE", { ...P, id: "f-frigelar" })).status).toBe(404);
    expect(linha("fornecedor", "f-frigelar")).toMatchObject({ nome: "Frigelar Distribuidora", ativo: true });
  });

  it("permissão antes de gravar: técnico = 403 em tudo; só ver o financeiro lista mas não grava; quem lança contas grava", async () => {
    logar(PRESETS.TECNICO);
    const antes = db.escritas.length;
    expect((await chamar(col, "POST", P, { nome: "Hack" })).status).toBe(403);
    expect((await chamar(item, "PATCH", { ...P, id: "f-posto" }, { nome: "Hack" })).status).toBe(403);
    expect((await chamar(item, "DELETE", { ...P, id: "f-posto" })).status).toBe(403);
    logar(SO_FINANCEIRO_VER);
    expect((await listar()).length).toBe(2);
    expect((await chamar(col, "POST", P, { nome: "Hack" })).status).toBe(403);
    expect(db.escritas.length).toBe(antes);
    logar(LANCA_CONTAS);
    expect((await chamar(col, "POST", P, { nome: "Casa do Ar" })).status).toBe(201);
  });

  it("CNPJ/CPF único na empresa: repetido (mesmo formatado diferente) = 409, inclusive de inativo; outra empresa e vazio não conflitam", async () => {
    const dup = await chamar(col, "POST", P, { nome: "Frigelar 2", documento: "12345678000199" });
    expect(dup.status).toBe(409);
    expect(dup.json.erro).toBe("Já existe um fornecedor com este CNPJ/CPF: “Frigelar Distribuidora”.");
    const inativo = await chamar(col, "POST", P, { nome: "Antiga de novo", documento: "98.765.432/0001-88" });
    expect(inativo.status).toBe(409);
    expect(inativo.json.erro).toMatch(/inativo — reative-o/);
    expect((await chamar(item, "PATCH", { ...P, id: "f-posto" }, { documento: "12.345.678/0001-99" })).status).toBe(409);
    expect(linha("fornecedor", "f-posto").documento).toBeNull();
    expect((await chamar(item, "PATCH", { ...P, id: "f-frigelar" }, { documento: "12345678000199", nome: "Frigelar" })).status).toBe(200); // o próprio
    expect((await chamar(col, "POST", P, { nome: "Sem doc 1" })).status).toBe(201);
    expect((await chamar(col, "POST", P, { nome: "Sem doc 2", documento: "" })).status).toBe(201);
    expect((await chamar(col, "POST", P, { nome: "Doc errado", documento: "123" })).status).toBe(400);
    logar(permissoesTotais(), "e2");
    expect((await chamar(col, "POST", P, { nome: "Outra empresa", documento: "98765432000188" })).status).toBe(201);
  });

  it("impacto antes de inativar: contas a pagar ligadas (e em aberto); deixa inativar e as contas seguem ligadas", async () => {
    const i = (await chamar(impacto, "GET", { ...P, id: "f-frigelar" })).json;
    expect(i.bloqueio).toBeNull();
    expect(i.avisos[0]).toBe("Usado em 2 contas a pagar (1 em aberto). Elas continuam ligadas a ele (aparece como “inativo”); ele só deixa de ser oferecido em contas novas.");
    expect((await chamar(item, "DELETE", { ...P, id: "f-frigelar" })).status).toBe(200);
    expect(linha("contaPagar", "cp-frig").fornecedorId).toBe("f-frigelar");
  });

  it("ações em massa: inativa e reativa pela mesma regra", async () => {
    const { POST } = await import("@/app/api/acoes-massa/route");
    const massa = async (acao: string) => (await POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", body: JSON.stringify({ entidade: "fornecedores", acao, ids: ["f-posto"] }) }))).json();
    expect((await massa("inativar")).resultados[0]).toMatchObject({ ok: true });
    expect(linha("fornecedor", "f-posto").ativo).toBe(false);
    expect((await massa("reativar")).resultados[0]).toMatchObject({ ok: true });
    expect(linha("fornecedor", "f-posto").ativo).toBe(true);
  });
});

// ═════════════════════════ Conta a pagar ═════════════════════════
describe("conta a pagar ligada ao fornecedor", () => {
  it("após a migração, a conta antiga mostra o fornecedor certo (pelo id, nome e CNPJ do cadastro)", async () => {
    const lista = (await chamar(pagar, "GET", {})).json as any[];
    const { fornecedorDaConta } = await import("@/lib/financeiro/fornecedor");
    expect(fornecedorDaConta(lista.find((c) => c.id === "cp-frig"))).toMatchObject({ id: "f-frigelar", nome: "Frigelar Distribuidora", documento: "12345678000199", semCadastro: false });
    // Renomear o fornecedor: a conta acompanha (aponta pelo id)
    await chamar(item, "PATCH", { ...P, id: "f-frigelar" }, { nome: "Frigelar S.A." });
    const depois = (await chamar(pagar, "GET", {})).json as any[];
    expect(fornecedorDaConta(depois.find((c) => c.id === "cp-frig")).nome).toBe("Frigelar S.A.");
    // Sem vínculo: o texto antigo
    expect(fornecedorDaConta(depois.find((c) => c.id === "cp-texto"))).toMatchObject({ id: null, nome: "Fornecedor a definir", semCadastro: true });
    expect(depois.every((c) => c.empresaId === "e1")).toBe(true);
  });

  it("conta nova: exige fornecedor do cadastro; grava o id e copia nome/CNPJ; outra empresa ou inativo = 400", async () => {
    const base = { descricao: "Compressor", valorTotal: 900 };
    const sem = await chamar(pagar, "POST", {}, { ...base, fornecedor: "Texto livre" });
    expect(sem.status).toBe(400);
    expect(sem.json.erro).toMatch(/Escolha o fornecedor/);
    const ok = await chamar(pagar, "POST", {}, { ...base, fornecedorId: "f-frigelar" });
    expect(ok.status).toBe(201);
    expect(linha("contaPagar", ok.json.id)).toMatchObject({ fornecedorId: "f-frigelar", fornecedor: "Frigelar Distribuidora", fornecedorCnpj: "12345678000199", empresaId: "e1" });
    const outra = await chamar(pagar, "POST", {}, { ...base, fornecedorId: "f-B" });
    expect(outra.status).toBe(400);
    expect(outra.json.erro).toBe("Fornecedor inválido(a).");
    expect((await chamar(pagar, "POST", {}, { ...base, fornecedorId: "f-velho" })).json.erro).toBe("Fornecedor inativo(a): escolha um(a) ativo(a).");
  });

  it("editar: manter o fornecedor inativo que já tinha = 200; trocar para inativo ou de outra empresa = 400", async () => {
    expect((await chamar(pagarItem, "PUT", { id: "cp-velho" }, { fornecedorId: "f-velho", descricao: "Compressor 2" })).status).toBe(200);
    expect(linha("contaPagar", "cp-velho")).toMatchObject({ fornecedorId: "f-velho", descricao: "Compressor 2" });
    expect((await chamar(pagarItem, "PUT", { id: "cp-frig" }, { fornecedorId: "f-velho" })).status).toBe(400);
    expect((await chamar(pagarItem, "PUT", { id: "cp-frig" }, { fornecedorId: "f-B" })).status).toBe(400);
    expect(linha("contaPagar", "cp-frig").fornecedorId).toBe("f-frigelar");
  });

  it("conta antiga sem vínculo: editar outra coisa mantém o texto; escolher o fornecedor liga a conta", async () => {
    expect((await chamar(pagarItem, "PUT", { id: "cp-texto" }, { descricao: "Pedido 12" })).status).toBe(200);
    expect(linha("contaPagar", "cp-texto")).toMatchObject({ fornecedorId: null, fornecedor: "Fornecedor a definir", descricao: "Pedido 12" });
    expect((await chamar(pagarItem, "PUT", { id: "cp-texto" }, { fornecedorId: "f-posto" })).status).toBe(200);
    expect(linha("contaPagar", "cp-texto")).toMatchObject({ fornecedorId: "f-posto", fornecedor: "Posto Ipiranga" });
  });

  it("conta gerada do pedido de compra liga o fornecedor ativo de mesmo nome (maiúsculas/espaços não contam)", async () => {
    db.t.pedidoCompraInterno = [{ id: "pc1", empresaId: "e1", numero: "PC-0001", prazoNecessario: null }];
    db.t.pedidoCompraItem = [{ id: "pi1", pedidoId: "pc1", fornecedor: "  FRIGELAR distribuidora ", quantidade: 2, valorEstimado: 10, valorReal: null }];
    const { gerarContaPagarDoPedido } = await import("@/lib/financeiro-server");
    const c: any = await gerarContaPagarDoPedido("pc1");
    expect(linha("contaPagar", c.id)).toMatchObject({ fornecedorId: "f-frigelar", fornecedor: "Frigelar Distribuidora", fornecedorCnpj: "12345678000199" });
  });

  it("SeletorCadastro: o inativo já usado aparece “(inativo)”; em nova escolha não é oferecido", async () => {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const itens = db.t.fornecedor.filter((f) => f.empresaId === "e1").map((f) => ({ id: f.id, nome: f.nome, ativo: f.ativo }));
    const html = (valor: string) => renderToStaticMarkup(createElement(SeletorCadastro, { entidade: "fornecedores", itens, valor, onChange: () => {} }));
    expect(html("f-velho")).toMatch(/<option value="f-velho"[^>]*selected[^>]*>Refrigeração Antiga \(inativo\)/);
    expect(html("")).not.toContain("Refrigeração Antiga");
    expect(html("")).toContain('<option value="f-frigelar">Frigelar Distribuidora</option>');
  });
});
