/**
 * App de campo, leva 1 — rotas reais, Prisma real, PostgreSQL real:
 *  - QR fora das OS de hoje: a FICHA respeita a permissão (Equipamentos › Visualizar), o módulo QR Codes, a empresa
 *    e "Exibir dados do cliente"; nunca leva valores; QR de equipamento numa atividade dele hoje → a OS;
 *  - "Incluir nesta atividade" pelo QR: vincula e deixa registro no histórico da OS (uma vez);
 *  - materiais usados pela fila do app: idempotente (reenviar a operação, ou a mesma linha com outra operação, não
 *    duplica nem baixa de novo); SAIDA de origem OS com o veículo em local_id; material separado para a OS: consome a
 *    separação, abate a reserva e NUNCA baixa duas vezes; sem saldo, lança (negativo) e o escritório vê no sino;
 *  - o técnico corrige/remove só o DELE, com a atividade aberta; o escritório corrige e estorna qualquer um, com
 *    registro (quem/quando + histórico), e não pelo modo técnico; o razão nunca é apagado;
 *  - catálogo para o aparelho sem preço/custo; módulo Estoque desligado = só o registro.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/app-campo-leva1-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { inicioHojeBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_app_campo_l1_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O sino agenda tarefas com after(), que só existe numa requisição do Next: aqui não roda
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
// D5: o push "Estoque negativo" ao escritório — quem foi chamado, com o quê (o envio em si é coberto em push-pg)
const pushes = vi.hoisted(() => ({ negativos: [] as unknown[][] }));
vi.mock("@/lib/push/eventos", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/eventos")>()),
  agendarPush: (fn: () => Promise<unknown>) => { void fn(); },
  notificarEstoqueNegativo: vi.fn(async (...a: unknown[]) => { pushes.negativos.push(a); return null; }),
}));
const comoTecnico = (tecnicoId = "t1", id = "uT", email = "joao@clima.com", permissoes: Permissoes = PRESETS.TECNICO) => {
  sessao.atual = { user: { id, name: "João", email, empresaId: "e1", role: "TECNICO", permissoes, tecnicoId } };
};
const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "uA") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@clima.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });
const sync = async (operacoes: unknown[]) => (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[];
const ficha = (valor: string) => chamar("tecnico/equipamentos/qr", "GET", {}, undefined, `?valor=${encodeURIComponent(valor)}`);
const H = 3_600_000;

describe.skipIf(!URL_PG)("app de campo, leva 1: QR e materiais usados (PostgreSQL real)", () => {
  let prisma: any;
  let separarMateriais: typeof import("@/lib/estoque/separacao-server").separarMateriais;
  let definirModulo: typeof import("@/lib/modulos/servidor").definirModulo;
  const hoje = inicioHojeBR();
  const saldo = async (id: string) => Number((await prisma.produto.findUnique({ where: { id } })).saldo);
  const razao = (produtoId: string) => prisma.movimentacaoEstoque.findMany({ where: { produtoId }, orderBy: { criadoEm: "asc" }, select: { tipo: true, quantidade: true, localId: true, refId: true, usuarioId: true, origem: true } });
  const somaRazao = async (produtoId: string) => Number((await prisma.movimentacaoEstoque.aggregate({ where: { produtoId }, _sum: { quantidade: true } }))._sum.quantidade ?? 0);
  const linha = (clientId: string) => prisma.atividadeMaterial.findFirst({ where: { clientId } });
  const material = (dados: Record<string, unknown>, atividadeId = "aA") => op("material", atividadeId, { dados });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ separarMateriais } = await import("@/lib/estoque/separacao-server"));
    ({ definirModulo } = await import("@/lib/modulos/servidor"));
    await Promise.all(["tecnico/sync", "tecnico/atividades/[atividadeId]", "tecnico/equipamentos/qr", "tecnico/catalogo", "ordens/[id]/materiais-campo",
      "ordens/[id]/materiais-campo/[linhaId]", "ordens/[id]/consumo", "alertas"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Maria", email: "maria@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "ana@clima.com", senha: "x" },
      { id: "uE2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.veiculo.createMany({ data: [
      { id: "vFiorino", empresaId: "e1", placa: "ABC1D23", modelo: "Fiorino" },
      { id: "vStrada", empresaId: "e1", placa: "XYZ9K87", modelo: "Strada" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com", veiculoId: "vStrada" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "2", email: "maria@clima.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia LTDA", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "1" },
      { id: "c2", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "2" },
      { id: "cE2", empresaId: "e2", nome: "Da outra", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Loja" },
      { id: "unE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    const eq = (id: string, unidadeId: string, nome: string, empresaId = "e1") => ({ id, empresaId, unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTXS", nome });
    await prisma.equipamento.createMany({ data: [eq("eqA", "un1", "Split Sala 1"), eq("eqB", "un1", "Split Sala 2"), eq("eqP", "un2", "Split da padaria"), eq("eqV", "un2", "Etiqueta velha"), eq("eqE2", "unE2", "Da outra", "e2")] });
    await prisma.qrcode.createMany({ data: [
      { empresaId: "e1", codigo: "QR-A", equipamentoId: "eqA", tokenPublico: "tok-A" },
      { empresaId: "e1", codigo: "QR-B", equipamentoId: "eqB", tokenPublico: "tok-B" },
      { empresaId: "e1", codigo: "QR-P", equipamentoId: "eqP", tokenPublico: "tok-P" },
      { empresaId: "e1", codigo: "QR-VELHO", equipamentoId: "eqV", tokenPublico: "tok-velho", ativo: false },
      { empresaId: "e2", codigo: "QR-E2", equipamentoId: "eqE2", tokenPublico: "tok-E2" },
    ] });
    const os = (id: string, numero: string, clienteId: string, unidadeId: string) => ({ id, empresaId: "e1", numero, clienteId, unidadeId, criadoPorId: "uA", descricao: "Preventiva" });
    await prisma.ordemServico.createMany({ data: [os("osA", "OS-0001", "c1", "un1"), os("osP", "OS-0002", "c2", "un2"), os("osM", "OS-0003", "c1", "un1"), os("osPassada", "OS-0004", "c2", "un2")] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aA", empresaId: "e1", ordemServicoId: "osA", titulo: "Preventiva mensal", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 14 * H), status: "EM_ANDAMENTO", veiculoId: "vFiorino" },
      { id: "aM", empresaId: "e1", ordemServicoId: "osM", titulo: "Da Maria", tecnicoId: "t2", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "EM_ANDAMENTO" },
      { id: "aP", empresaId: "e1", ordemServicoId: "osP", titulo: "Padaria", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 16 * H), status: "EM_ANDAMENTO" },
      { id: "aPassada", empresaId: "e1", ordemServicoId: "osPassada", titulo: "Preventiva antiga", tecnicoId: "t2", dataAgendada: new Date(hoje.getTime() - 40 * 24 * H), status: "CONCLUIDA", resumo: "Tudo certo" },
    ] });
    await prisma.atividadeTecnico.create({ data: { atividadeId: "aM", tecnicoId: "t1" } }); // João na composição da atividade da Maria
    await prisma.atividadeEquipamento.createMany({ data: [
      { atividadeId: "aA", equipamentoId: "eqA" }, { atividadeId: "aM", equipamentoId: "eqA" }, { atividadeId: "aPassada", equipamentoId: "eqP", feito: true, observacao: "Filtro trocado" },
    ] });
    await prisma.servicoAdicional.create({ data: { empresaId: "e1", atividadeId: "aPassada", ordemServicoId: "osPassada", equipamentoId: "eqP", descricao: "Troca do controle", statusCobranca: "COBRAR", valor: 180 } }).catch(() => null);
    await prisma.produto.createMany({ data: [
      { id: "pCap", empresaId: "e1", codigo: 104, nome: "Capacitor 35 µF", unidade: "un", valorPadrao: 45, saldo: 10, controlaEstoque: true },
      { id: "pCabo", empresaId: "e1", codigo: 115, nome: "Cabo PP 2,5 mm²", unidade: "m", valorPadrao: 8, saldo: 1, controlaEstoque: true },
      { id: "pGas", empresaId: "e1", codigo: 101, nome: "Gás R-410A", unidade: "kg", valorPadrao: 90, saldo: 20, controlaEstoque: true },
      { id: "pServ", empresaId: "e1", codigo: 300, nome: "Taxa de visita embalada", unidade: "un", valorPadrao: 50, saldo: 0, controlaEstoque: false },
      { id: "pInativo", empresaId: "e1", codigo: 400, nome: "Antigo", unidade: "un", ativo: false },
      { id: "pE2", empresaId: "e2", codigo: 1, nome: "Da outra empresa", unidade: "un" },
    ] });
    // Gás R-410A: 4 kg separados para a OS A (a reserva já saiu do disponível: 20 → 16)
    const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: "osA", tipo: "SERVICO", descricao: "Carga de gás", quantidade: 1, valorUnitario: 300, valorTotal: 300, valorBase: 300 } });
    await prisma.osMaterial.create({ data: { id: "mGas", ordemServicoId: "osA", osItemId: item.id, produtoId: "pGas", descricao: "Gás R-410A", unidade: "kg", comportamento: "INCLUSO_NO_SERVICO", quantidade: 4, quantidadePadrao: 4, valorVendaUnit: 90, origem: "SOLTO" } });
    await separarMateriais("e1", "osA", "uA", [{ id: "mGas", quantidade: 4 }]);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ═════════════ QR ═════════════ */
  describe("QR fora das OS de hoje: a ficha", () => {
    it("ficha com identificação e histórico — sem valor, cobrança, token nem endereço de foto", async () => {
      comoTecnico();
      const r = await ficha("https://app.frivo.com.br/qr/tok-P");
      expect(r.status).toBe(200);
      expect(r.json.equipamento).toMatchObject({ id: "eqP", titulo: "Split da padaria", cliente: "Padaria Pão Quente", unidade: "Loja", ativo: true });
      expect(r.json.historico.map((h: any) => [h.osNumero, h.status, h.observacao])).toEqual([["OS-0004", "CONCLUIDA", "Filtro trocado"]]);
      expect(r.json.atividadeHoje).toBeNull();
      const txt = JSON.stringify(r.json);
      for (const proibido of ["180", "COBRAR", "statusCobranca", "linkRelatorio", "tokenRelatorio", "/api/", "valor\":", "custo"]) expect(txt, proibido).not.toContain(proibido);
      // Pelo código também
      expect((await ficha("QR-P")).json.equipamento.id).toBe("eqP");
    });
    it("equipamento numa atividade DELE hoje (inclusive na composição): manda abrir a OS em vez da ficha", async () => {
      comoTecnico();
      // eqA está na aA (dele) e na aM (da Maria, com ele na composição): vale a de horário mais cedo — a aM, às 9h
      expect((await ficha("QR-A")).json.atividadeHoje).toEqual({ atividadeId: "aM", vinculado: true });
      // Fora da composição, só a dele
      await prisma.atividadeTecnico.deleteMany({ where: { atividadeId: "aM", tecnicoId: "t1" } });
      expect((await ficha("QR-A")).json.atividadeHoje).toEqual({ atividadeId: "aA", vinculado: true });
      await prisma.atividadeTecnico.create({ data: { atividadeId: "aM", tecnicoId: "t1" } });
      // eqB não está em atividade nenhuma
      expect((await ficha("QR-B")).json.atividadeHoje).toBeNull();
      // A da Maria não aparece para outro técnico que não está nela
      comoTecnico("t2", "uT2", "maria@clima.com");
      expect((await ficha("QR-A")).json.atividadeHoje).toEqual({ atividadeId: "aM", vinculado: true });
    });
    it("respeita a permissão: sem Equipamentos › Visualizar, 403", async () => {
      const semEquip = montarPermissoes({ ordens: ["visualizar", "editar"] } as never);
      comoTecnico("t1", "uT", "joao@clima.com", semEquip);
      expect((await ficha("QR-P")).status).toBe(403);
    });
    it("'Exibir dados do cliente' desligado: nem o cliente nem a unidade saem do servidor", async () => {
      await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appExibirDadosCliente: false } });
      comoTecnico();
      const r = await ficha("QR-P");
      expect(r.json.equipamento).toMatchObject({ cliente: null, unidade: null });
      expect(JSON.stringify(r.json)).not.toContain("Padaria");
      await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appExibirDadosCliente: true } });
    });
    it("QR de outra empresa, inativo, desconhecido ou vazio: não reconhecido; módulo QR Codes desligado: 403", async () => {
      comoTecnico();
      expect((await ficha("QR-E2")).status).toBe(404);
      expect((await ficha("tok-E2")).status).toBe(404);
      expect((await ficha("QR-VELHO")).status).toBe(404);
      expect((await ficha("QR-NADA")).json.erro).toBe("QR Code não reconhecido.");
      expect((await ficha("  ")).status).toBe(400);
      await definirModulo("e1", "qrcodes", false, "uA");
      expect((await ficha("QR-P")).status).toBe(403);
      await definirModulo("e1", "qrcodes", true, "uA");
      expect((await ficha("QR-P")).status).toBe(200);
    });
  });

  describe("QR → 'Incluir nesta atividade'", () => {
    it("vincula e registra no histórico da OS (quem, o quê, qual atividade) — uma vez só, mesmo reenviado", async () => {
      comoTecnico();
      const o = op("vincular", "aA", { equipamentoIds: ["eqB"], origem: "qr" });
      expect((await sync([o]))[0]).toMatchObject({ ok: true });
      expect(await prisma.atividadeEquipamento.count({ where: { atividadeId: "aA", equipamentoId: "eqB" } })).toBe(1);
      const hist = await prisma.osHistorico.findMany({ where: { ordemServicoId: "osA", acao: "Equipamento incluído pelo técnico (QR Code)" } });
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ usuarioId: "uT", detalhes: expect.stringContaining('"Preventiva mensal": Split Sala 2') });
      // Reenvio da mesma operação e outra operação para o mesmo equipamento: nada novo no histórico
      await sync([o]);
      await sync([op("vincular", "aA", { equipamentoIds: ["eqB"], origem: "qr" })]);
      expect(await prisma.osHistorico.count({ where: { ordemServicoId: "osA", acao: "Equipamento incluído pelo técnico (QR Code)" } })).toBe(1);
      // Vínculo pela lista (sem origem) continua sem registro, como antes
      await prisma.atividadeEquipamento.deleteMany({ where: { atividadeId: "aA", equipamentoId: "eqB" } });
      await sync([op("vincular", "aA", { equipamentoIds: ["eqB"] })]);
      expect(await prisma.osHistorico.count({ where: { ordemServicoId: "osA", acao: "Equipamento incluído pelo técnico (QR Code)" } })).toBe(1);
    });
    it("equipamento de outro cliente não entra (nem pelo QR)", async () => {
      comoTecnico();
      const [r] = await sync([op("vincular", "aA", { equipamentoIds: ["eqP"], origem: "qr" })]);
      expect(r).toMatchObject({ ok: false, status: 400 });
      expect(await prisma.atividadeEquipamento.count({ where: { atividadeId: "aA", equipamentoId: "eqP" } })).toBe(0);
    });
  });

  /* ═════════════ materiais ═════════════ */
  describe("catálogo para o aparelho", () => {
    it("código, nome, unidade e (D5) o saldo dos ATIVOS da empresa — nunca preço ou custo", async () => {
      comoTecnico();
      const r = await chamar("tecnico/catalogo", "GET");
      expect(r.status).toBe(200);
      expect(r.json.produtos.map((p: any) => p.id).sort()).toEqual(["pCabo", "pCap", "pGas", "pServ"]);
      for (const p of r.json.produtos) expect(Object.keys(p).sort()).toEqual(["codigo", "id", "nome", "saldo", "unidade"]);
      expect(JSON.stringify(r.json)).not.toMatch(/valor|custo|preco|45|90/);
      // D5: o saldo do estoque; quem não controla estoque não tem saldo
      const saldos = Object.fromEntries(r.json.produtos.map((p: any) => [p.id, p.saldo]));
      expect(saldos).toEqual({ pCap: await saldo("pCap"), pCabo: 1, pGas: await saldo("pGas"), pServ: null });
      // Estoque desligado: nenhum saldo (não há o que avisar)
      await definirModulo("e1", "estoque", false, "uA");
      expect((await chamar("tecnico/catalogo", "GET")).json.produtos.every((p: any) => p.saldo === null)).toBe(true);
      await definirModulo("e1", "estoque", true, "uA");
      // Quem não grava execução não baixa o catálogo
      comoTecnico("t1", "uT", "joao@clima.com", montarPermissoes({ ordens: ["visualizar"] } as never));
      expect((await chamar("tecnico/catalogo", "GET")).status).toBe(403);
    });
  });

  describe("material usado pela fila do app", () => {
    it("lança: SAIDA de origem OS, com o veículo DA ATIVIDADE no local_id, e o retrato mostra a linha (sem valor)", async () => {
      comoTecnico();
      const [r] = await sync([material({ clientId: "cap1", produtoId: "pCap", quantidade: 2, equipamentoId: "eqA", descricao: "ignorado", unidade: "zz" })]);
      expect(r).toMatchObject({ ok: true, status: 201 });
      expect(await saldo("pCap")).toBe(8);
      const mov = (await razao("pCap")).at(-1);
      expect(mov).toMatchObject({ tipo: "SAIDA", origem: "OS", localId: "vFiorino", refId: "osA", usuarioId: "uT" });
      expect(Number(mov.quantidade)).toBe(-2);
      // A linha usa o nome e a unidade DO CADASTRO
      expect(await linha("cap1")).toMatchObject({ descricao: "Capacitor 35 µF", unidade: "un", veiculoId: "vFiorino", equipamentoId: "eqA", criadoPorId: "uT", osMaterialId: null });
      const ret = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).json;
      expect(ret.execucao.materiais).toEqual([{ id: expect.any(String), clientId: "cap1", produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 2, equipamentoId: "eqA", meu: true, criadoPor: "João" }]);
      expect(JSON.stringify(ret.execucao.materiais)).not.toMatch(/valor|custo|45/);
    });
    it("IDEMPOTENTE: reenviar a operação, ou a mesma linha (clientId) com outra operação igual, não duplica nem baixa de novo", async () => {
      comoTecnico();
      const o = material({ clientId: "cap2", produtoId: "pCap", quantidade: 1 });
      await sync([o]);
      const depois = await saldo("pCap");
      expect((await sync([o]))[0]).toMatchObject({ ok: true, repetida: true });
      expect((await sync([material({ clientId: "cap2", produtoId: "pCap", quantidade: 1 })]))[0]).toMatchObject({ ok: true, status: 200 });
      expect(await prisma.atividadeMaterial.count({ where: { clientId: "cap2" } })).toBe(1);
      expect(await saldo("pCap")).toBe(depois);
      // Três envios simultâneos da mesma linha: uma linha, uma baixa
      await Promise.all([1, 2, 3].map(() => sync([material({ clientId: "cap3", produtoId: "pCap", quantidade: 1 })])));
      expect(await prisma.atividadeMaterial.count({ where: { clientId: "cap3" } })).toBe(1);
      expect(await saldo("pCap")).toBe(depois - 1);
      expect(await somaRazao("pCap")).toBe(await saldo("pCap") - 10); // o razão bate com o saldo (inicial 10 sem lançamento)
    });
    it("corrigir a quantidade lança só a DIFERENÇA (pra mais e pra menos); o razão só cresce", async () => {
      comoTecnico();
      const antes = await saldo("pCap");
      const n = (await razao("pCap")).length;
      await sync([material({ clientId: "cap1", quantidade: 5 })]);
      expect(await saldo("pCap")).toBe(antes - 3);
      await sync([material({ clientId: "cap1", quantidade: 1.5 })]);
      expect(await saldo("pCap")).toBe(antes + 0.5);
      const novos = (await razao("pCap")).slice(n);
      expect(novos.map((m: any) => [m.tipo, Number(m.quantidade)])).toEqual([["SAIDA", -3], ["SAIDA", 3.5]]);
      expect(Number((await linha("cap1")).baixado)).toBe(1.5);
    });
    it("SEPARADO para a OS: consome a separação — a reserva vira saída e só o excedente baixa a mais (nunca duas vezes)", async () => {
      comoTecnico();
      expect(await saldo("pGas")).toBe(16); // 20 − 4 reservados
      // D5: o retrato leva o separado desta OS que o próximo uso consome (o app soma ao saldo do catálogo)
      const separado = async () => (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).json.execucao.separado;
      expect(await separado()).toEqual({ pGas: 4 });
      await sync([material({ clientId: "gas1", produtoId: "pGas", quantidade: 3, equipamentoId: "eqA" })]);
      expect(await separado()).toEqual({ pGas: 1 }); // sobra 1 kg da separação para o próximo uso
      expect(await saldo("pGas")).toBe(16); // líquido zero: já tinha saído na separação
      let m = await prisma.osMaterial.findUnique({ where: { id: "mGas" } });
      expect(m).toMatchObject({ estadoSeparacao: "CONSUMIDO", consumidoPorId: "uT" });
      expect(Number(m.quantidadeConsumida)).toBe(3);
      expect((await linha("gas1")).osMaterialId).toBe("mGas");
      // Segunda linha do mesmo produto: o consumo é a SOMA (3 + 2 = 5 > 4 separados → 1 kg a mais sai)
      await sync([material({ clientId: "gas2", produtoId: "pGas", quantidade: 2 })]);
      expect(await saldo("pGas")).toBe(15);
      m = await prisma.osMaterial.findUnique({ where: { id: "mGas" } });
      expect(Number(m.quantidadeConsumida)).toBe(5);
      expect(await separado()).toEqual({}); // a separação acabou: o próximo uso sai do estoque
      // Saldo = inicial − consumido de verdade (5): nada contado duas vezes
      expect(await saldo("pGas")).toBe(20 - 5);
      expect(await somaRazao("pGas")).toBe(-5);
      // O escritório não "desfaz consumo" por fora (o lançamento é do técnico): corrige pelos materiais usados
      comoEscritorio();
      const d = await chamar("ordens/[id]/consumo", "DELETE", { id: "osA" }, { id: "mGas" });
      expect(d.status).toBe(400);
      expect(d.json.erro).toBe("Consumo informado pelo técnico em campo: corrija ou estorne em Materiais usados em campo.");
      expect(await saldo("pGas")).toBe(15);
    });
    it("remover a linha devolve pela diferença; tirar tudo volta a separação para SEPARADO (reserva intacta)", async () => {
      comoTecnico();
      await sync([op("materialRemover", "aA", { dados: { clientId: "gas2" } })]);
      expect(await saldo("pGas")).toBe(16); // 3 consumidos, todos dentro da reserva
      await sync([op("materialRemover", "aA", { dados: { clientId: "gas1" } })]);
      const m = await prisma.osMaterial.findUnique({ where: { id: "mGas" } });
      expect(m).toMatchObject({ estadoSeparacao: "SEPARADO", consumidoPorId: null, consumidoEm: null });
      expect(Number(m.quantidadeConsumida)).toBe(0);
      expect(await saldo("pGas")).toBe(16); // volta a estar só reservado
      expect(await somaRazao("pGas")).toBe(-4);
      // Removidas ficam no registro (quem e quando), fora do retrato
      expect(await linha("gas1")).toMatchObject({ removidoPorId: "uT", removidoEm: expect.any(Date) });
      const ret = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).json;
      expect(ret.execucao.materiais.map((x: any) => x.clientId)).not.toContain("gas1");
      // Reenviar a remoção: ok, nada muda; gravar de novo uma linha removida: recusado
      expect((await sync([op("materialRemover", "aA", { dados: { clientId: "gas1" } })]))[0]).toMatchObject({ ok: true });
      expect((await sync([material({ clientId: "gas1", produtoId: "pGas", quantidade: 1 })]))[0]).toMatchObject({ ok: false, status: 409, erro: "Este material foi retirado da OS." });
      expect(await saldo("pGas")).toBe(16);
    });
    it("sem saldo: lança assim mesmo (o técnico não trava) — saldo negativo e aviso para o escritório no sino", async () => {
      comoTecnico();
      const [r] = await sync([material({ clientId: "cabo1", produtoId: "pCabo", quantidade: 3.5 })]);
      expect(r.ok).toBe(true);
      expect(r.dados.avisos[0]).toContain("saldo ficou negativo");
      expect(await saldo("pCabo")).toBe(-2.5);
      // D5: o escritório é avisado (o push "Estoque negativo", com a OS) — confere o que o aviso do app promete
      expect(pushes.negativos.at(-1)).toEqual(["e1", "pCabo", expect.any(String)]);
      comoEscritorio();
      expect((await chamar("alertas", "GET")).json.estoqueNegativoCampo).toBe(1);
      // Sem permissão de ver o Estoque, o aviso não vem; o técnico nunca recebe
      comoEscritorio(montarPermissoes({ ordens: ["visualizar"] } as never));
      expect((await chamar("alertas", "GET")).json.estoqueNegativoCampo).toBe(0);
      comoTecnico();
      expect((await chamar("alertas", "GET")).json.estoqueNegativoCampo).toBe(0);
    });
    it("sem veículo na atividade: o veículo padrão do técnico vai para o local_id", async () => {
      comoTecnico();
      await sync([material({ clientId: "cap-p", produtoId: "pCap", quantidade: 1 }, "aP")]);
      expect((await razao("pCap")).at(-1).localId).toBe("vStrada");
      expect((await linha("cap-p")).veiculoId).toBe("vStrada");
    });
    it("fora do catálogo e produto que não controla estoque: só o registro, sem razão", async () => {
      comoTecnico();
      const n = await prisma.movimentacaoEstoque.count();
      await sync([material({ clientId: "fita", descricao: "Fita aluminizada", unidade: "rl", quantidade: 1 }), material({ clientId: "taxa", produtoId: "pServ", quantidade: 1 })]);
      expect(await linha("fita")).toMatchObject({ produtoId: null, descricao: "Fita aluminizada", unidade: "rl" });
      expect(await linha("taxa")).toMatchObject({ produtoId: "pServ" });
      expect(await prisma.movimentacaoEstoque.count()).toBe(n);
    });
    it("recusas: produto inativo/de outra empresa, equipamento fora da atividade, atividade de outro técnico", async () => {
      comoTecnico();
      const r = await sync([material({ clientId: "x1", produtoId: "pInativo", quantidade: 1 })]);
      expect(r[0]).toMatchObject({ ok: false, status: 400, erro: "Produto não encontrado no catálogo." });
      expect((await sync([material({ clientId: "x2", produtoId: "pE2", quantidade: 1 })]))[0].status).toBe(400);
      expect((await sync([material({ clientId: "x3", produtoId: "pCap", quantidade: 1, equipamentoId: "eqP" })]))[0]).toMatchObject({ status: 404, erro: "Este equipamento não está nesta atividade." });
      comoTecnico("t2", "uT2", "maria@clima.com");
      expect((await sync([material({ clientId: "x4", produtoId: "pCap", quantidade: 1 }, "aP")]))[0].status).toBe(403);
      expect(await prisma.atividadeMaterial.count({ where: { clientId: { in: ["x1", "x2", "x3", "x4"] } } })).toBe(0);
      // Linha nova sem produto nem descrição
      comoTecnico();
      expect((await sync([material({ clientId: "x6", quantidade: 1 })]))[0]).toMatchObject({ ok: false, status: 400, erro: "Escolha no catálogo ou descreva o material." });
      // Quantidade inválida não passa da validação
      expect((await sync([material({ clientId: "x5", produtoId: "pCap", quantidade: 0 })]))[0].status).toBe(400);
    });
    it("o técnico mexe só no DELE: a Maria (na mesma atividade) não corrige nem remove a linha do João", async () => {
      comoTecnico("t2", "uT2", "maria@clima.com");
      await sync([material({ clientId: "maria1", produtoId: "pCap", quantidade: 1 }, "aM")]);
      comoTecnico(); // João está na composição da aM
      const ret = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aM" })).json;
      expect(ret.execucao.materiais[0]).toMatchObject({ clientId: "maria1", meu: false, criadoPor: "Maria" });
      expect((await sync([op("materialRemover", "aM", { dados: { clientId: "maria1" } })]))[0]).toMatchObject({ ok: false, status: 403 });
      expect((await sync([material({ clientId: "maria1", quantidade: 9 }, "aM")]))[0]).toMatchObject({ ok: false, status: 403 });
      expect(Number((await linha("maria1")).quantidade)).toBe(1);
    });
    it("atividade concluída: o técnico não lança, não corrige e não remove", async () => {
      comoTecnico();
      await prisma.atividadeOs.update({ where: { id: "aP" }, data: { status: "CONCLUIDA" } });
      expect((await sync([op("materialRemover", "aP", { dados: { clientId: "cap-p" } })]))[0]).toMatchObject({ ok: false, status: 409 });
      expect((await sync([material({ clientId: "novo-p", produtoId: "pCap", quantidade: 1 }, "aP")]))[0]).toMatchObject({ ok: false, status: 409 });
      expect((await linha("cap-p")).removidoEm).toBeNull();
      await prisma.atividadeOs.update({ where: { id: "aP" }, data: { status: "EM_ANDAMENTO" } });
    });
    it("módulo Estoque desligado: o material fica registrado, nada vai para o razão (e não marca como baixado)", async () => {
      comoTecnico();
      await definirModulo("e1", "estoque", false, "uA");
      const n = await prisma.movimentacaoEstoque.count();
      expect((await sync([material({ clientId: "semest", produtoId: "pCap", quantidade: 1 })]))[0].ok).toBe(true);
      expect(await prisma.movimentacaoEstoque.count()).toBe(n);
      expect(Number((await linha("semest")).baixado)).toBe(0);
      await definirModulo("e1", "estoque", true, "uA");
    });
  });

  describe("escritório: corrigir e estornar pela OS", () => {
    it("lista da OS com quem lançou e o veículo; sem valores", async () => {
      comoEscritorio();
      const r = await chamar("ordens/[id]/materiais-campo", "GET", { id: "osA" });
      expect(r.status).toBe(200);
      const cap1 = r.json.linhas.find((l: any) => l.descricao === "Capacitor 35 µF" && l.quantidade === 1.5);
      expect(cap1).toMatchObject({ atividade: "Preventiva mensal", equipamento: "Split Sala 1", veiculo: "ABC1D23 · Fiorino", criadoPor: "João", removidoEm: null, daSeparacao: false });
      // As removidas continuam como registro
      expect(r.json.linhas.find((l: any) => l.quantidade === 3 && l.descricao === "Gás R-410A")).toMatchObject({ removidoPor: "João" });
      expect(JSON.stringify(r.json)).not.toMatch(/valor|custo|"45"/i);
      comoEscritorio(permissoesTotais(), "e2", "uE2");
      expect((await chamar("ordens/[id]/materiais-campo", "GET", { id: "osA" })).status).toBe(404);
    });
    it("corrige a quantidade de qualquer linha: estoque pela diferença, quem/quando e histórico da OS", async () => {
      comoEscritorio();
      const l = await linha("cap1");
      const antes = await saldo("pCap");
      const r = await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osA", linhaId: l.id }, { quantidade: 3 });
      expect(r.status).toBe(200);
      expect(await saldo("pCap")).toBe(antes - 1.5);
      expect(await linha("cap1")).toMatchObject({ corrigidoPorId: "uA", corrigidoEm: expect.any(Date) });
      expect(await prisma.osHistorico.findFirst({ where: { ordemServicoId: "osA", acao: "Material usado em campo corrigido" } })).toMatchObject({ usuarioId: "uA", detalhes: "Capacitor 35 µF: 1,5 un → 3 un" });
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osA", linhaId: l.id }, { quantidade: -1 })).status).toBe(400);
      // Linha de outra OS pelo endereço desta: não encontrada
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osP", linhaId: l.id }, { quantidade: 2 })).status).toBe(404);
    });
    it("estorna: sai da OS (fica no registro), o estoque volta e o histórico diz quem; repetir não estorna de novo", async () => {
      comoEscritorio();
      const l = await linha("cabo1");
      expect(await saldo("pCabo")).toBe(-2.5);
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "DELETE", { id: "osA", linhaId: l.id })).status).toBe(200);
      expect(await saldo("pCabo")).toBe(1);
      expect(await linha("cabo1")).toMatchObject({ removidoPorId: "uA" });
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "DELETE", { id: "osA", linhaId: l.id })).status).toBe(200);
      expect(await saldo("pCabo")).toBe(1);
      expect(await prisma.osHistorico.count({ where: { ordemServicoId: "osA", acao: "Material usado em campo estornado" } })).toBe(1);
      // O razão nunca é apagado: a saída e o estorno estão lá
      expect((await razao("pCabo")).map((m: any) => [m.tipo, Number(m.quantidade)])).toEqual([["SAIDA", -3.5], ["SAIDA", 3.5]]);
      // Saldo voltou: o aviso do sino some
      expect((await chamar("alertas", "GET")).json.estoqueNegativoCampo).toBe(0);
      // Corrigir estornado: recusado
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osA", linhaId: l.id }, { quantidade: 1 })).status).toBe(409);
    });
    it("OS já numa medição válida: o uso em campo não muda mais (o faturamento já contou); medição cancelada não trava", async () => {
      comoEscritorio();
      const l = await linha("cap1");
      const med = await prisma.medicao.create({ data: { empresaId: "e1", clienteId: "c1", numero: "MED-1", tokenPublico: "tok-med-1", status: "APROVADA" } });
      await prisma.medicaoItem.create({ data: { medicaoId: med.id, ordemServicoId: "osA", descricao: "OS-0001", quantidade: 1, valorUnitario: 1, valorTotal: 1 } });
      const antes = await saldo("pCap");
      const r = await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osA", linhaId: l.id }, { quantidade: 9 });
      expect(r).toMatchObject({ status: 409, json: { erro: "OS já está numa medição: o material usado não pode mais ser alterado." } });
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "DELETE", { id: "osA", linhaId: l.id })).status).toBe(409);
      expect(await saldo("pCap")).toBe(antes);
      await prisma.medicao.update({ where: { id: med.id }, data: { status: "CANCELADA" } });
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osA", linhaId: l.id }, { quantidade: 3 })).status).toBe(200);
    });
    it("sino: saldo exatamente zero não é negativo (só abaixo de zero avisa)", async () => {
      comoEscritorio();
      await prisma.produto.update({ where: { id: "pCabo" }, data: { saldo: 0 } });
      await prisma.atividadeMaterial.updateMany({ where: { clientId: "cabo1" }, data: { removidoEm: null } });
      expect((await chamar("alertas", "GET")).json.estoqueNegativoCampo).toBe(0);
      await prisma.produto.update({ where: { id: "pCabo" }, data: { saldo: -0.001 } });
      expect((await chamar("alertas", "GET")).json.estoqueNegativoCampo).toBe(1);
      // Uso em campo antigo (fora da janela) não conta
      await prisma.atividadeMaterial.updateMany({ where: { produtoId: "pCabo" }, data: { criadoEm: new Date(Date.now() - 31 * 24 * H) } });
      expect((await chamar("alertas", "GET")).json.estoqueNegativoCampo).toBe(0);
      await prisma.produto.update({ where: { id: "pCabo" }, data: { saldo: 1 } });
      await prisma.atividadeMaterial.updateMany({ where: { clientId: "cabo1" }, data: { removidoEm: new Date() } });
    });
    it("o técnico (modo técnico) não usa a rota do escritório, mesmo com OS › Editar", async () => {
      comoTecnico();
      const l = await linha("cap1");
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "PATCH", { id: "osA", linhaId: l.id }, { quantidade: 1 })).status).toBe(403);
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "DELETE", { id: "osA", linhaId: l.id })).status).toBe(403);
    });
    it("separação com a sobra já DEVOLVIDA: nem técnico nem escritório mexem por aqui (o estoque já fechou)", async () => {
      comoTecnico();
      await sync([material({ clientId: "gas3", produtoId: "pGas", quantidade: 1 })]);
      await prisma.osMaterial.update({ where: { id: "mGas" }, data: { estadoSeparacao: "DEVOLVIDO" } });
      const antes = await saldo("pGas");
      expect((await sync([material({ clientId: "gas3", quantidade: 2 })]))[0]).toMatchObject({ ok: false, status: 409, erro: "A sobra deste material já voltou ao estoque: fale com o escritório." });
      comoEscritorio();
      const l = await linha("gas3");
      expect((await chamar("ordens/[id]/materiais-campo/[linhaId]", "DELETE", { id: "osA", linhaId: l.id })).status).toBe(409);
      expect(await saldo("pGas")).toBe(antes);
      expect((await linha("gas3")).removidoEm).toBeNull();
    });
  });
});
