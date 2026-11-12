/**
 * PMOC — Etapa 2 (cronograma que gera as OS): rotas reais com o Prisma real num PostgreSQL real
 * (schema descartável via `prisma db push`), com o relógio parado em 12/11/2026, 12:00 de Brasília.
 *  - o item do cronograma: tipo de OS, início, a cada N meses, dia de execução; por plano inteiro, por
 *    tipo de equipamento ou por equipamento;
 *  - geração: uma OS por item, competência e local, com os equipamentos na atividade; ligada ao plano
 *    e a cada equipamento pelas execuções; do jeito das OS recorrentes dos contratos (aparece no calendário);
 *  - quando NÃO gera: rascunho, plano inativo, plano expirado, equipamento inativo, passado, depois da expiração;
 *  - idempotência: reagendar de novo (e dois ao mesmo tempo) não duplica;
 *  - "Reagendar atividades": muda datas, inclui e retira equipamentos, cancela a OS vazia — só no que
 *    ainda não começou, e sem desfazer o que alguém ajustou à mão;
 *  - RBAC do módulo pmoc, cancelar OS só com "Ordens de serviço › Excluir", multiempresa;
 *  - Etapa 2.1 — SUBSTITUIÇÃO: no mesmo equipamento e na mesma competência só o item de maior intervalo
 *    gera (mês a mês, por equipamento, desempate, química que entra depois, OS que esvazia é cancelada,
 *    reagendar idempotente) e FIM DE SEMANA: manter, adiantar ou postergar, por item.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pmoc-cronograma-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pmoc_cron_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 12/11/2026, 12:00 em Brasília */
const AGORA = new Date("2026-11-12T15:00:00.000Z");
/** Meio-dia de Brasília do dia `iso` (a hora em que o cronograma agenda) */
const meioDia = (iso: string) => new Date(`${iso}T15:00:00.000Z`);

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", extra: Record<string, unknown> = {}) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null, ...extra } };
};
const comPmoc = (acoes: Acao[], extra: Record<string, Acao[]> = {}) => como(montarPermissoes({ pmoc: acoes, ...extra }));

