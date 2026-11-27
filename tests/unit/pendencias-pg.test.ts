/**
 * Painel de pendências — Prisma real, PostgreSQL real:
 *  - OS sem técnico e orçamento vencendo: o que entra e o que não entra (status, atividade, validade, empresa);
 *  - o número do painel é o da lista que o toque abre (a mesma função e a mesma URL);
 *  - a virada do dia civil (23h30 e 00h30 de Brasília) para a validade e para as contas do dia;
 *  - quem vê o quê (permissão, módulo desligado, técnico no modo técnico);
 *  - o sino: os dois itens novos entram no número, as contas do dia não; a tela /pendencias.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pendencias-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { hojeDiaCivil, instanteBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pendencias_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const escritorio = (permissoes: Permissoes = permissoesTotais(), id = "uA") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@clima.com`, empresaId: "e1", role: "OPERADOR", permissoes, tecnicoId: null } };
};
const tecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "joao@clima.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };
const SO_FINANCEIRO = () => montarPermissoes({ financeiro: ["visualizar", "contasReceber"] } as never);
const SO_ORCAMENTOS = () => montarPermissoes({ orcamentos: ["visualizar"] } as never);

// O dia das contas e das validades: 10/03/2027 (bem depois de hoje, para não se misturar com o relógio real)
const D = new Date(Date.UTC(2027, 2, 10));
const dia = (n: number) => new Date(D.getTime() + n * 86_400_000);
const MEIO_DIA = instanteBR(2027, 2, 10, 12);
const ANTES_DA_MEIA_NOITE = instanteBR(2027, 2, 10, 23, 30);
const DEPOIS_DA_MEIA_NOITE = instanteBR(2027, 2, 11, 0, 30);

describe.skipIf(!URL_PG)("painel de pendências (PostgreSQL real)", () => {
  let prisma: any;
  let sino: typeof import("@/lib/alertas/sino");
  let servidor: typeof import("@/lib/alertas/sino-server");
  let filtros: typeof import("@/lib/listas/filtros");
  let periodo: typeof import("@/lib/periodo");
  let pendencias: typeof import("@/lib/alertas/pendencias");
  let modulos: typeof import("@/lib/modulos/servidor");

  const contar = (permissoes: Permissoes = permissoesTotais(), agora = MEIO_DIA, restrito = false, usuarioId = "uA") =>
    servidor.contarSino({ empresaId: "e1", usuarioId, escopo: sino.escopoDoSino({ permissoes, role: "OPERADOR", restrito }), filtroTecnico: {}, agora });
  /** A lista que o toque abre: a URL do catálogo, lida como a página lê */
  const spDaUrl = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    sino = await import("@/lib/alertas/sino");
    servidor = await import("@/lib/alertas/sino-server");
    filtros = await import("@/lib/listas/filtros");
    periodo = await import("@/lib/periodo");
    pendencias = await import("@/lib/alertas/pendencias");
    modulos = await import("@/lib/modulos/servidor");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra Refrigeração", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@clima.com", senha: "x", role: "ADMIN" },
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@outra.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia LTDA", cpfCnpj: "1" },
      { id: "c2", empresaId: "e2", nome: "Padaria Pão Quente", cpfCnpj: "2" },
    ] });
    await prisma.unidade.createMany({ data: [{ id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "un2", empresaId: "e2", clienteId: "c2", nome: "Loja" }] });

    // OS: a criação em ordem (a mais antiga vai no link quando é uma só)
    const os = (id: string, status: string, n: number, empresaId = "e1") => ({
      id, empresaId, numero: `OS-${id}`, clienteId: empresaId === "e1" ? "c1" : "c2", unidadeId: empresaId === "e1" ? "un1" : "un2",
      criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao: "Ar pingando", status, criadoEm: new Date(Date.UTC(2026, 0, n)),
    });
    await prisma.ordemServico.createMany({ data: [
      os("os1", "ABERTA", 1),          // sem atividade: entra
      os("os2", "AGENDADA", 2),        // atividade agendada sem técnico: entra
      os("os3", "AGENDADA", 3),        // atividade com técnico: não
      os("os4", "ABERTA", 4),          // só atividade cancelada: entra
      os("os5", "EM_ANDAMENTO", 5),    // atividades concluídas: espera o fechamento, não
      os("os6", "CONCLUIDA", 6),       // concluída: não
      os("os7", "CANCELADA", 7),       // cancelada: não
      os("os8", "AGENDADA", 8),        // uma com técnico e outra em andamento sem: entra
      os("osX", "ABERTA", 9, "e2"),    // outra empresa: não
    ] });
    const at = (id: string, osId: string, status: string, tecnicoId: string | null = null) => ({ id, empresaId: "e1", ordemServicoId: osId, titulo: "Visita", status, tecnicoId });
    await prisma.atividadeOs.createMany({ data: [
      at("a2", "os2", "AGENDADA"), at("a3", "os3", "AGENDADA", "t1"), at("a4", "os4", "CANCELADA"),
      at("a5", "os5", "CONCLUIDA", "t1"), at("a8a", "os8", "AGENDADA", "t1"), at("a8b", "os8", "EM_ANDAMENTO"),
    ] });

    const orc = (id: string, status: string, validadeEm: Date | null, empresaId = "e1") => ({
      id, empresaId, codigo: `ORC-${id}`, nome: "Troca de compressor", clienteId: empresaId === "e1" ? "c1" : "c2",
      criadoPorId: empresaId === "e1" ? "uA" : "uB", tokenPublico: `tk-${id}`, status, validadeEm,
    });
    await prisma.orcamento.createMany({ data: [
      orc("o1", "ENVIADO", dia(0)),    // vence hoje: entra (o primeiro)
      orc("o2", "ENVIADO", dia(3)),    // no limite do aviso (3 dias): entra
      orc("o3", "ENVIADO", dia(4)),    // além do aviso: não
      orc("o4", "ENVIADO", dia(-1)),   // já venceu: não (é "Vencido")
      orc("o5", "RASCUNHO", dia(1)),   // não enviado: não
      orc("o6", "ENVIADO", null),      // sem validade: não
      orc("o7", "APROVADO", dia(1)),   // respondido: não
      orc("oX", "ENVIADO", dia(0), "e2"),
    ] });

    const pagar = (id: string, status: string, dataVencimento: Date, empresaId = "e1") => ({
      id, empresaId, numero: `CP-${id}`, fornecedor: "Frio Sul", descricao: "Gás", valorTotal: 100, saldoRestante: 100, status, dataVencimento,
    });
    await prisma.contaPagar.createMany({ data: [
      pagar("p1", "PENDENTE", dia(0)), pagar("p2", "PAGO_PARCIAL", dia(0)), pagar("p3", "PAGO_TOTAL", dia(0)),
      pagar("p4", "PENDENTE", dia(1)), pagar("p5", "VENCIDO", dia(-1)), pagar("p6", "CANCELADO", dia(0)), pagar("pX", "PENDENTE", dia(0), "e2"),
    ] });
    const receber = (id: string, status: string, dataVencimento: Date, empresaId = "e1") => ({
      id, empresaId, clienteId: empresaId === "e1" ? "c1" : "c2", numero: `CR-${id}`, descricao: "Contrato", valor: 500, status, dataVencimento,
    });
    await prisma.contaReceber.createMany({ data: [
      receber("r1", "A_RECEBER", dia(0)), receber("r2", "RECEBIDO", dia(0)), receber("r3", "A_RECEBER", dia(1)), receber("rX", "A_RECEBER", dia(0), "e2"),
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("OS sem técnico: sem atividade, atividade em aberto sem técnico, só cancelada — e nada de outra empresa", async () => {
    const c = await contar();
    expect(c.osSemTecnico).toBe(4);
    const ids = (await prisma.ordemServico.findMany({ where: { empresaId: "e1", ...(await import("@/lib/os/sem-tecnico")).whereOsSemTecnico() }, select: { id: true }, orderBy: { id: "asc" } })).map((o: any) => o.id);
    expect(ids).toEqual(["os1", "os2", "os4", "os8"]);
    expect(c.osSemTecnicoId).toBe("os1"); // a mais antiga
    // o toque: a lista de OS com ?tecnico=sem mostra as mesmas 4
    const href = pendencias.itemPendencia("osSemTecnico", c).href;
    expect(href).toBe("/ordens?tecnico=sem&periodo=todos");
    expect(await prisma.ordemServico.count({ where: filtros.whereOrdens("e1", spDaUrl(href)) })).toBe(4);
  });

  it("orçamento vencendo: enviado com a validade de hoje até o aviso da empresa (3 dias; ou o configurado)", async () => {
    let c = await contar();
    expect(c.orcamentosVencendo).toBe(2);
    expect(c.orcamentoVencendoId).toBe("o1"); // o que vence antes
    const href = pendencias.itemPendencia("orcamentosVencendo", c).href;
    expect(href).toBe("/orcamentos?validade=vencendo&periodo=todos");
    const sp = spDaUrl(href);
    const lista = (dias?: number) => prisma.orcamento.count({ where: filtros.whereListaOrcamentos("e1", sp, periodo.lerPeriodo(sp, MEIO_DIA, { permitirTodos: true }), MEIO_DIA, dias) });
    expect(await lista()).toBe(2);
    // a empresa avisa com 4 dias: o o3 entra, no painel e na lista
    await prisma.emailConfig.create({ data: { empresaId: "e1", diasLembreteOrcamentoVencendo: 4 } });
    c = await contar();
    expect(c.orcamentosVencendo).toBe(3);
    const { diasOrcamentoVencendo } = await import("@/lib/orcamentos/ciclo-server");
    expect(await diasOrcamentoVencendo("e1")).toBe(4);
    expect(await diasOrcamentoVencendo("e2")).toBe(3); // sem configuração: o padrão
    expect(await lista(4)).toBe(3);
    await prisma.emailConfig.delete({ where: { empresaId: "e1" } });
  });

  it("virada do dia civil: às 23h30 o que vence hoje ainda conta; às 00h30 virou ontem", async () => {
    const noite = await contar(permissoesTotais(), ANTES_DA_MEIA_NOITE);
    expect(noite.orcamentosVencendo).toBe(2);
    expect(noite.foraDoNumero).toEqual({ contasPagarHoje: 2, contasReceberHoje: 1 });
    const madrugada = await contar(permissoesTotais(), DEPOIS_DA_MEIA_NOITE);
    // o1 venceu ontem; o2 (dia 13) segue; o3 (dia 14) entrou no aviso de 3 dias
    expect(madrugada.orcamentosVencendo).toBe(2);
    expect(madrugada.orcamentoVencendoId).toBe("o2");
    // as contas de amanhã (p4, r3) viraram as de hoje
    expect(madrugada.foraDoNumero).toEqual({ contasPagarHoje: 1, contasReceberHoje: 1 });
    expect(hojeDiaCivil(DEPOIS_DA_MEIA_NOITE).toISOString()).toBe(dia(1).toISOString());
  });

  it("contas do dia: em aberto que vencem hoje; o número é o da lista que o toque abre (Vence hoje + Hoje)", async () => {
    const c = await contar();
    expect(c.foraDoNumero).toEqual({ contasPagarHoje: 2, contasReceberHoje: 1 });
    const hPagar = pendencias.itemPendencia("contasPagarHoje", c).href;
    const hReceber = pendencias.itemPendencia("contasReceberHoje", c).href;
    expect(hPagar).toBe("/financeiro/contas-pagar?card=VENCE_HOJE&periodo=hoje");
    expect(spDaUrl(hPagar)).toEqual({ ...servidor.SP_CONTAS_HOJE });
    const sp = spDaUrl(hPagar);
    const p = periodo.lerPeriodo(sp, MEIO_DIA, { permitirTodos: true });
    expect(await prisma.contaPagar.count({ where: filtros.whereListaPagar("e1", sp, p, MEIO_DIA) })).toBe(2);
    expect(await prisma.contaReceber.count({ where: filtros.whereListaReceber("e1", spDaUrl(hReceber), p, MEIO_DIA) })).toBe(1);
  });

  it("quem vê o quê: só financeiro, só orçamentos, módulo desligado e o técnico no modo técnico", async () => {
    const fin = await contar(SO_FINANCEIRO());
    expect([fin.osSemTecnico, fin.orcamentosVencendo, fin.foraDoNumero]).toEqual([0, 0, { contasPagarHoje: 2, contasReceberHoje: 1 }]);
    const orc = await contar(SO_ORCAMENTOS());
    expect([orc.osSemTecnico, orc.orcamentosVencendo, orc.foraDoNumero]).toEqual([0, 2, { contasPagarHoje: 0, contasReceberHoje: 0 }]);
    // contas a pagar só com Financeiro › Visualizar; a receber só com Contas a receber
    const soReceber = await contar(montarPermissoes({ financeiro: ["contasReceber"] } as never));
    expect(soReceber.foraDoNumero).toEqual({ contasPagarHoje: 0, contasReceberHoje: 1 });
    const tec = await contar(PRESETS.TECNICO, MEIO_DIA, true, "uT");
    expect([tec.osSemTecnico, tec.orcamentosVencendo, tec.foraDoNumero]).toEqual([0, 0, { contasPagarHoje: 0, contasReceberHoje: 0 }]);
    // módulos desligados somem como sumiram do menu
    await prisma.empresaModulo.createMany({ data: [{ empresaId: "e1", modulo: "orcamentos", ativo: false }, { empresaId: "e1", modulo: "financeiro", ativo: false }] });
    modulos.esquecerModulos("e1");
    const sem = await contar();
    expect([sem.osSemTecnico, sem.orcamentosVencendo, sem.foraDoNumero]).toEqual([4, 0, { contasPagarHoje: 0, contasReceberHoje: 0 }]);
    await prisma.empresaModulo.deleteMany({ where: { empresaId: "e1" } });
    modulos.esquecerModulos("e1");
  });

  it("sino (/api/alertas): OS sem técnico e orçamento vencendo entram no número; as contas do dia, não", async () => {
    const { GET } = await import("@/app/api/alertas/route");
    // dados do dia de HOJE (relógio real): um orçamento vencendo amanhã e uma conta a pagar de hoje
    const hoje = hojeDiaCivil();
    await prisma.orcamento.create({ data: { id: "oHoje", empresaId: "e1", codigo: "ORC-H", nome: "Instalação", clienteId: "c1", criadoPorId: "uA", tokenPublico: "tk-h", status: "ENVIADO", validadeEm: new Date(hoje.getTime() + 86_400_000) } });
    escritorio();
    const antes = await (await GET()).json();
    expect(antes.osSemTecnico).toBe(4);
    expect(antes.orcamentosVencendo).toBe(1);
    expect(antes.orcamentoVencendoId).toBe("oHoje");
    expect(antes).not.toHaveProperty("foraDoNumero");
    // atribuir o técnico tira a OS do número
    await prisma.atividadeOs.update({ where: { id: "a2" }, data: { tecnicoId: "t1" } });
    const atribuida = await (await GET()).json();
    expect([atribuida.osSemTecnico, antes.total - atribuida.total]).toEqual([3, 1]);
    await prisma.atividadeOs.update({ where: { id: "a2" }, data: { tecnicoId: null } });
    // o orçamento respondido sai do número; a conta de hoje não entra nele
    await prisma.contaPagar.create({ data: { id: "pHoje", empresaId: "e1", numero: "CP-H", fornecedor: "Frio Sul", descricao: "Gás", valorTotal: 50, saldoRestante: 50, status: "PENDENTE", dataVencimento: hoje } });
    await prisma.orcamento.update({ where: { id: "oHoje" }, data: { status: "APROVADO", respostaVistaEm: new Date() } });
    const depois = await (await GET()).json();
    expect(depois.orcamentosVencendo).toBe(0);
    expect(antes.total - depois.total).toBe(1); // saiu o orçamento; a conta de hoje não somou nada
    const painel = await contar(permissoesTotais(), new Date());
    expect(painel.foraDoNumero.contasPagarHoje).toBe(1);
    expect(painel.total).toBe(depois.total);
    // o técnico (modo técnico) não recebe nada da empresa pelo sino
    tecnico();
    const t = await (await GET()).json();
    expect([t.osSemTecnico, t.orcamentosVencendo]).toEqual([0, 0]);
    await prisma.contaPagar.delete({ where: { id: "pHoje" } });
    await prisma.orcamento.delete({ where: { id: "oHoje" } });
  });

  it("sino lido (/api/alertas/lidos): o toque tira o aviso do número na hora; volta com um novo ou no outro dia; é de cada pessoa", async () => {
    const { GET } = await import("@/app/api/alertas/route");
    const { POST } = await import("@/app/api/alertas/lidos/route");
    const { assinaturaDoAviso } = await import("@/lib/alertas/lidos");
    const ler = async () => (await GET()).json();
    const tocar = (corpo: unknown) => POST(new Request("http://x/api/alertas/lidos", { method: "POST", body: JSON.stringify(corpo) }) as never);
    // relógio fixo ao meio-dia de Brasília: o "dia" do lido não vira no meio do teste
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(MEIO_DIA);
    try {
      escritorio();
      const antes = await ler();
      expect(antes.osSemTecnico).toBe(4);
      expect([antes.total, antes.totalGeral, antes.lidos]).toEqual([antes.totalGeral, antes.totalGeral, []]);
      // o toque: grava o lido do aviso (com a assinatura que a tela mostrava) e o número cai 4
      expect((await tocar({ campo: "osSemTecnico", assinatura: assinaturaDoAviso(antes, "osSemTecnico") })).status).toBe(200);
      const lido = await ler();
      expect([lido.total, lido.totalGeral, lido.lidos]).toEqual([antes.total - 4, antes.totalGeral, ["osSemTecnico"]]);
      const guardado = await prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId: "uA", chave: "sino:lidos" } } });
      expect(guardado.valor).toEqual({ osSemTecnico: { assinatura: "4:os1", dia: "2027-03-10" } });
      // é de cada pessoa: outra pessoa do escritório continua com o número cheio
      escritorio(permissoesTotais(), "uT");
      expect((await ler()).total).toBe(antes.total);
      escritorio();
      // chegou uma OS nova sem técnico: a assinatura muda e o aviso volta a contar (com a nova)
      await prisma.ordemServico.create({ data: { id: "osNova", empresaId: "e1", numero: "OS-N", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Ar quente", status: "ABERTA" } });
      const novo = await ler();
      expect([novo.osSemTecnico, novo.total, novo.lidos]).toEqual([5, antes.total + 1, []]);
      await prisma.ordemServico.delete({ where: { id: "osNova" } });
      expect((await ler()).total).toBe(antes.total - 4); // a mesma situação de quando foi lido
      // no outro dia, com a situação ainda de pé, volta a contar
      vi.setSystemTime(new Date(MEIO_DIA.getTime() + 86_400_000));
      expect((await ler()).total).toBe(antes.total);
      vi.setSystemTime(MEIO_DIA);
      // o que não é aviso do número, ou sem assinatura: recusado; sem sessão: 401
      expect((await tocar({ campo: "contasPagarHoje", assinatura: "1:" })).status).toBe(400);
      expect((await tocar({ campo: "osSemTecnico" })).status).toBe(400);
      expect((await tocar({ campo: "toString", assinatura: "1:" })).status).toBe(400);
      sessao.atual = null;
      expect((await tocar({ campo: "osSemTecnico", assinatura: "4:os1" })).status).toBe(401);
    } finally {
      vi.useRealTimers();
      await prisma.preferenciaUsuario.deleteMany({ where: { chave: "sino:lidos" } });
    }
  });

  it("a tela /pendencias: as áreas de quem vê, o toque de cada item e o vazio do técnico", async () => {
    const { default: Pagina } = await import("@/app/(dashboard)/pendencias/page");
    const html = async () => renderToStaticMarkup(await Pagina());
    escritorio();
    let h = await html();
    expect(h).toContain("Pendências de hoje");
    expect(h).toMatch(/data-area="operacao"/);
    expect(h).toContain('data-pendencia="osSemTecnico"');
    expect(h).toContain('href="/ordens?tecnico=sem&amp;periodo=todos"');
    escritorio(SO_FINANCEIRO(), "uF");
    h = await html();
    expect(h).not.toMatch(/data-area="operacao"/);
    expect(h).not.toContain('data-pendencia="osSemTecnico"');
    tecnico();
    h = await html();
    expect(h).toContain("data-pendencias-vazio");
    expect(h).toContain("Nenhuma pendência hoje.");
  });
});
