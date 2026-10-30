/**
 * "Faturar" (faturamento avulso, P1) + retenções herdadas do serviço. Rotas reais, Prisma real,
 * PostgreSQL real (schema descartável via `prisma db push` + os SQL de produção do #102 e desta PR).
 * Prova:
 *  - orçamento aprovado (com ou sem OS): fatura = medição ADICIONAL `avulsa`, já liberada (PC_RECEBIDO,
 *    sem aprovação do cliente), itens como o cliente aprovou (ISS embutido) e total = total geral;
 *    serviço/produto/orçamento em cada item; a previsão do orçamento VIRA a cobrança (uma conta só);
 *  - retenções herdadas do cadastro dos serviços da nota (ISS retido + "reter" federal): gravadas na
 *    fatura, conta a receber pelo líquido; base = só os serviços (produto fora da nota);
 *  - OS concluída sem contrato: itens executados (com o serviço do orçamento via orcamentoServicoId do
 *    "Gerar OS") + adicionais "Cobrar"; OS de contrato e não concluída → 409; nada a faturar → 400;
 *  - travas: 5× ao mesmo tempo → 1 fatura; orçamento faturado ↔ OS gerada dele não fatura de novo;
 *  - RBAC (Financeiro › Medições) 403; outra empresa 404; discriminação "Fatura nº …";
 *  - cadastro do serviço: "reter" sem alíquota é recusado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/faturar-avulso-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { calcularOrcamento } from "@/lib/orcamentos/calculo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_faturar_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}
const faturarOrc = (id: string) => chamar("orcamentos/[id]/faturar", "POST", { id });
const faturarOs = (id: string) => chamar("ordens/[id]/faturar", "POST", { id });

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Faturar (avulso) + retenções herdadas do serviço (PostgreSQL real)", () => {
  let prisma: any;
  let fin: typeof import("@/lib/financeiro-server");
  let n = 0;
  const seq = () => String(++n).padStart(4, "0");

  /** Orçamento aprovado com serviços/produtos; total geral calculado como a tela calcula */
  async function novoOrcamento(o: {
    servicos?: { servicoId?: string | null; descricao?: string; q?: number; v: number }[];
    produtos?: { v: number; q?: number }[];
    desconto?: number; iss?: number; status?: string; tipo?: string; empresaId?: string; clienteId?: string;
  } = {}) {
    const servicos = (o.servicos ?? [{ servicoId: "sISS", v: 1000 }]).map((s, i) => ({
      servicoId: s.servicoId ?? null, descricao: s.descricao ?? `Serviço ${i + 1}`, quantidade: s.q ?? 1, valorUnitario: s.v, valorTotal: (s.q ?? 1) * s.v, ordem: i,
    }));
    const produtos = (o.produtos ?? []).map((p, i) => ({ descricao: `Peça ${i + 1}`, quantidade: p.q ?? 1, valorUnitario: p.v, valorTotal: (p.q ?? 1) * p.v, ordem: i }));
    const entrada = {
      servicos, produtos, descontoServicos: o.desconto ?? 0, tipoDescontoServicos: "PERCENTUAL" as const,
      descontoProdutos: 0, tipoDescontoProdutos: "VALOR" as const, issAliquota: o.iss ?? 0,
    };
    const t = calcularOrcamento(entrada);
    return prisma.orcamento.create({ data: {
      empresaId: o.empresaId ?? "e1", codigo: `ORC-2026-${seq()}`, nome: "Troca de compressor", clienteId: o.clienteId ?? "c1", criadoPorId: o.empresaId === "e2" ? "uB" : "uA",
      status: o.status ?? "APROVADO", tipo: o.tipo ?? "COMUM", tokenPublico: `tok-${n}-${Math.random()}`,
      descontoServicos: entrada.descontoServicos, tipoDescontoServicos: "PERCENTUAL", issAliquota: entrada.issAliquota,
      totalGeral: t.totalGeral, totalServicos: t.subtotalServicos,
      servicos: { create: servicos }, produtos: { create: produtos },
    }, include: { servicos: true } });
  }
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: {
    empresaId: "e1", numero: `OS-2026-${seq()}`, clienteId: "c1", criadoPorId: "uA", status: "CONCLUIDA", origem: "MANUAL",
    descricao: "Limpeza geral\nDetalhes", dataConclusao: new Date(), ...dados,
  } });
  const medicao = (id: string) => prisma.medicao.findUnique({ where: { id }, include: { itens: { orderBy: { ordem: "asc" } } } });
  const vivas = (where: Record<string, unknown>) => prisma.contaReceber.findMany({ where: { ...where, status: { not: "CANCELADO" }, excluidaEm: null }, orderBy: { criadoEm: "asc" } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    for (const sql of ["2026-11-14_faturamento_travas_retencoes.sql", "2026-11-16_faturar_avulso.sql"]) {
      execFileSync("psql", [URL_PG!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", path.join(RAIZ, "prisma/sql", sql)], {
        env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, stdio: "pipe",
      });
    }
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    fin = await import("@/lib/financeiro-server");
    await Promise.all(["orcamentos/[id]/faturar", "ordens/[id]/faturar", "medicoes/[id]/retencoes", "cadastros/[entidade]", "cadastros/[entidade]/[id]"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`).catch(() => null)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.configuracao.create({ data: { empresaId: "e1", issAliquota: 5 } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11222333000181", diaFaturamento: 10 },
      { id: "cX", empresaId: "e2", nome: "Da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.servico.createMany({ data: [
      // ISS retido pelo tomador (alíquota do serviço) · ISS retido sem alíquota (= a da empresa, 5%)
      { id: "sISS", empresaId: "e1", nome: "Manutenção", codigo: "MANU01", codigoLc116: "14.01", issRetido: true, aliquotaISS: 2 },
      { id: "sISS5", empresaId: "e1", nome: "Instalação", codigo: "INST01", codigoLc116: "14.06", issRetido: true },
      // Federais: "reter" IR 1,5% · e um serviço só com alíquota (sem "reter": não retém)
      { id: "sIR", empresaId: "e1", nome: "Projeto", codigo: "PROJ01", codigoLc116: "17.01", retIr: true, aliquotaIR: 1.5, aliquotaPIS: 0.65 },
      // Simples Nacional: nada retido
      { id: "sSN", empresaId: "e1", nome: "Visita", codigo: "VISI01", codigoLc116: "14.01" },
      // De OUTRA empresa (retém tudo): nunca pode emprestar retenção a uma fatura da e1
      { id: "sX", empresaId: "e2", nome: "Alheio", codigo: "ALHE01", issRetido: true, aliquotaISS: 3, retIr: true, aliquotaIR: 1.5 },
    ] });
    logar();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  // ═══════════ Orçamento ═══════════

  it("orçamento aprovado (sem OS): fatura avulsa liberada, itens do cliente (ISS embutido), total = total geral; previsão vira a cobrança", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 1000 }, { servicoId: null, descricao: "Deslocamento", v: 200 }], produtos: [{ v: 300 }], desconto: 10, iss: 5 });
    const prevista = await fin.gerarContaReceberDoOrcamento(orc.id);
    expect(prevista).toBeTruthy();

    const r = await faturarOrc(orc.id);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ jaExistia: false, rotulo: expect.stringMatching(/^Fatura 2026-\d{4}$/) });
    const m = await medicao(r.json.id);
    expect(m).toMatchObject({ empresaId: "e1", clienteId: "c1", tipo: "ADICIONAL", avulsa: true, status: "PC_RECEBIDO", valorRetencoes: expect.anything() });
    expect(m.dataAprovacao).toBeTruthy();
    expect(r.json.rotulo).toBe(`Fatura ${m.numero.replace(/^MED-/, "")}`);
    // Total = total geral do orçamento, ao centavo; itens: serviços (com o serviço do catálogo) e depois produtos
    expect(Number(m.valorLiquido)).toBe(Number(orc.totalGeral));
    expect(m.itens.map((i: any) => [i.tipo, i.servicoId, i.produtoId, i.orcamentoId])).toEqual([
      ["SERVICO", "sSN", null, orc.id], ["SERVICO", null, null, orc.id], ["PRODUTO", null, null, orc.id],
    ]);
    expect(Math.round(m.itens.reduce((s: number, i: any) => s + Number(i.valorTotal), 0) * 100) - Math.round(Number(m.descontoValor) * 100))
      .toBe(Math.round(Number(orc.totalGeral) * 100));
    // Vencimento: o próximo dia de faturamento do cliente (nunca nasce vencida)
    expect(m.dataVencimento.getUTCDate()).toBe(10);
    // Simples Nacional: nada retido; a previsão do orçamento VIROU a cobrança (uma conta, valor da fatura)
    expect(Number(m.valorRetencoes)).toBe(0);
    const contas = await vivas({ OR: [{ orcamentoId: orc.id }, { medicaoId: m.id }] });
    expect(contas).toHaveLength(1);
    expect(contas[0]).toMatchObject({ id: prevista!.id, medicaoId: m.id });
    expect(Number(contas[0].valor)).toBe(Number(orc.totalGeral));
    // Linha do tempo do orçamento
    const ev = await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: orc.id, tipo: "FATURADO" } });
    expect(ev.detalhe).toBe(`Fatura ${m.numero.replace(/^MED-/, "")}`);
  });

  it("retenções herdadas: serviços com ISS retido → gravadas na fatura; conta = líquido − retenção; base = só os serviços", async () => {
    // Dois serviços com ISS retido (2% do serviço sISS; o 1º com alíquota manda) + produto (fora da nota)
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sISS", v: 2000 }, { servicoId: "sISS5", v: 800 }], produtos: [{ v: 500 }] });
    const r = await faturarOrc(orc.id);
    const m = await medicao(r.json.id);
    expect(Number(m.retIssAliquota)).toBe(2);
    expect([m.retIrAliquota, m.retPisAliquota, m.retCofinsAliquota, m.retCsllAliquota, m.retInssAliquota]).toEqual([null, null, null, null, null]);
    // Base = 2.800 (serviços), não 3.300: ISS 2% = 56,00
    expect(Number(m.valorRetencoes)).toBe(56);
    const [conta] = await vivas({ medicaoId: m.id });
    expect(Number(conta.valor)).toBe(3300 - 56);
  });

  it("federal com \"reter\" (IR 1,5%) vale; alíquota sem \"reter\" (PIS) não; serviço que não retém junto → fica de fora (parcial)", async () => {
    const soIr = await novoOrcamento({ servicos: [{ servicoId: "sIR", v: 1000 }] });
    const m1 = await medicao((await faturarOrc(soIr.id)).json.id);
    expect([Number(m1.retIrAliquota), m1.retPisAliquota, m1.retIssAliquota]).toEqual([1.5, null, null]);
    expect(Number(m1.valorRetencoes)).toBe(15);
    expect(Number((await vivas({ medicaoId: m1.id }))[0].valor)).toBe(985);

    // Item apontando para serviço de outra empresa (dado inconsistente): o cadastro alheio não vale
    const alheio = await novoOrcamento({ servicos: [{ servicoId: "sX", v: 1000 }] });
    const mx = await medicao((await faturarOrc(alheio.id)).json.id);
    expect([mx.retIssAliquota, mx.retIrAliquota, Number(mx.valorRetencoes)]).toEqual([null, null, 0]);

    const misto = await novoOrcamento({ servicos: [{ servicoId: "sIR", v: 1000 }, { servicoId: "sSN", v: 1000 }] });
    const m2 = await medicao((await faturarOrc(misto.id)).json.id);
    expect(m2.retIrAliquota).toBeNull();
    expect(Number(m2.valorRetencoes)).toBe(0);
  });

  it("\"Editar\" (exceção): retenções salvas pela rota usam a base dos serviços e a conta segue o líquido", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 1000 }], produtos: [{ v: 1000 }] });
    const m = await medicao((await faturarOrc(orc.id)).json.id);
    const r = await chamar("medicoes/[id]/retencoes", "PUT", { id: m.id }, { iss: 5, ir: null, pis: null, cofins: null, csll: null, inss: null });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ bruto: 1000, total: 50, contaReceber: { valor: 1950 } });
  });

  it("5× \"Faturar\" ao mesmo tempo → 1 fatura (201) e 4 \"já faturado\" (200, a mesma)", async () => {
    const orc = await novoOrcamento();
    const rs = await Promise.all(Array.from({ length: 5 }, () => faturarOrc(orc.id)));
    expect(rs.filter((x) => x.status === 201)).toHaveLength(1);
    expect(rs.filter((x) => x.status === 200 && x.json.jaExistia)).toHaveLength(4);
    expect(new Set(rs.map((x) => x.json.id)).size).toBe(1);
    expect(await prisma.medicaoItem.count({ where: { orcamentoId: orc.id, medicao: { status: { not: "CANCELADA" } } } })).toBe(1);
    // Já faturado vale antes de qualquer regra: mesmo se o orçamento mudar de status, leva à fatura
    await prisma.orcamento.update({ where: { id: orc.id }, data: { status: "CANCELADO" } });
    expect(await faturarOrc(orc.id)).toMatchObject({ status: 200, json: { id: rs[0].json.id, jaExistia: true } });
  });

  it("bloqueios: não aprovado / proposta de contrato → 409; sem itens com valor → 400; outra empresa → 404; sem permissão → 403", async () => {
    const rascunho = await novoOrcamento({ status: "RASCUNHO" });
    expect(await faturarOrc(rascunho.id)).toMatchObject({ status: 409, json: { erro: "Só orçamento aprovado pode ser faturado." } });
    const proposta = await novoOrcamento({ tipo: "PROPOSTA_CONTRATO" });
    expect(await faturarOrc(proposta.id)).toMatchObject({ status: 409, json: { erro: "Proposta de contrato é faturada pelo contrato." } });
    const vazio = await novoOrcamento({ servicos: [] });
    expect(await faturarOrc(vazio.id)).toMatchObject({ status: 400, json: { erro: "Nada a faturar: o orçamento não tem itens com valor." } });

    const daOutra = await novoOrcamento({ empresaId: "e2", clienteId: "cX" });
    expect((await faturarOrc(daOutra.id)).status).toBe(404);
    expect(await prisma.medicao.count({ where: { empresaId: "e2" } })).toBe(0);

    const orc = await novoOrcamento();
    logar(montarPermissoes({ financeiro: ["visualizar", "contasReceber"], orcamentos: ["visualizar"], ordens: ["visualizar"] }));
    try {
      expect((await faturarOrc(orc.id)).status).toBe(403);
      const os = await novaOs();
      expect((await faturarOs(os.id)).status).toBe(403);
    } finally { logar(); }
    expect(await prisma.medicaoItem.count({ where: { orcamentoId: orc.id } })).toBe(0);
  });

  // ═══════════ OS ═══════════

  it("Gerar OS guarda o orcamentoServicoId; Faturar a OS leva o serviço do catálogo (dados fiscais) até o item; orçamento não fatura de novo", async () => {
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sISS", v: 600 }, { servicoId: null, descricao: "Extra", v: 100 }], produtos: [{ v: 50 }] });
    const { gerarOsDoOrcamento } = await import("@/lib/orcamentos/gerar-os-server");
    const { prepararExecucao } = await import("@/lib/os/abertura");
    const prep = await prepararExecucao("e1", { tecnicoIds: ["t1"], responsavelId: "t1" });
    if ("erro" in prep) throw new Error(prep.erro);
    const g = await gerarOsDoOrcamento({ empresaId: "e1", usuarioId: "uA", orcamentoId: orc.id, execucao: prep.execucao });
    expect(g.tipo).toBe("criada");
    const osId = (g as any).os.id;
    const itens = await prisma.osItemOrcamento.findMany({ where: { ordemServicoId: osId }, orderBy: { descricao: "asc" } });
    const porDesc = Object.fromEntries(itens.map((i: any) => [i.descricao, i.orcamentoServicoId]));
    expect(porDesc).toEqual({ "Serviço 1": orc.servicos.find((s: any) => s.servicoId === "sISS").id, Extra: orc.servicos.find((s: any) => s.descricao === "Extra").id, "Peça 1": null });

    // Não concluída → 409
    expect(await faturarOs(osId)).toMatchObject({ status: 409, json: { erro: "Conclua a OS antes de faturar." } });
    await prisma.ordemServico.update({ where: { id: osId }, data: { status: "CONCLUIDA", dataConclusao: new Date() } });
    // Nada executado → 400
    expect(await faturarOs(osId)).toMatchObject({ status: 400 });
    await prisma.osItemOrcamento.updateMany({ where: { ordemServicoId: osId, descricao: { in: ["Serviço 1", "Extra"] } }, data: { executado: true } });

    const r = await faturarOs(osId);
    expect(r.status).toBe(201);
    const m = await medicao(r.json.id);
    expect(m).toMatchObject({ avulsa: true, status: "PC_RECEBIDO", tipo: "ADICIONAL" });
    expect(m.itens.map((i: any) => [i.descricao, i.servicoId, i.ordemServicoId])).toEqual([["Serviço 1", "sISS", osId], ["Extra", null, osId]]);
    expect(Number(m.valorLiquido)).toBe(700);
    // Herdou o ISS retido do serviço da OS? Só parte dos serviços retém → fica de fora (o usuário confere)
    expect(Number(m.valorRetencoes)).toBe(0);
    // A OS passa a "Faturada" e ganha histórico
    const os = await prisma.ordemServico.findUnique({ where: { id: osId }, include: { historico: true } });
    expect(os.historico.some((h: any) => h.acao === "OS faturada" && h.detalhes === `Fatura ${m.numero.replace(/^MED-/, "")}`)).toBe(true);
    // O orçamento de origem já está faturado pela OS: não fatura de novo (devolve a mesma)
    const de = await faturarOrc(orc.id);
    expect(de).toMatchObject({ status: 200, json: { id: m.id, jaExistia: true } });
    // E a OS de novo também
    expect(await faturarOs(osId)).toMatchObject({ status: 200, json: { id: m.id, jaExistia: true } });
  });

  it("OS: adicionais \"Cobrar\" com preço entram; OS de contrato → 409 (segue pela medição); outra empresa → 404", async () => {
    const os = await novaOs();
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Limpeza", quantidade: 2, valorUnitario: 150, valorTotal: 300, executado: true } });
    const at = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Visita", status: "CONCLUIDA" } });
    await prisma.servicoAdicional.createMany({ data: [
      { empresaId: "e1", ordemServicoId: os.id, atividadeId: at.id, descricao: "Troca de capacitor", statusCobranca: "COBRAR", valor: 120 },
      { empresaId: "e1", ordemServicoId: os.id, atividadeId: at.id, descricao: "Só avaliar", statusCobranca: "A_AVALIAR", valor: 999 },
    ] });
    const r = await faturarOs(os.id);
    expect(r.status).toBe(201);
    const m = await medicao(r.json.id);
    expect(Number(m.valorLiquido)).toBe(420);
    expect(m.itens.map((i: any) => i.descricao)).toEqual(["Limpeza", "Serviço adicional — Troca de capacitor"]);
    expect(m.descricao).toBe(`OS ${os.numero} — Limpeza geral`);

    const contrato = await prisma.contrato.create({ data: { empresaId: "e1", clienteId: "c1", numero: `CT-${seq()}`, tipo: "MANUTENCAO_PREVENTIVA", valorMensal: 1000, dataInicio: new Date() } });
    const osC = await novaOs({ contratoId: contrato.id });
    expect(await faturarOs(osC.id)).toMatchObject({ status: 409, json: { erro: "OS de contrato: fature pela medição do contrato." } });
    const osX = await prisma.ordemServico.create({ data: { empresaId: "e2", numero: `OS-2026-${seq()}`, clienteId: "cX", criadoPorId: "uB", status: "CONCLUIDA", origem: "MANUAL", descricao: "x" } });
    expect((await faturarOs(osX.id)).status).toBe(404);
  });

  it("NFS-e: a prévia da fatura avulsa leva \"Fatura nº …\" na discriminação (a medição comum segue \"Medição MED-…\")", async () => {
    const { previaEmissao } = await import("@/lib/nfse/emissao-server");
    const orc = await novoOrcamento({ servicos: [{ servicoId: "sSN", v: 900 }] });
    const m = await medicao((await faturarOrc(orc.id)).json.id);
    const p = await previaEmissao("e1", m.id);
    expect(p.medicao.rotulo).toBe(`Fatura ${m.numero.replace(/^MED-/, "")}`);
    expect(p.grupos[0].discriminacao).toMatch(new RegExp(`Ref\\.: Fatura nº ${m.numero.replace(/^MED-/, "")}$`));
    // Liberada (PC_RECEBIDO): nenhuma pendência de status da medição
    expect(p.pendencias.join(" ")).not.toMatch(/aprova/i);
  });

  // ═══════════ Cadastro do serviço ═══════════

  it("cadastro do serviço: \"reter\" sem alíquota é recusado (400); com alíquota grava; ISS retido sem alíquota pode (herda a da empresa)", async () => {
    const criar = (corpo: Record<string, unknown>) => chamar("cadastros/[entidade]", "POST", { entidade: "servicos" }, corpo);
    expect(await criar({ nome: "Consultoria", retInss: "true" })).toMatchObject({ status: 400, json: { erro: "Informe a alíquota de INSS para reter (ou desmarque)." } });
    const ok = await criar({ nome: "Consultoria", retInss: "true", aliquotaINSS: "11", issRetido: "true" });
    expect(ok.status).toBe(201);
    const s = await prisma.servico.findFirst({ where: { empresaId: "e1", nome: "Consultoria" } });
    expect([s.retInss, Number(s.aliquotaINSS), s.issRetido, s.retIr]).toEqual([true, 11, true, false]);
    // Editar tirando a alíquota com o "reter" marcado: recusado (olha o que fica gravado)
    const ed = await chamar("cadastros/[entidade]/[id]", "PATCH", { entidade: "servicos", id: s.id }, { aliquotaINSS: "" });
    expect(ed).toMatchObject({ status: 400, json: { erro: "Informe a alíquota de INSS para reter (ou desmarque)." } });
  });
});
