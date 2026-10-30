/**
 * Faturamento — Opção A ligada (P2 + P3 do plano do 35231478/frivo#102), PostgreSQL real e rotas reais:
 *
 * P2 — a conta não nasce mais na aprovação:
 *  - aprovar pelo link público NÃO cria conta a receber: o orçamento fica APROVADO = "a faturar";
 *  - cancelar orçamento aprovado e ainda não faturado fica LIVRE (rota DELETE e troca de status);
 *  - se ele ainda tem a conta Prevista antiga, ela é cancelada junto (motivo + evento, nada apagado);
 *  - bloqueia só: já faturado (fatura/medição viva), convertido em contrato, ou conta que já é
 *    cobrança de verdade (liberada/recebida/com boleto).
 *
 * P3 — nova fonte da previsão (aFaturar), mesmo número no painel:
 *  - aFaturar = orçamentos COMUM APROVADOS com saldo (total − já faturado); mês = previsão de conclusão
 *    da OS gerada (no passado → mês corrente); sem OS → mês corrente;
 *  - transição: quem ainda tem a Prevista antiga não entra (não conta em dobro); ao faturar, a
 *    Prevista vira a cobrança (adoção do #102);
 *  - MESMO NÚMERO: a mesma base, uma empresa no fluxo antigo (aprovar + Prevista) e outra no novo
 *    (aprovar sem conta), dá o mesmo "A receber este mês" e "Saldo previsto" — e o mesmo da conta
 *    feita do jeito antigo (soma das contas em aberto do mês).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/opcao-a-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_opcao_a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));
const logar = (empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json", "x-forwarded-for": "200.10.20.30" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}
const ASSINATURA = "data:image/png;base64," + "A".repeat(200);
const aprovar = (token: string) => chamar("publico/orcamentos/[token]/aprovar", "POST", { token }, { nome: "Juliana Ramos", cpf: "123.456.789-09", assinaturaUrl: ASSINATURA });

/** "Agora": 15/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-15T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Faturamento — Opção A ligada: P2 + P3 (PostgreSQL real)", () => {
  let prisma: any;
  let fin: typeof import("@/lib/financeiro-server");
  let af: typeof import("@/lib/financeiro/a-faturar");
  let n = 0;
  const seq = () => String(++n).padStart(4, "0");

  /** Orçamento ENVIADO (validade 20/11) com um serviço sem retenção, pronto para o cliente aprovar */
  const novoOrcamento = (o: { total?: number; empresaId?: string; tipo?: string; validade?: string } = {}) => {
    const total = o.total ?? 2800;
    const e = o.empresaId ?? "e1";
    return prisma.orcamento.create({ data: {
      empresaId: e, codigo: `ORC-2026-${seq()}`, nome: "Troca de compressor", clienteId: e === "e1" ? "c1" : e === "e2" ? "c2" : "c3",
      criadoPorId: e === "e1" ? "uA" : e === "e2" ? "uB" : "uC", status: "ENVIADO", tipo: o.tipo ?? "COMUM", tokenPublico: `tok-${n}-${Math.random()}`,
      validadeEm: dia(o.validade ?? "2026-11-20"), totalGeral: total, totalServicos: total,
      servicos: { create: [{ servicoId: e === "e1" ? "sSN" : null, descricao: "Troca de compressor", quantidade: 1, valorUnitario: total, valorTotal: total, ordem: 0 }] },
    } });
  };
  const novaOs = (dados: Record<string, unknown>) => prisma.ordemServico.create({ data: {
    empresaId: "e1", numero: `OS-2026-${seq()}`, clienteId: "c1", criadoPorId: "uA", status: "EM_ANDAMENTO", origem: "MANUAL", descricao: "Serviço", ...dados,
  } });
  const vivas = (orcamentoId: string) => prisma.contaReceber.findMany({ where: { orcamentoId, status: { not: "CANCELADO" }, excluidaEm: null } });
  const itens = async (empresaId = "e1") => (await af.itensAFaturar(empresaId, AGORA)).map((i) => [i.codigo, i.valor, i.mes, i.origemMes]);

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
    af = await import("@/lib/financeiro/a-faturar");
    await Promise.all(["publico/orcamentos/[token]/aprovar", "orcamentos/[id]", "orcamentos/[id]/impacto", "orcamentos/[id]/faturar"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Antes (fluxo antigo)", cnpj: "98765432000110", email: "o@x.com" },
      { id: "e3", nome: "Depois (fluxo novo)", cnpj: "11222333000181", email: "d@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
      { id: "uC", empresaId: "e3", nome: "Caio", email: "c@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11222333000181", diaFaturamento: 10 },
      { id: "c2", empresaId: "e2", nome: "Hospital", cpfCnpj: "11222333000181" },
      { id: "c3", empresaId: "e3", nome: "Hospital", cpfCnpj: "11222333000181" },
    ] });
    await prisma.servico.create({ data: { id: "sSN", empresaId: "e1", nome: "Manutenção", codigo: "MANU01", codigoLc116: "14.01" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    logar();
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  // ═══════════ P2 ═══════════

  it("P2: aprovar pelo link NÃO cria conta — o orçamento fica 'a faturar' (mês corrente, pelo total)", async () => {
    const o = await novoOrcamento({ total: 1234.56 });
    expect((await aprovar(o.tokenPublico)).status).toBe(200);
    expect((await prisma.orcamento.findUnique({ where: { id: o.id } })).status).toBe("APROVADO");
    expect(await prisma.contaReceber.count({ where: { orcamentoId: o.id } })).toBe(0);
    expect(await itens()).toContainEqual([o.codigo, 1234.56, "2026-11", "MES_CORRENTE"]);
    // limpa para os próximos
    await prisma.orcamento.update({ where: { id: o.id }, data: { status: "CANCELADO" } });
  });

  it("P2: cancelar aprovado e não faturado é livre (sem aviso de conta); sai do 'a faturar'", async () => {
    const o = await novoOrcamento();
    await aprovar(o.tokenPublico);
    const imp = await chamar("orcamentos/[id]/impacto", "GET", { id: o.id });
    expect(imp.json.bloqueio).toBeNull();
    expect(imp.json.previstasACancelar).toEqual([]);
    expect((await chamar("orcamentos/[id]", "DELETE", { id: o.id })).status).toBe(200);
    expect((await prisma.orcamento.findUnique({ where: { id: o.id } })).status).toBe("CANCELADO");
    expect((await itens()).map((i) => i[0])).not.toContain(o.codigo);
  });

  it("P2: Prevista antiga (aprovação de antes) é cancelada JUNTO — motivo + evento; pelos dois caminhos de cancelar", async () => {
    for (const caminho of ["DELETE", "STATUS"] as const) {
      const o = await novoOrcamento({ total: 980 });
      await aprovar(o.tokenPublico);
      const prevista = (await fin.gerarContaReceberDoOrcamento(o.id))!; // como a aprovação fazia antes da Opção A
      expect(prevista).toMatchObject({ status: "PREVISTO", valor: expect.anything() });
      const imp = await chamar("orcamentos/[id]/impacto", "GET", { id: o.id });
      expect(imp.json.bloqueio).toBeNull();
      expect(imp.json.previstasACancelar).toEqual([prevista.id]);
      expect(imp.json.avisos.join(" ")).toMatch(new RegExp(`A previsão ${prevista.numero} \\(R\\$\\s?980,00\\) no Contas a Receber é cancelada junto`));
      const r = caminho === "DELETE"
        ? await chamar("orcamentos/[id]", "DELETE", { id: o.id })
        : await chamar("orcamentos/[id]", "PUT", { id: o.id }, { status: "CANCELADO" });
      expect(r.status).toBe(200);
      const c = await prisma.contaReceber.findUnique({ where: { id: prevista.id } });
      expect(c).toMatchObject({ status: "CANCELADO", motivoCancelamento: `Orçamento ${o.codigo} cancelado` });
      expect(c.canceladaEm).toBeTruthy();
      const ev = await prisma.contaReceberEvento.findMany({ where: { contaReceberId: prevista.id } });
      expect(ev.map((e: any) => [e.tipo, e.detalhe, e.usuarioId])).toEqual([["CANCELADA", `Orçamento ${o.codigo} cancelado: a previsão sai do Contas a Receber.`, "uA"]]);
    }
  });

  it("P2: bloqueia só o que já é cobrança — faturado, conta liberada/com boleto; convertido em contrato", async () => {
    // já faturado (Faturar do P1): bloqueia com o número da fatura
    const f = await novoOrcamento();
    await aprovar(f.tokenPublico);
    const fat = await chamar("orcamentos/[id]/faturar", "POST", { id: f.id });
    expect(fat.status).toBe(201);
    const impF = await chamar("orcamentos/[id]/impacto", "GET", { id: f.id });
    expect(impF.json.bloqueio).toMatch(/^Este orçamento já foi faturado \(fatura \d{4}-\d{4}\)\. Cancele a fatura no Financeiro/);
    expect((await chamar("orcamentos/[id]", "DELETE", { id: f.id })).status).toBe(409);
    expect((await prisma.orcamento.findUnique({ where: { id: f.id } })).status).toBe("APROVADO");

    // Prevista antiga que virou cobrança (liberada) ou com boleto emitido: bloqueia, nada é cancelado
    for (const dados of [{ status: "A_RECEBER" }, { boletoStatus: "EMITIDO" }]) {
      const o = await novoOrcamento();
      await aprovar(o.tokenPublico);
      const c = (await fin.gerarContaReceberDoOrcamento(o.id))!;
      await prisma.contaReceber.update({ where: { id: c.id }, data: dados });
      const imp = await chamar("orcamentos/[id]/impacto", "GET", { id: o.id });
      expect(imp.json.bloqueio).toBe(`Este orçamento já tem cobrança no financeiro (conta a receber ${c.numero}). Cancele ou estorne no Contas a Receber antes de cancelar o orçamento.`);
      expect((await chamar("orcamentos/[id]", "PUT", { id: o.id }, { status: "CANCELADO" })).status).toBe(409);
      expect((await prisma.contaReceber.findUnique({ where: { id: c.id } })).status).not.toBe("CANCELADO");
    }

    // convertido em contrato: continua bloqueado
    const cv = await novoOrcamento();
    await prisma.orcamento.update({ where: { id: cv.id }, data: { status: "CONVERTIDA" } });
    expect((await chamar("orcamentos/[id]/impacto", "GET", { id: cv.id })).json.bloqueio).toMatch(/já foi convertido no contrato/);
    await prisma.orcamento.updateMany({ where: { empresaId: "e1", status: "APROVADO" }, data: { status: "CANCELADO" } });
  });

  // ═══════════ P3 ═══════════

  it("P3: aFaturar — mês pela previsão da OS gerada (passada = mês corrente); sem OS = mês corrente; fora: proposta de contrato, faturado, Prevista antiga, outra empresa", async () => {
    const semOs = await novoOrcamento({ total: 100 }); await aprovar(semOs.tokenPublico);
    const osFutura = await novoOrcamento({ total: 200 }); await aprovar(osFutura.tokenPublico);
    await novaOs({ orcamentoOrigemId: osFutura.id, previsaoConclusao: new Date("2027-01-10T15:00:00Z") });
    const osPassada = await novoOrcamento({ total: 300 }); await aprovar(osPassada.tokenPublico);
    await novaOs({ orcamentoOrigemId: osPassada.id, previsaoConclusao: new Date("2026-10-01T15:00:00Z") });
    const osCancelada = await novoOrcamento({ total: 400 }); await aprovar(osCancelada.tokenPublico);
    await novaOs({ orcamentoOrigemId: osCancelada.id, previsaoConclusao: new Date("2027-03-01T15:00:00Z"), status: "CANCELADA" });
    // virada do mês em Brasília: 01/12 00:30 BR (03:30Z) já é dezembro
    const osDezembro = await novoOrcamento({ total: 500 }); await aprovar(osDezembro.tokenPublico);
    await novaOs({ orcamentoOrigemId: osDezembro.id, previsaoConclusao: new Date("2026-12-01T03:30:00Z") });
    // e 01/12 01:00 UTC ainda é 30/11 22:00 em Brasília: novembro (o mês é o de Brasília, não o UTC)
    const osNovBR = await novoOrcamento({ total: 600 }); await aprovar(osNovBR.tokenPublico);
    await novaOs({ orcamentoOrigemId: osNovBR.id, previsaoConclusao: new Date("2026-12-01T01:00:00Z") });
    // fora do "a faturar"
    const proposta = await novoOrcamento({ total: 9000, tipo: "PROPOSTA_CONTRATO" }); await aprovar(proposta.tokenPublico);
    const comPrevista = await novoOrcamento({ total: 9100 }); await aprovar(comPrevista.tokenPublico);
    await fin.gerarContaReceberDoOrcamento(comPrevista.id);
    const faturado = await novoOrcamento({ total: 9200 }); await aprovar(faturado.tokenPublico);
    expect((await chamar("orcamentos/[id]/faturar", "POST", { id: faturado.id })).status).toBe(201);
    const outra = await novoOrcamento({ total: 9300, empresaId: "e2" }); await aprovar(outra.tokenPublico);

    expect(await itens()).toEqual([
      [semOs.codigo, 100, "2026-11", "MES_CORRENTE"],
      [osFutura.codigo, 200, "2027-01", "OS"],
      [osPassada.codigo, 300, "2026-11", "MES_CORRENTE"],
      [osCancelada.codigo, 400, "2026-11", "MES_CORRENTE"],
      [osDezembro.codigo, 500, "2026-12", "OS"],
      [osNovBR.codigo, 600, "2026-11", "OS"],
    ]);
    expect(await af.aFaturar("e1", { de: "2026-11", ate: "2026-11" }, AGORA)).toMatchObject({ valor: 1400, qtd: 4 });
    expect(await af.aFaturar("e1", { de: "2026-12", ate: "2027-01" }, AGORA)).toMatchObject({ valor: 700, qtd: 2 });

    // Transição: faturar quem tem a Prevista antiga ADOTA a conta (vira a cobrança, sem 2ª conta)
    const antes = await vivas(comPrevista.id);
    expect(antes).toHaveLength(1);
    expect((await chamar("orcamentos/[id]/faturar", "POST", { id: comPrevista.id })).status).toBe(201);
    const depois = await vivas(comPrevista.id);
    expect(depois.map((c: any) => c.id)).toEqual([antes[0].id]);
    expect(depois[0].medicaoId).toBeTruthy();
    await prisma.orcamento.updateMany({ where: { status: "APROVADO" }, data: { status: "CANCELADO" } });
  });

  it("P3: MESMO NÚMERO — a mesma base no fluxo antigo (Prevista) e no novo (a faturar) dá o mesmo 'A receber este mês' e 'Saldo previsto'", async () => {
    // A mesma base nas duas empresas: orçamento aprovado (validade 20/11, no mês), conta de 1.000 em aberto no mês,
    // e uma conta a pagar de 500 no mês
    for (const e of ["e2", "e3"]) {
      const o = await novoOrcamento({ total: 2800, empresaId: e, validade: "2026-11-20" });
      await aprovar(o.tokenPublico);
      if (e === "e2") await fin.gerarContaReceberDoOrcamento(o.id); // ANTES: a aprovação criava a Prevista
      await prisma.contaReceber.create({ data: { empresaId: e, clienteId: e === "e2" ? "c2" : "c3", numero: `CR-${e}-1`, descricao: "Mensal", valor: 1000, status: "A_RECEBER", dataVencimento: dia("2026-11-25") } });
      await prisma.contaPagar.create({ data: { empresaId: e, numero: `CP-${e}-1`, fornecedor: "Fornecedor", descricao: "Peças", valorTotal: 500, saldoRestante: 500, status: "PENDENTE", dataVencimento: dia("2026-11-28") } });
    }
    // O número do jeito ANTIGO (o que o painel somava antes): contas em aberto do mês, Prevista inclusa
    const contasMes = await prisma.contaReceber.aggregate({
      where: { empresaId: "e2", status: { in: ["PREVISTO", "A_RECEBER", "ATRASADO"] }, dataVencimento: { gte: dia("2026-11-01"), lte: new Date("2026-11-30T23:59:59.999Z") } },
      _sum: { valor: true },
    });
    const antigo = Number(contasMes._sum.valor);
    expect(antigo).toBe(3800);

    const antes = await fin.resumoFinanceiro("e2");   // base antiga (tem a Prevista): ela conta, o a faturar não
    const depois = await fin.resumoFinanceiro("e3");  // base nova (sem conta): entra pelo a faturar
    expect(antes.aReceberMes).toMatchObject({ valor: 3800, contas: 3800, aFaturar: { valor: 0, qtd: 0 } });
    expect(depois.aReceberMes).toMatchObject({ valor: 3800, contas: 1000, aFaturar: { valor: 2800, qtd: 1 } });
    expect(depois.aReceberMes.valor).toBe(antigo);
    expect(antes.saldoPrevisto).toBe(3300);
    expect(depois.saldoPrevisto).toBe(antes.saldoPrevisto);
  });

  it("P3: painel e fluxo de caixa mostram o 'a faturar' (linha no card com ⓘ; card, série e lista no fluxo)", async () => {
    logar("e3");
    try {
      const { default: Painel } = await import("@/app/(dashboard)/financeiro/page");
      const h = renderToStaticMarkup(await Painel());
      const card = h.match(/data-card-financeiro="A receber este mês"[\s\S]*?<\/a>[\s\S]*?(?=<div class="relative" data-card-financeiro=)/)![0];
      expect(card).toMatch(/R\$\s?3\.800,00/);
      expect(card.replace(/<[^>]+>/g, "")).toMatch(/inclui R\$\s?2\.800,00 a faturar · 1 orçamento/);
      expect(card).toContain("data-dica");
      expect(h).toContain("Receber (com a faturar) − Pagar (em aberto)");

      const { default: Fluxo } = await import("@/app/(dashboard)/financeiro/fluxo-caixa/page");
      const f = renderToStaticMarkup(await Fluxo({ searchParams: Promise.resolve({ mes: "11", ano: "2026" }) }));
      // o valor DO CARD (não o da legenda/lista mais abaixo)
      const valorCard = f.match(/data-card-fluxo="A faturar \(orçamentos aprovados\)"[\s\S]*?tabular-nums[^>]*>([^<]+)</)![1];
      expect(valorCard).toMatch(/R\$\s?2\.800,00/);
      expect(f).toContain('data-serie-a-faturar="2800"');
      expect(f).toMatch(/data-item-a-faturar="[^"]+"/);
      expect(f.replace(/<[^>]+>/g, " ")).toContain("sem previsão de OS: mês corrente");
    } finally { logar(); }
  });
});
