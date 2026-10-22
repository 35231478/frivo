/**
 * Leva 4 — Faturamento da OS. Rotas reais, Prisma real, PostgreSQL real (schema descartável).
 * Prova (decisões do dono em 22/10):
 *  - F2: OS de CONTRATO não cobra a mensalidade pelo botão da OS (3 preventivas no mês viravam
 *    3 mensalidades) — a mensalidade é só do faturamento mensal do contrato (gerar-mes);
 *  - F1/C7: trava ÚNICA osJaFaturada — repetir o botão não duplica, e um caminho enxerga o outro;
 *    qualquer faturamento exige OS CONCLUÍDA;
 *  - o que fatura são os itens EXECUTADOS + adicionais marcados "Cobrar" com preço (D4 🔵);
 *  - F4: medição CANCELADA solta a OS e o orçamento — dá para refaturar;
 *  - F3/I25: relatório COMUM aprovado não gera medição nenhuma; medição de relatório sem contrato
 *    e medição manual nascem ADICIONAL — nada disso cala o gerar-mes da mensalidade;
 *  - D2: a medição interna da OS (OsMedicao) saiu — inativação só olha a medição oficial;
 *  - SQL 2026-10-22_adicional_valor.sql idempotente (roda 2×).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva4-faturamento
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva4_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Leva 4 — faturamento da OS (PostgreSQL real)", () => {
  let prisma: any;
  let seqOs = 0;

  const novaOs = async (dados: Record<string, unknown> = {}) =>
    prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: `OS-2026-9${String(++seqOs).padStart(3, "0")}`, clienteId: "c1",
      criadoPorId: "uA", status: "CONCLUIDA", origem: "MANUAL", descricao: "Serviço avulso",
      dataConclusao: new Date(), ...dados,
    } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11" } });
    await prisma.contrato.create({ data: {
      id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-2026-001", tipo: "MANUTENCAO_PREVENTIVA",
      status: "ATIVO", valorMensal: 1000, dataInicio: new Date("2026-01-01"),
    } });
    comoAdmin();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  // ═══════════ F2 — mensalidade NUNCA sai pelo botão da OS ═══════════

  it("F2: OS CONCLUÍDA de contrato → gerar-medicao-completa recusa (409) e NÃO cria medição nem conta", async () => {
    const os = await novaOs({ contratoId: "ct1" });
    const r = await chamar("ordens/[id]/gerar-medicao-completa", "POST", { id: os.id });
    expect(r.status).toBe(409);
    expect(r.json.erro).toContain("faturamento mensal do contrato");
    expect(await prisma.medicao.count({ where: { empresaId: "e1" } })).toBe(0);
    expect(await prisma.relatorioOs.count({ where: { ordemServicoId: os.id } })).toBe(0);
  });

  it("F1: OS não concluída não fatura por NENHUM caminho (400)", async () => {
    const os = await novaOs({ status: "EM_ANDAMENTO", dataConclusao: null });
    expect((await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id })).status).toBe(400);
    expect((await chamar("ordens/[id]/gerar-medicao-completa", "POST", { id: os.id })).status).toBe(400);
  });

  // ═══════════ Itens executados + adicionais "Cobrar" com preço (D1/D4) ═══════════

  it("fatura SÓ itens executados + adicionais COBRAR com preço; repetir devolve a MESMA medição (F1/C7); cancelada refatura (F4)", async () => {
    const os = await novaOs();
    await prisma.osItemOrcamento.createMany({ data: [
      { ordemServicoId: os.id, descricao: "Troca do compressor", quantidade: 1, valorUnitario: 800, valorTotal: 800, executado: true },
      { ordemServicoId: os.id, descricao: "Item orçado e NÃO executado", quantidade: 1, valorUnitario: 500, valorTotal: 500, executado: false },
    ] });
    const atv = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Visita", status: "CONCLUIDA" } });
    await prisma.servicoAdicional.createMany({ data: [
      { empresaId: "e1", ordemServicoId: os.id, atividadeId: atv.id, descricao: "Higienização extra", statusCobranca: "COBRAR", valor: 150 },
      { empresaId: "e1", ordemServicoId: os.id, atividadeId: atv.id, descricao: "Cobrar sem preço (não entra)", statusCobranca: "COBRAR" },
      { empresaId: "e1", ordemServicoId: os.id, atividadeId: atv.id, descricao: "Cortesia", statusCobranca: "NAO_COBRAR", valor: 999 },
    ] });

    const r1 = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    expect(r1.status).toBe(201);
    const medicao = await prisma.medicao.findUnique({ where: { id: r1.json.id }, include: { itens: true } });
    expect(medicao.tipo).toBe("ADICIONAL");
    expect(Number(medicao.valorTotal)).toBe(950); // 800 executado + 150 adicional
    expect(medicao.itens).toHaveLength(2);
    expect(medicao.itens.map((i: any) => i.descricao).join("|")).not.toContain("NÃO executado");

    // Trava única: repetir não duplica; o OUTRO caminho também enxerga
    const r2 = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    expect(r2.json).toMatchObject({ id: r1.json.id, jaExistia: true });
    const r3 = await chamar("ordens/[id]/gerar-medicao-completa", "POST", { id: os.id });
    expect(r3.status).toBe(409);
    expect(await prisma.medicao.count({ where: { empresaId: "e1" } })).toBe(1);

    // F4: cancelou a medição → a OS volta a poder ser faturada (medição NOVA)
    await prisma.medicao.update({ where: { id: r1.json.id }, data: { status: "CANCELADA" } });
    const r4 = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    expect(r4.status).toBe(201);
    expect(r4.json.id).not.toBe(r1.json.id);
    await prisma.medicao.update({ where: { id: r4.json.id }, data: { status: "CANCELADA" } });
  });

  it("sem nada a faturar (nenhum item executado, nenhum adicional com preço) → 400", async () => {
    const os = await novaOs();
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Só orçado", quantidade: 1, valorUnitario: 100, valorTotal: 100, executado: false } });
    const r = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    expect(r.status).toBe(400);
    expect(r.json.erro).toContain("Nada a faturar");
  });

  it("gerar-medicao-completa sem contrato: valor = itens EXECUTADOS; cancelada reaproveita o relatório (F4)", async () => {
    const os = await novaOs();
    await prisma.osItemOrcamento.createMany({ data: [
      { ordemServicoId: os.id, descricao: "Instalação", quantidade: 1, valorUnitario: 1200, valorTotal: 1200, executado: true },
      { ordemServicoId: os.id, descricao: "Opcional não feito", quantidade: 1, valorUnitario: 700, valorTotal: 700, executado: false },
    ] });
    const r1 = await chamar("ordens/[id]/gerar-medicao-completa", "POST", { id: os.id });
    expect(r1.status).toBe(201);
    const rel = await prisma.relatorioOs.findFirst({ where: { ordemServicoId: os.id }, include: { medicao: true } });
    expect(Number(rel.valorFinanceiro)).toBe(1200); // só o executado
    expect(rel.medicao.tipo).toBe("ADICIONAL");     // sem contrato não é mensalidade

    const r2 = await chamar("ordens/[id]/gerar-medicao-completa", "POST", { id: os.id });
    expect(r2.json.jaExistia).toBe(true);

    await prisma.medicao.update({ where: { id: rel.medicaoId }, data: { status: "CANCELADA" } });
    const r3 = await chamar("ordens/[id]/gerar-medicao-completa", "POST", { id: os.id });
    expect(r3.status).toBe(201);
    expect(r3.json.jaExistia).toBe(false);
    // Reaproveitou o MESMO relatório (não criou um segundo documento)
    expect(await prisma.relatorioOs.count({ where: { ordemServicoId: os.id } })).toBe(1);
    const relNovo = await prisma.relatorioOs.findFirst({ where: { ordemServicoId: os.id }, include: { medicao: true } });
    expect(relNovo.medicao.status).not.toBe("CANCELADA");
    await prisma.medicao.update({ where: { id: relNovo.medicaoId }, data: { status: "CANCELADA" } });
  });

  // ═══════════ F3/I25 — nada mais cala a mensalidade do gerar-mes ═══════════

  it("F3: relatório COMUM aprovado não gera medição; a mensalidade do contrato continua saindo no gerar-mes", async () => {
    await prisma.medicao.deleteMany({ where: { empresaId: "e1" } });
    const os = await novaOs({ contratoId: "ct1" });
    const rel = await prisma.relatorioOs.create({ data: {
      empresaId: "e1", ordemServicoId: os.id, numero: "REL-2026-0100", tipo: "MEDICAO", escopo: "GERAL",
      mesReferencia: 10, anoReferencia: 2026, valorFinanceiro: 0, status: "RASCUNHO", tokenPublico: crypto.randomUUID(),
    } });
    const aprova = await chamar("publico/relatorios/[token]/aprovar", "POST", { token: rel.tokenPublico },
      { nome: "Cliente Aprovador", cpf: "390.533.447-05", assinaturaUrl: "data:image/png;base64,iVBORw0KGgo=" });
    expect(aprova.status).toBe(200);
    expect(await prisma.medicao.count({ where: { empresaId: "e1" } })).toBe(0); // NÃO criou a medição de R$ 0

    // Medição manual sem tipo explícito nasce ADICIONAL (I25) e também não cala o gerar-mes
    const manual = await chamar("medicoes", "POST", {}, {
      clienteId: "c1", mes: 10, ano: 2026, descricao: "Serviço avulso digitado",
      itens: [{ descricao: "Chamado extra", quantidade: 1, valorUnitario: 300, valorTotal: 300 }],
    });
    expect([200, 201]).toContain(manual.status);
    const criadaManual = await prisma.medicao.findFirst({ where: { empresaId: "e1" }, orderBy: { criadoEm: "desc" } });
    expect(criadaManual.tipo).toBe("ADICIONAL");

    // Mesmo com o relatório aprovado e a medição manual, a MENSALIDADE do mês sai
    const gm = await chamar("medicoes/gerar-mes", "POST", {}, { mes: 10, ano: 2026 });
    expect(gm.status).toBe(200);
    const mensal = await prisma.medicao.findFirst({ where: { empresaId: "e1", tipo: "MENSAL_FIXO", mes: 10, ano: 2026 } });
    expect(mensal).not.toBeNull();
    expect(Number(mensal.valorTotal)).toBe(1000);
  });

  // ═══════════ D4 — rota do adicional exige preço ao Cobrar ═══════════

  it("D4: marcar COBRAR sem preço é 400; com preço grava e devolve o valor", async () => {
    const os = await novaOs();
    const atv = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Visita", status: "CONCLUIDA" } });
    const ad = await prisma.servicoAdicional.create({ data: { empresaId: "e1", ordemServicoId: os.id, atividadeId: atv.id, descricao: "Carga de gás" } });

    const semPreco = await chamar("ordens/[id]/servicos-adicionais/[servicoId]", "PATCH", { id: os.id, servicoId: ad.id }, { statusCobranca: "COBRAR" });
    expect(semPreco.status).toBe(400);
    expect(semPreco.json.erro).toContain("preço");

    const comPreco = await chamar("ordens/[id]/servicos-adicionais/[servicoId]", "PATCH", { id: os.id, servicoId: ad.id }, { statusCobranca: "COBRAR", valor: 250 });
    expect(comPreco.status).toBe(200);
    expect(comPreco.json.valor).toBe(250);
    expect(Number((await prisma.servicoAdicional.findUnique({ where: { id: ad.id } })).valor)).toBe(250);
  });

  // ═══════════ D2 — OsMedicao fora; inativação olha só a medição oficial ═══════════

  it("D2: a inativação da OS bloqueia por medição OFICIAL viva e libera quando ela é cancelada", async () => {
    const { motivoBloqueioInativacao } = await import("@/lib/os-server");
    const os = await novaOs();
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Item", quantidade: 1, valorUnitario: 100, valorTotal: 100, executado: true } });
    const r = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    expect(await motivoBloqueioInativacao(os.id)).toContain("medição");
    await prisma.medicao.update({ where: { id: r.json.id }, data: { status: "CANCELADA" } });
    expect(await motivoBloqueioInativacao(os.id)).toBeNull();
  });

  // ═══════════ SQL 🔵 idempotente ═══════════

  it("SQL da leva roda 2× sem erro e cria a coluna valor num banco 'de produção' (sem a coluna)", () => {
    const URL = process.env.PG_TESTE_URL!;
    const PROD = `${SCHEMA}_prod`;
    const psql = (args: string[], schema = PROD) => execFileSync("psql", [URL, "-v", "ON_ERROR_STOP=1", "-q", ...args], {
      env: { ...process.env, PGOPTIONS: `--search_path=${schema}` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    // Banco "de produção": a tabela existe SEM a coluna valor (como está lá hoje)
    psql(["-c", `DROP SCHEMA IF EXISTS "${PROD}" CASCADE; CREATE SCHEMA "${PROD}";`], "public");
    psql(["-c", `CREATE TABLE "${PROD}"."servicos_adicionais" (id TEXT PRIMARY KEY, descricao TEXT NOT NULL)`]);

    const rodar = () => psql(["-f", path.join(RAIZ, "prisma/sql/2026-10-22_adicional_valor.sql")]);
    rodar();
    rodar(); // idempotente
    const tipo = execFileSync("psql", [URL, "-At", "-c",
      `SELECT data_type FROM information_schema.columns WHERE table_schema = '${PROD}' AND table_name = 'servicos_adicionais' AND column_name = 'valor'`,
    ], { encoding: "utf8" }).trim();
    expect(tipo).toBe("numeric");
    psql(["-c", `DROP SCHEMA IF EXISTS "${PROD}" CASCADE`], "public");
  });
});
