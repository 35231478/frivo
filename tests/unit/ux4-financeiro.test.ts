/**
 * UX-4 "Financeiro em escala" (E4/Y4/Y5) — PostgreSQL real (schema descartável).
 * Prova que o financeiro deixou de cortar em fatia fixa (500/300/100/200):
 *  - whereContasReceber roda TODO filtro no banco: busca (número/descrição/cliente),
 *    chips de status VISUAL (Previsto/A vencer/Vence hoje/Vencido/Pago/Cancelado),
 *    cartões (A Receber/Vencido/Vence hoje/Recebido do mês), categoria/forma/banco,
 *    faixa de valor e de vencimento — com a MESMA régua do selo statusVisualReceber;
 *  - paginação por janela: nada some (total = tudo que bate no filtro) e a soma do
 *    filtro vem por agregado (não da página);
 *  - /api/contas-receber/exportar exporta o FILTRO inteiro (além de uma página), com
 *    sessão + permissão financeiro.contasReceber;
 *  - whereContasPagar: a busca também acha por descrição e número; totais (filtrado/
 *    vencido/em aberto) por agregado sobre o filtro inteiro;
 *  - sugestões da busca de Medições (Y4) acham por número e por cliente.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/ux4-financeiro
 */
import { hojeDiaCivil, inicioMesDiaCivil } from "@/lib/fuso";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, montarPermissoes } from "@/lib/permissoes";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_ux4_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes = permissoesTotais()) => {
  sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "OPERADOR", permissoes } };
};

