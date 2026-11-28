/**
 * Leva I.2 — grupo C: rotas reais, Prisma real, PostgreSQL real (dados fictícios).
 *  (7) material de campo no "Cobrado à parte": a fila do app (sem mudar nada no app) cria o item cobrado a conferir,
 *      com o preço de venda da tabela do cliente (fora do catálogo: 0); reenviar não duplica; corrigir/remover no
 *      campo (e no escritório) acompanha enquanto não conferido; INCLUSO não cria nada; faturar bloqueia; Confirmar
 *      (com ajuste) e Excluir da cobrança; a permissão; conferido, o campo não mexe mais;
 *  (8) o pedido do portal que nada mais espera encerra como RESOLVIDO na leitura (uma vez só, com a trilha);
 *  (9) o lembrete do cliente SEM portal: outro template, a lista com o link do relatório, sem link do portal;
 *  (10) a recusa vai por e-mail ao contato e ao e-mail de compras; sem e-mail configurado, a recusa vale e a falha
 *       fica na trilha.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva-i2c-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { inicioHojeBR } from "@/lib/fuso";
import { MSG_PRECO_CAMPO, MSG_TRAVA_FATURAR_CAMPO, MSG_USE_CONFERENCIA } from "@/lib/os/material-campo-cobranca";
import { MSG_PEDIDO_RESOLVIDO, TIPO_EMAIL_LEMBRETE, TIPO_EMAIL_LEMBRETE_SEM_PORTAL, TIPO_EMAIL_RECUSADO } from "@/lib/pedido-cliente/lembretes";
import { PDF, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva_i2c_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
const portal = vi.hoisted(() => ({ atual: null as any }));
const fila = vi.hoisted(() => ({ emails: [] as any[], falhar: false }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => portal.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/push/servidor", async (orig) => ({ ...(await orig<typeof import("@/lib/push/servidor")>()), usuariosComAparelho: vi.fn(async () => []), enviarPush: vi.fn(async () => ({ enviados: 0 })) }));
vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async (empresaId: string, p: any) => {
    if (fila.falhar) return { ok: false, erro: "E-mail não configurado ou inativo." };
    fila.emails.push({ empresaId, ...p });
    return { ok: true };
  }),
}));

const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "joao@clima.test", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };
const comoEscritorio = (permissoes = permissoesTotais(), role = "ADMIN") => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@clima.test", empresaId: "e1", role, permissoes, tecnicoId: null } }; };
const comoContato = (id: string, email: string, clienteId: string, permissoes: Record<string, boolean> = {}) => { portal.atual = { user: { id, name: "Bruno Compras", email, clienteId, clienteNome: "Indústria", empresaId: "e1", permissoes } }; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });
const H = 3_600_000;
const DIA = (d: number, h = 15) => new Date(Date.UTC(2026, 10, d, h));
const ANEXO = { conteudo: dataUrl("application/pdf", PDF), nome: "pedido.pdf" };

describe.skipIf(!URL_PG)("Leva I.2 — grupo C (PostgreSQL real)", () => {
  let prisma: any;
  let faturarOs: typeof import("@/lib/faturamento/faturar-server").faturarOs;
  let ps: typeof import("@/lib/pedido-cliente/portal-server");
  let srv: typeof import("@/lib/pedido-cliente/server");
  let lem: typeof import("@/lib/pedido-cliente/lembretes-server");
  const hoje = inicioHojeBR();
  const sync = async (operacoes: unknown[]) => { comoTecnico(); return (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[]; };
  const material = (dados: Record<string, unknown>, atividadeId = "aA") => op("material", atividadeId, { dados });
  const itensCampo = (osId: string) => prisma.osItemOrcamento.findMany({ where: { ordemServicoId: osId, materialCampoId: { not: null } }, orderBy: { ordem: "asc" } });
  const linha = (clientId: string) => prisma.atividadeMaterial.findFirst({ where: { clientId } });
  const hist = async (osId: string) => (await prisma.osHistorico.findMany({ where: { ordemServicoId: osId }, orderBy: { criadoEm: "asc" } })).map((h: any) => `${h.acao} | ${h.detalhes}`);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ faturarOs } = await import("@/lib/faturamento/faturar-server"));
    ps = await import("@/lib/pedido-cliente/portal-server");
    srv = await import("@/lib/pedido-cliente/server");
    lem = await import("@/lib/pedido-cliente/lembretes-server");
    await Promise.all(["tecnico/sync", "ordens/[id]/orcamento/[itemId]", "ordens/[id]/orcamento/[itemId]/conferir-campo", "ordens/[id]/materiais-campo/[linhaId]",
      "portal/pedidos-compra", "pedidos-cliente/[id]/conferir"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total (fictícia)", cnpj: "12.345.678/0001-90", email: "contato@clima.test" } });
    // a empresa cobra materiais à parte; a OS osI fixou "Incluso" antes
    await prisma.configuracao.create({ data: { empresaId: "e1", orcamentoCobrancaMateriais: "A_PARTE" } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "ana@clima.test", senha: "x", role: "ADMIN", criadoEm: DIA(1, 8) },
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@clima.test", senha: "x", role: "TECNICO", criadoEm: DIA(1, 9) },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.test" } });
    await prisma.produto.createMany({ data: [
      { id: "pCap", empresaId: "e1", codigo: 104, nome: "Capacitor 35 µF", unidade: "un", valorPadrao: 45, saldo: 10, controlaEstoque: true },
      { id: "pFita", empresaId: "e1", codigo: 120, nome: "Fita PVC", unidade: "rl", valorPadrao: 12, saldo: 0, controlaEstoque: false },
    ] });
    await prisma.tabelaPreco.create({ data: { id: "tab1", empresaId: "e1", nome: "Contrato Hospital (fictício)" } });
    await prisma.tabelaPrecoItem.create({ data: { tabelaId: "tab1", produtoId: "pCap", valorFinal: 60 } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital (fictício)", cpfCnpj: "1", tabelaPrecoId: "tab1" },
      // pedido do cliente (itens 8–10)
      { id: "cP", empresaId: "e1", nome: "Indústria P (fictícia)", cpfCnpj: "2", exigePcAntesNf: true, comprasNome: "Paula", comprasEmail: "compras@p.test", portalAtivo: true },
      { id: "cS", empresaId: "e1", nome: "Loja S (fictícia)", cpfCnpj: "3", exigePcAntesNf: true, comprasNome: "Sérgio", comprasEmail: "compras@s.test", portalAtivo: true },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    // cP: o e-mail de compras é o login do portal (contato com senha); cS: o contato com o mesmo e-mail NÃO tem senha
    await prisma.contatoCliente.createMany({ data: [
      { id: "ctP", empresaId: "e1", clienteId: "cP", nome: "Paula Compras", email: "compras@p.test", senha: "hash" },
      { id: "ctP2", empresaId: "e1", clienteId: "cP", nome: "Pedro Engenharia", email: "pedro@p.test", senha: "hash", permissoes: { enviarPedidoCompra: true } },
      { id: "ctS", empresaId: "e1", clienteId: "cS", nome: "Sérgio", email: "compras@s.test" },
    ] });
    const os = (id: string, numero: string, clienteId: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", numero, clienteId, criadoPorId: "uA", descricao: "Manutenção corretiva", ...extra });
    await prisma.ordemServico.createMany({ data: [
      os("osA", "OS-0101", "c1", { unidadeId: "un1" }), os("osI", "OS-0102", "c1", { unidadeId: "un1", cobrancaMateriais: "INCLUSO" }),
      os("oP1", "OS-0201", "cP", { status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(5) }), os("oP2", "OS-0202", "cP", { status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(5) }),
      os("oS1", "OS-0301", "cS", { status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(5) }),
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aA", empresaId: "e1", ordemServicoId: "osA", titulo: "Corretiva", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 14 * H), status: "EM_ANDAMENTO" },
      { id: "aI", empresaId: "e1", ordemServicoId: "osI", titulo: "Corretiva", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 15 * H), status: "EM_ANDAMENTO" },
    ] });
    await prisma.osItemOrcamento.createMany({ data: [
      { id: "iSrv", ordemServicoId: "osA", descricao: "Troca de capacitor", quantidade: 1, valorUnitario: 200, valorTotal: 200, executado: true, ordem: 0 },
      { id: "iP1", ordemServicoId: "oP1", descricao: "Serviço", quantidade: 1, valorUnitario: 900, valorTotal: 900, executado: true },
      { id: "iP2", ordemServicoId: "oP2", descricao: "Serviço", quantidade: 1, valorUnitario: 500, valorTotal: 500, executado: true },
      { id: "iS1", ordemServicoId: "oS1", descricao: "Serviço", quantidade: 1, valorUnitario: 700, valorTotal: 700, executado: true },
    ] });
    await prisma.relatorioOs.create({ data: { id: "rS1", empresaId: "e1", ordemServicoId: "oS1", numero: "REL-31", escopo: "GERAL", mesReferencia: 11, anoReferencia: 2026, tokenPublico: "tk-rel-s1" } });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ═════════════ (7) material de campo no "Cobrado à parte" ═════════════ */

  it("(7) o uso em campo vira item PRODUTO a conferir, com o preço da tabela do cliente; reenviar não duplica; a regra fica gravada na OS", async () => {
    const o = material({ clientId: "cap1", produtoId: "pCap", quantidade: 2 });
    expect((await sync([o]))[0]).toMatchObject({ ok: true });
    expect((await sync([o]))[0]).toMatchObject({ ok: true });
    await sync([material({ clientId: "cap1", produtoId: "pCap", quantidade: 2 })]); // mesma linha por outra operação
    const [it1] = await itensCampo("osA");
    const uso = await linha("cap1");
    expect([await prisma.osItemOrcamento.count({ where: { materialCampoId: uso.id } }), it1.tipo, it1.produtoId, it1.descricao, Number(it1.quantidade), Number(it1.valorUnitario), Number(it1.valorTotal), it1.conferirCampo, it1.executado, it1.ordem])
      .toEqual([1, "PRODUTO", "pCap", "Capacitor 35 µF", 2, 60, 120, true, true, 1]);
    expect((await prisma.ordemServico.findUnique({ where: { id: "osA" } })).cobrancaMateriais).toBe("A_PARTE");
    // fora do catálogo: entra com 0 (pede o preço na conferência)
    await sync([material({ clientId: "fita1", descricao: "Abraçadeira", unidade: "un", quantidade: 4 })]);
    const fora = (await itensCampo("osA")).find((i: any) => i.descricao === "Abraçadeira");
    expect([fora.produtoId, Number(fora.quantidade), Number(fora.valorUnitario), fora.conferirCampo]).toEqual([null, 4, 0, true]);
  });

  it("(7) modo INCLUSO: nada muda (só o registro do uso)", async () => {
    expect((await sync([material({ clientId: "capI", produtoId: "pCap", quantidade: 1 }, "aI")]))[0]).toMatchObject({ ok: true });
    expect(await linha("capI")).toBeTruthy();
    expect(await prisma.osItemOrcamento.count({ where: { ordemServicoId: "osI" } })).toBe(0);
  });

  it("(7) corrigir no campo atualiza a quantidade; o escritório corrigindo também; remover tira o item (enquanto não conferido)", async () => {
    await sync([material({ clientId: "cap1", quantidade: 3 })]);
    let it1 = (await itensCampo("osA")).find((i: any) => i.produtoId === "pCap");
    expect([Number(it1.quantidade), Number(it1.valorTotal)]).toEqual([3, 180]);
    comoEscritorio();
    const uso = await linha("cap1");
    expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osA", linhaId: uso.id }, { quantidade: 1 })).status).toBe(200);
    it1 = (await itensCampo("osA")).find((i: any) => i.produtoId === "pCap");
    expect([Number(it1.quantidade), Number(it1.valorTotal)]).toEqual([1, 60]);
    await sync([material({ clientId: "tmp1", produtoId: "pFita", quantidade: 1 })]);
    expect((await itensCampo("osA")).some((i: any) => i.produtoId === "pFita")).toBe(true);
    await sync([op("materialRemover", "aA", { dados: { clientId: "tmp1" } })]);
    expect((await itensCampo("osA")).some((i: any) => i.produtoId === "pFita")).toBe(false);
  });

  it("(7) faturar a OS com item a conferir é bloqueado; o item a conferir não sai pelas rotas comuns", async () => {
    await prisma.ordemServico.update({ where: { id: "osA" }, data: { status: "CONCLUIDA" } });
    expect(await faturarOs({ empresaId: "e1", usuarioId: "uA", osId: "osA" })).toEqual({ tipo: "bloqueado", erro: MSG_TRAVA_FATURAR_CAMPO });
    comoEscritorio();
    const [it1] = await itensCampo("osA");
    expect(await chamar("ordens/[id]/orcamento/[itemId]", "DELETE", { id: "osA", itemId: it1.id })).toEqual({ status: 400, json: { erro: MSG_USE_CONFERENCIA } });
    expect((await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { id: "osA", itemId: it1.id }, { executado: false })).status).toBe(400);
  });

  it("(7) conferir: sem permissão de editar a OS, 403; preço 0 não confirma; Confirmar ajusta e libera; Excluir da cobrança tira; o campo não mexe mais no conferido", async () => {
    const itens = await itensCampo("osA");
    const cap = itens.find((i: any) => i.produtoId === "pCap");
    const fora = itens.find((i: any) => i.descricao === "Abraçadeira");
    comoEscritorio(montarPermissoes({ ordens: ["visualizar"] }), "OPERADOR");
    expect((await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "osA", itemId: cap.id }, { acao: "confirmar" })).status).toBe(403);
    comoEscritorio();
    expect(await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "osA", itemId: fora.id }, { acao: "confirmar" })).toEqual({ status: 400, json: { erro: MSG_PRECO_CAMPO } });
    expect((await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "osA", itemId: "iSrv" }, { acao: "confirmar" })).status).toBe(404);
    const r = await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "osA", itemId: cap.id }, { acao: "confirmar", quantidade: 2, valorUnitario: 55 });
    expect(r.status).toBe(200);
    const c = await prisma.osItemOrcamento.findUnique({ where: { id: cap.id } });
    expect([Number(c.quantidade), Number(c.valorUnitario), Number(c.valorTotal), c.conferirCampo, c.conferidoCampoPorId, !!c.conferidoCampoEm]).toEqual([2, 55, 110, false, "uA", true]);
    expect((await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "osA", itemId: cap.id }, { acao: "remover" })).status).toBe(409);
    // ainda há a abraçadeira a conferir: continua bloqueado
    expect((await faturarOs({ empresaId: "e1", usuarioId: "uA", osId: "osA" })).tipo).toBe("bloqueado");
    expect((await chamar("ordens/[id]/orcamento/[itemId]/conferir-campo", "POST", { id: "osA", itemId: fora.id }, { acao: "remover" })).status).toBe(200);
    expect(await prisma.osItemOrcamento.findUnique({ where: { id: fora.id } })).toBeNull();
    expect(await linha("fita1")).toMatchObject({ removidoEm: null }); // o uso em campo fica como está
    // conferido: o técnico corrigindo o uso não mexe mais na cobrança; o removido não volta
    await sync([material({ clientId: "cap1", quantidade: 5 }), material({ clientId: "fita1", quantidade: 6 })]);
    expect(Number((await prisma.osItemOrcamento.findUnique({ where: { id: cap.id } })).quantidade)).toBe(2);
    expect((await itensCampo("osA")).map((i: any) => i.id)).toEqual([cap.id]);
    expect((await hist("osA")).filter((h: string) => h.startsWith("Material de campo"))).toEqual([
      "Material de campo conferido | Capacitor 35 µF: 2 × R$ 55,00 = R$ 110,00", "Material de campo removido da cobrança | Abraçadeira: 4",
    ]);
    // nada a conferir: fatura (serviço 200 + capacitor 110)
    const f = await faturarOs({ empresaId: "e1", usuarioId: "uA", osId: "osA" });
    expect(f.tipo).toBe("criada");
    expect(Number((await prisma.medicao.findFirst({ where: { itens: { some: { ordemServicoId: "osA" } } } })).valorTotal)).toBe(310);
  });

  /* ═════════════ (8) pedido do portal resolvido por outro caminho ═════════════ */

  let pedidoP = "";
  it("(8) o pedido em conferência cujos serviços se resolveram por outro caminho encerra como RESOLVIDO (uma vez, com a trilha); o portal mostra", async () => {
    comoContato("ctP", "compras@p.test", "cP");
    const r = await chamar("portal/pedidos-compra", "POST", {}, { numero: "PC-77", data: "2026-11-20", anexo: ANEXO, osIds: ["oP1", "oP2"] });
    expect(r.status).toBe(201);
    pedidoP = r.json.pedidoId;
    comoEscritorio();
    // um item resolvido: o pedido continua em conferência (ainda há o que conferir)
    await srv.liberarSemPedido({ empresaId: "e1", usuarioId: "uA" }, { osIds: ["oP1"] }, "Cliente autorizou por telefone");
    expect((await ps.contarPedidosConferir("e1")).pedidosConferir).toBe(1);
    expect((await prisma.pedidoCliente.findUnique({ where: { id: pedidoP } })).situacao).toBe("CONFERIR");
    // o outro ganhou pedido informado pela equipe: nada mais espera → encerra na próxima leitura (duas ao mesmo tempo = uma vez)
    await srv.registrarPedido({ empresaId: "e1", usuarioId: "uA" }, { numero: "PC-78" }, { osIds: ["oP2"] });
    const [a, b] = await Promise.all([ps.contarPedidosConferir("e1"), ps.pedidosEnviadosPeloPortal("e1", "cP")]);
    expect(a.pedidosConferir).toBe(0);
    const p = await prisma.pedidoCliente.findUnique({ where: { id: pedidoP } });
    expect([p.situacao, !!p.conferidoEm, p.conferidoPorId]).toEqual(["RESOLVIDO", true, null]);
    expect(b.find((x) => x.id === pedidoP)?.situacao).toBe("RESOLVIDO");
    await ps.contarPedidosConferir("e1");
    expect((await hist("oP1")).filter((h: string) => h.includes("resolvido por outro meio"))).toEqual(["Pedido de compra do portal encerrado (resolvido por outro meio) | nº PC-77"]);
    expect((await hist("oP2")).filter((h: string) => h.includes("resolvido por outro meio"))).toHaveLength(1);
    // o escritório não confirma nem recusa o encerrado
    expect(await chamar("pedidos-cliente/[id]/conferir", "POST", { id: pedidoP }, { acao: "confirmar" })).toEqual({ status: 409, json: { erro: MSG_PEDIDO_RESOLVIDO } });
  });

  /* ═════════════ (10) recusa por e-mail ═════════════ */

  it("(10) recusar manda o e-mail com o motivo ao contato que enviou e ao e-mail de compras; sem e-mail configurado, a recusa vale e a falha fica na trilha", async () => {
    await prisma.ordemServico.createMany({ data: [
      { id: "oP3", empresaId: "e1", numero: "OS-0203", clienteId: "cP", criadoPorId: "uA", descricao: "x", status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(6) },
      { id: "oP4", empresaId: "e1", numero: "OS-0204", clienteId: "cP", criadoPorId: "uA", descricao: "x", status: "CONCLUIDA", criadoEm: DIA(1), dataConclusao: DIA(6) },
    ] });
    comoContato("ctP2", "pedro@p.test", "cP", { enviarPedidoCompra: true });
    const p1 = (await chamar("portal/pedidos-compra", "POST", {}, { numero: "PC-90", anexo: ANEXO, osIds: ["oP3"] })).json.pedidoId;
    const p2 = (await chamar("portal/pedidos-compra", "POST", {}, { numero: "PC-91", anexo: ANEXO, osIds: ["oP4"] })).json.pedidoId;
    expect([typeof p1, typeof p2]).toEqual(["string", "string"]);
    comoEscritorio();
    fila.emails = [];
    const r = await chamar("pedidos-cliente/[id]/conferir", "POST", { id: p1 }, { acao: "recusar", motivo: "Valor <diferente> da OS-0203" });
    expect(r.json).toMatchObject({ ok: true, email: { ok: true, para: ["pedro@p.test", "compras@p.test"] } });
    const [e] = fila.emails;
    expect([e.tipo, e.para, e.variaveis.numero_pedido, e.variaveis.motivo_recusa, e.variaveis.lista_pendencias, e.variaveis.contato_nome]).toEqual([
      TIPO_EMAIL_RECUSADO, ["pedro@p.test", "compras@p.test"], "PC-90", "Valor &lt;diferente&gt; da OS-0203", "<ul><li>OS-0203</li></ul>", "Pedro Engenharia"]);
    expect(e.variaveis.link_portal).toContain("/portal/login?destino=%2Fportal%2Fpedidos-compra");
    expect((await hist("oP3")).at(-1)).toBe("Recusa do pedido de compra enviada ao cliente | Enviado a pedro@p.test, compras@p.test");
    // sem e-mail configurado: a recusa vale, a falha fica na trilha
    fila.falhar = true;
    const r2 = await chamar("pedidos-cliente/[id]/conferir", "POST", { id: p2 }, { acao: "recusar", motivo: "Pedido sem assinatura" });
    fila.falhar = false;
    expect([r2.status, r2.json.email.ok]).toEqual([200, false]);
    expect((await prisma.pedidoCliente.findUnique({ where: { id: p2 } })).situacao).toBe("RECUSADO");
    expect((await hist("oP4")).at(-1)).toBe("Recusa do pedido de compra não enviada por e-mail | nº PC-91 · E-mail não configurado ou inativo.");
  });

  /* ═════════════ (9) lembrete do cliente sem portal ═════════════ */

  it("(9) cliente sem acesso ao portal: o outro e-mail (lista com o link do relatório, responder com o pedido, sem portal); com portal, o de sempre", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.exemplo.test");
    fila.emails = [];
    await lem.processarLembretesPedido(DIA(13, 16));
    vi.unstubAllEnvs();
    const s = fila.emails.find((x) => x.para === "compras@s.test");
    expect(s.tipo).toBe(TIPO_EMAIL_LEMBRETE_SEM_PORTAL);
    expect(s.variaveis.link_portal).toBeUndefined();
    expect(s.variaveis.lista_pendencias).toBe('<ul><li>OS-0301 · concluída em 05/11/2026 · R$ 700,00 · há 8 dias — <a href="https://app.exemplo.test/relatorio/os/tk-rel-s1">Relatório da OS</a></li></ul>');
    expect(s.responderPara).toBe("contato@clima.test");
    expect((await hist("oS1")).at(-1)).toBe("Lembrete do pedido do cliente | Enviado a compras@s.test (lembrete de 7 dias)");
    const p = fila.emails.find((x) => x.para === "compras@p.test");
    expect([p.tipo, p.variaveis.link_portal]).toEqual([TIPO_EMAIL_LEMBRETE, "https://app.exemplo.test/portal/login?destino=%2Fportal%2Fpedidos-compra"]);
    // o contato de S ganha a senha do portal: o próximo lembrete já é o do portal
    await prisma.contatoCliente.update({ where: { id: "ctS" }, data: { senha: "hash" } });
    fila.emails = [];
    await lem.processarLembretesPedido(DIA(21, 16));
    expect(fila.emails.find((x) => x.para === "compras@s.test")?.tipo).toBe(TIPO_EMAIL_LEMBRETE);
  });
});
