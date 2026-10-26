/**
 * Nova OS — gaveta "Vincular equipamento" e datas, pelas rotas reais com o Prisma real num PostgreSQL
 * real (schema descartável via `prisma db push`):
 *  - GET /api/equipamentos?clienteId=…&resumo=1: só os ativos DO cliente, de todos os locais dele,
 *    com unidade e tipo, SEM as fotos (base64 pesado); nada de outra empresa; lê com ordens › visualizar;
 *    a resposta padrão (sem resumo) não muda;
 *  - POST /api/ordens: "Prazo para finalizar" grava previsaoConclusao (o prazo que a central usa para
 *    no prazo/atrasada); "Agendar para" grava a dataAgendada da 1ª atividade; equipamentos de dois
 *    endereços do cliente entram na 1ª atividade; de outro cliente, recusa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nova-os-equipamentos-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { situacaoPrazo } from "@/lib/os/prazos";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nova_os_equip_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), id = "u1", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
/** Só pode ver OS (quem abre OS sem acesso ao cadastro de equipamentos). */
const soOrdens = () => {
  const p = permissoesVazias() as any;
  p.ordens = { ...p.ordens, visualizar: true };
  return p as Permissoes;
};

async function listar(query: string) {
  const mod = await import("@/app/api/equipamentos/route");
  const res = await mod.GET(new NextRequest(`http://localhost/api/equipamentos?${query}`));
  return { status: res.status, json: await res.json() };
}
async function criarOs(corpo: unknown) {
  const mod = await import("@/app/api/ordens/route");
  const res = await mod.POST(new NextRequest("http://localhost/api/ordens", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  }));
  return { status: res.status, json: await res.json() };
}

