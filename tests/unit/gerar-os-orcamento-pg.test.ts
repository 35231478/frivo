/**
 * "Gerar OS" a partir do orçamento aprovado — rota real com o Prisma real num PostgreSQL real
 * (schema descartável via `prisma db push`):
 *  - cria a OS com cliente, endereço (unidade) e itens do orçamento (NÃO executados, mesmos valores),
 *    o vínculo nos dois sentidos (orcamentoOrigemId + orcamento_ordens_servico), a 1ª atividade com
 *    quem executa, o histórico da OS e o evento OS_GERADA no ciclo do orçamento;
 *  - sem duplicar: 2º clique devolve a mesma (jaExistia); cliques simultâneos geram UMA OS; orçamento
 *    já vinculado a uma OS (criado de dentro dela) devolve essa OS;
 *  - não aprovado / proposta de contrato → 409; outra empresa → 404; sem permissão de criar OS → 403;
 *    sem quem executa → 400 e nada criado;
 *  - "Nova OS" (POST /api/ordens) continua igual depois da extração para lib/os/abertura.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/gerar-os-orcamento-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_gerar_os_orc_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), id = "u1", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
/** Vê OS mas não cria. */
const soVerOs = () => {
  const p = permissoesVazias() as any;
  p.ordens = { ...p.ordens, visualizar: true };
  return p as Permissoes;
};
const EXEC = { tecnicoIds: ["t1"], responsavelId: "t1" };

async function gerar(orcamentoId: string, corpo: unknown = { execucao: EXEC }) {
  const mod = await import("@/app/api/orcamentos/[id]/gerar-os/route");
  const res = await mod.POST(new NextRequest(`http://localhost/api/orcamentos/${orcamentoId}/gerar-os`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  }), { params: Promise.resolve({ id: orcamentoId }) });
  return { status: res.status, json: await res.json() };
}
async function consultar(orcamentoId: string) {
  const mod = await import("@/app/api/orcamentos/[id]/gerar-os/route");
  const res = await mod.GET(new NextRequest(`http://localhost/api/orcamentos/${orcamentoId}/gerar-os`), { params: Promise.resolve({ id: orcamentoId }) });
  return { status: res.status, json: await res.json() };
}

