/**
 * PMOC — RENOVAÇÃO anual, de ponta a ponta no servidor: rotas de verdade (GET/POST
 * /api/pmocs/[id]/renovacao e o histórico) sobre PostgreSQL de verdade.
 *
 * O que se prova: o plano novo nasce em RASCUNHO com cliente, unidade, RT, texto, os equipamentos
 * ATIVOS e o cronograma inteiro deslocado para a nova vigência; NÃO leva ART, link público,
 * histórico, avisos nem execuções/OS; o plano de origem não muda; os dois ficam ligados pelo
 * histórico; e só quem tem "PMOC › Editar", na própria empresa, renova.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";
import { execucoesDesejadas } from "@/lib/pmoc-cronograma";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pmoc_renov_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 20/10/2027, 12:00 em Brasília: o plano de 2027 está a 22 dias de expirar */
const AGORA = new Date("2027-10-20T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", extra: Record<string, unknown> = {}) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, empresaNome: "Empresa", role: "OPERADOR", permissoes, tecnicoId: null, ...extra } };
};
const comPmoc = (acoes: Acao[]) => como(montarPermissoes({ pmoc: acoes }));
const semModulo = () => como(montarPermissoes({ ordens: ["visualizar", "criar", "editar", "excluir"], equipamentos: ["visualizar", "editar"] }));
const tecnicoDoApp = () => como(PRESETS.TECNICO, "e1", { role: "TECNICO", tecnicoId: "t1" });

