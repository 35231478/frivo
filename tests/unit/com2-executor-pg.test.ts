/**
 * COM-2A — a comissão do TÉCNICO no PostgreSQL real (dados fictícios):
 *  - a unidade (equipamento atendido × linha; % da venda = linha ÷ equipamentos vinculados), a divisão igual entre os
 *    técnicos da atividade, o extrato da pessoa por OS (nunca a base em reais);
 *  - a trava de qualidade: equipamento feito sem o checklist respondido não gera; responder gera; relatório reaberto
 *    antes de liberar tira a Prevista; OS cancelada depois de liberar estorna;
 *  - o gatilho (conclusão da OS) libera; a regra congelada: mudar a regra não mexe no que já nasceu;
 *  - "% por cargo" e "para quem executou"; OS sem equipamento (a linha, na conclusão);
 *  - o retorno no mesmo equipamento abre a revisão e segura a liberação; ESTORNAR estorna;
 *  - o teto mensal: a folha paga o teto, o excedente vai para o mês seguinte; reabrir o mês desfaz o par;
 *  - outra empresa não enxerga nada; rodar a conta de novo não duplica.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/com2-executor-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_com2_exec_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const NOMES: Record<string, [string, string]> = { uAdm: ["e1", "Gestora Fictícia"], uCarlos: ["e1", "Carlos Técnico"], uAna: ["e1", "Ana Ajudante"], uB: ["e2", "Beto Outra"] };
const logar = (id: string, permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") => {
  sessao.atual = { user: { id, name: NOMES[id][1], email: `${id}@ficticio.test`, empresaId: NOMES[id][0], role, permissoes, tecnicoId: null } };
};
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = metodo === "GET" && mod.GET.length === 0 ? await mod.GET() : await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
vi.setConfig({ testTimeout: 90_000 });

const DIA = 86_400_000;
const competencia = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const r2 = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

describe.skipIf(!URL_PG)("COM-2A — comissão do técnico (PostgreSQL real)", () => {
  let prisma: any;
  let exe: typeof import("@/lib/comissoes/executor-server");
  let srv: typeof import("@/lib/comissoes/servidor");
  let fech: typeof import("@/lib/desempenho/fechamento-server");
  let regras: typeof import("@/lib/comissoes/regras");
  let n = 0;
  const agora = new Date();
  const haDias = (d: number) => new Date(agora.getTime() - d * DIA);

  /** Uma OS com uma linha de serviço, os equipamentos vinculados numa atividade e o que foi feito (e respondido) */
  async function novaOs(o: {
    empresaId?: string; valor?: number; servicoId?: string; equipamentos?: { id: string; feito?: boolean; respondido?: boolean; feitoPor?: string | null }[];
    tecnicos?: string[]; status?: "ABERTA" | "CONCLUIDA"; criadaEm?: Date; feitoEm?: Date; extraOs?: Record<string, unknown>;
  } = {}) {
    n++;
    const empresaId = o.empresaId ?? "e1";
    const id = `os${n}`;
    const feitoEm = o.feitoEm ?? haDias(2);
    await prisma.ordemServico.create({ data: {
      id, empresaId, numero: `OS-${700 + n}`, clienteId: empresaId === "e1" ? "c1" : "c2", criadoPorId: empresaId === "e1" ? "uAdm" : "uB", descricao: "Manutenção fictícia",
      status: o.status ?? "ABERTA", criadoEm: o.criadaEm ?? haDias(3), dataConclusao: o.status === "CONCLUIDA" ? haDias(1) : null, ...o.extraOs,
      itensOrcamento: { create: [{ descricao: "Limpeza de split", quantidade: 1, valorUnitario: o.valor ?? 300, valorTotal: o.valor ?? 300, servicoId: o.servicoId ?? "sLimp", tipo: "SERVICO" }] },
    } });
    const [resp, ...equipe] = o.tecnicos ?? ["tCarlos", "tAna"];
    await prisma.atividadeOs.create({ data: {
      id: `at-${id}`, empresaId, ordemServicoId: id, titulo: "Limpeza", tipoOsId: empresaId === "e1" ? "toPrev" : null, tecnicoId: resp ?? null,
      status: o.status === "CONCLUIDA" ? "CONCLUIDA" : "EM_ANDAMENTO", concluidaEm: o.status === "CONCLUIDA" ? haDias(1) : null,
      tecnicosEquipe: { create: equipe.map((tecnicoId) => ({ tecnicoId })) },
    } });
    for (const e of o.equipamentos ?? []) {
      await prisma.atividadeEquipamento.create({ data: { atividadeId: `at-${id}`, equipamentoId: e.id, feito: !!e.feito, feitoEm: e.feito ? feitoEm : null, feitoPorId: e.feitoPor ?? null } });
      if (e.feito && e.respondido !== false && empresaId === "e1") {
        await prisma.checklistResposta.create({ data: { empresaId, atividadeId: `at-${id}`, equipamentoId: e.id, itemId: "i1", textoItem: "Filtro", status: "OK" } });
      }
    }
    return id;
  }
  const doOs = (osId: string) => prisma.comissao.findMany({ where: { ordemServicoId: osId }, orderBy: [{ beneficiarioNome: "asc" }, { equipamentoId: "asc" }], include: { lancamentos: true, revisoes: true } });
  const liberado = async (osId: string, usuarioId?: string) => r2((await prisma.comissaoLancamento.aggregate({ where: { comissao: { ordemServicoId: osId }, ...(usuarioId ? { usuarioId } : {}) }, _sum: { valor: true } }))._sum.valor);
  const sincronizar = (osIds?: string[]) => exe.sincronizarExecutor("e1", osIds ? { osIds } : {}, agora);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    for (const sql of ["2027-02-11_comissoes.sql", "2027-02-14_comissao_executor.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    exe = await import("@/lib/comissoes/executor-server");
    srv = await import("@/lib/comissoes/servidor");
    fech = await import("@/lib/desempenho/fechamento-server");
    regras = await import("@/lib/comissoes/regras");
    await Promise.all(["comissoes", "comissoes/regras", "comissoes/tetos", "comissoes/tetos/[id]", "comissoes/revisoes", "comissoes/revisoes/[id]", "configuracoes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Fictícia", cnpj: "12345678000190", email: "e1@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "e2@ficticio.test" }] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: [
      { id: "uAdm", empresaId: "e1", nome: "Gestora Fictícia", email: "adm@ficticio.test", senha: "x" },
      { id: "uCarlos", empresaId: "e1", nome: "Carlos Técnico", email: "carlos@ficticio.test", senha: "x" },
      { id: "uAna", empresaId: "e1", nome: "Ana Ajudante", email: "ana@ficticio.test", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto Outra", email: "beto@ficticio.test", senha: "x" },
    ] });
    await prisma.cargo.createMany({ data: [{ id: "cgTec", empresaId: "e1", nome: "Técnico" }, { id: "cgAj", empresaId: "e1", nome: "Ajudante" }] });
    await prisma.tecnico.createMany({ data: [
      { id: "tCarlos", empresaId: "e1", nome: "Carlos Técnico", cpf: "1", telefone: "1", email: "CARLOS@ficticio.test", cargoId: "cgTec" },
      { id: "tAna", empresaId: "e1", nome: "Ana Ajudante", cpf: "2", telefone: "1", email: "ana@ficticio.test", cargoId: "cgAj" },
      { id: "tSemLogin", empresaId: "e1", nome: "Sem Login", cpf: "3", telefone: "1", email: null },
      { id: "tBeto", empresaId: "e2", nome: "Beto Outra", cpf: "4", telefone: "1", email: "beto@ficticio.test" },
    ] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "11222333000181" }, { id: "c2", empresaId: "e2", nome: "Padaria da Outra", cpfCnpj: "11222333000262" }] });
    await prisma.unidade.create({ data: { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.servico.createMany({ data: [{ id: "sLimp", empresaId: "e1", nome: "Limpeza", codigo: "LIMP01", categoria: "Manutenção" }, { id: "sOut", empresaId: "e2", nome: "Da outra", codigo: "OUT01" }] });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split" } });
    await prisma.checklistTipoItem.create({ data: { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Filtro", tipoResposta: "OK_ATENCAO_NA", ordem: 1, criadoEm: new Date("2026-01-01") } });
    await prisma.equipamento.createMany({ data: ["q1", "q2", "q3", "q4", "q5"].map((id, i) => ({
      id, empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", nome: `Split ${i + 1}`, patrimonio: `AC-00${i + 1}`, tipoEquipamentoId: "te1",
    })) });
    await prisma.tipoOs.createMany({ data: [{ id: "toPrev", empresaId: "e1", nome: "Preventiva" }, { id: "toCorr", empresaId: "e1", nome: "Corretiva" }] });
    // Regra do técnico (e1): todos, 10% da venda, dividido igual. A outra empresa tem a regra dela.
    await prisma.comissaoRegra.create({ data: { id: "rTodos", empresaId: "e1", quemTipo: "TODOS", papel: "EXECUTOR", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 10, divisao: "IGUAL" } });
    await prisma.comissaoRegra.create({ data: { id: "rOutra", empresaId: "e2", quemTipo: "TODOS", papel: "EXECUTOR", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 50 } });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  let osA = "";
  it("a unidade: o equipamento atendido ganha a parte da linha (÷ vinculados), dividida igual; o não atendido e o sem checklist não geram", async () => {
    // 3 vinculados: q1 feito e respondido; q2 feito SEM o checklist; q3 não atendido. Linha R$ 300 → R$ 100 por equipamento
    osA = await novaOs({ equipamentos: [{ id: "q1", feito: true, feitoPor: "tCarlos" }, { id: "q2", feito: true, respondido: false }, { id: "q3" }] });
    const r = await sincronizar([osA]);
    expect(r.criadas).toBe(2);
    const cs = await doOs(osA);
    // 10% de R$ 100 = R$ 10, metade para cada um (Carlos e Ana); só o q1
    expect(cs.map((c: any) => [c.beneficiarioNome, c.equipamentoId, r2(c.valor), Number(c.parte), c.divisao, c.papel, c.quando])).toEqual([
      ["Ana Ajudante", "q1", 5, 0.5, "IGUAL", "EXECUTOR", "CONCLUSAO_OS"],
      ["Carlos Técnico", "q1", 5, 0.5, "IGUAL", "EXECUTOR", "CONCLUSAO_OS"],
    ]);
    expect(cs.every((c: any) => c.orcamentoId === null && c.lancamentos.length === 0)).toBe(true);
    // de novo: nada duplica
    expect(await sincronizar([osA])).toMatchObject({ criadas: 0, removidas: 0, lancamentos: 0 });
  });

  it("responder o checklist do q2 faz nascer a comissão dele (a trava de qualidade é a do app)", async () => {
    await prisma.checklistResposta.create({ data: { empresaId: "e1", atividadeId: `at-${osA}`, equipamentoId: "q2", itemId: "i1", textoItem: "Filtro", status: "OK" } });
    expect((await sincronizar([osA])).criadas).toBe(2);
    expect((await doOs(osA)).filter((c: any) => c.equipamentoId === "q2").map((c: any) => r2(c.valor))).toEqual([5, 5]);
  });

  it("relatório reaberto ANTES de liberar: a Prevista some (sem estorno, nada tinha sido liberado)", async () => {
    await prisma.checklistResposta.deleteMany({ where: { atividadeId: `at-${osA}`, equipamentoId: "q2" } });
    expect((await sincronizar([osA])).removidas).toBe(2);
    expect((await doOs(osA)).map((c: any) => c.equipamentoId)).toEqual(["q1", "q1"]);
  });

  it("o extrato do técnico: a OS com o equipamento, Prevista; sem base, custo ou valor dos colegas", async () => {
    const ex = await srv.extratoDoUsuario("e1", "uCarlos", agora);
    const linha = ex.vendas.find((v) => v.chave === `os:${osA}`)!;
    expect(linha).toMatchObject({ tipo: "OS", orcamentoId: null, codigo: expect.stringMatching(/^OS-/), cliente: "Hospital Fictício", prevista: 5, liberada: 0, paga: 0 });
    expect(linha.itens).toEqual([{ descricao: "Limpeza de split — Split 1 LG S4", regra: "Todos · Todos os serviços · 10% da venda", valor: 5 }]);
    expect(JSON.stringify(ex)).not.toMatch(/baseValor|custo|Ana Ajudante/);
  });

  it("concluir a OS libera (gatilho padrão: conclusão da OS); OS cancelada depois estorna", async () => {
    await prisma.ordemServico.update({ where: { id: osA }, data: { status: "CONCLUIDA", dataConclusao: haDias(1) } });
    expect((await sincronizar([osA])).lancamentos).toBe(2);
    expect(await liberado(osA, "uCarlos")).toBe(5);
    const lib = await prisma.comissaoLancamento.findFirst({ where: { comissao: { ordemServicoId: osA }, usuarioId: "uCarlos" } });
    expect(lib).toMatchObject({ tipo: "LIBERACAO", motivo: "OS concluída" });
    const ex = await srv.extratoDoUsuario("e1", "uCarlos", agora);
    expect(ex.vendas.find((v) => v.chave === `os:${osA}`)).toMatchObject({ prevista: 0, liberada: 5 });

    const osC = await novaOs({ status: "CONCLUIDA", equipamentos: [{ id: "q4", feito: true }] });
    await sincronizar([osC]);
    expect(await liberado(osC)).toBe(30); // 10% de R$ 300 (1 equipamento), 15 + 15
    await prisma.ordemServico.update({ where: { id: osC }, data: { status: "CANCELADA" } });
    await sincronizar([osC]);
    expect(await liberado(osC)).toBe(0);
    const est = await prisma.comissaoLancamento.findFirst({ where: { comissao: { ordemServicoId: osC }, tipo: "ESTORNO" } });
    expect(est.motivo).toBe("OS cancelada");
  });

  it("% por cargo (60/40) e 'para quem executou'; a regra é congelada: mudar a regra não mexe no que já nasceu", async () => {
    await prisma.comissaoRegra.update({ where: { id: "rTodos" }, data: { divisao: "POR_CARGO", divisaoCargos: { cgTec: 60, cgAj: 40 } } });
    const osP = await novaOs({ equipamentos: [{ id: "q5", feito: true, feitoPor: "tAna" }] });
    await sincronizar([osP]);
    expect((await doOs(osP)).map((c: any) => [c.beneficiarioNome, r2(c.valor), Number(c.parte), c.divisao])).toEqual([["Ana Ajudante", 12, 0.4, "POR_CARGO"], ["Carlos Técnico", 18, 0.6, "POR_CARGO"]]);
    // a OS de antes continua como nasceu
    expect((await doOs(osA)).map((c: any) => [r2(c.valor), c.divisao])).toEqual([[5, "IGUAL"], [5, "IGUAL"]]);

    await prisma.comissaoRegra.update({ where: { id: "rTodos" }, data: { divisao: "POR_EXECUTOR", divisaoCargos: null } });
    const osE = await novaOs({ equipamentos: [{ id: "q5", feito: true, feitoPor: "tAna" }] });
    await sincronizar([osE]);
    expect((await doOs(osE)).map((c: any) => [c.beneficiarioNome, r2(c.valor), Number(c.parte)])).toEqual([["Ana Ajudante", 30, 1]]);
    await prisma.comissaoRegra.update({ where: { id: "rTodos" }, data: { divisao: "IGUAL" } });
  });

  it("OS sem equipamento: a linha inteira, na conclusão, para os técnicos; o técnico sem login fica de fora", async () => {
    const osL = await novaOs({ valor: 200, tecnicos: ["tCarlos", "tSemLogin"] });
    await sincronizar([osL]);
    expect(await doOs(osL)).toEqual([]); // ainda aberta
    await prisma.ordemServico.update({ where: { id: osL }, data: { status: "CONCLUIDA", dataConclusao: haDias(1) } });
    await sincronizar([osL]);
    // 10% de R$ 200 = R$ 20; o colega sem login não recebe (e a parte dele não vai para o Carlos)
    expect((await doOs(osL)).map((c: any) => [c.beneficiarioNome, r2(c.valor), Number(c.parte), c.equipamentoId])).toEqual([["Carlos Técnico", 10, 0.5, null]]);
  });

  it("RETORNO no mesmo equipamento: abre a revisão e segura a liberação; ESTORNAR estorna; quem registrou o problema não entra", async () => {
    const osR = await novaOs({ equipamentos: [{ id: "q3", feito: true }], feitoEm: haDias(10), criadaEm: haDias(11) });
    await sincronizar([osR]);
    expect((await doOs(osR)).length).toBe(2);
    // a corretiva no q3, 5 dias depois do serviço (não veio de orçamento nem de ocorrência do PMOC)
    const corretiva = (id: string, numero: string, criadoEm: Date, equipamentoId: string) => prisma.ordemServico.create({ data: {
      id, empresaId: "e1", numero, clienteId: "c1", criadoPorId: "uAdm", descricao: "Voltou a dar problema", status: "ABERTA", criadoEm, equipamentoId,
      atividades: { create: [{ id: `at-${id}`, empresaId: "e1", titulo: "Corretiva", tipoOsId: "toCorr", status: "AGENDADA" }] },
    } });
    await corretiva("osRet", "OS-RET", haDias(5), "q3");
    // sem tipo de retorno marcado, a revisão fica desligada (nem a preventiva nem a corretiva contam)
    expect((await sincronizar([osR])).revisoes).toBe(0);
    await prisma.desempenhoTipoRetorno.create({ data: { empresaId: "e1", tipoOsId: "toCorr" } });
    const r = await sincronizar([osR]);
    expect(r.revisoes).toBe(2);
    const revs = await prisma.comissaoRevisao.findMany({ where: { comissao: { ordemServicoId: osR } } });
    expect(revs.map((x: any) => x.situacao)).toEqual(["A_REVISAR", "A_REVISAR"]);
    expect(revs[0].descricao).toMatch(/^OS-RET aberta 5 dias depois do serviço da OS-\d+ em Split 3 LG S4$/);
    // concluir: em revisão, não libera
    await prisma.ordemServico.update({ where: { id: osR }, data: { status: "CONCLUIDA", dataConclusao: haDias(9) } });
    await sincronizar([osR]);
    expect(await liberado(osR)).toBe(0);
    const ex = await srv.extratoDoUsuario("e1", "uCarlos", agora);
    expect(ex.vendas.find((v) => v.chave === `os:${osR}`)!.itens[0].emRevisao).toBe(true);
    // MANTER libera; ESTORNAR (de uma delas) estorna o que tinha sido liberado
    await prisma.comissaoRevisao.updateMany({ where: { comissao: { ordemServicoId: osR } }, data: { situacao: "MANTER" } });
    await sincronizar([osR]);
    expect(await liberado(osR)).toBe(30);
    await prisma.comissaoRevisao.updateMany({ where: { comissao: { ordemServicoId: osR, usuarioId: "uCarlos" } }, data: { situacao: "ESTORNAR" } });
    await sincronizar([osR]);
    expect(await liberado(osR, "uCarlos")).toBe(0);
    expect(await liberado(osR, "uAna")).toBe(15);
    expect((await prisma.comissaoLancamento.findFirst({ where: { comissao: { ordemServicoId: osR }, usuarioId: "uCarlos", tipo: "ESTORNO" } })).motivo).toMatch(/^Retorno no mesmo equipamento/);

    // Quem anotou "Atenção" no equipamento avisou do problema: o retorno não vira revisão
    const osAt = await novaOs({ equipamentos: [{ id: "q2", feito: true, respondido: false }], feitoEm: haDias(10), criadaEm: haDias(11) });
    await prisma.checklistResposta.create({ data: { empresaId: "e1", atividadeId: `at-${osAt}`, equipamentoId: "q2", itemId: "i1", textoItem: "Filtro", status: "ATENCAO", observacao: "Compressor fazendo barulho" } });
    await corretiva("osRet2", "OS-RET2", haDias(4), "q2");
    const r2b = await sincronizar([osAt]);
    expect(r2b.revisoes).toBe(0);
  });

  it("outra empresa: a conta dela não vê nada desta (e a desta não vê a dela)", async () => {
    await novaOs({ empresaId: "e2", status: "CONCLUIDA", tecnicos: ["tBeto"] });
    const antes = await prisma.comissao.count({ where: { empresaId: "e1" } });
    await exe.sincronizarExecutor("e2", {}, agora);
    expect(await prisma.comissao.count({ where: { empresaId: "e1" } })).toBe(antes);
    expect((await prisma.comissao.findMany({ where: { empresaId: "e2" } })).map((c: any) => [c.beneficiarioNome, r2(c.valor)])).toEqual([["Beto Outra", 150]]);
    const ex = await srv.extratoDoUsuario("e1", "uCarlos", agora);
    expect(JSON.stringify(ex)).not.toMatch(/Padaria da Outra/);
  });

  it("TETO mensal: a folha paga o teto; o excedente vira o par −/+ (passa para o mês seguinte); reabrir o mês desfaz o par", async () => {
    await prisma.comissaoTeto.create({ data: { empresaId: "e1", quemTipo: "PESSOA", usuarioId: "uCarlos", valor: 10 } });
    const autor = { empresaId: "e1", usuarioId: "uAdm", nome: "Gestora Fictícia" };
    const previa = await fech.previaDoFechamento("e1", competencia(agora), agora);
    const aberto = r2((await prisma.comissaoLancamento.aggregate({ where: { usuarioId: "uCarlos", fechamentoId: null, data: { lt: regras.inicioDaCompetencia(competencia(new Date(agora.getTime() + 32 * DIA))) } }, _sum: { valor: true } }))._sum.valor);
    expect(aberto).toBeGreaterThan(10);
    expect(previa.folha.linhas.find((l) => l.usuarioId === "uCarlos")!.comissao).toBe(10);
    expect(previa.folha.linhas.find((l) => l.usuarioId === "uAna")!.comissao).toBeGreaterThan(0); // a Ana não tem teto

    const f = await fech.fecharMes(autor, { competencia: competencia(agora), ciente: true }, agora);
    const par = await prisma.comissaoLancamento.findMany({ where: { tetoCompetencia: competencia(agora) }, orderBy: { valor: "asc" } });
    expect(par.map((l: any) => [l.tipo, r2(l.valor), l.fechamentoId === f.id, l.motivo])).toEqual([
      ["ESTORNO", -(aberto - 10), true, srv.MOTIVO_TETO_SAI],
      ["LIBERACAO", aberto - 10, false, srv.MOTIVO_TETO_ENTRA],
    ]);
    expect(par[1].data.getTime()).toBe(regras.fimDaCompetencia(competencia(agora)).getTime());
    const linha = await prisma.desempenhoFechamentoLinha.findFirst({ where: { fechamentoId: f.id, usuarioId: "uCarlos" }, include: { contaPagar: true } });
    expect(Number(linha.contaPagar.valorTotal)).toBe(10);

    await fech.reabrirMes(autor, f.id, "Conferir o teto do Carlos", agora);
    expect(await prisma.comissaoLancamento.count({ where: { tetoCompetencia: competencia(agora) } })).toBe(0);
  });

  it("Configurações › Comissões: regra de Executor com % por cargo (cargo de outra empresa recusado); o técnico e os tipos de retorno; a tela antiga e a tela geral não apagam", async () => {
    logar("uAdm");
    await prisma.cargo.create({ data: { id: "cgOutra", empresaId: "e2", nome: "Da outra" } });
    const regraCargo = { quemTipo: "CARGO", cargoId: "cgAj", papel: "EXECUTOR", sobreTipo: "SERVICO", servicoId: "sLimp", base: "FIXO_ITEM", valor: 12, divisao: "POR_CARGO" };
    expect((await chamar("comissoes/regras", "POST", {}, { ...regraCargo, divisaoCargos: { cgOutra: 50 } })).status).toBe(400);
    const criada = await chamar("comissoes/regras", "POST", {}, { ...regraCargo, divisaoCargos: { cgTec: 70, cgAj: 30 } });
    expect(criada.status).toBe(201);
    expect(await prisma.comissaoRegra.findUnique({ where: { id: criada.json.id } })).toMatchObject({ papel: "EXECUTOR", divisao: "POR_CARGO", divisaoCargos: { cgTec: 70, cgAj: 30 } });
    await prisma.comissaoRegra.update({ where: { id: criada.json.id }, data: { ativo: false } }); // não atrapalha as contas abaixo

    // o tipo de OS de outra empresa é recusado; o daqui grava (a mesma lista do Desempenho)
    await prisma.tipoOs.create({ data: { id: "toOutra", empresaId: "e2", nome: "Corretiva da outra" } });
    const cfg = { quando: "RECEBIMENTO", liquidaImpostos: false, executorQuando: "ACEITE", retornoDias: 45 };
    expect((await chamar("comissoes", "PUT", {}, { ...cfg, tiposRetorno: ["toCorr", "toOutra"] })).status).toBe(400);
    expect((await chamar("comissoes", "PUT", {}, { ...cfg, tiposRetorno: ["toCorr", "toPrev"] })).status).toBe(200);
    expect(await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).toMatchObject({ comissaoExecutorQuando: "ACEITE", comissaoRetornoDias: 45 });
    expect((await prisma.desempenhoTipoRetorno.findMany({ where: { empresaId: "e1" }, orderBy: { tipoOsId: "asc" } })).map((t: any) => t.tipoOsId)).toEqual(["toCorr", "toPrev"]);
    // a tela antiga (só os dois campos de antes) não mexe no técnico nem nos tipos
    expect((await chamar("comissoes", "PUT", {}, { quando: "RECEBIMENTO", liquidaImpostos: false })).status).toBe(200);
    expect(await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).toMatchObject({ comissaoExecutorQuando: "ACEITE", comissaoRetornoDias: 45 });
    expect(await prisma.desempenhoTipoRetorno.count({ where: { empresaId: "e1" } })).toBe(2);
    // tirar um tipo
    expect((await chamar("comissoes", "PUT", {}, { ...cfg, tiposRetorno: ["toCorr"] })).status).toBe(200);
    expect((await prisma.desempenhoTipoRetorno.findMany({ where: { empresaId: "e1" } })).map((t: any) => t.tipoOsId)).toEqual(["toCorr"]);
    // a tela geral de Configurações manda tudo de volta: não sobrescreve o técnico
    const geral = (await chamar("configuracoes", "GET")).json;
    expect((await chamar("configuracoes", "PUT", {}, { ...geral, comissaoExecutorQuando: "RECEBIMENTO", comissaoRetornoDias: 1 })).status).toBe(200);
    expect(await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).toMatchObject({ comissaoExecutorQuando: "ACEITE", comissaoRetornoDias: 45 });
    // a tela traz tudo isso de volta
    const tela = (await chamar("comissoes", "GET")).json;
    expect(tela.config).toMatchObject({ executorQuando: "ACEITE", retornoDias: 45, tiposRetorno: ["toCorr"] });
    expect(tela.opcoes.tiposOs.map((t: any) => t.id).sort()).toEqual(["toCorr", "toPrev"]);
    expect(tela.regras.find((r: any) => r.id === criada.json.id)).toMatchObject({ divisao: "POR_CARGO", divisaoCargos: { cgTec: 70, cgAj: 30 } });
  });

  it("gatilho 'aceite do cliente' (congelado na comissão): a OS concluída não basta; o aceite confirmado libera", async () => {
    const os = await novaOs({ status: "CONCLUIDA", equipamentos: [{ id: "q1", feito: true }] });
    await sincronizar([os]);
    const cs = await doOs(os);
    expect(cs.map((c: any) => c.quando)).toEqual(["ACEITE", "ACEITE"]);
    expect(await liberado(os)).toBe(0);
    await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: os, token: `tok-${os}`, situacao: "CONFIRMADO", confirmadoEm: haDias(1) } });
    await sincronizar([os]);
    expect(await liberado(os)).toBe(30);
    expect((await prisma.comissaoLancamento.findFirst({ where: { comissao: { ordemServicoId: os } } })).motivo).toBe("Aceite do cliente");
  });

  it("gatilho 'recebimento da OS': libera a parte do que entrou na fatura da OS", async () => {
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoExecutorQuando: "RECEBIMENTO" } });
    const os = await novaOs({ status: "CONCLUIDA", equipamentos: [{ id: "q2", feito: true }] });
    await sincronizar([os]);
    expect(await liberado(os)).toBe(0);
    await prisma.medicao.create({ data: {
      id: `med-${os}`, empresaId: "e1", clienteId: "c1", numero: `FAT-${os}`, tokenPublico: `tokm-${os}`, status: "BOLETO_GERADO", valorLiquido: 300,
      itens: { create: [{ descricao: "Limpeza de split", valorUnitario: 300, valorTotal: 300, ordemServicoId: os }] },
    } });
    const conta = await prisma.contaReceber.create({ data: { empresaId: "e1", clienteId: "c1", numero: `CR-${os}`, descricao: "Fatura fictícia", valor: 300, status: "A_RECEBER", medicaoId: `med-${os}`, dataVencimento: agora } });
    await prisma.contaReceberRecebimento.create({ data: { empresaId: "e1", contaReceberId: conta.id, valor: 150, data: haDias(1) } });
    await sincronizar([os]);
    expect(await liberado(os)).toBe(15); // metade de R$ 30
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { comissaoExecutorQuando: "CONCLUSAO_OS" } });
  });

  it("teto pela tela: criar, repetido 409, pessoa de outra empresa 400, excluir; sem 'Desempenho › Gerenciar' 403", async () => {
    logar("uAdm");
    expect((await chamar("comissoes/tetos", "POST", {}, { quemTipo: "CARGO", cargoId: "cgAj", valor: 900 })).status).toBe(201);
    expect((await chamar("comissoes/tetos", "POST", {}, { quemTipo: "CARGO", cargoId: "cgAj", valor: 500 })).status).toBe(409);
    expect((await chamar("comissoes/tetos", "POST", {}, { quemTipo: "PESSOA", usuarioId: "uB", valor: 500 })).status).toBe(400);
    const tela = (await chamar("comissoes", "GET")).json;
    const doCargo = tela.tetos.find((x: any) => x.cargoId === "cgAj");
    expect(doCargo).toMatchObject({ quemTipo: "CARGO", nome: "Ajudante", valor: 900 });
    expect((await chamar("comissoes/tetos/[id]", "DELETE", { id: doCargo.id })).status).toBe(200);
    expect((await chamar("comissoes/tetos/[id]", "DELETE", { id: doCargo.id })).status).toBe(404);
    logar("uCarlos", montarPermissoes({ desempenho: ["visualizar"] }));
    expect((await chamar("comissoes/tetos", "POST", {}, { quemTipo: "CARGO", cargoId: "cgAj", valor: 900 })).status).toBe(403);
    expect((await chamar("comissoes/revisoes", "GET")).status).toBe(403);
  });

  it("revisão pela tela: ninguém decide a própria; MANTER libera; decidida não muda de novo; ESTORNAR estorna", async () => {
    const os = await novaOs({ status: "CONCLUIDA", equipamentos: [{ id: "q5", feito: true }], feitoEm: haDias(9), criadaEm: haDias(9) });
    await prisma.ordemServico.create({ data: {
      id: "osRet3", empresaId: "e1", numero: "OS-RET3", clienteId: "c1", criadoPorId: "uAdm", descricao: "Voltou", status: "ABERTA", criadoEm: haDias(6), equipamentoId: "q5",
      atividades: { create: [{ id: "at-osRet3", empresaId: "e1", titulo: "Corretiva", tipoOsId: "toCorr", status: "AGENDADA" }] },
    } });
    await sincronizar([os]);
    logar("uAdm");
    const lista = (await chamar("comissoes/revisoes", "GET")).json.revisoes.filter((r: any) => r.descricao.startsWith("OS-RET3"));
    expect(lista.map((r: any) => `${r.beneficiario}:${r.situacao}:${r.valor}`).sort()).toEqual(["Ana Ajudante:A_REVISAR:15", "Carlos Técnico:A_REVISAR:15"]);
    const doCarlos = lista.find((r: any) => r.beneficiario === "Carlos Técnico");
    const daAna = lista.find((r: any) => r.beneficiario === "Ana Ajudante");
    expect(await liberado(os)).toBe(0);

    logar("uCarlos");
    const propria = await chamar("comissoes/revisoes/[id]", "POST", { id: doCarlos.id }, { decisao: "MANTER", motivo: "Foi outro defeito" });
    expect(propria).toMatchObject({ status: 403, json: { erro: expect.stringMatching(/sua própria comissão/) } });
    expect((await chamar("comissoes/revisoes/[id]", "POST", { id: daAna.id }, { decisao: "MANTER", motivo: "abc" })).status).toBe(400);

    logar("uAdm");
    expect((await chamar("comissoes/revisoes/[id]", "POST", { id: doCarlos.id }, { decisao: "MANTER", motivo: "Foi outro defeito" })).status).toBe(200);
    expect(await liberado(os, "uCarlos")).toBe(15);
    expect((await chamar("comissoes/revisoes/[id]", "POST", { id: doCarlos.id }, { decisao: "ESTORNAR", motivo: "Mudei de ideia" })).status).toBe(409);
    expect((await chamar("comissoes/revisoes/[id]", "POST", { id: daAna.id }, { decisao: "ESTORNAR", motivo: "Mesmo vazamento" })).status).toBe(200);
    expect(await liberado(os, "uAna")).toBe(0);
    const decidida = (await chamar("comissoes/revisoes", "GET")).json.revisoes.find((r: any) => r.id === daAna.id);
    expect(decidida).toMatchObject({ situacao: "ESTORNAR", motivo: "Mesmo vazamento", decididoPorNome: "Gestora Fictícia" });
    // outra empresa não acha
    logar("uB");
    expect((await chamar("comissoes/revisoes/[id]", "POST", { id: daAna.id }, { decisao: "MANTER", motivo: "Não é minha" })).status).toBe(404);
  });

  it("o relatório do mês (por emissão) traz as OS do técnico ao lado das vendas", async () => {
    const rel = await srv.relatorioDeComissoes("e1", competencia(agora), "EMISSAO");
    const carlos = rel.pessoas.find((p) => p.usuarioId === "uCarlos")!;
    expect(carlos.vendas.some((v) => v.chave.startsWith("os:") && v.orcamentoId === null && v.nome === "Serviço executado" && v.cliente === "Hospital Fictício")).toBe(true);
    // a OS cancelada fica de fora
    expect(carlos.vendas.some((v) => v.codigo === "OS-RET")).toBe(false);
  });
});
