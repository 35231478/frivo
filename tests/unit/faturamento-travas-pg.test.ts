/**
 * Faturamento — travas contra cobrança em dobro (C6/C7) e retenções. Rotas reais, Prisma real,
 * PostgreSQL real (schema descartável via `prisma db push` + o SQL de produção desta leva).
 * Prova:
 *  - (b) "Aprovar" a mesma medição 5× ao mesmo tempo → 1 aprovação, 1 conta; gerar a conta 5× → a mesma;
 *    o índice único do banco recusa a 2ª conta avulsa viva da medição;
 *  - (a) "Gerar medição" 5× ao mesmo tempo → 1 medição; medição manual com OS/orçamento já faturado = 409
 *    (de outra empresa = 400); relatório de OS já faturada não gera 2ª medição;
 *  - (c) a previsão do orçamento VIRA a cobrança da medição da OS gerada dele (mesma conta, valor da
 *    medição) — cancelar a medição devolve a previsão; orçamento cuja OS já foi faturada não ganha
 *    previsão nem entra na fatura única; fatura única absorve a previsão do orçamento que ela cobra;
 *    medição com dois orçamentos: uma conta só;
 *  - retenções: conta = valor da nota − retenções marcadas, com evento; recusas (alíquota, boleto,
 *    paga, várias contas, outra empresa, sem permissão); edição em rascunho recalcula; gaveta mostra.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/faturamento-travas-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_fat_travas_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}
const acao = (id: string, a: string, extra: Record<string, unknown> = {}) => chamar("medicoes/[id]/acao", "POST", { id }, { acao: a, ...extra });

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Faturamento — travas C6/C7 e retenções (PostgreSQL real)", () => {
  let prisma: any;
  let fin: typeof import("@/lib/financeiro-server");
  let n = 0;
  const seq = () => String(++n).padStart(4, "0");

  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: {
    empresaId: "e1", numero: `OS-2026-${seq()}`, clienteId: "c1", criadoPorId: "uA", status: "CONCLUIDA", origem: "MANUAL",
    descricao: "Serviço", dataConclusao: new Date(), ...dados,
  } });
  const osComItem = async (valor: number, dados: Record<string, unknown> = {}) => {
    const os = await novaOs(dados);
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Limpeza", quantidade: 1, valorUnitario: valor, valorTotal: valor, executado: true } });
    return os;
  };
  const novoOrcamento = (total: number, dados: Record<string, unknown> = {}) => prisma.orcamento.create({ data: {
    empresaId: "e1", codigo: `ORC-2026-${seq()}`, nome: "Manutenção", clienteId: "c1", criadoPorId: "uA", status: "APROVADO",
    totalGeral: total, totalServicos: total, tokenPublico: `tok-${n}-${Math.random()}`, ...dados,
  } });
  const novaMedicao = (valor: number, dados: Record<string, unknown> = {}) => prisma.medicao.create({ data: {
    empresaId: "e1", clienteId: "c1", numero: `MED-2026-${seq()}`, tipo: "ADICIONAL", status: "AGUARDANDO_APROVACAO",
    valorTotal: valor, valorLiquido: valor, tokenPublico: `tm-${n}-${Math.random()}`,
    itens: { create: [{ tipo: "SERVICO", descricao: "Serviço", quantidade: 1, valorUnitario: valor, valorTotal: valor }] }, ...dados,
  } });
  const vivas = (where: Record<string, unknown>) => prisma.contaReceber.findMany({ where: { ...where, status: { not: "CANCELADO" } }, orderBy: { criadoEm: "asc" } });
  const eventos = async (id: string) => (await prisma.contaReceberEvento.findMany({ where: { contaReceberId: id }, orderBy: { criadoEm: "asc" } })).map((e: any) => [e.tipo, e.detalhe]);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    // Os índices únicos parciais só existem no SQL de produção (o Prisma não descreve índice com WHERE)
    execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql/2026-11-14_faturamento_travas_retencoes.sql")], {
      env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    fin = await import("@/lib/financeiro-server");
    await Promise.all(["medicoes/[id]/acao", "medicoes/[id]/retencoes", "medicoes/[id]", "medicoes", "medicoes/gerar-mes", "ordens/[id]/gerar-medicao", "contas-receber/[id]"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11222333000181" },
      { id: "cFU", empresaId: "e1", nome: "Rede Fatura Única", cpfCnpj: "11222333000262", tipoFaturamento: "FATURA_UNICA", agrupaAdicionais: true },
      { id: "cX", empresaId: "e2", nome: "Da outra", cpfCnpj: "11222333000343" },
    ] });
    logar();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  // ═══════════ (b) a mesma medição não gera duas contas ═══════════

  it("(b) 'Aprovar' 5× ao mesmo tempo: 1 aprovação, 4 recusas (409) e UMA conta; gerar a conta 5× devolve a mesma", async () => {
    const m = await novaMedicao(1000);
    const r = await Promise.all(Array.from({ length: 5 }, () => acao(m.id, "APROVAR_MANUAL")));
    // 1 aprova; os outros param na conferência de status (400) ou na troca atômica (409)
    expect(r.filter((x) => x.status === 200)).toHaveLength(1);
    expect(r.every((x) => [200, 400, 409].includes(x.status))).toBe(true);
    const contas = await vivas({ medicaoId: m.id });
    expect(contas).toHaveLength(1);
    expect(Number(contas[0].valor)).toBe(1000);

    const outra = await novaMedicao(500, { status: "PC_RECEBIDO" });
    const ids = await Promise.all(Array.from({ length: 5 }, () => fin.gerarContaReceberDaMedicao(outra.id)));
    expect(new Set(ids.map((c: any) => c.id)).size).toBe(1);
    expect(await vivas({ medicaoId: outra.id })).toHaveLength(1);
  });

  it("(b) o banco recusa a 2ª conta avulsa viva da medição (índice único); de contrato e cancelada passam", async () => {
    const m = await novaMedicao(300, { status: "PC_RECEBIDO" });
    await fin.gerarContaReceberDaMedicao(m.id);
    const base = { empresaId: "e1", clienteId: "c1", medicaoId: m.id, descricao: "x", valor: 1, status: "PREVISTO" };
    await expect(prisma.contaReceber.create({ data: { ...base, numero: `DUP-${seq()}` } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.contaReceber.create({ data: { ...base, numero: `CAN-${seq()}`, status: "CANCELADO" } })).resolves.toBeTruthy();
  });

  // ═══════════ (a) a mesma OS não entra em duas medições ═══════════

  it("(a) 'Gerar medição' 5× ao mesmo tempo → UMA medição (as outras devolvem a mesma, sem erro 500)", async () => {
    const os = await osComItem(400);
    const r = await Promise.all(Array.from({ length: 5 }, () => chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id })));
    expect(r.map((x) => x.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(r.map((x) => x.json.id)).size).toBe(1);
    expect(await prisma.medicao.count({ where: { itens: { some: { ordemServicoId: os.id } } } })).toBe(1);
  });

  it("(a) medição manual com OS ou orçamento já faturado = 409; OS/orçamento de outra empresa = 400; cancelada libera", async () => {
    const os = await osComItem(250);
    const g = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    const manual = (item: Record<string, unknown>) => chamar("medicoes", "POST", {}, {
      clienteId: "c1", tipo: "ADICIONAL", descontoValor: 0, descontoPercent: 0, itens: [{ descricao: "Refaturar", quantidade: 1, valorUnitario: 250, ...item }],
    });
    const r = await manual({ ordemServicoId: os.id });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/já está faturado na medição MED-2026-\d{4}/);

    const orc = await novoOrcamento(90);
    await manual({ orcamentoId: orc.id }).then((x) => expect(x.status).toBe(201));
    expect((await manual({ orcamentoId: orc.id })).status).toBe(409);

    const osX = await prisma.ordemServico.create({ data: { empresaId: "e2", numero: `OS-X-${seq()}`, clienteId: "cX", criadoPorId: "uB", status: "CONCLUIDA", origem: "MANUAL", descricao: "x" } });
    expect((await manual({ ordemServicoId: osX.id })).status).toBe(400);

    await acao(g.json.id, "CANCELAR");
    expect((await manual({ ordemServicoId: os.id })).status).toBe(201);
  });

  it("(a) editar a medição em rascunho mantendo a própria OS passa; trazer OS já faturada em outra = 409", async () => {
    const os = await osComItem(80);
    const corpo = (osId: string, valor: number) => ({
      clienteId: "c1", tipo: "ADICIONAL", descontoValor: 0, descontoPercent: 0, itens: [{ descricao: "Item", quantidade: 1, valorUnitario: valor, ordemServicoId: osId }],
    });
    const r = await chamar("medicoes", "POST", {}, corpo(os.id, 80));
    expect(r.status).toBe(201);
    expect((await chamar("medicoes/[id]", "PUT", { id: r.json.id }, corpo(os.id, 90))).status).toBe(200);
    const outra = await osComItem(60);
    await chamar("ordens/[id]/gerar-medicao", "POST", { id: outra.id });
    expect((await chamar("medicoes/[id]", "PUT", { id: r.json.id }, corpo(outra.id, 60))).status).toBe(409);
  });

  it("(a) relatório MEDICAO_COMPLETA de OS já faturada pelo botão não gera 2ª medição", async () => {
    const os = await osComItem(700);
    await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    const rel = await prisma.relatorioOs.create({ data: {
      empresaId: "e1", ordemServicoId: os.id, numero: `REL-${seq()}`, tipo: "MEDICAO", escopo: "MEDICAO_COMPLETA",
      mesReferencia: 11, anoReferencia: 2026, valorFinanceiro: 700, status: "APROVADO", tokenPublico: `tr-${n}`,
    } });
    const antes = await prisma.medicao.count();
    expect(await fin.criarMedicaoDeRelatorio(rel.id)).toBeNull();
    expect(await prisma.medicao.count()).toBe(antes);
    expect((await prisma.relatorioOs.findUnique({ where: { id: rel.id } })).medicaoId).toBeNull();
  });

  // ═══════════ (c) orçamento × medição da OS: o mesmo serviço uma vez só ═══════════

  it("(c) a previsão do orçamento VIRA a cobrança da medição da OS gerada dele; cancelar a medição devolve a previsão", async () => {
    const orc = await novoOrcamento(708.5);
    const prev = (await fin.gerarContaReceberDoOrcamento(orc.id))!;
    expect(prev).toMatchObject({ status: "PREVISTO", orcamentoId: orc.id });
    const os = await osComItem(708.5, { orcamentoOrigemId: orc.id });
    // Na execução apareceu mais um item: a medição cobra 808,50 (não 708,50 + 808,50)
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Dreno", quantidade: 1, valorUnitario: 100, valorTotal: 100, executado: true } });

    const g = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    await acao(g.json.id, "ENVIAR");
    expect((await acao(g.json.id, "APROVAR_MANUAL")).status).toBe(200);

    const doOrc = await vivas({ orcamentoId: orc.id });
    expect(doOrc).toHaveLength(1);
    expect(doOrc[0].id).toBe(prev.id); // a MESMA conta
    expect(doOrc[0].medicaoId).toBe(g.json.id);
    expect(Number(doOrc[0].valor)).toBe(808.5);
    expect(await vivas({ medicaoId: g.json.id })).toHaveLength(1);
    expect((await eventos(prev.id))[0][0]).toBe("FATURADA");
    expect((await eventos(prev.id))[0][1]).toMatch(/^Previsão do orçamento virou a cobrança da medição MED-2026-\d{4} \(R\$\s?708,50 → R\$\s?808,50\)\.$/);

    expect((await acao(g.json.id, "CANCELAR")).status).toBe(200);
    const volta = await prisma.contaReceber.findUnique({ where: { id: prev.id } });
    expect({ status: volta.status, medicaoId: volta.medicaoId, valor: Number(volta.valor) }).toEqual({ status: "PREVISTO", medicaoId: null, valor: 708.5 });
    expect((await eventos(prev.id)).at(-1)).toEqual(["REABERTA", expect.stringMatching(/cancelada: volta a ser a previsão do orçamento\.$/)]);
    // E pode refaturar
    expect((await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id })).status).toBe(201);
  });

  it("(c) orçamento cuja OS gerada já foi faturada: aprovar não cria previsão (a cobrança é a da medição)", async () => {
    const orc = await novoOrcamento(320);
    const os = await osComItem(320, { orcamentoOrigemId: orc.id });
    await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    expect(await fin.gerarContaReceberDoOrcamento(orc.id)).toBeNull();
    expect(await vivas({ orcamentoId: orc.id })).toHaveLength(0);
    // E a OS do orçamento faturado direto (fatura única/medição manual) também não fatura de novo
    const orc2 = await novoOrcamento(150);
    const os2 = await osComItem(150, { orcamentoOrigemId: orc2.id });
    await chamar("medicoes", "POST", {}, { clienteId: "c1", tipo: "ADICIONAL", descontoValor: 0, descontoPercent: 0, itens: [{ descricao: "Orç", quantidade: 1, valorUnitario: 150, orcamentoId: orc2.id }] });
    const r = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os2.id });
    expect(r.json.jaExistia).toBe(true);
  });

  it("(c) fatura única: absorve a previsão do orçamento que ela cobra e pula o orçamento cuja OS já foi faturada; cancelar devolve tudo", async () => {
    await prisma.contrato.create({ data: {
      id: "ctFU", empresaId: "e1", clienteId: "cFU", numero: "CT-FU", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 1000, dataInicio: new Date("2026-01-01"),
    } });
    await fin.gerarPrevisaoContratoContasReceber("ctFU");
    const oA = await novoOrcamento(300, { clienteId: "cFU" });
    const prevA = (await fin.gerarContaReceberDoOrcamento(oA.id))!;
    const oB = await novoOrcamento(200, { clienteId: "cFU" });
    const osB = await osComItem(200, { clienteId: "cFU", orcamentoOrigemId: oB.id });
    await chamar("ordens/[id]/gerar-medicao", "POST", { id: osB.id });

    const agora = new Date();
    const mes = Number(new Intl.DateTimeFormat("en", { month: "numeric", timeZone: "America/Sao_Paulo" }).format(agora));
    const ano = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "America/Sao_Paulo" }).format(agora));
    const g = await chamar("medicoes/gerar-mes", "POST", {}, { mes, ano });
    expect(g.json.criadas).toBe(1);
    const fu = await prisma.medicao.findFirst({ where: { clienteId: "cFU", tipo: "FATURA_UNICA" }, include: { itens: true } });
    expect(fu.itens.map((i: any) => i.orcamentoId).filter(Boolean)).toEqual([oA.id]); // oB ficou de fora

    await acao(fu.id, "ENVIAR");
    expect((await acao(fu.id, "APROVAR_MANUAL")).status).toBe(200);
    const cobrancas = await vivas({ clienteId: "cFU", medicaoId: fu.id });
    expect(cobrancas).toHaveLength(1);
    expect(Number(cobrancas[0].valor)).toBe(1300);
    const a = await prisma.contaReceber.findUnique({ where: { id: prevA.id } });
    expect({ status: a.status, motivo: a.motivoCancelamento }).toEqual({ status: "CANCELADO", motivo: `Faturada na medição ${fu.numero}` });

    await acao(fu.id, "CANCELAR");
    expect((await prisma.contaReceber.findUnique({ where: { id: prevA.id } })).status).toBe("PREVISTO");
    const ct = await prisma.contaReceber.findUnique({ where: { id: cobrancas[0].id } });
    expect({ status: ct.status, medicaoId: ct.medicaoId, valor: Number(ct.valor) }).toEqual({ status: "PREVISTO", medicaoId: null, valor: 1000 });
  });

  it("(c) medição com dois orçamentos: a 1ª previsão vira a cobrança, a 2ª é absorvida — uma conta só", async () => {
    const oC = await novoOrcamento(100);
    const oD = await novoOrcamento(50);
    const pC = (await fin.gerarContaReceberDoOrcamento(oC.id))!;
    const pD = (await fin.gerarContaReceberDoOrcamento(oD.id))!;
    const r = await chamar("medicoes", "POST", {}, { clienteId: "c1", tipo: "ADICIONAL", descontoValor: 0, descontoPercent: 0, itens: [
      { descricao: "C", quantidade: 1, valorUnitario: 100, orcamentoId: oC.id }, { descricao: "D", quantidade: 1, valorUnitario: 50, orcamentoId: oD.id },
    ] });
    await acao(r.json.id, "ENVIAR");
    await acao(r.json.id, "APROVAR_MANUAL");
    const vivasM = await vivas({ medicaoId: r.json.id });
    expect(vivasM.map((c: any) => [c.id, Number(c.valor)])).toEqual([[pC.id, 150]]);
    expect((await prisma.contaReceber.findUnique({ where: { id: pD.id } })).status).toBe("CANCELADO");
    expect((await eventos(pD.id)).at(-1)).toEqual(["CANCELADA", `Cobrada na conta ${pC.numero} (medição ${r.json.numero}).`]);
  });

  // ═══════════ Retenções ═══════════

  it("retenções: conta = valor da nota − retenções marcadas, com evento; desmarcar volta; a gaveta mostra o detalhamento", async () => {
    const m = await novaMedicao(1000);
    await acao(m.id, "APROVAR_MANUAL");
    const [conta] = await vivas({ medicaoId: m.id });

    const r = await chamar("medicoes/[id]/retencoes", "PUT", { id: m.id }, { iss: 5, ir: 1.5 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ bruto: 1000, total: 65, liquido: 935, contaReceber: { id: conta.id, valor: 935 } });
    expect(Number((await prisma.contaReceber.findUnique({ where: { id: conta.id } })).valor)).toBe(935);
    const med = await prisma.medicao.findUnique({ where: { id: m.id } });
    expect([Number(med.retIssAliquota), Number(med.retIrAliquota), med.retPisAliquota, Number(med.valorRetencoes)]).toEqual([5, 1.5, null, 65]);
    expect((await eventos(conta.id)).at(-1)).toEqual(["RETENCOES", expect.stringMatching(/^ISS retido 5%, IR 1,5% · valor R\$\s?1\.000,00 → R\$\s?935,00$/)]);

    const det = await chamar("contas-receber/[id]", "GET", { id: conta.id });
    expect(det.json.retencoes).toMatchObject({ bruto: 1000, liquido: 935, linhas: [{ chave: "iss", valor: 50 }, { chave: "ir", valor: 15 }] });

    expect((await chamar("medicoes/[id]/retencoes", "PUT", { id: m.id }, {})).json.liquido).toBe(1000);
    expect(Number((await prisma.contaReceber.findUnique({ where: { id: conta.id } })).valor)).toBe(1000);
    expect((await chamar("contas-receber/[id]", "GET", { id: conta.id })).json.retencoes).toBeNull();
  });

  it("retenções: recusas — alíquota inválida (400), boleto emitido/paga/várias contas (409), outra empresa (404), sem permissão (403)", async () => {
    const m = await novaMedicao(200);
    await acao(m.id, "APROVAR_MANUAL");
    const [conta] = await vivas({ medicaoId: m.id });
    const put = (corpo: unknown, id = m.id) => chamar("medicoes/[id]/retencoes", "PUT", { id }, corpo);

    expect(await put({ ir: 0 })).toMatchObject({ status: 400, json: { erro: "Informe a alíquota de IR (ou desmarque)." } });
    expect((await put({ iss: 60, inss: 50 })).json.erro).toBe("As retenções passam do valor da nota.");

    await prisma.contaReceber.update({ where: { id: conta.id }, data: { boletoStatus: "EMITIDO" } });
    expect(await put({ iss: 5 })).toMatchObject({ status: 409, json: { erro: "Boleto emitido: cancele o boleto antes de mudar as retenções." } });
    await prisma.contaReceber.update({ where: { id: conta.id }, data: { boletoStatus: "CANCELADO" } });
    expect((await put({ iss: 5 })).status).toBe(200);

    const paga = await novaMedicao(100, { status: "PAGO" });
    expect((await put({ iss: 5 }, paga.id)).status).toBe(409);

    expect((await put({ iss: 5 }, paga.id)).json.erro).toBe("Medição paga: as retenções não mudam mais.");

    // Fatura com dois contratos: duas contas ligadas — o desconto não teria em qual cair
    await prisma.contrato.create({ data: { id: "ctD", empresaId: "e1", clienteId: "c1", numero: "CT-D", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 50, dataInicio: new Date("2026-01-01") } });
    const duas = await novaMedicao(100, { status: "PC_RECEBIDO" });
    await prisma.contaReceber.createMany({ data: [1, 2].map((k) => ({
      empresaId: "e1", clienteId: "c1", medicaoId: duas.id, contratoId: "ctD", refAno: 2026, refMes: k, numero: `CT-D/2026${k}`, descricao: "x", valor: 50, status: "PREVISTO",
    })) });
    expect(await put({ iss: 5 }, duas.id)).toMatchObject({ status: 409, json: { erro: "Esta medição tem várias contas (contratos): retenção não disponível aqui." } });

    logar(permissoesTotais(), "e2");
    expect((await put({ iss: 5 })).status).toBe(404);
    logar(montarPermissoes({ financeiro: ["visualizar", "contasReceber"] }));
    expect((await put({ iss: 5 })).status).toBe(403);
    logar();
  });

  it("retenções gravadas antes da aprovação: a conta já nasce pelo líquido; editar o rascunho recalcula o total retido", async () => {
    const m = await novaMedicao(1000, { status: "RASCUNHO" });
    await chamar("medicoes/[id]/retencoes", "PUT", { id: m.id }, { iss: 2 });
    const r = await chamar("medicoes/[id]", "PUT", { id: m.id }, {
      clienteId: "c1", tipo: "ADICIONAL", descontoValor: 0, descontoPercent: 0, itens: [{ descricao: "Novo valor", quantidade: 1, valorUnitario: 1500 }],
    });
    expect(r.status).toBe(200);
    expect(Number((await prisma.medicao.findUnique({ where: { id: m.id } })).valorRetencoes)).toBe(30);
    await acao(m.id, "ENVIAR");
    await acao(m.id, "APROVAR_MANUAL");
    const [conta] = await vivas({ medicaoId: m.id });
    expect(Number(conta.valor)).toBe(1470);
  });
});
