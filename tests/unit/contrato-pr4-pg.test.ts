/**
 * Contrato recorrente — PR4: horizonte rolante + reajuste anual sugerido e confirmado (D8).
 * Rotas reais, Prisma real, PostgreSQL real (schema descartável). Prova:
 *  - HORIZONTE: contrato sem fim mantém ~12 meses de previsão à frente; o cron cria só o mês que entra na
 *    janela (idempotente, também com duas rodadas ao mesmo tempo); respeita a periodicidade; contrato com
 *    fim, suspenso ou sem valor não muda; contrato com mais de 10 anos continua gerando;
 *  - REAJUSTE: no aniversário (12+ meses de contrato) a sugestão aparece na lista e no sino; NADA aplica
 *    sozinho; aplicar grava o histórico (quem, quando, ano, de → para), muda o valor e leva o valor novo só
 *    às previsões abertas da competência corrente em diante (MESMO NÚMERO no resto); clique duplo/duas abas
 *    = um reajuste; valor que mudou no meio é recusado; adiar some até a data; dispensar fecha o ano;
 *    "vem chegando" não aplica antes do aniversário; índice que não é percentual fixo não sugere; RBAC.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/contrato-pr4-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pr4_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const CRON = "segredo-do-cron-de-teste";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarBoleto: vi.fn(async () => ({ ok: true })), enviarMedicao: vi.fn(async () => ({ ok: true })), enviarConfirmacaoPagamento: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const ADMIN = () => ({ user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } });
const logar = (s = ADMIN()) => { sessao.atual = s; };
const usuario = (perms: Record<string, string[]>) =>
  ({ user: { id: "uU", name: "Uli", email: "uli@x.com", empresaId: "e1", role: "OPERADOR", permissoes: montarPermissoes(perms as any), tecnicoId: null } });

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, headers: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json", ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

vi.setConfig({ testTimeout: 90_000 });
const em = (iso: string) => vi.setSystemTime(new Date(iso));

describe.skipIf(!URL_PG)("Contrato recorrente PR4 — horizonte rolante + reajuste anual (PostgreSQL real)", () => {
  let prisma: any;
  let reajuste: typeof import("@/lib/contratos/reajuste-server");
  let fin: typeof import("@/lib/financeiro-server");
  let seq = 0;

  const criar = async (dados: Record<string, unknown> = {}) => {
    const b = {
      clienteId: "c1", numero: `CT-R${String(++seq).padStart(2, "0")}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
      valorMensal: 1000, dataInicio: "2026-09-01", diaFaturamento: 10, ...dados,
    };
    const r = await chamar("contratos", "POST", {}, b);
    expect(r.status).toBe(201);
    return { id: r.json.id as string, numero: b.numero as string, body: b as Record<string, unknown> };
  };
  const previsoes = (contratoId: string) =>
    prisma.contaReceber.findMany({ where: { contratoId, status: { not: "CANCELADO" } }, orderBy: [{ refAno: "asc" }, { refMes: "asc" }] });
  const comps = async (contratoId: string) => (await previsoes(contratoId)).map((c: any) => `${String(c.refMes).padStart(2, "0")}/${c.refAno}`);
  /** "número" de um contrato: competência=valor·status, linha a linha */
  const retrato = async (contratoId: string) =>
    (await prisma.contaReceber.findMany({ where: { contratoId }, orderBy: [{ refAno: "asc" }, { refMes: "asc" }] }))
      .map((c: any) => `${c.refMes}/${c.refAno}=${Number(c.valor).toFixed(2)}·${c.status}${c.medicaoId ? "·med" : ""}${c.boletoStatus ? "·bol" : ""}`);
  const decidir = (id: string, corpo: Record<string, unknown>) => chamar("contratos/[id]/reajuste", "POST", { id }, corpo);
  const sino = async () => (await chamar("alertas", "GET")).json.reajustesContrato;
  /** Intl usa espaço inseparável depois do "R$" */
  const sp = (t: string) => t.replace(/\u00a0/g, " ");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    reajuste = await import("@/lib/contratos/reajuste-server");
    fin = await import("@/lib/financeiro-server");
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uU", empresaId: "e1", nome: "Uli", email: "uli@x.com", senha: "x", role: "OPERADOR" },
      { id: "uB", empresaId: "e2", nome: "Bia", email: "bia@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11", diaFaturamento: 10 },
      { id: "c2", empresaId: "e2", nome: "Padaria", cpfCnpj: "22.222.222/0001-22", diaFaturamento: 10 },
    ] });
    vi.useFakeTimers({ toFake: ["Date"] });
    em("2026-11-15T15:00:00.000Z");
    logar();
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  // ─────────────────────────── horizonte rolante ───────────────────────────
  it("horizonte: sem fim = 13 competências (a corrente + 12); o cron do mês seguinte cria só a que entra; rodar de novo (ou duas ao mesmo tempo) não duplica", async () => {
    em("2026-11-15T15:00:00.000Z");
    const ind = await criar();
    const comFim = await criar({ dataFim: "2027-03-31" });
    const tri = await criar({ periodicidade: "TRIMESTRAL" });
    const suspenso = await criar({ status: "SUSPENSO" });
    expect(await comps(ind.id)).toEqual(["11/2026", "12/2026", "01/2027", "02/2027", "03/2027", "04/2027", "05/2027", "06/2027", "07/2027", "08/2027", "09/2027", "10/2027", "11/2027"]);
    const fimAntes = await retrato(comFim.id);
    expect(await comps(tri.id)).toEqual(["12/2026", "03/2027", "06/2027", "09/2027"]); // a cada 3 meses, contados do início (set/26)

    // Um mês depois: o cron (rota real, com o segredo) rola a janela
    em("2026-12-05T11:00:00.000Z");
    vi.stubEnv("CRON_SECRET", CRON);
    try {
      expect((await chamar("cron/faturar-contratos", "GET")).status).toBe(401);
      const r = await chamar("cron/faturar-contratos", "GET", {}, undefined, { authorization: `Bearer ${CRON}` });
      expect(r.status).toBe(200);
      expect(r.json.horizonte.falhas).toBe(0);
      expect(r.json.horizonte.previsoes).toBeGreaterThanOrEqual(2); // dez/27 do mensal + dez/27 do trimestral
    } finally { vi.unstubAllEnvs(); }
    expect((await comps(ind.id)).slice(-2)).toEqual(["11/2027", "12/2027"]);
    expect(await comps(ind.id)).toHaveLength(14); // novembro/26 (já passado) continua; nada some
    expect(await comps(tri.id)).toEqual(["12/2026", "03/2027", "06/2027", "09/2027", "12/2027"]);
    expect(await retrato(comFim.id)).toEqual(fimAntes); // com fim: como está
    expect(await previsoes(suspenso.id)).toHaveLength(0);

    // Corrida de verdade: três rodadas ao mesmo tempo completando a mesma janela → cada mês uma vez, sem falha
    const apagadas = (await prisma.contaReceber.deleteMany({ where: { contratoId: ind.id, refAno: 2027, refMes: { gte: 6 } } })).count;
    const corrida = await Promise.all([1, 2, 3].map(() => fin.rolarHorizonteDePrevisoes({ empresaId: "e1" })));
    expect([corrida.reduce((t, x) => t + x.previsoes, 0), corrida.reduce((t, x) => t + x.falhas, 0)]).toEqual([apagadas, 0]);
    expect(await comps(ind.id)).toHaveLength(14);
    // Contrato COM fim: o cron não mexe (nem completa o que alguém tirou)
    await prisma.contaReceber.deleteMany({ where: { contratoId: comFim.id, refAno: 2027, refMes: 3 } });
    const semMarco = await retrato(comFim.id);
    await fin.rolarHorizonteDePrevisoes({ empresaId: "e1" });
    expect(await retrato(comFim.id)).toEqual(semMarco);

    // Idempotente, também com duas rodadas ao mesmo tempo (competência única por contrato)
    const antes = await prisma.contaReceber.count();
    const rs = await Promise.all([fin.rolarHorizonteDePrevisoes(), fin.rolarHorizonteDePrevisoes({ empresaId: "e1" })]);
    expect(rs.map((x) => [x.previsoes, x.falhas])).toEqual([[0, 0], [0, 0]]);
    expect(await prisma.contaReceber.count()).toBe(antes);
  });

  it("horizonte: contrato com mais de 10 anos (sem fim) continua com a janela de 12 meses; o valor novo do contrato vale para o mês que entra", async () => {
    em("2026-11-15T15:00:00.000Z");
    const velho = await criar({ dataInicio: "2014-03-01" });
    expect(await comps(velho.id)).toHaveLength(13);
    await prisma.contaReceber.deleteMany({ where: { contratoId: velho.id, refAno: 2027, refMes: { gte: 6 } } }); // janela "atrasada"
    const r = await fin.rolarHorizonteDePrevisoes({ empresaId: "e1" });
    expect(r.previsoes).toBe(6);
    expect(await comps(velho.id)).toHaveLength(13);
  });

  // ─────────────────────────── reajuste anual ───────────────────────────
  it("aniversário chegou: sugere (lista + sino), não aplica sozinho; aplicar grava quem/quando/ano e leva o valor novo SÓ às previsões abertas daqui pra frente (mesmo número no resto)", async () => {
    em("2026-11-15T15:00:00.000Z");
    // Começou em nov/2025: 12 meses → aniversário em nov/2026 (mês do início)
    const ct = await criar({ dataInicio: "2025-11-01", reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 5 });
    const outro = await criar({ dataInicio: "2026-06-01" }); // sem reajuste: nada muda nele
    // Outubro (mês passado) ainda previsto; novembro já virou medição; janeiro com boleto
    await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", contratoId: ct.id, refAno: 2026, refMes: 10, numero: `${ct.numero}/202610`,
      descricao: "Out", valor: 1000, status: "PREVISTO", dataVencimento: new Date("2026-10-10T00:00:00Z"),
    } });
    expect((await chamar("medicoes/gerar-mes", "POST", {}, { mes: 11, ano: 2026 })).status).toBe(200);
    await prisma.contaReceber.updateMany({ where: { contratoId: ct.id, refAno: 2027, refMes: 1 }, data: { boletoId: "b1", boletoStatus: "EMITIDO" } });
    const antes = await retrato(ct.id);
    const outroAntes = await retrato(outro.id);

    // A rotina diária NÃO aplica
    await fin.rolarHorizonteDePrevisoes();
    expect(Number((await prisma.contrato.findUnique({ where: { id: ct.id } })).valorMensal)).toBe(1000);

    const lista = await reajuste.listarReajustes("e1");
    const linha = lista.find((l) => l.contratoId === ct.id)!;
    expect([linha.situacao, linha.aniversario, linha.percentual, linha.valorAtual, linha.valorNovo]).toEqual(["PENDENTE", { ano: 2026, mes: 11 }, 5, 1000, 1050]);
    expect(lista.some((l) => l.contratoId === outro.id)).toBe(false);
    expect(await sino()).toBe(1); // só este contrato está no aniversário agora

    const r = await decidir(ct.id, { acao: "APLICAR", ano: 2026, valorEsperado: 1000 });
    expect(r.status).toBe(200);
    expect([r.json.valorAnterior, r.json.valorNovo, sp(r.json.texto)]).toEqual([1000, 1050, "Reajuste de 5% aplicado: R$ 1.000,00 → R$ 1.050,00."]);
    expect(Number((await prisma.contrato.findUnique({ where: { id: ct.id } })).valorMensal)).toBe(1050);
    const hist = await prisma.reajusteContrato.findMany({ where: { contratoId: ct.id } });
    expect(hist.map((h: any) => [h.situacao, h.anoReferencia, h.mesReferencia, Number(h.percentual), Number(h.valorAnterior), Number(h.valorNovo), h.usuarioId]))
      .toEqual([["APLICADO", 2026, 11, 5, 1000, 1050, "uA"]]);

    // MESMO NÚMERO: só as previsões abertas de nov/26 em diante sem medição/boleto mudam, e só para 1.050
    const depois = await retrato(ct.id);
    const mudou = depois.filter((d: string, i: number) => d !== antes[i]);
    expect(depois).toHaveLength(antes.length);
    expect(mudou.every((d: string) => d.includes("=1050.00·PREVISTO"))).toBe(true);
    expect(mudou).toHaveLength(antes.filter((a: string) => a.includes("=1000.00·PREVISTO") && !a.startsWith("10/2026") && !a.includes("·bol") && !a.includes("·med")).length);
    expect(depois.find((d: string) => d.startsWith("10/2026"))).toBe("10/2026=1000.00·PREVISTO"); // mês passado: não retroage
    expect(depois.find((d: string) => d.startsWith("1/2027"))).toBe("1/2027=1000.00·PREVISTO·bol"); // com boleto: fica
    expect(depois.filter((d: string) => d.includes("·med"))).toEqual(antes.filter((a: string) => a.includes("·med"))); // virou cobrança: fica
    expect(await retrato(outro.id)).toEqual(outroAntes);
    const ev = await prisma.contaReceberEvento.findFirst({ where: { contaReceber: { contratoId: ct.id, refAno: 2026, refMes: 12 }, tipo: "EDITADA" } });
    expect(ev.usuarioId).toBe("uA");

    // Decidido: sai da lista e do sino; aplicar de novo é recusado; a janela que rola usa o valor novo
    expect((await reajuste.listarReajustes("e1")).some((l) => l.contratoId === ct.id)).toBe(false);
    expect(await sino()).toBe(0);
    expect((await decidir(ct.id, { acao: "APLICAR", ano: 2026, valorEsperado: 1050 })).status).toBe(409);
    em("2026-12-05T11:00:00.000Z");
    await fin.rolarHorizonteDePrevisoes({ empresaId: "e1" });
    expect(Number((await prisma.contaReceber.findFirst({ where: { contratoId: ct.id, refAno: 2027, refMes: 12 } })).valor)).toBe(1050);
    // O formulário mostra o histórico com quem aplicou
    const get = await chamar("contratos/[id]", "GET", { id: ct.id });
    expect(get.json.reajustes.map((h: any) => [h.situacao, h.usuario?.nome])).toEqual([["APLICADO", "Ana"]]);
  });

  it("concorrência: dois \"Aplicar\" ao mesmo tempo = UM reajuste (5%, não 10,25%); valor que mudou no meio é recusado sem mexer em nada", async () => {
    em("2026-11-15T15:00:00.000Z");
    const ct = await criar({ dataInicio: "2025-11-01", reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 5 });
    const antes = await retrato(ct.id);
    expect(sp((await decidir(ct.id, { acao: "APLICAR", ano: 2026, valorEsperado: 999 })).json.erro)).toBe("O valor do contrato mudou (agora R$ 1.000,00). Atualize a tela e confira o reajuste.");
    expect(await retrato(ct.id)).toEqual(antes);
    expect((await decidir(ct.id, { acao: "APLICAR", ano: 2025, valorEsperado: 1000 })).status).toBe(409); // outro aniversário
    expect((await decidir(ct.id, { acao: "ADIAR", ano: 2026, dias: 10 })).status).toBe(200); // adiado ainda pode ser aplicado
    const rs = await Promise.all([1, 2, 3].map(() => decidir(ct.id, { acao: "APLICAR", ano: 2026, valorEsperado: 1000 })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(Number((await prisma.contrato.findUnique({ where: { id: ct.id } })).valorMensal)).toBe(1050);
    expect(await prisma.reajusteContrato.count({ where: { contratoId: ct.id } })).toBe(1);
    expect((await prisma.contrato.findUnique({ where: { id: ct.id } })).reajusteAdiadoAte).toBeNull(); // decidido: o adiamento some
  });

  it("adiar some até a data (e volta); dispensar fecha o ano sem mexer no valor; no aniversário seguinte sugere de novo", async () => {
    em("2026-11-15T15:00:00.000Z");
    const ct = await criar({ dataInicio: "2025-11-01", reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 4.5 });
    const antes = await retrato(ct.id);
    const pendentesAntes = await reajuste.contarReajustesPendentes("e1");
    const r = await decidir(ct.id, { acao: "ADIAR", ano: 2026, dias: 30 });
    expect([r.status, r.json.adiadoAte]).toEqual([200, "2026-12-15"]);
    expect((await reajuste.listarReajustes("e1")).find((l) => l.contratoId === ct.id)!.situacao).toBe("ADIADO");
    expect(await reajuste.contarReajustesPendentes("e1")).toBe(pendentesAntes - 1); // adiado não toca o sino
    em("2026-12-16T11:00:00.000Z");
    expect((await reajuste.listarReajustes("e1")).find((l) => l.contratoId === ct.id)!.situacao).toBe("PENDENTE");
    expect((await decidir(ct.id, { acao: "DISPENSAR", ano: 2026, motivo: " cliente negociou manter " })).status).toBe(200);
    const h = await prisma.reajusteContrato.findFirst({ where: { contratoId: ct.id } });
    expect([h.situacao, h.motivo, Number(h.valorAnterior), Number(h.valorNovo), h.usuarioId]).toEqual(["DISPENSADO", "cliente negociou manter", 1000, 1000, "uA"]);
    expect(Number((await prisma.contrato.findUnique({ where: { id: ct.id } })).valorMensal)).toBe(1000);
    expect((await retrato(ct.id)).slice(0, antes.length)).toEqual(antes);
    expect((await reajuste.listarReajustes("e1")).some((l) => l.contratoId === ct.id)).toBe(false);
    expect((await decidir(ct.id, { acao: "APLICAR", ano: 2026, valorEsperado: 1000 })).status).toBe(409);
    // Novembro de 2027: o aniversário seguinte
    em("2027-11-03T11:00:00.000Z");
    const l27 = (await reajuste.listarReajustes("e1")).find((l) => l.contratoId === ct.id)!;
    expect([l27.situacao, l27.aniversario.ano, l27.valorNovo]).toEqual(["PENDENTE", 2027, 1045]);
  });

  it("vem chegando (\"Avisar antes\"): aparece na lista sem sino e não aplica antes do aniversário; antes de 12 meses não sugere; índice (IPCA) não sugere", async () => {
    em("2026-11-15T15:00:00.000Z");
    const breve = await criar({ dataInicio: "2025-06-01", reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 3, reajusteMesAniversario: 12, reajusteNotificar: true, reajusteNotificarDias: 30 });
    const novo = await criar({ dataInicio: "2026-03-01", reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 3, reajusteMesAniversario: 11 });
    const ipca = await criar({ dataInicio: "2025-11-01", reajusteAtivo: true, reajusteIndice: "IPCA" });
    const lista = await reajuste.listarReajustes("e1");
    const l = lista.find((x) => x.contratoId === breve.id)!;
    expect([l.situacao, l.aniversario]).toEqual(["EM_BREVE", { ano: 2026, mes: 12 }]);
    expect(lista.some((x) => x.contratoId === novo.id || x.contratoId === ipca.id)).toBe(false);
    const r = await decidir(breve.id, { acao: "APLICAR", ano: 2026, valorEsperado: 1000 });
    expect([r.status, r.json.erro]).toEqual([409, "O reajuste vale a partir de dez/2026: aplique quando o aniversário chegar."]);
    expect((await decidir(breve.id, { acao: "ADIAR", ano: 2026, dias: 30 })).json.erro).toBe("O aniversário ainda não chegou: não há o que adiar.");
    expect(Number((await prisma.contrato.findUnique({ where: { id: breve.id } })).valorMensal)).toBe(1000);
  });

  it("RBAC e empresa: sem \"Contratos › Editar\" não decide nem vê no sino; contrato de outra empresa = não encontrado", async () => {
    em("2026-11-15T15:00:00.000Z");
    const ct = await criar({ dataInicio: "2025-11-01", reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 5 });
    logar(usuario({ contratos: ["visualizar"], financeiro: ["visualizar", "medicoes"] }));
    try {
      expect((await decidir(ct.id, { acao: "APLICAR", ano: 2026, valorEsperado: 1000 })).status).toBe(403);
      expect((await chamar("alertas", "GET")).json.reajustesContrato).toBe(0);
    } finally { logar(); }
    logar({ user: { id: "uB", name: "Bia", email: "bia@x.com", empresaId: "e2", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } });
    try {
      expect((await decidir(ct.id, { acao: "APLICAR", ano: 2026, valorEsperado: 1000 })).status).toBe(404);
    } finally { logar(); }
    expect((await decidir(ct.id, { acao: "APLICAR", ano: 2026 })).status).toBe(400);
    // Contrato da OUTRA empresa no aniversário: não aparece na lista (nem no sino) desta
    const outro = await prisma.contrato.create({ data: {
      empresaId: "e2", clienteId: "c2", numero: "CT-E2", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 500,
      dataInicio: new Date("2025-11-01T00:00:00.000Z"), reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO", reajustePercentual: 5,
    } });
    expect((await reajuste.listarReajustes("e1")).some((l) => l.contratoId === outro.id)).toBe(false);
    expect((await reajuste.listarReajustes("e2")).map((l) => l.contratoId)).toEqual([outro.id]);
    expect(Number((await prisma.contrato.findUnique({ where: { id: ct.id } })).valorMensal)).toBe(1000);
  });
});
