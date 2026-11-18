/**
 * Prazos da OS — PR 2 (prazo de execução nas telas), pelas rotas reais com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`). Prova:
 *  - a lista de OS filtra por prazo (atrasadas, vencem hoje, justificadas) com a MESMA regra da conta
 *    OS a OS, inclusive a data prevista gravada com hora; o filtro convive com a busca e o status;
 *  - a exportação traz o que a lista mostra (mesmo filtro) e as colunas do prazo;
 *  - atraso justificado: só quem tem Desempenho › Revisar; o técnico não; só quando há atraso (da OS
 *    ou de uma atividade, aberta ou já concluída); grava motivo, observação, quem e quando, e deixa
 *    rastro no histórico; alterar e desfazer; outra empresa não existe;
 *  - o tipo de OS grava o prazo padrão pelo cadastro e a OS criada depois nasce com o prazo;
 *  - o app do técnico recebe o prazo DEFINIDO (da atividade ou da OS), e nada quando ninguém definiu.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/prazos-pr2-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_ATRASO_NAO_ATRASADA, MSG_ATRASO_OUTRO, MSG_SEM_PERMISSAO_JUSTIFICAR, osAtrasada, situacaoPrazoExecucao } from "@/lib/os/prazo-execucao";
import { whereOrdens } from "@/lib/listas/filtros";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_prazos_pr2_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const logar = (o: { id?: string; empresaId?: string; role?: string; permissoes?: Permissoes; tecnicoId?: string | null } = {}) => {
  const id = o.id ?? "uGestor";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes: o.permissoes ?? GESTOR, tecnicoId: o.tecnicoId ?? null } };
};
/** O gestor: vê as OS e revisa o desempenho (não é administrador) */
const GESTOR = montarPermissoes({ ordens: ["visualizar", "editar"], desempenho: ["visualizar", "revisar"] });
/** Quem opera as OS, com tudo de OS — mas não revisa o desempenho */
const OPERADOR = montarPermissoes({ ordens: ["visualizar", "criar", "editar", "concluir", "excluir"], desempenho: ["visualizar"], configuracoes: ["visualizar", "gerenciar"] });

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query ? `?${query}` : ""}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json().catch(() => null) : null, texto: tipo.includes("json") ? "" : await res.text() };
}

vi.setConfig({ testTimeout: 90_000 });
const diaCivil = (chave: string) => new Date(`${chave}T00:00:00.000Z`);
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
const AGORA = br("2026-11-18", "15:00"); // quarta, 18/11/2026

