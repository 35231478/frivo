/**
 * Pedido do cliente (PC-1) — Prisma real, PostgreSQL real:
 *  - quem fica "Aguardando pedido": modo do cliente e da unidade, cancelada, faturada (inclusive o PC do jeito
 *    antigo, gravado na fatura), liberada; a contagem e o total em R$; outra empresa não entra;
 *  - registrar: um pedido para várias OS e orçamentos do MESMO cliente (outro cliente é recusado), a propagação
 *    orçamento ⇄ OS gerada, o histórico, o alerta de valor menor, a fatura "Aguardando PC" que segue sozinha;
 *  - liberar sem pedido: o motivo, a trilha e a permissão própria (o administrador sempre; perfil sem ela, não);
 *  - as travas: "Faturar" (OS e orçamento), a NFS-e da fatura e o início da execução (app, "Cheguei", escritório);
 *  - a aprovação da fatura, o "Registrar PC" da fatura (o mesmo registro), o nº na discriminação da NFS-e;
 *  - o sino: dias desde a conclusão (no "para executar", desde a aprovação), com o prazo da empresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pedido-cliente-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_TRAVA_FATURAR, MSG_TRAVA_INICIAR, MSG_MOTIVO } from "@/lib/pedido-cliente/regra";
import { PNG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pedido_cliente_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
const comoOperador = (permissoes: Permissoes, id = "uO") => { sessao.atual = { user: { id, name: "Otávio", email: `${id}@x.com`, empresaId: "e1", role: "OPERADOR", permissoes, tecnicoId: null } }; };
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "joao@x.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };
const DIA = (d: number, h = 15) => new Date(Date.UTC(2026, 10, d, h));

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });

describe.skipIf(!URL_PG)("pedido do cliente (PostgreSQL real)", () => {
  let prisma: any;
  let srv: typeof import("@/lib/pedido-cliente/server");
  const aguardando = async () => (await prisma.ordemServico.findMany({ where: { empresaId: "e1", ...srv.whereOsAguardando() }, select: { id: true }, orderBy: { id: "asc" } })).map((o: any) => o.id);
  const hist = async (osId: string) => (await prisma.osHistorico.findMany({ where: { ordemServicoId: osId }, orderBy: { criadoEm: "asc" } })).map((h: any) => [h.acao, h.detalhes]);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    srv = await import("@/lib/pedido-cliente/server");
    await Promise.all(["ordens/[id]", "configuracoes", "pedidos-cliente", "pedidos-cliente/[id]", "pedidos-cliente/[id]/anexo", "pedidos-cliente/liberar", "pedidos-cliente/alvos", "tecnico/sync", "ordens/[id]/atividades/[atividadeId]", "ordens/[id]/faturar", "medicoes/[id]/acao"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uO", empresaId: "e1", nome: "Otávio", email: "uO@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" } });
    await prisma.cliente.createMany({ data: [
      { id: "cNao", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "1" },
      { id: "cFat", empresaId: "e1", nome: "Instituto Horizonte", cpfCnpj: "2", exigePcAntesNf: true },
      { id: "cExe", empresaId: "e1", nome: "Indústria Fictícia Norte", cpfCnpj: "3", exigePcAntesNf: true, exigePedidoExecutar: true },
      { id: "cUni", empresaId: "e1", nome: "Rede de Lojas Exemplo", cpfCnpj: "4" },
      { id: "cOutra", empresaId: "e2", nome: "Da outra", cpfCnpj: "5", exigePcAntesNf: true },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "unFat", empresaId: "e1", clienteId: "cFat", nome: "Sede" },
      { id: "unFatNao", empresaId: "e1", clienteId: "cFat", nome: "Depósito (não exige)", exigePedido: "NAO" },
      { id: "unUni", empresaId: "e1", clienteId: "cUni", nome: "Loja Centro (exige)", exigePedido: "FATURAR" },
      { id: "unExe", empresaId: "e1", clienteId: "cExe", nome: "Fábrica" },
    ] });
    const os = (id: string, clienteId: string, unidadeId: string | null, extra: Record<string, unknown> = {}, empresaId = "e1") => ({
      id, empresaId, numero: `OS-${id}`, clienteId, unidadeId, criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao: "Manutenção", status: "CONCLUIDA",
      criadoEm: DIA(1), dataConclusao: DIA(10), ...extra,
    });
    await prisma.ordemServico.createMany({ data: [
      os("oNao", "cNao", null),                               // cliente não exige: não
      os("oFat1", "cFat", "unFat"),                           // aguarda
      os("oFat2", "cFat", "unFat"),                           // aguarda
      os("oFatNao", "cFat", "unFatNao"),                      // unidade "Não": não
      os("oFatCanc", "cFat", "unFat", { status: "CANCELADA" }),// cancelada: não
      os("oFatAntigo", "cFat", "unFat"),                      // PC do jeito antigo, gravado na fatura: não
      os("oFatNf", "cFat", "unFat"),                          // fatura com NF emitida: não
      os("oUni", "cUni", "unUni"),                            // cliente não exige, mas a unidade sim: aguarda
      os("oExe", "cExe", "unExe", { status: "AGENDADA", dataConclusao: null }), // para executar: aguarda (e trava o início)
      os("oOutra", "cOutra", null, {}, "e2"),
    ] });
    const item = (id: string, ordemServicoId: string, v: number) => ({ id, ordemServicoId, descricao: "Serviço", quantidade: 1, valorUnitario: v, valorTotal: v, executado: true });
    await prisma.osItemOrcamento.createMany({ data: [item("i1", "oFat1", 1000), item("i2", "oFat2", 500), item("i3", "oUni", 250), item("i4", "oExe", 300), item("i5", "oNao", 100)] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aExe", empresaId: "e1", ordemServicoId: "oExe", titulo: "Visita", status: "AGENDADA", tecnicoId: "t1", dataAgendada: DIA(20) },
      { id: "aFat", empresaId: "e1", ordemServicoId: "oFat2", titulo: "Visita", status: "AGENDADA", tecnicoId: "t1", dataAgendada: DIA(20) },
    ] });
    const med = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", clienteId: "cFat", numero: `MED-${id}`, tokenPublico: `tk-${id}`, status, valorTotal: 100, ...extra });
    await prisma.medicao.createMany({ data: [med("mAntigo", "PC_RECEBIDO", { pcNumero: "PC-VELHO-1" }), med("mNf", "NF_EMITIDA")] });
    const mi = (id: string, medicaoId: string, ordemServicoId: string) => ({ id, medicaoId, ordemServicoId, descricao: "x", quantidade: 1, valorUnitario: 100, valorTotal: 100 });
    await prisma.medicaoItem.createMany({ data: [mi("mi1", "mAntigo", "oFatAntigo"), mi("mi2", "mNf", "oFatNf")] });
    await prisma.orcamento.create({ data: { id: "orcFat", empresaId: "e1", codigo: "ORC-1", nome: "Instalação", clienteId: "cFat", unidadeId: "unFat", criadoPorId: "uA", tokenPublico: "tk-orc", status: "APROVADO", assinadoEm: DIA(2), totalGeral: 2000, equipamentosCobertos: [] } });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("quem aguarda: o modo do cliente e da unidade; cancelada, faturada (inclusive o PC antigo na fatura) e outra empresa ficam fora", async () => {
    expect(await aguardando()).toEqual(["oExe", "oFat1", "oFat2", "oUni"]);
    expect(await srv.resumoOsAguardando({ empresaId: "e1" })).toEqual({ quantidade: 4, total: 2050 });
    expect(await srv.resumoOsAguardando({ empresaId: "e1", clienteId: "cFat" })).toEqual({ quantidade: 2, total: 1500 });
    expect((await prisma.orcamento.findMany({ where: { empresaId: "e1", ...srv.whereOrcamentoAguardando() }, select: { id: true } })).map((o: any) => o.id)).toEqual(["orcFat"]);
    expect(await srv.resumoOrcamentosAguardando({ empresaId: "e1" })).toEqual({ quantidade: 1, total: 2000 });
    expect(await srv.usaPedidoCliente("e1")).toBe(true);
    // a empresa sem nenhum cliente marcado não vê nada disto
    await prisma.cliente.update({ where: { id: "cOutra" }, data: { exigePcAntesNf: false } });
    expect(await srv.usaPedidoCliente("e2")).toBe(false);
  });

  it("as travas: faturar a OS e o orçamento, a NFS-e da fatura e o início da execução", async () => {
    comoAdmin();
    let r = await chamar("ordens/[id]/faturar", "POST", { id: "oFat1" }, {});
    expect([r.status, r.json.erro]).toEqual([r.status, MSG_TRAVA_FATURAR]);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await srv.travaFaturarOrcamento("e1", "orcFat")).toBe(MSG_TRAVA_FATURAR);
    const { faturarOrcamento } = await import("@/lib/faturamento/faturar-server");
    expect(await faturarOrcamento({ empresaId: "e1", usuarioId: "uA", orcamentoId: "orcFat" })).toEqual({ tipo: "bloqueado", erro: MSG_TRAVA_FATURAR });
    expect(await srv.travaFaturarOs("e1", "oNao")).toBeNull();
    // o início: só o modo "para executar"
    expect(await srv.travaIniciarAtividade("e1", "aExe")).toBe(MSG_TRAVA_INICIAR);
    expect(await srv.travaIniciarAtividade("e1", "aFat")).toBeNull();
    // app do técnico: iniciar e "Cheguei" recusados com o motivo; a atividade fica Agendada
    comoTecnico();
    r = await chamar("tecnico/sync", "POST", {}, { operacoes: [op("iniciar", "aExe")] });
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 409, erro: MSG_TRAVA_INICIAR });
    r = await chamar("tecnico/sync", "POST", {}, { operacoes: [op("avisoCliente", "aExe", { dados: { evento: "CHEGOU" } })] });
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 409, erro: MSG_TRAVA_INICIAR });
    expect(await prisma.atividadeAviso.count({ where: { atividadeId: "aExe" } })).toBe(0);
    // escritório: pôr a atividade em andamento também trava
    comoAdmin();
    r = await chamar("ordens/[id]/atividades/[atividadeId]", "PUT", { id: "oExe", atividadeId: "aExe" }, { status: "EM_ANDAMENTO" });
    expect([r.status, r.json.erro]).toEqual([409, MSG_TRAVA_INICIAR]);
    expect((await prisma.atividadeOs.findUnique({ where: { id: "aExe" } })).status).toBe("AGENDADA");
  });

  it("registrar: um pedido para várias OS do mesmo cliente; outro cliente e outra empresa recusados; histórico; alerta de valor menor", async () => {
    comoAdmin();
    let r = await chamar("pedidos-cliente", "POST", {}, { numero: "4500", osIds: ["oFat1", "oUni"] });
    expect([r.status, r.json.erro]).toEqual([400, "Um pedido do cliente cobre OS e orçamentos de um cliente só. Selecione itens do mesmo cliente."]);
    // a gaveta já sabe antes de salvar (e avisa)
    expect((await chamar("pedidos-cliente/alvos", "GET", {}, undefined, "?os=oFat1,oUni")).json.mesmoCliente).toBe(false);
    expect((await chamar("pedidos-cliente/alvos", "GET", {}, undefined, "?os=oFat1,oFat2")).json.mesmoCliente).toBe(true);
    r = await chamar("pedidos-cliente", "POST", {}, { numero: "4500", osIds: ["oFat1", "oOutra"] });
    expect(r.status).toBe(404);
    r = await chamar("pedidos-cliente", "POST", {}, { numero: "   ", osIds: ["oFat1"] });
    expect(r.status).toBe(400);
    for (const valor of [-1, "abc"]) {
      r = await chamar("pedidos-cliente", "POST", {}, { numero: "4500", valor, osIds: ["oFat1"] });
      expect([r.status, r.json.erro]).toEqual([400, "Valor do pedido inválido."]);
    }
    r = await chamar("pedidos-cliente", "POST", {}, { numero: " 4500012345 ", data: "2026-11-25", valor: 1200, observacao: "Pedido do semestre", osIds: ["oFat1", "oFat2"],
      anexo: { conteudo: dataUrl("image/png", PNG), nome: "pedido.png" } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ ok: true, ligadas: { os: 2, orcamentos: 0 } });
    expect(r.json.alerta).toBe("O valor do pedido (R$ 1.200,00) é menor que o total das OS e orçamentos que ele cobre (R$ 1.500,00).");
    const p = await prisma.pedidoCliente.findUnique({ where: { id: r.json.pedidoId } });
    expect(p).toMatchObject({ empresaId: "e1", clienteId: "cFat", numero: "4500012345", observacao: "Pedido do semestre", anexoTipo: "image/png", criadoPorId: "uA" });
    expect(p.data.toISOString().slice(0, 10)).toBe("2026-11-25");
    expect(await aguardando()).toEqual(["oExe", "oUni"]);
    expect(await hist("oFat1")).toContainEqual(["Pedido do cliente informado", "nº 4500012345 · R$ 1.200,00"]);
    // a gaveta lê o pedido e o anexo
    const g = await chamar("pedidos-cliente/[id]", "GET", { id: r.json.pedidoId });
    expect(g.json).toMatchObject({ numero: "4500012345", valor: 1200, total: 1500, cliente: "Instituto Horizonte", temAnexo: true, ordens: [{ numero: "OS-oFat1" }, { numero: "OS-oFat2" }] });
    const a = await import("@/app/api/pedidos-cliente/[id]/anexo/route");
    expect((await a.GET(new NextRequest("http://x"), { params: Promise.resolve({ id: r.json.pedidoId }) })).status).toBe(200);
    // corrigir o número: fica no histórico, as ligações ficam
    const e = await chamar("pedidos-cliente/[id]", "PATCH", { id: r.json.pedidoId }, { numero: "4500012346", valor: 1500 });
    expect(e.json).toEqual({ ok: true, alerta: null });
    expect(await hist("oFat2")).toContainEqual(["Pedido do cliente corrigido", "nº 4500012345 → nº 4500012346"]);
    // faturar agora passa, com o nº do pedido na fatura
    const f = await chamar("ordens/[id]/faturar", "POST", { id: "oFat1" }, {});
    expect(f.status).toBeLessThan(300);
    const fatura = await prisma.medicao.findFirst({ where: { itens: { some: { ordemServicoId: "oFat1" } }, avulsa: true } });
    expect(fatura).toMatchObject({ status: "PC_RECEBIDO", pcNumero: "4500012346" });
    // o número entra sozinho na discriminação da NFS-e (a referência da fatura)
    const { referenciaNota } = await import("@/lib/faturamento/fatura");
    expect(referenciaNota(fatura)).toMatch(/^Fatura nº .+ · Pedido do cliente nº 4500012346$/);
  });

  it("o orçamento leva a OS gerada dele (e vice-versa); a OS gerada depois herda o pedido", async () => {
    comoAdmin();
    const r = await chamar("pedidos-cliente", "POST", {}, { numero: "PO-77", orcamentoIds: ["orcFat"] });
    expect(r.status).toBe(201);
    expect((await prisma.orcamento.findUnique({ where: { id: "orcFat" } })).pedidoClienteId).toBe(r.json.pedidoId);
    expect(await srv.travaFaturarOrcamento("e1", "orcFat")).toBeNull();
    const { gerarOsDoOrcamento } = await import("@/lib/orcamentos/gerar-os-server");
    const { prepararExecucao } = await import("@/lib/os/abertura");
    const prep: any = await prepararExecucao("e1", { tecnicoId: "t1" });
    await gerarOsDoOrcamento({ empresaId: "e1", usuarioId: "uA", orcamentoId: "orcFat", execucao: prep.execucao });
    const osId = (await prisma.ordemServico.findFirst({ where: { orcamentoOrigemId: "orcFat" } })).id;
    expect((await prisma.ordemServico.findUnique({ where: { id: osId } })).pedidoClienteId).toBe(r.json.pedidoId);
    expect((await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: "orcFat", tipo: "PEDIDO_CLIENTE" } })).detalhe).toBe("Pedido do cliente nº PO-77");
    // a OS JÁ gerada: informar no orçamento leva a OS; informar na OS leva o orçamento de origem
    for (const n of [2, 3]) {
      await prisma.orcamento.create({ data: { id: `orcFat${n}`, empresaId: "e1", codigo: `ORC-${n}`, nome: "Instalação", clienteId: "cFat", criadoPorId: "uA", tokenPublico: `tk-orc${n}`, status: "APROVADO", assinadoEm: DIA(2), totalGeral: 100, equipamentosCobertos: [] } });
      await prisma.ordemServico.create({ data: { id: `oGer${n}`, empresaId: "e1", numero: `OS-G${n}`, clienteId: "cFat", criadoPorId: "uA", descricao: "x", status: "ABERTA", orcamentoOrigemId: `orcFat${n}` } });
    }
    const r2 = await chamar("pedidos-cliente", "POST", {}, { numero: "PO-78", orcamentoIds: ["orcFat2"] });
    expect(r2.json.ligadas).toEqual({ os: 1, orcamentos: 1 });
    expect((await prisma.ordemServico.findUnique({ where: { id: "oGer2" } })).pedidoClienteId).toBe(r2.json.pedidoId);
    const r3 = await chamar("pedidos-cliente", "POST", {}, { numero: "PO-79", osIds: ["oGer3"] });
    expect(r3.json.ligadas).toEqual({ os: 1, orcamentos: 1 });
    expect((await prisma.orcamento.findUnique({ where: { id: "orcFat3" } })).pedidoClienteId).toBe(r3.json.pedidoId);
  });

  it("liberar sem pedido: só com a permissão (o administrador sempre), com motivo; a trilha guarda; o início destrava", async () => {
    comoOperador(montarPermissoes({ ordens: ["visualizar", "editar"] }));
    let r = await chamar("pedidos-cliente/liberar", "POST", {}, { osIds: ["oExe"], motivo: "Contrato emergencial" });
    expect(r.status).toBe(403);
    comoOperador(montarPermissoes({ ordens: ["visualizar", "liberarSemPedido"] }));
    r = await chamar("pedidos-cliente/liberar", "POST", {}, { osIds: ["oExe"], motivo: "ok" });
    expect([r.status, r.json.erro]).toEqual([400, MSG_MOTIVO]);
    r = await chamar("pedidos-cliente/liberar", "POST", {}, { osIds: ["oExe"], motivo: "  Atendimento emergencial autorizado pelo gerente  " });
    expect(r.json).toEqual({ ok: true, liberadas: 1 });
    expect(await prisma.ordemServico.findUnique({ where: { id: "oExe" } })).toMatchObject({ pedidoLiberadoPorId: "uO", pedidoLiberadoMotivo: "Atendimento emergencial autorizado pelo gerente" });
    expect(await hist("oExe")).toContainEqual(["Liberada sem pedido do cliente", "Atendimento emergencial autorizado pelo gerente"]);
    expect(await srv.travaIniciarAtividade("e1", "aExe")).toBeNull();
    expect(await aguardando()).toEqual(["oUni"]);
    // informar o pedido exige editar OS (ou lançar faturas): quem só vê OS não informa
    comoOperador(montarPermissoes({ ordens: ["visualizar"] }));
    r = await chamar("pedidos-cliente", "POST", {}, { numero: "1", osIds: ["oUni"] });
    expect(r.status).toBe(403);
    comoOperador(montarPermissoes({ financeiro: ["visualizar", "medicoes"] } as never));
    expect((await chamar("pedidos-cliente/alvos", "GET", {}, undefined, "?os=oUni")).json).toMatchObject({ itens: [{ numero: "OS-oUni", valor: 250, aguardando: true }], mesmoCliente: true, total: 250, podeLiberar: false });
  });

  it("a fatura aprovada: 'Aguardando PC' só se alguma OS espera; o Registrar PC da fatura é o mesmo registro e a fatura segue", async () => {
    const m = await prisma.medicao.create({ data: { id: "mUni", empresaId: "e1", clienteId: "cUni", numero: "MED-UNI", tokenPublico: "tk-uni", status: "AGUARDANDO_APROVACAO", valorTotal: 250 } });
    await prisma.medicaoItem.create({ data: { id: "miUni", medicaoId: m.id, ordemServicoId: "oUni", descricao: "x", quantidade: 1, valorUnitario: 250, valorTotal: 250 } });
    const { aprovarMedicao } = await import("@/lib/faturamento/aprovar-medicao-server");
    expect(await aprovarMedicao("mUni")).toEqual({ status: "AGUARDANDO_PC" });
    // "Aguardando PC" não está entre os status que emitem a NFS-e (a trava da nota é o status da fatura)
    const { STATUS_MEDICAO_EMITE } = await import("@/lib/nfse/nota");
    expect((STATUS_MEDICAO_EMITE as readonly string[]).includes("AGUARDANDO_PC")).toBe(false);
    comoAdmin();
    const r = await chamar("medicoes/[id]/acao", "POST", { id: "mUni" }, { acao: "REGISTRAR_PC", pcNumero: "OC-2026-889" });
    expect(r.json).toMatchObject({ ok: true, status: "PC_RECEBIDO" });
    expect(await prisma.medicao.findUnique({ where: { id: "mUni" } })).toMatchObject({ status: "PC_RECEBIDO", pcNumero: "OC-2026-889" });
    expect((await prisma.ordemServico.findUnique({ where: { id: "oUni" }, include: { pedidoCliente: true } })).pedidoCliente.numero).toBe("OC-2026-889");
    const { referenciaNota } = await import("@/lib/faturamento/fatura");
    expect(referenciaNota((await prisma.medicao.findUnique({ where: { id: "mUni" } })))).toBe("Medição MED-UNI · Pedido do cliente nº OC-2026-889");
    expect(await aguardando()).toEqual([]);
    // a fatura de OS que já tem pedido: aprovada segue direto, com o número
    const m2 = await prisma.medicao.create({ data: { id: "mFat2", empresaId: "e1", clienteId: "cFat", numero: "MED-F2", tokenPublico: "tk-f2", status: "AGUARDANDO_APROVACAO", valorTotal: 500 } });
    await prisma.medicaoItem.create({ data: { id: "miF2", medicaoId: m2.id, ordemServicoId: "oFat2", descricao: "x", quantidade: 1, valorUnitario: 500, valorTotal: 500 } });
    expect(await aprovarMedicao("mFat2")).toEqual({ status: "PC_RECEBIDO" });
    expect((await prisma.medicao.findUnique({ where: { id: "mFat2" } })).pcNumero).toBe("4500012346");
  });

  it("o sino: OS aguardando há mais que os dias da empresa (desde a conclusão; no 'para executar', desde a aprovação)", async () => {
    await prisma.ordemServico.createMany({ data: [
      { id: "sFatVelha", empresaId: "e1", numero: "S1", clienteId: "cFat", unidadeId: "unFat", criadoPorId: "uA", descricao: "x", status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(5) },
      { id: "sFatNova", empresaId: "e1", numero: "S2", clienteId: "cFat", unidadeId: "unFat", criadoPorId: "uA", descricao: "x", status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(24) },
      { id: "sFatAberta", empresaId: "e1", numero: "S3", clienteId: "cFat", unidadeId: "unFat", criadoPorId: "uA", descricao: "x", status: "AGENDADA", criadoEm: DIA(1) },
      { id: "sExe", empresaId: "e1", numero: "S4", clienteId: "cExe", unidadeId: "unExe", criadoPorId: "uA", descricao: "x", status: "AGENDADA", criadoEm: DIA(10) },
    ] });
    const agora = DIA(27);
    expect(await srv.contarPedidosAtrasados("e1", agora)).toEqual({ pedidosAtrasados: 2, pedidoAtrasadoOsId: "sFatVelha", diasAlertaPedido: 7 });
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { pedidoClienteDiasAlerta: 20 } });
    expect((await srv.contarPedidosAtrasados("e1", agora)).pedidosAtrasados).toBe(1); // só a de 22 dias
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { pedidoClienteDiasAlerta: 22 } });
    expect((await srv.contarPedidosAtrasados("e1", agora)).pedidosAtrasados).toBe(0); // 22 dias exatos ainda não é "há mais de 22"
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { pedidoClienteDiasAlerta: 7 } });
  });

  it("a lista de OS: o filtro ?pedido=aguardando, a etiqueta de cada linha e o resumo (quantas e R$)", async () => {
    const { carregarListaOs } = await import("@/lib/os/lista-server");
    const l = await carregarListaOs("e1", { periodo: "todos", pedido: "aguardando", sort: "numero", dir: "asc" }, DIA(27));
    expect(l.linhas.map((o) => o.id)).toEqual(["sFatVelha", "sFatNova", "sFatAberta", "sExe"]);
    expect(l.linhas.every((o) => o.pedidoCliente?.aguardando)).toBe(true);
    expect(l.resumoPedido).toEqual({ quantidade: 4, total: 0, conferir: 0 });
    const todas = await carregarListaOs("e1", { periodo: "todos", sort: "numero", dir: "asc" }, DIA(27));
    const por = Object.fromEntries(todas.linhas.map((o) => [o.id, o.pedidoCliente]));
    expect(por.oNao).toBeNull();                                         // o cliente não exige: sem etiqueta
    expect(por.oFat1).toMatchObject({ aguardando: false, pedido: { numero: "4500012346" } });
    expect(por.oExe).toMatchObject({ aguardando: false, pedido: null, liberadoMotivo: "Atendimento emergencial autorizado pelo gerente" });
    // a empresa sem nenhum cliente que exige: nem resumo nem etiqueta
    const outra = await carregarListaOs("e2", { periodo: "todos" }, DIA(27));
    expect([outra.resumoPedido, outra.linhas[0].pedidoCliente]).toEqual([null, null]);
  });

  it("o painel de pendências (N · R$) e o sino (só as atrasadas, no número); o técnico não recebe nada disso", async () => {
    const sino = await import("@/lib/alertas/sino");
    const { contarSino } = await import("@/lib/alertas/sino-server");
    const pend = await import("@/lib/alertas/pendencias");
    const escritorio = sino.escopoDoSino({ permissoes: permissoesTotais(), role: "ADMIN", restrito: false });
    const c = await contarSino({ empresaId: "e1", usuarioId: "uA", escopo: escritorio, filtroTecnico: {}, agora: DIA(27) });
    expect(c.foraDoNumero).toMatchObject({ pedidosAguardando: 4, pedidosAguardandoTotal: 0 });
    expect([c.pedidosAtrasados, c.pedidoAtrasadoOsId, c.diasAlertaPedido]).toEqual([2, "sFatVelha", 7]);
    expect(pend.itemPendencia("pedidosCliente", c)).toMatchObject({ rotulo: "Aguardando pedido do cliente", valor: 4, href: "/ordens?pedido=aguardando&periodo=todos&sort=criadoEm&dir=asc", detalhe: null });
    // o total em R$ aparece quando há valor; as atrasadas entram no número do sino
    await prisma.osItemOrcamento.create({ data: { id: "iS", ordemServicoId: "sFatVelha", descricao: "x", quantidade: 1, valorUnitario: 800, valorTotal: 800, executado: true } });
    const c2 = await contarSino({ empresaId: "e1", usuarioId: "uA", escopo: escritorio, filtroTecnico: {}, agora: DIA(27) });
    expect(pend.itemPendencia("pedidosCliente", c2).detalhe).toBe("R$ 800,00");
    const { totalDoSino } = await import("@/lib/alertas/lidos");
    expect(totalDoSino({ ...c2, pedidosAtrasados: 0 })).toBe(c2.total - 2);
    const t = await contarSino({ empresaId: "e1", usuarioId: "uT", escopo: sino.escopoDoSino({ permissoes: PRESETS.TECNICO, role: "TECNICO", restrito: true }), filtroTecnico: {}, agora: DIA(27) });
    expect([t.pedidosAtrasados, t.foraDoNumero.pedidosAguardando]).toEqual([0, 0]);
  });

  it("Configurações grava o prazo do aviso (1 a 90 dias)", async () => {
    comoAdmin();
    let r = await chamar("configuracoes", "PUT", {}, { pedidoClienteDiasAlerta: "15" });
    expect(r.status).toBe(200);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).pedidoClienteDiasAlerta).toBe(15);
    r = await chamar("configuracoes", "PUT", {}, { pedidoClienteDiasAlerta: 0 });
    expect(r.status).toBe(400);
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { pedidoClienteDiasAlerta: 7 } });
  });

  it("o início pelo escritório (OS em andamento) trava; o Meu dia do técnico avisa no cartão antes do 'Cheguei'", async () => {
    await prisma.ordemServico.createMany({ data: [
      { id: "oExe2", empresaId: "e1", numero: "OS-E2", clienteId: "cExe", unidadeId: "unExe", criadoPorId: "uA", descricao: "x", status: "AGENDADA" },
      { id: "oNao2", empresaId: "e1", numero: "OS-N2", clienteId: "cNao", criadoPorId: "uA", descricao: "x", status: "AGENDADA" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aExe2", empresaId: "e1", ordemServicoId: "oExe2", titulo: "Visita", status: "AGENDADA", tecnicoId: "t1", dataAgendada: DIA(27, 13) },
      { id: "aNao2", empresaId: "e1", ordemServicoId: "oNao2", titulo: "Visita", status: "AGENDADA", tecnicoId: "t1", dataAgendada: DIA(27, 14) },
    ] });
    comoAdmin();
    const r = await chamar("ordens/[id]", "PUT", { id: "oExe2" }, { status: "EM_ANDAMENTO" });
    expect([r.status, r.json.erro]).toEqual([409, MSG_TRAVA_INICIAR]);
    expect((await prisma.ordemServico.findUnique({ where: { id: "oExe2" } })).status).toBe("AGENDADA");
    const { meuDia } = await import("@/lib/tecnico/dia");
    const dia = await meuDia("e1", "t1", DIA(27));
    const por = Object.fromEntries(dia.atividades.map((c: any) => [c.atividadeId, c.aguardandoPedido ?? false]));
    expect(por).toMatchObject({ aExe2: true, aNao2: false });
  });

  it("a fatura que nasce do relatório: com a OS esperando o pedido, nasce 'Aguardando pedido' (a NFS-e espera); sem exigência, segue", async () => {
    await prisma.ordemServico.create({ data: { id: "oNao3", empresaId: "e1", numero: "OS-N3", clienteId: "cNao", criadoPorId: "uA", descricao: "x", status: "CONCLUIDA" } });
    const rel = (id: string, ordemServicoId: string) => ({ id, empresaId: "e1", ordemServicoId, numero: `REL-${id}`, mesReferencia: 11, anoReferencia: 2026, tokenPublico: `tk-${id}`, escopo: "MEDICAO_COMPLETA", valorFinanceiro: 800 });
    await prisma.relatorioOs.createMany({ data: [rel("rFat", "sFatAberta"), rel("rNao", "oNao3")] });
    const { criarMedicaoDeRelatorio } = await import("@/lib/financeiro-server");
    await criarMedicaoDeRelatorio("rFat");
    await criarMedicaoDeRelatorio("rNao");
    const status = async (osId: string) => (await prisma.medicao.findFirst({ where: { itens: { some: { ordemServicoId: osId } } } }))?.status;
    expect([await status("sFatAberta"), await status("oNao3")]).toEqual(["AGUARDANDO_PC", "PC_RECEBIDO"]);
  });
});
