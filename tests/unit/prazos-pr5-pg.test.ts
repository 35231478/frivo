/**
 * Prazos da OS — PR 5 (relatório de cumprimento de prazos), com o Prisma real num PostgreSQL real
 * (schema descartável via `prisma db push`). Prova:
 *  - a LEITURA: o período olha a abertura do chamado e, sem chamado, a criação da OS; o recorte por
 *    cliente e por contrato; a OS sem nenhum prazo fica fora da tabela mas é contada à parte;
 *  - os NÚMEROS: o percentual do período com os três estados misturados, e o "sem registro" fora da
 *    conta — numa base de verdade, lida do banco;
 *  - MULTIEMPRESA: o relatório só vê a empresa da sessão (nem linha, nem contagem, nem cabeçalho);
 *  - o PDF: a rota exige Relatórios › Exportar (403 sem ela), devolve um PDF de verdade com o nome do
 *    cliente, o percentual e os casos sem registro — e o número do papel é o mesmo da tela.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/prazos-pr5-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { percentualCumprimento, textoPercentual } from "@/lib/prazos/cumprimento";
import { textoDoPdf } from "./pmoc-pdf-util";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_prazos_pr5_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

/** Quem vê o relatório mas não manda papel ao cliente */
const SO_VER = montarPermissoes({ relatorios: ["visualizar"], ordens: ["visualizar"] });
/** Quem vê e exporta */
const VER_E_EXPORTAR = montarPermissoes({ relatorios: ["visualizar", "exportar"], ordens: ["visualizar"] });
const logar = (o: { id?: string; empresaId?: string; role?: string; permissoes?: Permissoes } = {}) => {
  const id = o.id ?? "uGestor";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes: o.permissoes ?? VER_E_EXPORTAR, tecnicoId: null } };
};

async function pdf(query = "") {
  const mod = await import("@/app/api/relatorios/cumprimento-prazos/route");
  const req = new NextRequest(`http://localhost/api/relatorios/cumprimento-prazos${query ? `?${query}` : ""}`, { method: "GET" });
  const res: Response = await mod.GET(req);
  const tipo = res.headers.get("content-type") ?? "";
  return {
    status: res.status, tipo,
    disposicao: res.headers.get("content-disposition") ?? "",
    json: tipo.includes("json") ? await res.json().catch(() => null) : null,
    texto: tipo.includes("pdf") ? await textoDoPdf(new Uint8Array(await res.arrayBuffer())) : "",
  };
}

vi.setConfig({ testTimeout: 90_000 });
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
const dia = (data: string) => new Date(`${data}T00:00:00Z`);
/** 18/11/2026, uma quarta-feira às 15h de Brasília */
const AGORA = br("2026-11-18", "15:00");

