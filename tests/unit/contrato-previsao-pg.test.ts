/**
 * Contrato recorrente — PR1 (arrumar a base). Rotas reais, Prisma real, PostgreSQL real (schema descartável).
 * Prova:
 *  - editar o contrato (valor, dia, vigência) SINCRONIZA as previsões ainda abertas: valor/vencimento novos
 *    da competência corrente em diante, com evento "Editada" de → para; fora da vigência → canceladas com
 *    motivo + evento; o que já virou cobrança (medição, boleto) e o mês passado aberto ficam como estão;
 *  - estender a vigência de novo REVIVE as previsões que o contrato cancelou (evento "Voltou a ser previsão");
 *    a previsão que a PESSOA cancelou continua cancelada;
 *  - EXCLUIR (DELETE) encerra o contrato E limpa a receita fantasma (previsões + OS futuras), com histórico;
 *  - encerrar por status grava data, motivo e evento na linha do tempo (não escreve mais na observação);
 *  - o "Gerar medições do mês" respeita a vigência/competência (CO4);
 *  - MESMO NÚMERO: editar o que não é cobrança não muda nenhum número; valor/vigência mudam exatamente o
 *    esperado; voltar ao contrato original devolve os números idênticos.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/contrato-previsao-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_ctprev_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const AGORA = new Date("2026-11-15T15:00:00.000Z");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarBoleto: vi.fn(async () => {}), enviarMedicao: vi.fn(async () => {}), enviarConfirmacaoPagamento: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));

const logar = (empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Contrato recorrente PR1 — previsões acompanham o contrato (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;

  const corpo = (dados: Record<string, unknown> = {}) => ({
    clienteId: "c1", numero: `CT-P${String(++seq).padStart(2, "0")}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
    valorMensal: 1000, dataInicio: "2026-09-01", dataFim: "2027-04-30", diaFaturamento: 10, ...dados,
  });
  const criar = async (dados: Record<string, unknown> = {}) => {
    const b = corpo(dados);
    const r = await chamar("contratos", "POST", {}, b);
    expect(r.status).toBe(201);
    return { id: r.json.id as string, body: b };
  };
  const editar = (ct: { id: string; body: any }, mudar: Record<string, unknown>) => {
    ct.body = { ...ct.body, ...mudar };
    return chamar("contratos/[id]", "PUT", { id: ct.id }, ct.body);
  };
  const previsoes = (contratoId: string) =>
    prisma.contaReceber.findMany({ where: { contratoId }, orderBy: [{ refAno: "asc" }, { refMes: "asc" }] });
  const daCompetencia = async (contratoId: string, ano: number, mes: number) =>
    prisma.contaReceber.findFirst({ where: { contratoId, refAno: ano, refMes: mes } });
  const eventos = (contaReceberId: string) =>
    prisma.contaReceberEvento.findMany({ where: { contaReceberId }, orderBy: { criadoEm: "asc" } });
  const ymd = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
  const sp = (t: string) => t.replace(/ /g, " ");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uB", empresaId: "e2", nome: "Bia", email: "bia@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11", diaFaturamento: 10 },
      { id: "c3", empresaId: "e1", nome: "Escola", cpfCnpj: "33.333.333/0001-33", diaFaturamento: 10 },
      { id: "c2", empresaId: "e2", nome: "Padaria", cpfCnpj: "22.222.222/0001-22", diaFaturamento: 10 },
    ] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    logar();
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("valor novo: as abertas da competência corrente em diante acompanham, com evento de → para; medição, boleto e mês passado ficam", async () => {
    const ct = await criar();
    const nasc = await previsoes(ct.id);
    // Setembro e outubro já passaram (não nascem): nov/26 a abr/27
    expect(nasc.map((c: any) => `${c.refMes}/${c.refAno}`)).toEqual(["11/2026", "12/2026", "1/2027", "2/2027", "3/2027", "4/2027"]);
    // Outubro ainda aberto (mês passado não faturado), novembro já na medição, dezembro com boleto
    const out = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", contratoId: ct.id, refAno: 2026, refMes: 10, numero: `${ct.body.numero}/202610`,
      descricao: "Out", valor: 1000, status: "PREVISTO", dataVencimento: new Date("2026-10-10T00:00:00Z"),
    } });
    expect((await chamar("medicoes/gerar-mes", "POST", {}, { mes: 11, ano: 2026 })).status).toBe(200);
    const nov = await daCompetencia(ct.id, 2026, 11);
    expect(nov.medicaoId).toBeTruthy();
    const dez = await daCompetencia(ct.id, 2026, 12);
    await prisma.contaReceber.update({ where: { id: dez.id }, data: { boletoStatus: "EMITIDO" } });

    // Fevereiro com vencimento combinado à mão: mudar só o valor não mexe nele
    const fev = await daCompetencia(ct.id, 2027, 2);
    expect((await chamar("contas-receber/[id]", "PUT", { id: fev.id }, { dataVencimento: "2027-02-25" })).status).toBe(200);
    const r = await editar(ct, { valorMensal: 1200 });
    expect(ymd((await daCompetencia(ct.id, 2027, 2)).dataVencimento)).toBe("2027-02-25");
    expect(r.status).toBe(200);
    const depois = await previsoes(ct.id);
    expect(depois.map((c: any) => [`${c.refMes}/${c.refAno}`, Number(c.valor), c.status])).toEqual([
      ["10/2026", 1000, "PREVISTO"], ["11/2026", 1000, "PREVISTO"], ["12/2026", 1000, "PREVISTO"],
      ["1/2027", 1200, "PREVISTO"], ["2/2027", 1200, "PREVISTO"], ["3/2027", 1200, "PREVISTO"], ["4/2027", 1200, "PREVISTO"],
    ]);
    const jan = depois.find((c: any) => c.refMes === 1);
    const ev = await eventos(jan.id);
    expect(ev.map((e: any) => [e.tipo, sp(e.detalhe), e.usuarioId])).toEqual([
      ["EDITADA", `Pelo contrato: contrato ${ct.body.numero} alterado — valor R$ 1.000,00 → R$ 1.200,00.`, "uA"],
    ]);
    for (const intocada of [out.id, nov.id, dez.id]) expect(await eventos(intocada)).toEqual([]);
    // Salvar de novo sem mudar nada: nenhuma edição, nenhum evento a mais
    expect((await editar(ct, {})).status).toBe(200);
    expect(await eventos(jan.id)).toHaveLength(1);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id } })).toBe(7);
  });

  it("dia novo: só o vencimento acompanha — o valor ajustado à mão numa previsão fica", async () => {
    const ct = await criar();
    const jan = await daCompetencia(ct.id, 2027, 1);
    expect((await chamar("contas-receber/[id]", "PUT", { id: jan.id }, { valor: 900 })).status).toBe(200);
    // Mudar só a observação do contrato não mexe em nada
    expect((await editar(ct, { observacoes: "Contrato renovado por e-mail" })).status).toBe(200);
    expect(Number((await daCompetencia(ct.id, 2027, 1)).valor)).toBe(900);

    expect((await editar(ct, { diaFaturamento: 20 })).status).toBe(200);
    const ps = await previsoes(ct.id);
    expect(ps.map((c: any) => [ymd(c.dataVencimento), Number(c.valor)])).toEqual([
      ["2026-11-20", 1000], ["2026-12-20", 1000], ["2027-01-20", 900], ["2027-02-20", 1000], ["2027-03-20", 1000], ["2027-04-20", 1000],
    ]);
    const ev = (await eventos(jan.id)).filter((e: any) => e.detalhe?.startsWith("Pelo contrato"));
    expect(ev.map((e: any) => e.detalhe)).toEqual([`Pelo contrato: contrato ${ct.body.numero} alterado — vencimento 10/01/2027 → 20/01/2027.`]);
  });

  it("vigência: encurtar cancela (motivo + evento); estender revive as do contrato e cria os meses novos; a cancelada à mão fica cancelada", async () => {
    const ct = await criar();
    const fev = await daCompetencia(ct.id, 2027, 2);
    const obs = await daCompetencia(ct.id, 2027, 3);
    await prisma.contaReceber.update({ where: { id: obs.id }, data: { observacao: "Nota do financeiro" } });
    // A pessoa cancela fevereiro (isenção)
    const canc = await chamar("contas-receber/[id]", "PUT", { id: fev.id }, { status: "CANCELADO", motivoCancelamento: "Cliente isento em fevereiro" });
    expect(canc.status).toBe(200);

    expect((await editar(ct, { dataFim: "2027-01-31" })).status).toBe(200);
    const curto = await previsoes(ct.id);
    expect(curto.map((c: any) => [`${c.refMes}/${c.refAno}`, c.status])).toEqual([
      ["11/2026", "PREVISTO"], ["12/2026", "PREVISTO"], ["1/2027", "PREVISTO"], ["2/2027", "CANCELADO"], ["3/2027", "CANCELADO"], ["4/2027", "CANCELADO"],
    ]);
    const mar = curto[4];
    const motivo = `Fora da vigência do contrato ${ct.body.numero} (01/09/2026 a 31/01/2027)`;
    expect([mar.motivoCancelamento, mar.observacao, !!mar.canceladaEm]).toEqual([motivo, "Nota do financeiro", true]);
    expect((await eventos(mar.id)).map((e: any) => [e.tipo, e.detalhe, e.usuarioId])).toEqual([["CANCELADA", `Pelo contrato: ${motivo}. A previsão sai do Contas a Receber.`, "uA"]]);
    // fevereiro já estava cancelado à mão: não ganha outro cancelamento
    expect((await prisma.contaReceber.findUnique({ where: { id: fev.id } })).motivoCancelamento).toBe("Cliente isento em fevereiro");

    expect((await editar(ct, { dataFim: "2027-06-30" })).status).toBe(200);
    const longo = await previsoes(ct.id);
    expect(longo.map((c: any) => [`${c.refMes}/${c.refAno}`, c.status])).toEqual([
      ["11/2026", "PREVISTO"], ["12/2026", "PREVISTO"], ["1/2027", "PREVISTO"], ["2/2027", "CANCELADO"],
      ["3/2027", "PREVISTO"], ["4/2027", "PREVISTO"], ["5/2027", "PREVISTO"], ["6/2027", "PREVISTO"],
    ]);
    const marDepois = longo[4];
    expect([marDepois.canceladaEm, marDepois.motivoCancelamento, marDepois.observacao]).toEqual([null, null, "Nota do financeiro"]);
    expect((await eventos(mar.id)).map((e: any) => e.tipo)).toEqual(["CANCELADA", "REABERTA"]);
    expect((await eventos(mar.id))[1].detalhe).toBe(`Pelo contrato: contrato ${ct.body.numero} vale de novo nesta competência. A previsão volta.`);
    // Início mais tarde: o mês que saiu do começo é cancelado
    expect((await editar(ct, { dataInicio: "2026-12-01" })).status).toBe(200);
    expect((await daCompetencia(ct.id, 2026, 11)).status).toBe("CANCELADO");
    expect((await daCompetencia(ct.id, 2026, 12)).status).toBe("PREVISTO");
  });

  it("sem valor mensal: as abertas saem; com valor de novo, voltam", async () => {
    const ct = await criar();
    expect((await editar(ct, { valorMensal: "" })).status).toBe(200);
    const sem = await previsoes(ct.id);
    expect(sem.every((c: any) => c.status === "CANCELADO" && c.motivoCancelamento === `Contrato ${ct.body.numero} sem valor mensal`)).toBe(true);
    expect((await editar(ct, { valorMensal: 800 })).status).toBe(200);
    const com = await previsoes(ct.id);
    expect(com.map((c: any) => [c.status, Number(c.valor)])).toEqual(Array(6).fill(["PREVISTO", 800]));
  });

  it("EXCLUIR: encerra com histórico e limpa previsões abertas + OS futura intocada; o resto fica; 2ª vez não duplica", async () => {
    const ct = await criar();
    const recebida = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", contratoId: ct.id, numero: `${ct.body.numero}/PAGA`, descricao: "Mês pago", valor: 1000, status: "RECEBIDO",
    } });
    const jan = await daCompetencia(ct.id, 2027, 1);
    await prisma.contaReceber.update({ where: { id: jan.id }, data: { observacao: "Combinado com o síndico" } });
    const osFutura = await prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: "OS-P01", clienteId: "c1", contratoId: ct.id, criadoPorId: "uA", status: "AGENDADA", origem: "RECORRENTE", descricao: "Preventiva",
    } });
    await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: osFutura.id, titulo: "Preventiva", status: "AGENDADA", dataAgendada: new Date("2026-12-10T12:00:00Z") } });

    const r = await chamar("contratos/[id]", "DELETE", { id: ct.id });
    expect(r).toMatchObject({ status: 200, json: { ok: true, previsoesCanceladas: 6, osCanceladas: 1 } });
    expect((await prisma.contrato.findUnique({ where: { id: ct.id } })).status).toBe("ENCERRADO");
    const hist = await prisma.contratoHistoricoStatus.findMany({ where: { contratoId: ct.id } });
    expect(hist.map((h: any) => [h.statusAnterior, h.statusNovo, h.motivo, h.usuarioId])).toEqual([["ATIVO", "ENCERRADO", "Contrato excluído", "uA"]]);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id, status: "PREVISTO" } })).toBe(0);
    const janDepois = await prisma.contaReceber.findUnique({ where: { id: jan.id } });
    expect([janDepois.status, janDepois.motivoCancelamento, janDepois.observacao]).toEqual(["CANCELADO", `Contrato ${ct.body.numero} excluído`, "Combinado com o síndico"]);
    expect((await eventos(jan.id)).map((e: any) => e.detalhe)).toEqual([`Pelo contrato: Contrato ${ct.body.numero} excluído. A previsão sai do Contas a Receber.`]);
    expect((await prisma.contaReceber.findUnique({ where: { id: recebida.id } })).status).toBe("RECEBIDO");
    expect((await prisma.ordemServico.findUnique({ where: { id: osFutura.id } })).status).toBe("CANCELADA");

    const de_novo = await chamar("contratos/[id]", "DELETE", { id: ct.id });
    expect(de_novo).toMatchObject({ status: 200, json: { previsoesCanceladas: 0, osCanceladas: 0 } });
    expect(await prisma.contratoHistoricoStatus.count({ where: { contratoId: ct.id } })).toBe(1);
    expect(await eventos(jan.id)).toHaveLength(1);
    // Outra empresa não exclui
    logar("e2");
    expect((await chamar("contratos/[id]", "DELETE", { id: ct.id })).status).toBe(404);
    logar();
  });

  it("encerrar pelo status: data, motivo e evento (sem sujar a observação); reativar revive com evento; a cancelada à mão não volta", async () => {
    const ct = await criar();
    const [nov, dez] = await previsoes(ct.id);
    await prisma.contaReceber.update({ where: { id: nov.id }, data: { observacao: "Nota" } });
    expect((await chamar("contas-receber/[id]", "PUT", { id: dez.id }, { status: "CANCELADO", motivoCancelamento: "Cortesia de dezembro" })).status).toBe(200);

    expect((await chamar("contratos/[id]/status", "PATCH", { id: ct.id }, { status: "SUSPENSO", motivo: "Obra no prédio" })).status).toBe(200);
    const n1 = await prisma.contaReceber.findUnique({ where: { id: nov.id } });
    expect([n1.status, n1.motivoCancelamento, n1.observacao, !!n1.canceladaEm]).toEqual(["CANCELADO", "Contrato suspenso — Obra no prédio", "Nota", true]);
    expect((await eventos(nov.id)).map((e: any) => [e.tipo, e.detalhe])).toEqual([["CANCELADA", "Pelo contrato: Contrato suspenso — Obra no prédio. A previsão sai do Contas a Receber."]]);

    expect((await chamar("contratos/[id]/status", "PATCH", { id: ct.id }, { status: "ATIVO" })).status).toBe(200);
    const volta = await previsoes(ct.id);
    expect(volta.map((c: any) => [`${c.refMes}/${c.refAno}`, c.status])).toEqual([
      ["11/2026", "PREVISTO"], ["12/2026", "CANCELADO"], ["1/2027", "PREVISTO"], ["2/2027", "PREVISTO"], ["3/2027", "PREVISTO"], ["4/2027", "PREVISTO"],
    ]);
    expect(volta[1].motivoCancelamento).toBe("Cortesia de dezembro");
    expect((await eventos(nov.id)).map((e: any) => [e.tipo, e.usuarioId])).toEqual([["CANCELADA", "uA"], ["REABERTA", "uA"]]);

    // Encerramento ANTIGO (só observação, sem data): continua revivendo como sempre
    const antiga = await daCompetencia(ct.id, 2027, 4);
    await prisma.contaReceber.update({ where: { id: antiga.id }, data: { status: "CANCELADO", observacao: "Contrato deixou de estar ativo" } });
    expect((await editar(ct, {})).status).toBe(200);
    const a2 = await prisma.contaReceber.findUnique({ where: { id: antiga.id } });
    expect([a2.status, a2.observacao]).toEqual(["PREVISTO", null]);
  });

  it("gerar-mes respeita a vigência: o que começa depois e o que já terminou não geram mensalidade", async () => {
    // c3: um contrato vigente e um que só começa em dezembro; um que terminou em outubro (ainda ATIVO)
    const ok = await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c3", numero: "CT-G1", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 500, dataInicio: new Date("2026-01-01T00:00:00Z"), dataFim: new Date("2026-12-31T00:00:00Z") } });
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c3", numero: "CT-G2", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 300, dataInicio: new Date("2026-12-01T00:00:00Z") } });
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c3", numero: "CT-G3", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 200, dataInicio: new Date("2025-11-01T00:00:00Z"), dataFim: new Date("2026-11-01T00:00:00Z") } });

    const r = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 11, ano: 2026 });
    expect(r.status).toBe(200);
    expect(r.json.foraDaVigencia).toEqual(expect.arrayContaining(["CT-G2", "CT-G3"]));
    expect(r.json.foraDaVigencia).not.toContain("CT-G1");
    const med = await prisma.medicao.findFirst({ where: { clienteId: "c3", mes: 11, ano: 2026 }, include: { itens: true } });
    expect(med.itens.map((i: any) => [i.descricao, Number(i.valorTotal)])).toEqual([["Contrato CT-G1 — mensalidade", 500]]);
    expect([Number(med.valorTotal), med.contratoId]).toEqual([500, ok.id]);
    expect(await prisma.contaReceber.count({ where: { contrato: { numero: { in: ["CT-G2", "CT-G3"] } }, refMes: 11 } })).toBe(0);

    // Dezembro: o CT-G2 entra
    const r2 = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 12, ano: 2026 });
    const medDez = await prisma.medicao.findFirst({ where: { clienteId: "c3", mes: 12, ano: 2026 }, include: { itens: true } });
    expect(medDez.itens.map((i: any) => i.descricao).sort()).toEqual(["Contrato CT-G1 — mensalidade", "Contrato CT-G2 — mensalidade"]);
    expect(medDez.contratoId).toBeNull(); // dois contratos na mesma fatura
    expect(r2.json.foraDaVigencia).toContain("CT-G3");
    // Um cliente só com contrato fora da vigência não ganha medição
    await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c1", numero: "CT-G4", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 100, dataInicio: new Date("2027-03-01T00:00:00Z") } });
    const r3 = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 1, ano: 2027 });
    expect(r3.json.foraDaVigencia).toContain("CT-G4");
    const itensJan = await prisma.medicaoItem.findMany({ where: { medicao: { mes: 1, ano: 2027 } }, select: { descricao: true } });
    expect(itensJan.length).toBeGreaterThan(0);
    expect(itensJan.map((i: any) => i.descricao)).not.toContain("Contrato CT-G4 — mensalidade");
  });

  it("MESMO NÚMERO: editar o que não é cobrança não muda nada; valor/vigência mudam exatamente o esperado; voltar devolve idêntico", async () => {
    logar("e2");
    const { default: Fluxo } = await import("@/app/(dashboard)/financeiro/fluxo-caixa/page");
    const { default: PaginaCR } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    const body = { ...corpo({ clienteId: "c2", numero: "CT-MN" }), dataInicio: "2026-11-01", dataFim: "2027-04-30" };
    const r = await chamar("contratos", "POST", {}, body);
    expect(r.status).toBe(201);
    const ct = { id: r.json.id as string, body };

    const previstoDoMes = async (mes: number, ano: number) => {
      const h = renderToStaticMarkup(await Fluxo({ searchParams: Promise.resolve({ mes: String(mes), ano: String(ano) }) }));
      return sp(h.match(/data-card-fluxo="Previsto no mês"[\s\S]*?tabular-nums[^>]*>([^<]+)</)![1]).trim();
    };
    const foto = async () => {
      const meses: string[] = [];
      for (const [m, a] of [[11, 2026], [12, 2026], [1, 2027], [2, 2027], [3, 2027], [4, 2027], [5, 2027]]) meses.push(await previstoDoMes(m, a));
      const todos: any = await PaginaCR({ searchParams: Promise.resolve({ periodo: "todos" }) });
      return { meses, total: todos.props.resumo.TOTAL };
    };
    const antes = await foto();
    expect(antes.meses).toEqual(["R$ 1.000,00", "R$ 1.000,00", "R$ 1.000,00", "R$ 1.000,00", "R$ 1.000,00", "R$ 1.000,00", "R$ 0,00"]);

    // Só a observação: nenhum número muda
    expect((await editar(ct, { observacoes: "Trocar o filtro em março" })).status).toBe(200);
    expect(await foto()).toEqual(antes);

    // Valor +200: cada mês aberto sobe 200, o total sobe 6 × 200
    expect((await editar(ct, { valorMensal: 1200 })).status).toBe(200);
    const mais = await foto();
    expect(mais.meses).toEqual(["R$ 1.200,00", "R$ 1.200,00", "R$ 1.200,00", "R$ 1.200,00", "R$ 1.200,00", "R$ 1.200,00", "R$ 0,00"]);
    expect(mais.total.v).toBe(antes.total.v + 6 * 200);

    // Vigência 2 meses menor: março e abril saem (cada um −1.200), o resto fica
    expect((await editar(ct, { dataFim: "2027-02-28" })).status).toBe(200);
    const curto = await foto();
    expect(curto.meses).toEqual(["R$ 1.200,00", "R$ 1.200,00", "R$ 1.200,00", "R$ 1.200,00", "R$ 0,00", "R$ 0,00", "R$ 0,00"]);
    expect(curto.total).toEqual({ v: mais.total.v - 2 * 1200, q: mais.total.q - 2 });

    // De volta ao contrato original: os números voltam idênticos
    expect((await editar(ct, { valorMensal: 1000, dataFim: "2027-04-30" })).status).toBe(200);
    expect(await foto()).toEqual(antes);
    logar();
  });
});
