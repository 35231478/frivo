/**
 * App de campo, leva 3 (PR A) — FAIXA ESPERADA com rotas reais, Prisma real, PostgreSQL real:
 *  - a tela do tipo grava grandeza e faixa (mínimo ≤ máximo; grandeza dos itens antigos vem do texto);
 *  - a resposta guarda a faixa do momento (na unidade da resposta) e se ficou fora; mudar a faixa depois não reescreve;
 *  - o ΔT se calcula no servidor (app e escritório), com "Não se aplica" e unidades diferentes; ninguém digita o ΔT;
 *  - os destaques: cartão da atividade na OS, relatório e o painel do gestor (30 dias, equipamento ativo, a empresa).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/app-campo-leva3-faixas-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { inicioHojeBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_app_campo_l3a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "joao@clima.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };
const comoEscritorio = (empresaId = "e1", id = "uA") => { sessao.atual = { user: { id, name: "Ana", email: `${id}@clima.com`, empresaId, role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null } }; };
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const sync = async (operacoes: unknown[]) => (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[];
const resp = (itemId: string, dados: Record<string, unknown>, equipamentoId = "eq1") => ({ id: randomUUID(), tipo: "resposta", atividadeId: "a1", equipamentoId, itemId, em: new Date().toISOString(), dados });
const H = 3_600_000;

describe.skipIf(!URL_PG)("app de campo, leva 3 (PR A): faixa esperada (PostgreSQL real)", () => {
  let prisma: any;
  const r = async (itemId: string, equipamentoId = "eq1", atividadeId = "a1") => {
    const x = await prisma.checklistResposta.findFirst({ where: { atividadeId, equipamentoId, itemId } });
    return x && { valor: x.valor?.toNumber() ?? null, unidade: x.unidade, faixaMin: x.faixaMin?.toNumber() ?? null, faixaMax: x.faixaMax?.toNumber() ?? null, fora: x.foraDaFaixa, status: x.status, observacao: x.observacao };
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "tipos-equipamento/[id]/checklist", "ordens/[id]/relatorios", "ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/itens/[itemId]"]
      .map((x) => import(/* @vite-ignore */ `@/app/api/${x}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana", email: "uA@clima.com", senha: "x" }, { id: "uB", empresaId: "e2", nome: "Beto", email: "uB@clima.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "1" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "tSplit", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    const med = (id: string, texto: string, unidade: string, ordem: number, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", tipoEquipamentoId: "tSplit", texto, tipoResposta: "MEDICAO", unidade, ordem, ...extra });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "iFiltro", empresaId: "e1", tipoEquipamentoId: "tSplit", texto: "Limpeza dos filtros de ar", ordem: 1 },
      med("iSuc", "Pressão de sucção", "psi", 2, { grandeza: "SUCCAO", valorMin: 115, valorMax: 140 }),
      med("iIns", "Temperatura de insuflamento", "°C", 3, { valorMin: 10, valorMax: 16 }), // antigo: sem grandeza gravada (vem do texto)
      med("iRet", "Temperatura de retorno", "°C", 4),
      med("iDt", "Diferença de temperatura do ar (ΔT)", "°C", 5, { grandeza: "DELTA_T", valorMin: 8, valorMax: 14 }),
      med("iCor", "Corrente do compressor", "A", 6),
    ] });
    const eq = (id: string, nome: string, ativo = true) => ({ id, empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "tSplit", marca: "Daikin", modelo: "FTXS", nome, ativo });
    await prisma.equipamento.createMany({ data: [eq("eq1", "Split sala 1"), eq("eq2", "Split sala 2"), eq("eq3", "Split desativado", false)] });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Preventiva" },
      { id: "os2", empresaId: "e1", numero: "OS-2", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Antiga" },
    ] });
    const hoje = inicioHojeBR();
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "EM_ANDAMENTO" },
      { id: "a2", empresaId: "e1", ordemServicoId: "os2", titulo: "Antiga", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 8 * H), status: "EM_ANDAMENTO" },
    ] });
    await prisma.atividadeEquipamento.createMany({ data: [{ atividadeId: "a1", equipamentoId: "eq1" }, { atividadeId: "a1", equipamentoId: "eq2" }, { atividadeId: "a2", equipamentoId: "eq3" }] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("a tela do tipo", () => {
    it("lê a grandeza dos itens antigos pelo texto e a faixa como número", async () => {
      comoEscritorio();
      const g = (await chamar("tipos-equipamento/[id]/checklist", "GET", { id: "tSplit" })).json;
      expect(g.itens.map((i: any) => [i.texto, i.grandeza, i.valorMin, i.valorMax])).toEqual([
        ["Limpeza dos filtros de ar", null, null, null], ["Pressão de sucção", "SUCCAO", 115, 140], ["Temperatura de insuflamento", "INSUFLAMENTO", 10, 16],
        ["Temperatura de retorno", "RETORNO", null, null], ["Diferença de temperatura do ar (ΔT)", "DELTA_T", 8, 14], ["Corrente do compressor", "CORRENTE_COMPRESSOR", null, null],
      ]);
    });
    it("grava grandeza e faixa; mínimo maior que o máximo é recusado; outra empresa não acha o tipo", async () => {
      comoEscritorio();
      const g = (await chamar("tipos-equipamento/[id]/checklist", "GET", { id: "tSplit" })).json;
      const itens = g.itens.map(({ respostas: _r, ordem: _o, ...i }: any) => i);
      const ruim = itens.map((i: any) => (i.id === "iCor" ? { ...i, valorMin: 20, valorMax: 10 } : i));
      expect((await chamar("tipos-equipamento/[id]/checklist", "PUT", { id: "tSplit" }, { itens: ruim })).status).toBe(400);
      const bom = itens.map((i: any) => (i.id === "iCor" ? { ...i, valorMax: 12 } : i));
      expect((await chamar("tipos-equipamento/[id]/checklist", "PUT", { id: "tSplit" }, { itens: bom })).status).toBe(200);
      const ins = await prisma.checklistTipoItem.findUnique({ where: { id: "iIns" } });
      const cor = await prisma.checklistTipoItem.findUnique({ where: { id: "iCor" } });
      expect([ins.grandeza, cor.grandeza, cor.valorMin, cor.valorMax?.toNumber()]).toEqual(["INSUFLAMENTO", "CORRENTE_COMPRESSOR", null, 12]);
      comoEscritorio("e2", "uB");
      expect((await chamar("tipos-equipamento/[id]/checklist", "PUT", { id: "tSplit" }, { itens: bom })).status).toBe(404);
      // volta a corrente sem faixa
      comoEscritorio();
      await prisma.checklistTipoItem.update({ where: { id: "iCor" }, data: { valorMax: null } });
    });
  });

  describe("a resposta guarda a faixa do momento", () => {
    it("fora (abaixo) e dentro; os limites contam como dentro", async () => {
      comoTecnico();
      expect((await sync([resp("iSuc", { valor: 95 })]))[0]).toMatchObject({ ok: true });
      expect(await r("iSuc")).toMatchObject({ valor: 95, unidade: "psi", faixaMin: 115, faixaMax: 140, fora: true });
      await sync([resp("iSuc", { valor: 140 })]);
      expect(await r("iSuc")).toMatchObject({ valor: 140, fora: false });
      await sync([resp("iSuc", { valor: 140.5 })]);
      expect(await r("iSuc")).toMatchObject({ fora: true });
    });
    it("outra unidade: a faixa vai para ela (bar); unidade que não converte: sem faixa, sem alerta", async () => {
      comoTecnico();
      await sync([resp("iSuc", { valor: 6, unidade: "bar" })]);
      expect(await r("iSuc")).toMatchObject({ valor: 6, unidade: "bar", faixaMin: 7.929, faixaMax: 9.653, fora: true });
      await sync([resp("iSuc", { unidade: "psi" })]); // só a unidade: refaz a faixa com o valor que estava
      expect(await r("iSuc")).toMatchObject({ valor: 6, unidade: "psi", faixaMin: 115, fora: true });
      await sync([resp("iSuc", { valor: 3, unidade: "A" })]);
      expect(await r("iSuc")).toMatchObject({ faixaMin: null, faixaMax: null, fora: false });
    });
    it("'Não se aplica' tira o alerta; sem faixa no item, nada; só a observação não mexe na faixa", async () => {
      comoTecnico();
      await sync([resp("iSuc", { valor: 95, unidade: "psi" })]);
      await sync([resp("iSuc", { observacao: "Pressão baixa: possível falta de gás." })]);
      expect(await r("iSuc")).toMatchObject({ fora: true, observacao: "Pressão baixa: possível falta de gás." });
      await sync([resp("iSuc", { status: "NAO_SE_APLICA" })]);
      expect(await r("iSuc")).toMatchObject({ valor: null, fora: false, status: "NAO_SE_APLICA" });
      await sync([resp("iCor", { valor: 99 })]);
      expect(await r("iCor")).toMatchObject({ faixaMin: null, faixaMax: null, fora: false });
      await sync([resp("iSuc", { valor: 95 })]); // volta fora para os destaques
    });
    it("mudar a faixa do tipo depois não reescreve a resposta já dada", async () => {
      await prisma.checklistTipoItem.update({ where: { id: "iSuc" }, data: { valorMin: 90 } });
      expect(await r("iSuc")).toMatchObject({ valor: 95, faixaMin: 115, fora: true });
      await prisma.checklistTipoItem.update({ where: { id: "iSuc" }, data: { valorMin: 115 } });
    });
  });

  describe("ΔT calculado", () => {
    it("com as duas leituras o servidor calcula, com a faixa; mudar uma refaz; uma 'Não se aplica' leva o ΔT junto", async () => {
      comoTecnico();
      await sync([resp("iRet", { valor: 24 })]);
      expect(await r("iDt")).toBeNull(); // falta o insuflamento
      const [x] = await sync([resp("iIns", { valor: 12.5 })]);
      expect(x.dados.calculadas).toEqual([{ itemId: "iDt", valor: 11.5, unidade: "°C", status: null }]);
      expect(await r("iDt")).toMatchObject({ valor: 11.5, faixaMin: 8, faixaMax: 14, fora: false });
      await sync([resp("iIns", { valor: 20 })]);
      expect(await r("iDt")).toMatchObject({ valor: 4, fora: true });
      await sync([resp("iRet", { status: "NAO_SE_APLICA" })]);
      expect(await r("iDt")).toMatchObject({ valor: null, status: "NAO_SE_APLICA", fora: false });
      await sync([resp("iRet", { valor: 75.2, unidade: "°F" })]); // 24 °C
      expect(await r("iDt")).toMatchObject({ valor: 4, unidade: "°C", status: null, fora: true });
      await sync([resp("iIns", { valor: 12.5, unidade: "°C" })]);
      expect(await r("iDt")).toMatchObject({ valor: 11.5, fora: false });
    });
    it("ninguém digita o ΔT (app ou escritório); a observação dele é livre; outra leitura não mexe no ΔT", async () => {
      comoTecnico();
      expect((await sync([resp("iDt", { valor: 99 })]))[0]).toMatchObject({ ok: false, status: 400, erro: "Este valor é calculado a partir das outras medições." });
      expect((await sync([resp("iDt", { status: "NAO_SE_APLICA" })]))[0]).toMatchObject({ ok: false, status: 400 });
      expect((await sync([resp("iDt", { observacao: "Conferido com termômetro." })]))[0]).toMatchObject({ ok: true });
      const [y] = await sync([resp("iCor", { valor: 7 })]);
      expect(y.dados.calculadas).toBeUndefined();
      expect(await r("iDt")).toMatchObject({ valor: 11.5, observacao: "Conferido com termômetro." });
      comoEscritorio();
      const url = { id: "os1", atividadeId: "a1", equipamentoId: "eq2" };
      expect((await chamar("ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/itens/[itemId]", "PUT", { ...url, itemId: "iDt" }, { valor: 10 })).status).toBe(400);
      await chamar("ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/itens/[itemId]", "PUT", { ...url, itemId: "iRet" }, { valor: 25 });
      const e = await chamar("ordens/[id]/atividades/[atividadeId]/execucao/equipamentos/[equipamentoId]/itens/[itemId]", "PUT", { ...url, itemId: "iIns" }, { valor: 18 });
      expect(e.json.calculadas).toEqual([{ itemId: "iDt", valor: 7, unidade: "°C", status: null }]);
      expect([await r("iIns", "eq2"), await r("iDt", "eq2")]).toMatchObject([{ fora: true }, { valor: 7, fora: true }]);
    });
  });

  describe("os destaques", () => {
    it("o cartão da atividade na OS conta as medições fora", async () => {
      comoEscritorio();
      const j = (await chamar("ordens/[id]/relatorios", "GET", { id: "os1" })).json;
      expect(j.resumo.atividades.map((a: any) => [a.id, a.foraDaFaixa])).toEqual([["a1", 3]]); // sucção (eq1), insuflamento e ΔT (eq2)
    });
    it("o relatório traz a faixa do momento e marca a fora; o equipamento ganha a contagem", async () => {
      const { blocosAtendidos, SELECT_CHECKLIST } = await import("@/lib/relatorio-os/dados");
      const at = await prisma.atividadeOs.findUnique({ where: { id: "a1" }, select: { id: true, titulo: true, checklistRespostas: SELECT_CHECKLIST, equipamentos: { select: { feito: true, observacao: true, equipamento: { include: { tipoEquipamento: true } } } } } });
      const { blocos } = blocosAtendidos([{ ...at, status: "EM_ANDAMENTO", respostas: [], respostasEquipamento: [], fotosAtendimento: [] }] as any, "Matriz") as any;
      const b1 = blocos.find((b) => b.id === "eq1");
      const suc = b1.checklistTipo[0].itens.find((i: any) => i.texto === "Pressão de sucção");
      expect(suc.medicao).toEqual({ valor: 95, unidade: "psi", faixa: { min: 115, max: 140 }, fora: true });
      expect(b1.resumoChecklist.foraDaFaixa).toBe(1);
      const ret = b1.checklistTipo[0].itens.find((i: any) => i.texto === "Temperatura de retorno");
      expect(ret.medicao).toMatchObject({ faixa: null, fora: false });
    });
    it("o painel: equipamentos distintos nos últimos 30 dias, o equipamento desativado e a outra empresa fora; as 3 mais recentes com a OS", async () => {
      const { medicoesForaDaFaixa } = await import("@/lib/dashboard/dados");
      // Leitura fora num equipamento desativado e outra antiga (31 dias): não contam
      comoTecnico();
      await sync([{ ...resp("iSuc", { valor: 50 }, "eq3"), atividadeId: "a2" }]);
      await prisma.checklistResposta.updateMany({ where: { equipamentoId: "eq2", itemId: "iIns" }, data: { respondidoEm: new Date(Date.now() - 31 * 24 * H) } });
      const p = await medicoesForaDaFaixa("e1");
      expect(p.equipamentos).toBe(2); // eq1 (sucção) e eq2 (ΔT)
      expect(p.ultimas).toHaveLength(2);
      expect(p.ultimas.map((u: any) => [u.equipamento, u.item, u.os.numero])).toEqual(expect.arrayContaining([
        ["Split sala 1", "Pressão de sucção", "OS-1"], ["Split sala 2", "Diferença de temperatura do ar (ΔT)", "OS-1"],
      ]));
      expect(p.ultimas.find((u: any) => u.item === "Pressão de sucção")).toMatchObject({ valor: 95, unidade: "psi", faixa: { min: 115, max: 140 } });
      expect(await medicoesForaDaFaixa("e2")).toEqual({ equipamentos: 0, ultimas: [] });
    });
  });
});
