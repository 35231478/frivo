/**
 * Contas a Receber — marcar como perda + estorno de recebimento, PostgreSQL real e rotas reais:
 *  - Perda: permissão própria (Financeiro › Perdas), motivo obrigatório, só cobrança em aberto e sem boleto
 *    emitido; o SALDO vira perda e o já recebido continua; nada de receber/cancelar/excluir/parcelar/cobrar/
 *    estornar em perda; reverter (voltar a cobrar) ou recuperar (o cliente pagou: recebimento normal);
 *  - Estorno: um recebimento (parcial ou total) ou a baixa antiga; o saldo volta; trava contra estorno duplo
 *    (inclusive dois pedidos ao mesmo tempo); o pago pelo boleto não se estorna aqui; a medição paga volta;
 *  - a medição com cobrança em perda não fica paga, não se cancela, não muda retenções;
 *  - números: cards (Perdas, Total), fluxo ("Perdas do mês", previsto), dashboard, relatório, alerta 12 meses;
 *  - MESMO NÚMERO: marcar perda só tira do a receber o que virou perda (recebido e faturado iguais); reverter
 *    devolve tudo; estornar tira do recebido exatamente o estornado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/perda-estorno-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_perda_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
const inter = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}), enviarBoleto: vi.fn(async () => {}) }));
vi.mock("@/lib/inter-api", () => ({
  carregarConfigInter: vi.fn(async () => ({ ativo: true, config: {} })),
  emitirBoletoInter: vi.fn(async () => { inter.n++; return { codigoSolicitacao: `cs-${inter.n}`, nossoNumero: `nn-${inter.n}`, codigoBarras: "0779", linhaDigitavel: "0779 1" }; }),
  cancelarBoletoInter: vi.fn(async () => ({})),
  consultarBoletoInter: vi.fn(async () => ({ cobranca: { situacao: "A_RECEBER" } })),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));

/** Ana (e1) com tudo; Beto (e2) com tudo; Caio (e1) com Contas a Receber mas SEM Financeiro › Perdas */
const logar = (empresaId = "e1", semPerdas = false) => {
  const permissoes = permissoesTotais();
  if (semPerdas) permissoes.financeiro.perdas = false;
  const id = semPerdas ? "uC" : empresaId === "e1" ? "uA" : "uB";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

/** "Agora": 15/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-15T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const R = (v: string) => new RegExp(`R\\$\\s?${v.replace(/\./g, "\\.")}`);

vi.setConfig({ testTimeout: 90_000 });

describe.skipIf(!URL_PG)("Contas a Receber — perda + estorno (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;
  const seq = () => String(++n).padStart(4, "0");

  const novaConta = async (valor: number, vencimento: string, extra: Record<string, unknown> = {}) => {
    const r = await chamar("contas-receber", "POST", {}, { clienteId: "c1", descricao: "Manutenção", valor, dataVencimento: vencimento, contaBancariaId: "cb1", formaPagamento: "PIX", ...extra });
    expect(r.status).toBe(201);
    return r.json;
  };
  const conta = (id: string) => prisma.contaReceber.findUnique({ where: { id } });
  const receber = (id: string, corpo: Record<string, unknown>) => chamar("contas-receber/[id]/recebimentos", "POST", { id }, corpo);
  const marcar = (id: string, motivo: unknown = "Cliente faliu") => chamar("contas-receber/[id]/perda", "POST", { id }, { motivo });
  const reverter = (id: string, corpo: Record<string, unknown>) => chamar("contas-receber/[id]/perda/reverter", "POST", { id }, corpo);
  const estornar = (id: string, corpo: Record<string, unknown>) => chamar("contas-receber/[id]/recebimentos/estornar", "POST", { id }, corpo);
  const recebimentos = async (id: string) => (await chamar("contas-receber/[id]/recebimentos", "GET", { id })).json;
  const eventos = async (id: string) => (await prisma.contaReceberEvento.findMany({ where: { contaReceberId: id }, orderBy: { criadoEm: "asc" } })).map((e: any) => [e.tipo, e.detalhe]);
  const orcamentoAprovado = (total: number) => prisma.orcamento.create({ data: {
    empresaId: "e1", codigo: `ORC-2026-${seq()}`, nome: "Instalação VRF", clienteId: "c1", criadoPorId: "uA", status: "APROVADO", tipo: "COMUM",
    tokenPublico: `tok-${n}`, validadeEm: dia("2026-12-20"), totalGeral: total, totalServicos: total,
    servicos: { create: [{ servicoId: "sSN", descricao: "Instalação", quantidade: 1, valorUnitario: total, valorTotal: total, ordem: 0 }] },
  } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    // As travas de produção e o SQL desta leva, de verdade
    for (const sql of ["2026-11-14_faturamento_travas_retencoes.sql", "2026-11-16_faturar_avulso.sql", "2026-11-18_contas_receber_parcelas.sql", "2026-11-20_contas_receber_perda_estorno.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "contas-receber", "contas-receber/[id]", "contas-receber/[id]/parcelar", "contas-receber/[id]/recebimentos", "contas-receber/[id]/boleto",
      "contas-receber/[id]/perda", "contas-receber/[id]/perda/reverter", "contas-receber/[id]/recebimentos/estornar",
      "orcamentos/[id]/faturar", "medicoes/[id]/acao", "medicoes/[id]/retencoes", "clientes/[id]/status-financeiro",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Mesmo número", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uC", empresaId: "e1", nome: "Caio", email: "caio@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11222333000181", diaFaturamento: 10 },
      { id: "c2", empresaId: "e2", nome: "Padaria", cpfCnpj: "11222333000181" },
    ] });
    await prisma.servico.create({ data: { id: "sSN", empresaId: "e1", nome: "Instalação", codigo: "INST01", codigoLc116: "14.01" } });
    await prisma.contaBancaria.create({ data: { id: "cb1", empresaId: "e1", nome: "Inter PJ" } });
    await prisma.integracaoInter.create({ data: { empresaId: "e1", ativo: true, webhookSecret: "tk-e1" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    logar();
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("Marcar como perda: permissão própria, motivo obrigatório; o SALDO vira perda e o recebido continua; evento com motivo e autor", async () => {
    const c = await novaConta(1000, "2026-11-01");
    expect((await receber(c.id, { valor: 400, data: "2026-11-10" })).status).toBe(201);

    // Sem Financeiro › Perdas (mesmo com Contas a Receber): 403, nada muda
    logar("e1", true);
    expect((await marcar(c.id)).status).toBe(403);
    logar();
    expect((await conta(c.id)).status).not.toBe("PERDA");
    // Motivo: vazio, curto demais, ausente
    for (const corpo of [{ motivo: "" }, { motivo: "ab" }, { motivo: "   " }, {}]) {
      expect(await chamar("contas-receber/[id]/perda", "POST", { id: c.id }, corpo)).toMatchObject({ status: 400, json: { erro: "Informe o motivo da perda." } });
    }
    // Outra empresa não acha a conta
    logar("e2");
    expect(await marcar(c.id)).toMatchObject({ status: 404, json: { erro: "Conta não encontrada." } });
    logar();

    const r = await marcar(c.id, "  Cliente faliu  ");
    expect(r).toMatchObject({ status: 200, json: { ok: true, valorPerda: 600 } });
    const d = await conta(c.id);
    expect([d.status, Number(d.valorPerda), Number(d.valorRecebido), d.motivoPerda, d.perdaPorId, d.perdaEm.toISOString()])
      .toEqual(["PERDA", 600, 400, "Cliente faliu", "uA", AGORA.toISOString()]);
    expect((await eventos(c.id)).at(-1)).toEqual(["PERDA", expect.stringMatching(/^Perda de R\$\s?600,00 · já recebido R\$\s?400,00 continua recebido · Cliente faliu$/)]);
    // O recebimento continua lá, sem estorno
    expect((await recebimentos(c.id)).map((x: any) => [x.valor, x.estornadoEm])).toEqual([[400, null]]);

    // Em perda: nada de marcar de novo, receber, cancelar, excluir, parcelar, cobrar, estornar
    expect(await marcar(c.id)).toMatchObject({ status: 409, json: { erro: "Esta conta já está marcada como perda." } });
    const rec = await receber(c.id, { valor: 10, data: "2026-11-15" });
    expect(rec.status).toBe(409);
    expect(rec.json.erro).toContain("Reverter perda");
    expect((await chamar("contas-receber/[id]", "PUT", { id: c.id }, { status: "CANCELADO", motivoCancelamento: "teste" })).status).toBe(409);
    expect((await chamar("contas-receber/[id]", "DELETE", { id: c.id }, {})).status).toBe(409);
    expect(await chamar("contas-receber/[id]/parcelar", "POST", { id: c.id }, { parcelas: [{ vencimento: "2026-12-01", valor: 300 }, { vencimento: "2027-01-01", valor: 300 }] }))
      .toMatchObject({ status: 409, json: { erro: "Conta em perda não se parcela." } });
    expect(await chamar("contas-receber/[id]/boleto", "POST", { id: c.id }, { vencimento: "2026-12-01" }))
      .toMatchObject({ status: 400, json: { erro: "Conta em perda: reverta a perda antes de cobrar." } });
    const rid = (await recebimentos(c.id))[0].id;
    expect(await estornar(c.id, { recebimentoId: rid, motivo: "Baixa errada" })).toMatchObject({ status: 409, json: { erro: "Conta em perda: reverta a perda antes de estornar." } });
    expect([(await conta(c.id)).status, Number((await conta(c.id)).valorRecebido)]).toEqual(["PERDA", 400]);
  });

  it("Marcar como perda: só cobrança em aberto e sem boleto emitido (cancele o boleto antes)", async () => {
    const comBoleto = await novaConta(500, "2026-12-01");
    expect((await chamar("contas-receber/[id]/boleto", "POST", { id: comBoleto.id }, { vencimento: "2026-12-01" })).status).toBe(201);
    expect(await marcar(comBoleto.id)).toMatchObject({ status: 409, json: { erro: "Cancele o boleto antes: o cliente ainda consegue pagá-lo." } });
    expect((await chamar("contas-receber/[id]/boleto", "DELETE", { id: comBoleto.id })).status).toBe(200);
    expect((await marcar(comBoleto.id)).status).toBe(200);

    const paga = await novaConta(200, "2026-12-01");
    await receber(paga.id, { data: "2026-11-15" });
    expect(await marcar(paga.id)).toMatchObject({ status: 409, json: { erro: "Conta recebida não vira perda." } });
    const prevista = await prisma.contaReceber.create({ data: { empresaId: "e1", clienteId: "c1", numero: `CR-2026-9${seq()}`, descricao: "Prevista", valor: 100, status: "PREVISTO" } });
    expect(await marcar(prevista.id)).toMatchObject({ status: 409, json: { erro: "Ainda é previsão: não é cobrança." } });
    const lanc = await novaConta(300, "2026-12-01");
    await chamar("contas-receber/[id]/parcelar", "POST", { id: lanc.id }, { parcelas: [{ vencimento: "2026-12-01", valor: 150 }, { vencimento: "2027-01-01", valor: 150 }] });
    expect(await marcar(lanc.id)).toMatchObject({ status: 409, json: { erro: "Conta parcelada: marque a perda em cada parcela." } });
    // A parcela sim (cada parcela é uma cobrança)
    const p1 = await prisma.contaReceber.findFirst({ where: { lancamentoId: lanc.id, parcelaNumero: 1 } });
    expect(await marcar(p1.id)).toMatchObject({ status: 200, json: { valorPerda: 150 } });
  });

  it("Reverter perda: voltar a cobrar (o saldo volta) ou o cliente pagou (recuperação = recebimento normal, inclusive em parte)", async () => {
    const c = await novaConta(800, "2026-12-01");
    await receber(c.id, { valor: 300, data: "2026-11-10" });
    await marcar(c.id, "Sem retorno há 6 meses");
    // Sem a permissão: 403
    logar("e1", true);
    expect((await reverter(c.id, { modo: "REABRIR" })).status).toBe(403);
    logar();
    // Voltar a cobrar
    expect(await reverter(c.id, { modo: "REABRIR", motivo: "Cliente ligou" })).toMatchObject({ status: 200, json: { valorPerda: 500, recebimento: null } });
    let d = await conta(c.id);
    expect([d.status, d.valorPerda, d.perdaEm, d.motivoPerda, d.perdaPorId, Number(d.valorRecebido)]).toEqual(["A_RECEBER", null, null, null, null, 300]);
    expect((await eventos(c.id)).at(-1)).toEqual(["PERDA_REVERTIDA", expect.stringMatching(/^Volta a receber R\$\s?500,00 · Cliente ligou$/)]);
    expect(await reverter(c.id, { modo: "REABRIR" })).toMatchObject({ status: 409, json: { erro: "Esta conta não está marcada como perda." } });

    // De novo em perda; o cliente pagou 200 dos 500: volta, recebe 200, faltam 300
    await marcar(c.id, "Sem retorno");
    // Recuperar sem data: recusado e nada muda (a transação volta)
    expect(await reverter(c.id, { modo: "RECUPERAR", valor: 200 })).toMatchObject({ status: 400, json: { erro: "Informe a data do recebimento." } });
    expect((await conta(c.id)).status).toBe("PERDA");
    // Mais que o perdido: recusado
    expect((await reverter(c.id, { modo: "RECUPERAR", valor: 600, data: "2026-11-15" })).status).toBe(400);
    expect((await conta(c.id)).status).toBe("PERDA");
    expect((await reverter(c.id, { modo: "RECUPERAR", valor: 200, data: "2026-11-15", formaPagamento: "PIX", motivo: "Acordo" })).status).toBe(200);
    d = await conta(c.id);
    expect([d.status, Number(d.valorRecebido), d.valorPerda]).toEqual(["A_RECEBER", 500, null]);
    expect((await recebimentos(c.id)).map((x: any) => [x.valor, x.origem, x.formaPagamento])).toEqual([[300, "MANUAL", null], [200, "RECUPERACAO", "PIX"]]);
    // O resto também: quitada
    await marcar(c.id, "Sumiu de novo");
    expect((await reverter(c.id, { modo: "RECUPERAR", data: "2026-11-15" })).status).toBe(200);
    d = await conta(c.id);
    expect([d.status, Number(d.valorRecebido), d.dataRecebimento?.toISOString().slice(0, 10)]).toEqual(["RECEBIDO", 800, "2026-11-15"]);
  });

  it("Estorno: parcial e total; o saldo volta; motivo + autor; trava contra estorno duplo (inclusive dois pedidos ao mesmo tempo)", async () => {
    const c = await novaConta(1000, "2026-12-01");
    await receber(c.id, { valor: 300, data: "2026-11-05" });
    await receber(c.id, { valor: 200, data: "2026-11-10" });
    const [r1, r2] = await recebimentos(c.id);
    expect(await estornar(c.id, { recebimentoId: r2.id, motivo: "x" })).toMatchObject({ status: 400, json: { erro: "Informe o motivo do estorno." } });

    expect(await estornar(c.id, { recebimentoId: r2.id, motivo: "Lançado em duplicidade" })).toMatchObject({ status: 200, json: { valor: 200, saldo: 700, medicaoReaberta: false } });
    let d = await conta(c.id);
    expect([d.status, Number(d.valorRecebido)]).toEqual(["A_RECEBER", 300]);
    const lista = await recebimentos(c.id);
    expect(lista.map((x: any) => [x.id, x.valor, !!x.estornadoEm, x.motivoEstorno, x.estornadoPor])).toEqual([
      [r1.id, 300, false, null, null], [r2.id, 200, true, "Lançado em duplicidade", "Ana"],
    ]);
    expect((await eventos(c.id)).at(-1)).toEqual(["ESTORNADA", expect.stringMatching(/^Estorno de R\$\s?200,00 \(recebido em 10\/11\/2026\) · volta a faltar R\$\s?700,00 · Lançado em duplicidade$/)]);
    expect(await estornar(c.id, { recebimentoId: r2.id, motivo: "De novo" })).toMatchObject({ status: 409, json: { erro: "Este recebimento já foi estornado." } });

    // Dois pedidos ao mesmo tempo no mesmo recebimento: um estorna, o outro é recusado; o saldo volta UMA vez
    const duplo = await Promise.all([estornar(c.id, { recebimentoId: r1.id, motivo: "Clique 1" }), estornar(c.id, { recebimentoId: r1.id, motivo: "Clique 2" })]);
    expect(duplo.map((x) => x.status).sort()).toEqual([200, 409]);
    d = await conta(c.id);
    expect(Number(d.valorRecebido)).toBe(0);
    expect((await eventos(c.id)).filter((e: any) => e[0] === "ESTORNADA")).toHaveLength(2);

    // Total: recebida inteira → estornada → volta a receber, sem data de recebimento
    await receber(c.id, { data: "2026-11-15" });
    expect((await conta(c.id)).status).toBe("RECEBIDO");
    const total = (await recebimentos(c.id)).find((x: any) => !x.estornadoEm);
    expect(await estornar(c.id, { recebimentoId: total.id, motivo: "Cheque devolvido" })).toMatchObject({ status: 200, json: { valor: 1000, saldo: 1000 } });
    d = await conta(c.id);
    expect([d.status, d.dataRecebimento, Number(d.valorRecebido)]).toEqual(["A_RECEBER", null, 0]);
    // Recebimento de outra conta: não é desta
    const outra = await novaConta(50, "2026-12-01");
    expect(await estornar(outra.id, { recebimentoId: r1.id, motivo: "Errado" })).toMatchObject({ status: 404, json: { erro: "Recebimento não encontrado." } });
    // Sem recebimento escolhido numa conta sem baixa antiga
    expect(await estornar(outra.id, { motivo: "Errado" })).toMatchObject({ status: 409, json: { erro: "Escolha o recebimento a estornar." } });
  });

  it("Estorno: o pago pelo boleto não se estorna aqui; a baixa antiga (antes do histórico) sim, gravada já estornada", async () => {
    const c = await novaConta(400, "2026-12-01");
    const rb = await prisma.contaReceberRecebimento.create({ data: { empresaId: "e1", contaReceberId: c.id, valor: 400, data: dia("2026-11-12"), origem: "BOLETO" } });
    await prisma.contaReceber.update({ where: { id: c.id }, data: { valorRecebido: 400, status: "RECEBIDO", dataRecebimento: dia("2026-11-12"), boletoStatus: "PAGO" } });
    expect(await estornar(c.id, { recebimentoId: rb.id, motivo: "Errado" })).toMatchObject({ status: 409, json: { erro: "Pago pelo boleto no banco: o estorno é com o banco, não aqui." } });

    // Baixa antiga: RECEBIDO com valor_recebido 0 e nenhum recebimento gravado
    const antiga = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: `CR-2026-8${seq()}`, descricao: "Antiga", valor: 350, status: "RECEBIDO",
      dataVencimento: dia("2026-11-03"), dataRecebimento: dia("2026-11-03"), formaPagamento: "DINHEIRO",
    } });
    expect(await estornar(antiga.id, { motivo: "Nunca recebemos" })).toMatchObject({ status: 200, json: { valor: 350, saldo: 350 } });
    const d = await conta(antiga.id);
    expect([d.status, d.dataRecebimento, Number(d.valorRecebido)]).toEqual(["A_RECEBER", null, 0]);
    expect((await recebimentos(antiga.id)).map((x: any) => [x.valor, x.origem, x.formaPagamento, !!x.estornadoEm, x.motivoEstorno]))
      .toEqual([[350, "LEGADO", "DINHEIRO", true, "Nunca recebemos"]]);
    expect((await eventos(antiga.id)).at(-1)).toEqual(["ESTORNADA", expect.stringMatching(/^Estorno de R\$\s?350,00 \(recebido em 03\/11\/2026\) · volta a faltar R\$\s?350,00 · Nunca recebemos$/)]);
    // De novo: já não há baixa antiga
    expect(await estornar(antiga.id, { motivo: "De novo" })).toMatchObject({ status: 409, json: { erro: "Escolha o recebimento a estornar." } });
    // O LEGADO não se estorna (já está estornado)
    const leg = (await recebimentos(antiga.id))[0];
    expect(await estornar(antiga.id, { recebimentoId: leg.id, motivo: "De novo" })).toMatchObject({ status: 409, json: { erro: "Este recebimento já foi estornado." } });

    // Baixa antiga paga pelo boleto: com o banco
    const antigaBoleto = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: `CR-2026-8${seq()}`, descricao: "Antiga boleto", valor: 90, status: "RECEBIDO", boletoStatus: "PAGO", dataRecebimento: dia("2026-11-03"),
    } });
    expect(await estornar(antigaBoleto.id, { motivo: "Errado" })).toMatchObject({ status: 409, json: { erro: "Pago pelo boleto no banco: o estorno é com o banco, não aqui." } });
  });

  it("Medição: o estorno do pagamento volta a fatura ao passo anterior; em perda ela não fica paga, não se cancela, não muda retenções; recuperar quita", async () => {
    const o = await orcamentoAprovado(2000);
    const f = await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, {});
    expect(f.status).toBe(201);
    const med = f.json.id;
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_NF", nfNumero: "77" })).status).toBe(200);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_PAGAMENTO", dataPagamento: "2026-11-14", formaPagamento: "PIX" })).status).toBe(200);
    const cr = await prisma.contaReceber.findFirst({ where: { medicaoId: med, status: { not: "CANCELADO" } } });
    expect([cr.status, (await prisma.medicao.findUnique({ where: { id: med } })).status]).toEqual(["RECEBIDO", "PAGO"]);

    // Estornar o pagamento: a conta volta a receber e a fatura volta para "NF emitida"
    const rec = (await recebimentos(cr.id))[0];
    expect(rec.origem).toBe("MEDICAO");
    expect(await estornar(cr.id, { recebimentoId: rec.id, motivo: "Pagamento não caiu" })).toMatchObject({ status: 200, json: { medicaoReaberta: true } });
    let m = await prisma.medicao.findUnique({ where: { id: med } });
    expect([m.status, m.dataPagamento]).toEqual(["NF_EMITIDA", null]);
    expect((await conta(cr.id)).status).toBe("A_RECEBER");
    expect((await eventos(cr.id)).at(-1)[1]).toContain("a fatura/medição deixou de estar paga");

    // Em perda: a fatura não fica paga (pagamento recusado), não se cancela, e as retenções não mudam
    expect((await marcar(cr.id, "Cliente fechou")).status).toBe(200);
    const pg = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_PAGAMENTO", dataPagamento: "2026-11-15" });
    expect(pg.status).toBe(409);
    expect(pg.json.erro).toBe(`${cr.numero} está em perda: registre o que o cliente pagou em “Reverter perda”, no Contas a Receber.`);
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).toBe("NF_EMITIDA");
    const canc = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "CANCELAR" });
    expect(canc.status).toBe(409);
    expect(canc.json.erro).toContain(cr.numero);
    expect(await chamar("medicoes/[id]/retencoes", "PUT", { id: med }, { iss: 5 })).toMatchObject({ status: 409, json: { erro: "Conta em perda: as retenções não mudam mais." } });
    expect(Number((await conta(cr.id)).valor)).toBe(2000);

    // O cliente pagou: recuperar quita a conta e a fatura fica PAGA
    expect((await reverter(cr.id, { modo: "RECUPERAR", data: "2026-11-15", formaPagamento: "TRANSFERENCIA" })).status).toBe(200);
    m = await prisma.medicao.findUnique({ where: { id: med } });
    expect([(await conta(cr.id)).status, m.status]).toEqual(["RECEBIDO", "PAGO"]);
  });

  it("Fatura em 2×: uma parcela em perda trava cancelar a fatura (com o número da parcela)", async () => {
    const o = await orcamentoAprovado(1000);
    const f = await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, { parcelamento: { quantidade: 2 } });
    expect(f.status).toBe(201);
    const med = f.json.id;
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_NF", nfNumero: "88" })).status).toBe(200);
    const lanc = await prisma.contaReceber.findFirst({ where: { medicaoId: med, status: "PARCELADO" } });
    const [p1] = await prisma.contaReceber.findMany({ where: { lancamentoId: lanc.id }, orderBy: { parcelaNumero: "asc" } });
    expect(await marcar(p1.id, "Cliente sumiu")).toMatchObject({ status: 200, json: { valorPerda: 500 } });
    const canc = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "CANCELAR" });
    expect(canc.status).toBe(409);
    expect(canc.json.erro).toContain(p1.numero);
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).not.toBe("CANCELADA");
  });

  it("MESMO NÚMERO + cards + fluxo + dashboard: perda só tira do a receber o que virou perda; estorno só tira do recebido o estornado; reverter devolve tudo", async () => {
    logar("e2");
    const fin = await import("@/lib/financeiro-server");
    const dash = await import("@/lib/dashboard/dados");
    const { default: PaginaCR } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    const { default: Fluxo } = await import("@/app/(dashboard)/financeiro/fluxo-caixa/page");
    await prisma.contaReceber.createMany({ data: [
      { id: "m1", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0001", descricao: "A", valor: 1000, status: "A_RECEBER", dataVencimento: dia("2026-11-20") },
      { id: "m2", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0002", descricao: "B", valor: 500, status: "ATRASADO", dataVencimento: dia("2026-11-05") },
      // recebida antes do histórico de recebimentos
      { id: "m3", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0003", descricao: "C", valor: 300, status: "RECEBIDO", dataVencimento: dia("2026-11-03"), dataRecebimento: dia("2026-11-03") },
    ] });
    expect((await receber("m2", { valor: 200, data: "2026-11-10" })).status).toBe(201);

    const cardsFluxo = async () => {
      const h = renderToStaticMarkup(await Fluxo({ searchParams: Promise.resolve({ mes: "11", ano: "2026" }) }));
      return ["Previsto no mês", "A receber", "Recebido", "Atrasado", "Perdas do mês"].map((r) => {
        const m = h.match(new RegExp(`data-card-fluxo="${r}"[\\s\\S]*?tabular-nums[^>]*>([^<]+)<`));
        return m![1].replace(/\s/g, " ");
      });
    };
    const foto = async () => {
      const r = await fin.resumoFinanceiro("e2");
      const d = await dash.dadosFinanceiro("e2", AGORA);
      const tela: any = await PaginaCR({ searchParams: Promise.resolve({}) });
      return {
        resumo: [r.aReceberMes.contas, r.recebidoMes.valor, r.vencidoReceber.valor],
        dash: [d.recebidoMes, d.aReceber.valor, d.vencidos.valor, d.faturadoMes],
        cards: tela.props.resumo,
        fluxo: await cardsFluxo(),
      };
    };
    const antes = await foto();
    expect(antes.resumo).toEqual([1300, 500, 300]);
    expect(antes.dash).toEqual([500, 1300, 300, 1800]);
    expect([antes.cards.VENCIDO, antes.cards.RECEBIDO, antes.cards.PERDA, antes.cards.TOTAL]).toEqual([{ v: 300, q: 1 }, { v: 300, q: 1 }, { v: 0, q: 0 }, { v: 1800, q: 3 }]);
    expect(antes.fluxo).toEqual([expect.stringMatching(/1\.800,00/), expect.stringMatching(/1\.000,00/), expect.stringMatching(/500,00/), expect.stringMatching(/300,00/), expect.stringMatching(/0,00/)]);

    // Perda dos 300 que faltam da m2: sai do a receber/vencido; recebido e faturado iguais; card Perdas 300; Total igual
    expect((await marcar("m2", "Fechou as portas")).status).toBe(200);
    const perda = await foto();
    expect(perda.resumo).toEqual([1000, 500, 0]);
    expect(perda.dash).toEqual([500, 1000, 0, 1800]);
    expect(perda.resumo[0] + perda.resumo[1] + 300).toBe(antes.resumo[0] + antes.resumo[1]);
    expect([perda.cards.VENCIDO, perda.cards.RECEBIDO, perda.cards.PERDA, perda.cards.TOTAL]).toEqual([{ v: 0, q: 0 }, { v: 300, q: 1 }, { v: 300, q: 1 }, antes.cards.TOTAL]);
    // Fluxo: o previsto perde os 300; "Perdas do mês" 300; recebido igual; atrasado zera
    expect(perda.fluxo).toEqual([expect.stringMatching(/1\.500,00/), expect.stringMatching(/1\.000,00/), expect.stringMatching(/500,00/), expect.stringMatching(/^R\$ 0,00$/), expect.stringMatching(/300,00/)]);
    // Filtro do status "Perda" na lista
    const soPerda: any = await PaginaCR({ searchParams: Promise.resolve({ status: "PERDA", periodo: "todos" }) });
    expect(soPerda.props.contas.map((x: any) => [x.id, x.valorPerda, x.valorRecebido])).toEqual([["m2", 300, 200]]);

    // Estornar a baixa antiga (300): sai do recebido exatamente 300 e volta ao a receber
    expect((await estornar("m3", { motivo: "Não foi pago" })).status).toBe(200);
    const est = await foto();
    expect(est.resumo).toEqual([1300, 200, 300]);
    expect(est.dash).toEqual([200, 1300, 300, 1800]);

    // Reverter a perda (voltar a cobrar): o a receber volta aos 300
    expect((await reverter("m2", { modo: "REABRIR" })).status).toBe(200);
    await prisma.contaReceber.update({ where: { id: "m3" }, data: { status: "RECEBIDO", dataRecebimento: dia("2026-11-03") } }); // a baixa antiga de volta, à mão (como antes)
    const volta = await foto();
    expect(volta.resumo).toEqual(antes.resumo);
    expect(volta.dash).toEqual(antes.dash);
    expect(volta.cards).toEqual(antes.cards);
    expect(volta.fluxo).toEqual(antes.fluxo);
    logar();
  });

  it("Relatório 'Perdas por período e cliente' + alerta de 12 meses no cliente (status financeiro)", async () => {
    logar("e2");
    await prisma.cliente.create({ data: { id: "c3", empresaId: "e2", nome: "Mercado", cpfCnpj: "22333444000155" } });
    await prisma.contaReceber.createMany({ data: [
      { id: "p1", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0101", descricao: "P1", valor: 700, status: "A_RECEBER", dataVencimento: dia("2026-10-05") },
      { id: "p2", empresaId: "e2", clienteId: "c3", numero: "CR-2026-0102", descricao: "P2", valor: 900, status: "A_RECEBER", dataVencimento: dia("2026-10-06") },
      // Perda antiga (mais de 12 meses): fora do alerta e fora de novembro
      { id: "p3", empresaId: "e2", clienteId: "c2", numero: "CR-2025-0103", descricao: "P3", valor: 50, status: "PERDA", valorPerda: 50, perdaEm: dia("2025-10-01"), motivoPerda: "Antiga" },
    ] });
    await receber("p1", { valor: 100, data: "2026-10-20" });
    expect((await marcar("p1", "Faliu")).status).toBe(200);
    expect((await marcar("p2", "Sumiu")).status).toBe(200);

    const { relatorioPerdas } = await import("@/lib/financeiro/perda-estorno-server");
    const nov = await relatorioPerdas("e2", { gte: new Date("2026-11-01T03:00:00Z"), lt: new Date("2026-12-01T03:00:00Z") });
    expect(nov.total).toEqual({ valor: 1500, qtd: 2, clientes: 2 });
    expect(nov.clientes.map((c) => [c.nome, c.qtd, c.valor])).toEqual([["Mercado", 1, 900], ["Padaria", 1, 600]]);
    expect(nov.linhas.map((l) => [l.numero, l.cliente, l.valor, l.recebido, l.valorPerda, l.motivo, l.por])).toEqual([
      ["CR-2026-0101", "Padaria", 700, 100, 600, "Faliu", "Beto"], ["CR-2026-0102", "Mercado", 900, 0, 900, "Sumiu", "Beto"],
    ]);
    // A tela do relatório (servidor): mês atual por padrão; todo o período inclui a antiga
    const { default: Perdas } = await import("@/app/(dashboard)/financeiro/perdas/page");
    const tela: any = await Perdas({ searchParams: Promise.resolve({}) });
    expect([tela.props.periodo.tipo, tela.props.total]).toEqual(["mes", { valor: 1500, qtd: 2, clientes: 2 }]);
    const todos: any = await Perdas({ searchParams: Promise.resolve({ periodo: "todos" }) });
    expect(todos.props.total.valor).toBe(1550);
    // Quem não tem Contas a Receber não abre o relatório
    sessao.atual = { user: { ...sessao.atual.user, permissoes: { ...permissoesTotais(), financeiro: { visualizar: true } } } };
    await expect(Perdas({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect /sem-permissao");
    logar("e2");

    // Alerta no cadastro / antes de atender: só os últimos 12 meses
    const st = await chamar("clientes/[id]/status-financeiro", "GET", { id: "c2" });
    expect(st.status).toBe(200);
    expect(st.json.perdas12m).toEqual({ qtd: 1, valor: 600, ultimaEm: AGORA.toISOString() });
    expect((await chamar("clientes/[id]/status-financeiro", "GET", { id: "c3" })).json.perdas12m).toMatchObject({ qtd: 1, valor: 900 });
    // Cliente de outra empresa: não acha
    logar();
    expect((await chamar("clientes/[id]/status-financeiro", "GET", { id: "c2" })).status).toBe(404);
    const limpo = (await chamar("clientes/[id]/status-financeiro", "GET", { id: "c1" })).json.perdas12m;
    expect(limpo.qtd).toBeGreaterThan(0); // c1 tem perdas dos testes acima
  });
});
