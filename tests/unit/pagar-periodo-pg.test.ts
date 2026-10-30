/**
 * Contas a Pagar — período + cards do período (o mesmo padrão de Contas a Receber), PostgreSQL real e
 * a PÁGINA real (o componente de servidor devolve a tela com os props calculados):
 *  - o período é pelo VENCIMENTO (dia civil): mês corrente por padrão, bordas certas; `mes=`,
 *    intervalo `de/ate` e `periodo=todos`; as datas antigas do painel (dataInicio/dataFim) não valem mais;
 *  - cards: Vencidos · Vencem hoje · A vencer · Pagos · Total — abertos pelo SALDO (o pago parcial
 *    conta pelo que falta, em Vencidos/A vencer), "Pagos" pelo valor pago, "Total" sem as canceladas;
 *  - clicar no card filtra a lista; busca e painel filtram só a lista (os cards são do período);
 *  - só da empresa da sessão; rodapé com o total do filtro e o que está em aberto;
 *  - o dashboard financeiro leva às vencidas de TODO o período (não só às do mês).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pagar-periodo-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pagar_periodo_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));

/** "Agora": 15/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-15T15:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`); // vencimento = dia civil

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Contas a Pagar — período e cards (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;
  /** valor = valorTotal; pago = valorPago (o saldo é o resto) */
  const conta = (valor: number, status: string, venc: string | null, pago = status === "PAGO_TOTAL" ? valor : 0, dados: Record<string, unknown> = {}) =>
    prisma.contaPagar.create({ data: {
      empresaId: "e1", numero: `CP-${String(++seq).padStart(4, "0")}`, fornecedor: "Elétrica Central", fornecedorId: "f1",
      descricao: `Conta ${valor}`, valorTotal: valor, valorPago: pago, saldoRestante: valor - pago, status,
      dataVencimento: venc ? d(venc) : null, ...dados,
    } });

  /** Renderiza a página (componente de servidor) e devolve os props da tela */
  async function tela(sp: Record<string, string> = {}) {
    const { default: Pagina } = await import("@/app/(dashboard)/financeiro/contas-pagar/page");
    const el: any = await Pagina({ searchParams: Promise.resolve(sp) });
    return el.props as {
      resumo: Record<string, { q: number; v: number }>; contas: { numero: string; valorTotal: number; status: string }[];
      total: number; periodo: any; totalFiltrado: number; totalAberto: number;
    };
  }
  const valores = (t: Awaited<ReturnType<typeof tela>>) => t.contas.map((c) => c.valorTotal).sort((a, b) => a - b);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await import("@/app/(dashboard)/financeiro/contas-pagar/page");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.fornecedor.createMany({ data: [
      { id: "f1", empresaId: "e1", nome: "Elétrica Central", documento: "33444555000166" },
      { id: "f2", empresaId: "e1", nome: "Refrigeração Sul", documento: "44555666000177" },
    ] });
    // Outubro
    await conta(100, "PENDENTE", "2026-10-20");
    await conta(200, "PAGO_TOTAL", "2026-10-05", 200, { descricao: "Peças antigas" });
    // Novembro (o mês do "agora"): borda do dia 1, vencidas (uma paga em parte), hoje, a vencer, cancelada
    await conta(300, "PAGO_TOTAL", "2026-11-01");
    await conta(400, "PENDENTE", "2026-11-10");
    await conta(1000, "PAGO_PARCIAL", "2026-11-12", 600); // vencida, falta 400
    await conta(500, "PENDENTE", "2026-11-15");
    await conta(600, "PENDENTE", "2026-11-20", 0, { fornecedorId: "f2", fornecedor: "Refrigeração Sul" });
    await conta(800, "PAGO_PARCIAL", "2026-11-25", 300); // a vencer, falta 500
    await conta(700, "CANCELADO", "2026-11-28");
    // Dezembro (borda: dia 1 do mês seguinte NÃO é de novembro) e sem vencimento
    await conta(900, "PENDENTE", "2026-12-01");
    await conta(50, "PENDENTE", null);
    // De outra empresa, em novembro: nunca entra
    await prisma.contaPagar.create({ data: { empresaId: "e2", numero: "CP-X", fornecedor: "Alheio", descricao: "Alheia", valorTotal: 9999, saldoRestante: 9999, status: "PENDENTE", dataVencimento: d("2026-11-12") } });

    sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "OPERADOR", permissoes: permissoesTotais() } };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("padrão = o mês corrente pelo VENCIMENTO, com as bordas certas; só da empresa da sessão", async () => {
    const t = await tela();
    expect(t.periodo).toMatchObject({ tipo: "mes", mes: "2026-11", rotulo: "Novembro de 2026" });
    expect(valores(t)).toEqual([300, 400, 500, 600, 700, 800, 1000]); // dia 1 entra; 1/12 e sem data não
    expect(t.total).toBe(7);
    // rodapé: total do filtro (valor das contas) e o que está em aberto (saldo)
    expect(t.totalFiltrado).toBe(4300);
    expect(t.totalAberto).toBe(400 + 400 + 500 + 600 + 500);
  });

  it("cards: abertos pelo saldo (o pago parcial pelo que falta), Pagos pelo valor pago, Total sem as canceladas", async () => {
    const { resumo } = await tela();
    expect(resumo).toEqual({
      VENCIDO: { q: 2, v: 800 },     // 400 + o que falta da paga em parte (1000 − 600)
      VENCE_HOJE: { q: 1, v: 500 },
      A_VENCER: { q: 2, v: 1100 },   // 600 + o que falta da paga em parte (800 − 300)
      PAGO: { q: 1, v: 300 },
      TOTAL: { q: 6, v: 3600 },
    });
    // Outro mês: os cards são daquele mês (a de outubro vencida virou VENCIDO na abertura da tela)
    const out = await tela({ mes: "2026-10" });
    expect(out.resumo.VENCIDO).toEqual({ q: 1, v: 100 });
    expect(out.resumo.PAGO).toEqual({ q: 1, v: 200 });
    expect(out.resumo.TOTAL).toEqual({ q: 2, v: 300 });
  });

  it("clicar no card filtra a lista; os filtros da lista não mexem nos cards", async () => {
    expect(valores(await tela({ card: "VENCIDO" }))).toEqual([400, 1000]);
    expect(valores(await tela({ card: "VENCE_HOJE" }))).toEqual([500]);
    expect(valores(await tela({ card: "A_VENCER" }))).toEqual([600, 800]);
    expect(valores(await tela({ card: "PAGO" }))).toEqual([300]);
    expect(valores(await tela({ card: "TOTAL" }))).toEqual([300, 400, 500, 600, 800, 1000]);
    // painel "Status: Vencido" (o que já existia): a tela marca as vencidas ao abrir (PENDENTE → VENCIDO)
    expect(valores(await tela({ status: "VENCIDO" }))).toEqual([400]);
    const soF2 = await tela({ fornecedorId: "f2" });
    expect(valores(soF2)).toEqual([600]);
    expect(soF2.resumo.TOTAL).toEqual({ q: 6, v: 3600 }); // cards = o período inteiro
  });

  it("intervalo de/até (inclusive) e todo o período (com a conta sem vencimento em 'A vencer')", async () => {
    const i = await tela({ de: "2026-11-15", ate: "2026-11-20" });
    expect(i.periodo).toMatchObject({ tipo: "intervalo", rotulo: "15/11/2026 a 20/11/2026" });
    expect(valores(i)).toEqual([500, 600]);
    const todos = await tela({ periodo: "todos" });
    expect(todos.periodo).toMatchObject({ tipo: "todos", rotulo: "Todo o período" });
    expect(valores(todos)).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(todos.resumo.A_VENCER).toEqual({ q: 4, v: 600 + 500 + 900 + 50 });
    expect(todos.resumo.TOTAL).toEqual({ q: 10, v: 4850 });
  });

  it("busca dentro do período; todo o período acha a conta antiga; as datas antigas do painel não valem mais", async () => {
    expect((await tela({ fornecedor: "Peças antigas" })).total).toBe(0);
    expect(valores(await tela({ fornecedor: "Peças antigas", periodo: "todos" }))).toEqual([200]);
    // dataInicio/dataFim (o painel antigo) é ignorado: o período manda
    expect(valores(await tela({ dataInicio: "2026-10-01", dataFim: "2026-10-31" }))).toEqual([300, 400, 500, 600, 700, 800, 1000]);
  });

  it("dashboard financeiro: 'Contas a pagar vencidas' abre o card Vencidos em todo o período", async () => {
    const { default: Dashboard } = await import("@/app/(dashboard)/financeiro/page");
    const h = renderToStaticMarkup(await Dashboard());
    expect(h).toContain('href="/financeiro/contas-pagar?card=VENCIDO&amp;periodo=todos"');
    const lista = await tela({ card: "VENCIDO", periodo: "todos" });
    expect(valores(lista)).toEqual([100, 400, 1000]); // a de outubro também
  });
});
