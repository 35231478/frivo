/**
 * OS recorrentes dos contratos — horizonte rolante na rotina diária (o botão "Gerar OS recorrentes do
 * mês" saiu do Calendário). Rotas reais, Prisma real, PostgreSQL real (schema descartável). Prova:
 *  - ao salvar o contrato nascem as 12 ocorrências à frente (como antes); a rotina diária (rota real do
 *    cron, com o segredo) cria só as que entram na janela conforme o tempo passa — sem ninguém clicar;
 *  - rodar de novo não cria nada; duas rodadas e um "salvar" ao mesmo tempo não duplicam ocorrência;
 *  - OS cancelada continua contando como gerada (a rotina não ressuscita);
 *  - contrato que nunca teve OS (ativado por outro caminho) ganha as dele, em nome do administrador
 *    mais antigo da própria empresa; contrato suspenso não gera; a vigência (data de fim) é respeitada;
 *  - a recorrência POR LOCAL também rola (o botão antigo não cobria esse caso);
 *  - empresa sem ninguém para assinar não gera e é contada à parte.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-recorrentes-horizonte-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_osrec_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const CRON = "segredo-do-cron-de-teste";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarBoleto: vi.fn(async () => ({ ok: true })), enviarMedicao: vi.fn(async () => ({ ok: true })), enviarConfirmacaoPagamento: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const ADMIN = () => ({ user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } });

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

describe.skipIf(!URL_PG)("OS recorrentes dos contratos — horizonte rolante na rotina diária (PostgreSQL real)", () => {
  let prisma: any;
  let rec: typeof import("@/lib/recorrencia-server");
  let seq = 0;

  /** Contrato salvo pela rota real (é ela que gera as 12 primeiras) */
  const salvar = async (dados: Record<string, unknown> = {}) => {
    const b = {
      clienteId: "c1", numero: `CT-O${String(++seq).padStart(2, "0")}`, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO",
      dataInicio: "2026-09-01", recorrencia: true, frequenciaRecorrencia: "MENSAL", diaRecorrencia: 20, ...dados,
    };
    const r = await chamar("contratos", "POST", {}, b);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return { id: r.json.id as string, numero: b.numero as string };
  };
  /** Contrato gravado direto no banco: ativo e recorrente, mas sem nenhuma OS (ninguém "salvou" pela tela) */
  const semOs = async (empresaId: string, clienteId: string, dados: Record<string, unknown> = {}) => {
    const numero = `CT-D${String(++seq).padStart(2, "0")}`;
    const c = await prisma.contrato.create({ data: {
      empresaId, clienteId, numero, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", dataInicio: new Date("2026-09-01T12:00:00.000Z"),
      recorrencia: true, frequenciaRecorrencia: "MENSAL", diaRecorrencia: 20, ...dados,
    } });
    return { id: c.id as string, numero };
  };
  const osDo = (contratoId: string) => prisma.ordemServico.findMany({ where: { contratoId }, orderBy: { previsaoConclusao: "asc" } });
  const periodos = async (contratoId: string) => (await osDo(contratoId)).map((o: any) => o.periodoRecorrencia);
  const rotina = async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    try {
      const r = await chamar("cron/faturar-contratos", "GET", {}, undefined, { authorization: `Bearer ${CRON}` });
      expect(r.status).toBe(200);
      return r.json.osRecorrentes as { contratos: number; os: number; falhas: number; semAutor: number };
    } finally { vi.unstubAllEnvs(); }
  };
  const meses = (de: [number, number], n: number) => Array.from({ length: n }, (_, i) => {
    const m0 = de[1] - 1 + i;
    return `${de[0] + Math.floor(m0 / 12)}-${String((m0 % 12) + 1).padStart(2, "0")}`;
  });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    rec = await import("@/lib/recorrencia-server");
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
      { id: "e3", nome: "Sem ninguém", cnpj: "33.333.333/0001-33", email: "s@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      // uZ é administrador mais NOVO que a Ana e uI é mais antigo, mas inativo: quem assina é a Ana
      { id: "uI", empresaId: "e1", nome: "Ivo", email: "ivo@x.com", senha: "x", role: "ADMIN", ativo: false, criadoEm: new Date("2020-01-01T00:00:00.000Z") },
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN", criadoEm: new Date("2021-01-01T00:00:00.000Z") },
      { id: "uZ", empresaId: "e1", nome: "Zeca", email: "zeca@x.com", senha: "x", role: "ADMIN", criadoEm: new Date("2024-01-01T00:00:00.000Z") },
      { id: "uU", empresaId: "e1", nome: "Uli", email: "uli@x.com", senha: "x", role: "OPERADOR", criadoEm: new Date("2019-01-01T00:00:00.000Z") },
      { id: "uB", empresaId: "e2", nome: "Bia", email: "bia@x.com", senha: "x", role: "ADMIN" },
      { id: "uS", empresaId: "e3", nome: "Só operador", email: "so@x.com", senha: "x", role: "OPERADOR" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11" },
      { id: "c2", empresaId: "e2", nome: "Padaria", cpfCnpj: "22.222.222/0001-22" },
      { id: "c3", empresaId: "e3", nome: "Mercado", cpfCnpj: "44.444.444/0001-44" },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Bloco B" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    em("2026-11-15T15:00:00.000Z");
    sessao.atual = ADMIN();
  }, 240_000);

  // Cada caso começa sem contrato ativo dos anteriores (mesmo que o anterior tenha falhado no meio)
  afterEach(async () => { await prisma.contrato.updateMany({ data: { status: "ENCERRADO" } }); });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("salvar o contrato gera as 12 à frente; a rotina diária cria só o que entra na janela, sem ninguém clicar; rodar de novo não cria nada", async () => {
    // Quem salva o contrato é o Zeca (administrador mais novo que a Ana)
    sessao.atual = { user: { ...ADMIN().user, id: "uZ", name: "Zeca", email: "zeca@x.com" } };
    const a = await salvar();
    sessao.atual = ADMIN();
    // hoje é 15/11/2026 e o dia é 20: novembro ainda entra
    expect(await periodos(a.id)).toEqual(meses([2026, 11], 12));

    // No mesmo dia a rotina não tem o que fazer
    expect(await rotina()).toMatchObject({ os: 0, falhas: 0, semAutor: 0 });

    // Dois meses depois (ninguém mexeu no contrato). Hoje é 21/01/2027 e o dia 20 já passou: as 12 à
    // frente vão de fevereiro/2027 a janeiro/2028 — faltavam novembro, dezembro e janeiro
    em("2027-01-21T11:23:00.000Z");
    const r = await rotina();
    expect(r).toMatchObject({ contratos: 1, os: 3, falhas: 0, semAutor: 0 });
    expect(await periodos(a.id)).toEqual(meses([2026, 11], 15)); // …até 01/2028; as passadas continuam
    expect((await rotina()).os).toBe(0);

    // As novas: mesma forma das que nascem ao salvar, em nome de quem configurou a recorrência — o Zeca,
    // e não o administrador mais antigo (esse só assina quando o contrato ainda não tem nenhuma OS)
    const nova = (await osDo(a.id)).at(-1);
    expect([nova.status, nova.origem, nova.criadoPorId, nova.prioridade, nova.unidadeId]).toEqual(["AGENDADA", "RECORRENTE", "uZ", "NORMAL", null]);
    expect(nova.descricao).toBe(`Atendimento recorrente — contrato ${a.numero} (01/2028)`);
    const h = await prisma.osHistorico.findMany({ where: { ordemServicoId: nova.id } });
    expect(h.map((x: any) => [x.usuarioId, x.acao, x.detalhes])).toEqual([["uZ", "OS recorrente gerada", `Gerada automaticamente pela rotina diária do contrato ${a.numero} (2028-01).`]]);
    // e as do "salvar" continuam dizendo de onde vieram
    const primeira = (await osDo(a.id))[0];
    expect((await prisma.osHistorico.findFirst({ where: { ordemServicoId: primeira.id } })).detalhes).toBe(`Gerada automaticamente ao salvar o contrato ${a.numero} (2026-11).`);
    // numeração sem buraco nem repetição
    const numeros = (await prisma.ordemServico.findMany({ where: { empresaId: "e1" }, select: { numero: true } })).map((o: any) => o.numero);
    expect(new Set(numeros).size).toBe(numeros.length);
  });

  it("OS cancelada continua contando como gerada: a rotina não ressuscita a ocorrência", async () => {
    em("2027-01-21T11:23:00.000Z");
    const b = await salvar();
    const todas = await osDo(b.id);
    expect(todas).toHaveLength(12);
    await prisma.ordemServico.update({ where: { id: todas[3].id }, data: { status: "CANCELADA" } });
    expect((await rotina()).os).toBe(0);
    expect(await osDo(b.id)).toHaveLength(12);
  });

  it("contrato ativo que nunca teve OS ganha as dele pelo administrador ativo mais antigo da PRÓPRIA empresa; suspenso não gera; a data de fim é respeitada", async () => {
    em("2027-01-21T11:23:00.000Z");
    const novo = await semOs("e1", "c1");
    const outra = await semOs("e2", "c2");
    const suspenso = await semOs("e1", "c1", { status: "SUSPENSO" });
    const comFim = await semOs("e1", "c1", { dataFim: new Date("2027-03-31T12:00:00.000Z") });
    const trimestral = await semOs("e1", "c1", { frequenciaRecorrencia: "TRIMESTRAL" });
    const semFrequencia = await semOs("e1", "c1", { frequenciaRecorrencia: null });

    const r = await rotina();
    expect(r).toMatchObject({ falhas: 0, semAutor: 0 });
    // hoje é 21/01/2027 e o dia é 20: janeiro já passou, começa em fevereiro
    expect(await periodos(novo.id)).toEqual(meses([2027, 2], 12));
    expect(new Set((await osDo(novo.id)).map((o: any) => `${o.empresaId}·${o.criadoPorId}`))).toEqual(new Set(["e1·uA"])); // não o inativo, não o operador, não o mais novo
    expect(new Set((await osDo(outra.id)).map((o: any) => `${o.empresaId}·${o.criadoPorId}`))).toEqual(new Set(["e2·uB"]));
    expect(await osDo(suspenso.id)).toEqual([]);
    expect(await periodos(comFim.id)).toEqual(["2027-02", "2027-03"]);
    expect((await periodos(trimestral.id)).slice(0, 3)).toEqual(["2027-03", "2027-06", "2027-09"]); // a cada 3 meses, contados do início (set/26)
    expect(await osDo(semFrequencia.id)).toEqual([]);
    expect(r.os).toBe(12 + 12 + 2 + 12);
  });

  it("a recorrência POR LOCAL também rola (o botão antigo do calendário não cobria)", async () => {
    em("2027-01-21T11:23:00.000Z");
    const l = await salvar({
      recorrencia: false, frequenciaRecorrencia: null, unidadeIds: ["un1"],
      recorrenciasLocais: [{ unidadeId: "un1", ativa: true, frequencia: "MENSAL", dataPrimeiraOs: "2027-02-10" }],
    });
    const p = (m: string) => `L:un1:${m}`;
    expect(await periodos(l.id)).toEqual(meses([2027, 2], 12).map(p));
    // Na mesma hora a rotina não tem o que fazer; antes da primeira OS a janela não anda
    expect(await rotina()).toMatchObject({ contratos: 1, os: 0, falhas: 0 });
    // 12/03/2027, o dia 10 já passou: as 12 à frente vão de abril/2027 a março/2028 — faltavam fevereiro e março/2028
    em("2027-03-12T11:23:00.000Z");
    const r = await rotina();
    expect(r).toMatchObject({ contratos: 1, os: 2, falhas: 0 });
    expect(await periodos(l.id)).toEqual(meses([2027, 2], 14).map(p));
    expect((await rotina()).os).toBe(0);
    const nova = (await osDo(l.id)).at(-1);
    expect([nova.unidadeId, nova.criadoPorId, nova.origem]).toEqual(["un1", "uA", "RECORRENTE"]);
    expect((await prisma.osHistorico.findFirst({ where: { ordemServicoId: nova.id } })).detalhes).toBe(`Gerada automaticamente pela rotina diária do contrato ${l.numero} (local) (2028-03).`);
    // local desligado: para de rolar
    await prisma.contratoRecorrenciaLocal.updateMany({ where: { contratoId: l.id }, data: { ativa: false } });
    em("2027-05-12T11:23:00.000Z");
    expect(await rotina()).toMatchObject({ contratos: 0, os: 0 });
  });

  it("duas rodadas e um \"salvar\" ao mesmo tempo: nenhuma ocorrência em dobro e nenhum número queimado", async () => {
    em("2027-05-12T11:23:00.000Z");
    const c = await semOs("e1", "c1");
    const antes = await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "os" } } });
    const rs = await Promise.all([
      rec.rolarHorizonteDeOsRecorrentes(), rec.rolarHorizonteDeOsRecorrentes(),
      rec.gerarOsRecorrentesContrato(c.id, "uZ"),
    ]);
    const ps = await periodos(c.id);
    expect(ps).toEqual(meses([2027, 5], 12));
    expect(new Set(ps).size).toBe(12);
    expect((rs[0] as any).os + (rs[1] as any).os + (rs[2] as number)).toBe(12); // cada ocorrência foi criada por um só
    const depois = await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "os" } } });
    expect(depois.proximo - antes.proximo).toBe(12); // quem perdeu a vez não consumiu número
  });

  it("empresa sem administrador ativo: não gera (a OS exige um autor) e a rotina conta à parte, sem derrubar as outras", async () => {
    em("2027-05-12T11:23:00.000Z");
    const orfao = await semOs("e3", "c3");
    const bom = await semOs("e2", "c2");
    const r = await rotina();
    expect(r).toMatchObject({ contratos: 2, os: 12, falhas: 0, semAutor: 1 });
    expect(await osDo(orfao.id)).toEqual([]);
    expect(await osDo(bom.id)).toHaveLength(12);
  });

  it("a rotina exige o segredo do cron (sem ele, nada roda)", async () => {
    vi.stubEnv("CRON_SECRET", CRON);
    try {
      expect((await chamar("cron/faturar-contratos", "GET")).status).toBe(401);
      expect((await chamar("cron/faturar-contratos", "GET", {}, undefined, { authorization: "Bearer errado" })).status).toBe(401);
    } finally { vi.unstubAllEnvs(); }
  });
});
