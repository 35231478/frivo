/**
 * Contas a Receber — período + cards do período (padrão da casa), PostgreSQL real e a PÁGINA real
 * (o componente de servidor devolve a tela com os props calculados):
 *  - o período é pelo VENCIMENTO (dia civil): mês corrente por padrão, com as bordas certas
 *    (dia 1 entra, dia 1 do mês seguinte não); `mes=`, intervalo `de/ate` e `periodo=todos`;
 *  - cards do período: Vencidos · Vencem hoje · A vencer (com as previsões) · Recebidos · Total
 *    (sem as canceladas) — quantidade e R$; só da empresa da sessão;
 *  - clicar no card filtra a lista (e "A_RECEBER" dos links antigos = A vencer);
 *  - busca dentro do período; "todo o período" acha a conta antiga; a exportação segue o período.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/receber-periodo-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_receber_periodo_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); }, notFound: () => { throw new Error("404"); } }));

/** "Agora": 15/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-15T15:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`); // vencimento = dia civil

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Contas a Receber — período e cards (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;
  const conta = (valor: number, status: string, venc: string | null, dados: Record<string, unknown> = {}) =>
    prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: `CR-${String(++seq).padStart(4, "0")}`, descricao: `Conta ${valor}`,
      valor, status, dataVencimento: venc ? d(venc) : null, ...dados,
    } });

  /** Renderiza a página (componente de servidor) e devolve os props da tela */
  async function tela(sp: Record<string, string> = {}) {
    const { default: Pagina } = await import("@/app/(dashboard)/financeiro/contas-receber/page");
    const el: any = await Pagina({ searchParams: Promise.resolve(sp) });
    return el.props as { resumo: Record<string, { q: number; v: number }>; contas: { numero: string; valor: number }[]; total: number; periodo: any };
  }
  const valores = (t: Awaited<ReturnType<typeof tela>>) => t.contas.map((c) => c.valor).sort((a, b) => a - b);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await import("@/app/(dashboard)/financeiro/contas-receber/page");
    await import("@/app/api/contas-receber/exportar/route");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "11111111000111" },
      { id: "cX", empresaId: "e2", nome: "Da outra", cpfCnpj: "22222222000122" },
    ] });
    // Outubro
    await conta(100, "ATRASADO", "2026-10-20");
    await conta(200, "RECEBIDO", "2026-10-05", { descricao: "Instalação antiga" });
    // Novembro (o mês do "agora"): borda do dia 1, vencida, hoje, a vencer, previsão, cancelada
    await conta(300, "RECEBIDO", "2026-11-01");
    await conta(400, "A_RECEBER", "2026-11-10");
    await conta(500, "A_RECEBER", "2026-11-15");
    await conta(600, "A_RECEBER", "2026-11-20");
    await conta(700, "PREVISTO", "2026-11-30");
    await conta(800, "CANCELADO", "2026-11-25");
    // Dezembro (borda: dia 1 do mês seguinte NÃO é de novembro) e sem vencimento
    await conta(900, "A_RECEBER", "2026-12-01");
    await conta(50, "PREVISTO", null);
    // De outra empresa, em novembro: nunca entra
    await prisma.contaReceber.create({ data: { empresaId: "e2", clienteId: "cX", numero: "CR-X", descricao: "Alheia", valor: 9999, status: "A_RECEBER", dataVencimento: d("2026-11-12") } });

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
    expect(valores(t)).toEqual([300, 400, 500, 600, 700, 800]); // dia 1 entra; 1/12 e sem data não
    expect(t.total).toBe(6);
  });

  it("cards do período: Vencidos · Vencem hoje · A vencer (com previsão) · Recebidos · Total (sem canceladas)", async () => {
    const { resumo } = await tela();
    expect(resumo).toEqual({
      VENCIDO: { q: 1, v: 400 }, VENCE_HOJE: { q: 1, v: 500 }, A_VENCER: { q: 2, v: 1300 },
      RECEBIDO: { q: 1, v: 300 }, PERDA: { q: 0, v: 0 }, TOTAL: { q: 5, v: 2500 },
    });
    // Outro mês: os cards são daquele mês
    const out = await tela({ mes: "2026-10" });
    expect(out.resumo.VENCIDO).toEqual({ q: 1, v: 100 });
    expect(out.resumo.RECEBIDO).toEqual({ q: 1, v: 200 });
    expect(out.resumo.TOTAL).toEqual({ q: 2, v: 300 });
  });

  it("clicar no card filtra a lista; card antigo A_RECEBER = A vencer; Total tira só as canceladas", async () => {
    expect(valores(await tela({ card: "VENCIDO" }))).toEqual([400]);
    expect(valores(await tela({ card: "VENCE_HOJE" }))).toEqual([500]);
    expect(valores(await tela({ card: "A_VENCER" }))).toEqual([600, 700]);
    expect(valores(await tela({ card: "A_RECEBER" }))).toEqual([600, 700]);
    expect(valores(await tela({ card: "RECEBIDO" }))).toEqual([300]);
    expect(valores(await tela({ card: "TOTAL" }))).toEqual([300, 400, 500, 600, 700]);
  });

  it("intervalo de/até (dias de vencimento, inclusive) e todo o período", async () => {
    const i = await tela({ de: "2026-11-15", ate: "2026-11-20" });
    expect(i.periodo).toMatchObject({ tipo: "intervalo", rotulo: "15/11/2026 a 20/11/2026" });
    expect(valores(i)).toEqual([500, 600]);
    expect(valores(await tela({ ate: "2026-10-31" }))).toEqual([100, 200]);
    const todos = await tela({ periodo: "todos" });
    expect(todos.periodo).toMatchObject({ tipo: "todos", rotulo: "Todo o período" });
    expect(valores(todos)).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(todos.resumo.TOTAL).toEqual({ q: 9, v: 3750 });
  });

  it("busca dentro do período; todo o período acha a conta antiga (links de outras telas)", async () => {
    expect((await tela({ q: "Instalação antiga" })).total).toBe(0);
    expect(valores(await tela({ q: "Instalação antiga", periodo: "todos" }))).toEqual([200]);
  });

  it("exportar segue o período da tela (padrão: o mês; todo o período quando pedido)", async () => {
    const { GET } = await import("@/app/api/contas-receber/exportar/route");
    const linhas = async (qs: string) => (await (await GET(new NextRequest(`http://localhost/api/contas-receber/exportar${qs}`))).text()).trim().split("\n").length - 1;
    expect(await linhas("")).toBe(6);
    expect(await linhas("?mes=2026-10")).toBe(2);
    expect(await linhas("?periodo=todos")).toBe(10);
    expect(await linhas("?card=VENCIDO")).toBe(1);
  });
});