describe.skipIf(!URL_PG)("Nova OS: equipamentos do cliente (resumo) e datas na criação (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/equipamentos/route"), import("@/app/api/ordens/route")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e1", nome: "Padaria", cpfCnpj: "11222333000262" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "un2", empresaId: "e1", clienteId: "c1", nome: "Anexo — Bloco B" },
      { id: "un3", empresaId: "e1", clienteId: "c2", nome: "Loja" },
      { id: "unX", empresaId: "e2", clienteId: "cX", nome: "Sede" },
    ] });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split Hi-Wall", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    const base = { tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTXS", fotos: ["data:image/jpeg;base64,AAAA"] };
    await prisma.equipamento.createMany({ data: [
      { ...base, id: "eqA", empresaId: "e1", unidadeId: "un1", tipoEquipamentoId: "te1", nome: "Split Recepção", capacidade: "12.000 BTU/h", patrimonio: "AC-01", setor: "Térreo" },
      { ...base, id: "eqB", empresaId: "e1", unidadeId: "un2", nome: "Chiller", marca: "Carrier", modelo: "30RB", potencia: "3 TR" },
      { ...base, id: "eqInativo", empresaId: "e1", unidadeId: "un1", ativo: false },
      { ...base, id: "eqOutroCliente", empresaId: "e1", unidadeId: "un3" },
      { ...base, id: "eqOutraEmpresa", empresaId: "e2", unidadeId: "unX" },
    ] });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("resumo: só os ativos do cliente, de todos os locais, com local e tipo e sem as fotos", async () => {
    const r = await listar("clienteId=c1&resumo=1");
    expect(r.status).toBe(200);
    expect(r.json.map((e: any) => e.id).sort()).toEqual(["eqA", "eqB"]);
    const a = r.json.find((e: any) => e.id === "eqA");
    expect(a).toEqual({
      id: "eqA", nome: "Split Recepção", marca: "Daikin", modelo: "FTXS", capacidade: "12.000 BTU/h", potencia: null, patrimonio: "AC-01",
      setor: "Térreo", localizacao: null, ativo: true, unidadeId: "un1", unidade: { id: "un1", nome: "Matriz" }, tipoEquipamento: { id: "te1", nome: "Split Hi-Wall" },
    });
    expect(r.json.find((e: any) => e.id === "eqB").unidade).toEqual({ id: "un2", nome: "Anexo — Bloco B" });
    expect(r.json.every((e: any) => !("fotos" in e))).toBe(true);
  });

  it("a resposta padrão (sem resumo) continua com as fotos e os demais campos", async () => {
    const r = await listar("clienteId=c1");
    expect(r.status).toBe(200);
    expect(r.json.find((e: any) => e.id === "eqA").fotos).toEqual(["data:image/jpeg;base64,AAAA"]);
  });

  it("isolamento: o cliente de outra empresa não devolve nada; a outra empresa não vê os nossos", async () => {
    expect((await listar("clienteId=cX&resumo=1")).json).toEqual([]);
    logar(permissoesTotais(), "u2", "e2");
    try {
      expect((await listar("clienteId=c1&resumo=1")).json).toEqual([]);
      expect((await listar("clienteId=cX&resumo=1")).json.map((e: any) => e.id)).toEqual(["eqOutraEmpresa"]);
    } finally { logar(); }
  });

  it("quem só vê OS também lê (é o seletor da OS); sem nenhuma das permissões, 403; sem sessão, 401", async () => {
    logar(soOrdens());
    try {
      expect((await listar("clienteId=c1&resumo=1")).status).toBe(200);
      logar(permissoesVazias());
      expect((await listar("clienteId=c1&resumo=1")).status).toBe(403);
      sessao.atual = null;
      expect((await listar("clienteId=c1&resumo=1")).status).toBe(401);
    } finally { logar(); }
  });

  it("criação: prazo → previsaoConclusao (atrasada depois do dia); agendar → dataAgendada da 1ª atividade; equipamentos de dois endereços na 1ª atividade", async () => {
    const r = await criarOs({
      clienteId: "c1", unidadeId: "un1", descricao: "Preventiva mensal", prioridade: "NORMAL",
      previsaoConclusao: "2026-11-20", equipamentoIds: ["eqA", "eqB"],
      execucao: { dataAgendada: "2026-11-18T17:30:00.000Z", tecnicoIds: ["t1"], responsavelId: "t1" },
    });
    expect(r.status).toBe(201);
    const os = await prisma.ordemServico.findUnique({ where: { id: r.json.id }, include: { atividades: { include: { equipamentos: true } } } });
    expect(os.previsaoConclusao.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    // O prazo da central: dia civil de Brasília
    expect(situacaoPrazo(os.previsaoConclusao, false, new Date("2026-11-20T23:00:00-03:00")).situacao).toBe("VENCE_HOJE");
    expect(situacaoPrazo(os.previsaoConclusao, false, new Date("2026-11-21T08:00:00-03:00"))).toMatchObject({ situacao: "ATRASADO", diasAtraso: 1 });
    expect(os.atividades).toHaveLength(1);
    const [at] = os.atividades;
    expect(at.dataAgendada.toISOString()).toBe("2026-11-18T17:30:00.000Z");
    expect(at.equipamentos.map((v: any) => v.equipamentoId).sort()).toEqual(["eqA", "eqB"]);
  });

  it("sem prazo e sem agendamento: a OS nasce sem prazo e a atividade sem data", async () => {
    const r = await criarOs({ clienteId: "c1", descricao: "Visita", prioridade: "NORMAL", previsaoConclusao: "", execucao: { dataAgendada: null, tecnicoIds: ["t1"], responsavelId: "t1" } });
    expect(r.status).toBe(201);
    const os = await prisma.ordemServico.findUnique({ where: { id: r.json.id }, include: { atividades: { include: { equipamentos: true } } } });
    expect(os.previsaoConclusao).toBeNull();
    expect(os.atividades[0].dataAgendada).toBeNull();
    expect(os.atividades[0].equipamentos).toEqual([]);
  });

  it("equipamento de outro cliente (ou de outra empresa) é recusado e nada é criado", async () => {
    const antes = await prisma.ordemServico.count();
    for (const id of ["eqOutroCliente", "eqOutraEmpresa"]) {
      const r = await criarOs({ clienteId: "c1", descricao: "Preventiva mensal", prioridade: "NORMAL", equipamentoIds: ["eqA", id], execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } });
      expect(r.status).toBe(400);
      expect(r.json.erro).toContain("outro cliente");
    }
    expect(await prisma.ordemServico.count()).toBe(antes);
  });
});
