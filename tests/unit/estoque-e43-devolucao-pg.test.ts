/**
 * Estoque E4.3 — devolução da sobra + Portões 2/3 num PostgreSQL real, com o Prisma real e as rotas de verdade:
 *  - devolver a sobra: DEVOLUCAO (+) no razão vinculada à OS, saldo volta, saldo final = inicial − consumido, razão só
 *    cresce, estado DEVOLVIDO com quem/quando, histórico, "material prestado contas", sai da fila;
 *  - fila "A devolver" + sino só para quem tem a permissão; OS sem sobra não entra; OS de outra empresa não;
 *  - OS CANCELADA com material reservado entra na fila e devolve o reservado (libera o estoque); desfazer volta a SEPARADO;
 *  - Portões 2/3: amarra LIGADA trava faturar e gerar medição (422 dizendo o que falta); devolvida a sobra, passa;
 *    DESLIGADA não trava; consumo não informado também aparece no texto;
 *  - desfazer: DEVOLUCAO (−), estado volta a CONSUMIDO, sobra pendente de novo; OS já faturada não desfaz;
 *  - regras: separado sem consumo (OS viva) recusa, já devolvido recusa, outra OS/empresa, repetido, 403; item com material
 *    devolvido não se edita; concorrência: devoluções simultâneas do mesmo produto não se perdem.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/estoque-e43-devolucao-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_e43_devolucao_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const fila = () => chamar("estoque/devolucao", "GET");
const sino = () => chamar("alertas", "GET");
const verOs = (id: string) => chamar("ordens/[id]/devolucao", "GET", undefined, { id });
const devolver = (id: string, materiais: string[]) => chamar("ordens/[id]/devolucao", "POST", { materiais }, { id });
const desfazer = (id: string, materialId: string) => chamar("ordens/[id]/devolucao", "DELETE", { id: materialId }, { id });
const faturar = (id: string) => chamar("ordens/[id]/faturar", "POST", {}, { id });
const gerarMedicao = (id: string) => chamar("ordens/[id]/gerar-medicao", "POST", undefined, { id });

describe.skipIf(!URL_PG)("Devolução da sobra + Portões 2/3 (PostgreSQL real)", () => {
  let prisma: any;
  let separarMateriais: typeof import("@/lib/estoque/separacao-server").separarMateriais;
  let consumirMateriais: typeof import("@/lib/estoque/consumo-server").consumirMateriais;
  let seq = 0;
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSD-${++seq}`, clienteId: "c1", criadoPorId: "u1", status: "CONCLUIDA", statusManual: true, origem: "MANUAL", descricao: "Instalação", ...dados } });
  async function itemComMateriais(osId: string, materiais: [produtoId: string, descricao: string, unidade: string, quantidade: number][]) {
    const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: osId, tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorBase: 800, executado: true } });
    const criados: Record<string, string> = {};
    for (const [i, [produtoId, descricao, unidade, quantidade]] of materiais.entries()) {
      const m = await prisma.osMaterial.create({ data: { ordemServicoId: osId, osItemId: item.id, produtoId, descricao, unidade, comportamento: "INCLUSO_NO_SERVICO", quantidade, quantidadePadrao: quantidade, valorVendaUnit: 10, origem: "SOLTO", ordem: i } });
      criados[produtoId] = m.id;
    }
    return { itemId: item.id, materiais: criados };
  }
  /** Separa e informa o consumo (o caminho da E4.1 + E4.2) */
  async function separarEConsumir(osId: string, m: Record<string, string>, sep: Record<string, number>, cons: Record<string, number>) {
    await separarMateriais("e1", osId, "u1", Object.entries(sep).map(([p, q]) => ({ id: m[p], quantidade: q })));
    await consumirMateriais("e1", osId, "u4", Object.entries(cons).map(([p, q]) => ({ id: m[p], quantidade: q })));
  }
  const saldo = async (produtoId: string) => Number((await prisma.produto.findUnique({ where: { id: produtoId } })).saldo);
  const somaRazao = async (produtoId: string, where: Record<string, unknown> = {}) => Number((await prisma.movimentacaoEstoque.aggregate({ where: { produtoId, ...where }, _sum: { quantidade: true } }))._sum.quantidade ?? 0);
  const material = (id: string) => prisma.osMaterial.findUnique({ where: { id } });
  const amarra = (ligada: boolean) => prisma.configuracao.update({ where: { empresaId: "e1" }, data: { osExigirPrestacaoMaterial: ligada } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ separarMateriais } = await import("@/lib/estoque/separacao-server"));
    ({ consumirMateriais } = await import("@/lib/estoque/consumo-server"));
    await Promise.all(["estoque/devolucao", "ordens/[id]/devolucao", "ordens/[id]/faturar", "ordens/[id]/gerar-medicao", "ordens/[id]/orcamento/[itemId]", "alertas"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u3", empresaId: "e1", nome: "Zé do Almoxarifado", email: "z@x.com", senha: "x" }, { id: "u4", empresaId: "e1", nome: "Carlos Técnico", email: "c@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" }] });
    const p = (id: string, nome: string, unidade: string, empresaId = "e1") => prisma.produto.create({ data: { id, empresaId, nome, unidade } });
    await p("tubo", "Tubo de cobre 1/4", "m"); await p("cap", "Capacitor 35uF", "un"); await p("fita", "Fita", "un"); await p("outro", "Da outra", "un", "e2");
    await prisma.servico.createMany({ data: [{ id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800 }, { id: "sOutra", empresaId: "e2", codigo: "X01", nome: "Da outra", valorPadrao: 1 }] });
    const { movimentar } = await import("@/lib/estoque/servidor");
    await movimentar({ empresaId: "e1", produtoId: "tubo", operacao: "ENTRADA", valor: 10, custoUnitario: 12 });
    await movimentar({ empresaId: "e1", produtoId: "cap", operacao: "ENTRADA", valor: 4, custoUnitario: 45 });
    await movimentar({ empresaId: "e1", produtoId: "fita", operacao: "ENTRADA", valor: 50 });
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("devolver a sobra: DEVOLUCAO (+) vinculada à OS, saldo volta (final = inicial − consumido), razão só cresce; estado DEVOLVIDO com quem/quando; histórico; 'material prestado contas'; sai da fila e do sino", async () => {
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo de cobre 1/4", "m", 5], ["cap", "Capacitor 35uF", "un", 1]]);
    await separarEConsumir(os.id, materiais, { tubo: 5, cap: 1 }, { tubo: 3, cap: 1 }); // tubo: sobra 2; cap: sem sobra
    expect(await saldo("tubo")).toBe(5); // 10 − 5 separados (3 consumidos + 2 ainda reservados)
    logar(montarPermissoes({ estoque: ["separar"] }), "e1", "u3");
    expect((await fila()).json.map((o: any) => [o.id, o.aDevolver, o.cancelada, o.itens])).toEqual([[os.id, 1, false, [{ descricao: "Tubo de cobre 1/4", quantidade: 2, unidade: "m" }]]]);
    expect((await sino()).json.devolucoesPendentes).toBe(1);
    const tela = (await verOs(os.id)).json;
    expect(tela.materiais.map((m: any) => [m.produtoId, m.aDevolver, m.pendenteDevolucao, m.situacao])).toEqual([["tubo", 2, 2, "consumido"], ["cap", 0, 0, "consumido"]]);
    expect(tela.resumo).toMatchObject({ aDevolver: 1, prestacaoPendente: true, prestado: false });
    const antes = await prisma.movimentacaoEstoque.count();
    const r = await devolver(os.id, [materiais.tubo]);
    expect(r.json?.erro ?? r.status).toBe(200);
    expect(r.json).toMatchObject({ avisos: [], movimentos: 1 });
    const dev = await prisma.movimentacaoEstoque.findFirst({ where: { produtoId: "tubo", tipo: "DEVOLUCAO" } });
    expect(dev).toMatchObject({ origem: "OS", refId: os.id, usuarioId: "u3", observacao: "Devolução — OS OSD-1 · Tubo de cobre 1/4" });
    expect(Number(dev.quantidade)).toBe(2);
    expect(await saldo("tubo")).toBe(7); // inicial 10 − consumido 3
    expect(await somaRazao("tubo")).toBe(7);
    expect(await somaRazao("tubo", { refId: os.id })).toBe(-3); // a OS deixou no razão exatamente o consumido
    expect(await prisma.movimentacaoEstoque.count()).toBe(antes + 1);
    const m = await material(materiais.tubo);
    expect(m).toMatchObject({ estadoSeparacao: "DEVOLVIDO", devolvidoPorId: "u3" });
    expect([Number(m.quantidadeSeparada), Number(m.quantidadeConsumida), Number(m.quantidadeDevolvida)]).toEqual([5, 3, 2]);
    expect(m.devolvidoEm).toBeInstanceOf(Date);
    expect(r.json.separacao.materiais[0]).toMatchObject({ situacao: "devolvido", quantidadeDevolvida: 2, aDevolver: 0, devolvidoPor: "Zé do Almoxarifado" });
    expect(r.json.separacao.resumo).toMatchObject({ aDevolver: 0, devolvidos: 1, consumidos: 1, prestacaoPendente: false, prestado: true });
    expect((await prisma.osHistorico.findFirst({ where: { ordemServicoId: os.id, acao: "Material devolvido ao estoque" } }))).toMatchObject({ usuarioId: "u3", detalhes: "Tubo de cobre 1/4: 2 m" });
    expect((await fila()).json).toEqual([]);
    expect((await sino()).json.devolucoesPendentes).toBe(0);
    logar();
  });

  it("fila e permissão: OS sem sobra não entra; 403 sem a permissão e o sino não conta; outra empresa não vê", async () => {
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["cap", "Capacitor 35uF", "un", 1]]);
    await separarEConsumir(os.id, materiais, { cap: 1 }, { cap: 1 });
    const comSobra = await novaOs();
    const m2 = await itemComMateriais(comSobra.id, [["tubo", "Tubo", "m", 2]]);
    await separarEConsumir(comSobra.id, m2.materiais, { tubo: 2 }, { tubo: 1 });
    expect((await fila()).json.map((o: any) => o.id)).toEqual([comSobra.id]);
    logar(montarPermissoes({ estoque: ["visualizar", "gerenciar"], ordens: ["visualizar", "editar", "concluir"] }));
    expect((await fila()).status).toBe(403);
    expect((await verOs(comSobra.id)).status).toBe(403);
    expect((await devolver(comSobra.id, [m2.materiais.tubo])).status).toBe(403);
    expect((await sino()).json.devolucoesPendentes).toBe(0);
    logar(permissoesTotais(), "e2", "u2");
    expect((await fila()).json).toEqual([]);
    expect((await verOs(comSobra.id)).status).toBe(404);
    expect((await devolver(comSobra.id, [m2.materiais.tubo])).status).toBe(404);
    logar();
    await devolver(comSobra.id, [m2.materiais.tubo]); // limpa para os próximos
  });

  it("Portões 2/3: amarra LIGADA trava faturar e gerar medição (422 com o que falta: consumo e sobra); devolvida a sobra, passa; DESLIGADA não trava", async () => {
    await amarra(true);
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo de cobre 1/4", "m", 2], ["cap", "Capacitor 35uF", "un", 1]]);
    await separarMateriais("e1", os.id, "u1", [{ id: materiais.tubo, quantidade: 2 }, { id: materiais.cap, quantidade: 1 }]);
    await consumirMateriais("e1", os.id, "u4", [{ id: materiais.tubo, quantidade: 1 }]); // cap: consumo não informado; tubo: sobra 1
    const f = await faturar(os.id);
    expect(f.status).toBe(422);
    expect(f.json.erro).toBe("Para faturar, falta: informar o consumo de Capacitor 35uF 1 un e devolver ao estoque Tubo de cobre 1/4 1 m — aba Materiais & Compras.");
    const g = await gerarMedicao(os.id);
    expect(g.status).toBe(422);
    expect(g.json.erro).toMatch(/^Para gerar a medição, falta: informar o consumo de Capacitor 35uF 1 un e devolver ao estoque Tubo de cobre 1\/4 1 m/);
    expect(await prisma.medicao.count()).toBe(0);
    // Consumo informado, mas a sobra do tubo ainda não devolvida: só o Portão 2
    await consumirMateriais("e1", os.id, "u4", [{ id: materiais.cap, quantidade: 1 }]);
    expect((await faturar(os.id)).json.erro).toBe("Para faturar, falta: devolver ao estoque Tubo de cobre 1/4 1 m — aba Materiais & Compras.");
    // Devolvida: o portão abre (o que vier depois é a regra de faturar de sempre, não 422)
    expect((await devolver(os.id, [materiais.tubo])).status).toBe(200);
    const ok = await gerarMedicao(os.id);
    expect(ok.status).not.toBe(422);
    expect(ok.json.id).toBeTruthy(); // a medição foi gerada
    expect(await prisma.medicao.count()).toBe(1);
    // DESLIGADA: outra OS com sobra fatura sem travar
    await amarra(false);
    const os2 = await novaOs();
    const m2 = await itemComMateriais(os2.id, [["cap", "Capacitor 35uF", "un", 1]]);
    await separarEConsumir(os2.id, m2.materiais, { cap: 1 }, { cap: 0 }); // sobra 1
    const livre = await gerarMedicao(os2.id);
    expect(livre.status).not.toBe(422);
    expect(await prisma.medicao.count()).toBe(2);
    // OS já faturada: a devolução da sobra ainda pode ser feita (o material volta), mas não se desfaz depois
    expect((await devolver(os2.id, [m2.materiais.cap])).status).toBe(200);
    expect((await desfazer(os2.id, m2.materiais.cap)).json).toMatchObject({ erro: "OS já faturada: a devolução não pode mais ser desfeita." });
    expect(await material(m2.materiais.cap)).toMatchObject({ estadoSeparacao: "DEVOLVIDO" });
  });

  it("OS cancelada com material reservado: entra na fila sinalizada, devolve o reservado inteiro (libera o estoque, saldo = inicial), sem consumo; desfazer volta a SEPARADO", async () => {
    const inicial = await saldo("fita");
    const os = await novaOs({ status: "CANCELADA" });
    const { materiais } = await itemComMateriais(os.id, [["fita", "Fita", "un", 3]]);
    // Separada antes de cancelar (a lib da E4.1 não separa OS cancelada: grava como a separação deixou)
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "ABERTA" } });
    await separarMateriais("e1", os.id, "u1", [{ id: materiais.fita, quantidade: 3 }]);
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CANCELADA" } });
    expect(await saldo("fita")).toBe(inicial - 3);
    const f = (await fila()).json.find((o: any) => o.id === os.id);
    expect(f).toMatchObject({ cancelada: true, status: "CANCELADA", aDevolver: 1, itens: [{ descricao: "Fita", quantidade: 3, unidade: "un" }] });
    const tela = (await verOs(os.id)).json;
    expect(tela.materiais[0]).toMatchObject({ situacao: "separado", aDevolver: 3 });
    expect(tela.resumo).toMatchObject({ consumoPendente: 0, aDevolver: 1, prestacaoPendente: true });
    // Nenhuma OS cancelada aparece na fila "A separar" nem pede consumo (E4.1/E4.2): só devolução
    const r = await devolver(os.id, [materiais.fita]);
    expect(r.status).toBe(200);
    const dev = await prisma.movimentacaoEstoque.findFirst({ where: { produtoId: "fita", tipo: "DEVOLUCAO" } });
    expect(dev).toMatchObject({ refId: os.id, observacao: `Devolução — OS OSD-${seq} · Fita (OS cancelada)` });
    expect(Number(dev.quantidade)).toBe(3);
    expect(await saldo("fita")).toBe(inicial);
    expect(await somaRazao("fita", { refId: os.id })).toBe(0);
    expect(await material(materiais.fita)).toMatchObject({ estadoSeparacao: "DEVOLVIDO", consumidoEm: null });
    expect(Number((await material(materiais.fita)).quantidadeDevolvida)).toBe(3);
    expect(r.json.separacao.resumo).toMatchObject({ aDevolver: 0, prestado: true });
    expect((await fila()).json.find((o: any) => o.id === os.id)).toBeUndefined();
    // Desfazer: volta a SEPARADO (o consumo nunca foi informado) e a OS volta à fila
    const d = await desfazer(os.id, materiais.fita);
    expect(d.status).toBe(200);
    expect(await material(materiais.fita)).toMatchObject({ estadoSeparacao: "SEPARADO", devolvidoPorId: null });
    expect(await saldo("fita")).toBe(inicial - 3);
    expect((await fila()).json.find((o: any) => o.id === os.id)).toBeTruthy();
    await devolver(os.id, [materiais.fita]);
  });

  it("desfazer a devolução: DEVOLUCAO (−) no razão, estado volta a CONSUMIDO, a sobra fica pendente de novo; razão só cresce; regras: separado de OS viva recusa, já devolvido recusa, outra OS, repetido, item devolvido não se edita", async () => {
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo", "m", 4], ["cap", "Cap", "un", 1]]);
    await separarMateriais("e1", os.id, "u1", [{ id: materiais.tubo, quantidade: 4 }, { id: materiais.cap, quantidade: 1 }]);
    await consumirMateriais("e1", os.id, "u4", [{ id: materiais.tubo, quantidade: 1 }]); // sobra 3; cap sem consumo
    expect((await devolver(os.id, [materiais.cap])).json).toMatchObject({ erro: expect.stringMatching(/Cap: Informe o consumo antes/) });
    expect((await devolver(os.id, [materiais.tubo, materiais.cap])).status).toBe(400); // tudo ou nada
    expect(await material(materiais.tubo)).toMatchObject({ estadoSeparacao: "CONSUMIDO" });
    expect((await devolver(os.id, [materiais.tubo, materiais.tubo])).json).toMatchObject({ erro: "Material repetido no pedido." });
    // Material de OUTRA OS (da mesma empresa) pelo id desta: recusado, nada muda
    const outraOs = await novaOs();
    const outra = await itemComMateriais(outraOs.id, [["cap", "Cap da outra", "un", 1]]);
    await separarEConsumir(outraOs.id, outra.materiais, { cap: 1 }, { cap: 0 });
    expect((await devolver(os.id, [outra.materiais.cap])).json).toMatchObject({ erro: "Material não pertence a esta OS." });
    expect((await desfazer(os.id, outra.materiais.cap)).json).toMatchObject({ erro: "Material não pertence a esta OS." });
    expect(await material(outra.materiais.cap)).toMatchObject({ estadoSeparacao: "CONSUMIDO" });
    const saldoAntes = await saldo("tubo");
    expect((await devolver(os.id, [materiais.tubo])).status).toBe(200);
    expect(await saldo("tubo")).toBe(saldoAntes + 3);
    expect((await devolver(os.id, [materiais.tubo])).json).toMatchObject({ erro: expect.stringMatching(/já feita/) });
    // Item com material devolvido não se edita nem apaga
    const item = await prisma.osItemOrcamento.findFirst({ where: { ordemServicoId: os.id } });
    expect((await chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: os.id, itemId: item.id })).status).toBe(400);
    // Desfazer
    const antes = await prisma.movimentacaoEstoque.count();
    const d = await desfazer(os.id, materiais.tubo);
    expect(d.status).toBe(200);
    const est = await prisma.movimentacaoEstoque.findFirst({ where: { produtoId: "tubo", tipo: "DEVOLUCAO", quantidade: { lt: 0 }, refId: os.id } });
    expect(est).toMatchObject({ observacao: `Devolução desfeita — OS OSD-${seq - 1} · Tubo` });
    expect(Number(est.quantidade)).toBe(-3);
    expect(await saldo("tubo")).toBe(saldoAntes);
    expect(await prisma.movimentacaoEstoque.count()).toBe(antes + 1);
    expect(await material(materiais.tubo)).toMatchObject({ estadoSeparacao: "CONSUMIDO", devolvidoEm: null, devolvidoPorId: null });
    expect(Number((await material(materiais.tubo)).quantidadeDevolvida)).toBe(0);
    expect(d.json.separacao.materiais[0]).toMatchObject({ situacao: "consumido", pendenteDevolucao: 3, aDevolver: 3 });
    expect((await prisma.osHistorico.findFirst({ where: { ordemServicoId: os.id, acao: "Devolução de material desfeita" } })).detalhes).toBe("Tubo: 3 m");
    expect((await desfazer(os.id, materiais.tubo)).json).toMatchObject({ erro: expect.stringMatching(/não feita/) });
    expect((await desfazer(os.id, "nao-existe")).json).toMatchObject({ erro: "Material não pertence a esta OS." });
    expect((await chamar("ordens/[id]/devolucao", "POST", { materiais: [materiais.tubo], extra: 1 }, { id: os.id })).status).toBe(400);
    expect((await devolver("nao-existe", [materiais.tubo])).status).toBe(404);
    for (const p of ["tubo", "cap", "fita"]) expect(await saldo(p)).toBe(await somaRazao(p));
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: "AJUSTE" } })).toBe(0);
  });

  it("concorrência: 10 OS devolvendo a sobra do mesmo produto ao mesmo tempo (a linha do produto trava): nada se perde, saldo = soma do razão", async () => {
    const inicial = await saldo("fita");
    const oss: { osId: string; mId: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const os = await novaOs({ descricao: `Concorrente ${i}` });
      const { materiais } = await itemComMateriais(os.id, [["fita", "Fita", "un", 2]]);
      await separarEConsumir(os.id, materiais, { fita: 2 }, { fita: 1 }); // sobra 1 cada
      oss.push({ osId: os.id, mId: materiais.fita });
    }
    expect(await saldo("fita")).toBe(inicial - 20);
    const rs = await Promise.all(oss.map((o) => devolver(o.osId, [o.mId])));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await saldo("fita")).toBe(inicial - 10); // sobrou só o consumido (1 por OS)
    expect(await somaRazao("fita")).toBe(inicial - 10);
    expect(await prisma.movimentacaoEstoque.count({ where: { produtoId: "fita", tipo: "DEVOLUCAO", refId: { in: oss.map((o) => o.osId) } } })).toBe(10);
    expect(await prisma.osMaterial.count({ where: { id: { in: oss.map((o) => o.mId) }, estadoSeparacao: "DEVOLVIDO", quantidadeDevolvida: 1 } })).toBe(10);
    expect((await fila()).json.some((o: any) => oss.some((x) => x.osId === o.id))).toBe(false);
  }, 120_000);
});
