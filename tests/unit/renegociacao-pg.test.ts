/**
 * Contas a Receber — renegociar, PostgreSQL real e rotas reais:
 *  - permissão (Financeiro › Perdas), escolha (mesmo cliente; boleto emitido, perda, previsão, recebida,
 *    já renegociada ficam de fora), juros/multa/desconto, plano (à vista ou parcelas, a soma é o total);
 *  - a conta nova (saldo de cada + juros + multa − desconto), as originais RENEGOCIADO apontando para ela,
 *    o recebido fica onde está, rastro nas duas linhas do tempo; tudo trancado (dois pedidos ao mesmo tempo);
 *  - renegociada não recebe, não cobra, não estorna, não vira perda, não cancela; a renegociação só se
 *    desfaz (sem dinheiro mexido), e desfazer devolve tudo;
 *  - a medição de origem: não fica paga pela fatura, não cancela, não muda retenções; fica PAGA quando a
 *    renegociação é quitada — inclusive renegociação de renegociação;
 *  - MESMO NÚMERO: a receber depois = saldos + juros + multa − desconto; recebido, faturado e Total do
 *    período iguais; desfazer volta tudo ao que era.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/renegociacao-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_reneg_${process.pid}`;
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

/** Ana (e1) com tudo; Beto (e2) com tudo; Caio (e1) sem Financeiro › Perdas */
const logar = (empresaId = "e1", semPerdas = false) => {
  const permissoes = permissoesTotais();
  if (semPerdas) permissoes.financeiro.perdas = false;
  const id = semPerdas ? "uC" : empresaId === "e1" ? "uA" : "uB";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

/** "Agora": 15/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-15T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const chave = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

vi.setConfig({ testTimeout: 90_000 });

describe.skipIf(!URL_PG)("Contas a Receber — renegociar (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;
  const seq = () => String(++n).padStart(4, "0");

  const novaConta = async (valor: number, vencimento: string, extra: Record<string, unknown> = {}) => {
    const r = await chamar("contas-receber", "POST", {}, { clienteId: "c1", descricao: "Manutenção", valor, dataVencimento: vencimento, contaBancariaId: "cb1", formaPagamento: "PIX", categoriaId: "cat1", ...extra });
    expect(r.status).toBe(201);
    return r.json;
  };
  const conta = (id: string) => prisma.contaReceber.findUnique({ where: { id } });
  const receber = (id: string, corpo: Record<string, unknown>) => chamar("contas-receber/[id]/recebimentos", "POST", { id }, corpo);
  const renegociar = (corpo: Record<string, unknown>) => chamar("contas-receber/renegociar", "POST", {}, corpo);
  const desfazer = (id: string, motivo: unknown = "Cliente desistiu do acordo") => chamar("contas-receber/[id]/renegociacao/desfazer", "POST", { id }, { motivo });
  const parcelasDe = (id: string) => prisma.contaReceber.findMany({ where: { lancamentoId: id }, orderBy: { parcelaNumero: "asc" } });
  const eventos = async (id: string) => (await prisma.contaReceberEvento.findMany({ where: { contaReceberId: id }, orderBy: { criadoEm: "asc" } })).map((e: any) => [e.tipo, e.detalhe]);
  const orcamentoAprovado = (total: number) => prisma.orcamento.create({ data: {
    empresaId: "e1", codigo: `ORC-2026-${seq()}`, nome: "Instalação VRF", clienteId: "c1", criadoPorId: "uA", status: "APROVADO", tipo: "COMUM",
    tokenPublico: `tok-${n}`, validadeEm: dia("2026-12-20"), totalGeral: total, totalServicos: total,
    servicos: { create: [{ servicoId: "sSN", descricao: "Instalação", quantidade: 1, valorUnitario: total, valorTotal: total, ordem: 0 }] },
  } });
  const tres = (a: number, b: number, c: number) => [{ vencimento: "2026-12-10", valor: a }, { vencimento: "2027-01-10", valor: b }, { vencimento: "2027-02-10", valor: c }];

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    for (const sql of ["2026-11-14_faturamento_travas_retencoes.sql", "2026-11-16_faturar_avulso.sql", "2026-11-18_contas_receber_parcelas.sql", "2026-11-20_contas_receber_perda_estorno.sql", "2026-11-22_contas_receber_renegociacao.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "contas-receber", "contas-receber/[id]", "contas-receber/[id]/parcelar", "contas-receber/[id]/recebimentos", "contas-receber/[id]/boleto",
      "contas-receber/[id]/perda", "contas-receber/[id]/recebimentos/estornar", "contas-receber/renegociar", "contas-receber/[id]/renegociacao/desfazer",
      "orcamentos/[id]/faturar", "medicoes/[id]/acao", "medicoes/[id]/retencoes",
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
      { id: "cX", empresaId: "e1", nome: "Outro cliente", cpfCnpj: "33444555000166" },
      { id: "c2", empresaId: "e2", nome: "Padaria", cpfCnpj: "11222333000181" },
    ] });
    await prisma.servico.create({ data: { id: "sSN", empresaId: "e1", nome: "Instalação", codigo: "INST01", codigoLc116: "14.01" } });
    await prisma.contaBancaria.create({ data: { id: "cb1", empresaId: "e1", nome: "Inter PJ" } });
    await prisma.categoriaFinanceira.create({ data: { id: "cat1", empresaId: "e1", nome: "Manutenção" } });
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

  it("Renegociar 2 cobranças (uma recebida em parte) em 3×: só o saldo entra + juros + multa − desconto; originais RENEGOCIADO apontando para a nova; rastro nos dois sentidos", async () => {
    const a = await novaConta(1000, "2026-11-01");
    const b = await novaConta(500, "2026-11-20");
    expect((await receber(a.id, { valor: 400, data: "2026-11-05" })).status).toBe(201);
    const corpo = { contaIds: [b.id, a.id], juros: 50, multa: 20, desconto: 10, parcelas: tres(386.68, 386.66, 386.66), observacao: "Acordo por telefone" };

    // Sem Financeiro › Perdas: 403, nada muda
    logar("e1", true);
    expect((await renegociar(corpo)).status).toBe(403);
    logar();
    expect((await conta(a.id)).status).not.toBe("RENEGOCIADO");

    const r = await renegociar(corpo);
    expect(r.status).toBe(201);
    expect([r.json.saldo, r.json.total, r.json.parcelas.length]).toEqual([1100, 1160, 3]);
    const nova = await conta(r.json.id);
    expect([nova.status, Number(nova.valor), Number(nova.renegJuros), Number(nova.renegMulta), Number(nova.renegDesconto), nova.clienteId, nova.categoriaId, nova.contaBancariaId, nova.formaPagamento, nova.observacao])
      .toEqual(["PARCELADO", 1160, 50, 20, 10, "c1", "cat1", "cb1", "PIX", "Acordo por telefone"]);
    expect(nova.descricao).toBe(`Renegociação de ${a.numero} e ${b.numero}`);
    const ps = await parcelasDe(nova.id);
    expect(ps.map((p: any) => [p.numero, chave(p.dataVencimento), Number(p.valor), p.status])).toEqual([
      [`${nova.numero}/1`, "2026-12-10", 386.68, "A_RECEBER"], [`${nova.numero}/2`, "2027-01-10", 386.66, "A_RECEBER"], [`${nova.numero}/3`, "2027-02-10", 386.66, "A_RECEBER"],
    ]);
    for (const o of [a, b]) {
      const x = await conta(o.id);
      expect([x.status, x.renegociadaEmId]).toEqual(["RENEGOCIADO", nova.id]);
    }
    expect(Number((await conta(a.id)).valorRecebido)).toBe(400);
    expect((await eventos(a.id)).at(-1)).toEqual(["RENEGOCIADA", expect.stringMatching(new RegExp(`^Saldo de R\\$\\s?600,00 renegociado em ${nova.numero} · já recebido R\\$\\s?400,00 continua recebido$`))]);
    expect((await eventos(b.id)).at(-1)).toEqual(["RENEGOCIADA", expect.stringMatching(new RegExp(`^Saldo de R\\$\\s?500,00 renegociado em ${nova.numero}$`))]);
    expect((await eventos(nova.id)).map((e: any) => e[0])).toEqual(["RENEGOCIACAO", "PARCELADA"]);
    expect((await eventos(nova.id))[0][1]).toMatch(new RegExp(`^Saldo R\\$\\s?1\\.100,00 de ${a.numero} \\(R\\$\\s?600,00\\), ${b.numero} \\(R\\$\\s?500,00\\) · juros R\\$\\s?50,00 · multa R\\$\\s?20,00 · desconto R\\$\\s?10,00 · total R\\$\\s?1\\.160,00 · em 3 parcelas · Acordo por telefone$`));

    // A gaveta conta a história dos dois lados
    const det = await chamar("contas-receber/[id]", "GET", { id: ps[0].id });
    expect(det.json.renegociacao).toMatchObject({ id: nova.id, numero: nova.numero, total: 1160, saldo: 1100, juros: 50, multa: 20, desconto: 10, recebido: 0, motivoNaoDesfazer: null });
    expect(det.json.renegociacao.originais).toEqual([{ id: a.id, numero: a.numero, saldo: 600, recebido: 400 }, { id: b.id, numero: b.numero, saldo: 500, recebido: 0 }]);
    const detA = await chamar("contas-receber/[id]", "GET", { id: a.id });
    expect(detA.json.renegociadaEm).toMatchObject({ id: nova.id, numero: nova.numero });

    // Renegociada: nada de receber, cobrar, estornar, perda, cancelar, parcelar, renegociar de novo
    const rec = await receber(a.id, { valor: 10, data: "2026-11-15" });
    expect([rec.status, rec.json.erro]).toEqual([409, "Conta renegociada: receba pelas parcelas da renegociação."]);
    expect(await chamar("contas-receber/[id]/boleto", "POST", { id: b.id }, { vencimento: "2026-12-01" })).toMatchObject({ status: 400, json: { erro: "Conta renegociada: cobre pelas cobranças da renegociação." } });
    const rid = (await prisma.contaReceberRecebimento.findFirst({ where: { contaReceberId: a.id } })).id;
    expect(await chamar("contas-receber/[id]/recebimentos/estornar", "POST", { id: a.id }, { recebimentoId: rid, motivo: "Errado" })).toMatchObject({ status: 409, json: { erro: "Conta renegociada: desfaça a renegociação antes de estornar." } });
    expect(await chamar("contas-receber/[id]/perda", "POST", { id: b.id }, { motivo: "Faliu" })).toMatchObject({ status: 409, json: { erro: "Conta renegociada: marque a perda nas parcelas da renegociação." } });
    expect(await chamar("contas-receber/[id]", "PUT", { id: b.id }, { status: "CANCELADO", motivoCancelamento: "teste" })).toMatchObject({ status: 409 });
    expect(await renegociar({ ...corpo, contaIds: [b.id] })).toMatchObject({ status: 409, json: { erro: `${b.numero}: Esta conta já foi renegociada.` } });
    // A parcela da renegociação não se cancela nem se exclui: desfaz-se a renegociação
    expect((await chamar("contas-receber/[id]", "PUT", { id: ps[1].id }, { status: "CANCELADO", motivoCancelamento: "teste" })).status).toBe(409);
    expect((await chamar("contas-receber/[id]", "DELETE", { id: ps[1].id }, {})).status).toBe(409);
  });

  it("Escolha e valores: mesmo cliente, só cobrança em aberto (boleto, perda, previsão, recebida fora), encargos e plano certos — nada muda quando recusa", async () => {
    const ok = await novaConta(300, "2026-12-01");
    const outroCliente = await novaConta(200, "2026-12-01", { clienteId: "cX" });
    const comBoleto = await novaConta(150, "2026-12-01");
    expect((await chamar("contas-receber/[id]/boleto", "POST", { id: comBoleto.id }, { vencimento: "2026-12-01" })).status).toBe(201);
    const emPerda = await novaConta(120, "2026-12-01");
    await chamar("contas-receber/[id]/perda", "POST", { id: emPerda.id }, { motivo: "Sumiu" });
    const recebida = await novaConta(80, "2026-12-01");
    await receber(recebida.id, { data: "2026-11-15" });
    const prevista = await prisma.contaReceber.create({ data: { empresaId: "e1", clienteId: "c1", numero: `CR-2026-9${seq()}`, descricao: "Prevista", valor: 90, status: "PREVISTO" } });
    const vista = (valor: number) => [{ vencimento: "2026-12-20", valor }];

    expect(await renegociar({ contaIds: [ok.id, outroCliente.id], parcelas: vista(500) })).toMatchObject({ status: 409, json: { erro: "Escolha cobranças do mesmo cliente." } });
    expect(await renegociar({ contaIds: [ok.id, comBoleto.id], parcelas: vista(450) })).toMatchObject({ status: 409, json: { erro: `${comBoleto.numero}: Cancele o boleto antes: o cliente ainda consegue pagá-lo.` } });
    expect(await renegociar({ contaIds: [emPerda.id], parcelas: vista(120) })).toMatchObject({ status: 409, json: { erro: `${emPerda.numero}: Conta em perda: reverta a perda antes.` } });
    expect(await renegociar({ contaIds: [recebida.id], parcelas: vista(80) })).toMatchObject({ status: 409, json: { erro: `${recebida.numero}: Conta recebida não se renegocia.` } });
    expect(await renegociar({ contaIds: [prevista.id], parcelas: vista(90) })).toMatchObject({ status: 409, json: { erro: `${prevista.numero}: Ainda é previsão: não é cobrança.` } });
    expect((await renegociar({ contaIds: [], parcelas: vista(1) })).status).toBe(400);
    expect(await renegociar({ contaIds: [ok.id], juros: -1, parcelas: vista(299) })).toMatchObject({ status: 400, json: { erro: "Juros, multa e desconto não podem ser negativos." } });
    expect(await renegociar({ contaIds: [ok.id], desconto: 300, parcelas: vista(0.01) })).toMatchObject({ status: 400, json: { erro: "O desconto não pode zerar a renegociação." } });
    const errado = await renegociar({ contaIds: [ok.id], juros: 10, parcelas: vista(300) });
    expect(errado.status).toBe(400);
    expect(errado.json.erro).toMatch(/^O valor tem que ser o total da renegociação \(R\$\s?310,00\)\.$/);
    const somaErrada = await renegociar({ contaIds: [ok.id], parcelas: [{ vencimento: "2026-12-10", valor: 150 }, { vencimento: "2027-01-10", valor: 149 }] });
    expect(somaErrada.status).toBe(400);
    expect(somaErrada.json.erro).toMatch(/^A soma das parcelas/);
    // Outra empresa não acha a conta
    logar("e2");
    expect(await renegociar({ contaIds: [ok.id], parcelas: vista(300) })).toMatchObject({ status: 404 });
    logar();
    expect((await conta(ok.id)).status).toBe("A_RECEBER");

    // À vista: uma cobrança nova (sem lançamento), vencimento escolhido
    const r = await renegociar({ contaIds: [ok.id], juros: 9.9, parcelas: vista(309.9), formaPagamento: "BOLETO" });
    expect(r.status).toBe(201);
    const nova = await conta(r.json.id);
    expect([nova.status, Number(nova.valor), chave(nova.dataVencimento), nova.formaPagamento, nova.lancamentoId, r.json.parcelas]).toEqual(["A_RECEBER", 309.9, "2026-12-20", "BOLETO", null, []]);
    // O valor dela não se edita (vem das renegociadas); o vencimento sim
    expect((await chamar("contas-receber/[id]", "PUT", { id: nova.id }, { valor: 400 })).status).toBe(409);
    // Categoria/forma/conta bancária: vão para a nova só quando são iguais em todas
    const x1 = await novaConta(100, "2026-12-01");
    const x2 = await novaConta(50, "2026-12-01", { categoriaId: null, formaPagamento: "BOLETO" });
    const mix = await renegociar({ contaIds: [x1.id, x2.id], parcelas: vista(150) });
    const m = await conta(mix.json.id);
    expect([m.categoriaId, m.formaPagamento, m.contaBancariaId]).toEqual([null, null, "cb1"]);

    // A lista do cliente para escolher: as que não podem vêm com o porquê
    const lista = (await chamar("contas-receber/renegociar", "GET", {}, undefined, "http://localhost/api/contas-receber/renegociar?clienteId=c1")).json;
    const por = (id: string) => lista.find((x: any) => x.id === id);
    expect(por(comBoleto.id).motivo).toBe("Cancele o boleto antes: o cliente ainda consegue pagá-lo.");
    expect(por(emPerda.id).motivo).toBe("Conta em perda: reverta a perda antes.");
    expect(por(nova.id)).toMatchObject({ motivo: null, saldo: 309.9 });
    expect(por(ok.id)).toBeUndefined(); // renegociada não aparece mais para escolher
  });

  it("Dois pedidos ao mesmo tempo com a mesma cobrança: um renegocia, o outro é recusado (não renegocia duas vezes)", async () => {
    const c = await novaConta(700, "2026-12-01");
    const corpo = { contaIds: [c.id], parcelas: [{ vencimento: "2026-12-30", valor: 700 }] };
    const rs = await Promise.all([renegociar(corpo), renegociar(corpo)]);
    expect(rs.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await prisma.contaReceber.count({ where: { renegociadas: { some: { id: c.id } } } })).toBe(1);
  });

  it("Desfazer: motivo e permissão; com dinheiro mexido não; desfeita, a nova é cancelada e as originais voltam a receber", async () => {
    const a = await novaConta(600, "2026-11-01");
    const b = await novaConta(400, "2026-12-15");
    const r = await renegociar({ contaIds: [a.id, b.id], parcelas: [{ vencimento: "2026-12-10", valor: 500 }, { vencimento: "2027-01-10", valor: 500 }] });
    expect(r.status).toBe(201);
    const [p1, p2] = await parcelasDe(r.json.id);

    logar("e1", true);
    expect((await desfazer(p1.id)).status).toBe(403);
    logar();
    expect(await desfazer(p1.id, "x")).toMatchObject({ status: 400, json: { erro: "Informe o motivo." } });
    expect(await desfazer(a.id)).toMatchObject({ status: 409, json: { erro: "Esta conta não é uma renegociação." } });

    // Entrou dinheiro numa parcela: não desfaz
    await receber(p2.id, { valor: 100, data: "2026-11-15" });
    expect(await desfazer(p1.id)).toMatchObject({ status: 409, json: { erro: `Já entrou dinheiro em ${p2.numero}: não dá para desfazer.` } });
    const rec = (await prisma.contaReceberRecebimento.findFirst({ where: { contaReceberId: p2.id } })).id;
    expect((await chamar("contas-receber/[id]/recebimentos/estornar", "POST", { id: p2.id }, { recebimentoId: rec, motivo: "Lançado errado" })).status).toBe(200);

    // Sem dinheiro: desfaz (de qualquer parcela)
    const d = await desfazer(p2.id, "Cliente desistiu do acordo");
    expect(d).toMatchObject({ status: 200, json: { numero: r.json.numero, originais: [a.numero, b.numero] } });
    const lanc = await conta(r.json.id);
    expect([lanc.status, lanc.motivoCancelamento]).toEqual(["CANCELADO", "Renegociação desfeita: Cliente desistiu do acordo"]);
    expect((await parcelasDe(r.json.id)).map((x: any) => x.status)).toEqual(["CANCELADO", "CANCELADO"]);
    for (const o of [a, b]) {
      const x = await conta(o.id);
      expect([x.status, x.renegociadaEmId]).toEqual(["A_RECEBER", null]);
      expect((await eventos(o.id)).at(-1)).toEqual(["RENEGOCIACAO_DESFEITA", expect.stringMatching(new RegExp(`${r.json.numero} foi desfeita · Cliente desistiu do acordo$`))]);
    }
    expect(await desfazer(p1.id)).toMatchObject({ status: 409, json: { erro: "Esta conta não é uma renegociação." } });
    // A vencida volta a ser vencida pela regra única
    const { default: Pagina } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    await Pagina({ searchParams: Promise.resolve({ periodo: "todos" }) });
    expect((await conta(a.id)).status).toBe("ATRASADO");
    // E pode ser renegociada de novo
    expect((await renegociar({ contaIds: [a.id], parcelas: [{ vencimento: "2026-12-30", valor: 600 }] })).status).toBe(201);
  });

  it("Medição: renegociada não fica paga pela fatura, não cancela, não muda retenções; quitar a renegociação deixa a fatura PAGA", async () => {
    const o = await orcamentoAprovado(2000);
    const f = await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, {});
    expect(f.status).toBe(201);
    const med = f.json.id;
    expect((await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_NF", nfNumero: "77" })).status).toBe(200);
    const cr = await prisma.contaReceber.findFirst({ where: { medicaoId: med, status: { not: "CANCELADO" } } });
    await receber(cr.id, { valor: 500, data: "2026-11-10" });
    const r = await renegociar({ contaIds: [cr.id], juros: 30, parcelas: [{ vencimento: "2026-12-10", valor: 765 }, { vencimento: "2027-01-10", valor: 765 }] });
    expect(r.status).toBe(201);

    const pg = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_PAGAMENTO", dataPagamento: "2026-11-15" });
    expect([pg.status, pg.json.erro]).toEqual([409, `${cr.numero} foi renegociada: informe o recebimento na renegociação (${r.json.numero}). Quitada ela, a fatura fica paga.`]);
    const canc = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "CANCELAR" });
    expect(canc.status).toBe(409);
    expect(canc.json.erro).toContain(cr.numero);
    expect(await chamar("medicoes/[id]/retencoes", "PUT", { id: med }, { iss: 5 })).toMatchObject({ status: 409, json: { erro: "Conta renegociada: as retenções não mudam mais." } });

    // Recebe a 1ª: a fatura ainda não; recebe a 2ª: renegociação quitada → fatura PAGA
    const [p1, p2] = await parcelasDe(r.json.id);
    await receber(p1.id, { data: "2026-12-10" });
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).toBe("NF_EMITIDA");
    await receber(p2.id, { data: "2027-01-08", formaPagamento: "PIX" });
    const m = await prisma.medicao.findUnique({ where: { id: med } });
    expect([m.status, chave(m.dataPagamento)]).toEqual(["PAGO", "2027-01-08"]);
    // E aí a renegociação não se desfaz mais (já entrou dinheiro)
    expect((await desfazer(p1.id)).status).toBe(409);
  });

  it("Fatura em 2×: uma parcela renegociada (sem nenhum recebimento) já trava cancelar a fatura", async () => {
    const o = await orcamentoAprovado(800);
    const med = (await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, { parcelamento: { quantidade: 2 } })).json.id;
    await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_NF", nfNumero: "79" });
    const lanc = await prisma.contaReceber.findFirst({ where: { medicaoId: med, status: "PARCELADO" } });
    const [q1] = await parcelasDe(lanc.id);
    expect((await renegociar({ contaIds: [q1.id], juros: 5, parcelas: [{ vencimento: "2026-12-30", valor: 405 }] })).status).toBe(201);
    const canc = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "CANCELAR" });
    expect(canc.status).toBe(409);
    expect(canc.json.erro).toContain(q1.numero);
  });

  it("Renegociação de renegociação: a fatura só fica PAGA quando a cadeia inteira foi quitada", async () => {
    const o = await orcamentoAprovado(1000);
    const med = (await chamar("orcamentos/[id]/faturar", "POST", { id: o.id }, {})).json.id;
    await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "REGISTRAR_NF", nfNumero: "78" });
    const cr = await prisma.contaReceber.findFirst({ where: { medicaoId: med, status: { not: "CANCELADO" } } });
    const r1 = await renegociar({ contaIds: [cr.id], parcelas: [{ vencimento: "2026-12-10", valor: 500 }, { vencimento: "2027-01-10", valor: 500 }] });
    const [a1, a2] = await parcelasDe(r1.json.id);
    // Renegociada sem nenhum recebimento: mesmo assim a fatura não se cancela (o dinheiro está na renegociação)
    const canc = await chamar("medicoes/[id]/acao", "POST", { id: med }, { acao: "CANCELAR" });
    expect(canc.status).toBe(409);
    expect(canc.json.erro).toContain(cr.numero);
    // A 2ª parcela da renegociação é renegociada de novo (à vista, com juros)
    const r2 = await renegociar({ contaIds: [a2.id], juros: 25, parcelas: [{ vencimento: "2027-02-10", valor: 525 }] });
    expect(r2.status).toBe(201);
    // Desfazer a 1ª renegociação: não (uma parcela dela foi renegociada)
    expect(await desfazer(a1.id)).toMatchObject({ status: 409, json: { erro: `${a2.numero} foi renegociada de novo: desfaça aquela renegociação antes.` } });

    await receber(r2.json.id, { data: "2027-02-10" });
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).toBe("NF_EMITIDA");
    await receber(a1.id, { data: "2027-02-11" });
    expect((await prisma.medicao.findUnique({ where: { id: med } })).status).toBe("PAGO");
  });

  it("MESMO NÚMERO: a receber depois = saldos + juros + multa − desconto; recebido, faturado e Total do período iguais; desfazer volta tudo", async () => {
    logar("e2");
    const fin = await import("@/lib/financeiro-server");
    const dash = await import("@/lib/dashboard/dados");
    const { default: PaginaCR } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    const { default: Fluxo } = await import("@/app/(dashboard)/financeiro/fluxo-caixa/page");
    await prisma.contaReceber.createMany({ data: [
      { id: "m1", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0001", descricao: "A", valor: 1000, status: "ATRASADO", dataVencimento: dia("2026-11-05") },
      { id: "m2", empresaId: "e2", clienteId: "c2", numero: "CR-2026-0002", descricao: "B", valor: 500, status: "A_RECEBER", dataVencimento: dia("2026-11-20") },
    ] });
    expect((await receber("m1", { valor: 400, data: "2026-11-10" })).status).toBe(201);

    const cardsFluxo = async () => {
      const h = renderToStaticMarkup(await Fluxo({ searchParams: Promise.resolve({ mes: "11", ano: "2026" }) }));
      return ["Previsto no mês", "A receber", "Recebido", "Atrasado"].map((rot) => {
        const m = h.match(new RegExp(`data-card-fluxo="${rot}"[\\s\\S]*?tabular-nums[^>]*>([^<]+)<`));
        return m![1].replace(/\s/g, " ");
      });
    };
    const foto = async () => {
      const r = await fin.resumoFinanceiro("e2");
      const d = await dash.dadosFinanceiro("e2", AGORA);
      const todos: any = await PaginaCR({ searchParams: Promise.resolve({ periodo: "todos" }) });
      return {
        dash: { recebido: d.recebidoMes, aReceber: d.aReceber.valor, vencidos: d.vencidos.valor, faturado: d.faturadoMes },
        recebidoMes: r.recebidoMes.valor,
        total: todos.props.resumo.TOTAL,
        fluxo: await cardsFluxo(),
      };
    };
    const antes = await foto();
    expect(antes.dash).toEqual({ recebido: 400, aReceber: 1100, vencidos: 600, faturado: 1500 });
    expect(antes.total).toEqual({ v: 1500, q: 2 });
    expect(antes.fluxo).toEqual([expect.stringMatching(/1\.500,00/), expect.stringMatching(/500,00/), expect.stringMatching(/400,00/), expect.stringMatching(/600,00/)]);

    // A 1ª parcela nova vence ainda em novembro: o faturado do mês não pode contar o mesmo dinheiro de novo
    const r = await renegociar({ contaIds: ["m1", "m2"], juros: 50, multa: 20, desconto: 10, parcelas: [{ vencimento: "2026-11-30", valor: 580 }, { vencimento: "2026-12-30", valor: 580 }] });
    expect(r.status).toBe(201);
    const depois = await foto();
    // a receber = 600 + 500 + 50 + 20 − 10; vencido sai (as parcelas novas vencem depois); recebido e faturado iguais
    expect(depois.dash).toEqual({ recebido: 400, aReceber: 1160, vencidos: 0, faturado: 1500 });
    expect(depois.dash.aReceber).toBe(antes.dash.aReceber + 50 + 20 - 10);
    expect(depois.recebidoMes).toBe(antes.recebidoMes);
    // Total do período (todo): a renegociação não soma de novo
    expect(depois.total).toEqual(antes.total);
    // Fluxo de novembro: das renegociadas fica só o que entrou; a parcela nova de novembro entra (a outra, em dezembro)
    expect(depois.fluxo).toEqual([expect.stringMatching(/980,00/), expect.stringMatching(/580,00/), expect.stringMatching(/400,00/), expect.stringMatching(/^R\$ 0,00$/)]);
    const dez = renderToStaticMarkup(await Fluxo({ searchParams: Promise.resolve({ mes: "12", ano: "2026" }) }));
    expect(dez.match(/data-card-fluxo="Previsto no mês"[\s\S]*?tabular-nums[^>]*>([^<]+)</)![1]).toMatch(/580,00/);
    // A lista mostra as parcelas novas e as originais como "Renegociada"; o total do filtro não soma em dobro
    const lista: any = await PaginaCR({ searchParams: Promise.resolve({ periodo: "todos" }) });
    expect(lista.props.contas.map((c: any) => [c.numero, c.status, c.renegociacao, c.renegociadaEmNumero]).sort()).toEqual([
      ["CR-2026-0001", "RENEGOCIADO", false, r.json.numero], ["CR-2026-0002", "RENEGOCIADO", false, r.json.numero],
      [`${r.json.numero}/1`, "A_RECEBER", true, null], [`${r.json.numero}/2`, "A_RECEBER", true, null],
    ].sort());
    expect(lista.props.totalFiltrado).toBe(1160);
    const soReneg: any = await PaginaCR({ searchParams: Promise.resolve({ periodo: "todos", status: "RENEGOCIADO" }) });
    expect(soReneg.props.contas.map((c: any) => c.numero).sort()).toEqual(["CR-2026-0001", "CR-2026-0002"]);

    // Desfazer: tudo volta ao que era
    expect((await desfazer(lista.props.contas.find((c: any) => c.renegociacao).id)).status).toBe(200);
    const volta = await foto();
    expect(volta).toEqual(antes);
    logar();
  });
});