const agora = new Date();
// "Hoje" é o dia de BRASÍLIA (a régua do app): com o relógio do processo (UTC) o teste quebrava das
// 21h à meia-noite de Brasília, quando o dia UTC já virou
const hoje = hojeDiaCivil(agora);
const dia = (n: number, hora = 12) => new Date(hoje.getTime() + n * 864e5 + hora * 36e5);

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("UX-4 — financeiro em escala (PostgreSQL real)", () => {
  let prisma: any;
  let filtros: typeof import("@/lib/listas/filtros");
  let seq = 0;

  const conta = (dados: Record<string, unknown>) =>
    prisma.contaReceber.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: `CR-${String(++seq).padStart(4, "0")}`,
      descricao: "Mensalidade", valor: 100, status: "A_RECEBER", ...dados,
    } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    filtros = await import("@/lib/listas/filtros");

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "11.111.111/0001-11" } });
    await prisma.cliente.create({ data: { id: "c2", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "22.222.222/0001-22" } });
    await prisma.categoriaFinanceira.create({ data: { id: "cat1", empresaId: "e1", nome: "Contrato Mensal", cor: "#0EA5E9" } });
    logar();

    // 60 cobranças A VENCER do Hospital — bem mais que uma página, nenhuma pode "sumir"
    for (let i = 0; i < 60; i++) await conta({ dataVencimento: dia(i + 1) });
    // Previsto: 2 contas PREVISTO (uma até vencida — selo continua "Previsto") + 1 liberada sem data
    await conta({ status: "PREVISTO", dataVencimento: dia(-3) });
    await conta({ status: "PREVISTO", dataVencimento: dia(30) });
    await conta({ dataVencimento: null });
    // Vence hoje: 2
    await conta({ dataVencimento: dia(0, 8) });
    await conta({ dataVencimento: dia(0, 18) });
    // Vencidas: 3 ATRASADO + 1 A_RECEBER com data passada (antes do marcador rodar)
    for (let i = 0; i < 3; i++) await conta({ status: "ATRASADO", dataVencimento: dia(-5 - i) });
    await conta({ dataVencimento: dia(-1) });
    // Pagas: 2 neste mês, 1 no mês passado
    const inicioMes = inicioMesDiaCivil(agora);
    await conta({ status: "RECEBIDO", valor: 500, dataRecebimento: new Date(inicioMes.getTime() + 36e5) });
    await conta({ status: "RECEBIDO", valor: 300, dataRecebimento: agora });
    await conta({ status: "RECEBIDO", valor: 999, dataRecebimento: new Date(inicioMes.getTime() - 864e5) });
    // Cancelada: 1
    await conta({ status: "CANCELADO" });
    // Da Padaria: busca/categoria/forma/banco/valor
    await conta({ clienteId: "c2", descricao: "Projeto câmara fria", valor: 9999, categoriaId: "cat1", formaPagamento: "PIX", banco: "Inter", dataVencimento: dia(10) });
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  const contar = (sp: Record<string, string>) => prisma.contaReceber.count({ where: filtros.whereContasReceber("e1", sp, agora) });

  it("E4: chips de status visual e cartões filtram NO BANCO com a régua do selo", async () => {
    expect(await contar({})).toBe(74); // tudo — bem além de qualquer fatia fixa
    expect(await contar({ status: "PREVISTO" })).toBe(3);   // 2 PREVISTO + 1 liberada sem data
    expect(await contar({ status: "A_VENCER" })).toBe(61);  // 60 futuras + a da Padaria
    expect(await contar({ status: "VENCE_HOJE" })).toBe(2);
    expect(await contar({ status: "VENCIDO" })).toBe(4);    // 3 ATRASADO + 1 passada ainda A_RECEBER
    expect(await contar({ status: "PAGO" })).toBe(3);
    expect(await contar({ status: "CANCELADO" })).toBe(1);
    expect(await contar({ status: "VENCIDO,VENCE_HOJE" })).toBe(6); // chips somam (OR)

    expect(await contar({ card: "A_RECEBER" })).toBe(64);   // Previsto + A vencer
    expect(await contar({ card: "VENCIDO" })).toBe(4);
    expect(await contar({ card: "RECEBIDO" })).toBe(2);     // só as pagas DESTE mês
    // card + chip combinam (AND): vencidas dentro do cartão "A Receber" = nenhuma
    expect(await contar({ card: "A_RECEBER", status: "VENCIDO" })).toBe(0);
  });

  it("E4: busca e painel (cliente, categoria, forma, banco, valor, vencimento) no banco", async () => {
    expect(await contar({ q: "câmara fria" })).toBe(1);         // descrição
    expect(await contar({ q: "Santa Clara" })).toBe(73);        // nome fantasia do cliente
    expect(await contar({ q: "pão quente" })).toBe(1);          // razão social, sem caixa
    expect(await contar({ q: "CR-0001" })).toBe(1);             // número
    expect(await contar({ clienteId: "c2" })).toBe(1);
    expect(await contar({ categoria: "cat1" })).toBe(1);
    expect(await contar({ forma: "PIX" })).toBe(1);
    expect(await contar({ banco: "inter" })).toBe(1);
    expect(await contar({ valorMin: "9000" })).toBe(1);
    expect(await contar({ valorMax: "99" })).toBe(0);
    const de = dia(1).toISOString().slice(0, 10);
    const ate = dia(5).toISOString().slice(0, 10);
    expect(await contar({ vencDe: de, vencAte: ate })).toBe(5); // 5 dias de mensalidade
  });

  it("E4: paginação por janela não pula nem repete; soma do filtro vem por agregado", async () => {
    const where = filtros.whereContasReceber("e1", { status: "A_VENCER" }, agora);
    const total = await prisma.contaReceber.count({ where });
    expect(total).toBe(61);
    const { porPagina } = lerPaginacao({ por: "25" });
    const paginas = [];
    for (let p = 1; p <= Math.ceil(total / porPagina); p++) {
      const pagina = paginaValida(p, porPagina, total);
      paginas.push(await prisma.contaReceber.findMany({
        where, select: { id: true }, orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      }));
    }
    expect(paginas.map((p) => p.length)).toEqual([25, 25, 11]);
    const ids = paginas.flat().map((x: any) => x.id);
    expect(new Set(ids).size).toBe(61); // sem repetir nem pular
    // Página além do fim volta para a última que existe
    expect(paginaValida(99, porPagina, total)).toBe(3);
    // A soma do filtro inteiro (agregado), não da página
    const ag = await prisma.contaReceber.aggregate({ where, _sum: { valor: true } });
    expect(Number(ag._sum.valor)).toBe(60 * 100 + 9999);
  });

  it("E4: exportar devolve o FILTRO inteiro em CSV (além de uma página) e respeita a permissão", async () => {
    const { GET } = await import("@/app/api/contas-receber/exportar/route");
    const pedir = (qs: string) => GET(new NextRequest(`http://localhost/api/contas-receber/exportar${qs}`));

    // A exportação segue o período da tela (padrão: o mês); aqui, todo o período
    const res = await pedir("?status=A_VENCER&periodo=todos");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    const linhas = csv.trim().split("\n");
    expect(linhas).toHaveLength(62); // cabeçalho + 61 (mais que uma página de 50)
    expect(linhas[0]).toContain("Número");
    expect(csv).toContain("Hospital Santa Clara");
    expect(csv).toContain("A vencer");

    // Sem a sub-permissão de contas a receber: 403; sem sessão: 401
    logar(montarPermissoes({ financeiro: ["visualizar"] }));
    expect((await pedir("")).status).toBe(403);
    sessao.atual = null;
    expect((await pedir("")).status).toBe(401);
    logar();
  });

  it("Pagar: a busca acha por descrição e número; totais por agregado sobre o filtro inteiro", async () => {
    await prisma.contaPagar.create({ data: { empresaId: "e1", numero: "CP-1001", fornecedor: "Frigelar", descricao: "Gás R410A", valorTotal: 1000, valorPago: 0, saldoRestante: 1000, status: "PENDENTE", dataVencimento: dia(5) } });
    await prisma.contaPagar.create({ data: { empresaId: "e1", numero: "CP-1002", fornecedor: "Frigelar", descricao: "Capacitores", valorTotal: 200, valorPago: 50, saldoRestante: 150, status: "PAGO_PARCIAL", dataVencimento: dia(2) } });
    await prisma.contaPagar.create({ data: { empresaId: "e1", numero: "CP-1003", fornecedor: "União Peças", descricao: "Tubo de cobre", valorTotal: 400, valorPago: 0, saldoRestante: 400, status: "VENCIDO", dataVencimento: dia(-4) } });

    const w = (sp: Record<string, string>) => filtros.whereContasPagar("e1", sp);
    expect(await prisma.contaPagar.count({ where: w({ fornecedor: "gás" }) })).toBe(1);      // descrição (novo)
    expect(await prisma.contaPagar.count({ where: w({ fornecedor: "CP-1003" }) })).toBe(1);  // número (novo)
    expect(await prisma.contaPagar.count({ where: w({ fornecedor: "frigelar" }) })).toBe(2); // texto antigo

    const where = w({});
    const [fil, venc, aberto] = await Promise.all([
      prisma.contaPagar.aggregate({ where, _sum: { valorTotal: true, valorPago: true } }),
      prisma.contaPagar.aggregate({ where: { ...where, status: "VENCIDO" }, _sum: { saldoRestante: true } }),
      prisma.contaPagar.aggregate({ where: { ...where, status: { in: ["PENDENTE", "PAGO_PARCIAL"] } }, _sum: { saldoRestante: true } }),
    ]);
    expect(Number(fil._sum.valorTotal)).toBe(1600);
    expect(Number(fil._sum.valorPago)).toBe(50);
    expect(Number(venc._sum.saldoRestante)).toBe(400);
    expect(Number(aberto._sum.saldoRestante)).toBe(1150);
  });

  it("Y4: sugestões da busca de Medições acham por número e por cliente", async () => {
    await prisma.medicao.create({ data: { empresaId: "e1", clienteId: "c1", numero: "MED-2026-0101", tokenPublico: "tok-ux4-med", tipo: "MENSAL_FIXO", status: "RASCUNHO", valorTotal: 100, valorLiquido: 100 } });
    const { SUGESTOES } = await import("@/lib/listas/sugestoes");
    const porNumero = await SUGESTOES.medicoes.buscar("e1", "MED-2026");
    expect(porNumero.map((s: any) => s.rotulo)).toContain("MED-2026-0101");
    expect(porNumero[0].href).toMatch(/^\/financeiro\/medicoes\//);
    // Outra empresa com número parecido: NUNCA vaza
    await prisma.empresa.create({ data: { id: "e2", nome: "Outra", cnpj: "99.888.777/0001-66", email: "o@x.com" } });
    await prisma.cliente.create({ data: { id: "c9", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33.333.333/0001-33" } });
    await prisma.medicao.create({ data: { empresaId: "e2", clienteId: "c9", numero: "MED-2026-0999", tokenPublico: "tok-ux4-outra", tipo: "MENSAL_FIXO", status: "RASCUNHO", valorTotal: 1, valorLiquido: 1 } });
    const deNovo = await SUGESTOES.medicoes.buscar("e1", "MED-2026");
    expect(deNovo.map((s: any) => s.rotulo)).not.toContain("MED-2026-0999");
    const porCliente = await SUGESTOES.medicoes.buscar("e1", "santa clara");
    expect(porCliente.length).toBe(1);
    expect(await SUGESTOES.medicoes.buscar("e1", "nada-disso")).toHaveLength(0);
  });
});