describe.skipIf(!URL_PG)("Prazos da OS — PR 5: relatório de cumprimento de prazos (PostgreSQL real)", () => {
  let prisma: any;
  let relatorioCumprimento: any;
  let seq = 0;

  /** Uma OS/chamado da base do relatório */
  const os = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: {
    empresaId: "e1", clienteId: "c1", criadoPorId: "uGestor", numero: `OS-${String(++seq).padStart(3, "0")}`,
    descricao: "Split da recepção pingando", status: "CONCLUIDA", ...dados,
  } });
  /** Um chamado do cliente aberto em `abertoEm`, com 4 h para comparecer e 24 h para resolver */
  const chamado = (abertoEm: Date, dados: Record<string, unknown> = {}) => os({
    chamadoNumero: `CH-${seq + 1}`, origem: "PORTAL_CLIENTE", chamadoAbertoEm: abertoEm,
    atendimentoComparecerAte: new Date(abertoEm.getTime() + 4 * 3600_000),
    atendimentoResolverAte: new Date(abertoEm.getTime() + 24 * 3600_000),
    ...dados,
  });
  const relatorio = (filtro: Record<string, unknown> = {}, empresaId = "e1") => relatorioCumprimento(empresaId, filtro, AGORA);
  /** O mês de novembro de 2026 em Brasília, como `lerPeriodo` entrega */
  const NOVEMBRO = { gte: br("2026-11-01"), lt: br("2026-12-01") };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ relatorioCumprimento } = await import("@/lib/prazos/cumprimento-server"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Refrigeração", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uGestor", empresaId: "e1", nome: "Gabi Gestora", email: "g@x.com", senha: "x", role: "ADMIN" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia S/A", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e1", nome: "Padaria do Bairro", cpfCnpj: "11222333000262" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.contrato.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-2026/001", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: dia("2026-01-01") },
      { id: "ct2", empresaId: "e1", clienteId: "c1", numero: "CT-2026/002", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: dia("2026-01-01") },
      { id: "ctX", empresaId: "e2", clienteId: "cX", numero: "CT-E2", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: dia("2026-01-01") },
    ] });
    logar();
  }, 180_000);

  afterEach(async () => {
    logar();
    await prisma.ordemServico.deleteMany({});
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── o período ───────── */
  describe("o período olha a abertura", () => {
    it("o chamado entra pela abertura do cliente; a OS sem chamado, pela criação — e o mês vizinho fica fora", async () => {
      await chamado(br("2026-11-05", "09:00"), { atendimentoComparecidoEm: br("2026-11-05", "10:00"), dataConclusao: br("2026-11-05", "16:00") });
      await chamado(br("2026-10-28", "09:00"), { atendimentoComparecidoEm: br("2026-10-28", "10:00"), dataConclusao: br("2026-10-28", "16:00") });
      // OS criada em novembro, sem chamado: entra pelo prazo de execução
      await os({ criadoEm: br("2026-11-07", "08:00"), prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-09", "17:00") });
      await os({ criadoEm: br("2026-12-02", "08:00"), prazoExecucao: dia("2026-12-05"), dataConclusao: br("2026-12-04", "17:00") });

      const r = await relatorio(NOVEMBRO);
      expect(r.linhas.map((l: any) => l.abertura.toISOString()).sort()).toEqual([
        br("2026-11-05", "09:00").toISOString(), br("2026-11-07", "08:00").toISOString(),
      ]);
      expect(r.resumo.linhas).toBe(2);
      // sem período: tudo
      expect((await relatorio()).resumo.linhas).toBe(4);
    });

    it("a OS sem nenhum prazo não entra na tabela, mas é contada para a tela poder dizer isso", async () => {
      await os({ criadoEm: br("2026-11-07", "08:00"), status: "EM_ANDAMENTO" }); // sem prazo, sem previsão, sem chamado
      await os({ criadoEm: br("2026-11-08", "08:00"), prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-10", "17:00") });

      const r = await relatorio(NOVEMBRO);
      expect(r.linhas).toHaveLength(1);
      expect(r.semPrazo).toBe(1);
      expect(r.resumo.execucao).toEqual({ cumpridos: 1, descumpridos: 0, causaCliente: 0, semRegistro: 0 });
    });

    it("recorta por cliente e por contrato", async () => {
      await os({ clienteId: "c1", contratoId: "ct1", criadoEm: br("2026-11-03"), prazoExecucao: dia("2026-11-05"), dataConclusao: br("2026-11-04") });
      await os({ clienteId: "c1", contratoId: "ct2", criadoEm: br("2026-11-04"), prazoExecucao: dia("2026-11-06"), dataConclusao: br("2026-11-05") });
      await os({ clienteId: "c2", criadoEm: br("2026-11-05"), prazoExecucao: dia("2026-11-07"), dataConclusao: br("2026-11-06") });

      expect((await relatorio(NOVEMBRO)).linhas).toHaveLength(3);
      expect((await relatorio({ ...NOVEMBRO, clienteId: "c1" })).linhas).toHaveLength(2);
      expect((await relatorio({ ...NOVEMBRO, clienteId: "c2" })).linhas).toHaveLength(1);
      const porContrato = await relatorio({ ...NOVEMBRO, contratoId: "ct1" });
      expect(porContrato.linhas.map((l: any) => l.contratoNumero)).toEqual(["CT-2026/001"]);
    });
  });

  /* ───────── os números, da base de verdade ───────── */
  describe("os números do período, lidos do banco", () => {
    /**
     * A base: 4 chamados com os três estados misturados. Prometido por chamado = comparecer +
     * resolver; mais o prazo de execução de quem tem.
     */
    async function base() {
      // 1) chegou em 1 h e resolveu em 7 h: os dois cumpridos; execução cumprida
      await chamado(br("2026-11-03", "09:00"), {
        atendimentoComparecidoEm: br("2026-11-03", "10:00"), dataConclusao: br("2026-11-03", "16:00"),
        contratoId: "ct1", prazoExecucao: dia("2026-11-04"),
      });
      // 2) chegou em 6 h (fora das 4 h) e resolveu em 30 h (fora das 24 h): os dois descumpridos
      await chamado(br("2026-11-05", "09:00"), {
        atendimentoComparecidoEm: br("2026-11-05", "15:00"), dataConclusao: br("2026-11-06", "15:00"), contratoId: "ct1",
      });
      // 3) ninguém tocou em "Cheguei" e a OS encerrou depois do limite: comparecer SEM REGISTRO;
      //    resolveu em 10 h: cumprido
      await chamado(br("2026-11-07", "09:00"), { dataConclusao: br("2026-11-07", "19:00"), contratoId: "ct1" });
      // 4) cancelada com tudo em aberto: os dois SEM REGISTRO, e a execução fora da conta
      await chamado(br("2026-11-09", "09:00"), { status: "CANCELADA", contratoId: "ct1", prazoExecucao: dia("2026-11-10") });
    }

    it("o percentual do período conta os medidos e deixa o 'sem registro' fora — e o relatório diz quantos são", async () => {
      await base();
      const { resumo } = await relatorio(NOVEMBRO);
      expect(resumo.comparecer).toEqual({ cumpridos: 1, descumpridos: 1, causaCliente: 0, semRegistro: 2 });
      expect(resumo.resolver).toEqual({ cumpridos: 2, descumpridos: 1, causaCliente: 0, semRegistro: 1 });
      expect(resumo.execucao).toEqual({ cumpridos: 1, descumpridos: 0, causaCliente: 0, semRegistro: 0 });
      // 4 cumpridos de 6 medidos; os 3 sem registro não estão no denominador (seriam 4/9 = 44%)
      expect(resumo.geral).toEqual({ cumpridos: 4, descumpridos: 2, causaCliente: 0, semRegistro: 3 });
      expect(percentualCumprimento(resumo.geral)).toBe(67);
    });

    it("o mesmo relatório recortado por contrato bate com o do período (a conta não muda de lugar)", async () => {
      await base();
      const todos = await relatorio(NOVEMBRO);
      const doContrato = await relatorio({ ...NOVEMBRO, contratoId: "ct1" });
      expect(doContrato.resumo.geral).toEqual(todos.resumo.geral);
    });

    it("um período sem nenhuma OS: nenhuma linha, nada medido e percentual '—' (não 0%)", async () => {
      const { linhas, resumo, semPrazo } = await relatorio({ gte: br("2026-01-01"), lt: br("2026-02-01") });
      expect([linhas.length, semPrazo, resumo.linhas]).toEqual([0, 0, 0]);
      expect(textoPercentual(resumo.geral)).toBe("—");
    });
  });

  /* ───────── multiempresa ───────── */
  it("o relatório só vê a empresa da sessão — a OS da outra não entra em nenhuma conta", async () => {
    await os({ criadoEm: br("2026-11-03"), prazoExecucao: dia("2026-11-05"), dataConclusao: br("2026-11-04") });
    await os({ empresaId: "e2", clienteId: "cX", criadoPorId: "uB", criadoEm: br("2026-11-03"), prazoExecucao: dia("2026-11-05"), dataConclusao: br("2026-11-10") });

    const minha = await relatorio(NOVEMBRO);
    expect(minha.linhas).toHaveLength(1);
    expect(minha.resumo.execucao).toEqual({ cumpridos: 1, descumpridos: 0, causaCliente: 0, semRegistro: 0 });
    const outra = await relatorio(NOVEMBRO, "e2");
    expect(outra.resumo.execucao).toEqual({ cumpridos: 0, descumpridos: 1, causaCliente: 0, semRegistro: 0 });

    // e o cabeçalho também: o cliente da outra empresa não é "o cliente deste relatório"
    const { alvoDoRelatorio } = await import("@/lib/prazos/cumprimento-server");
    expect(await alvoDoRelatorio("e1", { clienteId: "cX" })).toEqual({ cliente: null, contrato: null });
    expect(await alvoDoRelatorio("e1", { contratoId: "ctX" })).toEqual({ cliente: null, contrato: null });
    expect((await alvoDoRelatorio("e1", { clienteId: "c1", contratoId: "ct1" })).cliente?.nomeFantasia).toBe("Hospital Santa Luzia");
  });

  /* ───────── o PDF do cliente ───────── */
  describe("o PDF do cliente", () => {
    beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AGORA); });
    afterAll(() => { vi.useRealTimers(); });

    async function doMes() {
      await chamado(br("2026-11-03", "09:00"), {
        atendimentoComparecidoEm: br("2026-11-03", "10:00"), dataConclusao: br("2026-11-03", "16:00"),
        contratoId: "ct1", prazoExecucao: dia("2026-11-04"),
      });
      await chamado(br("2026-11-07", "09:00"), { dataConclusao: br("2026-11-07", "19:00"), contratoId: "ct1" }); // sem "Cheguei"
    }

    it("a pausa marcada na OS chega ao papel do cliente: o percentual sobe e o motivo fica à vista", async () => {
      // dois chamados iguais, estourados nos três prazos; só um tem a causa do cliente marcada
      const comum = {
        contratoId: "ct1", prazoExecucao: dia("2026-11-04"),
        atendimentoComparecidoEm: br("2026-11-05", "09:00"), dataConclusao: br("2026-11-06", "16:00"),
      };
      await chamado(br("2026-11-03", "09:00"), comum);
      await chamado(br("2026-11-10", "09:00"), {
        ...comum, prazoExecucao: dia("2026-11-11"),
        atendimentoComparecidoEm: br("2026-11-12", "09:00"), dataConclusao: br("2026-11-13", "16:00"),
        atrasoJustificadoMotivo: "ACESSO_NEGADO", atrasoJustificadoObs: "sala técnica trancada", atrasoResponsavel: "CLIENTE",
      });

      const r = await relatorio({ ...NOVEMBRO, clienteId: "c1", contratoId: "ct1" });
      expect(r.resumo.geral.descumpridos).toBe(3); // os três prazos do chamado sem marcação
      expect(r.resumo.geral.causaCliente).toBe(3); // os três do chamado marcado, fora da conta
      expect(r.resumo.geral.cumpridos).toBe(0);
      expect(textoPercentual(r.resumo.geral)).toBe("0%"); // 0 de 3 medidos — e não 0 de 6
      const pausada = r.linhas.find((l: any) => l.motivo)!;
      expect([pausada.comparecer, pausada.resolver, pausada.execucao]).toEqual(["CAUSA_CLIENTE", "CAUSA_CLIENTE", "CAUSA_CLIENTE"]);
      expect(pausada.motivo).toBe("Acesso ao local negado");

      const p = await pdf("clienteId=c1&contratoId=ct1&mes=2026-11");
      expect(p.status).toBe(200);
      expect(p.texto).toContain("Causa do cliente");
      expect(p.texto).toContain("3 por causa do cliente, fora da conta");
      // o papel diz o motivo de cada pausa e explica a regra — nada sai da conta em silêncio
      expect(p.texto).toContain("Acesso ao local negado");
      expect(p.texto).toMatch(/ficam fora do percentual,\s+como prevê o contrato/); // o papel quebra a linha
      // e o jargão não vaza para o documento do cliente
      expect(p.texto).not.toMatch(/\bSLA\b/);
      expect(p.texto).not.toContain("ACESSO_NEGADO");
    });

    it("quem não tem Relatórios › Exportar não gera o papel (403), e quem não está logado nem chega lá", async () => {
      logar({ permissoes: SO_VER });
      expect((await pdf()).status).toBe(403);
      logar({ permissoes: PRESETS.TECNICO, role: "TECNICO" });
      expect((await pdf()).status).toBe(403);
      sessao.atual = null;
      expect((await pdf()).status).toBe(401);
    });

    it("com a permissão, devolve um PDF de verdade com o cliente, o percentual e os casos sem registro", async () => {
      await doMes();
      const r = await pdf("clienteId=c1&contratoId=ct1&mes=2026-11");
      expect(r.status).toBe(200);
      expect(r.tipo).toContain("application/pdf");
      expect(r.disposicao).toContain("attachment");
      expect(r.disposicao).toContain("Cumprimento de prazos");

      // o que o cliente lê no papel
      expect(r.texto).toContain("Relatório de cumprimento de prazos");
      expect(r.texto).toContain("Hospital Santa Luzia");
      expect(r.texto).toContain("CT-2026/001");
      expect(r.texto).toContain("Novembro de 2026");
      expect(r.texto).toContain("Clima Total"); // a empresa que assina
      // 4 cumpridos (comparecer, resolver, execução do 1º + resolver do 2º) de 4 medidos; 1 sem registro
      expect(r.texto).toContain("100%");
      expect(r.texto).toContain("4 de 4 prazos cumpridos");
      expect(r.texto).toContain("1 sem registro");
      expect(r.texto).toContain("fora da conta");
      // o vocabulário: cada prazo com o seu nome
      expect(r.texto).toContain("Comparecer");
      expect(r.texto).toContain("Prazo de execução");
      // chamado a chamado, com o estado de cada prazo em palavra (e o "sem registro" dito, não escondido)
      expect(r.texto).toContain("Sem registro");
      expect(r.texto).toContain("Cumprido");
      // o papel é DESTE cliente: não há coluna de cliente repetindo o nome em toda linha
      // (o nome aparece uma vez só, na capa — a coluna "Causa do cliente" do resumo é outra coisa)
      expect(r.texto.match(/Hospital Santa Luzia/g)).toHaveLength(1);
      // e a honestidade dita por extenso
      expect(r.texto).toContain("ficam fora do percentual");
    });

    it("o número do papel é o mesmo do relatório na tela (uma conta só, dois jeitos de mostrar)", async () => {
      await doMes();
      const { resumo } = await relatorio(NOVEMBRO);
      const r = await pdf("mes=2026-11");
      expect(r.status).toBe(200);
      expect(r.texto).toContain(textoPercentual(resumo.geral));
      expect(r.texto).toContain(`${resumo.geral.cumpridos} de ${resumo.geral.cumpridos + resumo.geral.descumpridos} prazos cumpridos`);
      // sem cliente escolhido, o papel é da operação inteira e mostra de quem é cada chamado
      expect(r.texto).toContain("Todos os clientes");
      expect(r.texto).toContain("CLIENTE");
    });

    it("`ver=1` abre no navegador em vez de baixar", async () => {
      await doMes();
      expect((await pdf("mes=2026-11&ver=1")).disposicao).toContain("inline");
    });

    it("um período vazio ainda gera o papel, dizendo que não há o que relatar (nunca 0% de cumprimento)", async () => {
      const r = await pdf("mes=2026-01");
      expect(r.status).toBe(200);
      expect(r.texto).toContain("Nenhum prazo a relatar no período");
      expect(r.texto).toContain("nenhum prazo medido");
      expect(r.texto).not.toContain("0%");
    });

    it("a OS da outra empresa não entra no papel desta", async () => {
      await os({ empresaId: "e2", clienteId: "cX", criadoPorId: "uB", numero: "OS-E2-9", chamadoNumero: "CH-E2-9", criadoEm: br("2026-11-03"), prazoExecucao: dia("2026-11-05"), dataConclusao: br("2026-11-10") });
      const r = await pdf("mes=2026-11");
      expect(r.status).toBe(200);
      expect(r.texto).not.toContain("CH-E2-9");
      expect(r.texto).toContain("Nenhum prazo a relatar no período");
    });
  });
});
