/**
 * App do técnico — "O que levar" e "Como chegar": as rotas reais do app com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`).
 *
 *  - os materiais previstos vêm do que está gravado: materiais lançados na linha de serviço da OS, a
 *    composição padrão do serviço (kit aberto) quando a linha não tem material lançado, e as peças da OS;
 *  - "não usado", já consumido, linha executada e o espelho da peça não entram; serviço sem composição
 *    não gera nada;
 *  - por OS no cartão (Meu dia, Agenda e a OS aberta) e somável por dia, cada OS uma vez;
 *  - o técnico só recebe o das OS DELE; outra empresa não aparece;
 *  - NENHUM valor (venda, custo) sai do servidor;
 *  - a opção da empresa desligada: nada sai; é salva pela tela de configurações e nasce LIGADA;
 *  - é só leitura: nenhum material, item, estoque ou OS muda;
 *  - "Como chegar": coordenadas da unidade quando há, endereço do cliente senão; sem endereço, sem
 *    link; com "Exibir dados do cliente" desligado, endereço e rota nem saem do servidor.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/tecnico-o-que-levar-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { oQueLevarNoDia, type MaterialPrevisto } from "@/lib/tecnico/o-que-levar";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_o_que_levar_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = (tecnicoId = "t1", id = "uT", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "João", email: `${id}@x.com`, empresaId, role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
const lista = (ms: MaterialPrevisto[] | undefined) => (ms ?? []).map((m) => `${m.descricao}:${m.quantidade}:${m.unidade}`);

describe.skipIf(!URL_PG)("App do técnico: O que levar e Como chegar (PostgreSQL real)", () => {
  let prisma: any;
  const meuDia = async () => (await chamar("tecnico/meu-dia", "GET")).json;
  const agenda = async () => (await chamar("tecnico/agenda", "GET", {}, undefined, "?dias=14")).json;
  const retrato = (atividadeId: string) => chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId });
  const cartaoDe = (r: any, atividadeId: string) => [...r.atividades, ...r.anteriores].find((c: any) => c.atividadeId === atividadeId);
  const permitir = (dados: Record<string, boolean>) => prisma.configuracao.upsert({ where: { empresaId: "e1" }, create: { empresaId: "e1", ...dados }, update: dados });
  /** Tudo o que NÃO pode mudar só por o técnico olhar o que levar */
  const fotografia = async () => JSON.stringify({
    materiais: await prisma.osMaterial.findMany({ orderBy: { id: "asc" } }), itens: await prisma.osItemOrcamento.findMany({ orderBy: { id: "asc" } }),
    estoque: await prisma.movimentacaoEstoque.count(), os: await prisma.ordemServico.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, atualizadoEm: true } }),
    composicao: await prisma.servicoMaterial.findMany({ orderBy: { id: "asc" } }),
  });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    const { inicioHojeBR } = await import("@/lib/fuso");
    await Promise.all(["tecnico/meu-dia", "tecnico/agenda", "tecnico/atividades/[atividadeId]", "configuracoes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    const hoje = (hora: number) => new Date(inicioHojeBR().getTime() + hora * 3_600_000);
    const amanha = (hora: number) => new Date(inicioHojeBR(new Date(), 1).getTime() + hora * 3_600_000);

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Engenharia Ltda", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Outro técnico", email: "t2@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Da outra", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" },
      { id: "t2", empresaId: "e1", nome: "Outro técnico", cpf: "2", telefone: "2", email: "t2@x.com" },
      { id: "tB", empresaId: "e2", nome: "Técnico da outra", cpf: "3", telefone: "3", email: "tb@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "1", endereco: "Rua do Cadastro", numero: "5", cidade: "Santos", estado: "SP" },
      { id: "cEnd", empresaId: "e1", nome: "Padaria Pão Quente", cpfCnpj: "2", endereco: "Rua das Flores", numero: "12", bairro: "Centro", cidade: "Campinas", estado: "SP", cep: "13010-000" },
      { id: "cSem", empresaId: "e1", nome: "Cliente sem endereço", cpfCnpj: "3" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "4" },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz", logradouro: "Av. Paulista", numero: "1000", cidade: "São Paulo", estado: "SP", latitude: -23.5614, longitude: -46.6559 } });
    await prisma.produto.createMany({ data: [
      { id: "pFiltro", empresaId: "e1", nome: "Filtro G4", unidade: "un", valorPadrao: 777.77 },
      { id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "kg", valorPadrao: 777.77 },
      { id: "pFita", empresaId: "e1", nome: "Fita isolante", unidade: "rl", ativo: false },
      { id: "pCap", empresaId: "e1", nome: "Capacitor 35uF", unidade: "un" },
      { id: "pComp", empresaId: "e1", nome: "Compressor rotativo 12.000 BTU", unidade: "pç" },
      { id: "pOutra", empresaId: "e2", nome: "Material da outra empresa", unidade: "un" },
    ] });
    await prisma.kitMaterial.create({ data: { id: "k1", empresaId: "e1", nome: "Kit limpeza", itens: { create: [{ produtoId: "pFita", quantidade: 0.5, ordem: 0 }, { produtoId: "pFiltro", quantidade: 1, ordem: 1 }] } } });
    await prisma.servico.create({ data: { id: "sLimp", empresaId: "e1", nome: "Limpeza de split", materiais: { create: [{ id: "smFiltro", produtoId: "pFiltro", quantidade: 2, ordem: 0 }, { id: "smKit", kitId: "k1", quantidade: 2, ordem: 1 }] } } });
    await prisma.servico.create({ data: { id: "sSem", empresaId: "e1", nome: "Visita técnica" } });
    await prisma.servico.create({ data: { id: "sE2", empresaId: "e2", nome: "Serviço da outra", materiais: { create: [{ produtoId: "pOutra", quantidade: 9 }] } } });

    const os = (id: string, numero: string, clienteId: string, extra: Record<string, unknown> = {}) =>
      ({ id, empresaId: "e1", numero, clienteId, criadoPorId: "uA", descricao: "Manutenção", ...extra });
    await prisma.ordemServico.createMany({ data: [
      os("osA", "OS-0101", "c1", { unidadeId: "un1" }), os("osB", "OS-0102", "cEnd"), os("osC", "OS-0103", "cSem"), os("osD", "OS-0104", "c1"), os("osCanc", "OS-0105", "c1", { status: "CANCELADA" }),
      { id: "osE2", empresaId: "e2", numero: "OS-9001", clienteId: "cE2", criadoPorId: "uB", descricao: "Da outra" },
    ] });
    const item = (id: string, ordemServicoId: string, extra: Record<string, unknown>) =>
      ({ id, ordemServicoId, descricao: "Limpeza de split", quantidade: 1, valorUnitario: 333.33, valorTotal: 333.33, ...extra });
    await prisma.osItemOrcamento.createMany({ data: [
      item("iA1", "osA", { servicoId: "sLimp", ordem: 0 }),                                             // serviço COM materiais lançados
      item("iA3", "osA", { tipo: "PRODUTO", produtoId: "pComp", descricao: "Compressor", ordem: 2 }),    // peça vendida direto na OS
      item("iA4", "osA", { servicoId: "sLimp", descricao: "Limpeza já feita", executado: true, ordem: 3 }), // já executado
      item("iB1", "osB", { servicoId: "sLimp", ordem: 0 }),                                             // serviço do catálogo SEM material lançado → composição
      item("iC1", "osC", { servicoId: "sSem", descricao: "Visita técnica", ordem: 0 }),                 // serviço sem composição
      item("iC2", "osC", { descricao: "Mão de obra avulsa", ordem: 1 }),                                 // linha livre
      item("iD1", "osD", { descricao: "Serviço do outro técnico", ordem: 0 }),
      item("iX1", "osCanc", { servicoId: "sLimp", ordem: 0 }),
      item("iE2", "osE2", { servicoId: "sE2", descricao: "Da outra", ordem: 0 }),
    ] });
    const material = (id: string, ordemServicoId: string, osItemId: string, descricao: string, quantidade: number, extra: Record<string, unknown> = {}) =>
      ({ id, ordemServicoId, osItemId, descricao, quantidade, comportamento: "INCLUSO_NO_SERVICO", valorVendaUnit: 777.77, custoUnit: 555.55, ...extra });
    await prisma.osMaterial.createMany({ data: [
      material("mA1", "osA", "iA1", "Filtro G4", 2, { produtoId: "pFiltro", quantidadePadrao: 2 }),
      material("mA2", "osA", "iA1", "Gás R410A", 1.5, { produtoId: "pGas", unidade: "kg" }),
      material("mA3", "osA", "iA1", "Fita isolante", 0, { produtoId: "pFita", unidade: "rl", quantidadePadrao: 1 }),                  // "não usado"
      material("mA4", "osA", "iA1", "Capacitor 35uF", 1, { produtoId: "pCap", comportamento: "VENDA_A_PARTE" }),                      // peça do serviço
      material("mA5", "osA", "iA1", "Dreno já levado", 3, { unidade: "m", estadoSeparacao: "CONSUMIDO", quantidadeSeparada: 3, quantidadeConsumida: 3 }),
      material("mA6", "osA", "iA4", "Material do serviço já executado", 4),
      material("mD1", "osD", "iD1", "Material só do outro técnico", 7),
    ] });
    // O espelho da peça do serviço (linha de produto ligada ao material): não pode contar de novo
    await prisma.osItemOrcamento.create({ data: item("iA2", "osA", { tipo: "PRODUTO", produtoId: "pCap", descricao: "Capacitor 35uF", materialId: "mA4", ordem: 1 }) });

    const atividade = (id: string, ordemServicoId: string, tecnicoId: string, dataAgendada: Date, extra: Record<string, unknown> = {}) =>
      ({ id, empresaId: "e1", ordemServicoId, titulo: "Preventiva", tecnicoId, status: "AGENDADA", dataAgendada, ...extra });
    await prisma.atividadeOs.createMany({ data: [
      atividade("atA", "osA", "t1", hoje(9)), atividade("atA2", "osA", "t1", hoje(14)), // a MESMA OS duas vezes no dia
      atividade("atB", "osB", "t1", hoje(11)), atividade("atC", "osC", "t1", hoje(16)),
      atividade("atD", "osD", "t2", hoje(10)),                                           // de outro técnico
      atividade("atF", "osB", "t1", amanha(8)),                                          // amanhã (Agenda)
      { ...atividade("atE2", "osE2", "tB", hoje(9)), empresaId: "e2" },
    ] });
    comoTecnico();
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    comoTecnico();
    await permitir({ appOQueLevar: true, appExibirDadosCliente: true, appExibirContatosCliente: true });
  });

  it("MEU DIA: cada cartão traz os materiais previstos da OS — lançados, composição do serviço (kit aberto) e peças", async () => {
    const r = await meuDia();
    expect(r.atividades.map((c: any) => c.atividadeId)).toEqual(["atA", "atB", "atA2", "atC"]);
    // osA: lançados (Filtro 2, Gás 1,5 kg), a peça do serviço (Capacitor, UMA vez — o espelho não conta) e a peça vendida na OS.
    // Fora: fita "não usada" (0), dreno já consumido e o material da linha já executada
    expect(lista(cartaoDe(r, "atA").materiais)).toEqual(["Capacitor 35uF:1:un", "Compressor rotativo 12.000 BTU:1:pç", "Filtro G4:2:un", "Gás R410A:1.5:kg"]);
    expect(lista(cartaoDe(r, "atA2").materiais)).toEqual(lista(cartaoDe(r, "atA").materiais)); // a mesma OS, o mesmo material
    // osB: serviço do catálogo sem material lançado → composição: 2 filtros + 2 kits (cada um: 0,5 fita + 1 filtro)
    expect(lista(cartaoDe(r, "atB").materiais)).toEqual(["Filtro G4:4:un", "Fita isolante:1:rl"]);
    // osC: serviço sem composição + linha livre → nada (não se inventa material)
    expect(cartaoDe(r, "atC").materiais).toEqual([]);
  });

  it("POR DIA: a soma do que levar, cada OS uma vez (a OS com duas atividades no dia não dobra)", async () => {
    const r = await meuDia();
    const dia = oQueLevarNoDia(r.atividades);
    expect(lista(dia.itens)).toEqual(["Capacitor 35uF:1:un", "Compressor rotativo 12.000 BTU:1:pç", "Filtro G4:6:un", "Fita isolante:1:rl", "Gás R410A:1.5:kg"]);
    expect(dia.os).toBe(2);
  });

  it("NENHUM valor sai do servidor: nem venda, nem custo, nem o valor da linha", async () => {
    for (const corpo of [await meuDia(), await agenda(), (await retrato("atA")).json.cartao]) {
      const texto = JSON.stringify(corpo);
      expect(texto).not.toMatch(/777\.77|555\.55|333\.33/);
      expect(texto).not.toMatch(/valorVendaUnit|custoUnit|valorUnitario|valorTotal|valorPadrao/);
    }
    expect(Object.keys(cartaoDe(await meuDia(), "atA").materiais[0]).sort()).toEqual(["chave", "descricao", "quantidade", "unidade"]);
  });

  it("ESCOPO: o técnico só recebe o das OS DELE; a OS de outro técnico é recusada; outra empresa não existe", async () => {
    const meu = JSON.stringify(await meuDia());
    expect(meu).not.toContain("Material só do outro técnico");
    expect(meu).not.toContain("Material da outra empresa");
    expect((await retrato("atD")).status).toBe(403);
    expect((await retrato("atE2")).status).toBe(404);
    comoTecnico("t2", "uT2");
    const doOutro = await meuDia();
    expect(doOutro.atividades.map((c: any) => c.atividadeId)).toEqual(["atD"]);
    expect(lista(doOutro.atividades[0].materiais)).toEqual(["Material só do outro técnico:7:un"]);
    comoTecnico("tB", "uTB", "e2");
    expect(lista((await meuDia()).atividades[0].materiais)).toEqual(["Material da outra empresa:9:un"]);
    expect(JSON.stringify(await meuDia())).not.toContain("Filtro G4");
  });

  it("a leitura confere a EMPRESA: pedir a OS de outra empresa (ou cancelada) não devolve material", async () => {
    const { materiaisPorOs } = await import("@/lib/tecnico/o-que-levar-server");
    expect([...(await materiaisPorOs("e1", ["osE2", "osCanc"])).keys()]).toEqual([]);
    expect([...(await materiaisPorOs("e2", ["osA", "osB", "osE2"])).keys()]).toEqual(["osE2"]);
    expect([...(await materiaisPorOs("e1", ["osA", "osA", "osC"])).keys()]).toEqual(["osA"]); // OS sem material previsto não entra no mapa
    expect((await materiaisPorOs("e1", [])).size).toBe(0);
  });

  it("A OS ABERTA no app (retrato) e a AGENDA também trazem o que levar", async () => {
    const r = await retrato("atB");
    expect(r.status).toBe(200);
    expect(lista(r.json.cartao.materiais)).toEqual(["Filtro G4:4:un", "Fita isolante:1:rl"]);
    const dias = (await agenda()).dias;
    expect(dias).toHaveLength(2);
    expect(lista(oQueLevarNoDia(dias[0].atividades).itens)).toEqual(["Capacitor 35uF:1:un", "Compressor rotativo 12.000 BTU:1:pç", "Filtro G4:6:un", "Fita isolante:1:rl", "Gás R410A:1.5:kg"]);
    expect(dias[1].atividades.map((c: any) => c.atividadeId)).toEqual(["atF"]);
    expect(lista(dias[1].atividades[0].materiais)).toEqual(["Filtro G4:4:un", "Fita isolante:1:rl"]);
  });

  it("a composição do serviço é lida AGORA para a linha sem material lançado; a linha com material lançado não muda com o cadastro", async () => {
    await prisma.servicoMaterial.update({ where: { id: "smFiltro" }, data: { quantidade: 5 } });
    const r = await meuDia();
    expect(lista(cartaoDe(r, "atB").materiais)).toEqual(["Filtro G4:7:un", "Fita isolante:1:rl"]);
    expect(lista(cartaoDe(r, "atA").materiais)).toContain("Filtro G4:2:un");
    await prisma.servicoMaterial.update({ where: { id: "smFiltro" }, data: { quantidade: 2 } });
  });

  it("atividade CONCLUÍDA sai da conta do dia (o cartão continua trazendo o material da OS)", async () => {
    await prisma.atividadeOs.update({ where: { id: "atB" }, data: { status: "CONCLUIDA" } });
    const r = await meuDia();
    expect(lista(oQueLevarNoDia(r.atividades).itens)).toEqual(["Capacitor 35uF:1:un", "Compressor rotativo 12.000 BTU:1:pç", "Filtro G4:2:un", "Gás R410A:1.5:kg"]);
    await prisma.atividadeOs.update({ where: { id: "atB" }, data: { status: "AGENDADA" } });
  });

  it("OPÇÃO DA EMPRESA: nasce LIGADA, é salva pela tela de configurações e, desligada, nada sai do servidor", async () => {
    await prisma.configuracao.deleteMany({ where: { empresaId: "e1" } });
    expect(cartaoDe(await meuDia(), "atA").materiais).toHaveLength(4); // empresa sem linha de configuração: padrão ligado
    comoEscritorio();
    expect((await chamar("configuracoes", "PUT", {}, { appOQueLevar: false })).status).toBe(200);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).appOQueLevar).toBe(false);
    expect((await chamar("configuracoes", "PUT", {}, { appOQueLevar: "sim" })).status).toBe(400);
    comoTecnico();
    const r = await meuDia();
    for (const c of r.atividades) expect("materiais" in c, c.atividadeId).toBe(false);
    expect("materiais" in (await retrato("atA")).json.cartao).toBe(false);
    expect(JSON.stringify(await agenda())).not.toMatch(/Filtro G4|materiais/);
    // A outra empresa segue com a opção dela
    comoTecnico("tB", "uTB", "e2");
    expect(lista((await meuDia()).atividades[0].materiais)).toEqual(["Material da outra empresa:9:un"]);
    comoEscritorio();
    expect((await chamar("configuracoes", "PUT", {}, { appOQueLevar: true })).status).toBe(200);
    comoTecnico();
    expect(cartaoDe(await meuDia(), "atA").materiais).toHaveLength(4);
  });

  it("É SÓ LEITURA: olhar o que levar não baixa estoque, não reserva, não mexe em material, item, composição nem na OS", async () => {
    const antes = await fotografia();
    await meuDia(); await agenda(); await retrato("atA"); await retrato("atB"); await meuDia();
    expect(await fotografia()).toBe(antes);
    expect(await prisma.movimentacaoEstoque.count()).toBe(0);
  });

  it("COMO CHEGAR: coordenadas da unidade quando há; endereço do cliente senão; sem endereço, sem link (o app mostra o aviso)", async () => {
    const r = await meuDia();
    expect(cartaoDe(r, "atA")).toMatchObject({ cliente: "Hospital Santa Luzia", unidade: "Matriz", endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5614%2C-46.6559" });
    const padaria = cartaoDe(r, "atB");
    expect(padaria.endereco).toBe("Rua das Flores, 12 — Centro, Campinas/SP");
    expect(new URL(padaria.rota).searchParams.get("destination")).toBe("Rua das Flores, 12 — Centro, Campinas/SP 13010-000");
    expect(cartaoDe(r, "atC")).toMatchObject({ cliente: "Cliente sem endereço", endereco: "", rota: null });
    for (const c of r.atividades) expect(String(c.rota ?? "")).not.toMatch(/key=|apikey|token/i);
  });

  it("PRIVACIDADE: com 'Exibir dados do cliente' desligado, endereço e rota nem saem do servidor — o material previsto continua", async () => {
    await permitir({ appExibirDadosCliente: false });
    const r = await meuDia();
    for (const c of r.atividades) expect(c, c.atividadeId).toMatchObject({ cliente: "", unidade: null, endereco: "", rota: null });
    expect(JSON.stringify(r)).not.toMatch(/Paulista|Flores|Hospital|maps/);
    expect(lista(cartaoDe(r, "atA").materiais)).toContain("Filtro G4:2:un");
    expect((await retrato("atA")).json.cartao).toMatchObject({ cliente: "", endereco: "", rota: null });
  });

  it("sem login: 401; quem não vê OS: 403", async () => {
    sessao.atual = null;
    expect((await chamar("tecnico/meu-dia", "GET")).status).toBe(401);
    comoEscritorio({ ...permissoesTotais(), ordens: [] } as Permissoes);
    expect((await chamar("tecnico/meu-dia", "GET")).status).toBe(403);
    expect((await chamar("tecnico/agenda", "GET", {}, undefined, "?dias=14")).status).toBe(403);
  });
});
