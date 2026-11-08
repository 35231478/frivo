/**
 * Faturamento parcial (P5) — rotas reais, Prisma real, PostgreSQL real (schema descartável via `prisma db push`
 * + os SQL de produção do faturamento avulso e desta PR). Prova:
 *  - parcial por percentual (40% DO TOTAL) e por valor: cada parte é uma fatura própria (número próprio, `faturaParcial`,
 *    `percentualFaturado`), linhas proporcionais com o serviço do catálogo, descrição "Parcial 40% — …", conta a receber só
 *    da parte (a previsão do orçamento vira a 1ª parte), evento "Fatura N (parcial 40%)";
 *  - o saldo manda: acima do saldo → 409 e nada criado; corpo inválido → 400; 5 pedidos de 30% ao mesmo tempo → só 3 passam;
 *  - retenções proporcionais à parte (ISS retido 2% sobre a parte, não sobre o total);
 *  - status: A faturar → Parcialmente faturado → Faturado; "Faturar" depois de uma parte fatura só o saldo (e é parcial);
 *    fechado, "Faturar" devolve a última (jaExistia) e "Faturar parcial" é recusado; as partes somam exatamente o total;
 *  - previsão: `itensAFaturar` passa a mostrar só o saldo; some quando fecha;
 *  - cancelar uma parte devolve o valor ao saldo (status volta) e a previsão revive valendo o SALDO, não o total;
 *  - uma fatura parcial pode ser parcelada (a conta da parte sai em N parcelas);
 *  - "Faturar" cheio intacto (sem parte: faturaParcial=false, rótulo "Fatura N", previsão absorvida como antes);
 *  - OS avulsa: parcial pelos itens executados + adicionais; OS gerada do orçamento compartilha o saldo (sem dupla cobrança);
 *  - multiempresa: orçamento de outra empresa → 404, nada criado; sem permissão → 403.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/faturamento-parcial-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { calcularOrcamento } from "@/lib/orcamentos/calculo";
import { statusFaturamento } from "@/lib/faturamento/fatura";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_fat_parcial_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}
const faturarOrc = (id: string, corpo?: unknown) => chamar("orcamentos/[id]/faturar", "POST", { id }, corpo);
const faturarOs = (id: string, corpo?: unknown) => chamar("ordens/[id]/faturar", "POST", { id }, corpo);
const cancelar = (id: string) => chamar("medicoes/[id]/acao", "POST", { id }, { acao: "CANCELAR" });
const num = (numero: string) => numero.replace(/^MED-/, "");

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Faturamento parcial (PostgreSQL real)", () => {
  let prisma: any;
  let fin: typeof import("@/lib/financeiro-server");
  let fat: typeof import("@/lib/faturamento/faturar-server");
  let af: typeof import("@/lib/financeiro/a-faturar");
  let n = 0;
  const seq = () => String(++n).padStart(4, "0");

  async function novoOrcamento(o: {
    servicos?: { servicoId?: string | null; descricao?: string; q?: number; v: number }[];
    produtos?: { v: number; q?: number }[];
    desconto?: number; iss?: number; status?: string; empresaId?: string; clienteId?: string;
  } = {}) {
    const servicos = (o.servicos ?? [{ servicoId: "sSN", v: 1000 }]).map((s, i) => ({
      servicoId: s.servicoId ?? null, descricao: s.descricao ?? `Serviço ${i + 1}`, quantidade: s.q ?? 1, valorUnitario: s.v, valorTotal: (s.q ?? 1) * s.v, ordem: i,
    }));
    const produtos = (o.produtos ?? []).map((p, i) => ({ descricao: `Peça ${i + 1}`, quantidade: p.q ?? 1, valorUnitario: p.v, valorTotal: (p.q ?? 1) * p.v, ordem: i }));
    const entrada = {
      servicos, produtos, descontoServicos: o.desconto ?? 0, tipoDescontoServicos: "PERCENTUAL" as const,
      descontoProdutos: 0, tipoDescontoProdutos: "VALOR" as const, issAliquota: o.iss ?? 0,
    };
    const t = calcularOrcamento(entrada);
    return prisma.orcamento.create({ data: {
      empresaId: o.empresaId ?? "e1", codigo: `ORC-2026-${seq()}`, nome: "Troca de compressor", clienteId: o.clienteId ?? "c1", criadoPorId: o.empresaId === "e2" ? "uB" : "uA",
      status: o.status ?? "APROVADO", tipo: "COMUM", tokenPublico: `tok-${n}-${Math.random()}`,
      descontoServicos: entrada.descontoServicos, tipoDescontoServicos: "PERCENTUAL", issAliquota: entrada.issAliquota,
      totalGeral: t.totalGeral, totalServicos: t.subtotalServicos,
      servicos: { create: servicos }, produtos: { create: produtos },
    }, include: { servicos: true } });
  }
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: {
    empresaId: "e1", numero: `OS-2026-${seq()}`, clienteId: "c1", criadoPorId: "uA", status: "CONCLUIDA", origem: "MANUAL",
    descricao: "Limpeza geral", dataConclusao: new Date(), ...dados,
  } });
  const medicao = (id: string) => prisma.medicao.findUnique({ where: { id }, include: { itens: { orderBy: { ordem: "asc" } } } });
  const vivas = (where: Record<string, unknown>) => prisma.contaReceber.findMany({ where: { ...where, status: { not: "CANCELADO" }, excluidaEm: null }, orderBy: { criadoEm: "asc" } });
  const resumo = async (orcamentoId: string) => {
    const f = (await fat.faturamentoDoOrcamento(orcamentoId, "e1"))!;
    return { total: f.total, faturado: f.faturado, saldo: f.saldo, status: statusFaturamento(f), n: f.faturas.length };
  };
  const previsao = async (orcamentoId: string) => (await af.itensAFaturar("e1")).find((i) => i.orcamentoId === orcamentoId)?.valor ?? null;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    for (const sql of ["2026-11-14_faturamento_travas_retencoes.sql", "2026-11-16_faturar_avulso.sql", "2026-11-08_faturamento_parcial.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    fin = await import("@/lib/financeiro-server");
    fat = await import("@/lib/faturamento/faturar-server");
    af = await import("@/lib/financeiro/a-faturar");
    await Promise.all(["orcamentos/[id]/faturar", "ordens/[id]/faturar", "medicoes/[id]/acao"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`).catch(() => null)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.configuracao.create({ data: { empresaId: "e1", issAliquota: 5 } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11222333000181", diaFaturamento: 10 },
      { id: "cX", empresaId: "e2", nome: "Da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.servico.createMany({ data: [
      { id: "sISS", empresaId: "e1", nome: "Manutenção", codigo: "MANU01", codigoLc116: "14.01", issRetido: true, aliquotaISS: 2 },
      { id: "sSN", empresaId: "e1", nome: "Visita", codigo: "VISI01", codigoLc116: "14.01" },
    ] });
    logar();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("parcial por percentual (40% do total): fatura própria, marcada parcial, linhas proporcionais, conta só da parte, previsão vira a parte, evento; status parcial; previsão mostra o saldo", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 600 }, { servicoId: null, descricao: "Deslocamento", v: 300 }], produtos: [{ v: 100 }] });
    const prevista = await fin.gerarContaReceberDoOrcamento(orc.id);
    expect(await resumo(orc.id)).toEqual({ total: 1000, faturado: 0, saldo: 1000, status: "A_FATURAR", n: 0 });
    expect(await previsao(orc.id)).toBeNull(); // ainda tem a conta Prevista antiga: ela é que está no Contas a Receber

    const r = await faturarOrc(orc.id, { parcial: { percentual: 40 } });
    expect(r.status).toBe(201);
    const m = await medicao(r.json.id);
    expect(r.json).toMatchObject({ jaExistia: false, rotulo: `Fatura ${num(m.numero)} (parcial 40%)`, parcial: { percentual: 40, valor: 400, saldoRestante: 600 } });
    expect(m).toMatchObject({ tipo: "ADICIONAL", avulsa: true, status: "PC_RECEBIDO", faturaParcial: true });
    expect(Number(m.percentualFaturado)).toBe(40);
    expect(Number(m.valorLiquido)).toBe(400);
    expect(m.descricao).toBe(`Parcial 40% — Orçamento ${orc.codigo} — Troca de compressor`);
    // Linhas: 40% de cada uma, quantidade 1, com o serviço do catálogo e o orçamento de origem
    expect(m.itens.map((i: any) => [i.tipo, i.descricao, Number(i.quantidade), Number(i.valorTotal), i.servicoId, i.orcamentoId])).toEqual([
      ["SERVICO", "Serviço 1 — parcial 40%", 1, 240, "sSN", orc.id],
      ["SERVICO", "Deslocamento — parcial 40%", 1, 120, null, orc.id],
      ["PRODUTO", "Peça 1 — parcial 40%", 1, 40, null, orc.id],
    ]);
    // A conta a receber da parte: a previsão do orçamento virou esta conta, agora valendo a parte
    const contas = await vivas({ OR: [{ orcamentoId: orc.id }, { medicaoId: m.id }] });
    expect(contas).toHaveLength(1);
    expect(contas[0]).toMatchObject({ id: prevista!.id, medicaoId: m.id });
    expect(Number(contas[0].valor)).toBe(400);
    // Linha do tempo
    const ev = await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: orc.id, tipo: "FATURADO" } });
    expect(ev.detalhe).toBe(`Fatura ${num(m.numero)} (parcial 40%)`);
    // O orçamento: parcialmente faturado, saldo 600; a previsão ("A faturar") passa a ser só o saldo
    expect(await resumo(orc.id)).toEqual({ total: 1000, faturado: 400, saldo: 600, status: "PARCIAL", n: 1 });
    expect(await previsao(orc.id)).toBe(600);
  });

  it("por valor, depois \"Faturar\" fecha com o saldo (e é parcial); as partes somam o total; fechado: jaExistia e parcial recusado", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 1234.56 }] });
    const a = await faturarOrc(orc.id, { parcial: { valor: 493.82 } });
    expect(a).toMatchObject({ status: 201, json: { parcial: { percentual: 40, valor: 493.82, saldoRestante: 740.74 } } });
    const b = await faturarOrc(orc.id, { parcial: { percentual: 35 } });
    expect(b).toMatchObject({ status: 201, json: { parcial: { percentual: 35, valor: 432.1, saldoRestante: 308.64 } } });
    expect(await resumo(orc.id)).toEqual({ total: 1234.56, faturado: 925.92, saldo: 308.64, status: "PARCIAL", n: 2 });
    expect(await previsao(orc.id)).toBe(308.64);

    // "Faturar" (cheio) depois de partes: fatura só o saldo, marcado parcial (25%)
    const c = await faturarOrc(orc.id);
    expect(c).toMatchObject({ status: 201, json: { parcial: { percentual: 25, valor: 308.64, saldoRestante: 0 } } });
    const mc = await medicao(c.json.id);
    expect(mc.faturaParcial).toBe(true);
    expect(Number(mc.percentualFaturado)).toBe(25);
    expect(await resumo(orc.id)).toEqual({ total: 1234.56, faturado: 1234.56, saldo: 0, status: "FATURADO", n: 3 });
    expect(await previsao(orc.id)).toBeNull();
    // "Mesmo número": três faturas com números distintos cujos líquidos somam exatamente o total; as contas idem
    const ids = [a.json.id, b.json.id, c.json.id];
    const ms = await prisma.medicao.findMany({ where: { id: { in: ids } } });
    expect(new Set(ms.map((m: any) => m.numero)).size).toBe(3);
    expect(Math.round(ms.reduce((s: number, m: any) => s + Number(m.valorLiquido), 0) * 100) / 100).toBe(1234.56);
    const contas = await vivas({ medicaoId: { in: ids } });
    expect(contas).toHaveLength(3);
    expect(Math.round(contas.reduce((s: number, x: any) => s + Number(x.valor), 0) * 100) / 100).toBe(1234.56);
    // Fechado: "Faturar" leva à última; "Faturar parcial" é recusado; nada novo
    expect(await faturarOrc(orc.id)).toMatchObject({ status: 200, json: { id: c.json.id, jaExistia: true } });
    expect(await faturarOrc(orc.id, { parcial: { percentual: 10 } })).toMatchObject({ status: 200, json: { id: c.json.id, jaExistia: true } });
    expect(await prisma.medicaoItem.count({ where: { orcamentoId: orc.id, medicao: { status: { not: "CANCELADA" } } } })).toBe(3);
  });

  it("o saldo manda: acima do saldo → 409 e nada criado; 1 centavo de folga fecha; corpo inválido → 400", async () => {
    const orc = await novoOrcamento();
    expect(await faturarOrc(orc.id, { parcial: { valor: 400 } })).toMatchObject({ status: 201 });
    expect(await faturarOrc(orc.id, { parcial: { valor: 600.02 } })).toMatchObject({ status: 409, json: { erro: "A parte (600.02) passa do saldo a faturar (600.00)." } });
    expect(await faturarOrc(orc.id, { parcial: { percentual: 61 } })).toMatchObject({ status: 409, json: { erro: expect.stringMatching(/passa do saldo/) } });
    expect(await faturarOrc(orc.id, { parcial: { percentual: 101 } })).toMatchObject({ status: 400, json: { erro: expect.stringMatching(/^Pedido inválido/) } });
    expect(await faturarOrc(orc.id, { parcial: { valor: -1 } })).toMatchObject({ status: 400 });
    expect(await resumo(orc.id)).toMatchObject({ faturado: 400, saldo: 600, n: 1 });
    // 600,01 = saldo + 1 centavo: arredonda ao saldo e fecha
    const r = await faturarOrc(orc.id, { parcial: { valor: 600.01 } });
    expect(r).toMatchObject({ status: 201, json: { parcial: { valor: 600, saldoRestante: 0 } } });
    expect(await resumo(orc.id)).toMatchObject({ faturado: 1000, saldo: 0, status: "FATURADO", n: 2 });
  });

  it("5 pedidos de 30% ao mesmo tempo → 3 faturas (201) e 2 recusados (409): nunca passa do total", async () => {
    const orc = await novoOrcamento();
    const rs = await Promise.all(Array.from({ length: 5 }, () => faturarOrc(orc.id, { parcial: { percentual: 30 } })));
    expect(rs.filter((x) => x.status === 201)).toHaveLength(3);
    expect(rs.filter((x) => x.status === 409)).toHaveLength(2);
    expect(await resumo(orc.id)).toEqual({ total: 1000, faturado: 900, saldo: 100, status: "PARCIAL", n: 3 });
  });

  it("retenções proporcionais: ISS retido 2% sai sobre a parte (10,00 em 500), e a conta da parte pelo líquido (490)", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sISS", v: 1000 }] });
    const r = await faturarOrc(orc.id, { parcial: { percentual: 50 } });
    const m = await medicao(r.json.id);
    expect([Number(m.valorTotal), Number(m.valorLiquido), Number(m.retIssAliquota), Number(m.valorRetencoes)]).toEqual([500, 500, 2, 10]);
    expect(Number((await vivas({ medicaoId: m.id }))[0].valor)).toBe(490);
    // O resto: a mesma regra sobre os outros 500
    const m2 = await medicao((await faturarOrc(orc.id)).json.id);
    expect([Number(m2.valorLiquido), Number(m2.valorRetencoes)]).toEqual([500, 10]);
  });

  it("com desconto: a parte leva o desconto proporcional (total/desconto/líquido fecham) e o saldo é do líquido", async () => {
    // 1.000 − 10% = 900 líquido; 40% → líquido 360, desconto 40, total 400
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 1000 }], desconto: 10 });
    const m = await medicao((await faturarOrc(orc.id, { parcial: { percentual: 40 } })).json.id);
    expect([Number(m.valorTotal), Number(m.descontoValor), Number(m.valorLiquido)]).toEqual([400, 40, 360]);
    expect(await resumo(orc.id)).toMatchObject({ total: 900, faturado: 360, saldo: 540 });
  });

  it("cancelar uma parte devolve o valor ao saldo; a previsão revive valendo o SALDO (não o total) e some de novo quando refatura", async () => {
    const orc = await novoOrcamento();
    const prevista = await fin.gerarContaReceberDoOrcamento(orc.id);
    const a = await faturarOrc(orc.id, { parcial: { percentual: 40 } }); // absorve a previsão (vira a conta de 400)
    const b = await faturarOrc(orc.id, { parcial: { percentual: 30 } }); // conta nova de 300
    expect(await resumo(orc.id)).toMatchObject({ faturado: 700, saldo: 300, status: "PARCIAL", n: 2 });

    expect(await cancelar(a.json.id)).toMatchObject({ status: 200, json: { ok: true, status: "CANCELADA" } });
    expect((await medicao(a.json.id)).status).toBe("CANCELADA");
    // Volta a ter 700 a faturar (a parte B, de 300, continua)
    expect(await resumo(orc.id)).toEqual({ total: 1000, faturado: 300, saldo: 700, status: "PARCIAL", n: 1 });
    // A previsão do orçamento voltou — valendo o saldo (700), não o total (1.000); e a conta da parte B segue
    const contas = await vivas({ OR: [{ orcamentoId: orc.id }, { medicaoId: b.json.id }] });
    expect(contas.map((c: any) => [c.id === prevista!.id ? "previsao" : "parteB", c.status, c.medicaoId, Number(c.valor)]).sort()).toEqual([
      ["parteB", "PREVISTO", b.json.id, 300], ["previsao", "PREVISTO", null, 700],
    ]);
    // Com a previsão de volta no Contas a Receber, o "A faturar" não conta em dobro
    expect(await previsao(orc.id)).toBeNull();
    // Fatura o saldo de novo: a previsão vira a conta (700), fechado
    const c = await faturarOrc(orc.id);
    expect(c).toMatchObject({ status: 201, json: { parcial: { valor: 700, saldoRestante: 0 } } });
    expect(await resumo(orc.id)).toMatchObject({ faturado: 1000, saldo: 0, status: "FATURADO", n: 2 });
    const depois = await vivas({ OR: [{ orcamentoId: orc.id }, { medicaoId: { in: [b.json.id, c.json.id] } }] });
    expect(depois.map((x: any) => Number(x.valor)).sort((x: number, y: number) => x - y)).toEqual([300, 700]);
    expect(depois.find((x: any) => x.medicaoId === c.json.id).id).toBe(prevista!.id); // a previsão revivida virou a conta da última parte
    // Cancelar a única parte viva de um orçamento sem outras: volta a "A faturar" por inteiro
    const orc2 = await novoOrcamento();
    const u = await faturarOrc(orc2.id, { parcial: { valor: 250 } });
    await cancelar(u.json.id);
    expect(await resumo(orc2.id)).toEqual({ total: 1000, faturado: 0, saldo: 1000, status: "A_FATURAR", n: 0 });
    expect(await previsao(orc2.id)).toBe(1000);
  });

  it("uma fatura parcial pode ser parcelada: a conta da parte sai em 2 parcelas (soma = a parte)", async () => {
    const orc = await novoOrcamento();
    const r = await faturarOrc(orc.id, { parcial: { percentual: 50 }, parcelamento: { quantidade: 2 } });
    expect(r).toMatchObject({ status: 201, json: { parcelas: 2, parcial: { valor: 500 } } });
    const lanc = await prisma.contaReceber.findFirst({ where: { medicaoId: r.json.id, status: "PARCELADO" } });
    expect(lanc).toBeTruthy();
    const parcelas = await prisma.contaReceber.findMany({ where: { lancamentoId: lanc.id }, orderBy: { dataVencimento: "asc" } });
    expect(parcelas.map((p: any) => Number(p.valor))).toEqual([250, 250]);
    expect(await resumo(orc.id)).toMatchObject({ faturado: 500, saldo: 500, status: "PARCIAL" });
  });

  it("\"Faturar\" cheio segue intacto: sem parte anterior não é parcial, rótulo \"Fatura N\", previsão absorvida; 2ª vez → jaExistia", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 700 }], produtos: [{ v: 300 }] });
    const prevista = await fin.gerarContaReceberDoOrcamento(orc.id);
    const r = await faturarOrc(orc.id);
    expect(r.status).toBe(201);
    expect(r.json.parcial).toBeUndefined();
    const m = await medicao(r.json.id);
    expect(r.json.rotulo).toBe(`Fatura ${num(m.numero)}`);
    expect([m.faturaParcial, m.percentualFaturado]).toEqual([false, null]);
    expect(m.descricao).toBe(`Orçamento ${orc.codigo} — Troca de compressor`);
    expect(m.itens.map((i: any) => [i.descricao, Number(i.quantidade), Number(i.valorTotal)])).toEqual([["Serviço 1", 1, 700], ["Peça 1", 1, 300]]);
    const contas = await vivas({ OR: [{ orcamentoId: orc.id }, { medicaoId: m.id }] });
    expect(contas).toHaveLength(1);
    expect(contas[0]).toMatchObject({ id: prevista!.id, medicaoId: m.id });
    expect(await resumo(orc.id)).toEqual({ total: 1000, faturado: 1000, saldo: 0, status: "FATURADO", n: 1 });
    expect(await faturarOrc(orc.id)).toMatchObject({ status: 200, json: { id: m.id, jaExistia: true } });
  });

  it("OS avulsa: parcial pelos itens executados + adicionais; OS gerada do orçamento compartilha o saldo com ele (sem dupla cobrança)", async () => {
    const os = await novaOs();
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Limpeza", quantidade: 2, valorUnitario: 150, valorTotal: 300, executado: true } });
    const at = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Visita", status: "CONCLUIDA" } });
    await prisma.servicoAdicional.create({ data: { empresaId: "e1", ordemServicoId: os.id, atividadeId: at.id, descricao: "Troca de capacitor", statusCobranca: "COBRAR", valor: 100 } });
    const r = await faturarOs(os.id, { parcial: { percentual: 25 } });
    expect(r).toMatchObject({ status: 201, json: { parcial: { percentual: 25, valor: 100, saldoRestante: 300 } } });
    const m = await medicao(r.json.id);
    expect(m.itens.map((i: any) => [i.descricao, Number(i.valorTotal), i.ordemServicoId])).toEqual([["Limpeza — parcial 25%", 75, os.id], ["Serviço adicional — Troca de capacitor — parcial 25%", 25, os.id]]);
    expect(m.descricao).toBe(`Parcial 25% — OS ${os.numero} — Limpeza geral`);
    const fOs = await fat.faturamentoDaOs(os.id);
    expect(fOs).toMatchObject({ total: 400, faturado: 100, saldo: 300 });
    const hist = await prisma.osHistorico.findFirst({ where: { ordemServicoId: os.id, acao: "OS faturada" } });
    expect(hist.detalhes).toBe(`Fatura ${num(m.numero)} (parcial 25%)`);
    expect(await faturarOs(os.id)).toMatchObject({ status: 201, json: { parcial: { valor: 300, saldoRestante: 0 } } });
    expect(await fat.faturamentoDaOs(os.id)).toMatchObject({ faturado: 400, saldo: 0 });

    // Orçamento → "Gerar OS": a parte faturada pela OS entra no saldo do orçamento, e vice-versa
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 1000 }] });
    const { gerarOsDoOrcamento } = await import("@/lib/orcamentos/gerar-os-server");
    const { prepararExecucao } = await import("@/lib/os/abertura");
    const prep = await prepararExecucao("e1", { tecnicoIds: ["t1"], responsavelId: "t1" });
    if ("erro" in prep) throw new Error(prep.erro);
    const g: any = await gerarOsDoOrcamento({ empresaId: "e1", usuarioId: "uA", orcamentoId: orc.id, execucao: prep.execucao });
    expect(g.tipo).toBe("criada");
    await prisma.ordemServico.update({ where: { id: g.os.id }, data: { status: "CONCLUIDA", dataConclusao: new Date() } });
    await prisma.osItemOrcamento.updateMany({ where: { ordemServicoId: g.os.id }, data: { executado: true } });
    expect(await faturarOrc(orc.id, { parcial: { percentual: 40 } })).toMatchObject({ status: 201, json: { parcial: { valor: 400 } } });
    // A OS vê o mesmo saldo (600) e fatura a parte que falta pela OS
    expect(await fat.faturamentoDaOs(g.os.id)).toMatchObject({ total: 1000, faturado: 400, saldo: 600 });
    expect(await faturarOs(g.os.id, { parcial: { valor: 700 } })).toMatchObject({ status: 409 });
    expect(await faturarOs(g.os.id)).toMatchObject({ status: 201, json: { parcial: { valor: 600, saldoRestante: 0 } } });
    expect(await resumo(orc.id)).toMatchObject({ faturado: 1000, saldo: 0, status: "FATURADO", n: 2 });
    expect(await faturarOrc(orc.id, { parcial: { percentual: 10 } })).toMatchObject({ status: 200, json: { jaExistia: true } });
  });

  it("fatura CHEIA cobre a origem inteira: OS gerada faturou só os itens executados → o orçamento não tem saldo (como sempre foi)", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 1000 }, { servicoId: null, descricao: "Não executado", v: 500 }] });
    const { gerarOsDoOrcamento } = await import("@/lib/orcamentos/gerar-os-server");
    const { prepararExecucao } = await import("@/lib/os/abertura");
    const prep = await prepararExecucao("e1", { tecnicoIds: ["t1"], responsavelId: "t1" });
    if ("erro" in prep) throw new Error(prep.erro);
    const g: any = await gerarOsDoOrcamento({ empresaId: "e1", usuarioId: "uA", orcamentoId: orc.id, execucao: prep.execucao });
    await prisma.ordemServico.update({ where: { id: g.os.id }, data: { status: "CONCLUIDA", dataConclusao: new Date() } });
    await prisma.osItemOrcamento.updateMany({ where: { ordemServicoId: g.os.id, descricao: "Serviço 1" }, data: { executado: true } });
    const r = await faturarOs(g.os.id);
    expect(r.status).toBe(201);
    expect(r.json.parcial).toBeUndefined();
    const m = await medicao(r.json.id);
    expect([m.faturaParcial, Number(m.valorLiquido)]).toEqual([false, 1000]);
    // 1.000 de 1.500, mas a fatura é cheia: o orçamento conta como faturado por inteiro; nada a faturar por fora
    expect(await resumo(orc.id)).toEqual({ total: 1500, faturado: 1500, saldo: 0, status: "FATURADO", n: 1 });
    expect(await previsao(orc.id)).toBeNull();
    expect(await faturarOrc(orc.id, { parcial: { valor: 100 } })).toMatchObject({ status: 200, json: { id: m.id, jaExistia: true } });
    expect(await faturarOrc(orc.id)).toMatchObject({ status: 200, json: { id: m.id, jaExistia: true } });
  });

  it("multiempresa: orçamento da outra empresa → 404 e nada criado; sem Financeiro › Medições → 403; a leitura do faturamento não cruza", async () => {
    const daOutra = await novoOrcamento({ empresaId: "e2", clienteId: "cX" });
    expect((await faturarOrc(daOutra.id, { parcial: { percentual: 40 } })).status).toBe(404);
    expect(await prisma.medicao.count({ where: { empresaId: "e2" } })).toBe(0);
    expect(await fat.faturamentoDoOrcamento(daOutra.id, "e1")).toBeNull();
    const orc = await novoOrcamento();
    logar(montarPermissoes({ financeiro: ["visualizar", "contasReceber"], orcamentos: ["visualizar"], ordens: ["visualizar"] }));
    try {
      expect((await faturarOrc(orc.id, { parcial: { percentual: 40 } })).status).toBe(403);
    } finally { logar(); }
    expect(await prisma.medicaoItem.count({ where: { orcamentoId: orc.id } })).toBe(0);
  });
});