describe.skipIf(!URL_PG)("Gerar OS a partir do orçamento aprovado (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;
  async function orcamento(dados: Record<string, unknown> = {}, itens = true) {
    n++;
    const id = `orc${n}`;
    await prisma.orcamento.create({
      data: {
        id, empresaId: "e1", codigo: `ORC-${String(n).padStart(4, "0")}`, nome: "Troca de compressor", clienteId: "c1", unidadeId: "un2",
        criadoPorId: "u1", status: "APROVADO", tokenPublico: `tk-${id}`, descricao: "Compressor do split da recepção.", totalGeral: 2130,
        ...dados,
        ...(itens ? {
          servicos: { create: [
            { descricao: "Mão de obra", quantidade: 1, valorUnitario: 600, valorTotal: 600, ordem: 1 },
            { descricao: "Diagnóstico", quantidade: 2, valorUnitario: 90, valorTotal: 180, ordem: 0 },
          ] },
          produtos: { create: [{ descricao: "Compressor 12k", quantidade: 1.5, valorUnitario: 900, valorTotal: 1350, ordem: 0 }] },
        } : {}),
      },
    });
    return id;
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/orcamentos/[id]/gerar-os/route"), import("@/app/api/ordens/route")]);
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
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "un2", empresaId: "e1", clienteId: "c1", nome: "Anexo — Bloco B" },
    ] });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("cria a OS com cliente, endereço e itens (não executados), vínculo nos dois sentidos, atividade, histórico e evento", async () => {
    const id = await orcamento();
    const r = await gerar(id, { execucao: { ...EXEC, dataAgendada: "2026-11-18T17:30:00.000Z" } });
    expect(r.status).toBe(201);
    expect(r.json.jaExistia).toBe(false);
    expect(r.json.os.numero).toMatch(/^OS-\d{4}-\d{4}$/);

    const os = await prisma.ordemServico.findUnique({
      where: { id: r.json.os.id },
      include: { itensOrcamento: { orderBy: { id: "asc" } }, atividades: { include: { tecnicosEquipe: true } }, historico: true, orcamentos: true },
    });
    expect(os).toMatchObject({ empresaId: "e1", clienteId: "c1", unidadeId: "un2", orcamentoOrigemId: id, responsavelId: "u1", criadoPorId: "u1" });
    expect(os.descricao).toBe("Troca de compressor (orçamento ORC-0001)\n\nCompressor do split da recepção.");
    // Serviços (na ordem do orçamento) e depois produtos; mesmos valores; nenhum executado
    expect(os.itensOrcamento.map((i: any) => [i.descricao, Number(i.quantidade), Number(i.valorUnitario), Number(i.valorTotal), i.executado])).toEqual([
      ["Diagnóstico", 2, 90, 180, false],
      ["Mão de obra", 1, 600, 600, false],
      ["Compressor 12k", 1.5, 900, 1350, false],
    ]);
    expect(os.orcamentos.map((v: any) => v.orcamentoId)).toEqual([id]);
    expect(os.atividades).toHaveLength(1);
    expect(os.atividades[0].tecnicoId).toBe("t1");
    expect(os.atividades[0].dataAgendada.toISOString()).toBe("2026-11-18T17:30:00.000Z");
    // A atividade agendada põe a OS em "Agendada", como na Nova OS
    expect(os.status).toBe("AGENDADA");
    expect(os.historico.some((h: any) => h.detalhes === `Ordem de serviço ${os.numero} gerada a partir do orçamento ORC-0001.`)).toBe(true);

    const evento = await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: id, tipo: "OS_GERADA" } });
    expect(evento).toMatchObject({ empresaId: "e1", detalhe: os.numero, usuarioId: "u1" });

    // O orçamento enxerga a OS que gerou
    const orc = await prisma.orcamento.findUnique({ where: { id }, include: { osGerada: true } });
    expect(orc.osGerada.id).toBe(os.id);
    expect((await consultar(id)).json.os).toEqual({ id: os.id, numero: os.numero, gerada: true });
    // Não mexe em faturamento: nenhuma medição nem conta a receber nasce daqui
    expect(await prisma.medicao.count()).toBe(0);
    expect(await prisma.contaReceber.count()).toBe(0);
  });

  it("segundo clique devolve a mesma OS (jaExistia) e não cria outra", async () => {
    const id = await orcamento();
    const a = await gerar(id);
    const b = await gerar(id);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json).toEqual({ os: a.json.os, jaExistia: true });
    expect(await prisma.ordemServico.count({ where: { orcamentoOrigemId: id } })).toBe(1);
    expect(await prisma.orcamentoOs.count({ where: { orcamentoId: id } })).toBe(1);
  });

  it("cliques simultâneos geram UMA OS só (o único do vínculo segura a corrida)", async () => {
    const id = await orcamento();
    const rs = await Promise.all(Array.from({ length: 5 }, () => gerar(id)));
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.json.os.id)).size).toBe(1);
    expect(await prisma.ordemServico.count({ where: { orcamentoOrigemId: id } })).toBe(1);
    expect(await prisma.orcamentoOs.count({ where: { orcamentoId: id } })).toBe(1);
    expect(await prisma.osItemOrcamento.count({ where: { ordemServico: { orcamentoOrigemId: id } } })).toBe(3);
  });

  it("já gerada: um clique de outra aba, mesmo sem quem executa, leva à OS existente (não dá 400)", async () => {
    const id = await orcamento();
    const a = await gerar(id);
    const b = await gerar(id, {});
    expect(b.status).toBe(200);
    expect(b.json).toEqual({ os: a.json.os, jaExistia: true });
  });

  it("servidor (gerarOsDoOrcamento) também nunca cria uma 2ª OS para orçamento já vinculado, mesmo chamado direto", async () => {
    const id = await orcamento();
    const existente = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: "OS-2026-9002", clienteId: "c1", descricao: "Corretiva", criadoPorId: "u1" } });
    await prisma.orcamentoOs.create({ data: { orcamentoId: id, ordemServicoId: existente.id } });
    const [{ gerarOsDoOrcamento }, { prepararExecucao }] = await Promise.all([import("@/lib/orcamentos/gerar-os-server"), import("@/lib/os/abertura")]);
    const prep = await prepararExecucao("e1", EXEC);
    if ("erro" in prep) throw new Error(prep.erro);
    const r = await gerarOsDoOrcamento({ empresaId: "e1", usuarioId: "u1", orcamentoId: id, execucao: prep.execucao });
    expect(r).toEqual({ tipo: "existente", os: { id: existente.id, numero: "OS-2026-9002" } });
    expect(await prisma.orcamentoOs.count({ where: { orcamentoId: id } })).toBe(1);
  });

  it("orçamento já vinculado a uma OS (criado de dentro dela) devolve essa OS, sem gerar outra", async () => {
    const id = await orcamento();
    const existente = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: "OS-2026-9001", clienteId: "c1", descricao: "Corretiva", criadoPorId: "u1" } });
    await prisma.orcamentoOs.create({ data: { orcamentoId: id, ordemServicoId: existente.id } });
    const r = await gerar(id);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ os: { id: existente.id, numero: "OS-2026-9001" }, jaExistia: true });
    expect(await prisma.ordemServico.count({ where: { orcamentoOrigemId: id } })).toBe(0);
    expect((await consultar(id)).json.os).toEqual({ id: existente.id, numero: "OS-2026-9001", gerada: false });
  });

  it("não aprovado ou proposta de contrato → 409 e nada criado", async () => {
    const antes = await prisma.ordemServico.count();
    for (const status of ["RASCUNHO", "ENVIADO", "REPROVADO", "CANCELADO", "CONVERTIDA"]) {
      const r = await gerar(await orcamento({ status }));
      expect(r.status).toBe(409);
      expect(r.json.erro).toBe("Disponível apenas para orçamento aprovado.");
    }
    const p = await gerar(await orcamento({ tipo: "PROPOSTA_CONTRATO" }));
    expect(p.status).toBe(409);
    expect(p.json.erro).toContain("Proposta de contrato");
    expect(await prisma.ordemServico.count()).toBe(antes);
  });

  it("isolamento: orçamento de outra empresa → 404; a outra empresa não enxerga a OS gerada aqui", async () => {
    const id = await orcamento();
    await gerar(id);
    const deOutra = `orcX${n}`;
    await prisma.orcamento.create({ data: { id: deOutra, empresaId: "e2", codigo: "ORC-X", nome: "X", clienteId: "cX", criadoPorId: "u2", status: "APROVADO", tokenPublico: "tk-x" } });
    const r = await gerar(deOutra);
    expect(r.status).toBe(404);
    expect(await prisma.ordemServico.count({ where: { orcamentoOrigemId: deOutra } })).toBe(0);
    logar(permissoesTotais(), "u2", "e2");
    try {
      expect((await consultar(id)).json.os).toBeNull();
      // Mesmo pedindo, a outra empresa não cria nem descobre a OS do orçamento alheio
      const g = await gerar(id, { execucao: {} });
      expect(g.status).not.toBe(200);
      expect(g.json.os).toBeUndefined();
    } finally { logar(); }
  });

  it("RBAC: sem criar OS → 403 (consultar segue com visualizar); sem sessão → 401", async () => {
    const id = await orcamento();
    logar(soVerOs());
    try {
      expect((await gerar(id)).status).toBe(403);
      expect((await consultar(id)).status).toBe(200);
      logar(permissoesVazias());
      expect((await consultar(id)).status).toBe(403);
      sessao.atual = null;
      expect((await gerar(id)).status).toBe(401);
    } finally { logar(); }
    expect(await prisma.ordemServico.count({ where: { orcamentoOrigemId: id } })).toBe(0);
  });

  it("sem quem executa → 400 e nada criado", async () => {
    const id = await orcamento();
    for (const corpo of [{}, { execucao: {} }, { execucao: { tecnicoIds: [] } }]) {
      const r = await gerar(id, corpo);
      expect(r.status).toBe(400);
      expect(r.json.erro).toBeTruthy();
    }
    expect(await prisma.ordemServico.count({ where: { orcamentoOrigemId: id } })).toBe(0);
  });

  it("orçamento sem itens gera a OS sem itens; sem data, a atividade nasce sem agenda", async () => {
    const id = await orcamento({ descricao: null }, false);
    const r = await gerar(id);
    expect(r.status).toBe(201);
    const os = await prisma.ordemServico.findUnique({ where: { id: r.json.os.id }, include: { itensOrcamento: true, atividades: true } });
    expect(os.itensOrcamento).toEqual([]);
    expect(os.descricao).toMatch(/^Troca de compressor \(orçamento ORC-\d{4}\)$/);
    expect(os.atividades[0].dataAgendada).toBeNull();
  });

  it("Nova OS (POST /api/ordens) segue igual: numera em sequência com as OS geradas e exige quem executa", async () => {
    const mod = await import("@/app/api/ordens/route");
    const criar = async (corpo: unknown) => {
      const res = await mod.POST(new NextRequest("http://localhost/api/ordens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
      return { status: res.status, json: await res.json() };
    };
    const ultima = await prisma.ordemServico.findFirst({ where: { empresaId: "e1", numero: { startsWith: `OS-${new Date().getFullYear()}-` } }, orderBy: { numero: "desc" } });
    const r = await criar({ clienteId: "c1", descricao: "Visita", prioridade: "NORMAL", execucao: { ...EXEC, titulo: "Visita técnica" } });
    expect(r.status).toBe(201);
    const os = await prisma.ordemServico.findUnique({ where: { id: r.json.id }, include: { atividades: true } });
    expect(Number(os.numero.split("-")[2])).toBe(Number(ultima.numero.split("-")[2]) + 1);
    expect(os.orcamentoOrigemId).toBeNull();
    expect(os.atividades[0]).toMatchObject({ titulo: "Visita técnica", tecnicoId: "t1" });
    expect((await criar({ clienteId: "c1", descricao: "Visita", prioridade: "NORMAL" })).status).toBe(400);
  });
});
