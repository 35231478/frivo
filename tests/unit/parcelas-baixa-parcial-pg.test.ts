/**
 * Contas a Receber — parcelas + baixa parcial, PostgreSQL real e rotas reais:
 *  - Parcelar: a conta vira o LANÇAMENTO (PARCELADO) e nascem as parcelas (cobranças com número,
 *    vencimento, valor, boleto próprios); lista e cards só veem as parcelas (a vencida conta em Vencidos);
 *  - baixa parcial: o saldo continua aberto, cada baixa fica gravada; o resto quita; recusas certas;
 *  - a baixa total antiga (PUT RECEBIDO), o boleto (pelo saldo), o webhook do Inter e o pagamento da
 *    medição passam pelo MESMO caminho de recebimento;
 *  - Faturar em N×: parcelas previstas → liberadas pela NF; retenções reajustam na proporção; dinheiro
 *    mexido trava o reajuste e o cancelamento da medição; a medição só fica PAGA com a última parcela;
 *  - MESMO NÚMERO: os dados de antes dão os mesmos números no painel/dashboard; parcelar e receber em
 *    parte não criam nem somem dinheiro (a receber + recebido do mês fica igual).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/parcelas-baixa-parcial-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_parcelas_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
const inter = vi.hoisted(() => ({ emitidos: [] as { valorNominal: number; seuNumero: string }[], situacao: "RECEBIDO", n: 0 }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}), enviarBoleto: vi.fn(async () => {}) }));
vi.mock("@/lib/inter-api", () => ({
  carregarConfigInter: vi.fn(async () => ({ ativo: true, config: {} })),
  emitirBoletoInter: vi.fn(async (_e: string, d: { valorNominal: number; seuNumero: string }) => {
    inter.emitidos.push({ valorNominal: d.valorNominal, seuNumero: d.seuNumero });
    inter.n++;
    return { codigoSolicitacao: `cs-${inter.n}`, nossoNumero: `nn-${inter.n}`, codigoBarras: "0779", linhaDigitavel: "0779 1" };
  }),
  cancelarBoletoInter: vi.fn(async () => ({})),
  consultarBoletoInter: vi.fn(async () => ({ cobranca: { situacao: inter.situacao } })),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));
const logar = (empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json().catch(() => null) : null, texto: tipo.includes("csv") ? await res.text() : null };
}

/** "Agora": 15/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-15T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const chave = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

vi.setConfig({ testTimeout: 90_000 });

describe.skipIf(!URL_PG)("Contas a Receber — parcelas + baixa parcial (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;
  const seq = () => String(++n).padStart(4, "0");

  const novaConta = async (valor: number, vencimento: string, extra: Record<string, unknown> = {}) => {
    const r = await chamar("contas-receber", "POST", {}, { clienteId: "c1", descricao: "Instalação", valor, dataVencimento: vencimento, contaBancariaId: "cb1", formaPagamento: "PIX", ...extra });
    expect(r.status).toBe(201);
    return r.json;
  };
  const conta = (id: string) => prisma.contaReceber.findUnique({ where: { id } });
  const parcelasDe = (lancamentoId: string) => prisma.contaReceber.findMany({ where: { lancamentoId }, orderBy: { parcelaNumero: "asc" } });
  const parcelar = (id: string, parcelas: { vencimento: string; valor: number }[]) => chamar("contas-receber/[id]/parcelar", "POST", { id }, { parcelas });
  const receber = (id: string, corpo: Record<string, unknown>) => chamar("contas-receber/[id]/recebimentos", "POST", { id }, corpo);
  const eventos = async (id: string) => (await prisma.contaReceberEvento.findMany({ where: { contaReceberId: id }, orderBy: { criadoEm: "asc" } })).map((e: any) => [e.tipo, e.detalhe]);
  const orcamentoAprovado = (total: number) => prisma.orcamento.create({ data: {
    empresaId: "e1", codigo: `ORC-2026-${seq()}`, nome: "Instalação VRF", clienteId: "c1", criadoPorId: "uA", status: "APROVADO", tipo: "COMUM",
    tokenPublico: `tok-${n}`, validadeEm: dia("2026-12-20"), totalGeral: total, totalServicos: total,
    servicos: { create: [{ servicoId: "sSN", descricao: "Instalação", quantidade: 1, valorUnitario: total, valorTotal: total, ordem: 0 }] },
  } });
  const webhook = (codigoSolicitacao: string) => chamar("webhooks/inter", "POST", {}, { codigoSolicitacao, situacao: "RECEBIDO", dataHoraSituacao: "2026-11-15T13:00:00.000Z" }, "http://localhost/api/webhooks/inter?token=tk-e1");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    // As travas de produção (C6/C7) e o SQL desta leva, de verdade
    for (const sql of ["2026-11-14_faturamento_travas_retencoes.sql", "2026-11-16_faturar_avulso.sql", "2026-11-18_contas_receber_parcelas.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "contas-receber", "contas-receber/[id]", "contas-receber/[id]/parcelar", "contas-receber/[id]/recebimentos", "contas-receber/[id]/boleto",
      "contas-receber/exportar", "orcamentos/[id]/faturar", "medicoes/[id]/acao", "medicoes/[id]/retencoes", "webhooks/inter",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Mesmo número", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11222333000181", diaFaturamento: 10 },
      { id: "c2", empresaId: "e2", nome: "Hospital", cpfCnpj: "11222333000181" },
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

  it("Parcelar: a conta vira o lançamento PARCELADO e nascem 3 cobranças próprias; lista e cards só veem as parcelas (a vencida conta em Vencidos, pelo saldo)", async () => {
    const c = await novaConta(1000, "2026-11-10", { categoriaId: null });
    const plano = [{ vencimento: "2026-11-10", valor: 333.34 }, { vencimento: "2026-12-10", valor: 333.33 }, { vencimento: "2027-01-10", valor: 333.33 }];
    const r = await parcelar(c.id, plano);
    expect(r.status).toBe(201);
    expect(r.json.parcelas.map((p: any) => p.numero)).toEqual([`${c.numero}/1`, `${c.numero}/2`, `${c.numero}/3`]);

    const lanc = await conta(c.id);
    expect([lanc.status, lanc.parcelaTotal, Number(lanc.valor)]).toEqual(["PARCELADO", 3, 1000]);
    const ps = await parcelasDe(c.id);
    expect(ps.map((p: any) => [p.parcelaNumero, p.parcelaTotal, chave(p.dataVencimento), Number(p.valor), p.status, p.descricao, p.contaBancariaId, p.formaPagamento, p.clienteId]))
      .toEqual([
        [1, 3, "2026-11-10", 333.34, "A_RECEBER", "Instalação — parcela 1/3", "cb1", "PIX", "c1"],
        [2, 3, "2026-12-10", 333.33, "A_RECEBER", "Instalação — parcela 2/3", "cb1", "PIX", "c1"],
        [3, 3, "2027-01-10", 333.33, "A_RECEBER", "Instalação — parcela 3/3", "cb1", "PIX", "c1"],
      ]);
    expect((await eventos(c.id)).at(-1)).toEqual(["PARCELADA", expect.stringMatching(/^R\$\s?1\.000,00 em 3 parcelas: 1\/3 R\$\s?333,34 vence 10\/11\/2026 · 2\/3 R\$\s?333,33 vence 10\/12\/2026 · 3\/3/)]);
    expect(await eventos(ps[1].id)).toEqual([["CRIADA", `Parcela 2/3 de ${c.numero}`]]);

    // A tela de verdade (servidor): só as parcelas; a 1ª (vencida) em Vencidos pelo saldo
    const { default: Pagina } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    const tela: any = await Pagina({ searchParams: Promise.resolve({ periodo: "todos", q: c.numero }) });
    expect(tela.props.contas.map((x: any) => [x.numero, x.parcelaNumero, x.parcelaTotal, x.lancamentoNumero])).toEqual([
      [`${c.numero}/1`, 1, 3, c.numero], [`${c.numero}/2`, 2, 3, c.numero], [`${c.numero}/3`, 3, 3, c.numero],
    ]);
    expect((await conta(ps[0].id)).status).toBe("ATRASADO");
    const tudo: any = await Pagina({ searchParams: Promise.resolve({ periodo: "todos" }) });
    expect(tudo.props.contas.map((x: any) => x.id)).not.toContain(c.id);
    expect(tudo.props.resumo.VENCIDO).toEqual({ v: 333.34, q: 1 });
    expect(tudo.props.resumo.TOTAL).toEqual({ v: 1000, q: 3 });

    // Recusas: de novo, parcela, soma errada
    expect(await parcelar(c.id, plano)).toMatchObject({ status: 409, json: { erro: "Esta conta já está parcelada." } });
    expect(await parcelar(ps[1].id, [{ vencimento: "2026-12-10", valor: 200 }, { vencimento: "2027-01-10", valor: 133.33 }])).toMatchObject({ status: 409, json: { erro: "Esta já é uma parcela." } });
    const outra = await novaConta(500, "2026-12-01");
    const errada = await parcelar(outra.id, [{ vencimento: "2026-12-01", valor: 250 }, { vencimento: "2027-01-01", valor: 249.99 }]);
    expect(errada.status).toBe(400);
    expect(errada.json.erro).toMatch(/^A soma das parcelas \(R\$\s?499,99\) tem que ser igual ao valor da conta \(R\$\s?500,00\)\.$/);
    expect((await conta(outra.id)).status).toBe("A_RECEBER");
    // O lançamento parcelado não se edita nem se exclui
    expect(await chamar("contas-receber/[id]", "PUT", { id: c.id }, { descricao: "x" })).toMatchObject({ status: 409, json: { erro: "Conta parcelada: edite as parcelas." } });
    expect((await chamar("contas-receber/[id]", "DELETE", { id: c.id }, {})).status).toBe(409);
    // A numeração segue: a próxima conta não tropeça no "/3" das parcelas
    const prox = await novaConta(10, "2026-12-01");
    expect(outra.numero).toMatch(/^CR-2026-\d{4}$/);
    expect(prox.numero).toMatch(/^CR-2026-\d{4}$/);
    expect(Number(prox.numero.split("-")[2])).toBe(Number(outra.numero.split("-")[2]) + 1);
  });

  it("Nova cobrança já parcelada: conta + parcelas na mesma transação; plano errado não grava nada", async () => {
    const antes = await prisma.contaReceber.count();
    const ruim = await chamar("contas-receber", "POST", {}, { clienteId: "c1", descricao: "Venda", valor: 900, parcelas: [{ vencimento: "2026-12-05", valor: 450 }, { vencimento: "2027-01-05", valor: 400 }] });
    expect(ruim.status).toBe(400);
    expect(await prisma.contaReceber.count()).toBe(antes);
    const r = await chamar("contas-receber", "POST", {}, { clienteId: "c1", descricao: "Venda", valor: 900, parcelas: [{ vencimento: "2026-12-05", valor: 450 }, { vencimento: "2027-01-05", valor: 450 }] });
    expect(r.status).toBe(201);
    expect(r.json.parcelas).toHaveLength(2);
    const lanc = await conta(r.json.id);
    expect([lanc.status, chave(lanc.dataVencimento)]).toEqual(["PARCELADO", "2026-12-05"]);
    expect((await parcelasDe(lanc.id)).map((p: any) => [chave(p.dataVencimento), Number(p.valor)])).toEqual([["2026-12-05", 450], ["2027-01-05", 450]]);
  });

  it("Baixa parcial: 400 de 1000 deixa 600 em aberto; passar do saldo e cancelar/excluir são recusados; o resto quita (RECEBIDO na data do último)", async () => {
    const c = await novaConta(1000, "2026-11-30");
    const r1 = await receber(c.id, { valor: 400, data: "2026-11-05", formaPagamento: "PIX" });
    expect(r1).toMatchObject({ status: 201, json: { quitou: false, saldo: 600, valor: 400 } });
    let x = await conta(c.id);
    expect([x.status, Number(x.valorRecebido), x.dataRecebimento]).toEqual(["A_RECEBER", 400, null]);
    const recs = await prisma.contaReceberRecebimento.findMany({ where: { contaReceberId: c.id } });
    expect(recs.map((r: any) => [Number(r.valor), chave(r.data), r.formaPagamento, r.origem, r.usuarioId, r.contaBancariaId])).toEqual([[400, "2026-11-05", "PIX", "MANUAL", "uA", "cb1"]]);
    expect((await eventos(c.id)).at(-1)).toEqual(["RECEBIMENTO_PARCIAL", expect.stringMatching(/^R\$\s?400,00 em 05\/11\/2026 · em aberto R\$\s?600,00 · PIX · Inter PJ$/)]);

    expect(await chamar("contas-receber/[id]", "PUT", { id: c.id }, { status: "CANCELADO", motivoCancelamento: "Desistiu" })).toMatchObject({ status: 409, json: { erro: "Já tem recebimento parcial: não pode ser cancelada." } });
    expect(await chamar("contas-receber/[id]", "DELETE", { id: c.id }, {})).toMatchObject({ status: 409, json: { erro: "Já tem recebimento: não pode ser excluída." } });
    expect(await chamar("contas-receber/[id]", "PUT", { id: c.id }, { valor: 800 })).toMatchObject({ status: 409, json: { erro: "Já tem recebimento: o valor não muda." } });
    const demais = await receber(c.id, { valor: 600.01, data: "2026-11-06" });
    expect(demais.status).toBe(400);
    expect(demais.json.erro).toMatch(/^O valor passa do que falta receber \(R\$\s?600,00\)\.$/);

    const r2 = await receber(c.id, { data: "2026-11-12" }); // sem valor = o que falta
    expect(r2).toMatchObject({ status: 201, json: { quitou: true, saldo: 0, valor: 600 } });
    x = await conta(c.id);
    expect([x.status, Number(x.valorRecebido), chave(x.dataRecebimento)]).toEqual(["RECEBIDO", 1000, "2026-11-12"]);
    expect((await eventos(c.id)).at(-1)).toEqual(["RECEBIDA", expect.stringMatching(/^R\$\s?600,00 em 12\/11\/2026 · quitou a conta · Inter PJ$/)]);
    expect(await receber(c.id, { data: "2026-11-13" })).toMatchObject({ status: 409, json: { erro: "Esta conta já foi recebida." } });
  });

  it("Baixa total antiga (PUT RECEBIDO) pelo mesmo caminho: recebimento gravado, evento no formato de sempre; 2º clique recusado", async () => {
    const c = await novaConta(1234.56, "2026-11-20");
    const r = await chamar("contas-receber/[id]", "PUT", { id: c.id }, { status: "RECEBIDO", dataRecebimento: "2026-11-14", formaPagamento: "TRANSFERENCIA", comentario: "ok" });
    expect(r.status).toBe(200);
    const x = await conta(c.id);
    expect([x.status, Number(x.valorRecebido), chave(x.dataRecebimento), x.formaPagamento]).toEqual(["RECEBIDO", 1234.56, "2026-11-14", "TRANSFERENCIA"]);
    expect((await prisma.contaReceberRecebimento.findMany({ where: { contaReceberId: c.id } })).map((r: any) => [Number(r.valor), r.origem, r.observacao])).toEqual([[1234.56, "MANUAL", "ok"]]);
    expect((await eventos(c.id)).at(-1)).toEqual(["RECEBIDA", expect.stringMatching(/^R\$\s?1\.234,56 em 14\/11\/2026 · Transferência · Inter PJ · ok$/)]);
    expect(await chamar("contas-receber/[id]", "PUT", { id: c.id }, { status: "RECEBIDO", dataRecebimento: "2026-11-14" })).toMatchObject({ status: 409, json: { erro: "Esta conta já foi recebida." } });
  });

  it("Boleto: sai pelo SALDO; com boleto emitido só a baixa total por fora; webhook recebe o saldo (origem BOLETO); cada parcela emite o seu; lançamento não", async () => {
    const c = await novaConta(1000, "2026-11-25");
    await receber(c.id, { valor: 300, data: "2026-11-10" });
    expect((await chamar("contas-receber/[id]/boleto", "POST", { id: c.id }, { vencimento: "2026-11-25" })).status).toBe(201);
    expect(inter.emitidos.at(-1)!.valorNominal).toBe(700);
    expect(await receber(c.id, { valor: 100, data: "2026-11-12" })).toMatchObject({ status: 409, json: { erro: "Boleto emitido: cancele o boleto para receber só uma parte." } });
    const cs = (await conta(c.id)).boletoId;
    expect((await webhook(cs)).json).toEqual({ ok: true, processados: 1 });
    const x = await conta(c.id);
    expect([x.status, x.boletoStatus, Number(x.valorRecebido)]).toEqual(["RECEBIDO", "PAGO", 1000]);
    expect((await prisma.contaReceberRecebimento.findMany({ where: { contaReceberId: c.id }, orderBy: { criadoEm: "asc" } })).map((r: any) => [Number(r.valor), r.origem, r.formaPagamento]))
      .toEqual([[300, "MANUAL", null], [700, "BOLETO", "BOLETO"]]);
    expect((await webhook(cs)).json).toEqual({ ok: true, processados: 0 }); // repetido: nada

    const l = await novaConta(800, "2026-12-10");
    await parcelar(l.id, [{ vencimento: "2026-12-10", valor: 500 }, { vencimento: "2027-01-10", valor: 300 }]);
    expect(await chamar("contas-receber/[id]/boleto", "POST", { id: l.id }, {})).toMatchObject({ status: 400, json: { erro: "Conta parcelada: emita o boleto em cada parcela." } });
    const [p1, p2] = await parcelasDe(l.id);
    expect((await chamar("contas-receber/[id]/boleto", "POST", { id: p2.id }, {})).status).toBe(201);
    expect(inter.emitidos.at(-1)).toEqual({ valorNominal: 300, seuNumero: p2.numero.replace(/\D/g, "").slice(-15) });
    expect(inter.emitidos.at(-1)!.seuNumero).not.toBe(p1.numero.replace(/\D/g, "").slice(-15)); // cada parcela, o seu número no banco
  });

  it("Faturar em 3×: parcelas previstas → NF libera; retenções reajustam na proporção; dinheiro mexido trava reajuste e cancelamento; o pagamento da medição quita as abertas e a medição fica PAGA", async () => {
    const o = await orcamentoAprovado(3000);
    const f = await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, { parcelamento: { quantidade: 3 } });
    expect(f.status).toBe(201);
    expect(f.json.parcelas).toBe(3);
    const med = f.json.id;
    // A trava (b) continua valendo: UMA conta viva da medição (o lançamento); as parcelas não têm origem própria
    const vivas = await prisma.contaReceber.findMany({ where: { medicaoId: med, status: { not: "CANCELADO" }, excluidaEm: null } });
    expect(vivas.map((v: any) => [v.status, Number(v.valor)])).toEqual([["PARCELADO", 3000]]);
    const lanc = vivas[0];
    let ps = await parcelasDe(lanc.id);
    expect(ps.map((p: any) => [chave(p.dataVencimento), Number(p.valor), p.status, p.medicaoId])).toEqual([
      ["2026-12-10", 1000, "PREVISTO", null], ["2027-01-10", 1000, "PREVISTO", null], ["2027-02-10", 1000, "PREVISTO", null],
    ]);

    // Retenção de ISS 5% sobre a nota: 3000 → 2850; cada parcela 950 (mesma proporção)
    expect((await chamar("medicoes/[id]/retencoes", "PUT", { id: med }, { iss: 5 })).status).toBe(200);
    ps = await parcelasDe(lanc.id);
    expect(ps.map((p: any) => Number(p.valor))).toEqual([950, 950, 950]);
    expect(Number((await conta(lanc.id)).valor)).toBe(2850);
    expect((await eventos(lanc.id)).map((e: any) => e[0])).toEqual(expect.arrayContaining(["REAJUSTADA", "RETENCOES"]));

    // NF emitida: as parcelas ficam liberadas para receber
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_NF", nfNumero: "123" })).status).toBe(200);
    expect((await parcelasDe(lanc.id)).map((p: any) => p.status)).toEqual(["A_RECEBER", "A_RECEBER", "A_RECEBER"]);

    // Parte da 1ª entrou: o valor das parcelas não muda mais, e a medição não se cancela
    await receber(ps[0].id, { valor: 500, data: "2026-11-14" });
    expect(await chamar("medicoes/[id]/retencoes", "PUT", { id: med }, { iss: 2 })).toMatchObject({ status: 409, json: { erro: "Parcela com recebimento: o valor das parcelas não muda mais." } });
    const canc = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "CANCELAR" });
    expect(canc.status).toBe(409);
    expect(canc.json.erro).toContain(ps[0].numero);

    // Na lista, a parcela mostra a origem do lançamento (a fatura) — link e rótulo
    const { default: Pagina } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    const tela: any = await Pagina({ searchParams: Promise.resolve({ periodo: "todos", q: lanc.numero }) });
    expect(tela.props.contas.map((x: any) => [x.medicaoId, x.medicaoNumero, x.medicaoAvulsa, x.lancamentoNumero])).toEqual(
      Array(3).fill([med, f.json.numero, true, lanc.numero]));

    // Os vínculos (orçamento/medição) mostram as parcelas, não o lançamento
    const { contasVinculadas } = await import("@/lib/financeiro/conta-receber-server");
    expect((await contasVinculadas("e1", { medicaoId: med })).map((v) => [v.numero, v.parcelaNumero, v.valorRecebido])).toEqual([
      [`${lanc.numero}/1`, 1, 500], [`${lanc.numero}/2`, 2, 0], [`${lanc.numero}/3`, 3, 0],
    ]);

    // Pagamento registrado na medição: cada parcela recebe o que falta; medição PAGA
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_PAGAMENTO", dataPagamento: "2026-11-15", formaPagamento: "TRANSFERENCIA" })).status).toBe(200);
    ps = await parcelasDe(lanc.id);
    expect(ps.map((p: any) => [p.status, Number(p.valorRecebido)])).toEqual([["RECEBIDO", 950], ["RECEBIDO", 950], ["RECEBIDO", 950]]);
    expect((await prisma.contaReceberRecebimento.findMany({ where: { contaReceberId: ps[0].id }, orderBy: { criadoEm: "asc" } })).map((r: any) => [Number(r.valor), r.origem]))
      .toEqual([[500, "MANUAL"], [450, "MEDICAO"]]);
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).toBe("PAGO");
    expect((await conta(lanc.id)).status).toBe("PARCELADO"); // o lançamento nunca entra nas somas
  });

  it("A medição só fica PAGA com a ÚLTIMA parcela: boleto pago (webhook) quita uma, baixa à mão quita a outra", async () => {
    const o = await orcamentoAprovado(1000);
    const med = (await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, { parcelamento: { quantidade: 2, primeiroVencimento: "2026-11-20" } })).json.id;
    await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_NF", nfNumero: "124" });
    const lanc = await prisma.contaReceber.findFirst({ where: { medicaoId: med } });
    const [p1, p2] = await parcelasDe(lanc.id);
    expect([chave(p1.dataVencimento), chave(p2.dataVencimento)]).toEqual(["2026-11-20", "2026-12-20"]);
    await chamar("contas-receber/[id]/boleto", "POST", { id: p1.id }, {});
    await webhook((await conta(p1.id)).boletoId);
    expect((await conta(p1.id)).status).toBe("RECEBIDO");
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).not.toBe("PAGO");
    await receber(p2.id, { data: "2026-11-15" });
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).toBe("PAGO");
  });

  it("Fatura parcelada cancelada antes de qualquer dinheiro: parcelas e conta canceladas (com motivo); o orçamento pode ser faturado de novo", async () => {
    const o = await orcamentoAprovado(600);
    const f = await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, { parcelamento: { quantidade: 2 } });
    const lanc = await prisma.contaReceber.findFirst({ where: { medicaoId: f.json.id } });
    expect((await chamar("medicoes/[id]/acao", "POST", { id: f.json.id }, { acao: "CANCELAR" })).status).toBe(200);
    const ps = await parcelasDe(lanc.id);
    expect(ps.map((p: any) => [p.status, p.motivoCancelamento])).toEqual([["CANCELADO", `Medição ${f.json.numero} cancelada`], ["CANCELADO", `Medição ${f.json.numero} cancelada`]]);
    for (const p of ps) expect((await eventos(p.id)).at(-1)).toEqual(["CANCELADA", `Medição ${f.json.numero} cancelada`]);
    const l = await conta(lanc.id);
    expect([l.status, l.parcelaTotal]).toEqual(["CANCELADO", null]);
    const de_novo = await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, {});
    expect(de_novo.status).toBe(201);
    expect(de_novo.json.jaExistia).toBe(false);
  });

  it("Exportação: colunas novas no fim (Parcela, Recebido, Em aberto) — as de antes no mesmo lugar", async () => {
    const c = await novaConta(200, "2026-12-28", { descricao: "Exporta" });
    await receber(c.id, { valor: 50, data: "2026-11-15" });
    const r = await chamar("contas-receber/exportar", "GET", {}, undefined, "http://localhost/api/contas-receber/exportar?periodo=todos&q=Exporta");
    const linhas = r.texto!.replace(/^﻿/, "").split("\n");
    expect(linhas[0]).toBe('"Número";"Cliente";"CNPJ";"Descrição";"Categoria";"Vencimento";"Valor";"Status";"Parcela";"Recebido";"Em aberto"');
    expect(linhas[1].split(";").slice(-4)).toEqual(['"A vencer"', '""', '"50"', '"150"']);
  });

  it("MESMO NÚMERO: os dados de antes dão os mesmos números; parcelar e receber em parte não criam nem somem dinheiro", async () => {
    logar("e2");
    const fin = await import("@/lib/financeiro-server");
    const dash = await import("@/lib/dashboard/dados");
    await prisma.contaReceber.createMany({ data: [
      { id: "m1", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0001", descricao: "A", valor: 1000, status: "A_RECEBER", dataVencimento: dia("2026-11-20") },
      { id: "m2", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0002", descricao: "B", valor: 500, status: "A_RECEBER", dataVencimento: dia("2026-11-05") },
      // recebida ANTES dos recebimentos (sem linha em conta_receber_recebimentos, valor_recebido 0)
      { id: "m3", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0003", descricao: "C", valor: 300, status: "RECEBIDO", dataVencimento: dia("2026-11-03"), dataRecebimento: dia("2026-11-03") },
    ] });
    const antes = await fin.resumoFinanceiro("e2");
    const dAntes = await dash.dadosFinanceiro("e2", AGORA);
    // Fluxo de caixa (novembro): os 4 cards de contas, pelo texto da tela
    const { default: Fluxo } = await import("@/app/(dashboard)/financeiro/fluxo-caixa/page");
    const cardsFluxo = async () => {
      const h = renderToStaticMarkup(await Fluxo({ searchParams: Promise.resolve({ mes: "11", ano: "2026" }) }));
      return ["Previsto no mês", "A receber", "Recebido", "Atrasado"].map((r) => {
        const m = h.match(new RegExp(`data-card-fluxo="${r}"[\\s\\S]*?tabular-nums[^>]*>([^<]+)<`));
        return m![1].replace(/\s/g, " ");
      });
    };
    const fAntes = await cardsFluxo();
    expect(fAntes).toEqual([expect.stringMatching(/1\.800,00/), expect.stringMatching(/1\.000,00/), expect.stringMatching(/300,00/), expect.stringMatching(/500,00/)]);
    // A conta feita do jeito antigo (soma das contas): 1500 a receber no mês, 300 recebido, 500 vencido
    expect([antes.aReceberMes.contas, antes.recebidoMes.valor, antes.vencidoReceber.valor]).toEqual([1500, 300, 500]);
    expect([dAntes.recebidoMes, dAntes.aReceber.valor, dAntes.vencidos.valor, dAntes.faturadoMes]).toEqual([300, 1500, 500, 1800]);

    // Parcela a de 1000 em 2× dentro do mês e recebe 200 da vencida
    expect((await parcelar("m1", [{ vencimento: "2026-11-20", valor: 600 }, { vencimento: "2026-11-28", valor: 400 }])).status).toBe(201);
    expect((await receber("m2", { valor: 200, data: "2026-11-10" })).status).toBe(201);
    const depois = await fin.resumoFinanceiro("e2");
    const dDepois = await dash.dadosFinanceiro("e2", AGORA);
    expect([depois.aReceberMes.contas, depois.recebidoMes.valor, depois.vencidoReceber.valor]).toEqual([1300, 500, 300]);
    expect(depois.aReceberMes.contas + depois.recebidoMes.valor).toBe(antes.aReceberMes.contas + antes.recebidoMes.valor);
    expect([dDepois.recebidoMes, dDepois.aReceber.valor, dDepois.vencidos.valor, dDepois.faturadoMes]).toEqual([500, 1300, 300, 1800]);
    expect(depois.meses.at(-1)!.entradas).toBe(500);
    // Fluxo: o previsto do mês não muda; os 200 saem do atrasado e entram no recebido
    expect(await cardsFluxo()).toEqual([expect.stringMatching(/1\.800,00/), expect.stringMatching(/1\.000,00/), expect.stringMatching(/500,00/), expect.stringMatching(/300,00/)]);
    logar();
  });
});
