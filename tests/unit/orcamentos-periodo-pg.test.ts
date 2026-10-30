/**
 * Orçamentos — período + cards de funil (o mesmo padrão de Contas a Receber/Pagar), PostgreSQL real e
 * a PÁGINA real renderizada (o HTML que o servidor manda):
 *  - o período é pela DATA DE CRIAÇÃO (instante, relógio de Brasília): mês corrente por padrão, com as
 *    bordas certas (00:00 BR do dia 1 entra; 23:59 BR do último dia do mês anterior não); `mes=`,
 *    intervalo `de/ate` e `periodo=todos`; as datas antigas do painel (dataInicio/dataFim) não valem mais;
 *  - cards de funil do período: Em aberto (enviado na validade, visto ou não) · Aprovados (com os
 *    convertidos em contrato) · Recusados · Vencidos (validade passou) · Total (sem os cancelados) —
 *    quantidade e R$; só da empresa da sessão;
 *  - clicar no card filtra a lista; busca e status filtram só a lista (os cards são do período);
 *  - o sino ("respostas novas") e "todo o período" acham orçamento de outro mês.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamentos-periodo-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_periodo_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("NEXT_REDIRECT"); },
}));

/** "Agora": 15/11/2026, meio-dia em Brasília */
const AGORA = new Date("2026-11-15T15:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`); // validade = dia civil

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Orçamentos — período e cards de funil (PostgreSQL real)", () => {
  let prisma: any;

  /** Renderiza a página e devolve as linhas (ids na ordem), os cards e o período */
  async function tela(sp: Record<string, string> = {}) {
    const { default: Pagina } = await import("@/app/(dashboard)/orcamentos/page");
    const h = renderToStaticMarkup(await Pagina({ searchParams: Promise.resolve(sp) }));
    const linhas = [...h.matchAll(/<tr [^>]*data-linha-orcamento="([^"]+)"/g)].map((m) => m[1]).sort();
    const cards: Record<string, { q: number; v: string }> = {};
    for (const m of h.matchAll(/data-card="([A-Z_]+)"[\s\S]*?data-card-valor="true">([^<]+)<[\s\S]*?data-card-qtd="true">(\d+)/g)) {
      cards[m[1]] = { v: m[2].replace(/\s/g, " "), q: Number(m[3]) };
    }
    return { h, linhas, cards, rotulo: h.match(/data-mes-rotulo="true">(?:<svg[\s\S]*?<\/svg>\s*)?([^<]+)</)?.[1]?.trim() };
  }
  const R = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await import("@/app/(dashboard)/orcamentos/page");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "22101333000111" },
      { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" },
    ] });
    let n = 0;
    const orc = (id: string, criadoEm: string, total: number, status: string, extra: Record<string, unknown> = {}) => ({
      id, empresaId: "e1", codigo: `ORC-2026-${String(++n).padStart(4, "0")}`, nome: `Orçamento ${id}`, clienteId: "c1", criadoPorId: "u1",
      tokenPublico: `tok-${id}`, criadoEm: new Date(criadoEm), totalGeral: total, totalServicos: total, status,
      validadeEm: dia("2026-11-30"), ...extra,
    });
    await prisma.orcamento.createMany({ data: [
      orc("oOut", "2026-10-20T15:00:00Z", 100, "ENVIADO", { nome: "Proposta antiga" }),
      orc("oN0", "2026-11-01T02:59:00Z", 250, "APROVADO"),               // 31/10 23:59 em Brasília: outubro
      orc("oN1", "2026-11-01T03:00:00Z", 200, "RASCUNHO"),               // 01/11 00:00 em Brasília: novembro
      orc("oN2", "2026-11-05T15:00:00Z", 300, "ENVIADO", { validadeEm: dia("2026-11-20"), visualizadoEm: new Date("2026-11-06T12:00:00Z") }),
      orc("oN3", "2026-11-06T15:00:00Z", 400, "ENVIADO", { validadeEm: null }),
      orc("oN4", "2026-11-07T15:00:00Z", 500, "APROVADO"),
      orc("oN5", "2026-11-08T15:00:00Z", 600, "CONVERTIDA"),
      orc("oN6", "2026-11-09T15:00:00Z", 700, "REPROVADO"),
      orc("oN7", "2026-11-10T15:00:00Z", 800, "ENVIADO", { validadeEm: dia("2026-11-14") }), // venceu ontem
      orc("oN8", "2026-11-11T15:00:00Z", 900, "CANCELADO"),
      orc("oN9", "2026-11-12T15:00:00Z", 50, "ENVIADO", { validadeEm: dia("2026-11-15") }),  // vence hoje: ainda em aberto
      orc("oD", "2026-12-01T03:00:00Z", 1000, "RASCUNHO"),
      { id: "oX", empresaId: "e2", codigo: "ORC-2026-0001", nome: "Da outra empresa", clienteId: "c9", criadoPorId: "u2", tokenPublico: "tok-x",
        criadoEm: new Date("2026-11-05T15:00:00Z"), totalGeral: 9999, status: "ENVIADO" },
    ] });
    sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes: permissoesTotais() } };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
  }, 240_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("padrão = o mês corrente pela DATA DE CRIAÇÃO (relógio de Brasília), com as bordas certas; só da empresa da sessão", async () => {
    const t = await tela();
    expect(t.rotulo).toBe("Novembro de 2026");
    // 01/11 00:00 BR entra; 31/10 23:59 BR e dezembro não; cancelado fora da lista padrão (como antes)
    expect(t.linhas).toEqual(["oN1", "oN2", "oN3", "oN4", "oN5", "oN6", "oN7", "oN9"]);
    expect(t.h).not.toContain("Da outra empresa");
    // planilha (o mesmo estilo de Receber/Pagar): colunas fixas, Valor (R$) sem "R$" na célula, à direita e tabular; validade
    expect(t.h).toMatch(/<table class="[^"]*text-\[13px\][^"]*table-fixed[^"]*" data-tabela-planilha/);
    const linha = t.h.match(/<tr [^>]*data-linha-orcamento="oN7"[\s\S]*?<\/tr>/)![0];
    expect(linha).toMatch(/<td class="[^"]*text-right tabular-nums[^"]*" data-valor="true">800,00<\/td>/);
    expect(linha).toContain('data-validade="true">14/11/2026<');
    expect(t.h).toMatch(/Valor \(R\$\)/);
    // status numa linha só na planilha: o "desde" vai para o hover
    const visto = t.h.match(/<tr [^>]*data-linha-orcamento="oN2"[\s\S]*?<\/tr>/)![0];
    expect(visto).toMatch(/title="desde 06\/11 09:00" data-etapa="VISUALIZADO">Visualizado</);
  });

  it("cards de funil: Em aberto (na validade) · Aprovados (com convertidos) · Recusados · Vencidos · Total (sem cancelados)", async () => {
    const { cards } = await tela();
    expect(cards).toEqual({
      EM_ABERTO: { q: 3, v: R(750) },  // visto (300), sem validade (400) e o que vence hoje (50)
      APROVADO: { q: 2, v: R(1100) },  // aprovado (500) + convertido em contrato (600)
      RECUSADO: { q: 1, v: R(700) },
      VENCIDO: { q: 1, v: R(800) },
      TOTAL: { q: 8, v: R(3550) },     // rascunho incluso; cancelado não
    });
    const out = await tela({ mes: "2026-10" });
    expect(out.linhas).toEqual(["oN0", "oOut"]);
    expect(out.cards.EM_ABERTO).toEqual({ q: 1, v: R(100) });
    expect(out.cards.APROVADO).toEqual({ q: 1, v: R(250) });
  });

  it("clicar no card filtra a lista; status, busca e 'mostrar cancelados' filtram só a lista", async () => {
    expect((await tela({ card: "EM_ABERTO" })).linhas).toEqual(["oN2", "oN3", "oN9"]);
    expect((await tela({ card: "APROVADO" })).linhas).toEqual(["oN4", "oN5"]);
    expect((await tela({ card: "RECUSADO" })).linhas).toEqual(["oN6"]);
    expect((await tela({ card: "VENCIDO" })).linhas).toEqual(["oN7"]);
    expect((await tela({ card: "TOTAL" })).linhas).toEqual(["oN1", "oN2", "oN3", "oN4", "oN5", "oN6", "oN7", "oN9"]);
    const soAprovado = await tela({ status: "APROVADO" });
    expect(soAprovado.linhas).toEqual(["oN4"]);
    expect(soAprovado.cards.TOTAL).toEqual({ q: 8, v: R(3550) }); // cards = o período inteiro
    expect((await tela({ inativos: "1" })).linhas).toContain("oN8");
  });

  it("intervalo de/até (inclusive, dias de Brasília) e todo o período", async () => {
    expect((await tela({ de: "2026-10-31", ate: "2026-11-01" })).linhas).toEqual(["oN0", "oN1"]);
    const todos = await tela({ periodo: "todos" });
    expect(todos.linhas).toEqual(["oD", "oN0", "oN1", "oN2", "oN3", "oN4", "oN5", "oN6", "oN7", "oN9", "oOut"]);
    expect(todos.cards.TOTAL).toEqual({ q: 11, v: R(4900) }); // 100+250+200+300+400+500+600+700+800+50+1000
    // as datas antigas do painel não valem mais: o período manda
    expect((await tela({ dataInicio: "2026-10-01", dataFim: "2026-10-31" })).linhas).toEqual(["oN1", "oN2", "oN3", "oN4", "oN5", "oN6", "oN7", "oN9"]);
  });

  it("busca no período; todo o período acha o antigo; vazio oferece 'Ver todo o período'; sino acha respostas de outro mês", async () => {
    const vazio = await tela({ busca: "Proposta antiga" });
    expect(vazio.linhas).toEqual([]);
    expect(vazio.h).toContain("Nenhum orçamento em novembro de 2026");
    expect(vazio.h).toContain("data-ver-todo-periodo");
    expect((await tela({ busca: "Proposta antiga", periodo: "todos" })).linhas).toEqual(["oOut"]);
    expect((await tela({ busca: "Proposta antiga", periodo: "todos" })).h).not.toContain("data-ver-todo-periodo");
    // sino: /orcamentos?resposta=nova&periodo=todos — a resposta de outubro aparece
    expect((await tela({ resposta: "nova", periodo: "todos" })).linhas).toEqual(["oN0", "oN4", "oN6"]);
  });
});