const ROTAS = {
  plano: "pmocs/[id]", equipamentos: "pmocs/[id]/equipamentos", impacto: "pmocs/[id]/impacto",
  cronograma: "pmocs/[id]/cronograma", item: "pmocs/[id]/cronograma/[itemId]", reagendar: "pmocs/[id]/cronograma/reagendar",
} as const;
async function chamar(rota: keyof typeof ROTAS, metodo: string, op: { id?: string; itemId?: string; corpo?: unknown; query?: string } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${ROTAS[rota]}/route`);
  const req = new NextRequest(`http://localhost/api/x${op.query ? `?${op.query}` : ""}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ id: op.id ?? "", itemId: op.itemId ?? "" }) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}

const RT = { rtNome: "Eng. Paula Reis", rtCrea: "SP-5061234567", artNumero: "28027230241234567" };
const corpoPlano = (extra: Record<string, unknown> = {}) => ({ nome: "PMOC 2026 — Hospital", clienteId: "c1", unidadeId: "u1", dataInicio: "2026-11-12", dataExpiracao: "2027-11-11", ...RT, ...extra });
/**
 * Mensal, todo dia 25, para todos os equipamentos do plano, a partir de hoje. `fimSemana: "MANTER"` deixa
 * os testes da Etapa 2 nas datas nominais (o dia 25 cai em fim de semana em alguns meses); o padrão dos
 * itens novos (postergar) e as três opções têm os seus testes no bloco da Etapa 2.1.
 */
const item = (extra: Record<string, unknown> = {}) => ({ tipoOsId: "toMensal", dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25, fimSemana: "MANTER", ...extra });

describe.skipIf(!URL_PG)("PMOC — Etapa 2: cronograma que gera as OS (PostgreSQL real)", () => {
  let prisma: any;
  /** Plano em rascunho com os equipamentos dados (padrão: q1 e q2, os dois na Matriz) */
  const rascunho = async (equipamentoIds = ["q1", "q2"], extra: Record<string, unknown> = {}) => {
    const id = (await prisma.pmoc.create({ data: {
      empresaId: "e1", clienteId: "c1", unidadeId: "u1", nome: "PMOC 2026 — Hospital", status: "RASCUNHO", ...RT,
      dataInicio: new Date("2026-11-12T00:00:00Z"), dataExpiracao: new Date("2027-11-11T00:00:00Z"), ...extra,
      equipamentos: { create: equipamentoIds.map((equipamentoId) => ({ equipamentoId })) },
    }, select: { id: true } })).id as string;
    return id;
  };
  const publicar = (id: string, extra: Record<string, unknown> = {}) => chamar("plano", "PUT", { id, corpo: corpoPlano({ status: "PUBLICADO", ...extra }) });
  const novoItem = async (id: string, extra: Record<string, unknown> = {}) => { const r = await chamar("cronograma", "POST", { id, corpo: item(extra) }); expect(r.status, JSON.stringify(r.json)).toBe(201); return r; };
  /** Plano publicado, com um item (mensal, dia 25, todos) já gerado */
  const publicado = async (equipamentoIds = ["q1", "q2"], extraItem: Record<string, unknown> = {}) => {
    const id = await rascunho(equipamentoIds);
    const r = await novoItem(id, extraItem);
    expect((await publicar(id)).status).toBe(200);
    return { id, itemId: r.json.cronograma.itens[0].id as string };
  };
  const reagendar = (id: string) => chamar("reagendar", "POST", { id });
  const ler = async (id: string) => (await chamar("cronograma", "GET", { id })).json;
  /** As OS do plano (pelas execuções), em ordem de data: o que a agenda tem */
  const ordens = async (id: string) => {
    const lista = await prisma.ordemServico.findMany({
      where: { pmocExecucoes: { some: { pmocId: id } } },
      include: { atividades: { include: { equipamentos: { orderBy: { equipamentoId: "asc" } } } }, pmocExecucoes: { orderBy: { equipamentoId: "asc" } }, historico: { orderBy: { criadoEm: "asc" } } },
      orderBy: [{ previsaoConclusao: "asc" }, { unidadeId: "asc" }],
    });
    return lista.map((o: any) => ({
      id: o.id, numero: o.numero, status: o.status, unidadeId: o.unidadeId, periodo: o.periodoRecorrencia, dia: o.atividades[0].dataAgendada.toISOString().slice(0, 10),
      equipamentos: o.atividades[0].equipamentos.map((e: any) => e.equipamentoId), execucoes: o.pmocExecucoes.map((x: any) => x.equipamentoId), atividadeId: o.atividades[0].id, bruto: o,
    }));
  };
  const execucoes = (id: string) => prisma.pmocExecucao.count({ where: { pmocId: id } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "1" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "u1b", empresaId: "e1", clienteId: "c1", nome: "Anexo" },
      { id: "uE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    await prisma.tipoOs.createMany({ data: [
      { id: "toMensal", empresaId: "e1", nome: "PMOC mensal" },
      { id: "toTrimestral", empresaId: "e1", nome: "PMOC trimestral" },
      { id: "toQuimica", empresaId: "e1", nome: "Limpeza química" },
      { id: "toInativo", empresaId: "e1", nome: "Tipo aposentado", ativo: false },
      { id: "toE2", empresaId: "e2", nome: "Tipo da outra empresa" },
    ] });
    await prisma.tipoEquipamentoCustom.createMany({ data: [
      { id: "teSplit", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" },
      { id: "teChiller", empresaId: "e1", nome: "Chiller", chaveEnum: "CHILLER" },
      { id: "teE2", empresaId: "e2", nome: "Split da outra empresa", chaveEnum: "AR_CONDICIONADO_SPLIT" },
    ] });
    const eq = (id: string, unidadeId: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: unidadeId === "uE2" ? "e2" : "e1", unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", tipoEquipamentoId: "teSplit", ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("q1", "u1"), eq("q2", "u1"),
      eq("q3", "u1b"),                                                    // outro local do mesmo cliente
      eq("qChiller", "u1", { tipo: "CHILLER", tipoEquipamentoId: "teChiller" }),
      eq("qAntigo", "u1", { tipoEquipamentoId: null }),                   // cadastro antigo: só o enum (Split)
      eq("qFora", "u1"),                                                  // do cliente, mas nunca entra no plano
      eq("qE2", "uE2", { tipoEquipamentoId: "teE2" }),
    ] });
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    await prisma.pmoc.deleteMany({});
    await prisma.ordemServico.deleteMany({});
    await prisma.equipamento.updateMany({ data: { ativo: true } });
    como();
  });

  /* ───────── o item do cronograma ───────── */
  it("item novo: grava tipo de OS, início, a cada N meses e dia de execução; a leitura traz a próxima execução e quantos equipamentos entram", async () => {
    const id = await rascunho(["q1", "q2", "qChiller"]);
    const r = await novoItem(id, { tipoEquipamentoId: "teSplit", intervaloMeses: 3, diaExecucao: 10 });
    expect(await prisma.pmocCronograma.findFirst({ where: { pmocId: id } })).toMatchObject({
      tipoEquipamentoId: "teSplit", equipamentoId: null, tipoOsId: "toMensal", intervaloMeses: 3, diaExecucao: 10, ativo: true, dataInicio: new Date("2026-11-12T00:00:00.000Z"),
    });
    // Início em 12/11 com dia 10: o dia 10 de novembro já passou → primeira execução em 10/12
    expect(r.json.cronograma.itens).toEqual([expect.objectContaining({
      tipoOs: expect.objectContaining({ nome: "PMOC mensal" }), tipoEquipamento: { id: "teSplit", nome: "Split" }, equipamento: null,
      intervaloMeses: 3, diaExecucao: 10, dataInicio: "2026-11-12", equipamentos: 2, proxima: "2026-12-10",
    })]);
    expect(r.json.cronograma.semCronograma).toEqual(["qChiller"]); // o chiller não entra em item nenhum: a tela avisa
  });

  it("validação do item: 400 com a mensagem do que está errado, e nada é gravado", async () => {
    const id = await rascunho();
    const casos: [Record<string, unknown>, string][] = [
      [{ tipoOsId: "" }, "Selecione o tipo de OS."],
      [{ tipoOsId: "toE2" }, "Tipo de OS inválido."],
      [{ tipoOsId: "toInativo" }, "Este tipo de OS está inativo. Escolha outro."],
      [{ diaExecucao: 29 }, "O dia de execução vai de 1 a 28."],
      [{ diaExecucao: 0 }, "O dia de execução vai de 1 a 28."],
      [{ intervaloMeses: 0 }, "O intervalo é de pelo menos 1 mês."],
      [{ intervaloMeses: 61 }, "O intervalo é de no máximo 60 meses."],
      [{ intervaloMeses: 1.5 }, "Informe um número inteiro de meses."],
      [{ dataInicio: "12/11/2026" }, "Informe a data de início."],
      [{ dataInicio: "2027-11-12" }, "A data de início é depois da expiração do plano."],
      [{ tipoEquipamentoId: "teE2" }, "Tipo de equipamento inválido."],
      [{ equipamentoId: "qFora" }, "Este equipamento não está no PMOC. Inclua-o na aba Equipamentos AVAC."],
      [{ equipamentoId: "qE2" }, "Este equipamento não está no PMOC. Inclua-o na aba Equipamentos AVAC."],
      [{ tipoEquipamentoId: "teSplit", equipamentoId: "q1" }, "Escolha um tipo de equipamento OU um equipamento, não os dois."],
    ];
    for (const [ruim, erro] of casos) expect(await chamar("cronograma", "POST", { id, corpo: item(ruim) }), JSON.stringify(ruim)).toMatchObject({ status: 400, json: { erro } });
    expect(await prisma.pmocCronograma.count()).toBe(0);
  });

  /* ───────── quando gera e quando não gera ───────── */
  it("RASCUNHO não gera: o item fica salvo, nenhuma OS nasce e 'Reagendar' é recusado com o motivo", async () => {
    const id = await rascunho();
    const r = await novoItem(id);
    expect(r.json.gerado).toMatchObject({ motivo: "RASCUNHO", criadas: [] });
    expect(r.json.cronograma).toMatchObject({ motivo: "RASCUNHO", ordens: [], previa: { criar: 0 } });
    expect(await reagendar(id)).toMatchObject({ status: 409, json: { erro: "Plano em rascunho: as OS são geradas quando ele for publicado." } });
    expect(await prisma.ordemServico.count()).toBe(0);
  });

  it("PUBLICAR gera: uma OS por competência até a expiração, com os equipamentos na atividade, ligada ao plano e a cada equipamento", async () => {
    const id = await rascunho();
    await novoItem(id);
    const pub = await publicar(id);
    expect(pub.json).toMatchObject({ status: "PUBLICADO", osGeradas: 12 });
    const os = await ordens(id);
    // 25/11/2026 … 25/10/2027: 12 competências (25/11/2027 já é depois da expiração, 11/11/2027)
    expect(os.map((o: any) => o.dia)).toEqual(["2026-11-25", "2026-12-25", "2027-01-25", "2027-02-25", "2027-03-25", "2027-04-25", "2027-05-25", "2027-06-25", "2027-07-25", "2027-08-25", "2027-09-25", "2027-10-25"]);
    expect(os.map((o: any) => o.periodo)).toEqual(["PMOC:2026-11", "PMOC:2026-12", "PMOC:2027-01", "PMOC:2027-02", "PMOC:2027-03", "PMOC:2027-04", "PMOC:2027-05", "PMOC:2027-06", "PMOC:2027-07", "PMOC:2027-08", "PMOC:2027-09", "PMOC:2027-10"]);
    for (const o of os) {
      expect(o).toMatchObject({ status: "AGENDADA", unidadeId: "u1", equipamentos: ["q1", "q2"], execucoes: ["q1", "q2"] });
      // A OS como a recorrente do contrato: cliente do plano, origem RECORRENTE, uma atividade com tipo e data
      expect(o.bruto).toMatchObject({ empresaId: "e1", clienteId: "c1", contratoId: null, criadoPorId: "uA", origem: "RECORRENTE", prioridade: "NORMAL", statusManual: false });
      expect(o.bruto.atividades).toHaveLength(1);
      expect(o.bruto.atividades[0]).toMatchObject({ empresaId: "e1", tipoOsId: "toMensal", titulo: "PMOC mensal", status: "AGENDADA", tecnicoId: null });
      expect(o.bruto.historico.map((h: any) => h.acao)).toEqual(["OS gerada pelo cronograma do PMOC"]);
    }
    // Meio-dia de Brasília, e a previsão da OS é a mesma data (é ela que o calendário lê)
    expect(os[0].bruto.atividades[0].dataAgendada).toEqual(meioDia("2026-11-25"));
    expect(os[0].bruto.previsaoConclusao).toEqual(meioDia("2026-11-25"));
    expect(os[0].bruto.descricao).toBe("PMOC mensal — PMOC 2026 — Hospital (11/2026)");
    expect(os[0].bruto.pmocExecucoes[0]).toMatchObject({ pmocId: id, periodo: "2026-11", dataPrevista: meioDia("2026-11-25"), ordemServicoId: os[0].id });
    // Números da OS: um por OS, sem repetir, pelo contador da empresa
    expect(new Set(os.map((o: any) => o.numero)).size).toBe(12);
    expect(await execucoes(id)).toBe(24);
  });

  it("salvar o item com o plano JÁ publicado gera na hora (sem precisar do botão)", async () => {
    const id = await rascunho();
    await publicar(id);
    expect(await prisma.ordemServico.count()).toBe(0); // publicado sem cronograma: nada a gerar
    const r = await novoItem(id, { intervaloMeses: 6 });
    expect(r.json.gerado.criadas).toHaveLength(2);
    expect((await ordens(id)).map((o: any) => o.dia)).toEqual(["2026-11-25", "2027-05-25"]);
    expect(r.json.cronograma).toMatchObject({ motivo: null, totais: { futuras: 2, passadas: 0 }, previa: { criar: 0, mover: 0, retirar: 0, cancelar: 0 } });
    expect(r.json.cronograma.ordens[0]).toMatchObject({ numero: expect.any(String), status: "AGENDADA", tipoOs: "PMOC mensal", local: "Matriz", equipamentos: 2, periodo: "2026-11", pendente: true });
  });

  it("uma OS por LOCAL: equipamentos de outro endereço do cliente vão em OS própria, na mesma data", async () => {
    const { id } = await publicado(["q1", "q2", "q3"], { intervaloMeses: 6 });
    const os = await ordens(id);
    expect(os.map((o: any) => [o.dia, o.unidadeId, o.equipamentos])).toEqual([
      ["2026-11-25", "u1", ["q1", "q2"]], ["2026-11-25", "u1b", ["q3"]],
      ["2027-05-25", "u1", ["q1", "q2"]], ["2027-05-25", "u1b", ["q3"]],
    ]);
  });

  it("por TIPO de equipamento (inclusive cadastro antigo, só com o tipo do enum) e por EQUIPAMENTO; itens diferentes geram OS diferentes", async () => {
    const id = await rascunho(["q1", "qAntigo", "qChiller"]);
    await novoItem(id, { tipoEquipamentoId: "teSplit", intervaloMeses: 12 });                              // splits: anual
    await novoItem(id, { equipamentoId: "qChiller", tipoOsId: "toTrimestral", intervaloMeses: 6, diaExecucao: 20 }); // o chiller: semestral, dia 20
    await publicar(id);
    const os = await ordens(id);
    expect(os.map((o: any) => [o.dia, o.bruto.atividades[0].titulo, o.equipamentos])).toEqual([
      ["2026-11-20", "PMOC trimestral", ["qChiller"]],
      ["2026-11-25", "PMOC mensal", ["q1", "qAntigo"]],
      ["2027-05-20", "PMOC trimestral", ["qChiller"]],
    ]);
    expect((await ler(id)).semCronograma).toEqual([]);
  });

  it("equipamento INATIVO não gera manutenção; só os ativos entram na OS", async () => {
    await prisma.equipamento.update({ where: { id: "q2" }, data: { ativo: false } });
    const { id } = await publicado(["q1", "q2"], { intervaloMeses: 12 });
    expect((await ordens(id)).map((o: any) => o.equipamentos)).toEqual([["q1"]]);
    expect(await execucoes(id)).toBe(1);
    const tela = await ler(id);
    expect(tela.itens[0].equipamentos).toBe(1);
    // O formulário também só oferece o ativo (e conta só ele no tipo)
    expect(tela.opcoes.equipamentos.map((e: any) => e.id)).toEqual(["q1"]);
    expect(tela.opcoes.tiposEquipamento).toEqual([{ id: "teSplit", nome: "Split", equipamentos: 1 }]);
    expect(tela.opcoes.tiposOs.map((t: any) => t.nome)).toEqual(["Limpeza química", "PMOC mensal", "PMOC trimestral"]); // só os ativos, da própria empresa
  });

  it("todos os equipamentos do item inativos: nenhuma OS", async () => {
    await prisma.equipamento.updateMany({ where: { id: { in: ["q1", "q2"] } }, data: { ativo: false } });
    const { id } = await publicado();
    expect(await prisma.ordemServico.count()).toBe(0);
    expect((await ler(id)).previa).toMatchObject({ criar: 0 });
  });

  it("nunca gera no passado nem depois da expiração; a primeira é o primeiro 'dia de execução' no início ou depois dele", async () => {
    // Item que começou há meses (01/06): o que já passou não é gerado
    const { id } = await publicado(["q1"], { dataInicio: "2026-06-01", diaExecucao: 12, intervaloMeses: 2 });
    // Bimestral a partir de junho, dia 12: jun, ago, out (passados), 12/dez… Hoje é 12/11: 12/12 é a primeira
    expect((await ordens(id)).map((o: any) => o.dia)).toEqual(["2026-12-12", "2027-02-12", "2027-04-12", "2027-06-12", "2027-08-12", "2027-10-12"]);

    // A execução que cai HOJE ainda é gerada
    const { id: hoje } = await publicado(["q2"], { diaExecucao: 12, intervaloMeses: 12 });
    expect((await ordens(hoje)).map((o: any) => o.dia)).toEqual(["2026-11-12"]);

    // A que cai exatamente no dia da expiração entra; um dia depois, não
    const limite = await rascunho(["qChiller"], { dataExpiracao: new Date("2027-01-25T00:00:00Z") });
    await novoItem(limite);
    await publicar(limite, { dataExpiracao: "2027-01-25" });
    expect((await ordens(limite)).map((o: any) => o.dia)).toEqual(["2026-11-25", "2026-12-25", "2027-01-25"]);
  });

  it("plano EXPIRADO ou INATIVO: não gera, e 'Reagendar' é recusado com o motivo", async () => {
    const expirado = await rascunho(["q1"], { status: "PUBLICADO", dataInicio: new Date("2025-11-01T00:00:00Z"), dataExpiracao: new Date("2026-11-11T00:00:00Z") });
    await prisma.pmocCronograma.create({ data: { pmocId: expirado, tipoOsId: "toMensal", dataInicio: new Date("2025-11-01T00:00:00Z"), intervaloMeses: 1, diaExecucao: 25 } });
    expect(await ler(expirado)).toMatchObject({ motivo: "EXPIRADO", previa: { criar: 0 } });
    expect(await reagendar(expirado)).toMatchObject({ status: 409, json: { erro: "Plano expirado: o cronograma não gera mais OS." } });

    const { id } = await publicado(["q1"], { intervaloMeses: 12 });
    await prisma.pmoc.update({ where: { id }, data: { ativo: false } });
    expect(await reagendar(id)).toMatchObject({ status: 409, json: { erro: "PMOC inativo: reative antes de editar." } });
    expect((await ler(id)).motivo).toBe("INATIVO");
    expect(await chamar("cronograma", "POST", { id, corpo: item() })).toMatchObject({ status: 409 });
    expect(await prisma.ordemServico.count()).toBe(1); // só a do plano que estava vigente
  });

  /* ───────── idempotência ───────── */
  it("reagendar de novo NÃO duplica: mesmas OS, mesmas execuções, e a prévia diz que não há nada a fazer", async () => {
    const { id } = await publicado(["q1", "q2", "q3"]);
    const antes = (await ordens(id)).map((o: any) => o.id);
    expect(antes).toHaveLength(24);
    for (let i = 0; i < 3; i++) {
      const r = await reagendar(id);
      expect(r).toMatchObject({ status: 200, json: { resultado: { motivo: null, criadas: [], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0, mantidas: 0, aCancelar: 0 } } });
    }
    expect((await ordens(id)).map((o: any) => o.id)).toEqual(antes);
    expect(await prisma.ordemServico.count()).toBe(24);
    expect(await execucoes(id)).toBe(36);
    expect(await prisma.osHistorico.count()).toBe(24); // nenhuma entrada a mais no histórico
    expect((await ler(id)).previa).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
  });

  it("dois 'Reagendar' AO MESMO TEMPO não geram OS em dobro (trava por plano + chave única das execuções)", async () => {
    const id = await rascunho(["q1", "q2"]);
    await novoItem(id);
    await prisma.pmoc.update({ where: { id }, data: { status: "PUBLICADO" } }); // publicado sem passar pela geração automática
    const [a, b, c] = await Promise.all([reagendar(id), reagendar(id), reagendar(id)]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect([a, b, c].map((r) => r.json.resultado.criadas.length).sort((x, y) => x - y)).toEqual([0, 0, 12]);
    expect(await prisma.ordemServico.count()).toBe(12);
    expect(await execucoes(id)).toBe(24);
    expect(new Set((await prisma.ordemServico.findMany({ select: { numero: true } })).map((o: any) => o.numero)).size).toBe(12);
  });

  it("a chave única do banco recusa a mesma execução duas vezes (item + equipamento + competência)", async () => {
    const { id, itemId } = await publicado(["q1"], { intervaloMeses: 12 });
    await expect(prisma.pmocExecucao.create({ data: { pmocId: id, cronogramaId: itemId, equipamentoId: "q1", periodo: "2026-11", dataPrevista: AGORA } })).rejects.toThrow(/Unique constraint/);
  });

  /* ───────── Reagendar atividades ───────── */
  it("mudou o DIA de execução: salvar não mexe na agenda; 'Reagendar' muda a data das OS que ainda não começaram", async () => {
    const { id, itemId } = await publicado(["q1"], { intervaloMeses: 6 });
    const salvar = await chamar("item", "PUT", { id, itemId, corpo: item({ intervaloMeses: 6, diaExecucao: 27 }) });
    expect(salvar.json.gerado.criadas).toEqual([]);
    expect((await ordens(id)).map((o: any) => o.dia)).toEqual(["2026-11-25", "2027-05-25"]); // ainda nas datas antigas
    expect(salvar.json.cronograma.previa).toMatchObject({ mover: 2, criar: 0 });               // a tela mostra o que está pendente

    const r = await reagendar(id);
    expect(r.json.resultado).toMatchObject({ movidas: 2, criadas: [], canceladas: 0 });
    const os = await ordens(id);
    expect(os.map((o: any) => o.dia)).toEqual(["2026-11-27", "2027-05-27"]);
    expect(os[0].bruto.previsaoConclusao).toEqual(meioDia("2026-11-27"));
    expect(os[0].bruto.pmocExecucoes[0].dataPrevista).toEqual(meioDia("2026-11-27"));
    expect(os[0].bruto.historico.map((h: any) => [h.acao, h.detalhes])).toContainEqual(["OS reagendada pelo cronograma do PMOC", "Plano PMOC 2026 — Hospital: de 25/11/2026 para 27/11/2026."]);
    expect(await prisma.ordemServico.count()).toBe(2); // mudou a data das mesmas OS: nenhuma nova
  });

  it("não desfaz o que alguém ajustou à mão, não mexe em OS já iniciada, e não reagenda para o passado", async () => {
    const { id, itemId } = await publicado(["q1"], { intervaloMeses: 3 }); // 25/11, 25/02, 25/05, 25/08
    const [nov, fev, mai] = await ordens(id);
    // O escritório puxou a de fevereiro para o dia 20, à mão
    await prisma.atividadeOs.update({ where: { id: fev.atividadeId }, data: { dataAgendada: meioDia("2027-02-20") } });
    // A de maio já está em andamento
    await prisma.atividadeOs.update({ where: { id: mai.atividadeId }, data: { status: "EM_ANDAMENTO" } });
    await prisma.ordemServico.update({ where: { id: mai.id }, data: { status: "EM_ANDAMENTO" } });
    // O cronograma passa a ser no dia 5 (em novembro, o dia 5 já passou)
    const salvar = await chamar("item", "PUT", { id, itemId, corpo: item({ intervaloMeses: 3, diaExecucao: 5, dataInicio: "2026-11-01" }) });
    // Com o dia 5, cabe uma competência a mais antes da expiração (05/11/2027): salvar já cria essa OS
    expect(salvar.json.gerado.criadas).toHaveLength(1);
    const r = await reagendar(id);
    expect(r.json.resultado).toMatchObject({ movidas: 1, mantidas: 1, criadas: [], canceladas: 0, retirados: 0 });
    expect((await ordens(id)).map((o: any) => [o.dia, o.status]).sort()).toEqual([
      ["2026-11-25", "AGENDADA"],     // 05/11 já passou: fica onde está
      ["2027-02-20", "AGENDADA"],     // ajustada à mão: fica
      ["2027-05-25", "EM_ANDAMENTO"], // já começou: fica
      ["2027-08-05", "AGENDADA"],     // a única que o cronograma podia mudar
      ["2027-11-05", "AGENDADA"],     // a competência nova
    ]);
    expect(nov.id).toBe((await ordens(id))[0].id);
    // E continua sem mexer nelas da próxima vez (a ajustada à mão não vira "do cronograma")
    expect((await reagendar(id)).json.resultado).toMatchObject({ movidas: 0, mantidas: 1 });
  });

  it("equipamento INATIVADO depois de gerado: 'Reagendar' tira das OS que ainda não começaram; o que já foi atendido fica", async () => {
    const { id } = await publicado(["q1", "q2"], { intervaloMeses: 6 });
    const [nov] = await ordens(id);
    // Novembro: o técnico já atendeu o q2
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: nov.atividadeId, equipamentoId: "q2" }, data: { feito: true } });
    await prisma.equipamento.update({ where: { id: "q2" }, data: { ativo: false } });
    expect((await ler(id)).previa).toMatchObject({ retirar: 1, cancelar: 0, criar: 0 });

    const r = await reagendar(id);
    expect(r.json.resultado).toMatchObject({ retirados: 1, canceladas: 0, criadas: [] });
    const os = await ordens(id);
    expect(os.map((o: any) => [o.dia, o.equipamentos, o.execucoes, o.status])).toEqual([
      ["2026-11-25", ["q1", "q2"], ["q1", "q2"], "AGENDADA"], // q2 já atendido: fica no histórico da OS
      ["2027-05-25", ["q1"], ["q1"], "AGENDADA"],             // saiu da OS futura
    ]);
    expect(os[1].bruto.historico.map((h: any) => h.acao)).toContain("Equipamento retirado pelo cronograma do PMOC");
    expect(await prisma.equipamento.findUnique({ where: { id: "q2" } })).toMatchObject({ ativo: false }); // o cadastro não é apagado

    // Reativado: volta para a OS que ainda não começou, sem criar OS nova
    await prisma.equipamento.update({ where: { id: "q2" }, data: { ativo: true } });
    expect((await reagendar(id)).json.resultado).toMatchObject({ incluidos: 1, criadas: [] });
    expect((await ordens(id))[1]).toMatchObject({ equipamentos: ["q1", "q2"], execucoes: ["q1", "q2"] });
    expect(await prisma.ordemServico.count()).toBe(2);
  });

  it("OS que fica SEM equipamento é cancelada — mas só por quem tem 'Ordens de serviço › Excluir'", async () => {
    const { id } = await publicado(["q1", "q3"], { intervaloMeses: 12 }); // q3 é o único do Anexo: tem uma OS só dele
    await prisma.equipamento.update({ where: { id: "q3" }, data: { ativo: false } });

    // Quem só edita o PMOC: a OS do Anexo fica como está, e a resposta avisa que há OS a cancelar
    comPmoc(["visualizar", "editar"]);
    const sem = await reagendar(id);
    expect(sem.json.resultado).toMatchObject({ canceladas: 0, retirados: 0, aCancelar: 1 });
    expect((await ordens(id)).map((o: any) => [o.unidadeId, o.status, o.equipamentos])).toEqual([["u1", "AGENDADA", ["q1"]], ["u1b", "AGENDADA", ["q3"]]]);

    // Quem também pode cancelar OS: cancela (a OS não é apagada; o conteúdo fica para reabrir)
    comPmoc(["visualizar", "editar"], { ordens: ["visualizar", "excluir"] });
    const com = await reagendar(id);
    expect(com.json.resultado).toMatchObject({ canceladas: 1, retirados: 0, aCancelar: 0 });
    const anexo = await prisma.ordemServico.findFirst({ where: { unidadeId: "u1b" }, include: { atividades: { include: { equipamentos: true } }, historico: { orderBy: { criadoEm: "asc" } }, pmocExecucoes: true } });
    expect(anexo).toMatchObject({ status: "CANCELADA", pmocExecucoes: [] });
    expect(anexo.atividades[0].equipamentos.map((e: any) => e.equipamentoId)).toEqual(["q3"]);
    expect(anexo.historico.at(-1)).toMatchObject({ acao: "OS inativada (cancelada)", detalhes: "AGENDADA → CANCELADA — Motivo: cronograma do PMOC 2026 — Hospital (nenhum equipamento a atender nesta competência)." });
    expect(await prisma.ordemServico.count()).toBe(2);
    expect((await reagendar(id)).json.resultado).toMatchObject({ canceladas: 0, criadas: [], aCancelar: 0 }); // e fica assim
  });

  it("equipamento NOVO no plano: entra nas OS abertas do mesmo local; em outro local, ganha OS própria", async () => {
    const { id } = await publicado(["q1"], { intervaloMeses: 6 });
    expect((await chamar("equipamentos", "POST", { id, corpo: { equipamentoIds: ["q2", "q3"] } })).status).toBe(200);
    expect((await ler(id)).previa).toMatchObject({ incluir: 2, criar: 2 }); // a aba mostra a pendência
    const r = await reagendar(id);
    expect(r.json.resultado).toMatchObject({ incluidos: 2 });
    expect(r.json.resultado.criadas).toHaveLength(2);
    expect((await ordens(id)).map((o: any) => [o.dia, o.unidadeId, o.equipamentos])).toEqual([
      ["2026-11-25", "u1", ["q1", "q2"]], ["2026-11-25", "u1b", ["q3"]],
      ["2027-05-25", "u1", ["q1", "q2"]], ["2027-05-25", "u1b", ["q3"]],
    ]);
  });

  it("equipamento TIRADO do plano e item EXCLUÍDO: as OS futuras saem da agenda no 'Reagendar'; o item que já gerou OS fica guardado (inativo)", async () => {
    const { id, itemId } = await publicado(["q1", "q2"], { intervaloMeses: 6 });
    await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q2" });
    expect((await reagendar(id)).json.resultado).toMatchObject({ retirados: 2, canceladas: 0 });
    expect((await ordens(id)).map((o: any) => o.equipamentos)).toEqual([["q1"], ["q1"]]);

    const exc = await chamar("item", "DELETE", { id, itemId });
    expect(exc.json.cronograma).toMatchObject({ itens: [], semCronograma: ["q1"], previa: { cancelar: 2, retirar: 2 } });
    expect(await prisma.pmocCronograma.findUnique({ where: { id: itemId } })).toMatchObject({ ativo: false }); // não apaga: as OS continuam ligadas ao plano
    expect(await prisma.ordemServico.count({ where: { status: "AGENDADA" } })).toBe(2);                    // excluir o item não mexe na agenda sozinho
    expect((await reagendar(id)).json.resultado).toMatchObject({ canceladas: 2 });
    expect(await prisma.ordemServico.count({ where: { status: "CANCELADA" } })).toBe(2);
    expect(await chamar("item", "PUT", { id, itemId, corpo: item() })).toMatchObject({ status: 404 }); // item excluído não é editado

    // Item que nunca gerou OS é apagado de vez
    const limpo = await rascunho(["q1"]);
    const novo = (await novoItem(limpo)).json.cronograma.itens[0].id;
    await chamar("item", "DELETE", { id: limpo, itemId: novo });
    expect(await prisma.pmocCronograma.findUnique({ where: { id: novo } })).toBeNull();
  });

  it("mudou a FREQUÊNCIA: as competências que deixaram de existir saem, as que continuam ficam com a mesma OS", async () => {
    const { id, itemId } = await publicado(["q1"], { intervaloMeses: 3 }); // nov, fev, mai, ago
    const antes = await ordens(id);
    await chamar("item", "PUT", { id, itemId, corpo: item({ intervaloMeses: 6 }) }); // nov, mai
    expect((await reagendar(id)).json.resultado).toMatchObject({ canceladas: 2, criadas: [], movidas: 0 });
    const depois = await prisma.ordemServico.findMany({ where: { status: "AGENDADA" }, orderBy: { previsaoConclusao: "asc" }, select: { id: true } });
    expect(depois.map((o: any) => o.id)).toEqual([antes[0].id, antes[2].id]);
  });

  it("EXPIRAÇÃO: encurtar o plano tira as OS que passaram a ficar depois dela; estender gera as novas competências", async () => {
    const { id } = await publicado(["q1"], { intervaloMeses: 3 }); // 25/11, 25/02, 25/05, 25/08
    await publicar(id, { dataExpiracao: "2027-03-31" });
    expect((await ler(id)).previa).toMatchObject({ cancelar: 2 });
    await reagendar(id);
    expect((await prisma.ordemServico.findMany({ orderBy: { previsaoConclusao: "asc" }, select: { status: true } })).map((o: any) => o.status)).toEqual(["AGENDADA", "AGENDADA", "CANCELADA", "CANCELADA"]);

    // Estender: salvar o plano (publicado) já gera o que falta — as canceladas não voltam, nascem OS novas
    const r = await publicar(id, { dataExpiracao: "2027-11-30" });
    expect(r.json.osGeradas).toBe(3); // 25/05, 25/08 e 25/11/2027
    expect((await prisma.ordemServico.findMany({ where: { status: "AGENDADA" }, orderBy: { previsaoConclusao: "asc" }, select: { previsaoConclusao: true } })).map((o: any) => o.previsaoConclusao.toISOString().slice(0, 10)))
      .toEqual(["2026-11-25", "2027-02-25", "2027-05-25", "2027-08-25", "2027-11-25"]);
  });

  it("voltar para RASCUNHO não cancela nada: as OS já geradas ficam; só não se gera nem se reagenda mais", async () => {
    const { id } = await publicado(["q1"], { intervaloMeses: 6 });
    await chamar("plano", "PUT", { id, corpo: corpoPlano({ status: "RASCUNHO" }) });
    expect(await prisma.ordemServico.count({ where: { status: "AGENDADA" } })).toBe(2);
    expect((await reagendar(id)).status).toBe(409);
    expect(await ler(id)).toMatchObject({ motivo: "RASCUNHO", totais: { futuras: 2 } });
  });

  it("inativar o plano avisa quantas OS futuras do cronograma continuam na agenda", async () => {
    const { id } = await publicado(["q1"], { intervaloMeses: 6 });
    expect((await chamar("impacto", "GET", { id })).json.avisos).toContain("2 OS futura(s) geradas pelo cronograma continuam na agenda. Cancele pela OS as que não for atender.");
  });

  /* ───────── permissões ───────── */
  it("RBAC: ler o cronograma é 'visualizar'; criar, editar e excluir item e reagendar são 'editar'", async () => {
    const { id, itemId } = await publicado(["q1"], { intervaloMeses: 12 });
    comPmoc(["visualizar"]);
    expect((await chamar("cronograma", "GET", { id })).status).toBe(200);
    for (const r of [
      await chamar("cronograma", "POST", { id, corpo: item() }), await chamar("item", "PUT", { id, itemId, corpo: item() }),
      await chamar("item", "DELETE", { id, itemId }), await reagendar(id),
    ]) expect(r.status).toBe(403);
    comPmoc(["visualizar", "criar", "excluir"]); // criar e excluir PLANO não dão o cronograma
    for (const r of [await chamar("cronograma", "POST", { id, corpo: item() }), await reagendar(id), await chamar("item", "DELETE", { id, itemId })]) expect(r.status).toBe(403);
    expect(await prisma.pmocCronograma.count({ where: { ativo: true } })).toBe(1);
    expect(await prisma.ordemServico.count()).toBe(1);

    comPmoc(["visualizar", "editar"]);
    expect((await reagendar(id)).status).toBe(200);
    expect((await chamar("item", "PUT", { id, itemId, corpo: item({ intervaloMeses: 12 }) })).status).toBe(200);
    como(PRESETS.SUPERVISOR); // o perfil padrão de Supervisor edita o PMOC
    expect((await reagendar(id)).status).toBe(200);
  });

  it("sem o módulo PMOC (inclusive o técnico do app e quem só tem Ordens de serviço): 403 em tudo", async () => {
    const { id, itemId } = await publicado(["q1"], { intervaloMeses: 12 });
    for (const perfil of [montarPermissoes({ ordens: ["visualizar", "criar", "editar", "excluir"], equipamentos: ["visualizar"] }), PRESETS.FINANCEIRO, PRESETS.AUXILIAR]) {
      como(perfil);
      for (const r of [await chamar("cronograma", "GET", { id }), await chamar("cronograma", "POST", { id, corpo: item() }), await chamar("item", "PUT", { id, itemId, corpo: item() }), await chamar("item", "DELETE", { id, itemId }), await reagendar(id)]) expect(r.status).toBe(403);
    }
    como(PRESETS.TECNICO, "e1", { role: "TECNICO", tecnicoId: "t1" });
    for (const r of [await chamar("cronograma", "GET", { id }), await reagendar(id)]) expect(r.status).toBe(403);
    expect(await prisma.ordemServico.count()).toBe(1);
  });

  it("multiempresa: o cronograma de uma empresa não existe para a outra (404) e nada muda", async () => {
    const { id, itemId } = await publicado(["q1"], { intervaloMeses: 12 });
    como(permissoesTotais(), "e2");
    for (const r of [
      await chamar("cronograma", "GET", { id }), await chamar("cronograma", "POST", { id, corpo: item({ tipoOsId: "toE2" }) }),
      await chamar("item", "PUT", { id, itemId, corpo: item({ tipoOsId: "toE2" }) }), await chamar("item", "DELETE", { id, itemId }), await reagendar(id),
    ]) expect(r.status).toBe(404);
    expect(await prisma.pmocCronograma.findUnique({ where: { id: itemId } })).toMatchObject({ ativo: true, tipoOsId: "toMensal" });
    expect(await prisma.ordemServico.count({ where: { empresaId: "e1" } })).toBe(1);
    expect(await prisma.ordemServico.count({ where: { empresaId: "e2" } })).toBe(0);
  });
  /* ───────── Etapa 2.1: substituição ───────── */
  /** A limpeza química: semestral, dia 25, a partir de abril/2027 (o 6º mês do plano) */
  const QUIMICA = { tipoOsId: "toQuimica", intervaloMeses: 6, dataInicio: "2027-04-01" };
  /** Por competência, o que a agenda tem: [mês, serviço, equipamentos, status] */
  const agenda = async (id: string, so?: string) => (await ordens(id))
    .map((o: any) => [o.periodo.replace("PMOC:", ""), o.bruto.atividades[0].titulo, o.equipamentos, o.status])
    .filter((l: any[]) => !so || l[0] === so);
  const itemDe = async (id: string, tipoOsId: string) => (await ler(id)).itens.find((i: any) => i.tipoOs.id === tipoOsId);
  const MESES = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"];
  const ZERO = { motivo: null, criadas: [], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0, mantidas: 0, aCancelar: 0 };

  it("SUBSTITUIÇÃO mês a mês — mensal + química semestral: nos meses 1 a 5 só a leve; no 6º só a química; uma OS por mês", async () => {
    const id = await rascunho(["q1", "q2"]);
    await novoItem(id);          // preventiva leve, mensal
    await novoItem(id, QUIMICA); // limpeza química, semestral
    expect((await publicar(id)).status).toBe(200);

    const os = await agenda(id);
    expect(os.map((l: any[]) => l[0])).toEqual(MESES); // 12 OS, uma por mês — e não 14
    for (const [n, linha] of os.entries()) {
      const quimica = n === 5 || n === 11; // abril e outubro de 2027
      expect(linha, MESES[n]).toEqual([MESES[n], quimica ? "Limpeza química" : "PMOC mensal", ["q1", "q2"], "AGENDADA"]);
    }
    expect(await prisma.ordemServico.count()).toBe(12);
    expect(await execucoes(id)).toBe(24); // 12 meses × 2 equipamentos: uma execução por equipamento e mês
    // Nenhum equipamento tem duas execuções na mesma competência
    const repetidas = await prisma.pmocExecucao.groupBy({ by: ["equipamentoId", "periodo"], where: { pmocId: id }, _count: true, having: { equipamentoId: { _count: { gt: 1 } } } });
    expect(repetidas).toEqual([]);

    // A tela: a leve cede 4 execuções (2 equipamentos × abril e outubro); nada pendente
    const tela = await ler(id);
    expect(tela.itens.map((i: any) => [i.tipoOs.nome, i.substituidas, i.proxima])).toEqual([["PMOC mensal", 4, "2026-11-25"], ["Limpeza química", 0, "2027-04-25"]]);
    expect(tela.previa).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
    expect(tela.semCronograma).toEqual([]);
  });

  it("IDEMPOTENTE: publicar de novo e reagendar várias vezes não cria, não cancela e não escreve no histórico", async () => {
    const id = await rascunho(["q1", "q2"]);
    await novoItem(id);
    await novoItem(id, QUIMICA);
    await publicar(id);
    const antes = (await ordens(id)).map((o: any) => [o.id, o.status, o.dia, o.equipamentos]);
    const historico = await prisma.osHistorico.count();
    for (let i = 0; i < 3; i++) {
      expect(await reagendar(id)).toMatchObject({ status: 200, json: { resultado: ZERO } });
      expect((await publicar(id)).status).toBe(200); // publicar de novo roda a geração automática
    }
    const [a, b] = await Promise.all([reagendar(id), reagendar(id)]); // e dois ao mesmo tempo
    expect([a.json.resultado, b.json.resultado]).toEqual([ZERO, ZERO]);
    expect((await ordens(id)).map((o: any) => [o.id, o.status, o.dia, o.equipamentos])).toEqual(antes);
    expect(await prisma.ordemServico.count()).toBe(12);
    expect(await execucoes(id)).toBe(24);
    expect(await prisma.osHistorico.count()).toBe(historico);
  });

  it("é POR EQUIPAMENTO: a química só no q2 — no mês dela, o q2 vai na OS da química e os outros seguem na leve", async () => {
    const id = await rascunho(["q1", "q2", "q3"]); // q3 fica no Anexo (outro local)
    await novoItem(id);
    await novoItem(id, { ...QUIMICA, equipamentoId: "q2" });
    await publicar(id);
    expect(await agenda(id, "2027-03")).toEqual([["2027-03", "PMOC mensal", ["q1", "q2"], "AGENDADA"], ["2027-03", "PMOC mensal", ["q3"], "AGENDADA"]]);
    expect((await agenda(id, "2027-04")).sort()).toEqual([
      ["2027-04", "Limpeza química", ["q2"], "AGENDADA"], ["2027-04", "PMOC mensal", ["q1"], "AGENDADA"], ["2027-04", "PMOC mensal", ["q3"], "AGENDADA"],
    ]);
    expect((await itemDe(id, "toMensal")).substituidas).toBe(2); // só o q2, em abril e outubro
  });

  it("por TIPO de equipamento: a química dos chillers não tira a leve dos splits; se a leve fica sem ninguém no mês, a OS dela nem nasce", async () => {
    const id = await rascunho(["q1", "qChiller"]);
    await novoItem(id);
    await novoItem(id, { ...QUIMICA, tipoEquipamentoId: "teChiller" });
    await publicar(id);
    expect((await agenda(id, "2027-04")).sort()).toEqual([["2027-04", "Limpeza química", ["qChiller"], "AGENDADA"], ["2027-04", "PMOC mensal", ["q1"], "AGENDADA"]]);

    // Só o chiller no plano: em abril não existe OS da leve (ficaria vazia)
    const so = await rascunho(["qChiller"]);
    await novoItem(so);
    await novoItem(so, { ...QUIMICA, tipoEquipamentoId: "teChiller" });
    await publicar(so);
    expect(await agenda(so, "2027-04")).toEqual([["2027-04", "Limpeza química", ["qChiller"], "AGENDADA"]]);
    expect(await prisma.ordemServico.count({ where: { pmocExecucoes: { some: { pmocId: so } } } })).toBe(12);
  });

  it("DESEMPATE no mesmo intervalo: vale o item CRIADO PRIMEIRO (não o último salvo, nem o tipo de OS)", async () => {
    const id = await rascunho(["q1"]);
    await novoItem(id, { intervaloMeses: 6, tipoOsId: "toTrimestral", diaExecucao: 20 });
    await novoItem(id, { intervaloMeses: 6, tipoOsId: "toMensal" });
    const [primeiro, segundo] = (await ler(id)).itens;
    // Datas de criação explícitas (e o segundo editado por último): o que decide é quem foi criado antes
    await prisma.pmocCronograma.update({ where: { id: primeiro.id }, data: { criadoEm: new Date("2026-11-01T12:00:00Z") } });
    await prisma.pmocCronograma.update({ where: { id: segundo.id }, data: { criadoEm: new Date("2026-11-02T12:00:00Z"), atualizadoEm: new Date("2026-11-10T12:00:00Z") } });
    await publicar(id);
    expect(await agenda(id)).toEqual([["2026-11", "PMOC trimestral", ["q1"], "AGENDADA"], ["2027-05", "PMOC trimestral", ["q1"], "AGENDADA"]]);
    expect((await ler(id)).itens.map((i: any) => [i.tipoOs.nome, i.substituidas, i.proxima])).toEqual([["PMOC trimestral", 0, "2026-11-20"], ["PMOC mensal", 2, null]]);

    // Invertendo as datas de criação, inverte quem vale — e o 'Reagendar' troca as OS (cancela umas, cria outras) uma vez só
    await prisma.pmocCronograma.update({ where: { id: segundo.id }, data: { criadoEm: new Date("2026-10-01T12:00:00Z") } });
    expect((await reagendar(id)).json.resultado).toMatchObject({ canceladas: 2, criadas: [{}, {}] });
    expect((await agenda(id)).filter((l: any[]) => l[3] === "AGENDADA")).toEqual([["2026-11", "PMOC mensal", ["q1"], "AGENDADA"], ["2027-05", "PMOC mensal", ["q1"], "AGENDADA"]]);
    expect((await reagendar(id)).json.resultado).toEqual(ZERO);
  });

  it("a química entra DEPOIS de tudo gerado: salvar só cria a OS dela; 'Reagendar' cancela a OS da leve que ficou vazia, com o motivo no histórico", async () => {
    const { id } = await publicado(["q1", "q2"]); // a leve já gerou os 12 meses
    expect(await prisma.ordemServico.count()).toBe(12);

    const salvar = await novoItem(id, QUIMICA);
    expect(salvar.json.gerado.criadas).toHaveLength(2); // abril e outubro
    expect(salvar.json.gerado).toMatchObject({ canceladas: 0, retirados: 0 }); // salvar nunca cancela nem retira sozinho
    // Até o 'Reagendar', abril tem as duas OS — e a tela mostra o que está pendente
    expect((await agenda(id, "2027-04")).sort()).toEqual([["2027-04", "Limpeza química", ["q1", "q2"], "AGENDADA"], ["2027-04", "PMOC mensal", ["q1", "q2"], "AGENDADA"]]);
    expect(salvar.json.cronograma.previa).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 4, cancelar: 2, mantidas: 0, substituidos: 4 }); // os 4 saem por substituição

    // Quem só edita o PMOC não cancela OS: fica avisado, nada muda
    comPmoc(["visualizar", "editar"]);
    expect((await reagendar(id)).json.resultado).toMatchObject({ canceladas: 0, retirados: 0, aCancelar: 2 });
    expect(await prisma.ordemServico.count({ where: { status: "CANCELADA" } })).toBe(0);

    // Com "Ordens de serviço › Excluir": as duas OS da leve (abril e outubro) são canceladas — não apagadas
    comPmoc(["visualizar", "editar"], { ordens: ["visualizar", "excluir"] });
    expect((await reagendar(id)).json.resultado).toMatchObject({ canceladas: 2, retirados: 0, criadas: [], aCancelar: 0 });
    expect(await prisma.ordemServico.count()).toBe(14);
    const canceladas = await prisma.ordemServico.findMany({ where: { status: "CANCELADA" }, orderBy: { previsaoConclusao: "asc" }, include: { atividades: { include: { equipamentos: true } }, historico: { orderBy: { criadoEm: "asc" } }, pmocExecucoes: true } });
    expect(canceladas.map((o: any) => [o.periodoRecorrencia, o.atividades[0].titulo, o.pmocExecucoes.length, o.atividades[0].equipamentos.length])).toEqual([
      ["PMOC:2027-04", "PMOC mensal", 0, 2], ["PMOC:2027-10", "PMOC mensal", 0, 2], // o conteúdo da OS fica (reabrir devolve tudo)
    ]);
    expect(canceladas[0].historico.at(-1)).toMatchObject({ acao: "OS inativada (cancelada)", detalhes: "AGENDADA → CANCELADA — Motivo: cronograma do PMOC 2026 — Hospital (substituída por Limpeza química nesta competência)." });
    // Na agenda ativa: uma OS por mês, a química em abril e outubro
    const ativas = (await agenda(id)).filter((l: any[]) => l[3] === "AGENDADA");
    expect(ativas.map((l: any[]) => l[1])).toEqual(MESES.map((_, n) => (n === 5 || n === 11 ? "Limpeza química" : "PMOC mensal")));

    // E não fica em looping: reagendar de novo não recria a leve de abril nem cancela mais nada
    const historico = await prisma.osHistorico.count();
    for (let i = 0; i < 3; i++) expect((await reagendar(id)).json.resultado).toEqual(ZERO);
    expect(await prisma.ordemServico.count()).toBe(14);
    expect(await prisma.osHistorico.count()).toBe(historico);
    expect((await ler(id)).previa).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
  });

  it("química PARCIAL que entra depois: o equipamento sai da OS da leve (que continua com os outros) e o histórico diz por quê", async () => {
    const { id } = await publicado(["q1", "q2"]);
    await novoItem(id, { ...QUIMICA, equipamentoId: "q2" });
    expect((await reagendar(id)).json.resultado).toMatchObject({ retirados: 2, canceladas: 0, criadas: [] });
    expect((await agenda(id, "2027-04")).sort()).toEqual([["2027-04", "Limpeza química", ["q2"], "AGENDADA"], ["2027-04", "PMOC mensal", ["q1"], "AGENDADA"]]);
    const leve = (await ordens(id)).find((o: any) => o.periodo === "PMOC:2027-04" && o.bruto.atividades[0].titulo === "PMOC mensal");
    expect(leve.execucoes).toEqual(["q1"]);
    expect(leve.bruto.historico.at(-1)).toMatchObject({ acao: "Equipamento retirado pelo cronograma do PMOC", detalhes: "Plano PMOC 2026 — Hospital: 1 equipamento(s) retirado(s) (nesta competência, atendido(s) por Limpeza química)." });
    expect((await reagendar(id)).json.resultado).toEqual(ZERO);
  });

  it("a leve do mês JÁ COMEÇOU quando a química entra: fica como histórico; depois, a química EXCLUÍDA devolve a leve dos meses seguintes", async () => {
    const { id } = await publicado(["q1"]);
    const abril = (await ordens(id)).find((o: any) => o.periodo === "PMOC:2027-04");
    await prisma.ordemServico.update({ where: { id: abril.id }, data: { status: "EM_ANDAMENTO" } });
    await novoItem(id, QUIMICA);
    expect((await reagendar(id)).json.resultado).toMatchObject({ canceladas: 1, retirados: 0 }); // só a de outubro
    expect((await agenda(id, "2027-04")).sort()).toEqual([["2027-04", "Limpeza química", ["q1"], "AGENDADA"], ["2027-04", "PMOC mensal", ["q1"], "EM_ANDAMENTO"]]);
    expect(await agenda(id, "2027-10")).toEqual([["2027-10", "Limpeza química", ["q1"], "AGENDADA"]]);
    expect(await prisma.ordemServico.findMany({ where: { status: "CANCELADA" }, select: { periodoRecorrencia: true, descricao: true } })).toEqual([{ periodoRecorrencia: "PMOC:2027-10", descricao: "PMOC mensal — PMOC 2026 — Hospital (10/2027)" }]);

    // Excluir a química: as OS dela saem e a leve de outubro volta a ser gerada (uma OS nova; a cancelada fica como está)
    const quimica = await itemDe(id, "toQuimica");
    await chamar("item", "DELETE", { id, itemId: quimica.id });
    const r = (await reagendar(id)).json.resultado;
    expect(r).toMatchObject({ canceladas: 2, aCancelar: 0 });
    expect(r.criadas).toHaveLength(1);
    expect(await agenda(id, "2027-10")).toEqual([["2027-10", "PMOC mensal", ["q1"], "AGENDADA"]]);
    expect(await agenda(id, "2027-04")).toEqual([["2027-04", "PMOC mensal", ["q1"], "EM_ANDAMENTO"]]);
    expect(await prisma.ordemServico.count({ where: { status: "CANCELADA" } })).toBe(3); // a leve de outubro (antes) e as duas da química
    expect((await reagendar(id)).json.resultado).toEqual(ZERO);
  });

  /* ───────── Etapa 2.1: fim de semana ───────── */
  // Dia 14: 14/11/2026 é sábado, 14/12 é segunda, 14/01/2027 é quinta, 14/02 e 14/03 são domingos
  const ATE_MARCO = { dataExpiracao: "2027-03-31" };
  const planoDia14 = async (fimSemana?: string) => {
    const id = await rascunho(["q1"], { dataExpiracao: new Date("2027-03-31T00:00:00Z") });
    const corpo: Record<string, unknown> = { ...item({ diaExecucao: 14 }) };
    if (fimSemana) corpo.fimSemana = fimSemana; else delete corpo.fimSemana;
    const r = await chamar("cronograma", "POST", { id, corpo });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect((await publicar(id, ATE_MARCO)).status).toBe(200);
    return { id, itemId: r.json.cronograma.itens[0].id as string };
  };
  const datas = async (id: string) => (await ordens(id)).map((o: any) => o.dia);

  it("FIM DE SEMANA nas três opções: manter, adiantar para a sexta e postergar para a segunda — a competência não muda", async () => {
    const manter = await planoDia14("MANTER"), adiantar = await planoDia14("ADIANTAR"), postergar = await planoDia14("POSTERGAR");
    expect(await datas(manter.id)).toEqual(["2026-11-14", "2026-12-14", "2027-01-14", "2027-02-14", "2027-03-14"]);
    expect(await datas(adiantar.id)).toEqual(["2026-11-13", "2026-12-14", "2027-01-14", "2027-02-12", "2027-03-12"]);
    expect(await datas(postergar.id)).toEqual(["2026-11-16", "2026-12-14", "2027-01-14", "2027-02-15", "2027-03-15"]);
    for (const p of [manter, adiantar, postergar]) expect((await ordens(p.id)).map((o: any) => o.periodo)).toEqual(["PMOC:2026-11", "PMOC:2026-12", "PMOC:2027-01", "PMOC:2027-02", "PMOC:2027-03"]);
    // A OS inteira anda junto: atividade, previsão e a data prevista da execução, ao meio-dia de Brasília
    const [seg] = await ordens(postergar.id);
    expect(seg.bruto.atividades[0].dataAgendada).toEqual(meioDia("2026-11-16"));
    expect(seg.bruto.previsaoConclusao).toEqual(meioDia("2026-11-16"));
    expect(seg.bruto.pmocExecucoes[0]).toMatchObject({ periodo: "2026-11", dataPrevista: meioDia("2026-11-16") });
    expect((await ler(postergar.id)).itens[0]).toMatchObject({ fimSemana: "POSTERGAR", proxima: "2026-11-16" });
    expect((await ler(adiantar.id)).itens[0]).toMatchObject({ fimSemana: "ADIANTAR", proxima: "2026-11-13" });
  });

  it("item NOVO sem a opção recebe POSTERGAR (o padrão proposto); item que já existia no banco continua MANTER", async () => {
    const novo = await planoDia14();
    expect((await ler(novo.id)).itens[0].fimSemana).toBe("POSTERGAR");
    expect(await datas(novo.id)).toEqual(["2026-11-16", "2026-12-14", "2027-01-14", "2027-02-15", "2027-03-15"]);

    // Como os itens gravados antes da Etapa 2.1: a coluna nasce com o padrão do banco
    const id = await rascunho(["q1"], { dataExpiracao: new Date("2027-03-31T00:00:00Z") });
    await prisma.pmocCronograma.create({ data: { pmocId: id, tipoOsId: "toMensal", dataInicio: new Date("2026-11-12T00:00:00Z"), intervaloMeses: 1, diaExecucao: 14 } });
    await publicar(id, ATE_MARCO);
    expect((await ler(id)).itens[0].fimSemana).toBe("MANTER");
    expect(await datas(id)).toEqual(["2026-11-14", "2026-12-14", "2027-01-14", "2027-02-14", "2027-03-14"]);
  });

  it("editar: sem a opção no pedido fica a que estava; mudar a opção não mexe na agenda ao salvar — 'Reagendar' leva as OS para a data nova", async () => {
    const { id, itemId } = await planoDia14("MANTER");
    const { fimSemana: _fora, ...semOpcao } = item({ diaExecucao: 14 });
    expect((await chamar("item", "PUT", { id, itemId, corpo: semOpcao })).json.cronograma.itens[0].fimSemana).toBe("MANTER");

    const salvar = await chamar("item", "PUT", { id, itemId, corpo: item({ diaExecucao: 14, fimSemana: "POSTERGAR" }) });
    expect(salvar.json.cronograma.itens[0].fimSemana).toBe("POSTERGAR");
    expect(await datas(id)).toEqual(["2026-11-14", "2026-12-14", "2027-01-14", "2027-02-14", "2027-03-14"]); // ainda como estavam
    expect(salvar.json.cronograma.previa).toMatchObject({ mover: 3, criar: 0, cancelar: 0 });

    expect((await reagendar(id)).json.resultado).toMatchObject({ movidas: 3, criadas: [], canceladas: 0 });
    expect(await datas(id)).toEqual(["2026-11-16", "2026-12-14", "2027-01-14", "2027-02-15", "2027-03-15"]);
    expect((await ordens(id))[0].bruto.historico.map((h: any) => [h.acao, h.detalhes])).toContainEqual(["OS reagendada pelo cronograma do PMOC", "Plano PMOC 2026 — Hospital: de 14/11/2026 para 16/11/2026."]);
    expect((await reagendar(id)).json.resultado).toEqual(ZERO);
    expect(await prisma.ordemServico.count()).toBe(5);

    // A sexta 13/11 ainda é de hoje em diante: adiantar também é aplicado; valor inválido é recusado
    await chamar("item", "PUT", { id, itemId, corpo: item({ diaExecucao: 14, fimSemana: "ADIANTAR" }) });
    expect((await reagendar(id)).json.resultado).toMatchObject({ movidas: 3 });
    expect(await datas(id)).toEqual(["2026-11-13", "2026-12-14", "2027-01-14", "2027-02-12", "2027-03-12"]);
    const invalido = await chamar("item", "PUT", { id, itemId, corpo: item({ diaExecucao: 14, fimSemana: "ANTECIPAR" }) });
    expect(invalido).toMatchObject({ status: 400, json: { erro: "Escolha o que fazer no fim de semana." } });
    expect((await ler(id)).itens[0].fimSemana).toBe("ADIANTAR");
  });

  it("substituição + fim de semana: a química postergada para a segunda continua sendo a do mês e substitui a leve", async () => {
    const id = await rascunho(["q1"]);
    await novoItem(id);                                        // leve: dia 25, manter
    await novoItem(id, { ...QUIMICA, fimSemana: "POSTERGAR" }); // 25/04/2027 é domingo: vai para segunda, 26/04
    await publicar(id);
    expect((await ordens(id)).filter((o: any) => o.periodo === "PMOC:2027-04").map((o: any) => [o.dia, o.bruto.atividades[0].titulo])).toEqual([["2027-04-26", "Limpeza química"]]);
  });

  it("RBAC da Etapa 2.1: a opção de fim de semana só muda com 'PMOC › Editar'; quem só visualiza lê (inclusive o que foi substituído); sem o módulo, 403", async () => {
    const { id, itemId } = await planoDia14("MANTER");
    comPmoc(["visualizar"]);
    expect((await chamar("item", "PUT", { id, itemId, corpo: item({ diaExecucao: 14, fimSemana: "POSTERGAR" }) })).status).toBe(403);
    expect((await chamar("cronograma", "POST", { id, corpo: item(QUIMICA) })).status).toBe(403);
    const lido = await chamar("cronograma", "GET", { id });
    expect(lido.status).toBe(200);
    expect(lido.json.itens[0]).toMatchObject({ fimSemana: "MANTER", substituidas: 0 });
    for (const perfil of [montarPermissoes({ ordens: ["visualizar", "criar", "editar", "excluir"] }), PRESETS.FINANCEIRO]) {
      como(perfil);
      expect((await chamar("item", "PUT", { id, itemId, corpo: item({ diaExecucao: 14, fimSemana: "POSTERGAR" }) })).status).toBe(403);
      expect((await chamar("cronograma", "GET", { id })).status).toBe(403);
    }
    como(PRESETS.TECNICO, "e1", { role: "TECNICO", tecnicoId: "t1" });
    expect((await chamar("item", "PUT", { id, itemId, corpo: item({ diaExecucao: 14, fimSemana: "POSTERGAR" }) })).status).toBe(403);
    expect((await prisma.pmocCronograma.findUnique({ where: { id: itemId } })).fimSemana).toBe("MANTER");
    expect(await datas(id)).toEqual(["2026-11-14", "2026-12-14", "2027-01-14", "2027-02-14", "2027-03-14"]);
  });
});
