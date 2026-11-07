/**
 * Estoque E4.1 — separação + reserva de material num PostgreSQL real, com o Prisma real e as rotas de verdade:
 *  - a fila "A separar": OS com material entra sozinha, sem material não, de outra empresa não; sai quando tudo foi
 *    separado; 403 sem a permissão; o sino conta a fila só para quem tem "Estoque › Separar material";
 *  - separar: RESERVA no razão (origem OS, ref_id = OS, quem) tirando do disponível; estado por material (quantidade,
 *    estado, quem, quando); parcial continua na fila e dá para completar; saldo que não cobre avisa e NÃO trava;
 *  - desfazer: estorno (RESERVA +), saldo volta, estado some, OS volta à fila; o razão nunca é editado;
 *  - regras: acima do necessário / material de outra OS / repetido = 400; OS de outra empresa = 404; item com material
 *    separado não se edita nem apaga; material CONSUMIDO (E4.2) não muda; OS concluída/cancelada fora da fila;
 *  - concorrência: separações simultâneas do mesmo produto não se perdem (a linha do produto trava).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/estoque-e41-separacao-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_e41_separacao_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O sino (/api/alertas) agenda a reconciliação das NFS-e com after(), que só existe numa requisição do Next
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const SEPARADOR = montarPermissoes({ estoque: ["separar"] });
const SO_VE_ESTOQUE = montarPermissoes({ estoque: ["visualizar"], ordens: ["visualizar", "editar"] });
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
const fila = () => chamar("estoque/separacao", "GET");
const sino = () => chamar("alertas", "GET");
const verOs = (id: string) => chamar("ordens/[id]/separacao", "GET", undefined, { id });
const separar = (id: string, materiais: { id: string; quantidade: number }[]) => chamar("ordens/[id]/separacao", "POST", { materiais }, { id });

describe.skipIf(!URL_PG)("Separação + reserva de material (PostgreSQL real)", () => {
  let prisma: any;
  const ids: Record<string, string> = {};
  let seq = 0;
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSA-${++seq}`, clienteId: "c1", criadoPorId: "u1", status: "ABERTA", origem: "MANUAL", descricao: "Instalação de split", ...dados } });
  /** Item de serviço com o snapshot de materiais (como a E3.3b grava) */
  async function itemComMateriais(osId: string, materiais: [produtoId: string, descricao: string, unidade: string, quantidade: number, comportamento?: string][]) {
    const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: osId, tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorBase: 800 } });
    const criados: Record<string, string> = {};
    for (const [i, [produtoId, descricao, unidade, quantidade, comportamento]] of materiais.entries()) {
      const m = await prisma.osMaterial.create({ data: { ordemServicoId: osId, osItemId: item.id, produtoId, descricao, unidade, comportamento: comportamento ?? "INCLUSO_NO_SERVICO", quantidade, quantidadePadrao: quantidade, valorVendaUnit: 10, origem: "SOLTO", ordem: i } });
      criados[produtoId] = m.id;
    }
    return { itemId: item.id, materiais: criados };
  }
  const saldo = async (produtoId: string) => Number((await prisma.produto.findUnique({ where: { id: produtoId } })).saldo);
  const somaRazao = async (produtoId: string) => Number((await prisma.movimentacaoEstoque.aggregate({ where: { produtoId }, _sum: { quantidade: true } }))._sum.quantidade ?? 0);
  const material = (id: string) => prisma.osMaterial.findUnique({ where: { id } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["estoque/separacao", "ordens/[id]/separacao", "ordens/[id]/orcamento/[itemId]", "alertas"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u3", empresaId: "e1", nome: "Zé do Almoxarifado", email: "z@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } }).catch(() => {});
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" }] });
    const p = (id: string, nome: string, unidade: string, empresaId = "e1") => prisma.produto.create({ data: { id, empresaId, nome, unidade } });
    await p("tubo", "Tubo de cobre 1/4", "m"); await p("cap", "Capacitor 35uF", "un"); await p("filtro", "Filtro secador", "un"); await p("fita", "Fita", "un"); await p("outro", "Da outra", "un", "e2");
    await prisma.servico.createMany({ data: [{ id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800 }, { id: "sOutra", empresaId: "e2", codigo: "X01", nome: "Da outra", valorPadrao: 1 }] });
    const { movimentar } = await import("@/lib/estoque/servidor");
    await movimentar({ empresaId: "e1", produtoId: "tubo", operacao: "ENTRADA", valor: 10, custoUnitario: 12 });
    await movimentar({ empresaId: "e1", produtoId: "cap", operacao: "ENTRADA", valor: 1, custoUnitario: 45 });
    await movimentar({ empresaId: "e1", produtoId: "fita", operacao: "ENTRADA", valor: 50 });
    // filtro: saldo 0 (nunca entrou)
    ids.os = (await novaOs({ previsaoConclusao: new Date("2026-12-01T12:00:00Z") })).id;
    const { itemId, materiais } = await itemComMateriais(ids.os, [["tubo", "Tubo de cobre 1/4", "m", 5], ["cap", "Capacitor 35uF", "un", 1, "VENDA_A_PARTE"], ["filtro", "Filtro secador", "un", 2]]);
    ids.item = itemId; Object.assign(ids, { mTubo: materiais.tubo, mCap: materiais.cap, mFiltro: materiais.filtro });
    ids.osVazia = (await novaOs({ descricao: "Visita técnica" })).id;
    ids.osOutra = (await prisma.ordemServico.create({ data: { empresaId: "e2", numero: "OS-X", clienteId: "c9", criadoPorId: "u2", status: "ABERTA", origem: "MANUAL", descricao: "x" } })).id;
    const o = await prisma.osItemOrcamento.create({ data: { ordemServicoId: ids.osOutra, tipo: "SERVICO", servicoId: "sOutra", descricao: "Da outra", quantidade: 1, valorUnitario: 1, valorTotal: 1 } });
    ids.mOutra = (await prisma.osMaterial.create({ data: { ordemServicoId: ids.osOutra, osItemId: o.id, produtoId: "outro", descricao: "Da outra", unidade: "un", comportamento: "INCLUSO_NO_SERVICO", quantidade: 1, quantidadePadrao: 1, valorVendaUnit: 1, origem: "SOLTO" } })).id;
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("fila: a OS com material entra sozinha (3 de 3 a separar), a sem material e a de outra empresa não; 403 sem a permissão; o sino conta a fila só para quem separa", async () => {
    logar(SEPARADOR);
    const r = await fila();
    expect(r.status).toBe(200);
    expect(r.json.map((o: any) => o.id)).toEqual([ids.os]);
    expect(r.json[0]).toMatchObject({ numero: "OSA-1", cliente: "Hospital", aSeparar: 3, total: 3, parciais: 0, status: "ABERTA" });
    expect(r.json[0].faltam).toEqual([{ descricao: "Tubo de cobre 1/4", falta: 5, unidade: "m" }, { descricao: "Capacitor 35uF", falta: 1, unidade: "un" }, { descricao: "Filtro secador", falta: 2, unidade: "un" }]);
    // A tela de uma OS: materiais com o saldo disponível
    const os = await verOs(ids.os);
    expect(os.status).toBe(200);
    expect(os.json.os).toMatchObject({ id: ids.os, numero: "OSA-1", cliente: "Hospital" });
    expect(os.json.materiais.map((m: any) => [m.produtoId, m.quantidade, m.quantidadeSeparada, m.falta, m.saldo, m.situacao, m.comportamento])).toEqual([
      ["tubo", 5, 0, 5, 10, "pendente", "INCLUSO_NO_SERVICO"], ["cap", 1, 0, 1, 1, "pendente", "VENDA_A_PARTE"], ["filtro", 2, 0, 2, 0, "pendente", "INCLUSO_NO_SERVICO"],
    ]);
    expect(os.json.resumo).toMatchObject({ total: 3, aSeparar: 3, situacao: "pendente", prestacaoPendente: false });
    expect((await verOs(ids.osVazia)).json.resumo.situacao).toBe("sem-material");
    expect((await verOs(ids.osOutra)).status).toBe(404);
    // Sino: a OS na fila só para quem tem "Estoque › Separar material"
    expect((await sino()).json).toMatchObject({ separacoesPendentes: 1 });
    logar(SO_VE_ESTOQUE);
    expect((await fila()).status).toBe(403);
    expect((await verOs(ids.os)).status).toBe(403);
    expect((await separar(ids.os, [{ id: ids.mTubo, quantidade: 1 }])).status).toBe(403);
    expect((await sino()).json).toMatchObject({ separacoesPendentes: 0 });
    // Outra empresa não vê a OS da e1
    logar(permissoesTotais(), "e2", "u2");
    expect((await fila()).json.map((o: any) => o.id)).toEqual([ids.osOutra]);
    expect((await verOs(ids.os)).status).toBe(404);
    logar();
  });

  it("separar: RESERVA no razão (origem OS, ref_id = OS, quem) tira do disponível; estado por material (quantidade, estado, quem, quando); parcial continua na fila e completa depois; saldo que não cobre avisa e não trava; tudo separado sai da fila", async () => {
    logar(montarPermissoes({ estoque: ["separar"] }), "e1", "u3");
    const r = await separar(ids.os, [{ id: ids.mTubo, quantidade: 5 }, { id: ids.mCap, quantidade: 1 }]);
    expect(r.json?.erro ?? r.status).toBe(200);
    expect(r.json.avisos).toEqual([]);
    expect(r.json.movimentos).toBe(2);
    // O razão: uma RESERVA por material, vinculada à OS
    const movs = await prisma.movimentacaoEstoque.findMany({ where: { tipo: "RESERVA" }, orderBy: { produtoId: "asc" } });
    expect(movs.map((m: any) => [m.produtoId, m.origem, Number(m.quantidade), Number(m.saldoApos), m.refId, m.usuarioId])).toEqual([["cap", "OS", -1, 0, ids.os, "u3"], ["tubo", "OS", -5, 5, ids.os, "u3"]]);
    expect(movs[1].observacao).toBe("Separação — OS OSA-1 · Tubo de cobre 1/4");
    expect(await saldo("tubo")).toBe(5);
    expect(await saldo("cap")).toBe(0);
    // O estado por material
    const tubo = await material(ids.mTubo);
    expect(tubo).toMatchObject({ estadoSeparacao: "SEPARADO", separadoPorId: "u3" });
    expect(Number(tubo.quantidadeSeparada)).toBe(5);
    expect(tubo.separadoEm).toBeInstanceOf(Date);
    expect(await material(ids.mFiltro)).toMatchObject({ estadoSeparacao: null, separadoPorId: null, separadoEm: null });
    // A resposta já traz a tela nova: parcial (falta o filtro), prestação de contas pendente
    expect(r.json.separacao.materiais.map((m: any) => [m.produtoId, m.quantidadeSeparada, m.situacao, m.separadoPor])).toEqual([["tubo", 5, "separado", "Zé do Almoxarifado"], ["cap", 1, "separado", "Zé do Almoxarifado"], ["filtro", 0, "pendente", null]]);
    expect(r.json.separacao.resumo).toMatchObject({ aSeparar: 1, separados: 2, pendentes: 1, situacao: "parcial", prestacaoPendente: true });
    expect((await fila()).json.map((o: any) => [o.id, o.aSeparar, o.total])).toEqual([[ids.os, 1, 3]]);
    expect((await prisma.osHistorico.findMany({ where: { ordemServicoId: ids.os } })).map((h: any) => [h.acao, h.usuarioId, h.detalhes])).toEqual([["Material separado", "u3", "Capacitor 35uF: 1 un; Tubo de cobre 1/4: 5 m"]]);
    // Filtro: saldo 0, separa 1 de 2 → avisa (saldo negativo), registra mesmo assim; a OS continua na fila (em parte)
    const f = await separar(ids.os, [{ id: ids.mFiltro, quantidade: 1 }]);
    expect(f.status).toBe(200);
    expect(f.json.avisos).toEqual(["Filtro secador: Atenção: o saldo ficou negativo (-1 un). O lançamento foi feito; confira as entradas."]);
    expect(await saldo("filtro")).toBe(-1);
    expect(f.json.separacao.materiais[2]).toMatchObject({ quantidadeSeparada: 1, falta: 1, situacao: "parcial" });
    expect(f.json.separacao.resumo).toMatchObject({ aSeparar: 1, parciais: 1, situacao: "parcial" });
    expect((await fila()).json.map((o: any) => [o.id, o.aSeparar, o.parciais, o.faltam])).toEqual([[ids.os, 1, 1, [{ descricao: "Filtro secador", falta: 1, unidade: "un" }]]]);
    expect((await sino()).json.separacoesPendentes).toBe(1);
    // Completar: alvo 2 → mais uma RESERVA de 1; tudo separado → sai da fila e do sino
    const c = await separar(ids.os, [{ id: ids.mFiltro, quantidade: 2 }]);
    expect(c.json.movimentos).toBe(1);
    expect((await prisma.movimentacaoEstoque.findMany({ where: { produtoId: "filtro" }, orderBy: { criadoEm: "asc" } })).map((m: any) => Number(m.quantidade))).toEqual([-1, -1]);
    expect(await saldo("filtro")).toBe(-2);
    expect(c.json.separacao.resumo).toMatchObject({ aSeparar: 0, separados: 3, situacao: "completa", prestacaoPendente: true });
    expect((await fila()).json).toEqual([]);
    expect((await sino()).json.separacoesPendentes).toBe(0);
    // Alvo igual ao atual: nada muda (sem movimento, sem histórico novo)
    const n = await prisma.osHistorico.count({ where: { ordemServicoId: ids.os } });
    expect((await separar(ids.os, [{ id: ids.mTubo, quantidade: 5 }])).json.movimentos).toBe(0);
    expect(await prisma.osHistorico.count({ where: { ordemServicoId: ids.os } })).toBe(n);
    logar();
  });

  it("desfazer: estorno (RESERVA +) vinculado à OS, saldo volta, estado some, a OS volta à fila; o razão só cresce (nada apagado); baixar o alvo estorna só a diferença", async () => {
    const antes = await prisma.movimentacaoEstoque.count();
    const r = await separar(ids.os, [{ id: ids.mCap, quantidade: 0 }]);
    expect(r.status).toBe(200);
    const est = await prisma.movimentacaoEstoque.findFirst({ where: { produtoId: "cap", quantidade: { gt: 0 }, tipo: "RESERVA" } });
    expect(est).toMatchObject({ origem: "OS", refId: ids.os, usuarioId: "u1", observacao: "Separação desfeita — OS OSA-1 · Capacitor 35uF" });
    expect(Number(est.quantidade)).toBe(1);
    expect(await saldo("cap")).toBe(1);
    expect(await prisma.movimentacaoEstoque.count()).toBe(antes + 1);
    expect(await material(ids.mCap)).toMatchObject({ estadoSeparacao: null, separadoPorId: null, separadoEm: null });
    expect(Number((await material(ids.mCap)).quantidadeSeparada)).toBe(0);
    expect(r.json.separacao.resumo).toMatchObject({ aSeparar: 1, situacao: "parcial", prestacaoPendente: true });
    expect((await fila()).json.map((o: any) => [o.id, o.aSeparar])).toEqual([[ids.os, 1]]);
    expect((await prisma.osHistorico.findFirst({ where: { ordemServicoId: ids.os }, orderBy: { criadoEm: "desc" } })).acao).toBe("Separação de material desfeita");
    // Baixar o alvo do tubo de 5 para 2: estorna 3, continua SEPARADO (em parte)
    const b = await separar(ids.os, [{ id: ids.mTubo, quantidade: 2 }]);
    expect(b.json.movimentos).toBe(1);
    expect(await saldo("tubo")).toBe(8);
    expect(b.json.separacao.materiais[0]).toMatchObject({ quantidadeSeparada: 2, falta: 3, situacao: "parcial" });
    expect(await saldo("tubo")).toBe(await somaRazao("tubo"));
  });

  it("regras: acima do necessário, material de outra OS, repetido e corpo estranho = 400 (nada muda); OS de outra empresa = 404; item com material separado não se edita nem apaga; depois de desfazer tudo, apaga", async () => {
    const saldoTubo = await saldo("tubo"), movs = await prisma.movimentacaoEstoque.count();
    expect((await separar(ids.os, [{ id: ids.mTubo, quantidade: 6 }])).json).toMatchObject({ erro: expect.stringMatching(/mais do que o necessário \(5 m\)/) });
    expect((await separar(ids.os, [{ id: ids.mOutra, quantidade: 1 }])).json).toMatchObject({ erro: "Material não pertence a esta OS." });
    expect((await separar(ids.os, [{ id: ids.mTubo, quantidade: 3 }, { id: ids.mOutra, quantidade: 1 }])).status).toBe(400); // tudo ou nada
    expect((await separar(ids.os, [{ id: ids.mTubo, quantidade: 3 }, { id: ids.mTubo, quantidade: 4 }])).json).toMatchObject({ erro: "Material repetido no pedido." });
    expect((await chamar("ordens/[id]/separacao", "POST", { materiais: [{ id: ids.mTubo, quantidade: 1, extra: 1 }] }, { id: ids.os })).json).toMatchObject({ erro: "Campo não permitido: extra." });
    expect((await chamar("ordens/[id]/separacao", "POST", { materiais: [] }, { id: ids.os })).status).toBe(400);
    expect((await separar(ids.osOutra, [{ id: ids.mOutra, quantidade: 1 }])).status).toBe(404);
    expect((await separar("nao-existe", [{ id: ids.mTubo, quantidade: 1 }])).status).toBe(404);
    expect(await saldo("tubo")).toBe(saldoTubo);
    expect(await prisma.movimentacaoEstoque.count()).toBe(movs);
    expect(await material(ids.mOutra)).toMatchObject({ estadoSeparacao: null });
    // O item com material separado (reservado) não se edita nem apaga: a reserva ficaria órfã
    const editar = (corpo: unknown) => chamar("ordens/[id]/orcamento/[itemId]", "PUT", corpo, { id: ids.os, itemId: ids.item });
    const apagar = () => chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: ids.os, itemId: ids.item });
    expect((await editar({ quantidade: 2, valorUnitario: 800 })).json).toMatchObject({ erro: expect.stringMatching(/Há material separado para este item/) });
    expect((await apagar()).json).toMatchObject({ erro: expect.stringMatching(/Há material separado para este item/) });
    expect(await prisma.osMaterial.count({ where: { osItemId: ids.item } })).toBe(3);
    // Marcar executado continua igual
    expect((await editar({ executado: true })).status).toBe(200);
    // Desfaz tudo → saldos voltam ao início (10 / 1 / 0) → o item pode ser apagado
    expect((await separar(ids.os, [{ id: ids.mTubo, quantidade: 0 }, { id: ids.mFiltro, quantidade: 0 }])).status).toBe(200);
    expect([await saldo("tubo"), await saldo("cap"), await saldo("filtro")]).toEqual([10, 1, 0]);
    expect((await fila()).json.map((o: any) => [o.id, o.aSeparar])).toEqual([[ids.os, 3]]);
    expect((await apagar()).status).toBe(200);
    expect(await prisma.osMaterial.count({ where: { ordemServicoId: ids.os } })).toBe(0);
    expect((await fila()).json).toEqual([]);
    // Nada ficou reservado para a OS no razão (soma das RESERVAs da OS = 0), e o razão continua íntegro
    const reservas = await prisma.movimentacaoEstoque.aggregate({ where: { tipo: "RESERVA", refId: ids.os }, _sum: { quantidade: true } });
    expect(Number(reservas._sum.quantidade)).toBe(0);
    for (const p of ["tubo", "cap", "filtro"]) expect(await saldo(p)).toBe(await somaRazao(p));
  });

  it("nesta leva não há consumo/devolução nem amarras: material CONSUMIDO não muda pela separação e não puxa a OS para a fila; OS concluída/cancelada fica fora da fila (estado continua visível)", async () => {
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo", "m", 1], ["cap", "Capacitor", "un", 1, "VENDA_A_PARTE"]]);
    await prisma.osMaterial.update({ where: { id: materiais.cap }, data: { estadoSeparacao: "CONSUMIDO", quantidadeSeparada: 1 } }); // como a E4.2 vai deixar
    expect((await fila()).json.map((o: any) => [o.id, o.aSeparar, o.total])).toEqual([[os.id, 1, 1]]);
    expect((await separar(os.id, [{ id: materiais.cap, quantidade: 0 }])).json).toMatchObject({ erro: expect.stringMatching(/já consumido/) });
    const tela = (await verOs(os.id)).json;
    expect(tela.materiais.map((m: any) => m.situacao)).toEqual(["pendente", "consumido"]);
    expect(tela.resumo).toMatchObject({ situacao: "parcial", prestacaoPendente: false });
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CONCLUIDA" } });
    expect((await fila()).json).toEqual([]);
    expect((await sino()).json.separacoesPendentes).toBe(0);
    expect((await verOs(os.id)).json.resumo).toMatchObject({ aSeparar: 1 }); // o estado continua lá
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CANCELADA" } });
    expect((await fila()).json).toEqual([]);
    // Nenhuma SAIDA/DEVOLUCAO foi gerada por esta leva
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: { in: ["SAIDA", "DEVOLUCAO"] } } })).toBe(0);
  });

  it("concorrência: 12 OS separando o mesmo produto ao mesmo tempo (a linha do produto trava): nenhuma reserva se perde, saldo = soma do razão = 50 − 12, e cada material ficou separado", async () => {
    const oss: { osId: string; mId: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const os = await novaOs({ descricao: `Concorrente ${i}` });
      const { materiais } = await itemComMateriais(os.id, [["fita", "Fita", "un", 1]]);
      oss.push({ osId: os.id, mId: materiais.fita });
    }
    const rs = await Promise.all(oss.map((o) => separar(o.osId, [{ id: o.mId, quantidade: 1 }])));
    expect(rs.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(await saldo("fita")).toBe(38);
    expect(await somaRazao("fita")).toBe(38);
    const movs = await prisma.movimentacaoEstoque.findMany({ where: { produtoId: "fita", tipo: "RESERVA" } });
    expect(movs).toHaveLength(12);
    // Serializados pela trava: os "saldo após" são 49, 48, …, 38 — cada um distinto
    expect(movs.map((m: any) => Number(m.saldoApos)).sort((a: number, b: number) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => 38 + i));
    expect(await prisma.osMaterial.count({ where: { id: { in: oss.map((o) => o.mId) }, estadoSeparacao: "SEPARADO", quantidadeSeparada: 1 } })).toBe(12);
    expect((await fila()).json.some((o: any) => oss.some((x) => x.osId === o.id))).toBe(false);
  }, 120_000);
});
