/**
 * OS sem equipamento — as saídas da trava de equipamento pelas rotas reais com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`). Prova, de ponta a ponta:
 *  - tipo de OS que NÃO exige equipamento (visita técnica): a atividade conclui sem equipamento e a
 *    OS conclui sozinha; os equipamentos que forem atendidos continuam exigindo o checklist;
 *  - tipo que EXIGE (padrão): a trava vale no servidor, com a mensagem das saídas;
 *  - OS recorrente de contrato sem equipamento vinculado conclui; com equipamento vinculado, a trava vale;
 *  - exceção justificada: só quem pode concluir OS, motivo obrigatório, grava na OS e no histórico
 *    (quem/quando), conclui a atividade que travou; falhando por outro motivo, nada fica gravado;
 *  - o cadastro do tipo de OS grava a marcação (só com configurações › gerenciar); isolamento por empresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-sem-equipamento-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_SAIDAS_SEM_EQUIPAMENTO, MSG_SEM_EQUIPAMENTO } from "@/lib/execucao/pendencias";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_sem_equip_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), id = "u1", empresaId = "e1") => {
  sessao.atual = { user: { id, name: id === "u1" ? "Ana" : "Outro", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = (tecnicoId = "t1", id = "uT") => {
  sessao.atual = { user: { id, name: "João", email: `${id}@x.com`, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};
const sem = (modulo: string, acao: string) => {
  const p = permissoesTotais() as any;
  p[modulo] = { ...p[modulo], [acao]: false };
  return p as Permissoes;
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json() : null };
}
const OS = "ordens/[id]";
const A = "ordens/[id]/atividades/[atividadeId]";
const EXEC = `${A}/execucao`;
const EQUIPS = `${A}/equipamentos`;
const JUSTIFICAR = "ordens/[id]/concluir-sem-equipamento";
const MSG_TRAVA = `${MSG_SEM_EQUIPAMENTO} ${MSG_SAIDAS_SEM_EQUIPAMENTO}`;

describe.skipIf(!URL_PG)("OS sem equipamento: tipo que não exige, recorrente e exceção justificada (PostgreSQL real)", () => {
  let prisma: any;

  const statusOs = async (id: string) => (await prisma.ordemServico.findUnique({ where: { id }, select: { status: true } })).status;
  const statusAt = async (id: string) => (await prisma.atividadeOs.findUnique({ where: { id }, select: { status: true } })).status;
  const historico = async (id: string, acao: string) =>
    (await prisma.osHistorico.findMany({ where: { ordemServicoId: id, acao }, orderBy: { criadoEm: "asc" } })).map((h: any) => [h.usuarioId, h.detalhes]);
  /** OS com 1 atividade, criada pela rota (como a tela faz) */
  async function novaOs(tipoOsId?: string, extra: Record<string, unknown> = {}) {
    const r = await chamar("ordens", "POST", {}, {
      clienteId: "c1", unidadeId: "un1", descricao: "Atendimento de teste", ...extra,
      execucao: { tecnicoIds: ["t1"], responsavelId: "t1", ...(tipoOsId && { tipoOsId }) },
    });
    expect(r.status).toBe(201);
    const at = await prisma.atividadeOs.findFirst({ where: { ordemServicoId: r.json.id } });
    return { os: r.json.id as string, at: at.id as string };
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens", OS, A, EXEC, EQUIPS, JUSTIFICAR, "tipos-os", "tipos-os/[id]", "tecnico/sync"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await Promise.all([import("@/lib/relatorio-server"), import("@/lib/os/sincronizar-status")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João", email: "j@x.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Maria", email: "m@x.com", senha: "x", role: "TECNICO" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "55566677788", telefone: "11999990001" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Limpeza dos filtros", ordem: 0 },
      { id: "i2", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Teste de funcionamento", ordem: 1 },
    ] });
    await prisma.equipamento.createMany({ data: [
      { id: "eqA", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "te1", marca: "Daikin", modelo: "FTXS", nome: "Split Sala 1" },
    ] });
    await prisma.tipoOs.createMany({ data: [
      { id: "tManut", empresaId: "e1", nome: "Manutenção Preventiva" }, // padrão: exige
      { id: "tVisita", empresaId: "e1", nome: "Visita Técnica", exigeEquipamento: false },
    ] });
    // Os técnicos precisam da competência no tipo de OS para entrar na atividade
    for (const t of ["t1", "t2"]) await prisma.tecnico.update({ where: { id: t }, data: { competencias: { connect: [{ id: "tManut" }, { id: "tVisita" }] } } });
    await prisma.contrato.create({ data: { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-001", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01") } });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("tipo que EXIGE equipamento (padrão): a trava vale no servidor, e a mensagem diz as saídas", async () => {
    const { os, at } = await novaOs("tManut");
    const r = await chamar(A, "PUT", { id: os, atividadeId: at }, { status: "CONCLUIDA" });
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ semEquipamento: true, erro: MSG_TRAVA });
    expect(await statusAt(at)).toBe("AGENDADA");
    const o = await chamar(OS, "PUT", { id: os }, { status: "CONCLUIDA" });
    expect(o.status).toBe(422);
    expect(o.json.erro).toBe(MSG_TRAVA);
    expect((await chamar(EXEC, "GET", { id: os, atividadeId: at })).json).toMatchObject({ dispensaEquipamento: null, conclusao: { ok: false, semEquipamento: true } });
  });

  it("tipo que NÃO exige (Visita técnica): a atividade conclui sem equipamento e a OS conclui sozinha", async () => {
    const { os, at } = await novaOs("tVisita");
    const x = (await chamar(EXEC, "GET", { id: os, atividadeId: at })).json;
    expect(x.dispensaEquipamento).toEqual({ motivo: "TIPO", texto: "O tipo de OS “Visita Técnica” não exige equipamento: pode concluir sem equipamento atendido." });
    expect(x.conclusao).toMatchObject({ ok: true, semEquipamento: false, dispensa: { motivo: "TIPO" }, mensagem: null });
    expect((await chamar(A, "PUT", { id: os, atividadeId: at }, { status: "CONCLUIDA" })).status).toBe(200);
    expect(await statusOs(os)).toBe("CONCLUIDA");
    expect(await prisma.relatorioOs.count({ where: { ordemServicoId: os } })).toBeGreaterThan(0);
  });

  it("tipo que não exige NÃO afrouxa o checklist: equipamento atendido continua exigindo as respostas", async () => {
    const { os, at } = await novaOs("tVisita");
    expect((await chamar(EQUIPS, "POST", { id: os, atividadeId: at }, { equipamentoIds: ["eqA"] })).status).toBe(201);
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: at }, data: { feito: true } }); // atendido, nada respondido
    const r = await chamar(A, "PUT", { id: os, atividadeId: at }, { status: "CONCLUIDA" });
    expect(r.status).toBe(422);
    expect(r.json.erro).toMatch(/Split Sala 1.*2 itens sem resposta/);
    // equipamento vinculado mas NÃO atendido não trava (sai como "não atendido")
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: at }, data: { feito: false } });
    expect((await chamar(A, "PUT", { id: os, atividadeId: at }, { status: "CONCLUIDA" })).status).toBe(200);
  });

  it("OS com uma atividade que não exige e outra que exige, sem equipamento: a que exige trava e a OS não conclui", async () => {
    const { os, at } = await novaOs("tVisita");
    const outra = await chamar("ordens/[id]/atividades", "POST", { id: os }, { titulo: "Manutenção", tipoOsId: "tManut", tecnicoIds: ["t1"], responsavelId: "t1" });
    expect(outra.status).toBe(201);
    expect((await chamar(A, "PUT", { id: os, atividadeId: at }, { status: "CONCLUIDA" })).status).toBe(200);
    expect((await chamar(A, "PUT", { id: os, atividadeId: outra.json.id }, { status: "CONCLUIDA" })).status).toBe(422);
    const o = await chamar(OS, "PUT", { id: os }, { status: "CONCLUIDA" });
    expect(o.status).toBe(422);
    expect(await statusOs(os)).not.toBe("CONCLUIDA");
  });

  it("OS RECORRENTE de contrato sem equipamento vinculado conclui (mesmo de tipo que exige); vinculou equipamento, a trava volta", async () => {
    const { os, at } = await novaOs("tManut");
    await prisma.ordemServico.update({ where: { id: os }, data: { origem: "RECORRENTE", contratoId: "ct1", periodoRecorrencia: "2026-10" } });
    const x = (await chamar(EXEC, "GET", { id: os, atividadeId: at })).json;
    expect(x.dispensaEquipamento).toMatchObject({ motivo: "RECORRENTE" });

    const { os: os2, at: at2 } = await novaOs("tManut");
    await prisma.ordemServico.update({ where: { id: os2 }, data: { origem: "RECORRENTE", contratoId: "ct1", periodoRecorrencia: "2026-11" } });
    expect((await chamar(EQUIPS, "POST", { id: os2, atividadeId: at2 }, { equipamentoIds: ["eqA"] })).status).toBe(201);
    const r2 = await chamar(A, "PUT", { id: os2, atividadeId: at2 }, { status: "CONCLUIDA" });
    expect(r2.status).toBe(422);
    expect(r2.json.semEquipamento).toBe(true);

    expect((await chamar(A, "PUT", { id: os, atividadeId: at }, { status: "CONCLUIDA" })).status).toBe(200);
    expect(await statusOs(os)).toBe("CONCLUIDA");
  });

  it("OS recorrente gerada SEM atividade (contrato sem tipo/técnico): concluir a OS passa", async () => {
    const os = await prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: "OS-2026-9100", clienteId: "c1", criadoPorId: "u1", descricao: "Preventiva do contrato",
      status: "AGENDADA", origem: "RECORRENTE", contratoId: "ct1", periodoRecorrencia: "2026-12", previsaoConclusao: new Date("2026-12-10T00:00:00Z"),
    } });
    const r = await chamar(OS, "PUT", { id: os.id }, { status: "CONCLUIDA" });
    expect(r.status).toBe(200);
    expect(await statusOs(os.id)).toBe("CONCLUIDA");
    // OS comum sem atividade continua travada…
    const comum = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: "OS-2026-9101", clienteId: "c1", criadoPorId: "u1", descricao: "Comum" } });
    expect((await chamar(OS, "PUT", { id: comum.id }, { status: "CONCLUIDA" })).status).toBe(422);
    // …até alguém com "concluir OS" justificar a exceção
    expect((await chamar(JUSTIFICAR, "POST", { id: comum.id }, { motivo: "Atendimento só por telefone" })).status).toBe(200);
    expect((await chamar(OS, "PUT", { id: comum.id }, { status: "CONCLUIDA" })).status).toBe(200);
  });

  it("exceção justificada: motivo gravado na OS e no histórico (quem/quando), atividade concluída e OS concluída", async () => {
    const { os, at } = await novaOs("tManut");
    logar(permissoesTotais(), "u1");
    const r = await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "  Visita de avaliação do local, sem intervenção  ", atividadeId: at });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, status: "CONCLUIDA", semEquipamentoMotivo: "Visita de avaliação do local, sem intervenção" });
    expect(await statusAt(at)).toBe("CONCLUIDA");
    expect((await prisma.ordemServico.findUnique({ where: { id: os } })).semEquipamentoMotivo).toBe("Visita de avaliação do local, sem intervenção");
    const [h] = await prisma.osHistorico.findMany({ where: { ordemServicoId: os, acao: "Conclusão sem equipamento autorizada" } });
    expect([h.usuarioId, h.detalhes]).toEqual(["u1", "Visita de avaliação do local, sem intervenção"]);
    expect(h.criadoEm).toBeInstanceOf(Date);
    // a execução passa a dizer por quê
    expect((await chamar(EXEC, "GET", { id: os, atividadeId: at })).json.dispensaEquipamento)
      .toEqual({ motivo: "JUSTIFICADA", texto: "Conclusão sem equipamento autorizada: “Visita de avaliação do local, sem intervenção”." });
  });

  it("exceção justificada sem atividade: só autoriza; depois a atividade (e a OS) concluem normalmente", async () => {
    const { os, at } = await novaOs("tManut");
    expect((await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Cliente só pediu avaliação" })).status).toBe(200);
    expect(await statusAt(at)).toBe("AGENDADA");
    expect((await chamar(A, "PUT", { id: os, atividadeId: at }, { status: "CONCLUIDA" })).status).toBe(200);
    expect(await statusOs(os)).toBe("CONCLUIDA");
  });

  it("exceção justificada que trava por OUTRO motivo (equipamento atendido incompleto): 422 e nada fica gravado", async () => {
    const { os, at } = await novaOs("tManut");
    await chamar(EQUIPS, "POST", { id: os, atividadeId: at }, { equipamentoIds: ["eqA"] });
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: at }, data: { feito: true } });
    const r = await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Tentando passar por cima", atividadeId: at });
    expect(r.status).toBe(422);
    expect(r.json.erro).toMatch(/itens sem resposta/);
    expect((await prisma.ordemServico.findUnique({ where: { id: os } })).semEquipamentoMotivo).toBeNull();
    expect(await historico(os, "Conclusão sem equipamento autorizada")).toEqual([]);
    expect(await statusAt(at)).toBe("AGENDADA");
  });

  it("exceção justificada: RBAC (concluir OS), motivo obrigatório, OS cancelada, outra empresa e escopo do técnico", async () => {
    const { os, at } = await novaOs("tManut");
    logar(sem("ordens", "concluir"));
    expect((await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Motivo suficiente aqui", atividadeId: at })).status).toBe(403);
    logar();
    const curto = await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "curto", atividadeId: at });
    expect(curto.status).toBe(400);
    expect(curto.json.erro).toBe("Explique o motivo (pelo menos 10 caracteres).");
    expect((await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Motivo suficiente aqui", atividadeId: "nao-existe" })).status).toBe(404);
    logar(permissoesTotais(), "u2", "e2");
    expect((await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Motivo suficiente aqui" })).status).toBe(404);
    // técnico de fora da atividade não justifica por ela
    comoTecnico("t2", "uT2");
    expect((await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Motivo suficiente aqui", atividadeId: at })).status).toBe(403);
    // ...nem sem dizer a atividade (o técnico só justifica pela atividade dele)
    comoTecnico("t1", "uT");
    expect((await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Motivo suficiente aqui" })).status).toBe(403);
    expect((await prisma.ordemServico.findUnique({ where: { id: os } })).semEquipamentoMotivo).toBeNull();
    // o técnico da atividade pode (o perfil Técnico tem "concluir OS")
    comoTecnico("t1", "uT");
    expect((await chamar(JUSTIFICAR, "POST", { id: os }, { motivo: "Local fechado, só avaliação", atividadeId: at })).status).toBe(200);
    expect(await historico(os, "Conclusão sem equipamento autorizada")).toEqual([["uT", "Local fechado, só avaliação"]]);
    logar();
    const { os: os2 } = await novaOs("tManut");
    expect((await chamar(OS, "DELETE", { id: os2 }, { motivo: "teste" })).status).toBe(200);
    expect((await chamar(JUSTIFICAR, "POST", { id: os2 }, { motivo: "Motivo suficiente aqui" })).status).toBe(409);
    expect((await prisma.ordemServico.findUnique({ where: { id: os2 } })).semEquipamentoMotivo).toBeNull();
  });

  it("app do técnico: conclusão offline de atividade de tipo que não exige passa pela sincronização", async () => {
    logar();
    const { os, at } = await novaOs("tVisita");
    comoTecnico("t1", "uT");
    const r = await chamar("tecnico/sync", "POST", {}, { operacoes: [{ id: randomUUID(), tipo: "concluir", atividadeId: at, em: new Date().toISOString(), dados: {} }] });
    expect(r.status).toBe(200);
    expect(r.json.resultados[0]).toMatchObject({ ok: true });
    expect(await statusAt(at)).toBe("CONCLUIDA");
    logar();
    expect(await statusOs(os)).toBe("CONCLUIDA");
  });

  it("cadastro do tipo de OS: grava 'não exige equipamento' (configurações › gerenciar), padrão exige, isolado por empresa", async () => {
    logar();
    const novo = await chamar("tipos-os", "POST", {}, { nome: "Vistoria" });
    expect(novo.status).toBe(201);
    expect(novo.json.exigeEquipamento).toBe(true);
    const sem_ = await chamar("tipos-os", "POST", {}, { nome: "Orçamento no local", exigeEquipamento: false });
    expect(sem_.json.exigeEquipamento).toBe(false);
    const alt = await chamar("tipos-os/[id]", "PUT", { id: novo.json.id }, { exigeEquipamento: false });
    expect(alt.status).toBe(200);
    expect(alt.json).toMatchObject({ nome: "Vistoria", exigeEquipamento: false });
    expect((await chamar("tipos-os/[id]", "PUT", { id: novo.json.id }, { exigeEquipamento: "não" })).status).toBe(400);
    logar(sem("configuracoes", "gerenciar"));
    expect((await chamar("tipos-os/[id]", "PUT", { id: novo.json.id }, { exigeEquipamento: true })).status).toBe(403);
    logar(permissoesTotais(), "u2", "e2");
    expect((await chamar("tipos-os/[id]", "PUT", { id: novo.json.id }, { exigeEquipamento: true })).status).toBe(404);
    logar();
    expect((await prisma.tipoOs.findUnique({ where: { id: novo.json.id } })).exigeEquipamento).toBe(false);
  });
});
