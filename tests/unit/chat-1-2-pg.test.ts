/**
 * CHAT-1.2 no PostgreSQL REAL e pelas rotas reais (dados fictícios) — a situação e a presença do técnico, como o
 * escritório vê:
 *  - cada situação lida do banco: pausada (pausa aberta, D1), em execução, a caminho (aviso de hoje sem "Cheguei"),
 *    fora do expediente (jornada do cadastro), sem atividade; a atividade pela EQUIPE também conta;
 *  - na lista Pessoas, no cabeçalho da conversa e no tempo real (o mesmo canal do chat);
 *  - o contato do app: gravado pelo tempo real do app, pela sincronização e pela localização, NO MÁXIMO 1 vez por
 *    minuto (nem a memória de outra instância faz escrever de novo dentro do minuto);
 *  - permissão: só quem tem "Conversas" recebe; "Ver só os próprios" não vê o nº da OS dos outros; o técnico NÃO
 *    recebe presença nem situação de ninguém; outra empresa não aparece;
 *  - as consultas: a lista e o tempo real com o nº de consultas medido (antes/depois na descrição do PR).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/chat-1-2-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_chat12_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/push/servidor", async (orig) => ({ ...(await orig<typeof import("@/lib/push/servidor")>()), usuariosComAparelho: vi.fn(async () => []), enviarPush: vi.fn(async () => ({ enviados: 0 })) }));

const TOTAIS = permissoesTotais();
const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, email: `${id}@exemplo.test`, empresaId: "e1", role: "ADMIN", permissoes: TOTAIS, tecnicoId: null, ...extra });
const como = (u: Record<string, unknown>) => { sessao.atual = { user: u }; };
const comoAdmin = () => como(user("uA"));
// Ver só os próprios em OS, com "Conversas"
const comoVendedor = () => como(user("uV", { role: "OPERADOR", permissoes: { ...TOTAIS, ordens: { ...TOTAIS.ordens, verSoProprios: true } } }));
// Vê OS, mas sem "Conversas"
const comoLeitor = () => como(user("uL", { role: "OPERADOR", permissoes: { ...TOTAIS, conversas: { visualizar: false, enviar: false } } }));
const comoTecnico = (id = "uT1", tecnicoId = "t1") => como({ id, name: id, email: `${id}@exemplo.test`, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId });

async function chamar(rota: string, metodo = "GET", params: Record<string, string> = {}, corpo?: unknown, qs = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${qs}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("CHAT-1.2: situação e presença do técnico (PostgreSQL real)", () => {
  let prisma: any;
  const consultas: string[] = [];
  const agora = new Date();
  const horas = (h: number) => new Date(agora.getTime() + h * 3_600_000);
  let dia: Date;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: "event", level: "query" }] });
    prisma.$on("query", (e: { query: string }) => consultas.push(e.query));
    (globalThis as any).prisma = prisma;
    await Promise.all(["conversas/pessoas", "conversas/pessoas/[usuarioId]", "conversas/novidades", "tecnico/conversas", "tecnico/conversas/novidades", "tecnico/sync", "tecnico/posicao"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    const { chaveDiaBR, diaCivilDeChave } = await import("@/lib/fuso");
    dia = diaCivilDeChave(chaveDiaBR(agora))!;

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Empresa Exemplo", cnpj: "12.345.678/0001-90", email: "contato@exemplo.test" },
      { id: "e2", nome: "Outra Empresa", cnpj: "98.765.432/0001-10", email: "outra@exemplo.test" },
    ] });
    const usuario = (id: string, empresaId = "e1", role = "TECNICO") => ({ id, empresaId, nome: id, email: `${id}@exemplo.test`, senha: "x", role });
    await prisma.usuario.createMany({ data: [usuario("uA", "e1", "ADMIN"), usuario("uV", "e1", "OPERADOR"), usuario("uL", "e1", "OPERADOR"),
      usuario("uT1"), usuario("uT2"), usuario("uT3"), usuario("uT4"), usuario("uT5"), usuario("uT6"), usuario("uX", "e2")] });
    // Jornada de 24 h todos os dias (nunca "fora"), menos o t4: jornada de 1 minuto num dia que não é hoje (sempre "fora")
    const todoDia = { jornadaFaixas: [{ dias: ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"], entrada: "00:00", saida: "23:59", intervaloInicio: null, intervaloFim: null }] };
    const tecnico = (id: string, nome: string, empresaId = "e1", jornada: Record<string, unknown> = todoDia) =>
      ({ id, empresaId, nome, cpf: id, telefone: "1", email: `u${id.toUpperCase()}@exemplo.test`, ...jornada });
    const { DIAS_SEMANA } = await import("@/lib/colaborador/jornada");
    const { partesBR } = await import("@/lib/fuso");
    const ontem = DIAS_SEMANA[(partesBR(agora).diaSemana + 5) % 7];
    await prisma.tecnico.createMany({ data: [
      tecnico("t1", "Ana Pausada"), tecnico("t2", "Bruno Executando"), tecnico("t3", "Carla A Caminho"),
      tecnico("t4", "Davi Fora", "e1", { jornadaFaixas: [{ dias: [ontem], entrada: "08:00", saida: "08:01", intervaloInicio: null, intervaloFim: null }] }),
      tecnico("t5", "Eva Livre"), tecnico("t6", "Fábio Equipe"), tecnico("tx", "Xavier", "e2"),
    ] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Mercado Exemplo", cpfCnpj: "1" }, { id: "c2", empresaId: "e2", nome: "Cliente Outro", cpfCnpj: "2" }] });
    const os = (id: string, numero: string, criadoPorId = "uA", empresaId = "e1") => ({ id, empresaId, numero, clienteId: empresaId === "e1" ? "c1" : "c2", criadoPorId, descricao: "Manutenção", status: "EM_ANDAMENTO" });
    await prisma.ordemServico.createMany({ data: [os("os1", "OS-0001"), os("os2", "OS-0002", "uV"), os("os3", "OS-0003"), os("os5", "OS-0005"), os("os6", "OS-0006"), os("osx", "OS-9001", "uX", "e2")] });
    await prisma.atividadeOs.createMany({ data: [
      // t1: em andamento com a pausa aberta (impedimento)
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Corretiva", tecnicoId: "t1", status: "EM_ANDAMENTO", iniciadaEm: horas(-2), dataAgendada: horas(-3) },
      // t2: em andamento (a OS é do vendedor uV: ele vê o número)
      { id: "a2", empresaId: "e1", ordemServicoId: "os2", titulo: "Preventiva", tecnicoId: "t2", status: "EM_ANDAMENTO", iniciadaEm: horas(-1), dataAgendada: horas(-1) },
      // t3: agendada, avisou "A caminho" hoje
      { id: "a3", empresaId: "e1", ordemServicoId: "os3", titulo: "Instalação", tecnicoId: "t3", status: "AGENDADA", dataAgendada: horas(1) },
      // t5: avisou "A caminho" E "Cheguei" (não está mais a caminho) e não começou
      { id: "a5", empresaId: "e1", ordemServicoId: "os5", titulo: "Visita", tecnicoId: "t5", status: "AGENDADA", dataAgendada: horas(1) },
      // t6: pela EQUIPE (sem responsável), em andamento
      { id: "a6", empresaId: "e1", ordemServicoId: "os6", titulo: "Em dupla", tecnicoId: null, status: "EM_ANDAMENTO", iniciadaEm: horas(-0.5), dataAgendada: horas(-1) },
      { id: "ax", empresaId: "e2", ordemServicoId: "osx", titulo: "Outra", tecnicoId: "tx", status: "EM_ANDAMENTO", iniciadaEm: horas(-1), dataAgendada: horas(-1) },
    ] });
    await prisma.atividadeTecnico.create({ data: { atividadeId: "a6", tecnicoId: "t6" } });
    await prisma.atividadePausa.create({ data: { empresaId: "e1", atividadeId: "a1", motivo: "Falta de peça/material", impedimento: true, inicio: horas(-0.25), clientId: "p1" } });
    const aviso = (atividadeId: string, evento: string, usuarioId: string) => ({ empresaId: "e1", atividadeId, evento, dia, registradoEm: horas(-0.2), usuarioId });
    await prisma.atividadeAviso.createMany({ data: [aviso("a3", "A_CAMINHO", "uT3"), aviso("a5", "A_CAMINHO", "uT5"), aviso("a5", "CHEGOU", "uT5")] });
    // Uma mensagem do escritório que o t1 ainda não leu (a dele fica "esperando")
    await prisma.osComentario.create({ data: { id: "m1", clientId: "k1", empresaId: "e1", ordemServicoId: null, usuarioId: "uA", autorNome: "Ana Escritório", origem: "ESCRITORIO", paraUsuarioId: "uT1", texto: "Tem a peça no estoque?" } });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const situacoes = (pessoas: any[]) => Object.fromEntries(pessoas.map((p) => [p.nome, p.estado?.situacao]));

  it("a lista Pessoas: cada situação, pela prioridade (pausada, em execução, a caminho, fora do expediente, sem atividade; a da equipe conta)", async () => {
    comoAdmin();
    const r = await chamar("conversas/pessoas");
    expect(r.status).toBe(200);
    expect(situacoes(r.json.pessoas)).toEqual({
      "Ana Pausada": { tipo: "PAUSADA", motivo: "Falta de peça/material", impedimento: true, os: { id: "os1", numero: "OS-0001" } },
      "Bruno Executando": { tipo: "EM_EXECUCAO", os: { id: "os2", numero: "OS-0002" } },
      "Carla A Caminho": { tipo: "A_CAMINHO", os: { id: "os3", numero: "OS-0003" } },
      "Davi Fora": { tipo: "FORA_DO_EXPEDIENTE" },
      "Eva Livre": { tipo: "SEM_ATIVIDADE" }, // avisou "Cheguei": não está mais a caminho
      "Fábio Equipe": { tipo: "EM_EXECUCAO", os: { id: "os6", numero: "OS-0006" } },
    });
    // a outra empresa não aparece; a última da conversa leva a origem e se foi lida (a "mensagem esperando")
    expect(r.json.pessoas.map((p: any) => p.nome)).not.toContain("Xavier");
    expect(r.json.pessoas.find((p: any) => p.nome === "Ana Pausada").ultima).toMatchObject({ origem: "ESCRITORIO", lida: false });
  });

  it("o contato do app: o tempo real do app grava; dentro do minuto NÃO escreve de novo (nem outra instância); depois de 1 min, sim", async () => {
    const { registrarContato, esquecerContatos } = await import("@/lib/chat/presenca-servidor");
    const contato = async (id: string) => (await prisma.usuario.findUnique({ where: { id }, select: { ultimoContatoEm: true } })).ultimoContatoEm as Date | null;
    expect(await contato("uT1")).toBeNull();
    comoTecnico("uT1", "t1");
    await chamar("tecnico/conversas/novidades");
    const primeiro = await contato("uT1");
    expect(primeiro).not.toBeNull();
    // 20 pedidos seguidos (o tempo real, a sincronização): nenhuma escrita a mais, e nem pergunta ao banco
    consultas.length = 0;
    for (let i = 0; i < 20; i++) await registrarContato("uT1");
    expect(consultas.filter((q) => /UPDATE "?[^"]*"?\."?usuarios"?/i.test(q) || /UPDATE "usuarios"/i.test(q))).toEqual([]);
    expect(await contato("uT1")).toEqual(primeiro);
    // outra instância (sem a memória): pergunta, mas o banco não deixa escrever dentro do minuto
    esquecerContatos();
    expect(await registrarContato("uT1", new Date(primeiro!.getTime() + 30_000))).toBe(false);
    expect(await contato("uT1")).toEqual(primeiro);
    // passou 1 minuto: grava (outra instância de novo, sem a memória da tentativa acima)
    esquecerContatos();
    expect(await registrarContato("uT1", new Date(primeiro!.getTime() + 61_000))).toBe(true);
    expect((await contato("uT1"))!.getTime()).toBe(primeiro!.getTime() + 61_000);
  });

  it("a sincronização e a localização também contam como contato", async () => {
    const { esquecerContatos } = await import("@/lib/chat/presenca-servidor");
    esquecerContatos();
    comoTecnico("uT2", "t2");
    await chamar("tecnico/sync", "POST", {}, { operacoes: [] });
    expect((await prisma.usuario.findUnique({ where: { id: "uT2" } })).ultimoContatoEm).not.toBeNull();
    comoTecnico("uT3", "t3");
    await chamar("tecnico/posicao", "POST", {}, { posicoes: [] });
    expect((await prisma.usuario.findUnique({ where: { id: "uT3" } })).ultimoContatoEm).not.toBeNull();
  });

  it("o tempo real do escritório leva a situação e a presença; o cabeçalho da conversa também", async () => {
    const { esquecerEstados } = await import("@/lib/chat/pessoas-servidor");
    esquecerEstados();
    comoAdmin();
    const r = (await chamar("conversas/novidades")).json;
    const t1 = r.tecnicos.find((e: any) => e.usuarioId === "uT1");
    expect(t1.situacao.tipo).toBe("PAUSADA");
    expect(new Date(t1.contatoEm).getTime()).toBeGreaterThan(agora.getTime() - 120_000);
    expect(r.tecnicos.map((e: any) => e.usuarioId).sort()).toEqual(["uT1", "uT2", "uT3", "uT4", "uT5", "uT6"]);
    const conversa = (await chamar("conversas/pessoas/[usuarioId]", "GET", { usuarioId: "uT2" })).json;
    expect(conversa.pessoa.estado).toMatchObject({ usuarioId: "uT2", situacao: { tipo: "EM_EXECUCAO", os: { id: "os2" } } });
    expect(conversa.pessoa.estado.contatoEm).not.toBeNull();
  });

  it("a pausa retomada muda a situação no tempo real (depois do intervalo de leitura)", async () => {
    const { esquecerEstados } = await import("@/lib/chat/pessoas-servidor");
    await prisma.atividadePausa.updateMany({ where: { atividadeId: "a1", fim: null }, data: { fim: new Date() } });
    comoAdmin();
    // ainda dentro dos 15 s: a lida antes (sem consulta nova)
    expect((await chamar("conversas/novidades")).json.tecnicos.find((e: any) => e.usuarioId === "uT1").situacao.tipo).toBe("PAUSADA");
    esquecerEstados();
    expect((await chamar("conversas/novidades")).json.tecnicos.find((e: any) => e.usuarioId === "uT1").situacao).toEqual({ tipo: "EM_EXECUCAO", os: { id: "os1", numero: "OS-0001" } });
  });

  it("permissão: sem \"Conversas\" não recebe; \"Ver só os próprios\" vê a situação, mas só o nº da OS dele", async () => {
    const { esquecerEstados } = await import("@/lib/chat/pessoas-servidor");
    esquecerEstados();
    comoLeitor();
    expect((await chamar("conversas/novidades")).json.tecnicos).toBeUndefined();
    comoVendedor();
    const r = (await chamar("conversas/novidades")).json;
    const de = (u: string) => r.tecnicos.find((e: any) => e.usuarioId === u).situacao;
    expect(de("uT2")).toEqual({ tipo: "EM_EXECUCAO", os: { id: "os2", numero: "OS-0002" } }); // a OS é dele
    expect(de("uT1")).toEqual({ tipo: "EM_EXECUCAO", os: { id: null, numero: "OS-0001" } }); // não é: sem link (e a tela não mostra o número)
  });

  it("o técnico NÃO recebe presença nem situação de ninguém (a conversa dele é com \"o Escritório\")", async () => {
    comoTecnico("uT1", "t1");
    const tempoReal = await chamar("tecnico/conversas/novidades");
    const conversa = await chamar("tecnico/conversas");
    for (const r of [tempoReal, conversa]) {
      expect(r.status).toBe(200);
      const texto = JSON.stringify(r.json);
      expect(texto).not.toMatch(/"tecnicos"|"situacao"|"contatoEm"|"estado"|ultimoContato/);
    }
    // e as rotas do escritório continuam fechadas para ele
    expect((await chamar("conversas/novidades")).status).toBe(403);
  });

  it("as consultas: a lista Pessoas e o tempo real (o número fica registrado para o PR)", async () => {
    const { esquecerEstados } = await import("@/lib/chat/pessoas-servidor");
    // o log do Prisma chega depois da consulta: espera assentar antes de contar
    const medir = async (f: () => Promise<unknown>) => {
      await new Promise((r) => setTimeout(r, 100));
      consultas.length = 0;
      await f();
      await new Promise((r) => setTimeout(r, 100));
      return [...consultas];
    };
    comoAdmin();
    const lista = await medir(() => chamar("conversas/pessoas"));
    esquecerEstados();
    const tempoReal = await medir(() => chamar("conversas/novidades"));
    const tempoRealSeguinte = await medir(() => chamar("conversas/novidades")); // dentro dos 15 s: sem reler a situação
    // a lista como era antes (sem a situação) × agora, lida direto
    const { pessoasDoEscritorio } = await import("@/lib/chat/pessoas-servidor");
    const quem = { id: "uA", empresaId: "e1", role: "ADMIN", permissoes: TOTAIS } as any;
    const listaAntes = await medir(() => pessoasDoEscritorio(quem, { semEstados: true }));
    const listaDepois = await medir(() => pessoasDoEscritorio(quem));
    console.log(`CONSULTAS listaAntes=${listaAntes.length} listaDepois=${listaDepois.length} rotaLista=${lista.length} tempoReal=${tempoReal.length} tempoRealSeguinte=${tempoRealSeguinte.length} pessoas=6`);
    expect(listaDepois.length - listaAntes.length).toBe(1);
    const situacao = (q: string) => q.includes("atividade_avisos") && q.includes("atividade_pausas");
    // a situação de TODOS sai de uma consulta só (não uma por técnico), na lista e no tempo real
    expect(lista.filter(situacao)).toHaveLength(1);
    expect(tempoReal.filter(situacao)).toHaveLength(1);
    expect(tempoRealSeguinte.filter(situacao)).toHaveLength(0);
    // o tempo real lê a situação com 3 consultas (técnicos, logins e a situação) e, dentro dos 15 s, nenhuma
    expect(tempoReal.length - tempoRealSeguinte.length).toBe(3);
  });
});
