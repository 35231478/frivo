/**
 * Contrato recorrente — PR3-A. Rotas reais, Prisma real, PostgreSQL real (schema descartável).
 * Prova:
 *  - D1: o contrato trimestral gera UMA previsão e UMA medição por período, pelo valor da cobrança, com o
 *    "Ref. dez/2026–fev/2027"; o mensal fica exatamente como antes (MESMO NÚMERO);
 *  - trocar mensal → trimestral cancela as previsões fora do passo (motivo + evento) e voltar revive;
 *  - D2: a medição de um contrato vence pelo dia do contrato (o do cliente é a reserva), também na aprovação;
 *  - a rotina: no dia de faturamento cria a medição do contrato (D3) e aprova (D4) ou manda para o cliente
 *    aprovar por e-mail (D6) e espera; idempotente; adota a medição feita à mão; e-mail que não sai = pendência;
 *  - D7: falha real do banco → 3 tentativas (1 por dia) → FALHA no sino → "Tentar de novo" retoma;
 *  - concorrência: duas rodadas + o núcleo ao mesmo tempo → uma medição só;
 *  - RBAC: chaves automáticas pedem Financeiro › Medições; "Tentar de novo" e a tela também; empresa da sessão;
 *  - cron só com o segredo.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/contrato-recorrente-pr3a-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pr3a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
const email = vi.hoisted(() => ({ resposta: { ok: true } as { ok: boolean; erro?: string }, enviados: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({
  enviarBoleto: vi.fn(async () => {}), enviarConfirmacaoPagamento: vi.fn(async () => {}),
  enviarMedicao: vi.fn(async (id: string) => { email.enviados.push(id); return email.resposta; }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));
// O sino agenda a reconciliação das NFS-e com after(), que só existe numa requisição do Next
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const ADMIN = () => ({ user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } });
const logar = (s = ADMIN()) => { sessao.atual = s; };
const usuario = (perms: Record<string, string[]>, empresaId = "e1") =>
  ({ user: { id: "uU", name: "Uli", email: "uli@x.com", empresaId, role: "OPERADOR", permissoes: montarPermissoes(perms as any), tecnicoId: null } });

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, url = "http://localhost/api/x", headers: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, {
    method: metodo, headers: { "Content-Type": "application/json", ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

vi.setConfig({ testTimeout: 90_000 });
const em = (iso: string) => vi.setSystemTime(new Date(iso));

describe.skipIf(!URL_PG)("Contrato recorrente PR3-A — periodicidade e rotina de faturamento (PostgreSQL real)", () => {
  let prisma: any;
  let rodar: (o?: { agora?: Date; empresaId?: string }) => Promise<any>;
  let nucleo: typeof import("@/lib/faturamento/medicao-contrato-server");
  let seq = 0;

  const corpo = (dados: Record<string, unknown> = {}) => ({
    clienteId: "c1", numero: `CT-R${String(++seq).padStart(2, "0")}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
    valorMensal: 1000, dataInicio: "2026-09-01", dataFim: "2027-08-31", diaFaturamento: 10, ...dados,
  });
  const criar = async (dados: Record<string, unknown> = {}) => {
    const b = corpo(dados);
    const r = await chamar("contratos", "POST", {}, b);
    expect(r.status).toBe(201);
    return { id: r.json.id as string, numero: b.numero as string, body: b as Record<string, unknown> };
  };
  const editar = (ct: { id: string; body: Record<string, unknown> }, mudar: Record<string, unknown>) => {
    ct.body = { ...ct.body, ...mudar };
    return chamar("contratos/[id]", "PUT", { id: ct.id }, ct.body);
  };
  const previsoes = (contratoId: string) => prisma.contaReceber.findMany({ where: { contratoId }, orderBy: [{ refAno: "asc" }, { refMes: "asc" }] });
  const execucao = (contratoId: string, refAno: number, refMes: number) =>
    prisma.faturamentoContratoExecucao.findUnique({ where: { contratoId_refAno_refMes: { contratoId, refAno, refMes } } });
  const medicoesDo = (contratoId: string) => prisma.medicao.findMany({ where: { contratoId }, include: { itens: true }, orderBy: { criadoEm: "asc" } });
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
    ({ rodarFaturamentoContratos: rodar } = await import("@/lib/faturamento/rotina-contratos-server"));
    nucleo = await import("@/lib/faturamento/medicao-contrato-server");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uU", empresaId: "e1", nome: "Uli", email: "uli@x.com", senha: "x", role: "OPERADOR" },
    ] });
    await prisma.cliente.createMany({ data: Array.from({ length: 13 }, (_, i) => ({
      id: `c${i + 1}`, empresaId: "e1", nome: `Cliente ${i + 1}`, cpfCnpj: `${String(i + 10).padStart(2, "0")}.111.111/0001-11`, diaFaturamento: 10,
      ...(i === 12 ? { tipoFaturamento: "FATURA_UNICA", agrupaAdicionais: true } : {}),
    })) });
    vi.useFakeTimers({ toFake: ["Date"] });
    em("2026-11-15T15:00:00.000Z");
    logar();
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("D1: trimestral = uma previsão e uma medição por período, pelo valor da cobrança; o mensal fica igual (MESMO NÚMERO)", async () => {
    const m = await criar({ clienteId: "c1" });
    const t = await criar({ clienteId: "c2", valorMensal: 900, periodicidade: "TRIMESTRAL" });

    // Mensal: os mesmos números de antes do PR3 (10 previsões de R$ 1.000, "Ref. MM/AAAA", dia 10)
    const pm = await previsoes(m.id);
    expect(pm.map((c: any) => [`${c.refMes}/${c.refAno}`, Number(c.valor), ymd(c.dataVencimento)])).toEqual([
      ["11/2026", 1000, "2026-11-10"], ["12/2026", 1000, "2026-12-10"], ["1/2027", 1000, "2027-01-10"], ["2/2027", 1000, "2027-02-10"],
      ["3/2027", 1000, "2027-03-10"], ["4/2027", 1000, "2027-04-10"], ["5/2027", 1000, "2027-05-10"], ["6/2027", 1000, "2027-06-10"],
      ["7/2027", 1000, "2027-07-10"], ["8/2027", 1000, "2027-08-10"],
    ]);
    expect(pm[0].descricao).toBe(`Contrato ${m.numero} — Ref. 11/2026`);
    // Trimestral (desde set/2026): dez, mar, jun — R$ 900 cada, sem multiplicar
    const pt = await previsoes(t.id);
    expect(pt.map((c: any) => [`${c.refMes}/${c.refAno}`, Number(c.valor), c.descricao])).toEqual([
      ["12/2026", 900, `Contrato ${t.numero} — Ref. dez/2026–fev/2027`],
      ["3/2027", 900, `Contrato ${t.numero} — Ref. mar–mai/2027`],
      ["6/2027", 900, `Contrato ${t.numero} — Ref. jun–ago/2027`],
    ]);
    // valor total do contrato: 4 cobranças na vigência (set, dez, mar, jun) — o formulário calcula; o servidor guarda o que vem

    // Novembro: só o mensal cobra; o trimestral aparece como "sem cobrança neste mês"
    const nov = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 11, ano: 2026 });
    expect(nov.status).toBe(200);
    expect([nov.json.criadas, nov.json.semCobrancaNoMes, nov.json.peloAutomatico]).toEqual([1, [t.numero], []]);
    const [medM] = await medicoesDo(m.id);
    expect([medM.descricao, Number(medM.valorTotal), medM.itens.map((i: any) => [i.descricao, Number(i.valorTotal)]), ymd(medM.dataVencimento)])
      .toEqual(["Medição mensal 11/2026", 1000, [[`Contrato ${m.numero} — mensalidade`, 1000]], "2026-11-10"]);
    expect(medM.numero).toBe("MED-2026-0001");
    // Dezembro: os dois cobram; a do trimestral descreve o período
    const dez = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 12, ano: 2026 });
    expect([dez.json.criadas, dez.json.semCobrancaNoMes]).toEqual([2, []]);
    const [medT] = await medicoesDo(t.id);
    expect([medT.descricao, Number(medT.valorTotal), medT.itens.map((i: any) => i.descricao), medT.mes, medT.ano])
      .toEqual(["Cobrança dez/2026–fev/2027", 900, [`Contrato ${t.numero} — cobrança Ref. dez/2026–fev/2027`], 12, 2026]);
    expect((await prisma.contaReceber.findFirst({ where: { contratoId: t.id, refAno: 2026, refMes: 12 } })).medicaoId).toBe(medT.id);
    // Janeiro: só o mensal de novo; gerar 2× não duplica
    expect((await chamar("medicoes/gerar-mes", "POST", {}, { mes: 1, ano: 2027 })).json.criadas).toBe(1);
    expect((await chamar("medicoes/gerar-mes", "POST", {}, { mes: 1, ano: 2027 })).json.criadas).toBe(0);
    expect(await prisma.medicao.count({ where: { contratoId: t.id } })).toBe(1);
    expect(await prisma.medicao.count({ where: { contratoId: m.id } })).toBe(3);
  });

  it("trocar mensal → trimestral cancela o que sai do passo (motivo + evento) e reescreve o Ref.; voltar a mensal revive", async () => {
    const x = await criar({ clienteId: "c3", dataInicio: "2026-11-01", dataFim: "2027-10-31" });
    expect((await previsoes(x.id))).toHaveLength(12);
    expect((await editar(x, { periodicidade: "TRIMESTRAL" })).status).toBe(200);
    const tri = await previsoes(x.id);
    expect(tri.filter((c: any) => c.status === "PREVISTO").map((c: any) => [`${c.refMes}/${c.refAno}`, c.descricao])).toEqual([
      ["11/2026", `Contrato ${x.numero} — Ref. nov/2026–jan/2027`], ["2/2027", `Contrato ${x.numero} — Ref. fev–abr/2027`],
      ["5/2027", `Contrato ${x.numero} — Ref. mai–jul/2027`], ["8/2027", `Contrato ${x.numero} — Ref. ago–out/2027`],
    ]);
    const dez = tri.find((c: any) => c.refMes === 12);
    const motivo = `Contrato ${x.numero} cobra a cada 3 meses: esta competência não tem cobrança`;
    expect([dez.status, dez.motivoCancelamento]).toEqual(["CANCELADO", motivo]);
    const ev = await prisma.contaReceberEvento.findMany({ where: { contaReceberId: dez.id } });
    expect(ev.map((e: any) => [e.tipo, e.detalhe, e.usuarioId])).toEqual([["CANCELADA", `Pelo contrato: ${motivo}. A previsão sai do Contas a Receber.`, "uA"]]);

    // Bimestral: o que o trimestral cancelou e cai no passo novo volta, já com o Ref. do período novo
    expect((await editar(x, { periodicidade: "BIMESTRAL" })).status).toBe(200);
    const bi = await previsoes(x.id);
    expect(bi.filter((c: any) => c.status === "PREVISTO").map((c: any) => [`${c.refMes}/${c.refAno}`, c.descricao])).toEqual([
      ["11/2026", `Contrato ${x.numero} — Ref. nov–dez/2026`], ["1/2027", `Contrato ${x.numero} — Ref. jan–fev/2027`],
      ["3/2027", `Contrato ${x.numero} — Ref. mar–abr/2027`], ["5/2027", `Contrato ${x.numero} — Ref. mai–jun/2027`],
      ["7/2027", `Contrato ${x.numero} — Ref. jul–ago/2027`], ["9/2027", `Contrato ${x.numero} — Ref. set–out/2027`],
    ]);
    expect((await editar(x, { periodicidade: "MENSAL" })).status).toBe(200);
    const mens = await previsoes(x.id);
    expect(mens.map((c: any) => [c.status, c.descricao])).toEqual(mens.map((c: any) => ["PREVISTO", `Contrato ${x.numero} — Ref. ${String(c.refMes).padStart(2, "0")}/${c.refAno}`]));
    expect(mens).toHaveLength(12);
    expect((await prisma.contaReceberEvento.findMany({ where: { contaReceberId: dez.id }, orderBy: { criadoEm: "asc" } })).map((e: any) => e.tipo)).toEqual(["CANCELADA", "REABERTA"]);
    // Uma previsão ajustada à mão não tem a descrição reescrita por uma edição que não mexe no período
    const jan = mens.find((c: any) => c.refMes === 1);
    await prisma.contaReceber.update({ where: { id: jan.id }, data: { descricao: "Combinado com o cliente" } });
    expect((await editar(x, { observacoes: "nada de cobrança" })).status).toBe(200);
    expect((await prisma.contaReceber.findUnique({ where: { id: jan.id } })).descricao).toBe("Combinado com o cliente");
  });

  it("D2: a medição de um contrato vence pelo dia do contrato (o do cliente é a reserva), também ao aprovar", async () => {
    const y = await criar({ clienteId: "c4", diaFaturamento: 20 });
    const z = await criar({ clienteId: "c5", diaFaturamento: null });
    expect((await chamar("medicoes/gerar-mes", "POST", {}, { mes: 11, ano: 2026 })).status).toBe(200);
    const [my] = await medicoesDo(y.id);
    const [mz] = await medicoesDo(z.id);
    expect([ymd(my.dataVencimento), ymd(mz.dataVencimento)]).toEqual(["2026-11-20", "2026-11-10"]);
    expect((await chamar("medicoes/[id]/acao", "POST", { id: my.id }, { acao: "ENVIAR" })).status).toBe(200);
    const ap = await chamar("medicoes/[id]/acao", "POST", { id: my.id }, { acao: "APROVAR_MANUAL" });
    expect([ap.status, ap.json.status]).toEqual([200, "PC_RECEBIDO"]);
    const depois = await prisma.medicao.findUnique({ where: { id: my.id } });
    expect(ymd(depois.dataVencimento)).toBe("2026-11-20");
    const conta = await prisma.contaReceber.findFirst({ where: { medicaoId: my.id, status: { not: "CANCELADO" } } });
    expect([ymd(conta.dataVencimento), Number(conta.valor)]).toEqual(["2026-11-20", 1000]);
    // O 2º "Aprovar" não passa (já não está aguardando)
    expect((await chamar("medicoes/[id]/acao", "POST", { id: my.id }, { acao: "APROVAR_MANUAL" })).status).toBe(400);
  });

  it("rotina com aprovação automática: no dia cria a medição do contrato, aprova e conclui; rodar de novo não duplica; o botão manual deixa para a rotina", async () => {
    const a = await criar({ clienteId: "c6", diaFaturamento: 20, faturamentoAutomatico: true, aprovacaoAutomatica: true });
    em("2026-11-19T12:00:00.000Z");
    const antes = await rodar();
    expect([antes.novas, await prisma.faturamentoContratoExecucao.count({ where: { contratoId: a.id } })]).toEqual([0, 0]);
    // O botão manual, antes do dia: o contrato automático é da rotina, não entra
    const cedo = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 11, ano: 2026 });
    expect(cedo.json.peloAutomatico).toContain(a.numero);
    expect(await prisma.medicao.count({ where: { contratoId: a.id } })).toBe(0);

    em("2026-11-20T11:23:00.000Z");
    const r = await rodar();
    expect(r.novas).toBe(1);
    const ex = await execucao(a.id, 2026, 11);
    expect([ex.etapa, ex.situacao, ex.tentativas, ex.erro, !!ex.concluidaEm]).toEqual(["CONCLUIDA", "CONCLUIDA", 0, null, true]);
    const meds = await medicoesDo(a.id);
    expect(meds).toHaveLength(1);
    expect([meds[0].id, meds[0].status, meds[0].tipo, meds[0].contratoId, ymd(meds[0].dataVencimento)]).toEqual([ex.medicaoId, "PC_RECEBIDO", "MENSAL_FIXO", a.id, "2026-11-20"]);
    const conta = await prisma.contaReceber.findFirst({ where: { contratoId: a.id, refAno: 2026, refMes: 11 } });
    expect([conta.medicaoId, Number(conta.valor)]).toEqual([meds[0].id, 1000]);

    expect((await rodar()).novas).toBe(0);
    em("2026-11-25T11:23:00.000Z");
    expect((await rodar()).novas).toBe(0);
    const manual = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 11, ano: 2026 });
    expect(manual.json.peloAutomatico).toContain(a.numero);
    expect(await prisma.medicao.count({ where: { contratoId: a.id } })).toBe(1);

    // A tela mostra a linha concluída com a medição
    const tela = await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos?ano=2026&mes=11");
    const linha = tela.json.linhas.find((l: any) => l.contratoId === a.id);
    expect([linha.execucao.situacao, linha.execucao.medicao.numero, linha.valor, linha.frequencia]).toEqual(["CONCLUIDA", meds[0].numero, 1000, "por mês"]);
    expect(tela.json.resumo.concluidas.q).toBeGreaterThanOrEqual(1);
  });

  it("aprovação do cliente: manda por e-mail e espera; o cliente aprova pelo link; a rodada seguinte conclui. E-mail que não sai vira pendência no sino; medição cancelada encerra", async () => {
    const b = await criar({ clienteId: "c7", diaFaturamento: 20, faturamentoAutomatico: true });
    const c = await criar({ clienteId: "c8", diaFaturamento: 20, faturamentoAutomatico: true });
    email.resposta = { ok: true };
    em("2026-11-26T11:23:00.000Z");
    // c: o e-mail não sai
    const original = email.resposta;
    let chamadas = 0;
    const { enviarMedicao } = await import("@/lib/email");
    (enviarMedicao as any).mockImplementation(async (id: string) => {
      email.enviados.push(id);
      const med = await prisma.medicao.findUnique({ where: { id }, select: { contratoId: true } });
      chamadas++;
      return med.contratoId === c.id ? { ok: false, erro: "Destinatário sem e-mail." } : original;
    });
    await rodar();
    const [mb] = await medicoesDo(b.id);
    const [mc] = await medicoesDo(c.id);
    expect([mb.status, mc.status]).toEqual(["AGUARDANDO_APROVACAO", "AGUARDANDO_APROVACAO"]);
    expect(email.enviados).toEqual(expect.arrayContaining([mb.id, mc.id]));
    expect(chamadas).toBe(2);
    const exb = await execucao(b.id, 2026, 11);
    const exc = await execucao(c.id, 2026, 11);
    expect([exb.etapa, exb.situacao, exb.erro]).toEqual(["APROVACAO", "AGUARDANDO", null]);
    expect([exc.etapa, exc.situacao, exc.erro]).toEqual(["APROVACAO", "PENDENCIA", "Enviada para o cliente aprovar, mas o e-mail não saiu: Destinatário sem e-mail. Mande o link pela medição."]);
    // Sino de quem tem Financeiro › Medições; quem não tem não vê
    expect((await chamar("alertas", "GET")).json.faturamentoContratos).toBe(1);
    logar(usuario({ contratos: ["visualizar"] }));
    expect((await chamar("alertas", "GET")).json.faturamentoContratos).toBe(0);
    logar();

    // Rodada seguinte: nada muda, não manda e-mail de novo
    em("2026-11-27T11:23:00.000Z");
    await rodar();
    expect(chamadas).toBe(2);
    expect((await execucao(b.id, 2026, 11)).situacao).toBe("AGUARDANDO");

    // O cliente aprova pelo link
    const ap = await chamar("publico/medicoes/[token]/aprovar", "POST", { token: mb.tokenPublico }, { nome: "Carlos Cliente", cpf: "123.456.789-09", assinaturaUrl: "data:image/png;base64,AAAAAAAAAAAAAAAA" });
    expect([ap.status, ap.json.status]).toEqual([200, "PC_RECEBIDO"]);
    const aprovada = await prisma.medicao.findUnique({ where: { id: mb.id } });
    expect([ymd(aprovada.dataVencimento), aprovada.assinadoPor, aprovada.assinadoCpf]).toEqual(["2026-11-20", "Carlos Cliente", "12345678909"]);
    em("2026-11-28T11:23:00.000Z");
    await rodar();
    expect((await execucao(b.id, 2026, 11)).situacao).toBe("CONCLUIDA");

    // Medição cancelada: a execução encerra com o motivo e sai do sino
    expect((await chamar("medicoes/[id]/acao", "POST", { id: mc.id }, { acao: "CANCELAR", motivo: "Cliente pediu para refazer" })).status).toBe(200);
    await rodar();
    const exc2 = await execucao(c.id, 2026, 11);
    expect([exc2.situacao, exc2.erro]).toEqual(["CANCELADA", `A medição ${mc.numero} foi cancelada.`]);
    expect((await chamar("alertas", "GET")).json.faturamentoContratos).toBe(0);
    (enviarMedicao as any).mockImplementation(async (id: string) => { email.enviados.push(id); return email.resposta; });
  });

  it("D7: falha real do banco → 3 tentativas (1 por dia) → FALHA no sino → Tentar de novo retoma de onde parou", async () => {
    const d = await criar({ clienteId: "c9", diaFaturamento: 5, faturamentoAutomatico: true, aprovacaoAutomatica: true });
    // Falha de verdade: o banco recusa a medição deste cliente
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "${SCHEMA}".falha_medicao() RETURNS trigger AS $$ BEGIN IF NEW.cliente_id = 'c9' THEN RAISE EXCEPTION 'banco fora do ar'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER falha_medicao BEFORE INSERT ON "${SCHEMA}".medicoes FOR EACH ROW EXECUTE FUNCTION "${SCHEMA}".falha_medicao()`);

    em("2026-12-05T11:23:00.000Z");
    await rodar();
    let ex = await execucao(d.id, 2026, 12);
    expect([ex.etapa, ex.situacao, ex.tentativas]).toEqual(["MEDICAO", "PENDENTE", 1]);
    expect(ex.erro).toContain("banco fora do ar");
    expect(ex.processandoAte).toBeNull();
    // Mesma manhã, de novo: não gasta tentativa (só no dia seguinte)
    em("2026-12-05T15:00:00.000Z");
    await rodar();
    expect((await execucao(d.id, 2026, 12)).tentativas).toBe(1);
    em("2026-12-06T11:23:00.000Z");
    await rodar();
    expect((await execucao(d.id, 2026, 12)).tentativas).toBe(2);
    em("2026-12-07T11:23:00.000Z");
    await rodar();
    ex = await execucao(d.id, 2026, 12);
    expect([ex.situacao, ex.tentativas, ex.proximaTentativa]).toEqual(["FALHA", 3, null]);
    em("2026-12-08T11:23:00.000Z");
    await rodar();
    expect((await execucao(d.id, 2026, 12)).tentativas).toBe(3); // parada: espera alguém
    expect(await prisma.medicao.count({ where: { contratoId: d.id } })).toBe(0);
    expect((await chamar("alertas", "GET")).json.faturamentoContratos).toBe(1);
    // A tela filtra o que precisa de você
    const tela = await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos?ano=2026&mes=12");
    const linha = tela.json.linhas.find((l: any) => l.contratoId === d.id);
    expect([linha.execucao.situacao, linha.execucao.tentativas]).toEqual(["FALHA", 3]);
    expect(tela.json.resumo.atencao).toEqual({ q: 1, v: 1000 });

    // RBAC: sem Financeiro › Medições não tenta; outra empresa não acha
    logar(usuario({ contratos: ["visualizar", "editar"] }));
    expect((await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id })).status).toBe(403);
    expect((await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos")).status).toBe(403);
    logar(usuario({ financeiro: ["visualizar", "medicoes"] }, "e2"));
    expect((await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id })).status).toBe(404);
    expect((await chamar("faturamento-contratos", "GET", {}, undefined, "http://localhost/api/faturamento-contratos?ano=2026&mes=12")).json.linhas).toEqual([]);
    expect((await execucao(d.id, 2026, 12)).situacao).toBe("FALHA");

    // Posse: com outra rodada segurando a execução, ninguém mais processa
    const { processarExecucao } = await import("@/lib/faturamento/rotina-contratos-server");
    await prisma.faturamentoContratoExecucao.update({ where: { id: ex.id }, data: { situacao: "PENDENTE", processandoAte: new Date("2026-12-08T11:30:00.000Z") } });
    expect(await processarExecucao(ex.id, new Date("2026-12-08T11:24:00.000Z"))).toBe("ocupada");
    expect((await execucao(d.id, 2026, 12)).tentativas).toBe(3);
    await prisma.faturamentoContratoExecucao.update({ where: { id: ex.id }, data: { situacao: "FALHA", processandoAte: null } });

    // Ainda falhando: "Tentar de novo" conta 1 tentativa nova e devolve o erro
    logar(usuario({ financeiro: ["visualizar", "medicoes"] }));
    let t = await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
    expect([t.status, t.json.execucao.situacao, t.json.execucao.tentativas]).toEqual([200, "PENDENTE", 1]);
    // O banco volta: retoma de onde parou e vai até o fim
    await prisma.$executeRawUnsafe(`DROP TRIGGER falha_medicao ON "${SCHEMA}".medicoes`);
    t = await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id });
    expect([t.status, t.json.execucao.situacao, t.json.execucao.etapa, t.json.execucao.erro]).toEqual([200, "CONCLUIDA", "CONCLUIDA", null]);
    expect(await prisma.medicao.count({ where: { contratoId: d.id } })).toBe(1);
    expect((await chamar("alertas", "GET")).json.faturamentoContratos).toBe(0);
    // Concluída não se tenta de novo
    expect((await chamar("faturamento-contratos/[id]/tentar", "POST", { id: ex.id })).status).toBe(404);
    logar();
  });

  it("concorrência: duas rodadas e o núcleo ao mesmo tempo → uma medição, uma execução", async () => {
    const e = await criar({ clienteId: "c10", diaFaturamento: 10, faturamentoAutomatico: true, aprovacaoAutomatica: true });
    em("2027-01-10T11:23:00.000Z");
    const ct = await prisma.contrato.findUnique({ where: { id: e.id }, include: { cliente: true } });
    const rs = await Promise.all([
      rodar(), rodar(),
      nucleo.gerarMedicaoDeContratos({ empresaId: "e1", cliente: ct.cliente, contratos: [ct], ano: 2027, mes: 1, porContrato: true }),
      nucleo.gerarMedicaoDeContratos({ empresaId: "e1", cliente: ct.cliente, contratos: [ct], ano: 2027, mes: 1, porContrato: true }),
    ]);
    await rodar(); // se a rodada perdeu a corrida para o núcleo, esta adota a medição
    expect(await prisma.medicao.count({ where: { contratoId: e.id, mes: 1, ano: 2027 } })).toBe(1);
    expect(await prisma.faturamentoContratoExecucao.count({ where: { contratoId: e.id } })).toBe(1);
    const ex = await execucao(e.id, 2027, 1);
    const [med] = await medicoesDo(e.id);
    expect([ex.situacao, ex.medicaoId, med.status]).toEqual(["CONCLUIDA", med.id, "PC_RECEBIDO"]);
    expect(await prisma.contaReceber.count({ where: { medicaoId: med.id, status: { not: "CANCELADO" } } })).toBe(1);
    const status = rs.slice(2).map((r: any) => r.status).sort();
    expect(status.filter((s: string) => s === "criada").length).toBeLessThanOrEqual(1);
    // Números sem buraco nem repetição no ano
    const nums = (await prisma.medicao.findMany({ where: { empresaId: "e1", ano: 2027 }, select: { numero: true } })).map((m: any) => m.numero);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("adota a medição feita à mão só deste contrato; a consolidada com outros contratos fica cancelada com o motivo", async () => {
    em("2027-02-15T15:00:00.000Z");
    const f = await criar({ clienteId: "c11", diaFaturamento: 10 });
    const g = await criar({ clienteId: "c12", diaFaturamento: 10 });
    const h = await criar({ clienteId: "c12", diaFaturamento: 10, valorMensal: 500 });
    expect((await chamar("medicoes/gerar-mes", "POST", {}, { mes: 2, ano: 2027 })).status).toBe(200);
    const [mf] = await medicoesDo(f.id);
    const consolidada = await prisma.medicao.findFirst({ where: { clienteId: "c12", mes: 2, ano: 2027 } });
    expect([consolidada.contratoId, Number(consolidada.valorTotal)]).toEqual([null, 1500]);

    expect((await editar(f, { faturamentoAutomatico: true, aprovacaoAutomatica: true })).status).toBe(200);
    expect((await editar(g, { faturamentoAutomatico: true })).status).toBe(200);
    await rodar();
    const exf = await execucao(f.id, 2027, 2);
    expect([exf.situacao, exf.medicaoId]).toEqual(["CONCLUIDA", mf.id]);
    expect((await prisma.medicao.findUnique({ where: { id: mf.id } })).status).toBe("PC_RECEBIDO");
    expect(await prisma.medicao.count({ where: { contratoId: f.id } })).toBe(1);
    const exg = await execucao(g.id, 2027, 2);
    expect([exg.situacao, exg.erro]).toEqual(["CANCELADA", `Cobrado à mão na medição ${consolidada.numero}, junto com outros contratos do cliente.`]);
    expect(await prisma.medicao.count({ where: { clienteId: "c12", mes: 2, ano: 2027 } })).toBe(1);
    void h;
    // Contrato novo num cliente já cobrado só por outro contrato: o novo entra (a medição do outro segura só o outro)
    const f2 = await criar({ clienteId: "c11", dataInicio: "2027-02-01", valorMensal: 300 });
    const r2 = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 2, ano: 2027 });
    expect(r2.json.criadas).toBe(1);
    const [mf2] = await medicoesDo(f2.id);
    expect([mf2.contratoId, Number(mf2.valorTotal)]).toEqual([f2.id, 300]);
    expect(await prisma.medicao.count({ where: { contratoId: f.id } })).toBe(1);
  });

  it("D3: cliente de fatura única com contrato automático → medição só do contrato (sem os orçamentos do cliente)", async () => {
    em("2027-03-15T15:00:00.000Z");
    const u = await criar({ clienteId: "c13", diaFaturamento: 10, faturamentoAutomatico: true, aprovacaoAutomatica: true });
    await rodar();
    const [mu] = await medicoesDo(u.id);
    expect([mu.tipo, mu.contratoId, mu.descricao, Number(mu.valorTotal)]).toEqual(["MENSAL_FIXO", u.id, "Medição mensal 03/2027", 1000]);
    expect((await execucao(u.id, 2027, 3)).situacao).toBe("CONCLUIDA");
  });

  it("RBAC: ligar/desligar o automático pede Financeiro › Medições (criar e editar); o resto do contrato segue como antes", async () => {
    em("2026-11-15T15:00:00.000Z");
    logar(usuario({ contratos: ["visualizar", "criar", "editar"] }));
    const negado = await chamar("contratos", "POST", {}, corpo({ clienteId: "c1", faturamentoAutomatico: true }));
    expect([negado.status, negado.json.erro]).toEqual([403, "Ligar ou desligar o faturamento automático pede a permissão Financeiro › Medições."]);
    const ok = await criar({ clienteId: "c1" });
    expect((await editar(ok, { faturamentoAutomatico: true })).status).toBe(403);
    expect((await editar(ok, { faturamentoAutomatico: false, observacoes: "ok" })).status).toBe(200); // não mudou
    expect((await editar(ok, { aprovacaoAutomatica: true })).status).toBe(403);
    logar(usuario({ contratos: ["visualizar", "criar", "editar"], financeiro: ["visualizar", "medicoes"] }));
    expect((await editar(ok, { faturamentoAutomatico: true, aprovacaoAutomatica: true, nfseReferencia: "ANTERIOR" })).status).toBe(200);
    const salvo = await prisma.contrato.findUnique({ where: { id: ok.id } });
    expect([salvo.faturamentoAutomatico, salvo.aprovacaoAutomatica, salvo.nfseReferencia]).toEqual([true, true, "ANTERIOR"]);
    // Ausente no corpo (ex.: outra tela) não mexe nas chaves
    const { faturamentoAutomatico: _f, aprovacaoAutomatica: _a, ...semChaves } = ok.body;
    ok.body = semChaves;
    logar(usuario({ contratos: ["visualizar", "editar"] }));
    expect((await editar(ok, { observacoes: "sem chaves" })).status).toBe(200);
    expect((await prisma.contrato.findUnique({ where: { id: ok.id } })).faturamentoAutomatico).toBe(true);
    // D5 no item: referência anterior
    expect((await previsoes(ok.id))[0].descricao).toBe(`Contrato ${ok.numero} — Ref. 10/2026`);
    logar();
  });

  it("cron: só com o segredo", async () => {
    const antes = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await chamar("cron/faturar-contratos", "GET")).status).toBe(401);
    process.env.CRON_SECRET = "segredo-teste";
    expect((await chamar("cron/faturar-contratos", "GET", {}, undefined, undefined, { authorization: "Bearer errado" })).status).toBe(401);
    const r = await chamar("cron/faturar-contratos", "GET", {}, undefined, undefined, { authorization: "Bearer segredo-teste" });
    expect([r.status, r.json.ok, typeof r.json.contratos]).toEqual([200, true, "number"]);
    if (antes === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = antes;
  });
});