describe.skipIf(!URL_PG)("Prazos da OS — PR 2: prazo de execução nas telas (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;
  const semear = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: {
    empresaId: "e1", clienteId: "c1", criadoPorId: "uGestor", numero: `OS-P${String(++seq).padStart(3, "0")}`, descricao: "Serviço", status: "ABERTA", ...dados,
  } });
  const lerOs = (id: string) => prisma.ordemServico.findUnique({ where: { id }, include: { historico: { orderBy: { criadoEm: "asc" } } } });
  const justificar = (id: string, corpo: unknown) => chamar("ordens/[id]/atraso-justificado", "POST", { id }, corpo);
  const desfazer = (id: string) => chamar("ordens/[id]/atraso-justificado", "DELETE", { id });
  const noRelogio = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AGORA); };

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
      { id: "uGestor", empresaId: "e1", nome: "Gabi Gestora", email: "g@x.com", senha: "x" },
      { id: "uOper", empresaId: "e1", nome: "Otto Operador", email: "op@x.com", senha: "x" },
      { id: "uTec", empresaId: "e1", nome: "João Silva", email: "t@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    logar();
  }, 180_000);

  afterEach(() => { vi.useRealTimers(); logar(); });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── a lista de OS e a exportação ───────── */
  describe("lista de OS: filtro Prazo", () => {
    const ids = new Map<string, string>();
    const casos: Array<[string, Record<string, unknown>, "ATRASADO" | "VENCE_HOJE" | "OUTRO"]> = [
      ["prazo próprio ontem", { prazoExecucao: diaCivil("2026-11-17") }, "ATRASADO"],
      ["prazo próprio hoje", { prazoExecucao: diaCivil("2026-11-18") }, "VENCE_HOJE"],
      ["prazo próprio amanhã", { prazoExecucao: diaCivil("2026-11-19") }, "OUTRO"],
      ["prevista ontem (dia)", { previsaoConclusao: diaCivil("2026-11-17") }, "ATRASADO"],
      ["prevista ontem às 22h de Brasília (já é hoje em UTC)", { previsaoConclusao: br("2026-11-17", "22:00") }, "ATRASADO"],
      ["prevista hoje (dia)", { previsaoConclusao: diaCivil("2026-11-18") }, "VENCE_HOJE"],
      ["prevista hoje às 8h", { previsaoConclusao: br("2026-11-18", "08:00") }, "VENCE_HOJE"],
      ["prevista hoje às 23h (já é amanhã em UTC)", { previsaoConclusao: br("2026-11-18", "23:00") }, "VENCE_HOJE"],
      ["prevista amanhã (dia)", { previsaoConclusao: diaCivil("2026-11-19") }, "OUTRO"],
      ["prevista ontem, prazo próprio hoje", { previsaoConclusao: br("2026-11-17", "10:00"), prazoExecucao: diaCivil("2026-11-18") }, "VENCE_HOJE"],
      ["prevista hoje, prazo próprio ontem", { previsaoConclusao: br("2026-11-18", "10:00"), prazoExecucao: diaCivil("2026-11-17") }, "ATRASADO"],
      ["sem prazo nem previsão", {}, "OUTRO"],
      ["concluída com prazo vencido", { prazoExecucao: diaCivil("2026-11-10"), status: "CONCLUIDA" }, "OUTRO"],
      ["concluída com prazo hoje (não vence mais)", { prazoExecucao: diaCivil("2026-11-18"), status: "CONCLUIDA" }, "OUTRO"],
      ["cancelada prevista para hoje", { previsaoConclusao: br("2026-11-18", "10:00"), status: "CANCELADA" }, "OUTRO"],
      ["cancelada com prazo vencido", { prazoExecucao: diaCivil("2026-11-10"), status: "CANCELADA" }, "OUTRO"],
      ["atrasada e justificada", { prazoExecucao: diaCivil("2026-11-12"), atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoJustificadoObs: "Portaria fechada", descricao: "Troca do compressor" }, "ATRASADO"],
    ];
    const listar = async (sp: Record<string, string>) => (await prisma.ordemServico.findMany({ where: whereOrdens("e1", sp, AGORA), select: { id: true } })).map((o: any) => o.id).sort();
    const dos = (situacao: string) => casos.filter(([, , s]) => s === situacao).map(([nome]) => ids.get(nome)!).sort();

    beforeAll(async () => {
      for (const [nome, dados] of casos) ids.set(nome, (await semear(dados)).id);
      await prisma.ordemServico.create({ data: { empresaId: "e2", clienteId: "cX", criadoPorId: "uB", numero: "OS-E2", descricao: "Serviço", status: "ABERTA", prazoExecucao: diaCivil("2026-11-01") } });
    });

    it("atrasadas e vencem hoje: o filtro do banco dá exatamente as OS que a conta OS a OS aponta", async () => {
      const todas = await prisma.ordemServico.findMany({ where: { empresaId: "e1" } });
      // a conferência: a regra pura, OS a OS, dá o que a tabela de casos espera…
      for (const [nome, , esperado] of casos) {
        const os = todas.find((o: any) => o.id === ids.get(nome));
        const s = situacaoPrazoExecucao(os, AGORA).situacao;
        expect(s === "ATRASADO" || s === "VENCE_HOJE" ? s : "OUTRO", nome).toBe(esperado);
      }
      // …e o filtro da lista devolve as mesmas
      expect(await listar({ prazo: "atrasadas" })).toEqual(dos("ATRASADO"));
      expect(await listar({ prazo: "hoje" })).toEqual(dos("VENCE_HOJE"));
      expect(todas.filter((o: any) => osAtrasada(o, AGORA)).map((o: any) => o.id).sort()).toEqual(dos("ATRASADO"));
    });

    it("justificadas: só as que têm motivo; valor desconhecido não filtra", async () => {
      expect(await listar({ prazo: "justificadas" })).toEqual([ids.get("atrasada e justificada")]);
      expect(await listar({ prazo: "qualquer" })).toEqual(await listar({}));
    });

    it("o filtro convive com a busca, o status e o período (não derruba nem é derrubado)", async () => {
      // busca: só a "Troca do compressor" entre as atrasadas
      expect(await listar({ prazo: "atrasadas", busca: "compressor" })).toEqual([ids.get("atrasada e justificada")]);
      expect(await listar({ prazo: "atrasadas", busca: "nada-disso" })).toEqual([]);
      // status pedido não ressuscita concluída/cancelada como atrasada
      expect(await listar({ prazo: "atrasadas", status: "CONCLUIDA,CANCELADA" })).toEqual([]);
      expect(await listar({ prazo: "atrasadas", status: "ABERTA" })).toEqual(dos("ATRASADO"));
      expect(await listar({ prazo: "hoje", status: "CONCLUIDA,CANCELADA" })).toEqual([]); // nem "vence hoje" o que já encerrou
      // período de hoje: das atrasadas, só entra a que tem algo HOJE (a prevista para hoje com o prazo de ontem)
      expect(await listar({ prazo: "atrasadas", periodo: "hoje" })).toContain(ids.get("prevista hoje, prazo próprio ontem"));
      // o período olha também o PRAZO: a OS só com prazo próprio hoje aparece em "hoje"
      expect(await listar({ periodo: "hoje" })).toContain(ids.get("prazo próprio hoje"));
    });

    it("exportação: o arquivo traz o que a lista mostra (mesmo filtro) e as colunas do prazo", async () => {
      noRelogio();
      const r = await chamar("ordens/export", "GET", {}, undefined, "prazo=atrasadas&sort=numero&dir=asc");
      expect(r.status).toBe(200);
      const linhas = r.texto.replace(/^﻿/, "").split("\r\n").map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, "")));
      expect(linhas[0]).toEqual(["Número", "Cliente", "Tipo", "Status", "Prioridade", "Técnico", "Data abertura", "Data prevista", "Prazo", "Situação do prazo", "Atraso justificado", "Conclusão"]);
      const todas = await prisma.ordemServico.findMany({ where: { id: { in: dos("ATRASADO") } }, orderBy: { numero: "asc" } });
      expect(linhas.slice(1).map((l) => l[0])).toEqual(todas.map((o: any) => o.numero));
      const justificada = linhas.find((l) => l[0] === todas.find((o: any) => o.atrasoJustificadoMotivo).numero)!;
      expect(justificada.slice(7, 11)).toEqual(["—", "12/11/2026", "Atrasada 6 dias", "Cliente ausente: Portaria fechada"]);
      // a prevista ontem às 22h de Brasília: a data é a de Brasília (17), não a de UTC (18)
      const noite = linhas.find((l) => l[0] === todas.find((o: any) => o.id === ids.get("prevista ontem às 22h de Brasília (já é hoje em UTC)")).numero)!;
      expect(noite.slice(7, 10)).toEqual(["17/11/2026", "17/11/2026", "Atrasada 1 dia"]);
      // sem o filtro, o arquivo volta a ter todas as não canceladas
      const tudo = await chamar("ordens/export", "GET", {}, undefined, "");
      expect(tudo.texto.split("\r\n").length - 1).toBe(casos.filter(([, d]) => d.status !== "CANCELADA").length);
    });
  });

  /* ───────── atraso justificado ───────── */
  describe("atraso justificado", () => {
    it("o gestor justifica uma OS atrasada: grava motivo, observação, quem e quando, e fica no histórico", async () => {
      noRelogio();
      const os = await semear({ prazoExecucao: diaCivil("2026-11-15") });
      const r = await justificar(os.id, { motivo: "CLIENTE_AUSENTE", observacao: "  Ninguém na portaria.  " });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoJustificadoObs: "Ninguém na portaria.", atrasoJustificadoPor: { id: "uGestor", nome: "Gabi Gestora" } });
      const gravada = await lerOs(os.id);
      expect(gravada).toMatchObject({ atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoJustificadoObs: "Ninguém na portaria.", atrasoJustificadoPorId: "uGestor", status: "ABERTA" });
      expect(gravada.atrasoJustificadoEm.toISOString()).toBe(AGORA.toISOString());
      expect(gravada.prazoExecucao.toISOString()).toBe("2026-11-15T00:00:00.000Z"); // a OS continua atrasada: o prazo não muda
      expect(gravada.historico.map((h: any) => [h.acao, h.detalhes, h.usuarioId])).toEqual([["Atraso justificado", "Cliente ausente: Ninguém na portaria.", "uGestor"]]);
    });

    it("validação: motivo fora da lista e \"Outro\" sem explicação são recusados (400) e nada é gravado", async () => {
      noRelogio();
      const os = await semear({ prazoExecucao: diaCivil("2026-11-15") });
      for (const [corpo, mensagem] of [
        [{ motivo: "PREGUICA" }, "Escolha o motivo do atraso."], [{}, "Escolha o motivo do atraso."],
        [{ motivo: "OUTRO" }, MSG_ATRASO_OUTRO], [{ motivo: "OUTRO", observacao: "   " }, MSG_ATRASO_OUTRO],
        [{ motivo: "CLIMA", observacao: "x".repeat(501) }, "Explicação com no máximo 500 caracteres."],
      ] as const) {
        const r = await justificar(os.id, corpo);
        expect(r.status, JSON.stringify(corpo)).toBe(400);
        expect(r.json.erro).toBe(mensagem);
      }
      const gravada = await lerOs(os.id);
      expect(gravada.atrasoJustificadoMotivo).toBeNull();
      expect(gravada.historico).toEqual([]);
      // "Outro" com a explicação passa; motivo da lista dispensa a explicação
      expect((await justificar(os.id, { motivo: "OUTRO", observacao: "Elevador quebrado" })).status).toBe(200);
      expect((await justificar(os.id, { motivo: "CLIMA" })).json).toMatchObject({ atrasoJustificadoMotivo: "CLIMA", atrasoJustificadoObs: null });
    });

    it("só quando há atraso: OS no prazo é recusada (409); atividade atrasada, OS concluída depois do prazo e atividade concluída tarde contam", async () => {
      noRelogio();
      const noPrazo = await semear({ prazoExecucao: diaCivil("2026-11-25") });
      const venceHoje = await semear({ prazoExecucao: diaCivil("2026-11-18") });
      const cancelada = await semear({ prazoExecucao: diaCivil("2026-11-01"), status: "CANCELADA" });
      for (const os of [noPrazo, venceHoje, cancelada]) {
        const r = await justificar(os.id, { motivo: "CLIMA" });
        expect(r.status, os.numero).toBe(409);
        expect(r.json.erro).toBe(MSG_ATRASO_NAO_ATRASADA);
        expect((await lerOs(os.id)).atrasoJustificadoMotivo).toBeNull();
      }
      const atividade = (ordemServicoId: string, dados: Record<string, unknown>) =>
        prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId, titulo: "Visita", status: "AGENDADA", ...dados } });
      // a OS está no prazo, mas uma atividade aberta passou do dia
      const comAtividade = await semear({ prazoExecucao: diaCivil("2026-11-30") });
      await atividade(comAtividade.id, { dataAgendada: br("2026-11-12", "09:00") });
      expect((await justificar(comAtividade.id, { motivo: "PECA_FALTANDO" })).status).toBe(200);
      // OS concluída um dia depois do prazo
      const concluidaTarde = await semear({ prazoExecucao: diaCivil("2026-11-10"), status: "CONCLUIDA", dataConclusao: br("2026-11-11", "09:00") });
      expect((await justificar(concluidaTarde.id, { motivo: "ACESSO_NEGADO" })).status).toBe(200);
      // OS concluída NO prazo, mas com uma atividade concluída tarde (é o que pesa no desempenho)
      const atividadeTarde = await semear({ prazoExecucao: diaCivil("2026-11-20"), status: "CONCLUIDA", dataConclusao: br("2026-11-14", "09:00") });
      await atividade(atividadeTarde.id, { status: "CONCLUIDA", dataAgendada: br("2026-11-12", "09:00"), concluidaEm: br("2026-11-14", "09:00") });
      expect((await justificar(atividadeTarde.id, { motivo: "CLIENTE_AUSENTE" })).status).toBe(200);
      // OS concluída no prazo e sem atividade atrasada: nada a justificar
      const emDia = await semear({ prazoExecucao: diaCivil("2026-11-20"), status: "CONCLUIDA", dataConclusao: br("2026-11-14", "09:00") });
      await atividade(emDia.id, { status: "CONCLUIDA", dataAgendada: br("2026-11-14", "09:00"), concluidaEm: br("2026-11-14", "17:00") });
      expect((await justificar(emDia.id, { motivo: "CLIMA" })).status).toBe(409);
    });

    it("QUEM: quem opera as OS (com todas as ações de OS), os perfis padrão e o técnico são recusados; o administrador pode", async () => {
      noRelogio();
      const os = await semear({ prazoExecucao: diaCivil("2026-11-15") });
      const tentativas: Array<[string, Parameters<typeof logar>[0]]> = [
        ["operador com tudo de OS", { id: "uOper", permissoes: OPERADOR }],
        ["supervisor (perfil padrão)", { id: "uOper", permissoes: PRESETS.SUPERVISOR }],
        ["técnico no app", { id: "uTec", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" }],
        ["técnico a quem deram Desempenho › Revisar por engano", { id: "uTec", role: "TECNICO", permissoes: GESTOR, tecnicoId: "t1" }],
      ];
      for (const [quem, login] of tentativas) {
        logar(login);
        const r = await justificar(os.id, { motivo: "CLIMA" });
        expect(r.status, quem).toBe(403);
        expect((await desfazer(os.id)).status, quem).toBe(403);
      }
      logar({ id: "uOper", permissoes: OPERADOR });
      expect((await justificar(os.id, { motivo: "CLIMA" })).json.erro).toBe(MSG_SEM_PERMISSAO_JUSTIFICAR);
      // quem revisa o desempenho mas NÃO vê as OS também não entra
      logar({ permissoes: montarPermissoes({ desempenho: ["visualizar", "revisar"] }) });
      expect((await justificar(os.id, { motivo: "CLIMA" })).status).toBe(403);
      sessao.atual = null;
      expect((await justificar(os.id, { motivo: "CLIMA" })).status).toBe(401);
      expect((await lerOs(os.id)).atrasoJustificadoMotivo).toBeNull(); // nenhuma tentativa gravou
      // administrador (mesmo sem a permissão marcada) pode
      logar({ id: "uGestor", role: "ADMIN", permissoes: permissoesTotais() });
      expect((await justificar(os.id, { motivo: "CLIMA" })).status).toBe(200);
    });

    it("alterar e desfazer: o histórico conta as três coisas; desfazer sem justificativa é 409", async () => {
      noRelogio();
      const os = await semear({ prazoExecucao: diaCivil("2026-11-15") });
      expect((await desfazer(os.id)).status).toBe(409);
      await justificar(os.id, { motivo: "CLIMA", observacao: "Chuva forte" });
      expect((await justificar(os.id, { motivo: "PECA_FALTANDO" })).status).toBe(200);
      const r = await desfazer(os.id);
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoJustificadoEm: null, atrasoJustificadoPor: null });
      const gravada = await lerOs(os.id);
      expect(gravada).toMatchObject({ atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoJustificadoPorId: null, atrasoJustificadoEm: null });
      expect(gravada.historico.map((h: any) => [h.acao, h.detalhes])).toEqual([
        ["Atraso justificado", "Chuva ou clima: Chuva forte"],
        ["Justificativa do atraso alterada", "Peça faltando"],
        ["Justificativa do atraso desfeita", "Era: Peça faltando."],
      ]);
    });

    it("multiempresa: a OS da outra empresa não existe (404) e nada muda nela", async () => {
      noRelogio();
      const os = await semear({ prazoExecucao: diaCivil("2026-11-15") });
      logar({ id: "uB", empresaId: "e2", role: "ADMIN", permissoes: permissoesTotais() });
      expect((await justificar(os.id, { motivo: "CLIMA" })).status).toBe(404);
      expect((await desfazer(os.id)).status).toBe(404);
      expect((await lerOs(os.id)).atrasoJustificadoMotivo).toBeNull();
    });

    it("apagar o usuário que justificou não apaga a OS nem a justificativa (perde-se só o nome)", async () => {
      noRelogio();
      await prisma.usuario.create({ data: { id: "uSai", empresaId: "e1", nome: "Vai Embora", email: "sai@x.com", senha: "x" } });
      const os = await semear({ prazoExecucao: diaCivil("2026-11-15") });
      logar({ id: "uSai", permissoes: GESTOR });
      expect((await justificar(os.id, { motivo: "CLIMA" })).status).toBe(200);
      await prisma.osHistorico.deleteMany({ where: { usuarioId: "uSai" } });
      await prisma.usuario.delete({ where: { id: "uSai" } });
      expect(await lerOs(os.id)).toMatchObject({ atrasoJustificadoMotivo: "CLIMA", atrasoJustificadoPorId: null });
    });
  });

  /* ───────── tipo de OS e app do técnico ───────── */
  it("tipo de OS: o cadastro grava o prazo padrão (texto do formulário), limpa com vazio, recusa o inválido — e a OS criada depois nasce com o prazo", async () => {
    logar({ id: "uOper", permissoes: OPERADOR });
    const criado = await chamar("cadastros/[entidade]", "POST", { entidade: "tipos-os" }, { nome: "Corretiva", prazoExecucaoDias: "3" });
    expect(criado.status, JSON.stringify(criado.json)).toBe(201);
    const id = criado.json.id as string;
    expect((await prisma.tipoOs.findUnique({ where: { id } })).prazoExecucaoDias).toBe(3);

    const ruim = await chamar("cadastros/[entidade]/[id]", "PUT", { entidade: "tipos-os", id }, { prazoExecucaoDias: "400" });
    expect(ruim.status).toBe(400);
    expect(JSON.stringify(ruim.json)).toContain("Prazo padrão: no máximo 365 dias.");
    expect((await prisma.tipoOs.findUnique({ where: { id } })).prazoExecucaoDias).toBe(3);

    // a lista do cadastro devolve o campo (é o que a coluna "Prazo padrão" mostra)
    const lista = await chamar("cadastros/[entidade]", "GET", { entidade: "tipos-os" });
    expect((lista.json.itens ?? lista.json).find((t: any) => t.id === id).prazoExecucaoDias).toBe(3);

    // a OS aberta com este tipo ganha o prazo: dia agendado + 3
    await prisma.tecnico.update({ where: { id: "t1" }, data: { competencias: { connect: [{ id }] } } });
    const os = await chamar("ordens", "POST", {}, {
      clienteId: "c1", unidadeId: "un1", descricao: "Corretiva no split", prioridade: "NORMAL",
      execucao: { tipoOsId: id, dataAgendada: "2026-11-20T12:00:00.000Z", tecnicoIds: ["t1"], responsavelId: "t1" },
    });
    expect(os.status, JSON.stringify(os.json)).toBe(201);
    expect((await prisma.ordemServico.findUnique({ where: { id: os.json.id } })).prazoExecucao.toISOString()).toBe("2026-11-23T00:00:00.000Z");

    const limpo = await chamar("cadastros/[entidade]/[id]", "PUT", { entidade: "tipos-os", id }, { prazoExecucaoDias: "" });
    expect(limpo.status, JSON.stringify(limpo.json)).toBe(200);
    expect((await prisma.tipoOs.findUnique({ where: { id } })).prazoExecucaoDias).toBeNull();
  });

  it("app do técnico: o cartão leva o prazo DEFINIDO (da atividade ou da OS, o mais próximo) e nada quando ninguém definiu", async () => {
    const { meuDia } = await import("@/lib/tecnico/dia");
    const comAtividade = async (dadosOs: Record<string, unknown>, dadosAtividade: Record<string, unknown> = {}) => {
      const os = await semear(dadosOs);
      const a = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, tecnicoId: "t1", titulo: "Visita", status: "AGENDADA", dataAgendada: br("2026-11-18", "09:00"), ...dadosAtividade } });
      return a.id as string;
    };
    const semPrazo = await comAtividade({ previsaoConclusao: br("2026-11-18", "09:00") }); // só a agenda: não é prazo definido
    const daOs = await comAtividade({ prazoExecucao: diaCivil("2026-11-25") });
    const daAtividade = await comAtividade({ prazoExecucao: diaCivil("2026-11-25") }, { prazo: diaCivil("2026-11-20") });
    const osMaisCedo = await comAtividade({ prazoExecucao: diaCivil("2026-11-19") }, { prazo: diaCivil("2026-11-22") });

    const dia = await meuDia("e1", "t1", AGORA);
    const prazoDe = (atividadeId: string) => dia.atividades.find((c) => c.atividadeId === atividadeId)!.prazo;
    expect([prazoDe(semPrazo), prazoDe(daOs), prazoDe(daAtividade), prazoDe(osMaisCedo)]).toEqual([null, "2026-11-25", "2026-11-20", "2026-11-19"]);
  });
});