const ROTAS = { renovacao: "api/pmocs/[id]/renovacao", historico: "api/pmocs/[id]/historico", copia: "api/pmocs/[id]/copia" } as const;
async function chamar(rota: keyof typeof ROTAS, metodo: string, id: string, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const NOVA = { nome: "PMOC 2028 — Hospital", dataInicio: "2027-11-12", dataExpiracao: "2028-11-11" };
const ART = "data:application/pdf;base64,JVBERi0xLjQK";

describe.skipIf(!URL_PG)("PMOC — renovação anual (PostgreSQL real)", () => {
  let prisma: any;
  /**
   * O plano de 2027, publicado, com tudo o que NÃO pode ir junto (ART, link público, aviso, histórico,
   * execução) e o cronograma em camadas: leve mensal em todos, química semestral nos splits a partir de
   * abril/2027, anual só no q2, trimestral só no q3 e um item excluído.
   */
  const plano = async (extra: Record<string, unknown> = {}, empresaId = "e1") => {
    const e1 = empresaId === "e1";
    const id = (await prisma.pmoc.create({ data: {
      empresaId, clienteId: e1 ? "c1" : "cE2", unidadeId: e1 ? "u1" : "uE2", nome: e1 ? "PMOC 2027 — Hospital" : "PMOC da outra empresa", status: "PUBLICADO",
      descricao: "Texto técnico próprio deste hospital.", responsavelTecnicoId: e1 ? "t1" : null, rtNome: "Eng. Paula Reis", rtCrea: "SP-5061234567",
      artNumero: "28027230241234567", artArquivo: ART, artArquivoNome: "art-2027.pdf", artArquivoTipo: "application/pdf", artArquivoTamanho: 9,
      tokenPublico: `token-publico-do-plano-${empresaId}-${Math.random().toString(36).slice(2)}`,
      dataInicio: dia("2026-11-12"), dataExpiracao: dia("2027-11-11"),
      equipamentos: { create: (e1 ? ["q1", "q2", "q3"] : ["qE2"]).map((equipamentoId) => ({ equipamentoId })) },
      cronograma: { create: e1 ? [
        { id: `leve-${Math.random()}`, tipoOsId: "toLeve", dataInicio: dia("2026-11-12"), intervaloMeses: 1, diaExecucao: 25, fimSemana: "POSTERGAR", criadoEm: new Date("2026-11-01T12:00:00Z") },
        { tipoOsId: "toQuimica", tipoEquipamentoId: "teSplit", dataInicio: dia("2027-04-01"), intervaloMeses: 6, diaExecucao: 25, fimSemana: "POSTERGAR", criadoEm: new Date("2026-11-02T12:00:00Z") },
        { tipoOsId: "toAnual", equipamentoId: "q2", dataInicio: dia("2027-02-15"), intervaloMeses: 12, diaExecucao: 10, fimSemana: "ADIANTAR", criadoEm: new Date("2026-11-03T12:00:00Z") },
        { tipoOsId: "toLeve", equipamentoId: "q3", dataInicio: dia("2026-12-01"), intervaloMeses: 3, diaExecucao: 5, fimSemana: "MANTER", criadoEm: new Date("2026-11-04T12:00:00Z") },
        { tipoOsId: "toAnual", dataInicio: dia("2026-11-12"), intervaloMeses: 2, diaExecucao: 8, fimSemana: "MANTER", ativo: false, criadoEm: new Date("2026-11-05T12:00:00Z") },
      ] : [] },
      ...extra,
    }, select: { id: true } })).id as string;
    if (e1 && !("cronograma" in extra)) {
      const leve = await prisma.pmocCronograma.findFirst({ where: { pmocId: id, tipoOsId: "toLeve", equipamentoId: null } });
      await prisma.pmocExecucao.create({ data: { pmocId: id, cronogramaId: leve.id, equipamentoId: "q1", periodo: "2026-11", dataPrevista: new Date("2026-11-25T15:00:00Z") } });
    }
    await prisma.pmocAviso.create({ data: { pmocId: id, tipo: "VENCENDO", dataExpiracao: dia("2027-11-11") } });
    await prisma.pmocHistorico.createMany({ data: [{ pmocId: id, usuarioId: e1 ? "uA" : "uB", acao: "Plano publicado" }, { pmocId: id, acao: "Documento enviado por WhatsApp", detalhes: "Maria · (11) 97777-1234" }] });
    return id;
  };
  const ler = (id: string) => prisma.pmoc.findUnique({ where: { id }, include: { equipamentos: true, cronograma: { orderBy: [{ criadoEm: "asc" }, { id: "asc" }] }, historico: { orderBy: [{ criadoEm: "asc" }, { id: "asc" }] }, avisos: true, execucoes: true } });
  const itens = (p: any) => p.cronograma.map((i: any) => [i.tipoOsId, i.tipoEquipamentoId, i.equipamentoId, iso(i.dataInicio), i.intervaloMeses, i.diaExecucao, i.fimSemana, i.ativo]);
  const totalDePlanos = () => prisma.pmoc.count();
  const historicoDaTela = async (id: string) => (await chamar("historico", "GET", id)).json.historico as { acao: string; detalhes: string | null; plano: { id: string; nome: string } | null; usuario: string | null }[];

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com" }, { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" }, { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" }] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" }, { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" }] });
    await prisma.unidade.createMany({ data: [{ id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "uE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" }] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "Eng. Paula Reis", cpf: "1", telefone: "1", crea: "SP-5061234567" } });
    await prisma.tipoOs.createMany({ data: [
      { id: "toLeve", empresaId: "e1", nome: "Manutenção Preventiva" }, { id: "toQuimica", empresaId: "e1", nome: "Limpeza Química" }, { id: "toAnual", empresaId: "e1", nome: "Revisão Anual" },
    ] });
    await prisma.tipoEquipamentoCustom.createMany({ data: [
      { id: "teSplit", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" }, { id: "teE2", empresaId: "e2", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" },
    ] });
    const eq = (id: string, unidadeId: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: unidadeId === "uE2" ? "e2" : "e1", unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", tipoEquipamentoId: unidadeId === "uE2" ? "teE2" : "teSplit", ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("q1", "u1", { patrimonio: "AC-001", nome: "Split da recepção" }), eq("q2", "u1", { patrimonio: "AC-002", nome: "Split UTI 1" }),
      eq("q3", "u1", { patrimonio: "AC-003", nome: null }), eq("qE2", "uE2", { patrimonio: "ZZ-900", nome: "Equipamento da outra empresa" }),
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
    await prisma.equipamento.updateMany({ data: { ativo: true } });
    como();
  });

  it("PRÉVIA: propõe o dia seguinte à expiração + 1 ano e o nome com o ano novo; lista equipamentos e itens (sem o excluído)", async () => {
    await prisma.equipamento.update({ where: { id: "q3" }, data: { ativo: false } });
    const id = await plano();
    const r = await chamar("renovacao", "GET", id);
    expect(r.status).toBe(200);
    expect(r.json.pmoc).toEqual({ id, nome: "PMOC 2027 — Hospital", dataInicio: "2026-11-12", dataExpiracao: "2027-11-11" });
    expect(r.json.proposta).toEqual({ nome: "PMOC 2028 — Hospital", dataInicio: "2027-11-12", dataExpiracao: "2028-11-11" });
    expect(r.json.equipamentos).toEqual([
      { id: "q1", rotulo: "AC-001 · Split da recepção", ativo: true }, { id: "q2", rotulo: "AC-002 · Split UTI 1", ativo: true }, { id: "q3", rotulo: "AC-003 · LG S4", ativo: false },
    ]);
    expect(r.json.itens.map((i: any) => [i.servico, i.aplicaA, i.dataInicio, i.intervaloMeses, i.diaExecucao, i.fimSemana])).toEqual([
      ["Manutenção Preventiva", "Todos os equipamentos", "2026-11-12", 1, 25, "POSTERGAR"],
      ["Limpeza Química", "Split", "2027-04-01", 6, 25, "POSTERGAR"],
      ["Revisão Anual", "AC-002 · Split UTI 1", "2027-02-15", 12, 10, "ADIANTAR"],
      ["Manutenção Preventiva", "AC-003 · LG S4", "2026-12-01", 3, 5, "MANTER"],
    ]);
    expect(r.json.renovacoes).toEqual([]);
    expect(await totalDePlanos()).toBe(1); // a prévia só lê
  });

  it("RENOVA: plano NOVO em rascunho, com cliente, unidade, RT e texto; equipamentos ATIVOS; cronograma inteiro com as datas na nova vigência", async () => {
    await prisma.equipamento.update({ where: { id: "q3" }, data: { ativo: false } });
    const id = await plano();
    const r = await chamar("renovacao", "POST", id, NOVA);
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: expect.any(String), equipamentos: 2, itens: 3, equipamentosFora: 1, itensFora: 1 });
    expect(r.json.id).not.toBe(id);
    const n = await ler(r.json.id);
    expect(n).toMatchObject({
      empresaId: "e1", status: "RASCUNHO", ativo: true, nome: "PMOC 2028 — Hospital", clienteId: "c1", unidadeId: "u1", criadoPorId: "uA",
      descricao: "Texto técnico próprio deste hospital.", responsavelTecnicoId: "t1", rtNome: "Eng. Paula Reis", rtCrea: "SP-5061234567",
    });
    expect([iso(n.dataInicio), iso(n.dataExpiracao)]).toEqual(["2027-11-12", "2028-11-11"]);
    // equipamentos: só os ativos (o q3 está inativo)
    expect(n.equipamentos.map((e: any) => e.equipamentoId).sort()).toEqual(["q1", "q2"]);
    // cronograma: a leve começa com o plano novo; a química e a anual, no mesmo dia e mês do ano seguinte;
    // o item do q3 (inativo) e o item excluído não entram
    expect(itens(n)).toEqual([
      ["toLeve", null, null, "2027-11-12", 1, 25, "POSTERGAR", true],
      ["toQuimica", "teSplit", null, "2028-04-01", 6, 25, "POSTERGAR", true],
      ["toAnual", null, "q2", "2028-02-15", 12, 10, "ADIANTAR", true],
    ]);
  });

  it("NÃO leva: ART (número e arquivo), link público, avisos, execuções nem OS — e nenhuma OS é criada", async () => {
    const id = await plano();
    const osAntes = await prisma.ordemServico.count();
    const n = await ler((await chamar("renovacao", "POST", id, NOVA)).json.id);
    expect({ artNumero: n.artNumero, artArquivo: n.artArquivo, artArquivoNome: n.artArquivoNome, artArquivoTipo: n.artArquivoTipo, artArquivoTamanho: n.artArquivoTamanho, tokenPublico: n.tokenPublico })
      .toEqual({ artNumero: null, artArquivo: null, artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null, tokenPublico: null });
    expect(n.avisos).toEqual([]);
    expect(n.execucoes).toEqual([]);
    expect(await prisma.ordemServico.count()).toBe(osAntes);
    // o histórico antigo (publicação, envio) não vai: o plano novo começa só com a linha da renovação
    expect(n.historico.map((h: any) => h.acao)).toEqual(["Renovado a partir de PMOC 2027 — Hospital"]);
  });

  it("o plano de ORIGEM não muda: status, ART, link, equipamentos, cronograma, aviso e execução continuam como estavam", async () => {
    const id = await plano();
    const antes = await ler(id);
    await chamar("renovacao", "POST", id, NOVA);
    const depois = await ler(id);
    const semHistorico = (p: any) => ({ ...p, historico: undefined });
    expect(semHistorico(depois)).toEqual(semHistorico(antes));
    expect(depois.historico.slice(0, antes.historico.length)).toEqual(antes.historico);
    expect(depois.historico).toHaveLength(antes.historico.length + 1);
  });

  it("HISTÓRICO nos dois planos, com o link de um para o outro; a marca do link não aparece no texto", async () => {
    await prisma.equipamento.update({ where: { id: "q3" }, data: { ativo: false } });
    const id = await plano();
    const novoId = (await chamar("renovacao", "POST", id, NOVA)).json.id;
    const doNovo = await historicoDaTela(novoId);
    expect(doNovo).toEqual([expect.objectContaining({
      acao: "Renovado a partir de PMOC 2027 — Hospital", usuario: "Ana Souza", plano: { id, nome: "PMOC 2027 — Hospital" },
      detalhes: "Vigência anterior: 12/11/2026 a 11/11/2027. Levou 2 equipamentos e 3 itens do cronograma. Ficaram de fora: 1 equipamento inativo e 1 item do cronograma. A ART não é levada.",
    })]);
    const doAntigo = await historicoDaTela(id);
    expect(doAntigo[0]).toMatchObject({
      acao: "Renovação gerada: PMOC 2028 — Hospital", usuario: "Ana Souza", plano: { id: novoId, nome: "PMOC 2028 — Hospital" },
      detalhes: "Nova vigência: 12/11/2027 a 11/11/2028. O plano novo nasce em rascunho.",
    });
    // as linhas comuns continuam sem link
    expect(doAntigo.slice(1).map((h) => [h.acao, h.detalhes, h.plano])).toEqual([["Documento enviado por WhatsApp", "Maria · (11) 97777-1234", null], ["Plano publicado", null, null]]);
    // no banco, o id do outro plano fica na última linha dos detalhes
    const cru = await prisma.pmocHistorico.findFirst({ where: { pmocId: id, acao: { startsWith: "Renovação gerada" } } });
    expect(cru.detalhes.endsWith(`\n[pmoc:${novoId}]`)).toBe(true);
    // o plano novo foi renomeado: o link mostra o nome de agora
    await prisma.pmoc.update({ where: { id: novoId }, data: { nome: "PMOC 2028 — Hospital (revisado)" } });
    expect((await historicoDaTela(id))[0].plano).toEqual({ id: novoId, nome: "PMOC 2028 — Hospital (revisado)" });
  });

  it("vigência e nome MUDADOS no diálogo: os itens andam os mesmos meses que o início; o que passaria da expiração fica de fora", async () => {
    const id = await plano();
    // começa em janeiro/2028 (14 meses depois) e vale só 6 meses
    const r = await chamar("renovacao", "POST", id, { nome: "  Plano do Hospital — 1º semestre  ", dataInicio: "2028-01-10", dataExpiracao: "2028-07-09" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ equipamentos: 3, itens: 4, itensFora: 0 });
    const n = await ler(r.json.id);
    expect(n.nome).toBe("Plano do Hospital — 1º semestre");
    expect(itens(n).map((i: any) => [i[0], i[2], i[3]])).toEqual([
      ["toLeve", null, "2028-01-10"],   // começava com o plano → começa com o plano novo
      ["toQuimica", null, "2028-06-01"], // abril/2027 + 14 meses
      ["toAnual", "q2", "2028-04-15"],  // fevereiro/2027 + 14 meses
      ["toLeve", "q3", "2028-02-01"],   // dezembro/2026 + 14 meses
    ]);
    // vigência de 3 meses: a química (junho) e a anual (abril) passariam da expiração
    const curto = await chamar("renovacao", "POST", id, { nome: "Plano curto", dataInicio: "2028-01-10", dataExpiracao: "2028-04-09" });
    expect(curto.json).toMatchObject({ itens: 2, itensFora: 2 });
    expect(itens(await ler(curto.json.id)).map((i: any) => i[0] + i[3])).toEqual(["toLeve2028-01-10", "toLeve2028-02-01"]);
  });

  it("o plano renovado gera, pelas regras das OS, o mesmo desenho do ano anterior um ano à frente (substituição e ordem preservadas)", async () => {
    const { carregarCronograma } = await import("@/lib/pmoc-cronograma-server");
    // dois itens de MESMO intervalo no q1: no desempate vale o criado primeiro (a química), nos dois planos
    const id = await plano({ cronograma: { create: [
      { tipoOsId: "toQuimica", dataInicio: dia("2026-11-12"), intervaloMeses: 3, diaExecucao: 20, criadoEm: new Date("2026-11-01T12:00:00Z") },
      { tipoOsId: "toAnual", dataInicio: dia("2026-11-12"), intervaloMeses: 3, diaExecucao: 20, criadoEm: new Date("2026-11-02T12:00:00Z") },
      { tipoOsId: "toLeve", dataInicio: dia("2026-11-12"), intervaloMeses: 1, diaExecucao: 20, criadoEm: new Date("2026-10-30T12:00:00Z") },
    ] } });
    const novoId = (await chamar("renovacao", "POST", id, NOVA)).json.id;
    const desenho = async (pmocId: string) => {
      const c = await carregarCronograma(prisma, pmocId, "e1");
      const nomes = new Map(c!.linhas.map((l) => [l.id, l.tipoOsId]));
      return [...execucoesDesejadas({ ...c!.estado, execucoes: [] }, new Date("2000-01-01T12:00:00Z")).desejado.values()]
        .filter((q) => q.equipamento.id === "q1").map((q) => `${q.periodo}:${nomes.get(q.item.id)}`).sort();
    };
    const antigo = await desenho(id), novo = await desenho(novoId);
    expect(antigo).toHaveLength(12);
    expect(antigo.filter((x) => !x.endsWith("toLeve"))).toEqual(["2026-11:toQuimica", "2027-02:toQuimica", "2027-05:toQuimica", "2027-08:toQuimica"]);
    expect(novo).toEqual(antigo.map((x) => `${Number(x.slice(0, 4)) + 1}${x.slice(4)}`));
    // a ordem de criação dos itens é a mesma do plano de origem
    const ordem = (await ler(novoId)).cronograma.map((i: any) => i.tipoOsId);
    expect(ordem).toEqual(["toLeve", "toQuimica", "toAnual"]);
    expect(new Set((await ler(novoId)).cronograma.map((i: any) => i.criadoEm.getTime())).size).toBe(3);
  });

  it("plano já renovado: a prévia avisa qual é a renovação; renovação inativada deixa de contar; renovar de novo cria outro plano", async () => {
    const id = await plano();
    const primeiro = (await chamar("renovacao", "POST", id, NOVA)).json.id;
    expect((await chamar("renovacao", "GET", id)).json.renovacoes).toEqual([{ id: primeiro, nome: "PMOC 2028 — Hospital" }]);
    const segundo = (await chamar("renovacao", "POST", id, { ...NOVA, nome: "PMOC 2028 — Hospital (2)" })).json.id;
    expect(segundo).not.toBe(primeiro);
    expect((await chamar("renovacao", "GET", id)).json.renovacoes.map((r: any) => r.id)).toEqual([primeiro, segundo]);
    await prisma.pmoc.update({ where: { id: primeiro }, data: { ativo: false } });
    expect((await chamar("renovacao", "GET", id)).json.renovacoes).toEqual([{ id: segundo, nome: "PMOC 2028 — Hospital (2)" }]);
    // a renovação de uma renovação parte da vigência DELA
    expect((await chamar("renovacao", "GET", segundo)).json.proposta).toEqual({ nome: "PMOC 2029 — Hospital (2)", dataInicio: "2028-11-12", dataExpiracao: "2029-11-11" });
  });

  it("renova também plano expirado, em rascunho ou inativo; sem cronograma e sem equipamento ativo, o plano novo nasce vazio", async () => {
    await prisma.equipamento.updateMany({ where: { id: { in: ["q1", "q2", "q3"] } }, data: { ativo: false } });
    for (const extra of [{ dataInicio: dia("2025-01-01"), dataExpiracao: dia("2025-12-31") }, { status: "RASCUNHO" }, { ativo: false }]) {
      const id = await plano({ ...extra, cronograma: { create: [] } });
      const r = await chamar("renovacao", "POST", id, NOVA);
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({ equipamentos: 0, itens: 0, equipamentosFora: 3, itensFora: 0 });
      expect(await ler(r.json.id)).toMatchObject({ status: "RASCUNHO", ativo: true, equipamentos: [], cronograma: [] });
    }
    // plano expirado há muito: a proposta continua sendo o dia seguinte à expiração DELE
    const velho = await plano({ dataInicio: dia("2025-01-01"), dataExpiracao: dia("2025-12-31"), nome: "PMOC 2025" });
    expect((await chamar("renovacao", "GET", velho)).json.proposta).toEqual({ nome: "PMOC 2026", dataInicio: "2026-01-01", dataExpiracao: "2026-12-31" });
  });

  it("pedido inválido → 400 com a mensagem, e nada é criado", async () => {
    const id = await plano();
    const erro = async (corpo: unknown) => { const r = await chamar("renovacao", "POST", id, corpo); return [r.status, r.json.erro]; };
    expect(await erro({ ...NOVA, nome: "ab" })).toEqual([400, "Informe o nome do novo plano (mín. 3 caracteres)."]);
    expect(await erro({ ...NOVA, dataInicio: "" })).toEqual([400, "Informe a data de início."]);
    expect(await erro({ ...NOVA, dataExpiracao: "2028-02-31" })).toEqual([400, "Informe a data de expiração."]);
    expect(await erro({ ...NOVA, dataExpiracao: "2027-11-12" })).toEqual([400, "A data de expiração deve ser depois da data de início."]);
    expect(await erro(undefined)).toEqual([400, "Informe o nome do novo plano (mín. 3 caracteres)."]);
    expect(await totalDePlanos()).toBe(1);
    expect((await ler(id)).historico).toHaveLength(2);
  });

  it("RBAC: renovar exige PMOC › Editar — visualizar ou criar não bastam; sem o módulo e o técnico do app: 403; nada é criado", async () => {
    const id = await plano();
    const negados: [string, () => void][] = [
      ["só visualizar", () => comPmoc(["visualizar"])], ["visualizar + criar + excluir (sem editar)", () => comPmoc(["visualizar", "criar", "excluir"])],
      ["sem o módulo PMOC", semModulo], ["técnico do app", tecnicoDoApp],
    ];
    for (const [quem, entrar] of negados) {
      entrar();
      expect([quem, (await chamar("renovacao", "GET", id)).status, (await chamar("renovacao", "POST", id, NOVA)).status]).toEqual([quem, 403, 403]);
    }
    sessao.atual = null;
    expect([(await chamar("renovacao", "GET", id)).status, (await chamar("renovacao", "POST", id, NOVA)).status]).toEqual([401, 401]);
    expect(await totalDePlanos()).toBe(1);
    expect((await ler(id)).historico).toHaveLength(2);
    // com Editar (mesmo sem Criar), renova
    comPmoc(["visualizar", "editar"]);
    expect((await chamar("renovacao", "GET", id)).status).toBe(200);
    expect((await chamar("renovacao", "POST", id, NOVA)).status).toBe(201);
    expect(await totalDePlanos()).toBe(2);
  });

  it("MULTIEMPRESA: plano de outra empresa → 404 na prévia e na renovação; o plano novo é da empresa de quem renova", async () => {
    const id = await plano();
    const deOutra = await plano({}, "e2");
    como(permissoesTotais(), "e2");
    expect([(await chamar("renovacao", "GET", id)).status, (await chamar("renovacao", "POST", id, NOVA)).status]).toEqual([404, 404]);
    expect((await chamar("renovacao", "GET", "nao-existe")).status).toBe(404);
    expect(await totalDePlanos()).toBe(2);
    expect((await ler(id)).historico).toHaveLength(2);
    const r = await chamar("renovacao", "POST", deOutra, NOVA);
    expect(await ler(r.json.id)).toMatchObject({ empresaId: "e2", clienteId: "cE2", unidadeId: "uE2", criadoPorId: "uB", status: "RASCUNHO" });
    expect((await ler(r.json.id)).equipamentos.map((e: any) => e.equipamentoId)).toEqual(["qE2"]);
  });

  it("MULTIEMPRESA no histórico: linha que aponta para plano de OUTRA empresa (ou que não existe mais) não vira link nem conta como renovação", async () => {
    const id = await plano();
    const deOutra = await plano({}, "e2");
    await prisma.pmocHistorico.createMany({ data: [
      { pmocId: id, acao: "Renovação gerada: plano de outra empresa", detalhes: `Nova vigência.\n[pmoc:${deOutra}]`, criadoEm: new Date("2027-10-21T12:00:00Z") },
      { pmocId: id, acao: "Renovação gerada: plano apagado", detalhes: "Nova vigência.\n[pmoc:apagado123]", criadoEm: new Date("2027-10-22T12:00:00Z") },
    ] });
    const linhas = await historicoDaTela(id);
    expect(linhas.slice(0, 2).map((h) => [h.acao, h.detalhes, h.plano])).toEqual([
      ["Renovação gerada: plano apagado", "Nova vigência.", null], ["Renovação gerada: plano de outra empresa", "Nova vigência.", null],
    ]);
    expect((await chamar("renovacao", "GET", id)).json.renovacoes).toEqual([]);
  });

  it("'Criar cópia' continua como era: não leva o cronograma (para a próxima vigência, o caminho é Renovar)", async () => {
    const id = await plano();
    const copia = await ler((await chamar("copia", "POST", id)).json.id);
    expect(copia).toMatchObject({ status: "RASCUNHO", nome: "Cópia de PMOC 2027 — Hospital", cronograma: [], artNumero: null });
    expect(copia.equipamentos).toHaveLength(3);
  });
});
