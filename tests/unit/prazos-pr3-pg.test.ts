/**
 * Prazos da OS — PR 3 (o atraso justificado e o DESEMPENHO), pelas rotas reais com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`). Só o relógio é fixado. Prova:
 *  - a atividade ATRASADA de uma OS com atraso justificado SAI da métrica "no prazo": nem acerto nem
 *    erro — o escore sobe porque o atraso deixa de contar, nunca porque virou acerto;
 *  - só o atraso sai: a atividade no prazo da mesma OS continua contando; o relatório é medido igual;
 *  - quem só tem atraso justificado fica SEM MEDIÇÃO no prazo (não é zero nem 100): o peso vai para
 *    as outras métricas;
 *  - desfazer a justificativa devolve o atraso à conta;
 *  - atividade de equipe: sai da conta de TODOS os executores e do encarregado;
 *  - a ficha lista os atrasos do mês (os que contam e os justificados, com o motivo);
 *  - MÊS FECHADO NÃO MUDA: justificar (ou desfazer) depois do fechamento não mexe no escore, na
 *    faixa, no bônus nem na lista daquele mês; reabrir faz a justificativa valer;
 *  - o colaborador vê os próprios atrasos no app (o motivo da lista, nunca a explicação escrita); a
 *    TV não recebe nada disso; outra empresa não é afetada.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/prazos-pr3-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { avisoMesFechado, competenciasDosAtrasos } from "@/lib/os/prazo-execucao";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_prazos_pr3_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** "Hoje": 20/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-20T15:00:00Z");
const DEZEMBRO = new Date("2026-12-02T15:00:00Z");
const MES = "2026-11";
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => null) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => void) => { void fn; } }));

/** A gestão: vê as OS, revisa e gerencia o desempenho (não é administradora) */
const GESTAO = montarPermissoes({ ordens: ["visualizar", "editar"], desempenho: ["visualizar", "revisar", "gerenciar"] });
const entrar = (permissoes: Permissoes = GESTAO, o: { empresaId?: string; id?: string; role?: string; tecnicoId?: string | null; email?: string } = {}) => {
  const empresaId = o.empresaId ?? "e1";
  const id = o.id ?? (empresaId === "e1" ? "uG" : "uB");
  sessao.atual = { user: { id, name: "Gabi Gestora", email: o.email ?? `${id}@x.com`, empresaId, role: o.role ?? "OPERADOR", permissoes, tecnicoId: o.tecnicoId ?? null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`https://app.exemplo.com/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
const br = (dia: string, hora = "10:00") => new Date(`${dia}T${hora}:00-03:00`);
const REGRA = (x: Record<string, unknown> = {}) => ({
  pesoPrazo: 50, pesoRelatorio: 0, pesoAvaliacao: 50, exigirFotoAntesDepois: false, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70,
  faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }, { nome: "Ouro", minimo: 90, valor: 350 }], ...x,
});

describe.skipIf(!URL_PG)("Prazos da OS — PR 3: o atraso justificado e o desempenho (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;

  /** Uma OS com as atividades já concluídas. Cada atividade: [dia agendado, dia da conclusão, executores]. */
  async function servico(atividades: Array<{ agendada: string; concluida: string; tecnicos: string[]; equipeId?: string; prazo?: string }>, o: { empresaId?: string; nota?: number; chamado?: string } = {}) {
    const id = `s${++n}`;
    const empresaId = o.empresaId ?? "e1";
    const numero = `OS-${100 + n}`;
    await prisma.ordemServico.create({ data: {
      id: `os-${id}`, empresaId, numero, chamadoNumero: o.chamado ?? null, clienteId: empresaId === "e1" ? "c1" : "cE2", criadoPorId: empresaId === "e1" ? "uG" : "uB",
      descricao: "Manutenção", status: "CONCLUIDA", dataConclusao: br(atividades[atividades.length - 1].concluida, "16:00"),
    } });
    let i = 0;
    for (const a of atividades) {
      const [responsavel, ...equipe] = a.tecnicos;
      await prisma.atividadeOs.create({ data: {
        id: `at-${id}-${++i}`, empresaId, ordemServicoId: `os-${id}`, titulo: "Visita", tecnicoId: responsavel, equipeId: a.equipeId ?? null, status: "CONCLUIDA",
        dataAgendada: br(a.agendada, "09:00"), prazo: a.prazo ? new Date(`${a.prazo}T00:00:00Z`) : null, concluidaEm: br(a.concluida, "16:00"),
        tecnicosEquipe: { create: equipe.map((tecnicoId) => ({ tecnicoId })) },
      } });
    }
    if (o.nota) {
      await prisma.osAceite.create({ data: { id: `ac-${id}`, empresaId, ordemServicoId: `os-${id}`, token: `tok-${id}`, situacao: "CONFIRMADO", metodo: "REMOTO", nome: "Cliente", avaliacao: o.nota, confirmadoEm: br(atividades[0].concluida, "18:00") } });
    }
    return { os: `os-${id}`, numero: o.chamado ?? numero };
  }
  // a causa do atraso é obrigatória desde a pausa de SLA; aqui o assunto é o desempenho, então o helper preenche uma
  const justificar = (id: string, corpo: Record<string, unknown> = { motivo: "CLIENTE_AUSENTE" }) =>
    chamar("ordens/[id]/atraso-justificado", "POST", { id }, { responsavel: "CLIENTE", ...corpo });
  const desfazer = (id: string) => chamar("ordens/[id]/atraso-justificado", "DELETE", { id });
  const painel = async (mes = MES) => (await chamar("desempenho", "GET", {}, undefined, `?mes=${mes}`)).json;
  const linha = async (nome: string, mes = MES) => (await painel(mes)).grupos.flatMap((g: any) => g.linhas).find((l: any) => l.nome === nome);
  const noPrazo = async (nome: string, mes = MES) => { const l = await linha(nome, mes); const c = l.composicao.find((x: any) => x.metrica === "prazo"); return `${c.detalhe} = ${c.valor} | escore ${l.escore}`; };
  const atrasos = async (nome: string, mes = MES) => (await linha(nome, mes)).atrasos.map((a: any) => `${a.numeroOs}|prazo ${a.prazo}|feita ${a.concluidaEm}|${a.dias}d|${a.justificado ?? "conta"}`);
  const ficha = async (tecnicoId: string, mes = MES) => (await chamar("desempenho/colaboradores/[id]", "GET", { id: tecnicoId }, undefined, `?mes=${mes}`)).json;
  const fechar = (competencia = MES) => chamar("desempenho/fechamentos", "POST", {}, { competencia, ciente: true });
  const reabrir = (id: string) => chamar("desempenho/fechamentos/[id]/reabrir", "POST", { id }, { motivo: "Justificativa de atraso lançada depois" });
  async function zerar() {
    await prisma.desempenhoFechamento.deleteMany({});
    await prisma.ordemServico.deleteMany({ where: { id: { startsWith: "os-s" } } });
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uG", empresaId: "e1", nome: "Gabi Gestora", email: "uG@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "Ana Dias", email: "ana@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "uB@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Ana Dias", cpf: "1", telefone: "1", email: "ana@x.com" },
      { id: "t2", empresaId: "e1", nome: "Bia Reis", cpf: "2", telefone: "2" },
      { id: "t3", empresaId: "e1", nome: "Edu Prado", cpf: "3", telefone: "3" },
      { id: "t4", empresaId: "e1", nome: "Carlos Lider", cpf: "4", telefone: "4" },
      { id: "tE2", empresaId: "e2", nome: "Técnico da outra", cpf: "7", telefone: "7" },
    ] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "1" }, { id: "cE2", empresaId: "e2", nome: "Cliente E2", cpfCnpj: "2" }] });
    await prisma.equipe.create({ data: { id: "eqA", empresaId: "e1", nome: "Equipe Alfa", liderId: "t4", membros: { connect: [{ id: "t2" }, { id: "t3" }] } } });

    // O Desempenho das duas empresas: perfis com regra (prazo 50, avaliação 50) e os participantes
    for (const [empresaId, id, gente] of [["e1", "uG", [["t1", "Preventiva"], ["t2", "Preventiva"], ["t3", "Preventiva"], ["t4", "Encarregado"]]], ["e2", "uB", [["tE2", "Preventiva"]]]] as const) {
      entrar(GESTAO, { empresaId, id });
      await chamar("desempenho/configuracao", "GET");
      const perfis = await prisma.desempenhoPerfil.findMany({ where: { empresaId } });
      for (const p of perfis.filter((x: any) => ["Preventiva", "Encarregado"].includes(x.nome))) expect((await chamar("desempenho/perfis/[id]/regra", "PUT", { id: p.id }, REGRA())).status).toBe(200);
      for (const [tecnicoId, perfil] of gente) expect((await chamar("desempenho/participantes", "POST", {}, { tecnicoId, perfilId: perfis.find((x: any) => x.nome === perfil).id })).status).toBe(200);
    }
    entrar();
    expect((await chamar("desempenho/tv", "POST")).status).toBe(201); // o link da TV da minha empresa
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    if (URL_PG) execFileSync("psql", [URL_PG, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => { vi.setSystemTime(AGORA); entrar(); await zerar(); });

  it("o atraso justificado SAI da conta do 'no prazo' (nem acerto nem erro); desfazer devolve; a ficha lista os atrasos com o motivo", async () => {
    await servico([{ agendada: "2026-11-05", concluida: "2026-11-05", tecnicos: ["t1"] }]);                       // no prazo
    const a = await servico([{ agendada: "2026-11-06", concluida: "2026-11-09", tecnicos: ["t1"] }]);              // 3 dias depois
    const b = await servico([{ agendada: "2026-11-01", prazo: "2026-11-10", concluida: "2026-11-11", tecnicos: ["t1"] }], { chamado: "CH-77" }); // prazo próprio: 1 dia depois
    expect(await noPrazo("Ana Dias")).toBe("1 de 3 atividades = 33.3 | escore 33.3");
    expect(await atrasos("Ana Dias")).toEqual([`${a.numero}|prazo 2026-11-06|feita 2026-11-09|3d|conta`, "CH-77|prazo 2026-11-10|feita 2026-11-11|1d|conta"]);

    expect((await justificar(a.os)).status).toBe(200);
    // Saiu da conta: 1 de 2 (50%), não 2 de 3 (66,7%) — o atraso não vira acerto
    expect(await noPrazo("Ana Dias")).toBe("1 de 2 atividades · 1 atraso justificado fora da conta = 50 | escore 50");
    expect(await atrasos("Ana Dias")).toEqual([`${a.numero}|prazo 2026-11-06|feita 2026-11-09|3d|CLIENTE_AUSENTE`, "CH-77|prazo 2026-11-10|feita 2026-11-11|1d|conta"]);

    expect((await justificar(b.os, { motivo: "OUTRO", observacao: "A portaria não liberou a entrada" })).status).toBe(200);
    expect(await noPrazo("Ana Dias")).toBe("1 de 1 atividade · 2 atrasos justificados fora da conta = 100 | escore 100");
    // A ficha é a mesma linha do painel, com a OS de cada atraso (é por ela que a gestão chega à justificativa)
    const f = await ficha("t1");
    expect(f.linha.atrasos.map((x: any) => `${x.ordemServicoId}|${x.justificado}`)).toEqual([`${a.os}|CLIENTE_AUSENTE`, `${b.os}|OUTRO`]);
    expect(f.linha).toMatchObject({ escore: 100, faixa: "Ouro", bonus: 350 });
    // "Atrasos justificados" na ficha: a OS, o prazo, o motivo, a explicação, quem justificou e quando
    expect(f.linha.atrasos).toEqual([
      { atividadeId: expect.any(String), ordemServicoId: a.os, numeroOs: a.numero, prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: "CLIENTE_AUSENTE",
        explicacao: null, justificadoPor: "Gabi Gestora", justificadoEm: AGORA.toISOString() },
      { atividadeId: expect.any(String), ordemServicoId: b.os, numeroOs: "CH-77", prazo: "2026-11-10", concluidaEm: "2026-11-11", dias: 1, justificado: "OUTRO",
        explicacao: "A portaria não liberou a entrada", justificadoPor: "Gabi Gestora", justificadoEm: AGORA.toISOString() },
    ]);
    // O ranking mostra o MESMO número da ficha (uma base de cálculo só)
    expect((await linha("Ana Dias"))).toMatchObject({ escore: f.linha.escore, composicao: f.linha.composicao, atrasos: f.linha.atrasos });

    expect((await desfazer(a.os)).status).toBe(200);
    expect(await noPrazo("Ana Dias")).toBe("1 de 2 atividades · 1 atraso justificado fora da conta = 50 | escore 50");
    expect(await atrasos("Ana Dias")).toEqual([`${a.numero}|prazo 2026-11-06|feita 2026-11-09|3d|conta`, "CH-77|prazo 2026-11-10|feita 2026-11-11|1d|OUTRO"]);
  });

  it("SÓ o atraso sai: a atividade no prazo da OS justificada continua contando; quem só tem atraso justificado fica SEM MEDIÇÃO no prazo (não é zero nem 100)", async () => {
    // Uma OS, duas visitas da Bia: uma no prazo, outra atrasada
    const duas = await servico([{ agendada: "2026-11-03", concluida: "2026-11-03", tecnicos: ["t2"] }, { agendada: "2026-11-04", concluida: "2026-11-06", tecnicos: ["t2"] }]);
    expect(await noPrazo("Bia Reis")).toBe("1 de 2 atividades = 50 | escore 50");
    await justificar(duas.os, { motivo: "PECA_FALTANDO" });
    expect(await noPrazo("Bia Reis")).toBe("1 de 1 atividade · 1 atraso justificado fora da conta = 100 | escore 100");

    // A Ana só tem um atraso, justificado: o prazo fica sem medição
    const so = await servico([{ agendada: "2026-11-10", concluida: "2026-11-12", tecnicos: ["t1"] }]);
    expect(await noPrazo("Ana Dias")).toBe("0 de 1 atividade = 0 | escore 0");
    await justificar(so.os, { motivo: "CLIMA" });
    expect(await noPrazo("Ana Dias")).toBe("sem medição no mês · 1 atraso justificado fora da conta = null | escore null");
    expect(await linha("Ana Dias")).toMatchObject({ escore: null, posicao: null, faixa: null, bonus: 0 });
    // Com uma avaliação no mês, o peso do prazo vai para ela: nota 4 = 80% (o atraso justificado não puxa para baixo nem para cima)
    await servico([{ agendada: "2026-11-13", concluida: "2026-11-14", tecnicos: ["t1"] }], { nota: 4 }).then((x) => justificar(x.os));
    const l = await linha("Ana Dias");
    expect(l.composicao.map((c: any) => `${c.metrica}:${c.valor}:${c.pontos}`)).toEqual(["prazo:null:null", "relatorio:null:null", "avaliacao:80:80"]);
    expect(l).toMatchObject({ escore: 80, faixa: "Bronze" });
    expect(l.composicao[0].detalhe).toBe("sem medição no mês · 2 atrasos justificados fora da conta");
    // O desempate da premiação conta os ACERTOS: atraso justificado não é acerto
    expect(l.desempate.noPrazo).toBe(0);
  });

  it("atividade de EQUIPE: o atraso justificado sai da conta de todos os executores e do encarregado — uma vez cada", async () => {
    await servico([{ agendada: "2026-11-05", concluida: "2026-11-05", tecnicos: ["t2", "t3"], equipeId: "eqA" }]);
    const tarde = await servico([{ agendada: "2026-11-06", concluida: "2026-11-10", tecnicos: ["t2", "t3"], equipeId: "eqA" }]);
    for (const nome of ["Bia Reis", "Edu Prado", "Carlos Lider"]) expect(await noPrazo(nome), nome).toBe("1 de 2 atividades = 50 | escore 50");
    await justificar(tarde.os, { motivo: "ACESSO_NEGADO" });
    for (const nome of ["Bia Reis", "Edu Prado", "Carlos Lider"]) {
      expect(await noPrazo(nome), nome).toBe("1 de 1 atividade · 1 atraso justificado fora da conta = 100 | escore 100");
      expect(await atrasos(nome), nome).toEqual([`${tarde.numero}|prazo 2026-11-06|feita 2026-11-10|4d|ACESSO_NEGADO`]);
    }
    // Quem não estava na atividade não ganha nem perde nada
    expect((await linha("Ana Dias")).atrasos).toEqual([]);
  });

  it("MÊS FECHADO NÃO MUDA: justificar depois do fechamento não mexe em escore, faixa, bônus nem na lista; reabrir faz valer; desfazer depois de fechar também não mexe", async () => {
    await servico([{ agendada: "2026-11-05", concluida: "2026-11-05", tecnicos: ["t1"] }], { nota: 5 });
    const tarde = await servico([{ agendada: "2026-11-06", concluida: "2026-11-09", tecnicos: ["t1"] }]);
    vi.setSystemTime(DEZEMBRO);
    const fechado = await fechar();
    expect(fechado.status).toBe(201);
    const antes = await painel();
    expect(await noPrazo("Ana Dias")).toBe("1 de 2 atividades = 50 | escore 75");
    expect((await linha("Ana Dias"))).toMatchObject({ faixa: "Bronze", bonus: 100 });

    // A página da OS sabe que o atraso é de um mês fechado (é o aviso para quem justifica)
    const os = await prisma.ordemServico.findUniqueOrThrow({ where: { id: tarde.os }, select: { status: true, atividades: { select: { status: true, prazo: true, dataAgendada: true, concluidaEm: true } } } });
    const { mesesFechadosEntre } = await import("@/lib/desempenho/fechamento-estado");
    const doAtraso = competenciasDosAtrasos(os);
    expect(doAtraso).toEqual([MES]);
    expect(await mesesFechadosEntre("e1", doAtraso)).toEqual([MES]);
    // Só os meses pedidos, só os fechados, só os da MINHA empresa
    expect(await mesesFechadosEntre("e1", ["2026-10", MES, "2026-12"])).toEqual([MES]);
    expect(await mesesFechadosEntre("e1", [])).toEqual([]);
    expect(await mesesFechadosEntre("e1", ["2026-10"])).toEqual([]); // novembro está fechado, mas não foi o mês perguntado
    expect(await mesesFechadosEntre("e2", doAtraso)).toEqual([]);
    expect(avisoMesFechado([MES])).toContain("O desempenho de 11/2026 já está fechado");

    // Justificar é permitido (fica no registro da OS) — mas o mês fechado continua como foi fechado
    expect((await justificar(tarde.os)).status).toBe(200);
    expect(await painel()).toEqual(antes);
    expect(await atrasos("Ana Dias")).toEqual([`${tarde.numero}|prazo 2026-11-06|feita 2026-11-09|3d|conta`]);
    expect((await ficha("t1")).linha).toMatchObject({ escore: 75, faixa: "Bronze", bonus: 100 });
    const folha = await prisma.desempenhoFechamentoLinha.findFirstOrThrow({ where: { tecnicoId: "t1" } });
    expect(`${folha.escore}|${folha.faixa}|${folha.valor}`).toBe("75|Bronze|100");

    // Reabrir: o mês volta a ser calculado e a justificativa passa a valer
    expect((await reabrir(fechado.json.id)).status).toBe(200);
    expect(await mesesFechadosEntre("e1", doAtraso)).toEqual([]); // reaberto: não há mais o que avisar
    expect(await noPrazo("Ana Dias")).toBe("1 de 1 atividade · 1 atraso justificado fora da conta = 100 | escore 100");
    // Fechar de novo guarda a lista como estava — e desfazer a justificativa depois não muda o fechado
    expect((await fechar()).status).toBe(201);
    expect((await desfazer(tarde.os)).status).toBe(200);
    expect(await noPrazo("Ana Dias")).toBe("1 de 1 atividade · 1 atraso justificado fora da conta = 100 | escore 100");
    expect(await atrasos("Ana Dias")).toEqual([`${tarde.numero}|prazo 2026-11-06|feita 2026-11-09|3d|CLIENTE_AUSENTE`]);
    expect((await ficha("t1")).linha).toMatchObject({ escore: 100, faixa: "Ouro", bonus: 350 });
  });

  it("mês fechado ANTES de a lista existir: a linha gravada sem 'atrasos' continua lendo normalmente (a ficha só não mostra a seção)", async () => {
    await servico([{ agendada: "2026-11-06", concluida: "2026-11-09", tecnicos: ["t1"] }]);
    vi.setSystemTime(DEZEMBRO);
    const f = await fechar();
    // Um fechamento antigo: o painel gravado não tem a lista de atrasos
    const gravado = await prisma.desempenhoFechamento.findUniqueOrThrow({ where: { id: f.json.id } });
    const antigo = { ...gravado.painel, grupos: gravado.painel.grupos.map((g: any) => ({ ...g, linhas: g.linhas.map(({ atrasos: _fora, ...l }: any) => l) })) };
    await prisma.desempenhoFechamento.update({ where: { id: f.json.id }, data: { painel: antigo } });
    const l = (await ficha("t1")).linha;
    expect(l).toMatchObject({ escore: 0 });
    expect(l.atrasos).toBeUndefined();
  });

  it("o COLABORADOR vê os próprios atrasos no app — o motivo da lista, nunca a explicação escrita; a TV não recebe atrasos; outra empresa não é afetada", async () => {
    await servico([{ agendada: "2026-11-05", concluida: "2026-11-05", tecnicos: ["t1"] }]);
    const tarde = await servico([{ agendada: "2026-11-06", concluida: "2026-11-09", tecnicos: ["t1"] }]);
    const deOutro = await servico([{ agendada: "2026-11-06", concluida: "2026-11-12", tecnicos: ["t2"] }]);
    await justificar(tarde.os, { motivo: "OUTRO", observacao: "Cliente pediu sigilo sobre a obra" });
    // A outra empresa tem o próprio atraso — e a minha justificativa não mexe nele
    const daOutra = await servico([{ agendada: "2026-11-06", concluida: "2026-11-09", tecnicos: ["tE2"] }], { empresaId: "e2" });

    entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: "t1", email: "ana@x.com" });
    const meu = (await chamar("tecnico/desempenho", "GET", {}, undefined, `?mes=${MES}`)).json;
    expect(meu.ficha.linha.atrasos).toEqual([{ atividadeId: expect.any(String), ordemServicoId: tarde.os, numeroOs: tarde.numero, prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: "OUTRO" }]);
    const texto = JSON.stringify(meu);
    for (const proibido of ["sigilo", "Gabi Gestora", "explicacao", "justificadoPor", deOutro.numero, "Bia Reis"]) expect(texto, proibido).not.toContain(proibido);
    // O número que ele vê é o mesmo do painel da gestão (a mesma linha, só sem a explicação e o autor)
    entrar();
    const doPainel = await linha("Ana Dias");
    expect(doPainel.atrasos[0]).toMatchObject({ explicacao: "Cliente pediu sigilo sobre a obra", justificadoPor: "Gabi Gestora" });
    expect({ escore: meu.ficha.linha.escore, composicao: meu.ficha.linha.composicao }).toEqual({ escore: doPainel.escore, composicao: doPainel.composicao });
    entrar(PRESETS.TECNICO, { id: "uT", role: "TECNICO", tecnicoId: "t1", email: "ana@x.com" });
    // O técnico não justifica o próprio atraso (a válvula é da gestão)
    expect((await justificar(deOutro.os)).status).toBe(403);

    const token = (await prisma.desempenhoConfig.findUniqueOrThrow({ where: { empresaId: "e1" } })).tvToken;
    sessao.atual = null;
    const tv = await chamar("publico/desempenho/[token]", "GET", { token });
    expect(tv.status).toBe(200);
    expect(JSON.stringify(tv.json)).not.toMatch(/atrasos|justificad|OS-/);

    entrar(GESTAO, { empresaId: "e2", id: "uB" });
    expect(await noPrazo("Técnico da outra")).toBe("0 de 1 atividade = 0 | escore 0");
    expect(await atrasos("Técnico da outra")).toEqual([`${daOutra.numero}|prazo 2026-11-06|feita 2026-11-09|3d|conta`]);
    // …e não justifica a OS da minha empresa (não existe para ela)
    expect((await justificar(tarde.os)).status).toBe(404);
  });
});
