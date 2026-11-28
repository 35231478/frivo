/**
 * PC-2 — Pedido do cliente no portal + lembretes: Prisma real, PostgreSQL real.
 *  - PORTAL: o comprador (permissão ou "Contato de compras") vê só o que é do PRÓPRIO cliente; enviar um item de outro
 *    cliente ou de outra empresa é recusado; sem arquivo, não; com a troca de senha pendente, não;
 *  - o pedido enviado fica "CONFERIR": NADA é ligado e o faturamento continua travado; a trilha, o push e o sino;
 *  - ESCRITÓRIO: a etiqueta "conferir", o GET do pedido (o que ele cobre), a permissão; RECUSAR com motivo (o cliente
 *    vê; o item volta a aguardar); CONFIRMAR liga, libera o faturamento e faz a fatura "Aguardando PC" seguir; duas
 *    confirmações não ligam duas vezes; outra empresa não vê;
 *  - LEMBRETES (o cron): um e-mail por cliente com tudo o que está pendente; nunca o resolvido nem o que está em
 *    conferência; rodar de novo (e duas rodadas ao mesmo tempo) não duplica; a etapa seguinte sai; o envio que falha
 *    volta para a próxima rodada; desligado na empresa ou no cliente, ou sem e-mail, nada sai; cada empresa no seu;
 *    a trilha da OS e o "último lembrete" do escritório; a rota com CRON_SECRET.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pedido-cliente-portal-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { MSG_TRAVA_FATURAR } from "@/lib/pedido-cliente/regra";
import { MSG_MOTIVO_RECUSA, MSG_SEM_PERMISSAO_PEDIDO_PORTAL, TIPO_EMAIL_LEMBRETE } from "@/lib/pedido-cliente/lembretes";
import { MSG_TROCA_PENDENTE_PORTAL } from "@/lib/portal/senha-provisoria";
import { PDF, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pc2_portal_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
const portal = vi.hoisted(() => ({ atual: null as any }));
const fila = vi.hoisted(() => ({ depois: [] as (() => unknown)[], push: [] as any[], emails: [] as any[], falharPara: new Set<string>() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/auth-portal", () => ({
  getPortalSession: vi.fn(async (op: { comTroca?: boolean } = {}) => (portal.atual && (!portal.atual.user.trocarSenha || op.comTroca) ? portal.atual : null)),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { fila.depois.push(fn); } }));
vi.mock("@/lib/push/servidor", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/servidor")>()),
  usuariosComAparelho: vi.fn(async () => ["uA"]),
  enviarPush: vi.fn(async (p: any) => { fila.push.push(p); return { enviados: 1 }; }),
}));
vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async (empresaId: string, p: any) => {
    if (fila.falharPara.has(p.para)) return { ok: false, erro: "falha simulada" };
    fila.emails.push({ empresaId, ...p });
    return { ok: true };
  }),
}));

const comoAdmin = (empresaId = "e1") => { sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.test", empresaId, role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
const comoOperadorSemOs = () => { sessao.atual = { user: { id: "uO", name: "Otávio", email: "o@x.test", empresaId: "e1", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar"] }), tecnicoId: null } }; };
const comoContato = (id: string, email: string, clienteId = "cA", permissoes: Record<string, boolean> = { verOS: true }, extra: Record<string, unknown> = {}) => {
  portal.atual = { user: { id, name: "Bruno Compras", email, clienteId, clienteNome: "Indústria A", empresaId: "e1", permissoes, ...extra } };
};
const DIA = (d: number, h = 15) => new Date(Date.UTC(2026, 10, d, h));
const ANEXO = { conteudo: dataUrl("application/pdf", PDF), nome: "pedido-4500123.pdf" };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, headers: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json", ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
const rodarDepois = async () => { const fs = fila.depois.splice(0); for (const f of fs) await f(); };

describe.skipIf(!URL_PG)("PC-2 — pedido do cliente no portal + lembretes (PostgreSQL real)", () => {
  let prisma: any;
  let srv: typeof import("@/lib/pedido-cliente/server");
  let ps: typeof import("@/lib/pedido-cliente/portal-server");
  let lem: typeof import("@/lib/pedido-cliente/lembretes-server");
  const hist = async (osId: string) => (await prisma.osHistorico.findMany({ where: { ordemServicoId: osId }, orderBy: { criadoEm: "asc" } })).map((h: any) => `${h.acao} | ${h.detalhes}`);
  const emailsPara = (para: string) => fila.emails.filter((e) => e.para === para);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    srv = await import("@/lib/pedido-cliente/server");
    ps = await import("@/lib/pedido-cliente/portal-server");
    lem = await import("@/lib/pedido-cliente/lembretes-server");
    await Promise.all(["portal/pedidos-compra", "pedidos-cliente", "pedidos-cliente/[id]", "pedidos-cliente/[id]/conferir", "cron/lembretes-pedido"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total (fictícia)", cnpj: "12.345.678/0001-90", email: "e@x.test" },
      { id: "e2", nome: "Outra Refrigeração (fictícia)", cnpj: "98.765.432/0001-10", email: "o@x.test" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.test", senha: "x", role: "ADMIN", criadoEm: DIA(1, 8) },
      { id: "uO", empresaId: "e1", nome: "Otávio", email: "o@x.test", senha: "x", criadoEm: DIA(1, 9) },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.test", senha: "x", role: "ADMIN" },
    ] });
    const cli = (id: string, empresaId: string, nome: string, extra: Record<string, unknown> = {}) => ({ id, empresaId, nome, cpfCnpj: id, exigePcAntesNf: true, ...extra });
    await prisma.cliente.createMany({ data: [
      cli("cA", "e1", "Indústria A (fictícia)", { comprasNome: "Bruno", comprasEmail: "Compras@A.test" }),
      cli("cB", "e1", "Clínica B (fictícia)", { comprasEmail: "compras@b.test" }),
      cli("cL", "e1", "Logística L (fictícia)", { comprasNome: "Lia", comprasEmail: "compras@l.test" }),
      cli("cSem", "e1", "Sem e-mail (fictícia)"),
      cli("cDesl", "e1", "Lembretes desligados (fictícia)", { comprasEmail: "compras@desl.test", pedidoLembretesAtivo: false }),
      cli("cNao", "e1", "Não exige (fictícia)", { exigePcAntesNf: false, comprasEmail: "compras@nao.test" }),
      cli("cE2", "e2", "Cliente da outra (fictícia)", { comprasEmail: "compras@e2.test" }),
    ] });
    const os = (id: string, clienteId: string, conclusao: Date | null, extra: Record<string, unknown> = {}, empresaId = "e1") => ({
      id, empresaId, numero: `OS-${id}`, clienteId, criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao: "Manutenção",
      status: conclusao ? "CONCLUIDA" : "AGENDADA", criadoEm: DIA(1), dataConclusao: conclusao, ...extra,
    });
    await prisma.ordemServico.createMany({ data: [
      os("oA1", "cA", DIA(10)), os("oA2", "cA", DIA(12)), os("oB1", "cB", DIA(10)),
      os("oL1", "cL", DIA(10)), os("oL2", "cL", DIA(12)), os("oL3", "cL", null),
      os("oSem", "cSem", DIA(1)), os("oDesl", "cDesl", DIA(1)), os("oNao", "cNao", DIA(1)),
      os("oE2", "cE2", DIA(1), {}, "e2"),
    ] });
    const item = (id: string, ordemServicoId: string, v: number) => ({ id, ordemServicoId, descricao: "Serviço", quantidade: 1, valorUnitario: v, valorTotal: v, executado: true });
    await prisma.osItemOrcamento.createMany({ data: [item("i1", "oA1", 1800), item("i2", "oA2", 950), item("i3", "oB1", 300), item("i4", "oL1", 1000), item("i5", "oL2", 500), item("i6", "oE2", 700)] });
    await prisma.orcamento.createMany({ data: [
      { id: "orcA", empresaId: "e1", codigo: "ORC-A", nome: "Instalação", clienteId: "cA", criadoPorId: "uA", tokenPublico: "tk-orc-a", status: "APROVADO", assinadoEm: DIA(5), totalGeral: 2000, equipamentosCobertos: [] },
      { id: "orcL", empresaId: "e1", codigo: "ORC-L", nome: "Instalação", clienteId: "cL", criadoPorId: "uA", tokenPublico: "tk-orc-l", status: "APROVADO", assinadoEm: DIA(5), totalGeral: 2000, equipamentosCobertos: [] },
    ] });
    await prisma.relatorioOs.create({ data: { id: "rA1", empresaId: "e1", ordemServicoId: "oA1", numero: "REL-1", escopo: "GERAL", mesReferencia: 11, anoReferencia: 2026, tokenPublico: "tk-rel-a1" } });
    // a fatura de oA1 parada em "Aguardando PC": segue sozinha quando o pedido do portal é confirmado
    await prisma.medicao.create({ data: { id: "mA", empresaId: "e1", clienteId: "cA", numero: "MED-A", tokenPublico: "tk-med-a", status: "AGUARDANDO_PC", valorTotal: 1800 } });
    await prisma.medicaoItem.create({ data: { id: "miA", medicaoId: "mA", ordemServicoId: "oA1", descricao: "x", quantidade: 1, valorUnitario: 1800, valorTotal: 1800 } });
  }, 180_000);
  afterEach(() => { portal.atual = null; });
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── PORTAL ───────── */

  it("quem vê 'Pedido de compra': o Contato de compras (mesmo e-mail, sem diferença de maiúsculas) ou quem tem a permissão; cliente que não exige, ninguém", async () => {
    expect((await ps.acessoPedidoNoPortal({ empresaId: "e1", clienteId: "cA", email: "compras@a.test", permissoes: {} })).pode).toBe(true);
    expect((await ps.acessoPedidoNoPortal({ empresaId: "e1", clienteId: "cA", email: "outro@a.test", permissoes: { verOS: true } })).pode).toBe(false);
    expect((await ps.acessoPedidoNoPortal({ empresaId: "e1", clienteId: "cA", email: "outro@a.test", permissoes: { enviarPedidoCompra: true } })).pode).toBe(true);
    expect((await ps.acessoPedidoNoPortal({ empresaId: "e1", clienteId: "cNao", email: "compras@nao.test", permissoes: {} })).pode).toBe(false);
    // o cliente de outra empresa com o mesmo id de sessão não existe nesta empresa
    expect((await ps.acessoPedidoNoPortal({ empresaId: "e2", clienteId: "cA", email: "compras@a.test", permissoes: {} })).pode).toBe(false);
  });

  it("a lista do portal: só o próprio cliente; nº, conclusão, valor, o relatório em PDF; a OS ainda em execução aparece sem dias", async () => {
    const itens = await ps.pendentesDoCliente("e1", "cA", DIA(20));
    expect(itens.map((i) => [i.tipo, i.id, i.numero, i.valor, i.diasEsperando, i.documento])).toEqual([
      ["orcamento", "orcA", "ORC-A", 2000, 15, "/orcamento/tk-orc-a"],
      ["os", "oA1", "OS-oA1", 1800, 10, "/relatorio/os/tk-rel-a1"],
      ["os", "oA2", "OS-oA2", 950, 8, null],
    ]);
    expect((await ps.pendentesDoCliente("e1", "cL", DIA(20))).find((i) => i.id === "oL3")?.diasEsperando).toBeNull();
    // isolamento: outra empresa com o mesmo cliente não vê nada
    expect(await ps.pendentesDoCliente("e2", "cA", DIA(20))).toEqual([]);
    // o orçamento cuja OS gerada já está na lista não aparece duas vezes (a OS o representa)
    await prisma.cliente.create({ data: { id: "cG", empresaId: "e1", nome: "Gerada (fictícia)", cpfCnpj: "cG", exigePcAntesNf: true } });
    await prisma.orcamento.create({ data: { id: "orcG", empresaId: "e1", codigo: "ORC-G", nome: "Instalação", clienteId: "cG", criadoPorId: "uA", tokenPublico: "tk-orc-g", status: "APROVADO", assinadoEm: DIA(5), totalGeral: 900, equipamentosCobertos: [] } });
    await prisma.ordemServico.create({ data: { id: "oG", empresaId: "e1", numero: "OS-oG", clienteId: "cG", criadoPorId: "uA", descricao: "Instalação", status: "CONCLUIDA", criadoEm: DIA(6), dataConclusao: DIA(9), orcamentoOrigemId: "orcG" } });
    expect((await ps.pendentesDoCliente("e1", "cG", DIA(20))).map((i) => i.id)).toEqual(["oG"]);
  });

  it("enviar: sem permissão (403), com a troca de senha pendente (403), item de outro cliente ou de outra empresa (400), sem arquivo (400)", async () => {
    const corpo = (osIds: string[], extra: Record<string, unknown> = {}) => ({ numero: "4500123", data: "2026-11-20", valor: "3800", anexo: ANEXO, osIds, ...extra });
    comoContato("ctOutro", "outro@a.test");
    expect(await chamar("portal/pedidos-compra", "POST", {}, corpo(["oA1"]))).toEqual({ status: 403, json: { erro: MSG_SEM_PERMISSAO_PEDIDO_PORTAL } });
    comoContato("ctA", "compras@a.test", "cA", {}, { trocarSenha: true });
    expect(await chamar("portal/pedidos-compra", "POST", {}, corpo(["oA1"]))).toEqual({ status: 403, json: { erro: MSG_TROCA_PENDENTE_PORTAL } });
    comoContato("ctA", "compras@a.test");
    for (const ids of [["oB1"], ["oE2"], ["oA1", "oB1"], ["naoExiste"]]) {
      const r = await chamar("portal/pedidos-compra", "POST", {}, corpo(ids));
      expect([ids, r.status, r.json.erro]).toEqual([ids, 400, ps.MSG_ITEM_INVALIDO]);
    }
    expect((await chamar("portal/pedidos-compra", "POST", {}, corpo(["oA1"], { anexo: null }))).json.erro).toBe("Anexe o pedido de compra (PDF ou foto).");
    expect((await chamar("portal/pedidos-compra", "POST", {}, corpo([]))).json.erro).toBe(ps.MSG_ITENS_PORTAL);
    expect(await prisma.pedidoCliente.count()).toBe(0);
  });

  let pedido1 = "";
  it("enviado: fica 'CONFERIR', nada é ligado e o faturamento continua travado; a trilha, o push e o sino; não dá para mandar o mesmo item de novo", async () => {
    comoContato("ctA", "compras@a.test");
    fila.push = [];
    const r = await chamar("portal/pedidos-compra", "POST", {}, { numero: " 4500123 ", data: "2026-11-20", valor: "3800", observacao: "Pedido do mês", anexo: ANEXO, osIds: ["oA1"], orcamentoIds: ["orcA"] });
    expect(r.status).toBe(201);
    pedido1 = r.json.pedidoId;
    const p = await prisma.pedidoCliente.findUnique({ where: { id: pedido1 } });
    expect([p.origem, p.situacao, p.numero, Number(p.valor), p.osPropostas, p.orcamentosPropostos, p.enviadoPorContatoId, p.criadoPorId, p.anexoNome])
      .toEqual(["PORTAL", "CONFERIR", "4500123", 3800, ["oA1"], ["orcA"], "ctA", null, "pedido-4500123.pdf"]);
    expect((await prisma.ordemServico.findUnique({ where: { id: "oA1" } })).pedidoClienteId).toBeNull();
    expect(await srv.travaFaturarOs("e1", "oA1")).toBe(MSG_TRAVA_FATURAR);
    expect(await hist("oA1")).toEqual(["Pedido de compra recebido pelo portal | nº 4500123 · R$ 3.800,00 · por Bruno Compras (o escritório confere)"]);
    expect((await prisma.orcamentoEvento.findMany({ where: { orcamentoId: "orcA" } })).map((e: any) => [e.tipo, e.usuarioId])).toEqual([["PEDIDO_CLIENTE", null]]);
    await rodarDepois();
    expect(fila.push.map((x) => [x.tipo, x.alcance, x.chave, x.mensagem.titulo, x.mensagem.url])).toEqual([["PEDIDO_CLIENTE", "escritorio", `pedido-cliente:${pedido1}`, "Pedido do cliente recebido: nº 4500123", "/ordens?pedido=conferir&periodo=todos"]]);
    expect(await ps.contarPedidosConferir("e1")).toEqual({ pedidosConferir: 1, pedidoConferirId: pedido1, pedidoConferirOsId: "oA1", pedidoConferirOrcamentoId: null });
    expect((await ps.contarPedidosConferir("e2")).pedidosConferir).toBe(0);
    expect(await ps.osEmConferencia("e1")).toEqual(["oA1"]);
    // em conferência: o portal mostra e não deixa escolher de novo
    const itens = await ps.pendentesDoCliente("e1", "cA", DIA(20));
    expect(itens.filter((i) => i.emConferencia).map((i) => [i.id, i.emConferencia!.numero])).toEqual([["orcA", "4500123"], ["oA1", "4500123"]]);
    expect((await chamar("portal/pedidos-compra", "POST", {}, { numero: "X", anexo: ANEXO, osIds: ["oA1"] })).json.erro).toBe(ps.MSG_ITEM_INVALIDO);
  });

  it("escritório: a etiqueta 'conferir', o GET (o que ele cobre, quem enviou), a permissão; outra empresa não vê", async () => {
    expect((await srv.pedidoDasOs("e1", ["oA1", "oA2"])).get("oA1")).toMatchObject({ aguardando: true, conferir: { id: pedido1, numero: "4500123" } });
    expect((await srv.pedidoDasOs("e1", ["oA2"])).get("oA2")?.conferir).toBeNull();
    expect((await srv.pedidoDosOrcamentos("e1", ["orcA"])).get("orcA")?.conferir).toEqual({ id: pedido1, numero: "4500123" });
    comoAdmin();
    const g = await chamar("pedidos-cliente/[id]", "GET", { id: pedido1 });
    expect([g.json.situacao, g.json.origem, g.json.ordens, g.json.orcamentos, g.json.total, g.json.alerta, g.json.temAnexo]).toEqual([
      "CONFERIR", "PORTAL", [{ id: "oA1", numero: "OS-oA1" }], [{ id: "orcA", codigo: "ORC-A" }], 3800, null, true]);
    comoAdmin("e2");
    expect((await chamar("pedidos-cliente/[id]", "GET", { id: pedido1 })).status).toBe(404);
    expect((await chamar("pedidos-cliente/[id]/conferir", "POST", { id: pedido1 }, { acao: "confirmar" })).status).toBe(404);
    comoOperadorSemOs();
    expect((await chamar("pedidos-cliente/[id]/conferir", "POST", { id: pedido1 }, { acao: "confirmar" })).status).toBe(403);
  });

  it("RECUSAR: exige o motivo; o cliente vê o motivo; o item volta a aguardar e pode ser enviado de novo", async () => {
    comoAdmin();
    expect(await chamar("pedidos-cliente/[id]/conferir", "POST", { id: pedido1 }, { acao: "recusar", motivo: "não" })).toEqual({ status: 400, json: { erro: MSG_MOTIVO_RECUSA } });
    expect((await chamar("pedidos-cliente/[id]/conferir", "POST", { id: pedido1 }, { acao: "aprovar" })).status).toBe(400);
    const r = await chamar("pedidos-cliente/[id]/conferir", "POST", { id: pedido1 }, { acao: "recusar", motivo: "O valor do pedido não confere com a OS-oA1." });
    expect(r.status).toBe(200);
    expect((await chamar("pedidos-cliente/[id]/conferir", "POST", { id: pedido1 }, { acao: "confirmar" })).status).toBe(409);
    const [env] = await ps.pedidosEnviadosPeloPortal("e1", "cA");
    expect([env.situacao, env.motivoRecusa, env.itens]).toEqual(["RECUSADO", "O valor do pedido não confere com a OS-oA1.", ["OS-oA1", "Orçamento ORC-A"]]);
    expect((await prisma.ordemServico.findUnique({ where: { id: "oA1" } })).pedidoClienteId).toBeNull();
    expect((await hist("oA1")).at(-1)).toBe("Pedido de compra do portal recusado | nº 4500123 · O valor do pedido não confere com a OS-oA1.");
    expect((await ps.pendentesDoCliente("e1", "cA", DIA(20))).every((i) => !i.emConferencia)).toBe(true);
    expect((await ps.contarPedidosConferir("e1")).pedidosConferir).toBe(0);
    // a outra empresa não enxerga o pedido recusado
    expect(await ps.pedidosEnviadosPeloPortal("e2", "cA")).toEqual([]);
  });

  it("CONFIRMAR: liga as OS e o orçamento, libera o faturamento, a fatura 'Aguardando PC' segue com o nº; o que ganhou outro pedido no meio fica; duas confirmações não ligam duas vezes", async () => {
    comoContato("ctA", "compras@a.test");
    const r = await chamar("portal/pedidos-compra", "POST", {}, { numero: "4500124", data: "2026-11-21", valor: "1000", anexo: ANEXO, osIds: ["oA1", "oA2"], orcamentoIds: ["orcA"] });
    expect(r.status).toBe(201);
    // no meio da conferência, a equipe informou outro pedido para oA2
    comoAdmin();
    expect((await chamar("pedidos-cliente", "POST", {}, { numero: "OUTRO-1", osIds: ["oA2"] })).status).toBeLessThan(300);
    const [c1, c2] = await Promise.all([
      chamar("pedidos-cliente/[id]/conferir", "POST", { id: r.json.pedidoId }, { acao: "confirmar" }),
      chamar("pedidos-cliente/[id]/conferir", "POST", { id: r.json.pedidoId }, { acao: "confirmar" }),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([200, 409]);
    const ok = c1.status === 200 ? c1 : c2;
    expect(ok.json).toMatchObject({ ok: true, ligadas: { os: 1, orcamentos: 1 } });
    expect(ok.json.alerta).toMatch(/menor que o total/); // R$ 1.000 < 1.800 + 2.000
    const p = await prisma.pedidoCliente.findUnique({ where: { id: r.json.pedidoId } });
    expect([p.situacao, p.conferidoPorId, !!p.conferidoEm]).toEqual(["CONFIRMADO", "uA", true]);
    expect((await prisma.ordemServico.findUnique({ where: { id: "oA1" } })).pedidoClienteId).toBe(p.id);
    expect((await prisma.ordemServico.findUnique({ where: { id: "oA2" } })).pedidoClienteId).not.toBe(p.id);
    expect((await prisma.orcamento.findUnique({ where: { id: "orcA" } })).pedidoClienteId).toBe(p.id);
    expect(await srv.travaFaturarOs("e1", "oA1")).toBeNull();
    expect(await prisma.medicao.findUnique({ where: { id: "mA" }, select: { status: true, pcNumero: true } })).toEqual({ status: "PC_RECEBIDO", pcNumero: "4500124" });
    expect((await hist("oA1")).filter((h: string) => h.startsWith("Pedido do cliente confirmado"))).toEqual(["Pedido do cliente confirmado (enviado pelo portal) | nº 4500124 · R$ 1.000,00"]);
    expect((await ps.pedidosEnviadosPeloPortal("e1", "cA"))[0].situacao).toBe("CONFIRMADO");
    expect(await ps.pendentesDoCliente("e1", "cA", DIA(20))).toEqual([]);
  });

  /* ───────── LEMBRETES ───────── */

  it("a rota do cron: sem o CRON_SECRET certo, 401", async () => {
    vi.stubEnv("CRON_SECRET", "segredo-teste");
    expect((await chamar("cron/lembretes-pedido", "GET")).status).toBe(401);
    expect((await chamar("cron/lembretes-pedido", "GET", {}, undefined, { authorization: "Bearer errado" })).status).toBe(401);
    // sem segredo configurado, a rotina fica desligada (nem "Bearer undefined" passa)
    vi.stubEnv("CRON_SECRET", undefined as unknown as string);
    expect((await chamar("cron/lembretes-pedido", "GET", {}, undefined, { authorization: "Bearer undefined" })).status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("1ª rodada (dia 13): um e-mail por cliente com TUDO o que está pendente; sem e-mail, desligado ou que não exige, nada; cada empresa no seu", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.exemplo.test");
    fila.emails = [];
    const r = await lem.processarLembretesPedido(DIA(13, 16));
    expect(fila.emails.map((e) => [e.empresaId, e.para, e.tipo]).sort()).toEqual([
      ["e1", "compras@b.test", TIPO_EMAIL_LEMBRETE], ["e1", "compras@l.test", TIPO_EMAIL_LEMBRETE], ["e2", "compras@e2.test", TIPO_EMAIL_LEMBRETE],
    ]);
    // os clientes da rotina: só quem exige, tem e-mail de compras e lembretes ligados (cA, cB, cL e o da outra empresa)
    expect(r).toMatchObject({ clientes: 4, enviados: 3, erros: 0 });
    const [l] = emailsPara("compras@l.test");
    expect(l.variaveis).toMatchObject({ contato_nome: "Lia", cliente_nome: "Logística L (fictícia)", quantidade_pendente: "3", total_pendente: "R$ 3.500,00", link_portal: "https://app.exemplo.test/portal/login?destino=%2Fportal%2Fpedidos-compra" });
    // oL1: 3 dias (etapa 3); oL2: 1 dia (vai na lista, antes da 1ª etapa); orcL: 8 dias (etapa 7); oL3 ainda em execução: fora
    expect(l.variaveis.lista_pendencias).toMatch(/^<ul><li>Orçamento ORC-L · aprovado em 05\/11\/2026 · R\$ 2\.000,00 · há 8 dias<\/li><li>OS-oL1 · concluída em 10\/11\/2026 · R\$ 1\.000,00 · há 3 dias<\/li><li>OS-oL2 · concluída em 12\/11\/2026 · R\$ 500,00 · há 1 dia<\/li><\/ul>$/);
    const linhas = await prisma.pedidoClienteLembrete.findMany({ where: { clienteId: "cL" }, orderBy: { chave: "asc" } });
    expect(linhas.map((x: any) => [x.chave.replace(/@.*/, "@envio"), x.etapa, x.para])).toEqual([
      ["orcamento:orcL:7", 7, "compras@l.test"], ["os:oL1:3", 3, "compras@l.test"], ["os:oL2:0@envio", 0, "compras@l.test"],
    ]);
    expect(new Set(linhas.map((x: any) => x.envio)).size).toBe(1); // um e-mail
    expect(await hist("oL1")).toEqual(["Lembrete do pedido do cliente | Enviado a compras@l.test (lembrete de 3 dias)"]);
    expect(await hist("oL2")).toEqual(["Lembrete do pedido do cliente | Enviado a compras@l.test (na lista do lembrete)"]);
    expect(await hist("oL3")).toEqual([]);
    // o escritório: "Último lembrete em …"
    expect((await srv.pedidoDasOs("e1", ["oL1"])).get("oL1")?.ultimoLembrete).toBe(DIA(13, 16).toISOString());
    // o cliente A já resolveu tudo: nada; e a outra empresa só recebeu o dela
    expect(emailsPara("compras@a.test")).toEqual([]);
    expect(emailsPara("compras@e2.test")[0].variaveis.lista_pendencias).not.toMatch(/oL|oA|oB/);
    vi.unstubAllEnvs();
  });

  it("rodar de novo no mesmo dia (e duas rodadas ao mesmo tempo): nenhum e-mail a mais, nenhuma linha a mais", async () => {
    fila.emails = [];
    const antes = await prisma.pedidoClienteLembrete.count();
    await lem.processarLembretesPedido(DIA(13, 18));
    await Promise.all([lem.processarLembretesPedido(DIA(13, 19)), lem.processarLembretesPedido(DIA(13, 19))]);
    expect(fila.emails).toEqual([]);
    expect(await prisma.pedidoClienteLembrete.count()).toBe(antes);
  });

  it("dia 15: oL2 chega aos 3 dias e o e-mail sai; oL1 e orcL (etapas já enviadas) vão junto 'na lista' e o último lembrete deles passa a ser este", async () => {
    fila.emails = [];
    await lem.processarLembretesPedido(DIA(15, 16));
    const ls = emailsPara("compras@l.test");
    expect(ls.map((e) => e.variaveis.quantidade_pendente)).toEqual(["3"]);
    expect((await hist("oL2")).at(-1)).toBe("Lembrete do pedido do cliente | Enviado a compras@l.test (lembrete de 3 dias)");
    expect((await hist("oL1")).at(-1)).toBe("Lembrete do pedido do cliente | Enviado a compras@l.test (na lista do lembrete)");
    expect((await srv.pedidoDasOs("e1", ["oL1"])).get("oL1")?.ultimoLembrete).toBe(DIA(15, 16).toISOString());
    expect((await srv.pedidoDosOrcamentos("e1", ["orcL"])).get("orcL")?.ultimoLembrete).toBe(DIA(15, 16).toISOString());
    // a etapa 3 de oL1 continua uma só (a linha "na lista" tem a chave do envio)
    expect(await prisma.pedidoClienteLembrete.count({ where: { chave: "os:oL1:3" } })).toBe(1);
  });

  it("a etapa seguinte (dia 17) sai uma vez só, mesmo com duas rodadas ao mesmo tempo; o que já tem pedido sai da lista", async () => {
    comoAdmin();
    expect((await chamar("pedidos-cliente", "POST", {}, { numero: "L-1", orcamentoIds: ["orcL"] })).status).toBeLessThan(300); // orcL resolvido
    fila.emails = [];
    await Promise.all([lem.processarLembretesPedido(DIA(17, 16)), lem.processarLembretesPedido(DIA(17, 16))]);
    const ls = emailsPara("compras@l.test");
    expect(ls).toHaveLength(1);
    expect(ls[0].variaveis.lista_pendencias).not.toContain("ORC-L");
    expect(ls[0].variaveis.quantidade_pendente).toBe("2"); // oL1 (7 dias: etapa 7) e oL2 (5 dias: na lista)
    expect(await prisma.pedidoClienteLembrete.count({ where: { chave: { in: ["os:oL1:7", "os:oL2:3"] } } })).toBe(2);
  });

  it("o que está em conferência não entra; cada etapa uma vez e, pulando etapas, só a maior; o envio que falha volta para a próxima rodada", async () => {
    comoContato("ctL", "compras@l.test", "cL");
    portal.atual.user.clienteNome = "Logística L";
    expect((await chamar("portal/pedidos-compra", "POST", {}, { numero: "L-2", anexo: ANEXO, osIds: ["oL2"] })).status).toBe(201);
    fila.emails = [];
    fila.falharPara.add("compras@l.test");
    await lem.processarLembretesPedido(DIA(26, 16)); // oL1: 16 dias (etapa 15); oL2 em conferência
    expect(emailsPara("compras@l.test")).toEqual([]);
    expect(await prisma.pedidoClienteLembrete.count({ where: { chave: "os:oL1:15" } })).toBe(0); // devolvida
    fila.falharPara.clear();
    await lem.processarLembretesPedido(DIA(26, 17));
    const [l] = emailsPara("compras@l.test");
    expect(l.variaveis.quantidade_pendente).toBe("1");
    expect(l.variaveis.lista_pendencias).toContain("OS-oL1");
    expect(l.variaveis.lista_pendencias).not.toContain("OS-oL2");
    expect(await prisma.pedidoClienteLembrete.count({ where: { chave: { startsWith: "os:oL2:" }, etapa: 15 } })).toBe(0);
    // cada etapa uma vez (o cliente B: 3, 7 e 15); quem pulou etapas (a OS da outra empresa já tinha 12 dias na 1ª
    // rodada) recebeu só a maior, nunca as que ficaram para trás
    expect((await prisma.pedidoClienteLembrete.findMany({ where: { clienteId: "cB" }, orderBy: { enviadoEm: "asc" } })).map((x: any) => x.chave)).toEqual(["os:oB1:3", "os:oB1:7", "os:oB1:15"]);
    expect((await prisma.pedidoClienteLembrete.findMany({ where: { clienteId: "cE2" }, orderBy: { enviadoEm: "asc" } })).map((x: any) => x.chave)).toEqual(["os:oE2:7", "os:oE2:15"]);
  });

  it("a rota do cron com o CRON_SECRET certo roda a rotina e devolve o resumo", async () => {
    vi.stubEnv("CRON_SECRET", "segredo-teste");
    const r = await chamar("cron/lembretes-pedido", "GET", {}, undefined, { authorization: "Bearer segredo-teste" });
    vi.unstubAllEnvs();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, erros: 0 });
    expect(typeof r.json.clientes).toBe("number");
  });

  it("desligado na empresa ou no cliente, ou cliente sem e-mail de compras: nada sai; a régua da empresa vale", async () => {
    await prisma.configuracao.update({ where: { empresaId: "e2" }, data: { pedidoLembretesAtivo: false } });
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { pedidoLembretesDias: [40] } });
    fila.emails = [];
    await lem.processarLembretesPedido(DIA(30, 16));
    expect(fila.emails).toEqual([]); // e2 desligada; e1: ninguém chegou a 40 dias; cSem e cDesl nunca
    await lem.processarLembretesPedido(new Date(Date.UTC(2026, 11, 21, 16))); // 41 dias
    expect(fila.emails.map((e) => e.para).sort()).toEqual(["compras@b.test", "compras@l.test"]);
    expect(await prisma.pedidoClienteLembrete.count({ where: { clienteId: { in: ["cSem", "cDesl", "cNao"] } } })).toBe(0);
  });
});
