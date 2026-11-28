/**
 * COM-2B — a comissão no retrato da atividade (o que o app do técnico baixa), no PostgreSQL real (dados fictícios):
 *  - por equipamento da atividade, quanto ESTE técnico ganha com ele feito e completo (a linha ÷ os vinculados da OS
 *    inteira, a regra que vence para ele, a divisão), e o que o servidor já confirmou;
 *  - "para quem executou": ainda não marcado, conta como se fosse ele (é ele quem vai marcar); marcado por outro, zero;
 *  - a rota do retrato leva só o valor de quem está logado (nunca regra, base, custo ou colega);
 *  - null: empresa sem regra de técnico, quem não está na atividade, OS cancelada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/com2b-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_com2b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const comoTecnico = (id: string, tecnicoId: string) => {
  sessao.atual = { user: { id, name: id, email: `${id}@ficticio.test`, empresaId: "e1", empresaNome: "x", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};

describe.skipIf(!URL_PG)("COM-2B — a comissão no retrato da atividade (PostgreSQL real)", () => {
  let prisma: any;
  let exe: typeof import("@/lib/comissoes/executor-server");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    exe = await import("@/lib/comissoes/executor-server");
    await import("@/app/api/tecnico/atividades/[atividadeId]/route");

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Fictícia", cnpj: "12345678000190", email: "e1@ficticio.test" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uCarlos", empresaId: "e1", nome: "Carlos Técnico", email: "carlos@ficticio.test", senha: "x", role: "TECNICO" },
      { id: "uAna", empresaId: "e1", nome: "Ana Ajudante", email: "ana@ficticio.test", senha: "x", role: "TECNICO" },
      { id: "uFora", empresaId: "e1", nome: "Fora da OS", email: "fora@ficticio.test", senha: "x", role: "TECNICO" },
      { id: "uAdm", empresaId: "e1", nome: "Gestora", email: "adm@ficticio.test", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "tCarlos", empresaId: "e1", nome: "Carlos Técnico", cpf: "1", telefone: "1", email: "carlos@ficticio.test" },
      { id: "tAna", empresaId: "e1", nome: "Ana Ajudante", cpf: "2", telefone: "1", email: "ana@ficticio.test" },
      { id: "tFora", empresaId: "e1", nome: "Fora da OS", cpf: "3", telefone: "1", email: "fora@ficticio.test" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "11222333000181" } });
    await prisma.unidade.create({ data: { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.equipamento.createMany({ data: ["q1", "q2", "q3"].map((id, i) => ({ id, empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", nome: `Split ${i + 1}` })) });
    // A OS: linha de R$ 300; q1 e q2 na atividade do Carlos e da Ana; q3 em outra atividade (conta nos vinculados)
    await prisma.ordemServico.create({ data: {
      id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", unidadeId: "u1", criadoPorId: "uAdm", descricao: "Preventiva", status: "ABERTA",
      itensOrcamento: { create: [{ id: "l1", descricao: "Limpeza", quantidade: 3, valorUnitario: 100, valorTotal: 300, tipo: "SERVICO" }] },
      atividades: { create: [
        { id: "aA", empresaId: "e1", titulo: "Limpeza", status: "EM_ANDAMENTO", tecnicoId: "tCarlos", tecnicosEquipe: { create: [{ tecnicoId: "tAna" }] },
          equipamentos: { create: [{ equipamentoId: "q1" }, { equipamentoId: "q2" }] } },
        { id: "aB", empresaId: "e1", titulo: "Outra", status: "AGENDADA", tecnicoId: "tFora", equipamentos: { create: [{ equipamentoId: "q3" }] } },
      ] },
    } });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("sem regra de técnico na empresa: null (o app não mostra nada)", async () => {
    expect(await exe.comissaoParaRetrato("e1", "aA", "uCarlos")).toBeNull();
  });

  it("igual: a linha ÷ 3 vinculados (R$ 100), 10% = R$ 10, metade dele = R$ 5 por equipamento; nada confirmado ainda", async () => {
    await prisma.comissaoRegra.create({ data: { id: "r1", empresaId: "e1", quemTipo: "TODOS", papel: "EXECUTOR", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 10, divisao: "IGUAL" } });
    expect(await exe.comissaoParaRetrato("e1", "aA", "uCarlos")).toEqual({ porEquipamento: { q1: 5, q2: 5 }, confirmadas: {} });
  });

  it("para quem executou: ainda não marcado conta como dele; marcado pela colega, zero para ele", async () => {
    await prisma.comissaoRegra.update({ where: { id: "r1" }, data: { divisao: "POR_EXECUTOR" } });
    expect((await exe.comissaoParaRetrato("e1", "aA", "uCarlos"))!.porEquipamento).toEqual({ q1: 10, q2: 10 });
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: "aA", equipamentoId: "q2" }, data: { feito: true, feitoEm: new Date(), feitoPorId: "tAna" } });
    expect((await exe.comissaoParaRetrato("e1", "aA", "uCarlos"))!.porEquipamento).toEqual({ q1: 10 });
    expect((await exe.comissaoParaRetrato("e1", "aA", "uAna"))!.porEquipamento).toEqual({ q1: 10, q2: 10 });
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: "aA", equipamentoId: "q2" }, data: { feito: false, feitoEm: null, feitoPorId: null } });
    await prisma.comissaoRegra.update({ where: { id: "r1" }, data: { divisao: "IGUAL" } });
  });

  it("o que o servidor já confirmou (a comissão nasceu) vem em 'confirmadas'", async () => {
    await prisma.atividadeEquipamento.updateMany({ where: { atividadeId: "aA", equipamentoId: "q1" }, data: { feito: true, feitoEm: new Date(), feitoPorId: "tCarlos" } });
    await exe.sincronizarExecutor("e1", { osIds: ["os1"] });
    expect(await exe.comissaoParaRetrato("e1", "aA", "uCarlos")).toEqual({ porEquipamento: { q1: 5, q2: 5 }, confirmadas: { q1: 5 } });
  });

  it("a rota do retrato: a comissão de quem está logado, e só dela (sem regra, base, custo ou colega)", async () => {
    comoTecnico("uCarlos", "tCarlos");
    const mod = await import("@/app/api/tecnico/atividades/[atividadeId]/route");
    const res: Response = await mod.GET(new NextRequest("http://localhost/api/tecnico/atividades/aA"), { params: Promise.resolve({ atividadeId: "aA" }) });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.comissao).toEqual({ porEquipamento: { q1: 5, q2: 5 }, confirmadas: { q1: 5 } });
    expect(JSON.stringify(corpo.comissao)).not.toMatch(/regra|base|custo|taxa|Ana/i);
  });

  it("quem não está na atividade e a OS cancelada: null", async () => {
    expect(await exe.comissaoParaRetrato("e1", "aA", "uFora")).toBeNull();
    await prisma.ordemServico.update({ where: { id: "os1" }, data: { status: "CANCELADA" } });
    expect(await exe.comissaoParaRetrato("e1", "aA", "uCarlos")).toBeNull();
  });
});
