/**
 * D1 — PAUSAR / IMPEDIMENTO, de ponta a ponta no PostgreSQL real (rotas de verdade: sync do app, retrato, Meu dia,
 * sino, cadastro de motivos): motivos padrão, pausar idempotente, uma pausa aberta por vez, impedimento × intervalo,
 * "Outro" pede texto, motivo inativado depois de escolhido sem sinal, retomar, encerrar como "Não concluída — precisa
 * voltar" (a atividade volta a reagendar; o "não atendido" de sempre leva o motivo), concluir fecha a pausa, o sino e a
 * atividade esquecida, e o relatório interno com as pausas.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/janeiro2-pausas-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { inicioHojeBR, instanteBR, partesBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pausas_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "joao@clima.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };
const comoEscritorio = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@clima.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, busca = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${busca}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });
const sync = async (operacoes: unknown[]) => (await chamar("tecnico/sync", "POST", {}, { operacoes, agora: new Date().toISOString() })).json.resultados as any[];
const H = 3_600_000;
const pausar = (atividadeId: string, d: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  op("pausar", atividadeId, { dados: { clientId: randomUUID(), motivoId: null, motivo: "x", impedimento: true, observacao: null, ...d }, ...extra });

describe.skipIf(!URL_PG)("D1 — pausar / impedimento (PostgreSQL real)", () => {
  let prisma: any;
  const pausasDe = (atividadeId: string) => prisma.atividadePausa.findMany({ where: { atividadeId }, orderBy: { inicio: "asc" } });
  const sino = async () => { comoEscritorio(); return (await chamar("alertas", "GET")).json; };
  let motivos: { id: string; nome: string; tipo: string; pedeTexto: boolean }[] = [];
  const motivo = (nome: string) => motivos.find((m) => m.nome === nome)!;

  beforeAll(async () => {
    const { ano, mes, dia } = partesBR();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instanteBR(ano, mes, dia, 12));
    const hoje = inicioHojeBR();
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "tecnico/atividades/[atividadeId]", "tecnico/meu-dia", "alertas", "cadastros/[entidade]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@clima.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Exemplo", cpfCnpj: "1" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoOs.create({ data: { id: "tVis", empresaId: "e1", nome: "Visita técnica", exigeEquipamento: false } });
    const os = (id: string, numero: string) => ({ id, empresaId: "e1", numero, clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Ar pingando" });
    await prisma.ordemServico.createMany({ data: ["A", "B", "C", "D", "E"].map((x, i) => os(`os${x}`, `OS-${i + 1}`)) });
    const at = (id: string, ordemServicoId: string, inicio: Date) =>
      ({ id, empresaId: "e1", ordemServicoId, titulo: `Visita ${id}`, tipoOsId: "tVis", tecnicoId: "t1", dataAgendada: inicio, status: "EM_ANDAMENTO", iniciadaEm: inicio });
    await prisma.atividadeOs.createMany({ data: [
      at("aA", "osA", new Date(hoje.getTime() + 7 * H)), // começou 5 h antes do meio-dia: esquecida (limite 4 h), se não estivesse pausada
      at("aB", "osB", new Date(Date.now() - H)),
      at("aC", "osC", new Date(Date.now() - H)),
      at("aD", "osD", new Date(Date.now() - H)),
      { ...at("aE", "osE", new Date(Date.now() + 2 * H)), status: "AGENDADA", iniciadaEm: null },
    ] });
    await prisma.equipamento.createMany({ data: [1, 2].map((n) => ({ id: `eq${n}`, empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Frigotec", modelo: "FT-1", nome: `Split ${n}` })) });
    await prisma.atividadeEquipamento.createMany({ data: [{ atividadeId: "aC", equipamentoId: "eq1", feito: true }, { atividadeId: "aC", equipamentoId: "eq2", feito: false }] });
  }, 180_000);
  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("motivos padrão: nascem na 1ª lista de Configurações, na ordem; o retrato do app leva os ativos", async () => {
    comoEscritorio();
    const lista = await chamar("cadastros/[entidade]", "GET", { entidade: "motivos-pausa" });
    expect(lista.status).toBe(200);
    const nomes = (lista.json.itens ?? lista.json).map((m: any) => m.nome);
    expect(nomes).toEqual(["Falta de peça/material", "Cliente ausente", "Acesso negado", "Aguardando aprovação do cliente", "Chuva/condição do local", "Almoço/intervalo", "Outro"]);
    // listar de novo não duplica — nem traz de volta o padrão que a empresa renomeou ou apagou
    const chuva = await prisma.motivoPausa.findFirst({ where: { empresaId: "e1", nome: "Chuva/condição do local" } });
    await prisma.motivoPausa.update({ where: { id: chuva.id }, data: { nome: "Chuva forte" } });
    await chamar("cadastros/[entidade]", "GET", { entidade: "motivos-pausa" });
    expect(await prisma.motivoPausa.count({ where: { empresaId: "e1" } })).toBe(7);
    expect(await prisma.motivoPausa.count({ where: { empresaId: "e1", nome: "Chuva/condição do local" } })).toBe(0);
    await prisma.motivoPausa.update({ where: { id: chuva.id }, data: { nome: "Chuva/condição do local" } });
    comoTecnico();
    const r = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).json;
    motivos = r.motivosPausa;
    expect(motivos.map((m) => [m.nome, m.tipo, m.pedeTexto])).toContainEqual(["Almoço/intervalo", "INTERVALO", false]);
    expect(motivos.map((m) => [m.nome, m.tipo, m.pedeTexto])).toContainEqual(["Outro", "IMPEDIMENTO", true]);
    expect(r.execucao.pausa).toBeNull();
  });

  it("pausar por impedimento: grava (hora do toque), o mesmo envio de novo não duplica, outra pausa com ela aberta é recusada", async () => {
    comoTecnico();
    const m = motivo("Falta de peça/material");
    const toque = new Date(Date.now() - 10 * 60_000).toISOString();
    const o = pausar("aA", { motivoId: m.id, motivo: "texto que o aparelho mandou", impedimento: false, observacao: " peça chega amanhã " }, { em: toque });
    const [r1] = await sync([o]);
    expect(r1).toMatchObject({ ok: true, status: 201 });
    const [r2] = await sync([o]); // o mesmo envio (fechou o app no meio)
    expect(r2.ok).toBe(true);
    const [r3] = await sync([{ ...o, id: randomUUID() }]); // outro envio, a mesma pausa (clientId)
    expect(r3).toMatchObject({ ok: true });
    const ps = await pausasDe("aA");
    expect(ps).toHaveLength(1);
    // o servidor vale: nome e tipo do cadastro, não o que o aparelho mandou
    expect(ps[0]).toMatchObject({ motivo: "Falta de peça/material", impedimento: true, observacao: "peça chega amanhã", fim: null, pausadoPorId: "uT", naoConcluida: false });
    expect(Math.abs(ps[0].inicio.getTime() - Date.parse(toque))).toBeLessThan(2000);
    const [r4] = await sync([pausar("aA", { motivoId: motivo("Almoço/intervalo").id, motivo: "Almoço/intervalo", impedimento: false })]);
    expect(r4).toMatchObject({ ok: false, status: 409, erro: "A atividade já está pausada." });
    const hist = await prisma.osHistorico.findMany({ where: { ordemServicoId: "osA" } });
    expect(hist.map((h: any) => [h.acao, h.detalhes])).toContainEqual(["Atividade pausada (impedimento)", "\"Visita aA\": Falta de peça/material — peça chega amanhã"]);
  });

  it("o técnico e o escritório veem: retrato, Meu dia, sino (impedimento) — e a atividade pausada não é 'esquecida'", async () => {
    comoTecnico();
    const r = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).json;
    expect(r.execucao.pausa).toMatchObject({ motivo: "Falta de peça/material", impedimento: true, observacao: "peça chega amanhã" });
    const dia = (await chamar("tecnico/meu-dia", "GET")).json;
    const cartao = [...dia.atividades, ...dia.anteriores].find((c: any) => c.atividadeId === "aA");
    expect(cartao.pausa).toMatchObject({ motivo: "Falta de peça/material", impedimento: true });
    const s = await sino();
    expect(s.impedimentosAbertos).toBe(1);
    expect(s.impedimentoOsId).toBe("osA");
    expect(s.atividadesEsquecidas).toBe(0); // aA começou há 5 h, mas está pausada
  });

  it("retomar fecha a pausa (a hora do toque); de novo não muda nada; o tempo pausado sai do tempo de execução", async () => {
    comoTecnico();
    const [p] = await pausasDe("aA");
    const [r1] = await sync([op("retomar", "aA", { dados: { pausaClientId: p.clientId } })]);
    expect(r1.ok).toBe(true);
    const [r2] = await sync([op("retomar", "aA", { dados: { pausaClientId: p.clientId } })]);
    expect(r2).toMatchObject({ ok: true });
    const [q] = await pausasDe("aA");
    expect(q.fim).not.toBeNull();
    expect(q.retomadoPorId).toBe("uT");
    const { tempoDeExecucaoMs, tempoPausadoMs } = await import("@/lib/pausas/regras");
    const a = await prisma.atividadeOs.findUnique({ where: { id: "aA" } });
    expect(tempoPausadoMs(a.iniciadaEm, new Date(), [q])).toBeGreaterThan(9 * 60_000);
    expect(tempoDeExecucaoMs(a.iniciadaEm, new Date(), [q])).toBe(Date.now() - a.iniciadaEm.getTime() - tempoPausadoMs(a.iniciadaEm, new Date(), [q]));
    expect((await sino()).impedimentosAbertos).toBe(0);
    expect((await sino()).atividadesEsquecidas).toBe(1); // retomada: volta a contar como esquecida
  });

  it("intervalo (almoço) não vai para o sino; 'Outro' pede o texto; motivo inativado depois de escolhido sem sinal ainda vale", async () => {
    comoTecnico();
    const almoco = motivo("Almoço/intervalo");
    const [r1] = await sync([pausar("aB", { motivoId: almoco.id, motivo: almoco.nome, impedimento: true /* o aparelho errou: vale o cadastro */ })]);
    expect(r1.ok).toBe(true);
    expect((await pausasDe("aB"))[0]).toMatchObject({ motivo: "Almoço/intervalo", impedimento: false });
    expect((await sino()).impedimentosAbertos).toBe(0);
    comoTecnico();
    const outro = motivo("Outro");
    const [r2] = await sync([pausar("aD", { motivoId: outro.id, motivo: outro.nome, observacao: "ok" })]);
    expect(r2).toMatchObject({ ok: false, status: 422, erro: "Escreva o motivo (pelo menos 3 letras)." });
    // o escritório inativou o "Acesso negado" depois de o técnico escolher sem sinal
    const acesso = motivo("Acesso negado");
    await prisma.motivoPausa.update({ where: { id: acesso.id }, data: { ativo: false } });
    const [r3] = await sync([pausar("aD", { motivoId: acesso.id, motivo: acesso.nome })]);
    expect(r3.ok).toBe(true);
    expect((await pausasDe("aD"))[0]).toMatchObject({ motivo: "Acesso negado", impedimento: true, motivoId: acesso.id });
    // o motivo apagado do cadastro: vale o texto que o aparelho mandou
    const [r4] = await sync([op("retomar", "aD", { dados: { pausaClientId: (await pausasDe("aD"))[0].clientId } }), pausar("aD", { motivoId: "nao-existe", motivo: "Portão trancado", impedimento: true })]);
    expect(r4.ok && (await pausasDe("aD")).at(-1)).toMatchObject({ motivo: "Portão trancado", impedimento: true, motivoId: null });
  });

  it("encerrar como 'Não concluída — precisa voltar': só com impedimento aberto; volta a reagendar com o motivo; o não feito vira 'não atendido'", async () => {
    comoTecnico();
    const [rInt] = await sync([op("naoConcluida", "aB", { dados: { pausaClientId: (await pausasDe("aB"))[0].clientId } })]);
    expect(rInt).toMatchObject({ ok: false, status: 409, erro: "Só uma pausa por impedimento encerra a visita como não concluída." });
    const cliente = motivo("Cliente ausente");
    const pC = pausar("aC", { motivoId: cliente.id, motivo: cliente.nome });
    await sync([pC]);
    const nc = op("naoConcluida", "aC", { dados: { pausaClientId: (pC as any).dados.clientId, observacao: "portaria fechada" } });
    const [r1] = await sync([nc]);
    expect(r1).toMatchObject({ ok: true });
    const [r2] = await sync([{ ...nc, id: randomUUID() }]);
    expect(r2).toMatchObject({ ok: true }); // de novo: já estava
    const a = await prisma.atividadeOs.findUnique({ where: { id: "aC" } });
    expect(a).toMatchObject({ status: "AGENDADA", dataAgendada: null, iniciadaEm: null });
    const p = (await pausasDe("aC"))[0];
    expect(p).toMatchObject({ naoConcluida: true, observacao: "portaria fechada" });
    expect(p.fim).not.toBeNull();
    const eqs = await prisma.atividadeEquipamento.findMany({ where: { atividadeId: "aC" }, orderBy: { equipamentoId: "asc" } });
    expect(eqs.map((e: any) => [e.equipamentoId, e.feito, e.observacao])).toEqual([
      ["eq1", true, null], // o feito não muda
      ["eq2", false, "Não concluída — precisa voltar: Cliente ausente (portaria fechada)"],
    ]);
    const hist = await prisma.osHistorico.findMany({ where: { ordemServicoId: "osC", acao: "Visita não concluída — reagendar" } });
    expect(hist).toHaveLength(1);
    // atividade sem data que só teve uma pausa comum (não encerrada): não é "não concluída"
    await prisma.atividadeOs.update({ where: { id: "aD" }, data: { status: "AGENDADA", dataAgendada: null } });
    const s = await sino();
    await prisma.atividadeOs.update({ where: { id: "aD" }, data: { status: "EM_ANDAMENTO", dataAgendada: new Date() } });
    expect(s.visitasNaoConcluidas).toBe(1);
    expect(s.naoConcluidaOsId).toBe("osC");
  });

  it("pausar só em andamento; concluir pausada fecha a pausa na hora da conclusão", async () => {
    comoTecnico();
    const [r0] = await sync([pausar("aE", { motivoId: motivo("Cliente ausente").id, motivo: "Cliente ausente" })]);
    expect(r0).toMatchObject({ ok: false, status: 409, erro: "Só dá para pausar a atividade em andamento (toque em “Cheguei” antes)." });
    // aB está pausada (almoço): concluir sem retomar
    const [r1] = await sync([op("concluir", "aB", { dados: {} })]);
    expect(r1.ok).toBe(true);
    const a = await prisma.atividadeOs.findUnique({ where: { id: "aB" } });
    const [p] = await pausasDe("aB");
    expect(p.fim?.getTime()).toBe(a.concluidaEm.getTime());
  });

  it("relatório da OS: as pausas vão nos dados (a tela só mostra na versão interna)", async () => {
    const { carregarOsParaRelatorio, montarRelatorioOs } = await import("@/lib/relatorio-os/dados");
    const d = montarRelatorioOs((await carregarOsParaRelatorio("osA", "e1"))!, null);
    expect(d.pausas.map((p: any) => [p.atividade, p.motivo, p.impedimento, !!p.fim])).toEqual([["Visita aA", "Falta de peça/material", true, true]]);
  });
});
