/**
 * OS EM CAMPANHA / MÚLTIPLAS VISITAS, de ponta a ponta no servidor: a rota de verdade
 * (/api/ordens/[id]/visitas) sobre PostgreSQL de verdade, com o relógio parado na quinta-feira
 * 12/11/2026, 12:00 de Brasília (13 = sexta, 14 = sábado, 15 = domingo, 16 = segunda).
 *
 * O que se prova: divide os equipamentos por quantidade/dia em visitas que são ATIVIDADES da mesma OS;
 * pula o fim de semana; cada visita no seu dia na agenda do técnico; o progresso soma; replanejar é
 * idempotente, não duplica e não apaga o que foi feito; a OS conclui quando todas as visitas concluem;
 * o cronograma do PMOC não mexe na OS em visitas; e só quem edita OS, no escritório, planeja.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_visitas_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const AGORA = new Date("2026-11-12T15:00:00.000Z");
/** O instante de `hora:minuto` de Brasília no dia `iso` */
const em = (iso: string, hora = 12, minuto = 0) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hora + 3, minuto));
const diaBR = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// A conclusão automática da OS gera relatórios: aqui não interessa
vi.mock("@/lib/relatorio-server", async (orig) => ({ ...(await orig<object>()), gerarRelatoriosDaOs: vi.fn(async () => {}) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", extra: Record<string, unknown> = {}) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null, ...extra } };
};
const comOrdens = (acoes: Acao[]) => como(montarPermissoes({ ordens: acoes }));
const tecnicoDoApp = () => como(PRESETS.TECNICO, "e1", { role: "TECNICO", tecnicoId: "t1" });

async function chamar(metodo: "GET" | "POST", id: string, corpo?: unknown) {
  const mod = await import("@/app/api/ordens/[id]/visitas/route");
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await (mod as any)[metodo](req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const P25 = { acao: "PLANEJAR", inicio: "2026-11-12", porDia: 25 };
const q = (n: number) => `q${String(n).padStart(3, "0")}`;
const faixa = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => q(de + i));

describe.skipIf(!URL_PG)("OS em campanha — visitas (PostgreSQL real)", () => {
  let prisma: any;
  let numero = 0;
  /** Uma OS agendada com UMA atividade e 60 equipamentos — como a que o cronograma do PMOC gera */
  const novaOs = async (extra: { equipamentos?: string[]; atividade?: Record<string, unknown>; os?: Record<string, unknown>; empresaId?: string } = {}) => {
    const empresaId = extra.empresaId ?? "e1", e1 = empresaId === "e1";
    const os = await prisma.ordemServico.create({
      data: {
        empresaId, numero: `OS-${++numero}`, clienteId: e1 ? "c1" : "cE2", unidadeId: e1 ? "u1" : "uE2", criadoPorId: e1 ? "uA" : "uB", status: "AGENDADA",
        descricao: "Limpeza química — PMOC 2026 (11/2026)", previsaoConclusao: em("2026-11-12"), ...extra.os,
        atividades: { create: {
          empresaId, titulo: "Limpeza Química", tipoOsId: e1 ? "toQuimica" : null, status: "AGENDADA", dataAgendada: em("2026-11-12"), duracaoMin: 480, observacao: "Levar a lavadora.",
          equipamentos: { create: (extra.equipamentos ?? (e1 ? faixa(1, 60) : ["qE2a", "qE2b"])).map((equipamentoId) => ({ equipamentoId })) },
          ...extra.atividade,
        } },
      },
      select: { id: true, atividades: { select: { id: true } } },
    });
    return { osId: os.id as string, atividadeId: os.atividades[0].id as string };
  };
  /** As visitas da OS, por data: [id, dia, hora, status, nº de equipamentos] */
  const visitas = async (osId: string) => (await prisma.atividadeOs.findMany({
    where: { ordemServicoId: osId }, orderBy: [{ dataAgendada: "asc" }, { id: "asc" }],
    include: { equipamentos: { orderBy: { equipamentoId: "asc" } }, tecnicosEquipe: true },
  }));
  const forma = (vs: any[]) => vs.map((v) => [diaBR(v.dataAgendada), v.equipamentos.length]);
  const lote = (v: any) => v.equipamentos.map((e: any) => e.equipamentoId);
  const historico = async (osId: string) => (await prisma.osHistorico.findMany({ where: { ordemServicoId: osId }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] })).map((h: any) => `${h.acao} | ${h.detalhes}`);
  /** Marca equipamentos como atendidos e a visita com o status dado (o que o app do técnico faz) */
  const executar = async (visita: any, feitos: string[], status: string) => {
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: visita.id, equipamentoId: { in: feitos } }, data: { feito: true, feitoEm: AGORA } });
    await prisma.atividadeOs.update({ where: { id: visita.id }, data: { status } });
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await import("@/app/api/ordens/[id]/visitas/route");

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com" }, { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" }, { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" }] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" }, { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" }] });
    await prisma.unidade.createMany({ data: [{ id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "uE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" }] });
    await prisma.tipoOs.createMany({ data: [{ id: "toQuimica", empresaId: "e1", nome: "Limpeza Química" }, { id: "toOutro", empresaId: "e1", nome: "Instalação" }] });
    // t1 e t2: ativos e com competência; t3: inativo; t4: ativo SEM competência em limpeza química; tE2: de outra empresa
    for (const [id, nome, ativo, tipos, empresaId] of [["t1", "Carlos Lima", true, ["toQuimica"], "e1"], ["t2", "Bruna Reis", true, ["toQuimica"], "e1"], ["t3", "Davi (saiu)", false, ["toQuimica"], "e1"], ["t4", "Elaine Paz", true, ["toOutro"], "e1"], ["tE2", "Técnico de fora", true, [], "e2"]] as const)
      await prisma.tecnico.create({ data: { id, empresaId, nome, cpf: id, telefone: "1", ativo, competencias: { connect: tipos.map((t) => ({ id: t })) } } });
    await prisma.equipe.create({ data: { id: "eqA", empresaId: "e1", nome: "Equipe Alfa", liderId: "t1", membros: { connect: [{ id: "t1" }, { id: "t2" }] } } });
    await prisma.veiculo.create({ data: { id: "vA", empresaId: "e1", placa: "ABC1D23", modelo: "Strada", equipeId: "eqA" } });
    await prisma.veiculo.create({ data: { id: "vE2", empresaId: "e2", placa: "ZZZ9Z99", modelo: "Outro" } });
    await prisma.equipamento.createMany({ data: [
      // 60 equipamentos em 3 andares de 20: a ordem por local é a do número
      ...Array.from({ length: 60 }, (_, i) => ({
        id: q(i + 1), empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", nome: `Split ${i + 1}`,
        patrimonio: `AC-${String(i + 1).padStart(3, "0")}`, setor: `${Math.floor(i / 20) + 1}º andar`, localizacao: `Sala ${String(i + 1).padStart(3, "0")}`,
      })),
      { id: "qE2a", empresaId: "e2", unidadeId: "uE2", tipo: "AR_CONDICIONADO_SPLIT", marca: "X", modelo: "Y" }, { id: "qE2b", empresaId: "e2", unidadeId: "uE2", tipo: "AR_CONDICIONADO_SPLIT", marca: "X", modelo: "Y" },
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
    como();
  });

  it("ANTES de planejar: a tela recebe a atividade a dividir (60 equipamentos) e a proposta — hoje, 25 por dia, sem fim de semana", async () => {
    const { osId, atividadeId } = await novaOs();
    const r = await chamar("GET", osId);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ plano: null, visitas: [], bloqueio: null, sobras: 0, hoje: "2026-11-12", proposta: { inicio: "2026-11-12", porDia: 25, pularFimSemana: true }, executorModelo: null });
    expect(r.json.progresso).toEqual({ feitos: 0, total: 0, visitas: 0, concluidas: 0 });
    expect(r.json.origem).toMatchObject({ id: atividadeId, titulo: "Limpeza Química" });
    expect(r.json.origem.equipamentos).toHaveLength(60);
    expect(r.json.origem.equipamentos[0]).toMatchObject({ id: "q001", rotulo: "AC-001 · Split 1", local: "1º andar · Sala 001", feito: false });
    expect(await prisma.osPlanoVisitas.count()).toBe(0); // ler não cria nada
    // a proposta nunca começa no passado nem no fim de semana: atividade de terça passada → hoje; de sábado → segunda
    const passada = await novaOs({ atividade: { dataAgendada: em("2026-11-10") } });
    expect((await chamar("GET", passada.osId)).json.proposta.inicio).toBe("2026-11-12");
    const sabado = await novaOs({ atividade: { dataAgendada: em("2026-11-14") } });
    expect((await chamar("GET", sabado.osId)).json.proposta.inicio).toBe("2026-11-16");
    // poucos equipamentos: a quantidade proposta não passa do que há para distribuir
    const pequena = await novaOs({ equipamentos: faixa(1, 8) });
    expect((await chamar("GET", pequena.osId)).json.proposta.porDia).toBe(8);
  });

  it("PLANEJAR: divide os 60 equipamentos em 3 visitas (25, 25, 10) que são ATIVIDADES da mesma OS, cada uma num dia, pulando o fim de semana", async () => {
    const { osId, atividadeId } = await novaOs();
    const r = await chamar("POST", osId, P25);
    expect(r.status).toBe(200);
    expect(r.json.resultado).toEqual({ visitas: 3, criadas: 2, removidas: 0, de: "2026-11-12", ate: "2026-11-16", equipamentos: 60 });
    const vs = await visitas(osId);
    // quinta 12, sexta 13 e — pulando sábado e domingo — segunda 16
    expect(forma(vs)).toEqual([["2026-11-12", 25], ["2026-11-13", 25], ["2026-11-16", 10]]);
    // continua UMA OS só; a atividade que já existia é a 1ª visita
    expect(await prisma.ordemServico.count()).toBe(1);
    expect(vs[0].id).toBe(atividadeId);
    expect(vs.every((v: any) => v.ordemServicoId === osId && v.status === "AGENDADA" && v.empresaId === "e1")).toBe(true);
    // os lotes seguem o local: 1 a 25, 26 a 50, 51 a 60 — nenhum equipamento em duas visitas, nenhum perdido
    expect([lote(vs[0]), lote(vs[1]), lote(vs[2])]).toEqual([faixa(1, 25), faixa(26, 50), faixa(51, 60)]);
    expect(await prisma.atividadeEquipamento.count({ where: { atividade: { ordemServicoId: osId } } })).toBe(60);
    // todas marcadas com o mesmo plano, que guarda os parâmetros
    const plano = await prisma.osPlanoVisitas.findUnique({ where: { ordemServicoId: osId } });
    expect(plano).toMatchObject({ empresaId: "e1", porDia: 25, pularFimSemana: true, criadoPorId: "uA" });
    expect(vs.every((v: any) => v.planoVisitasId === plano.id)).toBe(true);
    // as visitas novas copiam o serviço, a duração, a orientação e a HORA da atividade dividida
    for (const v of vs) expect(v).toMatchObject({ titulo: "Limpeza Química", tipoOsId: "toQuimica", duracaoMin: 480, observacao: "Levar a lavadora." });
    expect(vs.map((v: any) => v.dataAgendada.toISOString())).toEqual([em("2026-11-12"), em("2026-11-13"), em("2026-11-16")].map((d) => d.toISOString()));
    // sem equipe no pedido: nascem "sem quem execute", para o escritório distribuir
    expect(vs.every((v: any) => v.tecnicoId === null && v.equipeId === null && v.veiculoId === null && v.tecnicosEquipe.length === 0)).toBe(true);
    // a OS termina com a última visita: a previsão de conclusão acompanha; e o histórico registra
    expect((await prisma.ordemServico.findUnique({ where: { id: osId } })).previsaoConclusao.toISOString()).toBe(em("2026-11-16").toISOString());
    expect((await historico(osId)).at(-1)).toBe("Visitas planejadas | 60 equipamentos em 3 visitas, de 12/11/2026 a 16/11/2026 (25 por dia, sem sábado e domingo).");
  });

  it("sem pular o fim de semana, o sábado e o domingo recebem visita; a hora da atividade dividida vale para todas", async () => {
    const { osId } = await novaOs({ atividade: { dataAgendada: em("2026-11-12", 8, 30) } });
    await chamar("POST", osId, { ...P25, inicio: "2026-11-13", pularFimSemana: false });
    const vs = await visitas(osId);
    expect(forma(vs)).toEqual([["2026-11-13", 25], ["2026-11-14", 25], ["2026-11-15", 10]]);
    expect(vs.map((v: any) => v.dataAgendada.toISOString())).toEqual([em("2026-11-13", 8, 30), em("2026-11-14", 8, 30), em("2026-11-15", 8, 30)].map((d) => d.toISOString()));
    expect((await historico(osId)).at(-1)).toContain("(25 por dia).");
  });

  it("EQUIPE no pedido: todas as visitas ficam com a equipe, o responsável (líder), os demais técnicos e o veículo da equipe — as regras das atividades comuns", async () => {
    const { osId } = await novaOs();
    const r = await chamar("POST", osId, { ...P25, executor: { tecnicoIds: ["t2", "t1"], equipeId: "eqA" } });
    expect(r.status).toBe(200);
    const vs = await visitas(osId);
    expect(vs).toHaveLength(3);
    for (const v of vs) {
      expect(v).toMatchObject({ tecnicoId: "t1", equipeId: "eqA", veiculoId: "vA" });
      expect(v.tecnicosEquipe.map((t: any) => t.tecnicoId)).toEqual(["t2"]);
    }
    expect((await chamar("GET", osId)).json.visitas.map((v: any) => v.executor)).toEqual(Array(3).fill("Equipe Alfa: Carlos Lima (responsável), Bruna Reis"));
    // replanejar SEM dizer quem executa: as visitas que já existem ficam com a equipe, e as NOVAS copiam dela
    await chamar("POST", osId, { ...P25, porDia: 12 });
    const cinco = await visitas(osId);
    expect(cinco).toHaveLength(5);
    for (const v of cinco) {
      expect(v).toMatchObject({ tecnicoId: "t1", equipeId: "eqA", veiculoId: "vA", titulo: "Limpeza Química", duracaoMin: 480 });
      expect(v.tecnicosEquipe.map((t: any) => t.tecnicoId)).toEqual(["t2"]);
    }
    // executor em BRANCO no pedido: as visitas pendentes ficam "sem quem execute" (e sem veículo)
    expect((await chamar("POST", osId, { ...P25, porDia: 30, executor: { tecnicoIds: [] } })).status).toBe(200);
    for (const v of await visitas(osId)) {
      expect(v).toMatchObject({ tecnicoId: null, equipeId: null, veiculoId: null });
      expect(v.tecnicosEquipe).toEqual([]);
    }
    // um técnico só, sem veículo
    const outra = await novaOs();
    await chamar("POST", outra.osId, { ...P25, executor: { tecnicoIds: ["t2"], veiculoId: null } });
    for (const v of await visitas(outra.osId)) expect(v).toMatchObject({ tecnicoId: "t2", equipeId: null, veiculoId: null });
  });

  it("quem executa é validado como nas OS normais: técnico inativo, sem competência no serviço, de outra empresa, equipe ou veículo inválidos → 400 e nada é criado", async () => {
    const { osId } = await novaOs();
    const tenta = async (executor: unknown) => { const r = await chamar("POST", osId, { ...P25, executor }); return [r.status, r.json.erro]; };
    expect(await tenta({ tecnicoIds: ["t3"] })).toEqual([400, "Um ou mais técnicos são inválidos ou estão inativos."]);
    expect(await tenta({ tecnicoIds: ["tE2"] })).toEqual([400, "Um ou mais técnicos são inválidos ou estão inativos."]);
    expect(await tenta({ tecnicoIds: ["t4"] })).toEqual([400, "Sem competência neste tipo de OS: Elaine Paz."]);
    expect(await tenta({ tecnicoIds: ["t1"], equipeId: "nao-existe" })).toEqual([400, "Equipe inválida ou inativa."]);
    expect(await tenta({ tecnicoIds: ["t1"], veiculoId: "vE2" })).toEqual([400, "Veículo inválido."]);
    expect(await prisma.atividadeOs.count({ where: { ordemServicoId: osId } })).toBe(1);
    expect(await prisma.osPlanoVisitas.count()).toBe(0);
  });

  it("cada visita aparece no SEU dia na agenda do técnico, com 'Visita N de M' e o lote dela", async () => {
    const { agenda, meuDia } = await import("@/lib/tecnico/dia");
    const { osId } = await novaOs();
    await chamar("POST", osId, { ...P25, executor: { tecnicoIds: ["t1", "t2"], equipeId: "eqA" } });
    const dias = await agenda("e1", "t1", 14, AGORA);
    expect(dias.map((d) => [d.dia, d.atividades.map((c) => [c.visita, c.equipamentos, c.atendidos])])).toEqual([
      ["2026-11-12", [[{ numero: 1, total: 3 }, 25, 0]]], ["2026-11-13", [[{ numero: 2, total: 3 }, 25, 0]]], ["2026-11-16", [[{ numero: 3, total: 3 }, 10, 0]]],
    ]);
    // "Meu dia" de hoje: só a visita de hoje; o técnico que não está na equipe não vê nenhuma
    expect((await meuDia("e1", "t1", AGORA)).atividades.map((c) => c.visita)).toEqual([{ numero: 1, total: 3 }]);
    expect(await agenda("e1", "t4", 14, AGORA)).toEqual([]);
    // atividade comum (OS sem plano) não ganha rótulo de visita
    const comum = await novaOs({ atividade: { tecnicoId: "t1" }, equipamentos: ["q001"] });
    const cartao = (await agenda("e1", "t1", 14, AGORA)).flatMap((d) => d.atividades).find((c) => c.osId === comum.osId)!;
    expect(cartao.visita).toBeUndefined();
  });

  it("REPLANEJAR é IDEMPOTENTE: de novo com os mesmos parâmetros, as mesmas atividades, nos mesmos dias, com os mesmos lotes", async () => {
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    const retrato = async () => (await visitas(osId)).map((v: any) => [v.id, v.dataAgendada.toISOString(), lote(v), v.equipamentos.map((e: any) => e.id)]);
    const antes = await retrato();
    for (let i = 0; i < 3; i++) {
      const r = await chamar("POST", osId, P25);
      expect(r.json.resultado).toMatchObject({ visitas: 3, criadas: 0, removidas: 0 });
    }
    // nem as linhas de equipamento mudaram de id: nada foi apagado e recriado
    expect(await retrato()).toEqual(antes);
    expect(await prisma.osPlanoVisitas.count()).toBe(1);
    expect((await historico(osId)).filter((h: string) => h.startsWith("Visitas"))).toHaveLength(4);
    expect((await historico(osId)).at(-1)).toMatch(/^Visitas replanejadas \| 60 equipamentos em 3 visitas/);
  });

  it("dois planejamentos AO MESMO TEMPO não criam visita em dobro nem equipamento repetido", async () => {
    const { osId } = await novaOs();
    const rs = await Promise.all([chamar("POST", osId, P25), chamar("POST", osId, P25), chamar("POST", osId, P25)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(forma(await visitas(osId))).toEqual([["2026-11-12", 25], ["2026-11-13", 25], ["2026-11-16", 10]]);
    expect(await prisma.atividadeEquipamento.count({ where: { atividade: { ordemServicoId: osId } } })).toBe(60);
    expect(await prisma.osPlanoVisitas.count()).toBe(1);
  });

  it("mudar a QUANTIDADE por dia refaz as visitas pendentes: reaproveita as que existem, cria as que faltam, tira as que sobram", async () => {
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    const ids = (await visitas(osId)).map((v: any) => v.id);
    // 40 por dia: 3 visitas viram 2
    expect((await chamar("POST", osId, { ...P25, porDia: 40 })).json.resultado).toMatchObject({ visitas: 2, criadas: 0, removidas: 1 });
    let vs = await visitas(osId);
    expect([forma(vs), vs.map((v: any) => v.id)]).toEqual([[["2026-11-12", 40], ["2026-11-13", 20]], ids.slice(0, 2)]);
    // 12 por dia: 2 viram 5, a partir de segunda
    expect((await chamar("POST", osId, { ...P25, inicio: "2026-11-16", porDia: 12 })).json.resultado).toMatchObject({ visitas: 5, criadas: 3, removidas: 0 });
    vs = await visitas(osId);
    expect(forma(vs)).toEqual([["2026-11-16", 12], ["2026-11-17", 12], ["2026-11-18", 12], ["2026-11-19", 12], ["2026-11-20", 12]]);
    expect(vs.flatMap(lote)).toEqual(faixa(1, 60));
    expect(await prisma.osPlanoVisitas.findUnique({ where: { ordemServicoId: osId } })).toMatchObject({ porDia: 12 });
    // a previsão de conclusão acompanha a última visita, e nunca encurta
    expect((await prisma.ordemServico.findUnique({ where: { id: osId } })).previsaoConclusao.toISOString()).toBe(em("2026-11-20").toISOString());
    await chamar("POST", osId, { ...P25, inicio: "2026-11-16", porDia: 60 });
    expect(forma(await visitas(osId))).toEqual([["2026-11-16", 60]]);
    expect((await prisma.ordemServico.findUnique({ where: { id: osId } })).previsaoConclusao.toISOString()).toBe(em("2026-11-20").toISOString());
  });

  it("NÃO apaga o que foi feito: visita concluída ou em andamento fica idêntica; só a pendente é refeita; o PROGRESSO soma", async () => {
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    let vs = await visitas(osId);
    await executar(vs[0], faixa(1, 20), "CONCLUIDA");     // 20 de 25 atendidos, visita concluída
    await executar(vs[1], faixa(26, 30), "EM_ANDAMENTO"); // 5 de 25, visita em andamento
    const congeladas = async () => JSON.stringify((await visitas(osId)).filter((v: any) => v.status !== "AGENDADA"));
    const antes = await congeladas();

    const estado = (await chamar("GET", osId)).json;
    expect(estado.progresso).toEqual({ feitos: 25, total: 60, visitas: 3, concluidas: 1 });
    expect(estado.visitas.map((v: any) => [v.numero, v.status, v.pendente, v.equipamentos.filter((e: any) => e.feito).length])).toEqual([[1, "CONCLUIDA", false, 20], [2, "EM_ANDAMENTO", false, 5], [3, "AGENDADA", true, 0]]);
    expect(estado.sobras).toBe(5); // os 5 que ficaram sem atendimento na visita concluída

    // replaneja só o que falta: os 10 da visita pendente, 4 por dia, a partir de segunda
    const r = await chamar("POST", osId, { ...P25, inicio: "2026-11-16", porDia: 4 });
    expect(r.json.resultado).toMatchObject({ visitas: 3, criadas: 2, removidas: 0, equipamentos: 10 });
    vs = await visitas(osId);
    expect(vs.filter((v: any) => v.status === "AGENDADA").map((v: any) => [diaBR(v.dataAgendada), lote(v)])).toEqual([["2026-11-16", faixa(51, 54)], ["2026-11-17", faixa(55, 58)], ["2026-11-18", faixa(59, 60)]]);
    expect(await congeladas()).toBe(antes);
    expect((await chamar("GET", osId)).json.progresso).toEqual({ feitos: 25, total: 60, visitas: 5, concluidas: 1 });
    expect(r.json.estado.progresso).toEqual({ feitos: 25, total: 60, visitas: 5, concluidas: 1 });
  });

  it("SOBRAS: o que ficou sem atendimento na visita concluída volta numa visita nova quando pedido — sem mexer na concluída e sem duplicar ao repetir", async () => {
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    const [v1] = await visitas(osId);
    await executar(v1, faixa(1, 20), "CONCLUIDA");
    const concluida = async () => JSON.stringify((await visitas(osId)).find((v: any) => v.id === v1.id));
    const antes = await concluida();
    const pedido = { ...P25, inicio: "2026-11-13", porDia: 20, incluirSobras: true };
    expect((await chamar("POST", osId, pedido)).json.resultado).toMatchObject({ visitas: 2, equipamentos: 40 });
    let vs = (await visitas(osId)).filter((v: any) => v.status === "AGENDADA");
    expect(forma(vs)).toEqual([["2026-11-13", 20], ["2026-11-16", 20]]);
    expect(vs.flatMap(lote).filter((id: string) => faixa(21, 25).includes(id)).sort()).toEqual(faixa(21, 25));
    expect(await concluida()).toBe(antes);
    // o total continua 60 (equipamento distinto), e repetir não duplica
    expect((await chamar("GET", osId)).json).toMatchObject({ progresso: { feitos: 20, total: 60 }, sobras: 0 });
    await chamar("POST", osId, pedido);
    vs = (await visitas(osId)).filter((v: any) => v.status === "AGENDADA");
    expect(vs.flatMap(lote).length).toBe(40);
    expect(new Set(vs.flatMap(lote)).size).toBe(40);
  });

  it("visita agendada que JÁ tem registro do técnico (aviso 'A caminho', observação no equipamento) não é mais mexida", async () => {
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    const [v1, v2, v3] = await visitas(osId);
    await prisma.atividadeAviso.create({ data: { empresaId: "e1", atividadeId: v1.id, evento: "A_CAMINHO", dia: new Date("2026-11-12T00:00:00Z"), registradoEm: AGORA, usuarioId: "uA" } });
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: v2.id, equipamentoId: "q026" }, data: { observacao: "Filtro muito sujo." } });
    const estado = (await chamar("GET", osId)).json;
    expect(estado.visitas.map((v: any) => v.pendente)).toEqual([false, false, true]);
    const r = await chamar("POST", osId, { ...P25, inicio: "2026-11-16", porDia: 5 });
    expect(r.json.resultado).toMatchObject({ visitas: 2, equipamentos: 10 });
    const vs = await visitas(osId);
    expect([lote(vs.find((v: any) => v.id === v1.id)), lote(vs.find((v: any) => v.id === v2.id))]).toEqual([faixa(1, 25), faixa(26, 50)]);
    for (const acao of [{ acao: "TIRAR_DIA", visitaId: v1.id }, { acao: "MOVER_VISITA", visitaId: v2.id, dia: "2026-11-20" }, { acao: "MOVER_EQUIPAMENTOS", equipamentoIds: ["q051"], paraVisitaId: v1.id }])
      expect((await chamar("POST", osId, acao)).json.erro).toBe("Esta visita já começou, foi concluída ou cancelada: o planejamento não mexe nela.");
    expect(v3.id).toBe(vs.find((v: any) => lote(v).includes("q051")).id);
  });

  it("a OS CONCLUI quando TODAS as visitas concluem — antes disso fica em andamento", async () => {
    const { sincronizarStatusOs } = await import("@/lib/os/sincronizar-status");
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    const vs = await visitas(osId);
    const status = async () => { await sincronizarStatusOs(osId, "e1", "uA"); return (await prisma.ordemServico.findUnique({ where: { id: osId } })).status; };
    expect(await status()).toBe("AGENDADA");
    await executar(vs[0], lote(vs[0]), "CONCLUIDA");
    expect(await status()).toBe("EM_ANDAMENTO");
    await executar(vs[1], lote(vs[1]), "CONCLUIDA");
    expect(await status()).toBe("EM_ANDAMENTO");
    expect((await chamar("GET", osId)).json.progresso).toEqual({ feitos: 50, total: 60, visitas: 3, concluidas: 2 });
    await executar(vs[2], lote(vs[2]), "CONCLUIDA");
    expect(await status()).toBe("CONCLUIDA");
    expect((await chamar("GET", osId)).json.progresso).toEqual({ feitos: 60, total: 60, visitas: 3, concluidas: 3 });
    // OS concluída: não dá mais para planejar
    expect(await chamar("POST", osId, P25)).toMatchObject({ status: 409, json: { erro: "OS concluída: não dá para planejar visitas." } });
  });

  it("MOVER uma visita de dia, INCLUIR um dia e TIRAR um dia — com o histórico de cada um", async () => {
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    let vs = await visitas(osId);
    // mover a 2ª visita de sexta 13 para quinta 19: só ela muda
    expect((await chamar("POST", osId, { acao: "MOVER_VISITA", visitaId: vs[1].id, dia: "2026-11-19" })).status).toBe(200);
    expect(forma(await visitas(osId))).toEqual([["2026-11-12", 25], ["2026-11-16", 10], ["2026-11-19", 25]]);
    expect((await historico(osId)).at(-1)).toBe("Visita movida de dia | De 13/11/2026 para 19/11/2026.");
    // incluir a terça 17: 4 visitas com 15 cada, cada uma no seu dia
    expect((await chamar("POST", osId, { acao: "INCLUIR_DIA", dia: "2026-11-17" })).json.resultado).toMatchObject({ visitas: 4, criadas: 1 });
    vs = await visitas(osId);
    expect(forma(vs)).toEqual([["2026-11-12", 15], ["2026-11-16", 15], ["2026-11-17", 15], ["2026-11-19", 15]]);
    expect(vs.flatMap(lote).sort()).toEqual(faixa(1, 60));
    expect((await historico(osId)).at(-1)).toBe("Dia incluído nas visitas | 17/11/2026: agora são 4 visitas pendentes, de 12/11/2026 a 19/11/2026.");
    // tirar a segunda 16: 3 visitas com 20 cada
    expect((await chamar("POST", osId, { acao: "TIRAR_DIA", visitaId: vs[1].id })).json.resultado).toMatchObject({ visitas: 3, removidas: 1 });
    vs = await visitas(osId);
    expect(forma(vs)).toEqual([["2026-11-12", 20], ["2026-11-17", 20], ["2026-11-19", 20]]);
    expect(vs.flatMap(lote).sort()).toEqual(faixa(1, 60));
    expect((await historico(osId)).at(-1)).toBe("Dia retirado das visitas | 16/11/2026: os equipamentos foram para as outras 3 visitas.");
    // recusas com mensagem
    expect((await chamar("POST", osId, { acao: "INCLUIR_DIA", dia: "2026-11-17" })).json.erro).toBe("Já existe uma visita pendente nesse dia.");
    expect((await chamar("POST", osId, { acao: "MOVER_VISITA", visitaId: vs[0].id, dia: "2026-11-10" })).json.erro).toBe("Esse dia já passou.");
    expect(await chamar("POST", osId, { acao: "TIRAR_DIA", visitaId: "nao-existe" })).toMatchObject({ status: 400 });
  });

  it("AJUSTE MANUAL: mover equipamentos de uma visita para outra; a que fica vazia some; nada se perde", async () => {
    const { osId } = await novaOs();
    await chamar("POST", osId, P25);
    let vs = await visitas(osId);
    expect((await chamar("POST", osId, { acao: "MOVER_EQUIPAMENTOS", equipamentoIds: ["q001", "q002", "q030"], paraVisitaId: vs[2].id })).status).toBe(200);
    vs = await visitas(osId);
    expect(forma(vs)).toEqual([["2026-11-12", 23], ["2026-11-13", 24], ["2026-11-16", 13]]);
    expect(lote(vs[2]).filter((id: string) => ["q001", "q002", "q030"].includes(id))).toEqual(["q001", "q002", "q030"]);
    expect((await historico(osId)).at(-1)).toBe("Equipamentos movidos entre visitas | 3 equipamentos para a visita de 16/11/2026.");
    // esvaziar a última visita: ela deixa de existir
    await chamar("POST", osId, { acao: "MOVER_EQUIPAMENTOS", equipamentoIds: lote(vs[2]), paraVisitaId: vs[0].id });
    vs = await visitas(osId);
    expect(forma(vs)).toEqual([["2026-11-12", 36], ["2026-11-13", 24]]);
    expect(vs.flatMap(lote).sort()).toEqual(faixa(1, 60));
    expect((await chamar("POST", osId, { acao: "MOVER_EQUIPAMENTOS", equipamentoIds: ["qE2a"], paraVisitaId: vs[0].id })).json.erro).toBe("Só dá para mover equipamento de uma visita pendente.");
  });

  it("uma atividade avulsa da mesma OS (fora do plano) NUNCA entra no planejamento", async () => {
    const { osId } = await novaOs({ equipamentos: faixa(1, 50) });
    const avulsa = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: osId, titulo: "Vistoria final", status: "AGENDADA", dataAgendada: em("2026-11-30"), equipamentos: { create: faixa(51, 60).map((equipamentoId) => ({ equipamentoId })) } } });
    // a atividade a dividir é a que tem MAIS equipamentos
    expect((await chamar("GET", osId)).json.origem.equipamentos).toHaveLength(50);
    await chamar("POST", osId, P25);
    await chamar("POST", osId, { ...P25, porDia: 10 });
    await chamar("POST", osId, { acao: "INCLUIR_DIA", dia: "2026-11-23" });
    const depois = await prisma.atividadeOs.findUnique({ where: { id: avulsa.id }, include: { equipamentos: { orderBy: { equipamentoId: "asc" } } } });
    expect(depois).toMatchObject({ titulo: "Vistoria final", planoVisitasId: null });
    expect(lote(depois)).toEqual(faixa(51, 60));
    expect((await chamar("GET", osId)).json.progresso.total).toBe(50);
    // pode-se escolher qual atividade dividir no primeiro planejamento
    const outra = await novaOs({ equipamentos: faixa(1, 4) });
    const b = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: outra.osId, titulo: "Outra", status: "AGENDADA", dataAgendada: em("2026-11-12"), equipamentos: { create: faixa(5, 7).map((equipamentoId) => ({ equipamentoId })) } } });
    await chamar("POST", outra.osId, { ...P25, porDia: 2, atividadeId: b.id });
    expect((await visitas(outra.osId)).filter((v: any) => v.planoVisitasId).map(lote)).toEqual([["q005", "q006"], ["q007"]]);
  });

  it("quando não dá para planejar: OS cancelada, sem atividade com 2 equipamentos, ajuste sem plano → 409 com a mensagem", async () => {
    const cancelada = await novaOs({ os: { status: "CANCELADA" } });
    expect(await chamar("POST", cancelada.osId, P25)).toMatchObject({ status: 409, json: { erro: "OS cancelada: não dá para planejar visitas." } });
    const pequena = await novaOs({ equipamentos: ["q001"] });
    const semOrigem = "Para planejar visitas, a OS precisa de uma atividade agendada, ainda não iniciada, com 2 equipamentos ou mais.";
    expect((await chamar("GET", pequena.osId)).json).toMatchObject({ bloqueio: semOrigem, origem: null });
    expect(await chamar("POST", pequena.osId, P25)).toMatchObject({ status: 409, json: { erro: semOrigem } });
    const iniciada = await novaOs({ atividade: { status: "EM_ANDAMENTO" } });
    expect(await chamar("POST", iniciada.osId, P25)).toMatchObject({ status: 409, json: { erro: semOrigem } });
    const semPlano = await novaOs();
    expect(await chamar("POST", semPlano.osId, { acao: "INCLUIR_DIA", dia: "2026-11-20" })).toMatchObject({ status: 409, json: { erro: "Esta OS ainda não tem visitas planejadas." } });
    expect(await prisma.osPlanoVisitas.count()).toBe(0);
  });

  it("pedido inválido → 400 com a mensagem, e nada muda", async () => {
    const { osId } = await novaOs();
    const erro = async (corpo: unknown) => { const r = await chamar("POST", osId, corpo); return [r.status, r.json.erro]; };
    expect(await erro({ ...P25, inicio: "2026-11-11" })).toEqual([400, "A data de início já passou."]);
    expect(await erro({ ...P25, inicio: "2026-02-31" })).toEqual([400, "Informe a data de início."]);
    expect(await erro({ ...P25, porDia: 0 })).toEqual([400, "Informe quantos equipamentos por dia."]);
    expect(await erro({ ...P25, porDia: 501 })).toEqual([400, "São no máximo 500 equipamentos por dia."]);
    expect(await erro({ acao: "APAGAR_TUDO" })).toEqual([400, "Operação inválida."]);
    expect(await erro(undefined)).toEqual([400, "Operação inválida."]);
    expect(await prisma.atividadeOs.count({ where: { ordemServicoId: osId } })).toBe(1);
    expect(await prisma.osPlanoVisitas.count()).toBe(0);
  });

  it("RBAC: planejar exige Ordens › Editar; só visualizar lê e não planeja; sem o módulo, e o técnico do app (mesmo com editar): 403", async () => {
    const { osId } = await novaOs({ atividade: { tecnicoId: "t1" } });
    comOrdens(["visualizar"]);
    expect([(await chamar("GET", osId)).status, (await chamar("POST", osId, P25)).status]).toEqual([200, 403]);
    comOrdens(["visualizar", "criar", "concluir", "excluir"]);
    expect((await chamar("POST", osId, P25)).status).toBe(403);
    como(montarPermissoes({ pmoc: ["visualizar", "editar"], equipamentos: ["visualizar", "editar"] }));
    expect([(await chamar("GET", osId)).status, (await chamar("POST", osId, P25)).status]).toEqual([403, 403]);
    // o técnico do app tem "editar" no perfil, mas o planejamento é do escritório
    tecnicoDoApp();
    const doApp = await chamar("POST", osId, P25);
    expect([(await chamar("GET", osId)).status, doApp.status, doApp.json.erro]).toEqual([403, 403, "O planejamento das visitas é feito pelo escritório."]);
    sessao.atual = null;
    expect([(await chamar("GET", osId)).status, (await chamar("POST", osId, P25)).status]).toEqual([401, 401]);
    expect(await prisma.atividadeOs.count({ where: { ordemServicoId: osId } })).toBe(1);
    expect(await prisma.osPlanoVisitas.count()).toBe(0);
    comOrdens(["visualizar", "editar"]);
    expect((await chamar("POST", osId, P25)).status).toBe(200);
  });

  it("MULTIEMPRESA: OS de outra empresa → 404; o plano e as visitas nascem na empresa da OS", async () => {
    const { osId } = await novaOs();
    const deOutra = await novaOs({ empresaId: "e2" });
    como(permissoesTotais(), "e2");
    expect([(await chamar("GET", osId)).status, (await chamar("POST", osId, P25)).status]).toEqual([404, 404]);
    expect((await chamar("GET", "nao-existe")).status).toBe(404);
    expect(await prisma.atividadeOs.count({ where: { ordemServicoId: osId } })).toBe(1);
    expect((await chamar("POST", deOutra.osId, { ...P25, porDia: 1 })).status).toBe(200);
    const vs = await visitas(deOutra.osId);
    expect(vs.map((v: any) => v.empresaId)).toEqual(["e2", "e2"]);
    expect(await prisma.osPlanoVisitas.findUnique({ where: { ordemServicoId: deOutra.osId } })).toMatchObject({ empresaId: "e2", criadoPorId: "uB" });
    // técnico da outra empresa não entra nas visitas
    expect((await chamar("POST", deOutra.osId, { ...P25, porDia: 1, executor: { tecnicoIds: ["t1"] } })).status).toBe(400);
  });

  it("PMOC: a OS dividida em visitas é vista inteira pelo cronograma (todos os equipamentos) e o reagendamento não mexe nela", async () => {
    const { carregarCronograma } = await import("@/lib/pmoc-cronograma-server");
    const { planejarCronograma } = await import("@/lib/pmoc-cronograma");
    const { osId } = await novaOs({ equipamentos: faixa(1, 6), os: { origem: "RECORRENTE", periodoRecorrencia: "PMOC:2026-11" } });
    const pmoc = await prisma.pmoc.create({ data: {
      empresaId: "e1", clienteId: "c1", unidadeId: "u1", nome: "PMOC 2026", status: "PUBLICADO", dataInicio: new Date("2026-11-01T00:00:00Z"), dataExpiracao: new Date("2027-10-31T00:00:00Z"),
      equipamentos: { create: faixa(1, 6).map((equipamentoId) => ({ equipamentoId })) },
      // o cronograma pede dia 20; a OS foi gerada para o dia 12 (data prevista) — sem visitas, o reagendar a moveria
      cronograma: { create: { id: "item1", tipoOsId: "toQuimica", dataInicio: new Date("2026-11-01T00:00:00Z"), intervaloMeses: 12, diaExecucao: 20 } },
    } });
    await prisma.pmocExecucao.createMany({ data: faixa(1, 6).map((equipamentoId) => ({ pmocId: pmoc.id, cronogramaId: "item1", equipamentoId, periodo: "2026-11", dataPrevista: em("2026-11-12"), ordemServicoId: osId })) });
    const plano = async () => planejarCronograma((await carregarCronograma(prisma, pmoc.id, "e1"))!.estado, AGORA);
    // sem visitas: o reagendamento do cronograma moveria a OS para o dia 20
    expect((await plano()).mover).toHaveLength(1);

    await chamar("POST", osId, { ...P25, porDia: 2 });
    const c = (await carregarCronograma(prisma, pmoc.id, "e1"))!;
    const os = c.estado.execucoes[0].os!;
    expect(os.emVisitas).toBe(true);
    expect([...os.equipamentoIds].sort()).toEqual(faixa(1, 6)); // os 6, embora a 1ª atividade só tenha 2
    const p = await plano();
    expect([p.mover, p.retirar, p.incluir, p.cancelar, p.criar]).toEqual([[], [], [], [], []]);
    // continua UMA OS e UMA competência: as execuções do PMOC apontam para a mesma OS
    expect(await prisma.pmocExecucao.count({ where: { ordemServicoId: osId } })).toBe(6);
  });
});
