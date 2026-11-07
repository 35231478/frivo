/**
 * Estoque E1 — fundação. Regras puras + rotas e páginas reais com banco em memória (DUAS empresas).
 * Prova:
 *  - entrada soma, saída subtrai, devolução soma; ajuste e inventário levam ao valor informado
 *    (gravando a diferença); ajuste exige motivo e sem diferença é recusado;
 *  - saldo negativo é permitido, com aviso, e fica destacado na lista e no extrato;
 *  - o extrato bate com as movimentações (ordem, saldo resultante, quem fez) e saldo = soma do razão;
 *  - empresa sempre da sessão (produto de outra empresa = 404, nada gravado; empresaId no corpo
 *    é recusado); permissão: sem "Estoque" não vê nem lança; "visualizar" vê mas não lança;
 *  - alerta: produtos no mínimo ou abaixo e negativos contados e filtráveis.
 * Complemento (Leva E1 — complemento): saída manual (perda/uso avulso, motivo obrigatório, origem
 * "ajuste manual"); RESERVA subtrai como a saída (previsto para a E4); produto que não controla
 * estoque fica fora da lista, dos alertas e das sugestões (o extrato continua); recálculo pelo
 * histórico corrige o cache (e só ele) e a conferência da empresa lista as divergências.
 * (Concorrência e atomicidade num PostgreSQL real: estoque-concorrencia.test.ts; o SQL: sql-estoque.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduloDaRota, pode, permissoesTotais, permissoesVazias, PRESETS, type Permissoes } from "@/lib/permissoes";
import {
  avisoSaldo, calcularMovimento, formatarDelta, formatarQtd, lancamentoManualSchema, mensagemLancamento, situacaoEstoque, valorDoLancamento,
} from "@/lib/estoque/regras";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return {
    prisma: criarPrisma(db, {
      movimentacaoEstoque: (r, T) => ({ usuario: T("usuario").find((u) => u.id === r.usuarioId) ?? null }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const url = vi.hoisted(() => ({ atual: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/estoque", useSearchParams: () => new URLSearchParams(url.atual),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", role = "OPERADOR", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@x.com", empresaId, role, permissoes } };
};
const so = (acoes: Record<string, boolean>): Permissoes => ({ ...permissoesVazias(), estoque: acoes });

let relogio = 0;
function semear() {
  db.escritas = [];
  relogio = 0;
  db.t = {
    usuario: [{ id: "u1", empresaId: "e1", nome: "Ana" }, { id: "u2", empresaId: "e1", nome: "Bruno" }, { id: "uB", empresaId: "e2", nome: "Zé" }],
    produto: [
      { id: "p1", empresaId: "e1", nome: "Gás R410A", descricao: "Cilindro", unidade: "kg", estoqueMinimo: 5, saldo: 0, ativo: true },
      { id: "p2", empresaId: "e1", nome: "Filtro secador", descricao: null, unidade: "un", estoqueMinimo: null, saldo: 0, ativo: true },
      { id: "p3", empresaId: "e1", nome: "Capacitor 35uF", descricao: null, unidade: "un", estoqueMinimo: 2, saldo: 0, ativo: true },
      { id: "p4", empresaId: "e1", nome: "Tubo de cobre (antigo)", descricao: null, unidade: "m", estoqueMinimo: 10, saldo: 0, ativo: false },
      // Não controla estoque: fora da tela e dos alertas (o razão ainda aceita lançamentos)
      { id: "p5", empresaId: "e1", nome: "Visita técnica (kit)", descricao: null, unidade: "un", estoqueMinimo: 1, saldo: 0, ativo: true, controlaEstoque: false },
      { id: "pB", empresaId: "e2", nome: "Gás da outra", descricao: null, unidade: "kg", estoqueMinimo: 1, saldo: 0, ativo: true },
    ].map((p) => ({ controlaEstoque: true, ...p })),
    movimentacaoEstoque: [],
  };
}
beforeEach(() => { semear(); logar(); });

// O banco em memória não tem default(now()): a data vem em ordem crescente (lançamento a lançamento)
async function lib() {
  const mod = await import("@/lib/estoque/servidor");
  return mod;
}
const T = (m: string) => (db.t as any)[m] as any[];
const prod = (id: string) => T("produto").find((p) => p.id === id);
const movs = (id: string) => T("movimentacaoEstoque").filter((m) => m.produtoId === id);
const somaRazao = (id: string) => Math.round(movs(id).reduce((t, m) => t + m.quantidade, 0) * 1000) / 1000;
function carimbar() { for (const m of T("movimentacaoEstoque")) if (!m.data) { relogio++; m.data = new Date(Date.UTC(2026, 9, 1, 12, relogio)); m.criadoEm = m.data; } }

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, qs = "") {
  const mod = await carregar();
  const req = new NextRequest(`http://localhost/api/estoque${qs ? `?${qs}` : ""}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const r = { status: res.status, json: await res.json().catch(() => null) };
  carimbar();
  return r;
}
const lancarApi = (produtoId: string, corpo: unknown) => chamar(() => import("@/app/api/estoque/[produtoId]/movimentacoes/route"), "POST", { produtoId }, corpo);
const extratoApi = (produtoId: string, qs = "") => chamar(() => import("@/app/api/estoque/[produtoId]/route"), "GET", { produtoId }, undefined, qs);
const listaApi = (qs = "") => chamar(() => import("@/app/api/estoque/route"), "GET", {}, undefined, qs);
const alertasApi = () => chamar(() => import("@/app/api/estoque/alertas/route"), "GET", {});
async function mov(produtoId: string, operacao: any, valor: number, extra: Record<string, unknown> = {}) {
  const r = await (await lib()).movimentar({ empresaId: "e1", produtoId, operacao, valor, usuarioId: "u1", ...extra });
  carimbar();
  return r;
}

// ═════════════════════════ Regras puras ═════════════════════════
describe("regras", () => {
  it("cada operação vira um lançamento com sinal; ajuste/inventário = diferença para o valor informado", () => {
    expect(calcularMovimento("ENTRADA", 3, 2)).toEqual({ tipo: "ENTRADA", origem: "COMPRA", delta: 2 });
    expect(calcularMovimento("DEVOLUCAO", 3, 2)).toEqual({ tipo: "DEVOLUCAO", origem: "OS", delta: 2 });
    expect(calcularMovimento("SAIDA", 3, 2)).toEqual({ tipo: "SAIDA", origem: "OS", delta: -2 });
    expect(calcularMovimento("AJUSTE", 3, 10)).toEqual({ tipo: "AJUSTE", origem: "AJUSTE", delta: 7 });
    expect(calcularMovimento("AJUSTE", 3, 1)).toEqual({ tipo: "AJUSTE", origem: "AJUSTE", delta: -2 });
    expect(calcularMovimento("INVENTARIO", 3, 3)).toEqual({ tipo: "AJUSTE", origem: "INVENTARIO", delta: 0 });
    expect(calcularMovimento("INVENTARIO", -4, 1.5)).toEqual({ tipo: "AJUSTE", origem: "INVENTARIO", delta: 5.5 });
    // 3 casas: nada de 0,30000000000000004
    expect(calcularMovimento("AJUSTE", 0.1, 0.4).delta).toBe(0.3);
    expect(calcularMovimento("ENTRADA", 0, 1.23449).delta).toBe(1.234);
  });

  it("situação: negativo < 0; no mínimo ou abaixo = saldo ≤ mínimo; sem mínimo nunca é 'abaixo'", () => {
    expect(situacaoEstoque(-0.001, null)).toBe("negativo");
    expect(situacaoEstoque(-1, 5)).toBe("negativo");
    expect(situacaoEstoque(5, 5)).toBe("abaixo");
    expect(situacaoEstoque(4.999, 5)).toBe("abaixo");
    expect(situacaoEstoque(5.001, 5)).toBe("ok");
    expect(situacaoEstoque(0, 0)).toBe("abaixo");
    expect(situacaoEstoque(0, null)).toBe("ok");
    expect(situacaoEstoque(0, undefined)).toBe("ok");
  });

  it("aviso só quando negativo; números no formato brasileiro", () => {
    expect(avisoSaldo(0)).toBeNull();
    expect(avisoSaldo(2)).toBeNull();
    expect(avisoSaldo(-1234.5, "kg")).toBe("Atenção: o saldo ficou negativo (-1.234,5 kg). O lançamento foi feito; confira as entradas.");
    expect(avisoSaldo(-2)).toBe("Atenção: o saldo ficou negativo (-2). O lançamento foi feito; confira as entradas.");
    expect(formatarQtd(1234.5)).toBe("1.234,5");
    expect(formatarDelta(3)).toBe("+3");
    expect(formatarDelta(-3.5)).toBe("−3,5");
    expect(formatarDelta(0)).toBe("0");
  });

  it("lançamento manual: entrada > 0 (até 3 casas), ajuste com motivo, inventário ≥ 0; nada de campos extras", () => {
    const ok = (v: unknown) => lancamentoManualSchema.safeParse(v);
    const msg = (v: unknown) => { const r = ok(v); return r.success ? null : mensagemLancamento(r.error); };
    expect(ok({ operacao: "ENTRADA", quantidade: "1.234,5", custoUnitario: "12,90" }).data).toEqual({ operacao: "ENTRADA", quantidade: 1234.5, custoUnitario: 12.9 });
    expect(ok({ operacao: "ENTRADA", quantidade: "2.5" }).data).toEqual({ operacao: "ENTRADA", quantidade: 2.5 });
    expect(msg({ operacao: "ENTRADA", quantidade: 0 })).toBe("A quantidade precisa ser maior que zero.");
    expect(msg({ operacao: "ENTRADA", quantidade: -1 })).toBe("A quantidade precisa ser maior que zero.");
    expect(msg({ operacao: "ENTRADA", quantidade: "" })).toBe("Informe a quantidade.");
    expect(msg({ operacao: "ENTRADA", quantidade: "abc" })).toBe("Informe a quantidade.");
    expect(msg({ operacao: "ENTRADA", quantidade: 1.2345 })).toBe("Use no máximo 3 casas decimais.");
    expect(msg({ operacao: "ENTRADA", quantidade: 1e10 })).toBe("Quantidade grande demais.");
    expect(msg({ operacao: "ENTRADA", quantidade: 1, custoUnitario: -1 })).toBe("O custo não pode ser negativo.");
    expect(msg({ operacao: "AJUSTE", novoSaldo: 3 })).toBe("Ajuste exige o motivo (observação).");
    expect(msg(null)).toBe("Dados inválidos.");
    expect(msg({ operacao: "AJUSTE", novoSaldo: 3, observacao: "x".repeat(501) })).toBe("Observação: no máximo 500 caracteres.");
    expect(msg({ operacao: "AJUSTE", novoSaldo: 3, observacao: "  " })).toBe("Ajuste exige o motivo (observação).");
    expect(msg({ operacao: "AJUSTE", novoSaldo: -1, observacao: "perda" })).toBe("O saldo correto não pode ser negativo.");
    expect(ok({ operacao: "AJUSTE", novoSaldo: 0, observacao: "perda" }).success).toBe(true);
    expect(ok({ operacao: "INVENTARIO", contagem: 0 }).success).toBe(true);
    expect(msg({ operacao: "INVENTARIO", contagem: -1 })).toBe("A contagem não pode ser negativa.");
    // Saída manual (perda/uso avulso): quantidade > 0 e motivo obrigatório
    expect(msg({ operacao: "SAIDA", quantidade: 1 })).toBe("Saída exige o motivo (observação).");
    expect(msg({ operacao: "SAIDA", quantidade: 0, observacao: "perda" })).toBe("A quantidade precisa ser maior que zero.");
    expect(ok({ operacao: "SAIDA", quantidade: "1,5", observacao: "uso no almoxarifado" }).data).toEqual({ operacao: "SAIDA", quantidade: 1.5, observacao: "uso no almoxarifado" });
    expect(msg({ operacao: "DEVOLUCAO", quantidade: 1 })).toBe("Escolha entrada, saída, ajuste ou inventário.");
    expect(msg({ operacao: "RESERVA", quantidade: 1 })).toBe("Escolha entrada, saída, ajuste ou inventário.");
    expect(valorDoLancamento({ operacao: "SAIDA", quantidade: 2, observacao: "x" })).toBe(2);
    expect(msg({ operacao: "ENTRADA", quantidade: 1, empresaId: "e2" })).toBe("Campo não permitido: empresaId.");
    expect(msg({ operacao: "INVENTARIO", contagem: 1, saldo: 99 })).toBe("Campo não permitido: saldo.");
    expect(msg({ operacao: "ENTRADA", quantidade: 1, observacao: "x".repeat(501) })).toBe("Observação: no máximo 500 caracteres.");
    expect(valorDoLancamento({ operacao: "ENTRADA", quantidade: 4 })).toBe(4);
    expect(valorDoLancamento({ operacao: "AJUSTE", novoSaldo: 5, observacao: "x" })).toBe(5);
    expect(valorDoLancamento({ operacao: "INVENTARIO", contagem: 6 })).toBe(6);
  });
});

// ═════════════════════════ Movimentar (lib) ═════════════════════════
describe("movimentar: lançamento + saldo juntos", () => {
  it("entrada soma, saída subtrai, devolução soma — cada um grava o razão com o saldo resultante", async () => {
    const e = await mov("p1", "ENTRADA", 10, { custoUnitario: 52.5, observacao: " NF 123 " });
    expect(e).toEqual({ movimentacao: expect.objectContaining({ tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10 }), saldo: 10, aviso: null });
    expect(prod("p1").saldo).toBe(10);
    expect(movs("p1")[0]).toMatchObject({ empresaId: "e1", produtoId: "p1", tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, saldoApos: 10, custoUnitario: 52.5, observacao: "NF 123", usuarioId: "u1", refId: null });
    const s = await mov("p1", "SAIDA", 3.5, { refId: "os-1" });
    expect(s.saldo).toBe(6.5);
    expect(movs("p1")[1]).toMatchObject({ tipo: "SAIDA", origem: "OS", quantidade: -3.5, saldoApos: 6.5, refId: "os-1", custoUnitario: null, observacao: null });
    const d = await mov("p1", "DEVOLUCAO", 1);
    expect(d.saldo).toBe(7.5);
    expect(movs("p1")[2]).toMatchObject({ tipo: "DEVOLUCAO", origem: "OS", quantidade: 1, saldoApos: 7.5 });
    expect(prod("p1").saldo).toBe(somaRazao("p1"));
    expect(prod("p2").saldo).toBe(0); // outro produto não muda
  });

  it("ajuste e inventário acertam para o valor informado (o razão guarda a diferença)", async () => {
    await mov("p1", "ENTRADA", 10);
    const a = await mov("p1", "AJUSTE", 7, { observacao: "avaria" });
    expect(a.saldo).toBe(7);
    expect(a.movimentacao).toMatchObject({ tipo: "AJUSTE", origem: "AJUSTE", quantidade: -3, saldoApos: 7 });
    const i = await mov("p1", "INVENTARIO", 12);
    expect(i.saldo).toBe(12);
    expect(i.movimentacao).toMatchObject({ tipo: "AJUSTE", origem: "INVENTARIO", quantidade: 5, saldoApos: 12 });
    // contagem que confirma o saldo também fica registrada (diferença 0)
    const c = await mov("p1", "INVENTARIO", 12);
    expect(c.movimentacao).toMatchObject({ quantidade: 0, saldoApos: 12 });
    expect(movs("p1")).toHaveLength(4);
    expect(prod("p1").saldo).toBe(somaRazao("p1"));
  });

  it("ajuste sem diferença é recusado e não grava nada", async () => {
    await mov("p1", "ENTRADA", 4);
    const n = db.escritas.length;
    await expect(mov("p1", "AJUSTE", 4, { observacao: "conferido" })).rejects.toThrow("O saldo já é esse — não há o que ajustar.");
    expect(movs("p1")).toHaveLength(1);
    expect(db.escritas.slice(n).some((e) => e.startsWith("movimentacaoEstoque.create"))).toBe(false);
  });

  it("saldo negativo é permitido — e avisa", async () => {
    await mov("p1", "ENTRADA", 2);
    const r = await mov("p1", "SAIDA", 5);
    expect(r.saldo).toBe(-3);
    expect(r.aviso).toBe("Atenção: o saldo ficou negativo (-3 kg). O lançamento foi feito; confira as entradas.");
    expect(prod("p1").saldo).toBe(-3);
    expect(movs("p1")[1]).toMatchObject({ quantidade: -5, saldoApos: -3 });
    // voltar ao positivo não avisa
    expect((await mov("p1", "ENTRADA", 3)).aviso).toBeNull();
    expect(prod("p1").saldo).toBe(0);
  });

  it("quantidade 0, negativa ou inválida e saldo final negativo: recusados antes de gravar", async () => {
    for (const [op, v, m] of [
      ["ENTRADA", 0, "A quantidade precisa ser maior que zero."], ["SAIDA", -2, "A quantidade precisa ser maior que zero."],
      ["DEVOLUCAO", Number.NaN, "A quantidade precisa ser maior que zero."], ["ENTRADA", Infinity, "A quantidade precisa ser maior que zero."],
      ["ENTRADA", 0.0001, "A quantidade precisa ser maior que zero."],
      ["AJUSTE", -1, "O saldo informado não pode ser negativo."], ["INVENTARIO", -0.5, "O saldo informado não pode ser negativo."],
      ["INVENTARIO", Number.NaN, "O saldo informado não pode ser negativo."],
    ] as const) await expect(mov("p1", op, v)).rejects.toThrow(m);
    expect(db.escritas).toEqual([]);
    expect(await mov("p1", "INVENTARIO", 0)).toMatchObject({ saldo: 0 }); // contar zero é válido
  });

  it("produto de outra empresa (ou inexistente): recusado, nada gravado", async () => {
    await expect(mov("pB", "ENTRADA", 5)).rejects.toThrow("Produto inválido(a).");
    await expect(mov("nao-existe", "ENTRADA", 5)).rejects.toThrow("Produto inválido(a).");
    expect(db.escritas).toEqual([]);
    expect(prod("pB").saldo).toBe(0);
  });

  it("origem pode vir de quem chama (próximas levas: compra, OS)", async () => {
    const r = await mov("p2", "ENTRADA", 1, { origem: "INVENTARIO" });
    expect(r.movimentacao.origem).toBe("INVENTARIO");
    expect(movs("p2")[0].origem).toBe("INVENTARIO");
  });

  it("muitos lançamentos misturados: o cache de saldo é sempre a soma do razão", async () => {
    const seq: [string, number][] = [["ENTRADA", 3.333], ["SAIDA", 1.111], ["INVENTARIO", 9], ["SAIDA", 12.5], ["DEVOLUCAO", 0.5], ["AJUSTE", 1.25], ["ENTRADA", 0.001]];
    for (const [op, v] of seq) {
      await mov("p3", op, v, op === "AJUSTE" ? { observacao: "x" } : {});
      expect(prod("p3").saldo).toBeCloseTo(somaRazao("p3"), 9);
      expect(movs("p3").at(-1).saldoApos).toBe(Math.round(prod("p3").saldo * 1000) / 1000);
    }
    expect(Math.round(prod("p3").saldo * 1000) / 1000).toBe(1.251);
  });
});

// ═════════════════════════ API ═════════════════════════
describe("POST /api/estoque/:produtoId/movimentacoes", () => {
  it("entrada, ajuste e inventário pela tela: empresa e usuário da sessão", async () => {
    logar(permissoesTotais(), "e1", "OPERADOR", "u2");
    const e = await lancarApi("p1", { operacao: "ENTRADA", quantidade: "10,5", custoUnitario: "45,00", observacao: "NF 77" });
    expect(e.status).toBe(201);
    expect(e.json).toMatchObject({ saldo: 10.5, aviso: null, movimentacao: { tipo: "ENTRADA", origem: "COMPRA", quantidade: 10.5, saldoApos: 10.5 } });
    expect(movs("p1")[0]).toMatchObject({ empresaId: "e1", usuarioId: "u2", custoUnitario: 45, observacao: "NF 77" });
    const a = await lancarApi("p1", { operacao: "AJUSTE", novoSaldo: 8, observacao: "perda no transporte" });
    expect(a.status).toBe(201);
    expect(a.json.movimentacao).toMatchObject({ tipo: "AJUSTE", origem: "AJUSTE", quantidade: -2.5, saldoApos: 8 });
    const i = await lancarApi("p1", { operacao: "INVENTARIO", contagem: "9" });
    expect(i.json.movimentacao).toMatchObject({ origem: "INVENTARIO", quantidade: 1, saldoApos: 9 });
    expect(prod("p1").saldo).toBe(9);
    expect(movs("p1").map((m) => m.custoUnitario)).toEqual([45, null, null]); // custo só na entrada
  });

  it("validação: 400 com a mensagem; ajuste sem diferença = 400; nada gravado", async () => {
    const casos: [unknown, string][] = [
      [{ operacao: "ENTRADA", quantidade: 0 }, "A quantidade precisa ser maior que zero."],
      [{ operacao: "AJUSTE", novoSaldo: 1 }, "Ajuste exige o motivo (observação)."],
      [{ operacao: "AJUSTE", novoSaldo: 0, observacao: "zerado" }, "O saldo já é esse — não há o que ajustar."],
      [{ operacao: "SAIDA", quantidade: 1 }, "Saída exige o motivo (observação)."],
      [{ operacao: "RESERVA", quantidade: 1 }, "Escolha entrada, saída, ajuste ou inventário."],
      [{ operacao: "ENTRADA", quantidade: 1, empresaId: "e2" }, "Campo não permitido: empresaId."],
      [{ operacao: "ENTRADA", quantidade: 1, usuarioId: "uB" }, "Campo não permitido: usuarioId."],
      [null, "Dados inválidos."],
    ];
    for (const [corpo, erro] of casos) {
      const r = await lancarApi("p1", corpo);
      expect([r.status, r.json.erro]).toEqual([400, erro]);
    }
    expect(T("movimentacaoEstoque")).toEqual([]);
    expect(prod("p1").saldo).toBe(0);
  });

  it("produto de outra empresa ou inexistente: 404, nada gravado", async () => {
    for (const id of ["pB", "nada"]) {
      const r = await lancarApi(id, { operacao: "ENTRADA", quantidade: 5 });
      expect([r.status, r.json.erro]).toEqual([404, "Produto não encontrado"]);
    }
    expect(db.escritas).toEqual([]);
    // a outra empresa lança no dela, sem enxergar os da e1
    logar(permissoesTotais(), "e2", "OPERADOR", "uB");
    expect((await lancarApi("pB", { operacao: "ENTRADA", quantidade: 5 })).status).toBe(201);
    expect((await lancarApi("p1", { operacao: "ENTRADA", quantidade: 5 })).status).toBe(404);
    expect(prod("p1").saldo).toBe(0);
    expect(movs("pB")[0]).toMatchObject({ empresaId: "e2", usuarioId: "uB" });
  });

  it("permissão: sem sessão 401; só 'visualizar' ou sem Estoque = 403; 'gerenciar' ou ADMIN lança", async () => {
    sessao.atual = null;
    expect((await lancarApi("p1", { operacao: "ENTRADA", quantidade: 1 })).status).toBe(401);
    logar(so({ visualizar: true, gerenciar: false }));
    expect((await lancarApi("p1", { operacao: "ENTRADA", quantidade: 1 })).status).toBe(403);
    logar(permissoesVazias());
    expect((await lancarApi("p1", { operacao: "ENTRADA", quantidade: 1 })).status).toBe(403);
    expect(db.escritas).toEqual([]);
    logar(so({ visualizar: true, gerenciar: true }));
    expect((await lancarApi("p1", { operacao: "ENTRADA", quantidade: 1 })).status).toBe(201);
    logar(permissoesVazias(), "e1", "ADMIN");
    expect((await lancarApi("p1", { operacao: "ENTRADA", quantidade: 1 })).status).toBe(201);
    expect(prod("p1").saldo).toBe(2);
  });
});

describe("GET extrato / lista / alertas", () => {
  async function historico() {
    logar(permissoesTotais(), "e1", "OPERADOR", "u1");
    await lancarApi("p1", { operacao: "ENTRADA", quantidade: 10 });
    logar(permissoesTotais(), "e1", "OPERADOR", "u2");
    await mov("p1", "SAIDA", 4, { usuarioId: "u2" });
    await lancarApi("p1", { operacao: "AJUSTE", novoSaldo: 5, observacao: "quebra" });
    await mov("p1", "SAIDA", 7, { usuarioId: null });
    await lancarApi("p1", { operacao: "INVENTARIO", contagem: 1 });
  }

  it("extrato bate com as movimentações: mais recente primeiro, saldo resultante, quem fez; soma = saldo", async () => {
    await historico();
    const r = await extratoApi("p1");
    expect(r.status).toBe(200);
    expect(r.json.produto).toMatchObject({ id: "p1", saldo: 1, estoqueMinimo: 5, situacao: "abaixo", unidade: "kg" });
    expect(r.json.movimentacoes.map((m: any) => [m.tipo, m.origem, m.quantidade, m.saldoApos, m.usuario])).toEqual([
      ["AJUSTE", "INVENTARIO", 3, 1, "Bruno"],
      ["SAIDA", "OS", -7, -2, null],
      ["AJUSTE", "AJUSTE", -1, 5, "Bruno"],
      ["SAIDA", "OS", -4, 6, "Bruno"],
      ["ENTRADA", "COMPRA", 10, 10, "Ana"],
    ]);
    expect(r.json.somaRazao).toBe(1);
    expect(r.json.somaRazao).toBe(r.json.produto.saldo);
    expect(r.json.total).toBe(5);
    // cada saldo resultante = o anterior + a quantidade (o extrato "fecha")
    const asc = [...r.json.movimentacoes].reverse();
    asc.reduce((ant: number, m: any) => { expect(m.saldoApos).toBe(ant + m.quantidade); return m.saldoApos; }, 0);
  });

  it("extrato pagina (25 por página) sem repetir nem pular", async () => {
    for (let i = 1; i <= 30; i++) await mov("p2", "ENTRADA", i);
    const a = await extratoApi("p2", "por=25");
    const b = await extratoApi("p2", "por=25&pagina=2");
    expect(a.json.movimentacoes).toHaveLength(25);
    expect(b.json.movimentacoes.map((m: any) => m.quantidade)).toEqual([5, 4, 3, 2, 1]);
    expect(new Set([...a.json.movimentacoes, ...b.json.movimentacoes].map((m: any) => m.id)).size).toBe(30);
    expect([a.json.total, b.json.pagina, a.json.somaRazao]).toEqual([30, 2, 465]);
  });

  it("extrato: outra empresa/inexistente = 404; sem Estoque = 403; só visualizar = 200", async () => {
    expect((await extratoApi("pB")).status).toBe(404);
    expect((await extratoApi("xx")).status).toBe(404);
    logar(permissoesVazias());
    expect((await extratoApi("p1")).status).toBe(403);
    logar(so({ visualizar: true }));
    expect((await extratoApi("p1")).status).toBe(200);
    sessao.atual = null;
    expect((await extratoApi("p1")).status).toBe(401);
  });

  it("lista: só da empresa e ativos (inativos sob pedido), busca, ordem por saldo, filtros de situação", async () => {
    await mov("p1", "ENTRADA", 8);  // ok (mín. 5)
    await mov("p3", "ENTRADA", 2);  // = mínimo 2 → abaixo
    await mov("p2", "SAIDA", 1);    // negativo, sem mínimo
    const r = await listaApi();
    expect(r.status).toBe(200);
    expect(r.json.itens.map((p: any) => [p.id, p.saldo, p.situacao])).toEqual([["p3", 2, "abaixo"], ["p2", -1, "negativo"], ["p1", 8, "ok"]]);
    expect(r.json.total).toBe(3);
    expect(r.json.alertas).toEqual({ abaixo: 2, negativo: 1 });
    expect((await listaApi("inativos=1")).json.itens.map((p: any) => p.id)).toContain("p4");
    expect((await listaApi("busca=gás")).json.itens.map((p: any) => p.id)).toEqual(["p1"]);
    expect((await listaApi("busca=cilindro")).json.itens.map((p: any) => p.id)).toEqual(["p1"]);
    expect((await listaApi("ordem=saldo&dir=desc")).json.itens.map((p: any) => p.id)).toEqual(["p1", "p3", "p2"]);
    expect((await listaApi("ordem=minimo")).json.itens.map((p: any) => p.id)).toEqual(["p3", "p1", "p2"]);
    expect((await listaApi("situacao=abaixo")).json.itens.map((p: any) => p.id)).toEqual(["p3", "p2"]);
    expect((await listaApi("situacao=negativo")).json.itens.map((p: any) => p.id)).toEqual(["p2"]);
    expect((await listaApi("situacao=qualquer")).json).toMatchObject({ total: 3, situacao: "" });
    expect((await listaApi("situacao=negativo&busca=capacitor")).json.total).toBe(0);
    logar(permissoesTotais(), "e2");
    expect((await listaApi()).json.itens.map((p: any) => p.id)).toEqual(["pB"]);
  });

  it("lista filtrada pagina sobre o subconjunto", async () => {
    T("produto").push(...Array.from({ length: 30 }, (_, i) => ({ id: `n${String(i).padStart(2, "0")}`, empresaId: "e1", nome: `Neg ${String(i).padStart(2, "0")}`, unidade: "un", estoqueMinimo: null, saldo: -1, ativo: true, descricao: null, controlaEstoque: true })));
    const a = await listaApi("situacao=negativo&por=25");
    const b = await listaApi("situacao=negativo&por=25&pagina=2");
    expect([a.json.total, a.json.itens.length, b.json.itens.length]).toEqual([30, 25, 5]);
    expect(b.json.itens.map((p: any) => p.id)).toEqual(["n25", "n26", "n27", "n28", "n29"]);
    expect((await listaApi("situacao=negativo&por=25&pagina=9")).json.pagina).toBe(2);
  });

  it("alertas: conta ativos no mínimo/abaixo (inclui negativos) e negativos; inativos e outra empresa fora", async () => {
    expect((await alertasApi()).json).toEqual({ abaixo: 2, negativo: 0 }); // p1 (0 ≤ 5) e p3 (0 ≤ 2); p4 inativo
    await mov("p1", "ENTRADA", 6);
    await mov("p2", "SAIDA", 1);
    T("produto").find((p) => p.id === "p4").saldo = -5;
    T("produto").find((p) => p.id === "pB").saldo = -5;
    expect((await alertasApi()).json).toEqual({ abaixo: 2, negativo: 1 });
    logar(permissoesVazias());
    expect((await alertasApi()).status).toBe(403);
    expect((await listaApi()).status).toBe(403);
    logar(so({ visualizar: true }));
    expect((await alertasApi()).status).toBe(200);
    expect((await listaApi()).status).toBe(200);
    sessao.atual = null;
    expect((await alertasApi()).status).toBe(401);
    expect((await listaApi()).status).toBe(401);
  });

  it("listar e consultar não gravam nada", async () => {
    await listaApi(); await extratoApi("p1"); await alertasApi();
    expect(db.escritas).toEqual([]);
  });
});

// ═════════════════════════ Complemento: saída manual, RESERVA, controla estoque, recálculo ═════════════════════════
const recalcularApi = (produtoId: string) => chamar(() => import("@/app/api/estoque/[produtoId]/recalcular/route"), "POST", { produtoId });
const conferenciaApi = () => chamar(() => import("@/app/api/estoque/conferencia/route"), "GET", {});

describe("complemento da E1", () => {
  it("saída manual pela tela: subtrai, origem 'ajuste manual' (não é OS), motivo no razão, quem fez; pode ficar negativa (avisa)", async () => {
    await lancarApi("p1", { operacao: "ENTRADA", quantidade: 3 });
    const r = await lancarApi("p1", { operacao: "SAIDA", quantidade: 1.5, observacao: "Uso no almoxarifado" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ saldo: 1.5, aviso: null, movimentacao: { tipo: "SAIDA", origem: "AJUSTE", quantidade: -1.5, saldoApos: 1.5 } });
    expect(movs("p1").at(-1)).toMatchObject({ tipo: "SAIDA", origem: "AJUSTE", quantidade: -1.5, observacao: "Uso no almoxarifado", usuarioId: "u1", empresaId: "e1" });
    const neg = await lancarApi("p1", { operacao: "SAIDA", quantidade: 2, observacao: "Perda" });
    expect(neg.status).toBe(201);
    expect(neg.json.saldo).toBe(-0.5);
    expect(neg.json.aviso).toContain("ficou negativo");
    expect(prod("p1").saldo).toBe(-0.5);
    expect(somaRazao("p1")).toBe(-0.5);
  });

  it("RESERVA (E4) subtrai como a saída e fica no razão com o tipo dela; a tela não a oferece", async () => {
    expect(calcularMovimento("RESERVA", 10, 4)).toEqual({ tipo: "RESERVA", origem: "OS", delta: -4 });
    await mov("p1", "ENTRADA", 10);
    const r = await mov("p1", "RESERVA", 4, { refId: "os-1" });
    expect(r.movimentacao).toMatchObject({ tipo: "RESERVA", origem: "OS", quantidade: -4, saldoApos: 6 });
    expect(movs("p1").at(-1)).toMatchObject({ tipo: "RESERVA", refId: "os-1" });
    expect(prod("p1").saldo).toBe(6);
    expect((await lancarApi("p1", { operacao: "RESERVA", quantidade: 1 })).status).toBe(400);
  });

  it("produto que não controla estoque: fora da lista, dos alertas e das sugestões; o extrato abre e o razão aceita lançamento", async () => {
    await mov("p5", "SAIDA", 2); // negativo, mas não entra nos alertas
    const lista = await listaApi();
    expect(lista.json.itens.map((p: any) => p.id)).not.toContain("p5");
    expect(lista.json.alertas).toEqual({ abaixo: 2, negativo: 0 }); // p1 e p3 no mínimo; p5 fora
    expect((await listaApi("busca=visita")).json.total).toBe(0);
    expect((await listaApi("inativos=1")).json.itens.map((p: any) => p.id)).not.toContain("p5");
    const ex = await extratoApi("p5");
    expect(ex.status).toBe(200);
    expect(ex.json.produto).toMatchObject({ controlaEstoque: false, saldo: -2, situacao: "negativo" });
    expect(await extrato("p5")).toContain("não controla estoque");
    expect((await lancarApi("p5", { operacao: "ENTRADA", quantidade: 5 })).status).toBe(201);
    expect(prod("p5").saldo).toBe(3);
  });

  it("recálculo pelo histórico: corrige o cache pela soma do razão (sem criar movimentação); já batendo, só confere; outra empresa = 404; exige gerenciar", async () => {
    await mov("p1", "ENTRADA", 8);
    await mov("p1", "SAIDA", 3);
    prod("p1").saldo = 99; // cache corrompido (não acontece pela lib; simula)
    const antes = movs("p1").length;
    const r = await recalcularApi("p1");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ produtoId: "p1", nome: "Gás R410A", saldoCache: 99, somaRazao: 5, divergia: true });
    expect(prod("p1").saldo).toBe(5);
    expect(movs("p1")).toHaveLength(antes);
    expect((await recalcularApi("p1")).json).toMatchObject({ saldoCache: 5, somaRazao: 5, divergia: false });
    expect((await recalcularApi("pB")).status).toBe(404);
    expect((await recalcularApi("nada")).status).toBe(404);
    expect(prod("pB").saldo).toBe(0);
    logar(so({ visualizar: true }));
    expect((await recalcularApi("p1")).status).toBe(403);
    sessao.atual = null;
    expect((await recalcularApi("p1")).status).toBe(401);
  });

  it("conferência da empresa: lista só os que divergem (cache ≠ soma do razão), só da empresa; vazia quando tudo bate; sem permissão 403", async () => {
    await mov("p1", "ENTRADA", 8);
    await mov("p3", "ENTRADA", 2);
    expect((await conferenciaApi()).json).toEqual({ divergentes: [], total: 0 });
    prod("p3").saldo = 7;
    prod("pB").saldo = 7; // da outra empresa: não aparece
    db.escritas = [];
    const r = await conferenciaApi();
    expect(r.json).toEqual({ divergentes: [{ produtoId: "p3", nome: "Capacitor 35uF", saldoCache: 7, somaRazao: 2, divergia: true }], total: 1 });
    expect(db.escritas.filter((e) => e.startsWith("produto.update"))).toHaveLength(0); // só leitura
    await recalcularApi("p3");
    expect((await conferenciaApi()).json.total).toBe(0);
    logar(permissoesVazias());
    expect((await conferenciaApi()).status).toBe(403);
  });

  it("extrato: período pela data, filtro por tipo/origem e busca na observação (na URL); a conferência é do razão inteiro", async () => {
    await mov("p1", "ENTRADA", 8, { observacao: "NF 4521" });
    await mov("p1", "SAIDA", 3, { observacao: "Perda", origem: "AJUSTE" });
    await mov("p1", "INVENTARIO", 4);
    // datas: 1/10 12:01, 12:02, 12:03 (carimbar) — o período de outubro pega as três; novembro nenhuma
    expect((await extratoApi("p1", "tipo=SAIDA")).json.movimentacoes.map((m: any) => m.tipo)).toEqual(["SAIDA"]);
    expect((await extratoApi("p1", "origem=INVENTARIO")).json.movimentacoes.map((m: any) => m.origem)).toEqual(["INVENTARIO"]);
    expect((await extratoApi("p1", "busca=nf")).json.movimentacoes.map((m: any) => m.observacao)).toEqual(["NF 4521"]);
    expect((await extratoApi("p1", "tipo=ROUBO")).json).toMatchObject({ total: 3, tipo: "" });
    const nov = await extratoApi("p1", "mes=2026-11");
    expect([nov.json.total, nov.json.periodo.tipo, nov.json.somaRazao]).toEqual([0, "mes", 4]);
    expect((await extratoApi("p1", "de=2026-10-01&ate=2026-10-01")).json.total).toBe(3);
    expect((await extratoApi("p1")).json.periodo.tipo).toBe("todos"); // padrão: todo o período
    const h = await extrato("p1", "tipo=SAIDA");
    expect([...new Set(attrs(h, "data-mov"))]).toHaveLength(1);
    expect(h).toContain('data-tipo-mov="SAIDA"');
  });

  it("lista no padrão da casa: barra de filtros + TabelaPro; linha negativa em vermelho; cartões no celular", async () => {
    await mov("p2", "SAIDA", 1);
    const h = await lista();
    expect(h).toContain("data-barra-filtros");
    expect(h).toContain("data-tabela-estoque");
    expect(h).toContain("data-tabela-planilha");
    expect(h).toMatch(/data-linha="p2"[^>]*data-situacao-linha="negativo"/);
    expect(h).toMatch(/<tr data-linha="p2" class="[^"]*bg-atrasado-claro/);
    expect(attrs(h, "data-cartao")).toEqual(["p3", "p2", "p1"]);
    expect(h).toContain("data-cartoes");
  });
});

// ═════════════════════════ Permissão / menu ═════════════════════════
describe("permissão Estoque", () => {
  it("módulo novo com visualizar/gerenciar; rota /estoque protegida por ele (menu e middleware)", () => {
    expect(moduloDaRota("/estoque")).toBe("estoque");
    expect(moduloDaRota("/estoque/p1")).toBe("estoque");
    expect(pode(permissoesVazias(), "estoque", "visualizar", "OPERADOR")).toBe(false);
    expect(pode(permissoesTotais(), "estoque", "gerenciar", "OPERADOR")).toBe(true);
    expect(pode(permissoesVazias(), "estoque", "gerenciar", "ADMIN")).toBe(true);
    expect(PRESETS.SUPERVISOR.estoque).toEqual({ visualizar: true, gerenciar: true });
    expect(PRESETS.FINANCEIRO.estoque).toEqual({ visualizar: true, gerenciar: false });
    expect(PRESETS.TECNICO.estoque).toEqual({ visualizar: false, gerenciar: false });
  });
});

// ═════════════════════════ Telas ═════════════════════════
const html = async (pagina: () => Promise<any>, props: Record<string, unknown>, qs = "") => {
  url.atual = qs;
  const { default: P } = await pagina();
  return renderToStaticMarkup(await P({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(qs))), ...props }));
};
const lista = (qs = "") => html(() => import("@/app/(dashboard)/estoque/page"), {}, qs);
const extrato = (id: string, qs = "") => html(() => import("@/app/(dashboard)/estoque/[produtoId]/page"), { params: Promise.resolve({ produtoId: id }) }, qs);
const attrs = (h: string, a: string) => [...h.matchAll(new RegExp(`${a}="([^"]+)"`, "g"))].map((m) => m[1]);

describe("telas", () => {
  it("lista: saldo com destaque (negativo/mínimo), aviso no topo com contadores, Lançar só para quem gerencia", async () => {
    await mov("p1", "ENTRADA", 8);
    await mov("p2", "SAIDA", 1.5);
    const h = await lista();
    expect(attrs(h, "data-cartao")).toEqual(["p3", "p2", "p1"]);
    expect(attrs(h, "data-situacao")).toEqual(expect.arrayContaining(["negativo", "abaixo", "ok"]));
    expect(h).toMatch(/data-saldo="-1.5" class="[^"]*text-atrasado(?!-)/);
    expect(h).toMatch(/data-saldo="0" class="[^"]*text-atencao-texto/);
    expect(h).toMatch(/data-alerta="abaixo"[^>]*>2 produtos no mínimo ou abaixo</);
    expect(h).toMatch(/data-alerta="negativo"[^>]*>1 com saldo negativo</);
    expect(h).toContain('href="/estoque?situacao=negativo"');
    expect(attrs(h, "data-lancar")).toEqual(["p3", "p2", "p1", "p3", "p2", "p1"]); // cartões + tabela
    expect(h).toContain('href="/estoque/p1"');
    logar(so({ visualizar: true }));
    const v = await lista();
    expect(attrs(v, "data-lancar")).toEqual([]);
    expect(attrs(v, "data-cartao")).toEqual(["p3", "p2", "p1"]);
  });

  it("lista: sem alerta não mostra o aviso; vazio com busca mostra a mensagem", async () => {
    T("produto").forEach((p) => { p.estoqueMinimo = null; });
    expect(await lista()).not.toContain("data-alertas");
    const v = await lista("busca=zzz");
    expect(v).toContain("data-lista-vazia");
    expect(v).toContain("Nada combina com “zzz”");
  });

  it("extrato: cabeçalho com saldo e mínimo, linhas na ordem, aviso de negativo; outra empresa = 404", async () => {
    await mov("p1", "ENTRADA", 3, { usuarioId: "u2" });
    await mov("p1", "SAIDA", 4);
    const h = await extrato("p1");
    expect(h).toContain("Gás R410A");
    expect(h).toMatch(/data-saldo="-1" class="[^"]*text-atrasado(?!-)/);
    expect(h).toContain("tabular-nums\">5 kg</p>"); // mínimo
    expect(h).toContain("Saldo negativo: saiu mais do que entrou.");
    expect(h).not.toContain("data-divergencia");
    expect([...new Set(attrs(h, "data-mov"))]).toEqual(movs("p1").map((m) => m.id).reverse());
    // quantidade com sinal no cartão (celular) E na tabela
    expect(h.split("−4").length - 1).toBe(2);
    expect(h).toMatch(/text-atrasado" data-quantidade="true">−4<\/span>/);
    expect(h).toMatch(/text-success-700" data-quantidade="true">\+3<\/span>/);
    expect(h).toContain("data-tabela-planilha"); // TabelaPro (padrão da casa) no extrato
    expect(h).toContain('data-tabela-extrato');
    expect(h).toContain("Bruno");
    expect(attrs(h, "data-lancar")).toEqual(["p1"]);
    await expect(extrato("pB")).rejects.toThrow("NEXT_NOT_FOUND");
    logar(so({ visualizar: true }));
    expect(attrs(await extrato("p1"), "data-lancar")).toEqual([]);
  });

  it("extrato: se o cache divergir do razão, a tela mostra (não esconde) e quem gerencia tem o 'Recalcular pelo histórico'", async () => {
    await mov("p1", "ENTRADA", 3);
    prod("p1").saldo = 99;
    const h = await extrato("p1");
    expect(h).toContain("data-divergencia");
    expect(h).toContain('data-recalcular="p1"');
    logar(so({ visualizar: true }));
    const v = await extrato("p1");
    expect(v).toContain("data-divergencia");
    expect(v).not.toContain("data-recalcular");
    expect(v).toContain("Avise quem gerencia o estoque.");
  });
});

// ═════════════════════════ Menu ═════════════════════════
vi.mock("next-auth/react", () => ({ signOut: () => {} }));
describe("menu: quem não tem Estoque não vê", () => {
  const menu = async (permissoes: Permissoes, role = "OPERADOR") => {
    const { Sidebar } = await import("@/components/layout/sidebar");
    return renderToStaticMarkup(createElement(Sidebar, { session: { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role, permissoes } } as any }));
  };
  it("grupo Estoque no Operacional só para quem pode ver o módulo", async () => {
    expect(await menu(permissoesTotais())).toContain(">Estoque<");
    expect(await menu({ ...permissoesVazias(), ordens: { visualizar: true } })).not.toContain(">Estoque<");
    expect(await menu({ ...permissoesVazias(), ordens: { visualizar: true }, estoque: { visualizar: true } })).toContain(">Estoque<");
    expect(await menu(permissoesVazias(), "ADMIN")).toContain(">Estoque<");
  });
});

describe("sugestões da busca do estoque", () => {
  const sugestoes = async (qs: string) => {
    const { GET } = await import("@/app/api/listas/sugestoes/route");
    const res = await GET(new NextRequest(`http://localhost/api/listas/sugestoes?${qs}`));
    return { status: res.status, json: await res.json() };
  };
  it("produtos ativos da empresa, com o saldo; link para o extrato; precisa ver Estoque", async () => {
    await mov("p1", "ENTRADA", 2.5);
    const r = await sugestoes("lista=estoque&q=gás");
    expect(r.json.sugestoes).toEqual([{ id: "p1", rotulo: "Gás R410A", detalhe: "saldo 2,5 kg", href: "/estoque/p1" }]);
    expect((await sugestoes("lista=estoque&q=tubo")).json.sugestoes).toEqual([]); // inativo
    logar({ ...permissoesVazias(), clientes: { visualizar: true } });
    expect((await sugestoes("lista=estoque&q=gás")).status).toBe(403);
    logar(permissoesTotais(), "e2");
    expect((await sugestoes("lista=estoque&q=gás")).json.sugestoes.map((s: any) => s.id)).toEqual(["pB"]);
  });
});
