/**
 * Leva 5 — Dinheiro do CONTRATO. Rotas reais, Prisma real, PostgreSQL real (schema descartável).
 * Prova (decisões D1/D3 do dono + itens C6/F5/CO2/CO3/CO4 da auditoria):
 *  - CO4: vigência de 12 meses gera EXATAMENTE 12 previsões (não 13), idempotente, cada uma
 *    LIGADA ao contrato e à competência (C6) — inclusive para contrato antigo com fim no aniversário;
 *  - CO2: contrato não-ATIVO não gera previsão; cancelar o contrato CANCELA as previsões não
 *    faturadas e as OS agendadas intocadas; reativar regenera dali em diante;
 *  - CO3: proposta de CONTRATO assinada NÃO vira conta avulsa (orçamento comum continua virando);
 *  - C6/D3: gerar-mes LIGA a medição à previsão da competência (não cria conta nova); a aprovação
 *    do cliente PROMOVE a mesma conta (nunca nasce uma segunda); a NF a libera (A_RECEBER).
 *    Uma conta só, do começo ao fim;
 *  - F5: boleto do Inter é RECUSADO em conta PREVISTO; PREVISTO vencida não vira ATRASADO;
 *    o portal do cliente não lista PREVISTO (só A_RECEBER/ATRASADO);
 *  - cancelar a medição devolve a conta do contrato a PREVISTO (desligada) — o mês refatura (F4);
 *  - D3/D4: contrato CONSOLIDADO leva itens executados + adicionais com preço das OS do mês para a
 *    fatura mensal (e a OS fica faturada pela trava única); SEPARADO não leva;
 *  - D1: dadosRelatorioMensalContrato devolve o resumo das OS do mês (nº, equipamentos, valores,
 *    "incluso no contrato" sem preço), os relatórios do período e a PRÓXIMA manutenção agendada;
 *  - SQL 2026-10-23_contrato_previsao.sql idempotente (2×) com backfill ligando conta antiga.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva5-contrato
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva5_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const inter = vi.hoisted(() => ({ emitir: vi.fn() }));
vi.mock("@/lib/inter-api", () => ({
  emitirBoletoInter: inter.emitir,
  cancelarBoletoInter: vi.fn(),
  carregarConfigInter: vi.fn(async () => ({ ativo: true, config: {} })),
  consultarBoletoInter: vi.fn(),
  testarConexaoInter: vi.fn(),
  configurarWebhookInter: vi.fn(),
}));
// E-mail nunca sai em teste
vi.mock("@/lib/email", () => ({ enviarBoleto: vi.fn(async () => {}), enviarMedicao: vi.fn(async () => {}) }));

const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null };
}

const ASSINATURA = { nome: "Maria Gestora", cpf: "390.533.447-05", assinaturaUrl: `data:image/png;base64,${"A".repeat(40)}` };
const agora = new Date();
const MES = agora.getMonth() + 1;
const ANO = agora.getFullYear();

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Leva 5 — contrato × previsão × medição (PostgreSQL real)", () => {
  let prisma: any;
  let seqCt = 0;
  let seqOs = 0;

  const novoContrato = async (dados: Record<string, unknown> = {}) =>
    prisma.contrato.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: `CT-5${String(++seqCt).padStart(3, "0")}`,
      tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", valorMensal: 1000,
      dataInicio: new Date(ANO, MES - 1, 1), // começa no mês corrente (previsões todas futuras)
      ...dados,
    } });

  const novaOsDoContrato = async (contratoId: string, dados: Record<string, unknown> = {}) =>
    prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: `OS-5${String(++seqOs).padStart(3, "0")}`, clienteId: "c1",
      criadoPorId: "uA", status: "CONCLUIDA", origem: "MANUAL", descricao: "Chamado do mês",
      dataConclusao: new Date(ANO, MES - 1, 10), contratoId, ...dados,
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
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11", diaFaturamento: 5 } });
    comoAdmin();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  // ═══════════ CO4 + C6 — 12 meses = 12 previsões, ligadas e idempotentes ═══════════

  it("CO4: vigência de 12 meses gera 12 previsões (não 13), cada uma ligada a contrato+competência; 2ª rodada não duplica", async () => {
    const { gerarPrevisaoContratoContasReceber } = await import("@/lib/financeiro-server");
    const { calcularDataFimContrato } = await import("@/lib/utils");

    const inicio = new Date(ANO, MES - 1, 1);
    // Forma nova: fim = início + 12 meses - 1 dia (último dia do 12º mês), e não o aniversário
    const fim12 = calcularDataFimContrato(inicio, 12)!;
    const ultimoDia = new Date(ANO + 1, MES - 1, 0); // véspera do aniversário
    expect([fim12.getFullYear(), fim12.getMonth(), fim12.getDate()]).toEqual([ultimoDia.getFullYear(), ultimoDia.getMonth(), ultimoDia.getDate()]);
    const ct = await novoContrato({ dataInicio: inicio, dataFim: fim12 });
    expect(await gerarPrevisaoContratoContasReceber(ct.id)).toBe(12);
    const contas = await prisma.contaReceber.findMany({ where: { contratoId: ct.id }, orderBy: [{ refAno: "asc" }, { refMes: "asc" }] });
    expect(contas).toHaveLength(12);
    expect(contas.every((c: any) => c.status === "PREVISTO" && c.refAno && c.refMes)).toBe(true);
    expect([contas[0].refMes, contas[0].refAno]).toEqual([MES, ANO]);

    // Idempotente
    expect(await gerarPrevisaoContratoContasReceber(ct.id)).toBe(0);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id } })).toBe(12);

    // Contrato ANTIGO com fim exatamente no aniversário (01/01 → 01/01) também dá 12
    const ctLegado = await novoContrato({ dataInicio: inicio, dataFim: new Date(ANO + 1, MES - 1, 1) });
    expect(await gerarPrevisaoContratoContasReceber(ctLegado.id)).toBe(12);
  });

  // ═══════════ CO2 — contrato não-ATIVO não gera e limpa a receita fantasma ═══════════

  it("CO2: cancelado/vencido/em renovação não geram previsão; cancelar limpa PREVISTO + OS futura intocada; reativar regenera", async () => {
    const { gerarPrevisaoContratoContasReceber } = await import("@/lib/financeiro-server");

    for (const status of ["CANCELADO", "VENCIDO", "EM_RENOVACAO", "SUSPENSO"]) {
      const ct = await novoContrato({ status });
      expect(await gerarPrevisaoContratoContasReceber(ct.id)).toBe(0);
    }

    // Contrato ativo com previsões + 1 OS agendada futura intocada + 1 conta RECEBIDA antiga
    const ct = await novoContrato({ dataFim: new Date(ANO, MES - 1 + 5, 1) });
    await gerarPrevisaoContratoContasReceber(ct.id);
    const antes = await prisma.contaReceber.count({ where: { contratoId: ct.id, status: "PREVISTO" } });
    expect(antes).toBeGreaterThan(0);
    const recebida = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", contratoId: ct.id, numero: `${ct.numero}/PAGA`,
      descricao: "Mês já recebido", valor: 1000, status: "RECEBIDO",
    } });
    const osFutura = await novaOsDoContrato(ct.id, { status: "AGENDADA", dataConclusao: null });
    await prisma.atividadeOs.create({ data: {
      empresaId: "e1", ordemServicoId: osFutura.id, titulo: "Preventiva futura", status: "AGENDADA",
      dataAgendada: new Date(Date.now() + 30 * 86400000),
    } });
    const osEmCurso = await novaOsDoContrato(ct.id, { status: "EM_ANDAMENTO", dataConclusao: null });

    // Cancela pela rota de status (o mesmo caminho da tela)
    const r = await chamar("contratos/[id]/status", "PATCH", { id: ct.id }, { status: "CANCELADO", motivo: "Cliente saiu" });
    expect(r.status).toBe(200);

    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id, status: "PREVISTO" } })).toBe(0);
    expect((await prisma.contaReceber.findUnique({ where: { id: recebida.id } })).status).toBe("RECEBIDO"); // intocada
    expect((await prisma.ordemServico.findUnique({ where: { id: osFutura.id } })).status).toBe("CANCELADA");
    expect((await prisma.ordemServico.findUnique({ where: { id: osEmCurso.id } })).status).toBe("EM_ANDAMENTO"); // intocada

    // Reativar regenera as previsões futuras
    const r2 = await chamar("contratos/[id]/status", "PATCH", { id: ct.id }, { status: "ATIVO" });
    expect(r2.status).toBe(200);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id, status: "PREVISTO" } })).toBeGreaterThan(0);
  });

  // ═══════════ CO3 — proposta de contrato não vira conta avulsa ═══════════

  it("CO3: aprovar proposta de CONTRATO não cria conta; orçamento COMUM continua criando", async () => {
    const base = {
      empresaId: "e1", clienteId: "c1", criadoPorId: "uA", status: "ENVIADO" as const,
      totalGeral: 5000, validadeEm: new Date(Date.now() + 7 * 86400000),
    };
    const proposta = await prisma.orcamento.create({ data: { ...base, codigo: "ORC-5001", nome: "Proposta contrato", tipo: "PROPOSTA_CONTRATO", tokenPublico: crypto.randomUUID() } });
    const comum = await prisma.orcamento.create({ data: { ...base, codigo: "ORC-5002", nome: "Instalação avulsa", tipo: "COMUM", tokenPublico: crypto.randomUUID() } });

    const r1 = await chamar("publico/orcamentos/[token]/aprovar", "POST", { token: proposta.tokenPublico }, ASSINATURA);
    expect(r1.status).toBe(200);
    expect(await prisma.contaReceber.count({ where: { orcamentoId: proposta.id } })).toBe(0);

    const r2 = await chamar("publico/orcamentos/[token]/aprovar", "POST", { token: comum.tokenPublico }, ASSINATURA);
    expect(r2.status).toBe(200);
    expect(await prisma.contaReceber.count({ where: { orcamentoId: comum.id } })).toBe(1);
  });

  // ═══════════ C6/D3 — uma conta só: previsão → medição → aprovação → NF ═══════════

  it("C6/D3: gerar-mes liga a medição à previsão (sem conta nova); aprovação promove a MESMA conta; NF libera A_RECEBER", async () => {
    await prisma.cliente.create({ data: { id: "c5", empresaId: "e1", nome: "Condomínio", cpfCnpj: "55.555.555/0001-55" } });
    const ct = await novoContrato({ clienteId: "c5", valorMensal: 2000 });
    const { gerarPrevisaoContratoContasReceber } = await import("@/lib/financeiro-server");
    await gerarPrevisaoContratoContasReceber(ct.id);
    const previsao = await prisma.contaReceber.findFirst({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } });
    expect(previsao).toBeTruthy();

    const r = await chamar("medicoes/gerar-mes", "POST", {}, { mes: MES, ano: ANO });
    expect(r.status).toBe(200);
    const medicao = await prisma.medicao.findFirst({ where: { contratoId: ct.id, mes: MES, ano: ANO } });
    expect(medicao).toBeTruthy();

    // A previsão foi LIGADA — nenhuma conta nova nasceu
    const ligada = await prisma.contaReceber.findUnique({ where: { id: previsao.id } });
    expect([ligada.medicaoId, ligada.status]).toEqual([medicao.id, "PREVISTO"]);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } })).toBe(1);

    // Envia e o cliente aprova no link público → a MESMA conta continua sendo a única
    await chamar("medicoes/[id]/acao", "POST", { id: medicao.id }, { acao: "ENVIAR" });
    const ap = await chamar("publico/medicoes/[token]/aprovar", "POST", { token: medicao.tokenPublico }, ASSINATURA);
    expect(ap.status).toBe(200);
    expect(await prisma.contaReceber.count({ where: { medicaoId: medicao.id } })).toBe(1);

    // PC + NF → conta A_RECEBER (liberada para cobrança), ainda a mesma
    const med1 = await prisma.medicao.findUnique({ where: { id: medicao.id } });
    if (med1.status === "AGUARDANDO_PC") await chamar("medicoes/[id]/acao", "POST", { id: medicao.id }, { acao: "REGISTRAR_PC", pcNumero: "PC-1" });
    const nf = await chamar("medicoes/[id]/acao", "POST", { id: medicao.id }, { acao: "REGISTRAR_NF", nfNumero: "NF-123" });
    expect(nf.status).toBe(200);
    const final = await prisma.contaReceber.findUnique({ where: { id: previsao.id } });
    expect([final.status, Number(final.valor)]).toEqual(["A_RECEBER", 2000]);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } })).toBe(1);
  });

  // ═══════════ F5 — PREVISTO não cobra: boleto recusado, sem ATRASADO, fora do portal ═══════════

  it("F5: boleto recusado em PREVISTO; PREVISTO vencida não vira ATRASADO; portal não lista PREVISTO", async () => {
    const ct = await novoContrato();
    const vencida = await prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", contratoId: ct.id, refMes: 1, refAno: ANO - 1, numero: `${ct.numero}/${ANO - 1}01`,
      descricao: "Previsão vencida", valor: 1000, status: "PREVISTO", dataVencimento: new Date(ANO - 1, 0, 5),
    } });

    const r = await chamar("contas-receber/[id]/boleto", "POST", { id: vencida.id }, {});
    expect(r.status).toBe(400);
    expect(r.json.erro).toContain("PREVISÃO");
    expect(inter.emitir).not.toHaveBeenCalled();

    // resumoFinanceiro marca vencidas — mas NUNCA a PREVISTO
    const { resumoFinanceiro } = await import("@/lib/financeiro-server");
    await resumoFinanceiro("e1");
    expect((await prisma.contaReceber.findUnique({ where: { id: vencida.id } })).status).toBe("PREVISTO");

    // Portal: a lista de cobranças do cliente não inclui PREVISTO
    const { STATUS_CONTA_PORTAL } = await import("@/lib/portal-server");
    expect(STATUS_CONTA_PORTAL).not.toContain("PREVISTO");
    const doPortal = await prisma.contaReceber.findMany({ where: { empresaId: "e1", clienteId: "c1", status: { in: [...STATUS_CONTA_PORTAL] } }, select: { id: true } });
    expect(doPortal.map((c: any) => c.id)).not.toContain(vencida.id);

    // Em A_RECEBER o boleto passa da trava (o mock emite)
    inter.emitir.mockResolvedValueOnce({ codigoSolicitacao: "sol-1", nossoNumero: "1", linhaDigitavel: "x", codigoBarras: "y" });
    await prisma.contaReceber.update({ where: { id: vencida.id }, data: { status: "A_RECEBER" } });
    const ok = await chamar("contas-receber/[id]/boleto", "POST", { id: vencida.id }, {});
    expect([ok.status, ok.json?.erro ?? null]).toEqual([201, null]);
    expect(inter.emitir).toHaveBeenCalledTimes(1);
  });

  // ═══════════ Cancelar medição devolve a previsão (refatura) ═══════════

  it("cancelar a medição DESLIGA a conta do contrato (volta a PREVISTO com a mensalidade) e o mês refatura", async () => {
    await prisma.cliente.create({ data: { id: "c6", empresaId: "e1", nome: "Escola", cpfCnpj: "66.666.666/0001-66" } });
    const ct = await novoContrato({ clienteId: "c6", valorMensal: 1500 });
    const { gerarPrevisaoContratoContasReceber } = await import("@/lib/financeiro-server");
    await gerarPrevisaoContratoContasReceber(ct.id);
    await chamar("medicoes/gerar-mes", "POST", {}, { mes: MES, ano: ANO });
    const medicao = await prisma.medicao.findFirst({ where: { contratoId: ct.id, mes: MES, ano: ANO } });

    await chamar("medicoes/[id]/acao", "POST", { id: medicao.id }, { acao: "CANCELAR" });
    const conta = await prisma.contaReceber.findFirst({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } });
    expect([conta.status, conta.medicaoId, Number(conta.valor)]).toEqual(["PREVISTO", null, 1500]);

    // Refaturar o mês liga de novo na MESMA conta
    await chamar("medicoes/gerar-mes", "POST", {}, { mes: MES, ano: ANO });
    const medicao2 = await prisma.medicao.findFirst({ where: { contratoId: ct.id, mes: MES, ano: ANO, status: { not: "CANCELADA" } } });
    expect(medicao2.id).not.toBe(medicao.id);
    const religada = await prisma.contaReceber.findUnique({ where: { id: conta.id } });
    expect(religada.medicaoId).toBe(medicao2.id);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } })).toBe(1);
  });

  // ═══════════ D3/D4 — consolidado × separado ═══════════

  it("CONSOLIDADO: itens executados + adicionais com preço das OS do mês entram na fatura mensal e a OS fica faturada; SEPARADO não entra", async () => {
    // Cliente separado para não misturar com as medições dos testes anteriores
    await prisma.cliente.create({ data: { id: "c2", empresaId: "e1", nome: "Shopping", cpfCnpj: "22.222.222/0001-22" } });
    const ct = await novoContrato({ clienteId: "c2", valorMensal: 3000, faturamentoAdicionais: "CONSOLIDADO" });
    const os = await novaOsDoContrato(ct.id, { clienteId: "c2" });
    await prisma.osItemOrcamento.createMany({ data: [
      { ordemServicoId: os.id, descricao: "Troca de filtro", quantidade: 2, valorUnitario: 100, valorTotal: 200, executado: true },
      { ordemServicoId: os.id, descricao: "Não executado", quantidade: 1, valorUnitario: 999, valorTotal: 999, executado: false },
    ] });
    const atv = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Visita", status: "CONCLUIDA" } });
    await prisma.servicoAdicional.create({ data: {
      empresaId: "e1", ordemServicoId: os.id, atividadeId: atv.id, descricao: "Gás extra", statusCobranca: "COBRAR", valor: 300,
    } });

    // os2 do mesmo mês já faturada pelo BOTÃO da OS antes do gerar-mes: não pode entrar de novo
    const os2 = await novaOsDoContrato(ct.id, { clienteId: "c2" });
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os2.id, descricao: "Peça avulsa", quantidade: 1, valorUnitario: 400, valorTotal: 400, executado: true } });
    const botao = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os2.id });
    expect(botao.status).toBe(201);

    const r = await chamar("medicoes/gerar-mes", "POST", {}, { mes: MES, ano: ANO });
    expect(r.status).toBe(200);
    const medicao = await prisma.medicao.findFirst({ where: { contratoId: ct.id, mes: MES, ano: ANO }, include: { itens: true } });
    expect(Number(medicao.valorTotal)).toBe(3000 + 200 + 300); // mensalidade + executado + adicional (não-executado e os2 já faturada FORA)
    expect(medicao.itens.some((i: any) => i.ordemServicoId === os.id)).toBe(true);
    expect(medicao.itens.some((i: any) => i.ordemServicoId === os2.id)).toBe(false);

    // Aprovação manual PROMOVE a previsão ligada para o valor consolidado da medição
    await chamar("medicoes/[id]/acao", "POST", { id: medicao.id }, { acao: "ENVIAR" });
    await chamar("medicoes/[id]/acao", "POST", { id: medicao.id }, { acao: "APROVAR_MANUAL" });
    const contaCons = await prisma.contaReceber.findFirst({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } });
    expect([contaCons.medicaoId, Number(contaCons.valor)]).toEqual([medicao.id, 3500]);
    expect(await prisma.contaReceber.count({ where: { medicaoId: medicao.id } })).toBe(1);

    // A OS entrou na trava única: o botão da OS devolve a MESMA medição
    const rep = await chamar("ordens/[id]/gerar-medicao", "POST", { id: os.id });
    expect([rep.json.id, rep.json.jaExistia]).toEqual([medicao.id, true]);

    // SEPARADO: a OS do mês NÃO entra na fatura mensal
    await prisma.cliente.create({ data: { id: "c3", empresaId: "e1", nome: "Padaria", cpfCnpj: "33.333.333/0001-33" } });
    const ctSep = await novoContrato({ clienteId: "c3", valorMensal: 500 }); // SEPARADO (padrão)
    const osSep = await novaOsDoContrato(ctSep.id, { clienteId: "c3" });
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: osSep.id, descricao: "Serviço", quantidade: 1, valorUnitario: 80, valorTotal: 80, executado: true } });
    await chamar("medicoes/gerar-mes", "POST", {}, { mes: MES, ano: ANO });
    const medSep = await prisma.medicao.findFirst({ where: { contratoId: ctSep.id, mes: MES, ano: ANO } });
    expect(Number(medSep.valorTotal)).toBe(500); // só a mensalidade — o avulso sai pela medição da OS
  });

  it("medição de contrato criada por fora ADOTA a previsão da competência na aprovação (nunca nasce 2ª conta)", async () => {
    await prisma.cliente.create({ data: { id: "c7", empresaId: "e1", nome: "Hotel", cpfCnpj: "77.777.777/0001-77" } });
    const ct = await novoContrato({ clienteId: "c7", valorMensal: 999 });
    const { gerarPrevisaoContratoContasReceber, gerarContaReceberDaMedicao } = await import("@/lib/financeiro-server");
    await gerarPrevisaoContratoContasReceber(ct.id);

    const medicao = await prisma.medicao.create({ data: {
      empresaId: "e1", clienteId: "c7", contratoId: ct.id, numero: "MED-MANUAL-1", tipo: "MENSAL_FIXO",
      mes: MES, ano: ANO, status: "PC_RECEBIDO", valorTotal: 999, valorLiquido: 999, tokenPublico: crypto.randomUUID(),
    } });
    const conta = await gerarContaReceberDaMedicao(medicao.id);
    expect(conta.contratoId).toBe(ct.id);
    expect(await prisma.contaReceber.count({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } })).toBe(1);
    expect((await prisma.contaReceber.findFirst({ where: { contratoId: ct.id, refMes: MES, refAno: ANO } })).medicaoId).toBe(medicao.id);
  });

  // ═══════════ D1 — relatório mensal consolidado ═══════════

  it("D1: o relatório mensal traz resumo das OS do mês (nº, equipamentos, preço × incluso), relatório do período e a PRÓXIMA manutenção", async () => {
    await prisma.cliente.create({ data: { id: "c4", empresaId: "e1", nome: "Clínica", cpfCnpj: "44.444.444/0001-44" } });
    const ct = await novoContrato({ clienteId: "c4", valorMensal: 900 });
    const unidade = await prisma.unidade.create({ data: { id: "un4", empresaId: "e1", clienteId: "c4", nome: "Matriz" } });
    const eq = await prisma.equipamento.create({ data: { empresaId: "e1", unidadeId: unidade.id, tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTX", nome: "Split recepção" } });

    const os = await novaOsDoContrato(ct.id, { clienteId: "c4", descricao: "Preventiva mensal" });
    const atv = await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Preventiva", status: "CONCLUIDA" } });
    await prisma.atividadeEquipamento.create({ data: { atividadeId: atv.id, equipamentoId: eq.id, feito: true } });
    await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, descricao: "Higienização", quantidade: 1, valorUnitario: 250, valorTotal: 250, executado: true } });
    await prisma.servicoAdicional.create({ data: { empresaId: "e1", ordemServicoId: os.id, atividadeId: atv.id, descricao: "Ajuste de dreno", statusCobranca: "NAO_COBRAR" } });
    const rel = await prisma.relatorioOs.create({ data: {
      empresaId: "e1", ordemServicoId: os.id, contratoId: ct.id, numero: "REL-5001", tipo: "MANUTENCAO",
      escopo: "GERAL", mesReferencia: MES, anoReferencia: ANO, tokenPublico: crypto.randomUUID(),
    } });

    // OS de OUTRO mês não entra no resumo deste
    await novaOsDoContrato(ct.id, { clienteId: "c4", dataConclusao: new Date(ANO, MES - 2, 15) });

    // Próxima preventiva agendada (uma visita ATRASADA no passado não é "próxima")
    const osProx = await novaOsDoContrato(ct.id, { clienteId: "c4", status: "AGENDADA", dataConclusao: null });
    const daqui20 = new Date(Date.now() + 20 * 86400000);
    await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: osProx.id, titulo: "Visita atrasada", status: "AGENDADA", dataAgendada: new Date(Date.now() - 5 * 86400000) } });
    await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: osProx.id, titulo: "Próxima preventiva", status: "AGENDADA", dataAgendada: daqui20 } });

    await chamar("medicoes/gerar-mes", "POST", {}, { mes: MES, ano: ANO });
    const medicao = await prisma.medicao.findFirst({ where: { contratoId: ct.id, mes: MES, ano: ANO } });

    const { dadosRelatorioMensalContrato } = await import("@/lib/relatorio-mensal-contrato");
    const dados = await dadosRelatorioMensalContrato(medicao.id);
    expect(dados).toBeTruthy();
    expect(dados!.contratoNumero).toBe(ct.numero);
    expect(dados!.valorMensal).toBe(900);
    expect(dados!.ossDoMes).toHaveLength(1);
    const resumo = dados!.ossDoMes[0];
    expect(resumo.numero).toBe(os.numero);
    expect(resumo.equipamentos).toContain("Split recepção");
    const higien = resumo.linhas.find((l) => l.descricao.includes("Higienização"));
    expect(higien?.valorTotal).toBe(250);
    const dreno = resumo.linhas.find((l) => l.descricao.includes("Ajuste de dreno"));
    expect(dreno?.valorTotal).toBeNull(); // sem cobrança → "incluso no contrato"
    expect(dados!.relatoriosDoMes).toContain(rel.tokenPublico);
    expect(dados!.proximaPreventiva?.data.toISOString().slice(0, 10)).toBe(daqui20.toISOString().slice(0, 10));
  });

  // ═══════════ SQL 🔵 ═══════════

  it("SQL 2026-10-23: roda 2× num schema de produção simulado; backfill liga conta antiga; duplicada solta o vínculo", () => {
    const URL = process.env.PG_TESTE_URL!;
    const PROD = `${SCHEMA}_prod`;
    const psql = (args: string[], schema = PROD) => execFileSync("psql", [URL, "-v", "ON_ERROR_STOP=1", "-q", ...args], {
      env: { ...process.env, PGOPTIONS: `--search_path=${schema}` }, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    // Banco "de produção": tabelas SEM as colunas novas + uma previsão antiga pelo numero + uma duplicada
    psql(["-c", `DROP SCHEMA IF EXISTS "${PROD}" CASCADE; CREATE SCHEMA "${PROD}";`], "public");
    psql(["-c", `CREATE TABLE "${PROD}"."contratos" (id TEXT PRIMARY KEY, empresa_id TEXT, cliente_id TEXT, numero TEXT)`]);
    psql(["-c", `CREATE TABLE "${PROD}"."contas_receber" (id TEXT PRIMARY KEY, empresa_id TEXT, cliente_id TEXT, numero TEXT, criado_em TIMESTAMP DEFAULT now())`]);
    psql(["-c", `INSERT INTO "${PROD}"."contratos" VALUES ('ctx','e1','c1','CT-OLD-1')`]);
    psql(["-c", `INSERT INTO "${PROD}"."contas_receber"(id, empresa_id, cliente_id, numero, criado_em) VALUES
      ('cra','e1','c1','CT-OLD-1/202603', now() - interval '2 days'),
      ('crdup','e1','c1','CT-OLD-1/202603', now()),
      ('crb','e1','c1','CR-2026-0001', now())`]);

    const rodar = () => psql(["-f", path.join(RAIZ, "prisma/sql/2026-10-23_contrato_previsao.sql")]);
    rodar();
    rodar(); // idempotente

    const linha = (sql: string) => execFileSync("psql", [URL, "-At", "-c", sql], { encoding: "utf8" }).trim();
    // Backfill ligou a antiga (a MAIS ANTIGA fica; a duplicada solta o vínculo; a avulsa fica de fora)
    expect(linha(`SELECT contrato_id || '|' || ref_mes || '|' || ref_ano FROM "${PROD}"."contas_receber" WHERE id = 'cra'`)).toBe("ctx|3|2026");
    expect(linha(`SELECT COALESCE(contrato_id, 'NULO') FROM "${PROD}"."contas_receber" WHERE id = 'crdup'`)).toBe("NULO");
    expect(linha(`SELECT COALESCE(contrato_id, 'NULO') FROM "${PROD}"."contas_receber" WHERE id = 'crb'`)).toBe("NULO");
    // Colunas novas no lugar
    expect(linha(`SELECT udt_name FROM information_schema.columns WHERE table_schema = '${PROD}' AND table_name = 'contratos' AND column_name = 'faturamento_adicionais'`)).toContain("FaturamentoAdicionais");
    // Catálogos diretos (pg_indexes quebra com DROP SCHEMA concorrente — flake conhecido)
    expect(linha(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${PROD}' AND c.relname = 'contas_receber_contrato_id_ref_ano_ref_mes_key'`)).toBe("1");
    psql(["-c", `DROP SCHEMA IF EXISTS "${PROD}" CASCADE`], "public");
  });
});
