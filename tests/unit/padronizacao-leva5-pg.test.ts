/**
 * Leva 5 — Operação: as ROTAS num PostgreSQL real (schema descartável via `prisma db push`).
 *
 *  - GET /api/ordens/sugestoes: quem abre OS é quem pede (403 sem a permissão, 401 sem sessão);
 *    janela de 6 meses, mínimo de 2 OS, OS cancelada fora, OS distintas (não atividades), empate
 *    não sugere, cadastro inativado depois não é sugerido, e nada atravessa de outra empresa;
 *  - PUT /api/ordens/[id]: os CAMPOS da OS fechada (assinada, faturada ou com nota) não mudam —
 *    409 e NADA alterado no banco; a OS aberta muda normalmente; sem a permissão, 403 e nada muda.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva5-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { JANELA_MESES, MINIMO_OS } from "@/lib/os/sugestoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva5_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

/** dias atrás, como instante */
const atras = (dias: number) => new Date(Date.now() - dias * 24 * 3600 * 1000);
const DENTRO = atras(30);
const FORA = atras(Math.round(JANELA_MESES * 30.5) + 20); // bem antes da janela

async function sugestoes(query: string) {
  const mod = await import("@/app/api/ordens/sugestoes/route");
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/ordens/sugestoes?${query}`));
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function salvarOs(id: string, corpo: unknown) {
  const mod = await import("@/app/api/ordens/[id]/route");
  const req = new NextRequest("http://localhost/api/ordens/x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const res: Response = await mod.PUT(req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva 5 — Operação (PostgreSQL real)", () => {
  let prisma: any;
  let seqOs = 0;

  /**
   * Cria uma OS do cliente com uma atividade por executor/tipo informado.
   * `atividades` descreve as atividades DA MESMA OS (para separar "OS distintas" de "atividades").
   */
  async function os(clienteId: string, atividades: { tipoOsId?: string | null; tecnicoId?: string | null; equipeId?: string | null; quando?: Date }[], extra: Record<string, unknown> = {}) {
    const id = `os${++seqOs}`;
    await prisma.ordemServico.create({
      data: { id, empresaId: "e1", numero: `OS-${1000 + seqOs}`, clienteId, unidadeId: clienteId === "c1" ? "u1" : "u2", criadoPorId: "uA", descricao: "Serviço", ...extra },
    });
    let i = 0;
    for (const a of atividades) {
      await prisma.atividadeOs.create({
        data: {
          id: `${id}a${++i}`, empresaId: "e1", ordemServicoId: id, titulo: "Atendimento",
          tipoOsId: a.tipoOsId ?? null, tecnicoId: a.tecnicoId ?? null, equipeId: a.equipeId ?? null,
          criadoEm: a.quando ?? DENTRO,
        },
      });
    }
    return id;
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/ordens/sugestoes/route"), import("@/app/api/ordens/[id]/route")]);

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" },
      { id: "c2", empresaId: "e1", nome: "Shopping Centro", cpfCnpj: "2" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "u2", empresaId: "e1", clienteId: "c2", nome: "Loja 1" },
    ] });
    await prisma.tipoOs.createMany({ data: [
      { id: "tp1", empresaId: "e1", nome: "Preventiva" },
      { id: "tp2", empresaId: "e1", nome: "Corretiva" },
      { id: "tpE2", empresaId: "e2", nome: "De outra empresa" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1" },
      { id: "t2", empresaId: "e1", nome: "Marcos Dias", cpf: "2", telefone: "2" },
      { id: "tOff", empresaId: "e1", nome: "Saiu da empresa", cpf: "3", telefone: "3", ativo: false },
    ] });
    await prisma.equipe.createMany({ data: [
      { id: "eq1", empresaId: "e1", nome: "Equipe Azul", cor: "#1d4ed8" },
      { id: "eqOff", empresaId: "e1", nome: "Equipe desfeita", cor: "#111111", status: "INATIVA" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    await prisma.atividadeOs.deleteMany({});
    await prisma.ordemServico.deleteMany({});
    seqOs = 0;
    como();
  });

  /* ───────── permissão ───────── */
  it("sem sessão: 401; sem Ordens › criar: 403 — e nada de histórico vaza na resposta", async () => {
    sessao.atual = null;
    expect(await sugestoes("clienteId=c1")).toMatchObject({ status: 401 });

    como(montarPermissoes({ ordens: ["visualizar", "editar"] }));
    const r = await sugestoes("clienteId=c1");
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).not.toMatch(/tipoOs|executor|janelaMeses/);
  });

  it("quem pode criar OS pede a sugestão; sem cliente é 400", async () => {
    como(montarPermissoes({ ordens: ["criar"] }));
    expect((await sugestoes("clienteId=c1")).status).toBe(200);
    expect(await sugestoes("")).toMatchObject({ status: 400, json: { erro: "Informe o cliente." } });
  });

  /* ───────── a janela e o mínimo ───────── */
  it("cliente sem histórico: responde a janela e nenhuma sugestão (a tela não mostra nada)", async () => {
    expect(await sugestoes("clienteId=c1")).toEqual({ status: 200, json: { janelaMeses: JANELA_MESES, tipoOs: null, executor: null } });
  });

  it(`histórico FINO (1 OS só) não sugere — o mínimo é ${MINIMO_OS} OS`, async () => {
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
    expect((await sugestoes("clienteId=c1")).json).toMatchObject({ tipoOs: null, executor: null });
  });

  it("com 2 OS iguais, sugere o tipo e quem executou, com o número de OS e o nome do cadastro", async () => {
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
    expect((await sugestoes("clienteId=c1")).json).toEqual({
      janelaMeses: JANELA_MESES,
      tipoOs: { id: "tp1", nome: "Preventiva", vezes: 2 },
      executor: { tipo: "tecnico", id: "t1", nome: "João Silva", vezes: 2 },
    });
  });

  it("o que está FORA da janela de 6 meses não conta", async () => {
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1", quando: FORA }]);
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1", quando: FORA }]);
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
    // só 1 OS dentro da janela → fino
    expect((await sugestoes("clienteId=c1")).json).toMatchObject({ tipoOs: null, executor: null });
  });

  it("OS CANCELADA não conta", async () => {
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }], { status: "CANCELADA" });
    expect((await sugestoes("clienteId=c1")).json).toMatchObject({ tipoOs: null, executor: null });
  });

  it("conta OS DISTINTAS: uma OS com 3 atividades do mesmo técnico continua sendo 1 atendimento", async () => {
    await os("c1", [
      { tipoOsId: "tp1", tecnicoId: "t1" }, { tipoOsId: "tp1", tecnicoId: "t1" }, { tipoOsId: "tp1", tecnicoId: "t1" },
    ]);
    expect((await sugestoes("clienteId=c1")).json).toMatchObject({ tipoOs: null, executor: null });
  });

  it("EMPATE no tipo não sugere tipo (mas o executor claro continua sugerido)", async () => {
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
    await os("c1", [{ tipoOsId: "tp2", tecnicoId: "t1" }]);
    await os("c1", [{ tipoOsId: "tp2", tecnicoId: "t1" }]);
    const j = (await sugestoes("clienteId=c1")).json;
    expect(j.tipoOs).toBeNull();
    expect(j.executor).toMatchObject({ tipo: "tecnico", id: "t1", vezes: 4 });
  });

  it("o executor é o ÚLTIMO (não o mais frequente), e a equipe vem como equipe", async () => {
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1", quando: atras(100) }]);
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1", quando: atras(90) }]);
    await os("c1", [{ tipoOsId: "tp1", equipeId: "eq1", tecnicoId: "t2", quando: atras(10) }]);
    await os("c1", [{ tipoOsId: "tp1", equipeId: "eq1", tecnicoId: "t2", quando: atras(5) }]);
    expect((await sugestoes("clienteId=c1")).json.executor).toEqual({ tipo: "equipe", id: "eq1", nome: "Equipe Azul", vezes: 2 });
  });

  it("cadastro INATIVADO depois não é sugerido (nem técnico desligado, nem equipe desfeita)", async () => {
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "tOff" }]);
    await os("c1", [{ tipoOsId: "tp1", tecnicoId: "tOff" }]);
    const j = (await sugestoes("clienteId=c1")).json;
    expect(j.executor).toBeNull();
    expect(j.tipoOs).toMatchObject({ id: "tp1" }); // o tipo segue valendo

    await prisma.atividadeOs.deleteMany({});
    await prisma.ordemServico.deleteMany({});
    seqOs = 0;
    await os("c1", [{ tipoOsId: "tp1", equipeId: "eqOff" }]);
    await os("c1", [{ tipoOsId: "tp1", equipeId: "eqOff" }]);
    expect((await sugestoes("clienteId=c1")).json.executor).toBeNull();
  });

  it("o histórico é SÓ do cliente pedido, e nada atravessa de outra empresa", async () => {
    await os("c2", [{ tipoOsId: "tp2", tecnicoId: "t2" }]);
    await os("c2", [{ tipoOsId: "tp2", tecnicoId: "t2" }]);
    expect((await sugestoes("clienteId=c1")).json).toMatchObject({ tipoOs: null, executor: null });
    expect((await sugestoes("clienteId=c2")).json.tipoOs).toMatchObject({ id: "tp2", vezes: 2 });

    // a mesma pergunta, feita pela outra empresa, não vê nada
    como(permissoesTotais(), "e2");
    expect((await sugestoes("clienteId=c2")).json).toMatchObject({ tipoOs: null, executor: null });
  });

  /* ───────── a gaveta "Editar OS" no servidor ───────── */
  describe("PUT /api/ordens/[id]: os campos da OS", () => {
    const CORPO = { prioridade: "ALTA", descricao: "Descrição nova do serviço", observacoes: "Obs nova" };

    it("OS aberta: salva os campos", async () => {
      const id = await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
      expect((await salvarOs(id, CORPO)).status).toBe(200);
      expect(await prisma.ordemServico.findUnique({ where: { id } })).toMatchObject({ prioridade: "ALTA", descricao: "Descrição nova do serviço", observacoes: "Obs nova" });
    });

    it("sem Ordens › editar: 403 e NADA muda no banco", async () => {
      const id = await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
      como(montarPermissoes({ ordens: ["visualizar", "criar"] }));
      expect((await salvarOs(id, CORPO)).status).toBe(403);
      expect(await prisma.ordemServico.findUnique({ where: { id } })).toMatchObject({ prioridade: "NORMAL", descricao: "Serviço" });
    });

    it("OS ASSINADA pelo cliente: 409 com o motivo, e nada muda", async () => {
      const id = await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }]);
      await prisma.osAceite.create({ data: { id: `ac-${id}`, empresaId: "e1", ordemServicoId: id, token: `tk-${id}`, situacao: "CONFIRMADO", metodo: "LOCAL", nome: "Cliente", assinatura: "x", confirmadoEm: new Date() } });
      const r = await salvarOs(id, CORPO);
      expect(r.status).toBe(409);
      expect(String(r.json?.erro)).toMatch(/assinada/i);
      expect(await prisma.ordemServico.findUnique({ where: { id } })).toMatchObject({ prioridade: "NORMAL", descricao: "Serviço", observacoes: null });
    });

    it("a OS fechada continua aceitando o que NÃO é campo travado (o status tem regra própria)", async () => {
      const id = await os("c1", [{ tipoOsId: "tp1", tecnicoId: "t1" }], { status: "EM_ANDAMENTO" });
      await prisma.osAceite.create({ data: { id: `ac2-${id}`, empresaId: "e1", ordemServicoId: id, token: `tk2-${id}`, situacao: "CONFIRMADO", metodo: "LOCAL", nome: "Cliente", assinatura: "x", confirmadoEm: new Date() } });
      // nenhum campo travado no corpo → a trava não entra em cena
      expect((await salvarOs(id, { status: "EM_ANDAMENTO" })).status).toBe(200);
    });
  });
});
