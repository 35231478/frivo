/**
 * DESPESA RECORRENTE (contas a pagar) — as rotas num PostgreSQL real (schema descartável).
 *
 *  - criar a regra gera uma conta por competência, até o término (ou até o horizonte de 12 meses);
 *  - o DEDUP não dobra: gerar de novo (cron, botão, corrida) não cria a mesma competência duas vezes;
 *  - editar com escopo "só esta" muda uma conta; "esta e as próximas" muda a regra e as futuras em
 *    aberto — e NUNCA a conta paga (nem a parcialmente paga, nem a cancelada);
 *  - pular uma ocorrência CANCELA a conta e a regra segue valendo (o mês seguinte nasce);
 *  - pausar e encerrar não deixam conta fantasma: as futuras em aberto são canceladas, o pago fica;
 *  - encerrar é o que "excluir" faz: nada é apagado;
 *  - o favorecido pode ser fornecedor ou colaborador;
 *  - sem "Financeiro › Fluxo de caixa" toda rota de escrita é 403 e o banco fica IDÊNTICO;
 *  - nada atravessa de outra empresa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/conta-pagar-recorrencia-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_recorrente_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** "Hoje": 16/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-16T15:00:00Z");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const entrar = (permissoes: Permissoes, empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const gestao = (empresaId = "e1") => entrar(permissoesTotais(), empresaId);
const SO_VE = () => entrar(montarPermissoes({ financeiro: ["visualizar", "contasReceber"] }));

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const R = {
  contas: "contas-pagar",
  conta: "contas-pagar/[id]",
  pular: "contas-pagar/[id]/pular",
  pagamentos: "contas-pagar/[id]/pagamentos",
  regras: "contas-pagar/recorrencias",
  regra: "contas-pagar/recorrencias/[id]",
  acao: "contas-pagar/recorrencias/[id]/acao",
};

const REGRA = (x: Record<string, unknown> = {}) => ({
  descricao: "Aluguel do galpão", fornecedorId: "f1", categoriaId: null, centroCustoId: null,
  passoMeses: 1, diaVencimento: 10, ajusteDiaNaoUtil: "MANTER", valor: 2500, valorEstimado: false,
  inicioAno: 2026, inicioMes: 11, ...x,
});

describe.skipIf(!URL_PG)("Despesa recorrente (contas a pagar) — PostgreSQL real", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.fornecedor.createMany({ data: [
      { id: "f1", empresaId: "e1", nome: "Imobiliária Centro" },
      { id: "fE2", empresaId: "e2", nome: "Fornecedor da outra" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "Carlos Dias", cpf: "1", telefone: "1" } });
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    if (URL_PG) execFileSync("psql", [URL_PG, "-q", "-c", `DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.setSystemTime(AGORA);
    await prisma.contaPagar.deleteMany({});
    await prisma.contaPagarRecorrencia.deleteMany({});
    gestao();
  });

  const criar = async (x: Record<string, unknown> = {}) => {
    const r = await chamar(R.regras, "POST", {}, REGRA(x));
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json as { id: string; contasGeradas: number };
  };
  const contasDa = async (recorrenciaId: string) =>
    (await prisma.contaPagar.findMany({ where: { recorrenciaId }, orderBy: [{ refAno: "asc" }, { refMes: "asc" }] }))
      .map((c: any) => `${c.refAno}-${String(c.refMes).padStart(2, "0")}|${c.status}|${Number(c.valorTotal)}|${c.dataVencimento?.toISOString().slice(0, 10)}`);

  /* ───────── gerar e não dobrar ───────── */

  it("criar a regra gera uma conta por mês até o horizonte, com a descrição e o vencimento de cada competência", async () => {
    const regra = await criar();
    expect(regra.contasGeradas).toBe(13); // nov/2026 até nov/2027
    const contas = await contasDa(regra.id);
    expect(contas[0]).toBe("2026-11|PENDENTE|2500|2026-11-10");
    expect(contas.at(-1)).toBe("2027-11|PENDENTE|2500|2027-11-10");
    const primeira = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 11, refAno: 2026 } });
    expect(primeira.descricao).toBe("Aluguel do galpão — nov/2026");
    expect([primeira.fornecedor, primeira.fornecedorId, primeira.valorEstimado]).toEqual(["Imobiliária Centro", "f1", false]);
  });

  it("o DEDUP não dobra: gerar de novo (cron ou botão) não cria a mesma competência duas vezes", async () => {
    const regra = await criar();
    const antes = await prisma.contaPagar.count();
    const numeros = async () => (await prisma.contaPagar.findMany({ select: { numero: true }, orderBy: { numero: "asc" } })).map((c: any) => c.numero);
    const numerosAntes = await numeros();
    // uma conta avulsa antes e outra depois das rodadas à toa: o contador tem de andar exatamente 1
    const avulsa = async () => {
      const r = await chamar(R.contas, "POST", {}, { fornecedorId: "f1", descricao: "Avulsa", valorTotal: 10 });
      expect(r.status).toBe(201);
      await prisma.contaPagar.delete({ where: { id: r.json.id } });
      return Number(String(r.json.numero).match(/(\d+)$/)![1]);
    };
    const antesDoNumero = await avulsa();
    for (let i = 0; i < 3; i++) {
      const r = await chamar(R.acao, "POST", { id: regra.id }, { acao: "GERAR" });
      expect([r.status, r.json.contas]).toEqual([200, 0]);
    }
    expect(await prisma.contaPagar.count()).toBe(antes);
    expect(await numeros()).toEqual(numerosAntes);
    // a rodada à toa não gasta número de conta a pagar: a numeração não anda sozinha
    expect(await avulsa()).toBe(antesDoNumero + 1);
    // e o banco recusa na raiz: a competência é única por regra
    await expect(prisma.contaPagar.create({
      data: {
        empresaId: "e1", numero: "X-1", recorrenciaId: regra.id, refAno: 2026, refMes: 11, fornecedor: "X",
        descricao: "duplicata", valorTotal: 1, saldoRestante: 1, status: "PENDENTE",
      },
    })).rejects.toThrow();
  });

  it("trimestral não multiplica o valor e salta de 3 em 3; término por ocorrências para na conta certa", async () => {
    const regra = await criar({ passoMeses: 3, ocorrencias: 3, valor: 900 });
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|900|2026-11-10", "2027-02|PENDENTE|900|2027-02-10", "2027-05|PENDENTE|900|2027-05-10",
    ]);
  });

  it("término por data final: a última competência é a do fim, e nada nasce depois", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 1 });
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|2500|2026-11-10", "2026-12|PENDENTE|2500|2026-12-10", "2027-01|PENDENTE|2500|2027-01-10",
    ]);
  });

  it("o ajuste de fim de semana vale em cada ocorrência (10/01/2027 é domingo)", async () => {
    const regra = await criar({ ajusteDiaNaoUtil: "ADIANTAR", fimAno: 2027, fimMes: 1 });
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|2500|2026-11-10", "2026-12|PENDENTE|2500|2026-12-10", "2027-01|PENDENTE|2500|2027-01-08",
    ]);
  });

  it("valor estimado: a conta nasce 'a confirmar' e o favorecido pode ser colaborador", async () => {
    const regra = await criar({ fornecedorId: null, tecnicoId: "t1", valorEstimado: true, descricao: "Pró-labore", fimAno: 2026, fimMes: 12 });
    const contas = await prisma.contaPagar.findMany({ where: { recorrenciaId: regra.id } });
    expect(contas.every((c: any) => c.valorEstimado)).toBe(true);
    expect([contas[0].fornecedor, contas[0].tecnicoId, contas[0].fornecedorId]).toEqual(["Carlos Dias", "t1", null]);
  });

  /* ───────── editar com escopo ───────── */

  it("'só esta' muda uma conta; a regra e as outras ficam como estavam", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 1 });
    const alvo = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 12 } });
    const r = await chamar(R.conta, "PUT", { id: alvo.id }, { valorTotal: 3000, escopo: "ESTA" });
    expect(r.status).toBe(200);
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|2500|2026-11-10", "2026-12|PENDENTE|3000|2026-12-10", "2027-01|PENDENTE|2500|2027-01-10",
    ]);
    expect(Number((await prisma.contaPagarRecorrencia.findUnique({ where: { id: regra.id } })).valor)).toBe(2500);
  });

  it("'esta e as próximas' muda a regra daqui para a frente e as futuras em aberto", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 2 });
    const alvo = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 12 } });
    const r = await chamar(R.conta, "PUT", { id: alvo.id }, { valorTotal: 3000, escopo: "ESTA_E_PROXIMAS" });
    expect(r.status).toBe(200);
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|2500|2026-11-10", // o passado não muda
      "2026-12|PENDENTE|3000|2026-12-10", "2027-01|PENDENTE|3000|2027-01-10", "2027-02|PENDENTE|3000|2027-02-10",
    ]);
    const depois = await prisma.contaPagarRecorrencia.findUnique({ where: { id: regra.id } });
    expect([Number(depois.valor), depois.inicioAno, depois.inicioMes]).toEqual([3000, 2026, 12]);
  });

  it("conta JÁ PAGA nunca muda, em nenhum escopo — e o pagamento continua lá", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 1 });
    const paga = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 11 } });
    expect((await chamar(R.pagamentos, "POST", { id: paga.id }, { valor: 2500, dataPagamento: "2026-11-10" })).status).toBe(201);
    expect((await prisma.contaPagar.findUnique({ where: { id: paga.id } })).status).toBe("PAGO_TOTAL");

    // editar a própria conta paga com escopo é recusado
    const r = await chamar(R.conta, "PUT", { id: paga.id }, { valorTotal: 9999, escopo: "ESTA_E_PROXIMAS" });
    expect([r.status, r.json.erro]).toEqual([409, "Conta já paga não muda: lance um estorno ou um ajuste."]);

    // e editando a de dezembro com alcance, a paga de novembro continua intacta
    const dez = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 12 } });
    expect((await chamar(R.conta, "PUT", { id: dez.id }, { valorTotal: 3000, escopo: "ESTA_E_PROXIMAS" })).status).toBe(200);
    const depois = await prisma.contaPagar.findUnique({ where: { id: paga.id }, include: { pagamentos: true } });
    expect([Number(depois.valorTotal), depois.status, depois.pagamentos.length]).toEqual([2500, "PAGO_TOTAL", 1]);
  });

  /* ───────── pular, pausar, encerrar ───────── */

  it("pular uma ocorrência cancela só aquela conta; a regra continua e o mês seguinte segue de pé", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 1 });
    const dez = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 12 } });
    expect((await chamar(R.pular, "POST", { id: dez.id })).status).toBe(200);
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|2500|2026-11-10", "2026-12|CANCELADO|2500|2026-12-10", "2027-01|PENDENTE|2500|2027-01-10",
    ]);
    expect((await prisma.contaPagarRecorrencia.findUnique({ where: { id: regra.id } })).situacao).toBe("ATIVA");
    // a conta continua existindo: pular é status, não exclusão
    expect(await prisma.contaPagar.count({ where: { recorrenciaId: regra.id } })).toBe(3);
  });

  it("pausar cancela as futuras em aberto e para de gerar; retomar regera do mês corrente", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 1 });
    expect((await chamar(R.acao, "POST", { id: regra.id }, { acao: "PAUSAR" })).json).toMatchObject({ ok: true, canceladas: 2 });
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|2500|2026-11-10", // o mês corrente fica: já está em curso
      "2026-12|CANCELADO|2500|2026-12-10", "2027-01|CANCELADO|2500|2027-01-10",
    ]);
    // pausada não gera
    expect((await chamar(R.acao, "POST", { id: regra.id }, { acao: "GERAR" })).json.contas).toBe(0);
    // retomar: as competências canceladas continuam canceladas (não ressuscitam), e nada é duplicado
    expect((await chamar(R.acao, "POST", { id: regra.id }, { acao: "RETOMAR" })).json).toMatchObject({ ok: true, contas: 0 });
    expect((await prisma.contaPagarRecorrencia.findUnique({ where: { id: regra.id } })).situacao).toBe("ATIVA");
    expect(await prisma.contaPagar.count({ where: { recorrenciaId: regra.id } })).toBe(3);
  });

  it("encerrar (o que 'excluir' faz) para de vez, não apaga nada e não deixa conta fantasma", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 1 });
    const paga = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 11 } });
    await chamar(R.pagamentos, "POST", { id: paga.id }, { valor: 2500, dataPagamento: "2026-11-10" });

    const r = await chamar(R.regra, "DELETE", { id: regra.id }, undefined, "?motivo=Mudamos de galpão");
    expect(r.status).toBe(200);
    const depois = await prisma.contaPagarRecorrencia.findUnique({ where: { id: regra.id } });
    expect([depois.situacao, depois.encerramentoMotivo]).toEqual(["ENCERRADA", "Mudamos de galpão"]);
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PAGO_TOTAL|2500|2026-11-10", // o pagamento não é desfeito
      "2026-12|CANCELADO|2500|2026-12-10", "2027-01|CANCELADO|2500|2027-01-10",
    ]);
    // a regra continua no banco (histórico), e encerrada não gera mais
    expect(await prisma.contaPagarRecorrencia.count({ where: { id: regra.id } })).toBe(1);
    expect((await chamar(R.acao, "POST", { id: regra.id }, { acao: "GERAR" })).json.contas).toBe(0);
    const edicao = await chamar(R.regra, "PUT", { id: regra.id }, { valor: 3000 });
    expect([edicao.status, edicao.json.erro]).toEqual([409, "Esta despesa recorrente já foi encerrada."]);
  });

  it("encurtar o término cancela o que ficou fora; esticar gera o que passou a caber", async () => {
    const regra = await criar({ fimAno: 2027, fimMes: 3 });
    expect((await contasDa(regra.id)).length).toBe(5);
    expect((await chamar(R.regra, "PUT", { id: regra.id }, { fimAno: 2026, fimMes: 12 })).status).toBe(200);
    expect(await contasDa(regra.id)).toEqual([
      "2026-11|PENDENTE|2500|2026-11-10", "2026-12|PENDENTE|2500|2026-12-10",
      "2027-01|CANCELADO|2500|2027-01-10", "2027-02|CANCELADO|2500|2027-02-10", "2027-03|CANCELADO|2500|2027-03-10",
    ]);
    expect((await chamar(R.regra, "PUT", { id: regra.id }, { fimAno: 2027, fimMes: 2 })).status).toBe(200);
    // as competências canceladas não voltam sozinhas; o que faltava (nada aqui) seria gerado
    expect(await prisma.contaPagar.count({ where: { recorrenciaId: regra.id } })).toBe(5);
  });

  /* ───────── permissão e multiempresa ───────── */

  it("sem Financeiro › Fluxo de caixa, toda escrita é 403 — e o banco fica idêntico", async () => {
    const regra = await criar({ fimAno: 2026, fimMes: 12 });
    const conta = await prisma.contaPagar.findFirst({ where: { recorrenciaId: regra.id, refMes: 12 } });
    const retrato = async () => ({
      regras: await prisma.contaPagarRecorrencia.findMany({ orderBy: { id: "asc" } }).then((l: any[]) => l.map((r) => `${r.id}|${r.situacao}|${Number(r.valor)}|${r.diaVencimento}`)),
      contas: await contasDa(regra.id),
      total: await prisma.contaPagar.count(),
    });
    const antes = await retrato();
    SO_VE();
    for (const [nome, chamada] of [
      ["criar regra", () => chamar(R.regras, "POST", {}, REGRA())],
      ["editar regra", () => chamar(R.regra, "PUT", { id: regra.id }, { valor: 1 })],
      ["encerrar regra", () => chamar(R.regra, "DELETE", { id: regra.id })],
      ["pausar", () => chamar(R.acao, "POST", { id: regra.id }, { acao: "PAUSAR" })],
      ["gerar", () => chamar(R.acao, "POST", { id: regra.id }, { acao: "GERAR" })],
      ["pular ocorrência", () => chamar(R.pular, "POST", { id: conta.id })],
      ["editar a conta com escopo", () => chamar(R.conta, "PUT", { id: conta.id }, { valorTotal: 1, escopo: "ESTA_E_PROXIMAS" })],
    ] as const) {
      const r = await chamada();
      expect([nome, r.status, r.json?.erro]).toEqual([nome, 403, "Sem permissão para esta ação"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("a regra de uma empresa não existe para a outra, e o fornecedor tem de ser da empresa", async () => {
    const regra = await criar({ fimAno: 2026, fimMes: 12 });
    gestao("e2");
    expect((await chamar(R.regra, "GET", { id: regra.id })).status).toBe(404);
    expect((await chamar(R.regra, "PUT", { id: regra.id }, { valor: 1 })).status).toBe(404);
    expect((await chamar(R.acao, "POST", { id: regra.id }, { acao: "PAUSAR" })).status).toBe(404);
    expect((await chamar(R.acao, "POST", { id: regra.id }, { acao: "GERAR" })).json.contas).toBe(0);
    gestao();
    const r = await chamar(R.regras, "POST", {}, REGRA({ fornecedorId: "fE2" }));
    expect(r.status).toBe(400);
  });

  it("sem favorecido, a regra é recusada; com regra inválida, a mensagem é a da casa", async () => {
    for (const [corpo, pedaco] of [
      [REGRA({ fornecedorId: null, tecnicoId: null }), "favorecido"],
      [REGRA({ fimAno: 2026, fimMes: 10 }), "antes do início"],
      [REGRA({ fimAno: 2027, fimMes: 1, ocorrencias: 3 }), "Término"],
    ] as const) {
      const r = await chamar(R.regras, "POST", {}, corpo);
      expect([r.status, String(r.json.erro)], JSON.stringify(corpo)).toEqual([400, expect.stringContaining(pedaco) as unknown as string]);
    }
    // dia e passo fora da faixa param na primeira porta (o schema da rota): 400 com mensagem, nunca erro técnico
    for (const corpo of [REGRA({ diaVencimento: 0 }), REGRA({ diaVencimento: 32 }), REGRA({ passoMeses: 0 })]) {
      const r = await chamar(R.regras, "POST", {}, corpo);
      expect([r.status, !!r.json.erro], JSON.stringify(corpo)).toEqual([400, true]);
      expect(String(r.json.erro)).not.toMatch(/prisma|undefined|\[object/i);
    }
  });
});
