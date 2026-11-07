/**
 * Estoque E4.2 — consumo de material + Portão 1 num PostgreSQL real, com o Prisma real e as rotas de verdade:
 *  - consumo = separado: estorno da RESERVA + SAIDA (líquido zero: o material já tinha saído na separação); SAIDA só do
 *    consumido (sem dupla contagem); saldo final = inicial − consumido − sobra reservada; o razão só cresce;
 *  - consumo menor: a sobra fica reservada, "pendente de devolução"; maior: SAIDA a mais com aviso de saldo;
 *  - estado por material (CONSUMIDO, quantidade, quem, quando) e histórico da OS;
 *  - Portão 1: amarra LIGADA trava a conclusão manual (422 com o que falta) e a automática (fica Em andamento) até o
 *    consumo ser informado — que destrava na hora; DESLIGADA: conclui, só avisa (central);
 *  - desfazer: SAIDA + e RESERVA − (volta à reserva), estado SEPARADO; OS finalizada não desfaz; cancelada não consome;
 *  - regras: outra OS / outra empresa / repetido / já informado / nada a baixar / 403; item com material consumido não
 *    se edita; concorrência: consumos simultâneos do mesmo produto não se perdem.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/estoque-e42-consumo-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_e42_consumo_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
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
const consumir = (id: string, materiais: { id: string; quantidade: number }[]) => chamar("ordens/[id]/consumo", "POST", { materiais }, { id });
const desfazer = (id: string, materialId: string) => chamar("ordens/[id]/consumo", "DELETE", { id: materialId }, { id });
const concluir = (id: string) => chamar("ordens/[id]", "PUT", { status: "CONCLUIDA" }, { id });

describe.skipIf(!URL_PG)("Consumo de material + Portão 1 (PostgreSQL real)", () => {
  let prisma: any;
  let separarMateriais: typeof import("@/lib/estoque/separacao-server").separarMateriais;
  let sincronizarStatusOs: typeof import("@/lib/os/sincronizar-status").sincronizarStatusOs;
  let seq = 0;
  /** OS recorrente sem equipamento (dispensa a trava de equipamento) com uma atividade já concluída: o automático diz "Concluída" */
  const novaOs = async (dados: Record<string, unknown> = {}, atividade = "CONCLUIDA") => {
    const os = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSC-${++seq}`, clienteId: "c1", criadoPorId: "u1", status: "EM_ANDAMENTO", origem: "RECORRENTE", descricao: "Preventiva", ...dados } });
    await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Preventiva", status: atividade } });
    return os;
  };
  async function itemComMateriais(osId: string, materiais: [produtoId: string, descricao: string, unidade: string, quantidade: number][]) {
    const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: osId, tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorBase: 800 } });
    const criados: Record<string, string> = {};
    for (const [i, [produtoId, descricao, unidade, quantidade]] of materiais.entries()) {
      const m = await prisma.osMaterial.create({ data: { ordemServicoId: osId, osItemId: item.id, produtoId, descricao, unidade, comportamento: "INCLUSO_NO_SERVICO", quantidade, quantidadePadrao: quantidade, valorVendaUnit: 10, origem: "SOLTO", ordem: i } });
      criados[produtoId] = m.id;
    }
    return { itemId: item.id, materiais: criados };
  }
  const saldo = async (produtoId: string) => Number((await prisma.produto.findUnique({ where: { id: produtoId } })).saldo);
  const somaRazao = async (produtoId: string, where: Record<string, unknown> = {}) => Number((await prisma.movimentacaoEstoque.aggregate({ where: { produtoId, ...where }, _sum: { quantidade: true } }))._sum.quantidade ?? 0);
  const material = (id: string) => prisma.osMaterial.findUnique({ where: { id } });
  const amarra = (ligada: boolean) => prisma.configuracao.update({ where: { empresaId: "e1" }, data: { osExigirPrestacaoMaterial: ligada } });
  const status = async (osId: string) => (await prisma.ordemServico.findUnique({ where: { id: osId } })).status;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ separarMateriais } = await import("@/lib/estoque/separacao-server"));
    ({ sincronizarStatusOs } = await import("@/lib/os/sincronizar-status"));
    await Promise.all(["ordens/[id]/consumo", "ordens/[id]", "ordens/[id]/orcamento/[itemId]", "configuracoes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u4", empresaId: "e1", nome: "Carlos Técnico", email: "c@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "22101333000111" }, { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100" }] });
    const p = (id: string, nome: string, unidade: string, empresaId = "e1") => prisma.produto.create({ data: { id, empresaId, nome, unidade } });
    await p("tubo", "Tubo de cobre 1/4", "m"); await p("cap", "Capacitor 35uF", "un"); await p("filtro", "Filtro secador", "un"); await p("fita", "Fita", "un"); await p("outro", "Da outra", "un", "e2");
    await prisma.servico.createMany({ data: [{ id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800 }, { id: "sOutra", empresaId: "e2", codigo: "X01", nome: "Da outra", valorPadrao: 1 }] });
    const { movimentar } = await import("@/lib/estoque/servidor");
    await movimentar({ empresaId: "e1", produtoId: "tubo", operacao: "ENTRADA", valor: 10, custoUnitario: 12 });
    await movimentar({ empresaId: "e1", produtoId: "cap", operacao: "ENTRADA", valor: 1, custoUnitario: 45 });
    await movimentar({ empresaId: "e1", produtoId: "fita", operacao: "ENTRADA", valor: 50 });
    logar();
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("consumo = separado: estorno da RESERVA + SAIDA (líquido zero), SAIDA só do consumido, saldo = inicial − consumido, razão só cresce; estado CONSUMIDO com quem/quando; histórico; nada pendente de prestação", async () => {
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo de cobre 1/4", "m", 5]]);
    await separarMateriais("e1", os.id, "u1", [{ id: materiais.tubo, quantidade: 5 }]);
    expect(await saldo("tubo")).toBe(5); // 10 − 5 reservados
    const movsAntes = await prisma.movimentacaoEstoque.count();
    logar(montarPermissoes({ ordens: ["visualizar", "concluir"] }), "e1", "u4"); // quem só conclui OS também informa o consumo
    const r = await consumir(os.id, [{ id: materiais.tubo, quantidade: 5 }]);
    expect(r.json?.erro ?? r.status).toBe(200);
    expect(r.json).toMatchObject({ avisos: [], movimentos: 2 });
    const movs = await prisma.movimentacaoEstoque.findMany({ where: { produtoId: "tubo", refId: os.id }, orderBy: { criadoEm: "asc" } });
    expect(movs.map((m: any) => [m.tipo, m.origem, Number(m.quantidade), Number(m.saldoApos), m.usuarioId])).toEqual([["RESERVA", "OS", -5, 5, "u1"], ["RESERVA", "OS", 5, 10, "u4"], ["SAIDA", "OS", -5, 5, "u4"]]);
    expect(movs[1].observacao).toBe("Consumo — OS OSC-1 · Tubo de cobre 1/4 (reserva convertida em saída)");
    expect(movs[2].observacao).toBe("Consumo — OS OSC-1 · Tubo de cobre 1/4");
    // Invariantes: saldo = inicial − consumido; SAIDA = exatamente o consumido; nenhuma reserva sobrou para a OS; o razão só cresceu
    expect(await saldo("tubo")).toBe(5);
    expect(await somaRazao("tubo")).toBe(5);
    expect(await somaRazao("tubo", { tipo: "SAIDA" })).toBe(-5);
    expect(await somaRazao("tubo", { tipo: "RESERVA", refId: os.id })).toBe(0);
    expect(await prisma.movimentacaoEstoque.count()).toBe(movsAntes + 2);
    const m = await material(materiais.tubo);
    expect(m).toMatchObject({ estadoSeparacao: "CONSUMIDO", consumidoPorId: "u4" });
    expect([Number(m.quantidadeSeparada), Number(m.quantidadeConsumida)]).toEqual([5, 5]);
    expect(m.consumidoEm).toBeInstanceOf(Date);
    expect(r.json.separacao.materiais[0]).toMatchObject({ situacao: "consumido", quantidadeConsumida: 5, pendenteDevolucao: 0, consumidoPor: "Carlos Técnico" });
    expect(r.json.separacao.resumo).toMatchObject({ consumoPendente: 0, consumidos: 1, pendentesDevolucao: 0, prestacaoPendente: false });
    expect(await prisma.osHistorico.findFirst({ where: { ordemServicoId: os.id, acao: "Consumo de material informado" } })).toMatchObject({ usuarioId: "u4", detalhes: "Tubo de cobre 1/4: 5 m" });
    expect(await status(os.id)).toBe("CONCLUIDA"); // a atividade já estava concluída: com o consumo informado, a OS concluiu sozinha
    logar();
  });

  it("consumo menor: a sobra fica reservada (pendente de devolução); maior: SAIDA a mais com aviso de saldo; nunca baixa duas vezes", async () => {
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo de cobre 1/4", "m", 5], ["cap", "Capacitor 35uF", "un", 1]]);
    await separarMateriais("e1", os.id, "u1", [{ id: materiais.tubo, quantidade: 5 }, { id: materiais.cap, quantidade: 1 }]);
    expect([await saldo("tubo"), await saldo("cap")]).toEqual([0, 0]); // tubo: 5 restavam, 5 reservados; cap: 1 → 0
    const r = await consumir(os.id, [{ id: materiais.tubo, quantidade: 3 }, { id: materiais.cap, quantidade: 2 }]);
    expect(r.status).toBe(200);
    // Tubo: estorno 3 + saída 3 → saldo continua 0 (2 seguem reservados); capacitor: estorno 1 + saída 2 → saldo −1, aviso
    expect(r.json.avisos).toEqual(["Capacitor 35uF: Atenção: o saldo ficou negativo (-1 un). O lançamento foi feito; confira as entradas."]);
    expect(await saldo("tubo")).toBe(0);
    expect(await saldo("cap")).toBe(-1);
    expect(await somaRazao("tubo", { tipo: "SAIDA", refId: os.id })).toBe(-3);
    expect(await somaRazao("tubo", { tipo: "RESERVA", refId: os.id })).toBe(-2); // a sobra continua reservada
    expect(await somaRazao("cap", { tipo: "SAIDA", refId: os.id })).toBe(-2);
    expect(await somaRazao("cap", { tipo: "RESERVA", refId: os.id })).toBe(0);
    const tela = r.json.separacao;
    expect(tela.materiais.map((m: any) => [m.produtoId, m.quantidadeSeparada, m.quantidadeConsumida, m.pendenteDevolucao, m.situacao])).toEqual([["tubo", 5, 3, 2, "consumido"], ["cap", 1, 2, 0, "consumido"]]);
    expect(tela.resumo).toMatchObject({ consumoPendente: 0, consumidos: 2, pendentesDevolucao: 1, prestacaoPendente: true });
    expect((await prisma.osHistorico.findFirst({ where: { ordemServicoId: os.id, acao: "Consumo de material informado" } })).detalhes).toBe("Capacitor 35uF: 2 un; Tubo de cobre 1/4: 3 m (sobra 2 m pendente de devolução)");
    // Consumo já informado não se informa de novo (sem dupla baixa)
    const dup = await consumir(os.id, [{ id: materiais.tubo, quantidade: 3 }]);
    expect(dup.json).toMatchObject({ erro: expect.stringMatching(/já informado/) });
    expect(await somaRazao("tubo", { tipo: "SAIDA", refId: os.id })).toBe(-3);
    // Item com material consumido não se edita nem apaga
    const item = await prisma.osItemOrcamento.findFirst({ where: { ordemServicoId: os.id } });
    expect((await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { quantidade: 2 }, { id: os.id, itemId: item.id })).status).toBe(400);
    expect((await chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: os.id, itemId: item.id })).status).toBe(400);
    for (const p of ["tubo", "cap"]) expect(await saldo(p)).toBe(await somaRazao(p));
  });

  it("Portão 1: amarra LIGADA trava a conclusão manual (422 dizendo o que falta) e a automática (fica Em andamento); informar o consumo destrava na hora; DESLIGADA: conclui mesmo sem consumo (a central só avisa)", async () => {
    // A amarra entra pela configuração da empresa (a rota de Configurações aceita o campo)
    logar(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }));
    const cfg = await chamar("configuracoes", "PUT", { osExigirPrestacaoMaterial: true });
    expect(cfg.status).toBe(200);
    expect(cfg.json.osExigirPrestacaoMaterial).toBe(true);
    logar();
    const os = await novaOs();
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo de cobre 1/4", "m", 2], ["cap", "Capacitor 35uF", "un", 1]]);
    await separarMateriais("e1", os.id, "u1", [{ id: materiais.tubo, quantidade: 2 }]); // só o tubo foi separado
    // Automático: a atividade está concluída, mas o Portão 1 segura
    expect(await sincronizarStatusOs(os.id, "e1", "u1")).toBe("EM_ANDAMENTO");
    // Manual: 422 com o que falta
    const r = await concluir(os.id);
    expect(r.status).toBe(422);
    expect(r.json.erro).toBe("Para concluir a OS, falta: informar o consumo do material separado (Tubo de cobre 1/4 2 m) — aba Materiais & Compras.");
    expect(r.json.materiais).toBe("informar o consumo do material separado (Tubo de cobre 1/4 2 m) — aba Materiais & Compras");
    expect(await status(os.id)).toBe("EM_ANDAMENTO");
    // Informar o consumo destrava: o próprio POST recalcula o automático
    const c = await consumir(os.id, [{ id: materiais.tubo, quantidade: 2 }]);
    expect(c.status).toBe(200);
    expect(c.json.status).toBe("CONCLUIDA");
    expect(await status(os.id)).toBe("CONCLUIDA");
    expect((await prisma.osHistorico.findMany({ where: { ordemServicoId: os.id } })).map((h: any) => h.acao)).toContain("Status automático");
    // DESLIGADA (padrão): outra OS igual conclui sem o consumo
    await amarra(false);
    const os2 = await novaOs();
    const m2 = await itemComMateriais(os2.id, [["tubo", "Tubo de cobre 1/4", "m", 1]]);
    await separarMateriais("e1", os2.id, "u1", [{ id: m2.materiais.tubo, quantidade: 1 }]);
    expect(await sincronizarStatusOs(os2.id, "e1", "u1")).toBe("CONCLUIDA");
    // E a conclusão manual de uma OS com material separado também passa
    const os3 = await novaOs({ statusManual: true });
    const m3 = await itemComMateriais(os3.id, [["cap", "Capacitor 35uF", "un", 1]]);
    await separarMateriais("e1", os3.id, "u1", [{ id: m3.materiais.cap, quantidade: 1 }]);
    expect((await concluir(os3.id)).status).toBe(200);
    expect(await status(os3.id)).toBe("CONCLUIDA");
    // Com a amarra ligada de novo, a OS já concluída não volta atrás (o portão é na conclusão)
    await amarra(true);
    expect(await sincronizarStatusOs(os2.id, "e1", "u1")).toBe("CONCLUIDA");
    await amarra(false);
  });

  it("desfazer: SAIDA + (estorno) e RESERVA − (volta à reserva), estado SEPARADO, consumo zerado; OS finalizada não desfaz; cancelada não consome; o razão só cresce", async () => {
    const os = await novaOs({}, "EM_ANDAMENTO"); // atividade em andamento: a OS não conclui sozinha
    const { materiais } = await itemComMateriais(os.id, [["fita", "Fita", "un", 4]]);
    await separarMateriais("e1", os.id, "u1", [{ id: materiais.fita, quantidade: 4 }]);
    await consumir(os.id, [{ id: materiais.fita, quantidade: 6 }]); // 2 a mais
    expect(await saldo("fita")).toBe(44); // 50 − 6
    const antes = await prisma.movimentacaoEstoque.count();
    const r = await desfazer(os.id, materiais.fita);
    expect(r.json?.erro ?? r.status).toBe(200);
    expect(r.json.movimentos).toBe(2);
    const movs = await prisma.movimentacaoEstoque.findMany({ where: { produtoId: "fita", refId: os.id }, orderBy: { criadoEm: "asc" } });
    expect(movs.map((m: any) => [m.tipo, Number(m.quantidade)])).toEqual([["RESERVA", -4], ["RESERVA", 4], ["SAIDA", -6], ["SAIDA", 6], ["RESERVA", -4]]);
    expect(movs[3].observacao).toMatch(/^Consumo desfeito — OS OSC-\d+ · Fita$/);
    expect(await saldo("fita")).toBe(46); // 50 − 4 reservados de novo
    expect(await somaRazao("fita")).toBe(46);
    expect(await prisma.movimentacaoEstoque.count()).toBe(antes + 2);
    expect(await material(materiais.fita)).toMatchObject({ estadoSeparacao: "SEPARADO", consumidoPorId: null, consumidoEm: null });
    expect(Number((await material(materiais.fita)).quantidadeConsumida)).toBe(0);
    expect(r.json.separacao.resumo).toMatchObject({ consumoPendente: 1, prestacaoPendente: true });
    expect((await prisma.osHistorico.findMany({ where: { ordemServicoId: os.id }, orderBy: { criadoEm: "desc" } }))[0]).toMatchObject({ acao: "Consumo de material desfeito", detalhes: "Fita: 6 un" });
    expect((await desfazer(os.id, materiais.fita)).json).toMatchObject({ erro: expect.stringMatching(/não informado/) });
    // OS finalizada (concluída): não desfaz
    await consumir(os.id, [{ id: materiais.fita, quantidade: 4 }]);
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CONCLUIDA", statusManual: true } });
    expect((await desfazer(os.id, materiais.fita)).json).toMatchObject({ erro: "OS finalizada: o consumo não pode mais ser desfeito." });
    expect(await material(materiais.fita)).toMatchObject({ estadoSeparacao: "CONSUMIDO" });
    // Cancelada: não consome
    const osX = await novaOs({ status: "CANCELADA" });
    const mx = await itemComMateriais(osX.id, [["fita", "Fita", "un", 1]]);
    expect((await consumir(osX.id, [{ id: mx.materiais.fita, quantidade: 1 }])).json).toMatchObject({ erro: "OS cancelada: não há consumo a informar." });
  });

  it("regras: material de outra OS / repetido / nada a baixar / corpo estranho = 400; OS de outra empresa = 404; sem permissão 403; nada muda no razão", async () => {
    const os = await novaOs({}, "EM_ANDAMENTO");
    const { materiais } = await itemComMateriais(os.id, [["tubo", "Tubo", "m", 1]]);
    const osOutra = await prisma.ordemServico.create({ data: { empresaId: "e2", numero: "OS-X", clienteId: "c9", criadoPorId: "u2", status: "ABERTA", origem: "MANUAL", descricao: "x" } });
    const o = await prisma.osItemOrcamento.create({ data: { ordemServicoId: osOutra.id, tipo: "SERVICO", servicoId: "sOutra", descricao: "Da outra", quantidade: 1, valorUnitario: 1, valorTotal: 1 } });
    const mOutra = await prisma.osMaterial.create({ data: { ordemServicoId: osOutra.id, osItemId: o.id, produtoId: "outro", descricao: "Da outra", unidade: "un", comportamento: "INCLUSO_NO_SERVICO", quantidade: 1, quantidadePadrao: 1, valorVendaUnit: 1, origem: "SOLTO", quantidadeSeparada: 1, estadoSeparacao: "SEPARADO" } });
    const movs = await prisma.movimentacaoEstoque.count();
    expect((await consumir(os.id, [{ id: mOutra.id, quantidade: 1 }])).json).toMatchObject({ erro: "Material não pertence a esta OS." });
    expect((await consumir(os.id, [{ id: materiais.tubo, quantidade: 1 }, { id: materiais.tubo, quantidade: 1 }])).json).toMatchObject({ erro: "Material repetido no pedido." });
    expect((await consumir(os.id, [{ id: materiais.tubo, quantidade: 0 }])).json).toMatchObject({ erro: expect.stringMatching(/Nada a baixar/) });
    expect((await chamar("ordens/[id]/consumo", "POST", { materiais: [{ id: materiais.tubo, quantidade: 1, x: 1 }] }, { id: os.id })).status).toBe(400);
    expect((await consumir(osOutra.id, [{ id: mOutra.id, quantidade: 1 }])).status).toBe(404);
    expect((await desfazer(osOutra.id, mOutra.id)).status).toBe(404);
    expect((await chamar("ordens/[id]/consumo", "DELETE", {}, { id: os.id })).status).toBe(400);
    logar(montarPermissoes({ ordens: ["visualizar"], estoque: ["separar"] }));
    expect((await consumir(os.id, [{ id: materiais.tubo, quantidade: 1 }])).status).toBe(403);
    expect((await desfazer(os.id, materiais.tubo)).status).toBe(403);
    logar(permissoesTotais(), "e2", "u2");
    expect((await consumir(os.id, [{ id: materiais.tubo, quantidade: 1 }])).status).toBe(404);
    logar();
    expect(await prisma.movimentacaoEstoque.count()).toBe(movs);
    expect(await material(mOutra.id)).toMatchObject({ estadoSeparacao: "SEPARADO" });
    // Material nunca separado pode ter consumo informado: só SAIDA, sem estorno
    const c = await consumir(os.id, [{ id: materiais.tubo, quantidade: 1 }]);
    expect(c.json.movimentos).toBe(1);
    expect(await somaRazao("tubo", { refId: os.id })).toBe(-1);
    expect(c.json.separacao.materiais[0]).toMatchObject({ situacao: "consumido", quantidadeSeparada: 0, quantidadeConsumida: 1, pendenteDevolucao: 0 });
    // Consumido sem nunca ter sido separado: o item também não se edita nem apaga (a SAIDA ficaria órfã)
    const item = await prisma.osItemOrcamento.findFirst({ where: { ordemServicoId: os.id } });
    expect((await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { quantidade: 2 }, { id: os.id, itemId: item.id })).json).toMatchObject({ erro: expect.stringMatching(/separado ou consumido/) });
    expect((await chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: os.id, itemId: item.id })).status).toBe(400);
    expect(await prisma.osMaterial.count({ where: { ordemServicoId: os.id } })).toBe(1);
  });

  it("concorrência: 10 OS informando o consumo do mesmo produto ao mesmo tempo (a linha do produto trava): nada se perde, saldo = soma do razão, 10 SAIDAs", async () => {
    const inicial = await saldo("fita");
    const oss: { osId: string; mId: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const os = await novaOs({ descricao: `Concorrente ${i}` });
      const { materiais } = await itemComMateriais(os.id, [["fita", "Fita", "un", 1]]);
      await separarMateriais("e1", os.id, "u1", [{ id: materiais.fita, quantidade: 1 }]);
      oss.push({ osId: os.id, mId: materiais.fita });
    }
    expect(await saldo("fita")).toBe(inicial - 10);
    const rs = await Promise.all(oss.map((o) => consumir(o.osId, [{ id: o.mId, quantidade: 1 }])));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await saldo("fita")).toBe(inicial - 10); // líquido zero: já tinha saído na separação
    expect(await somaRazao("fita")).toBe(inicial - 10);
    expect(await prisma.movimentacaoEstoque.count({ where: { produtoId: "fita", tipo: "SAIDA", refId: { in: oss.map((o) => o.osId) } } })).toBe(10);
    expect(await prisma.osMaterial.count({ where: { id: { in: oss.map((o) => o.mId) }, estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 1 } })).toBe(10);
    // Nenhuma SAIDA/DEVOLUCAO além das do consumo (sem devolução nesta leva)
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: "DEVOLUCAO" } })).toBe(0);
  }, 120_000);
});
