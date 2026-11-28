/**
 * PONTAS SOLTAS DE CADASTRO (leva 4) em PostgreSQL real, pelas rotas de verdade:
 *  - medição: excluir só o rascunho que não gerou conta nem nota (antes apagava em qualquer etapa);
 *  - conta a pagar: paga não cancela nem edita (antes a rota cancelava a conta paga);
 *  - veículo: responsável e equipe de outra empresa são recusados (antes eram gravados);
 *  - contrato: a edição não muda o status (antes o padrão "ATIVO" reativava o suspenso);
 *  - cliente: o impacto de inativar (só avisos), isolado por empresa;
 *  - modelo de checklist: o do checklist diário obrigatório não inativa;
 *  - busca pelo nome fantasia do cliente nas listas de OS, orçamentos e contratos e no seletor.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, montarPermissoes, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_cad_pontas_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", role = "OPERADOR") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, empresaNome: "Clima Total", role, permissoes, tecnicoId: null } };
};

async function rota(caminho: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/${caminho}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("pontas soltas de cadastro (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Comercial de Alimentos Silva Ltda", nomeFantasia: "Mercado do Zé", cpfCnpj: "44.555.666/0001-77" },
      { id: "c2", empresaId: "e1", nome: "Hotel Mirante", cpfCnpj: "22.333.444/0001-55" },
      // outra empresa com o MESMO nome fantasia: a busca não pode atravessar
      { id: "cE2", empresaId: "e2", nome: "Silva & Filhos", nomeFantasia: "Mercado do Zé", cpfCnpj: "33.444.555/0001-66" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Carlos", cpf: "1", telefone: "1" },
      { id: "tE2", empresaId: "e2", nome: "Técnico da outra", cpf: "2", telefone: "2" },
    ] });
    await prisma.equipe.createMany({ data: [{ id: "eq1", empresaId: "e1", nome: "Equipe Norte" }, { id: "eqE2", empresaId: "e2", nome: "Equipe da outra" }] });
    const os = (id: string, clienteId: string, status: string, empresaId = "e1") =>
      ({ id, empresaId, numero: id.toUpperCase(), clienteId, criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao: "Câmara fria", status });
    await prisma.ordemServico.createMany({ data: [
      os("os-l4-1", "c1", "ABERTA"), os("os-l4-2", "c1", "CONCLUIDA"), os("os-e2", "cE2", "ABERTA", "e2"),
    ] });
    await prisma.contrato.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-L4-001", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01T12:00:00Z"), status: "ATIVO" },
      { id: "ctSusp", empresaId: "e1", clienteId: "c2", numero: "CT-L4-002", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01T12:00:00Z"), status: "SUSPENSO" },
      { id: "ctE2", empresaId: "e2", clienteId: "cE2", numero: "CT-E2", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01T12:00:00Z"), status: "ATIVO" },
    ] });
    await prisma.orcamento.createMany({ data: [
      { id: "orc1", empresaId: "e1", clienteId: "c1", codigo: "ORC-L4-1", nome: "Troca do compressor", status: "ENVIADO", criadoPorId: "uA", tokenPublico: "tk-orc1" },
    ] });
    await prisma.contaReceber.createMany({ data: [
      { id: "crAberta", empresaId: "e1", clienteId: "c1", numero: "CR-1", descricao: "Mensalidade", valor: 500, status: "A_RECEBER" },
      { id: "crPaga", empresaId: "e1", clienteId: "c1", numero: "CR-2", descricao: "Mensalidade", valor: 500, status: "RECEBIDO" },
    ] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── Medição ───────── */
  it("medição: o rascunho limpo é excluído; enviada, com conta ou com nota, 409 e nada muda; outra empresa, 404", async () => {
    const med = (id: string, extra: Record<string, unknown> = {}, empresaId = "e1") =>
      ({ id, empresaId, clienteId: empresaId === "e1" ? "c1" : "cE2", numero: id.toUpperCase(), tokenPublico: `tk-${id}`, ...extra });
    await prisma.medicao.createMany({ data: [
      med("mRasc"), med("mEnviada", { status: "AGUARDANDO_APROVACAO" }), med("mComConta"), med("mComNf", { nfNumero: "123" }), med("mE2", {}, "e2"),
    ] });
    await prisma.contaReceber.create({ data: { id: "crMed", empresaId: "e1", clienteId: "c1", numero: "CR-MED", descricao: "Medição", valor: 100, medicaoId: "mComConta", status: "CANCELADO" } });
    // (até conta CANCELADA segura a exclusão: ela é o rastro da cobrança que existiu)
    como();
    const del = (id: string) => rota("api/medicoes/[id]", "DELETE", undefined, { id });

    expect(await del("mEnviada")).toEqual({ status: 409, json: { erro: "Só o rascunho pode ser excluído. Depois de enviada, a medição é cancelada, não apagada." } });
    // antes estourava a chave estrangeira (500); agora é recusa clara
    expect(await del("mComConta")).toEqual({ status: 409, json: { erro: "Esta medição já gerou conta a receber. Cancele em vez de excluir." } });
    expect((await del("mComNf")).status).toBe(409);
    expect((await del("mE2")).status).toBe(404);
    expect(await prisma.medicao.count({ where: { id: { in: ["mEnviada", "mComConta", "mComNf", "mE2"] } } })).toBe(4);

    expect(await del("mRasc")).toEqual({ status: 200, json: { ok: true } });
    expect(await prisma.medicao.count({ where: { id: "mRasc" } })).toBe(0);
  });

  /* ───────── Conta a pagar ───────── */
  it("conta a pagar: paga não cancela nem edita (409); em aberto e com pagamento parcial cancelam", async () => {
    const cp = (id: string, status: string, valorPago = 0) => ({ id, empresaId: "e1", numero: id.toUpperCase(), fornecedor: "Refrigeração Sul", descricao: "Gás", valorTotal: 1000, valorPago, saldoRestante: 1000 - valorPago, status });
    await prisma.contaPagar.createMany({ data: [cp("cpPaga", "PAGO_TOTAL", 1000), cp("cpAberta", "PENDENTE"), cp("cpParcial", "PAGO_PARCIAL", 300), cp("cpCanc", "CANCELADO")] });
    como();
    expect(await rota("api/contas-pagar/[id]", "DELETE", undefined, { id: "cpPaga" })).toEqual({ status: 409, json: { erro: "Conta paga não pode ser cancelada." } });
    expect(await rota("api/contas-pagar/[id]", "DELETE", undefined, { id: "cpCanc" })).toEqual({ status: 409, json: { erro: "Esta conta já está cancelada." } });
    expect((await prisma.contaPagar.findUnique({ where: { id: "cpPaga" } })).status).toBe("PAGO_TOTAL");

    expect(await rota("api/contas-pagar/[id]", "PUT", { descricao: "Mudou", valorTotal: 5 }, { id: "cpPaga" }))
      .toEqual({ status: 409, json: { erro: "Conta já paga não muda: lance um estorno ou um ajuste." } });
    expect((await rota("api/contas-pagar/[id]", "PUT", { descricao: "Mudou" }, { id: "cpCanc" })).status).toBe(409);
    const paga = await prisma.contaPagar.findUnique({ where: { id: "cpPaga" } });
    expect([paga.descricao, Number(paga.valorTotal)]).toEqual(["Gás", 1000]);

    // a conta em aberto continua editável e cancelável; a parcial cancela pela tela dela (o lote é mais rígido)
    expect((await rota("api/contas-pagar/[id]", "PUT", { descricao: "Gás R410A" }, { id: "cpAberta" })).status).toBe(200);
    expect((await rota("api/contas-pagar/[id]", "DELETE", undefined, { id: "cpAberta" })).status).toBe(200);
    expect((await rota("api/contas-pagar/[id]", "DELETE", undefined, { id: "cpParcial" })).status).toBe(200);
    expect((await prisma.contaPagar.findMany({ where: { id: { in: ["cpAberta", "cpParcial"] } }, select: { status: true } })).map((c: any) => c.status)).toEqual(["CANCELADO", "CANCELADO"]);
  });

  /* ───────── Veículo ───────── */
  it("veículo: responsável ou equipe de outra empresa → 400, nada gravado; os da empresa passam (criar e editar)", async () => {
    como();
    const base = { placa: "ABC1D23", modelo: "Fiorino", documentos: [] };
    expect(await rota("api/veiculos", "POST", { ...base, responsavelId: "tE2" })).toEqual({ status: 400, json: { erro: "Responsável inválido(a)." } });
    expect(await rota("api/veiculos", "POST", { ...base, equipeId: "eqE2" })).toEqual({ status: 400, json: { erro: "Equipe inválido(a)." } });
    expect(await prisma.veiculo.count({ where: { empresaId: "e1" } })).toBe(0);

    const ok = await rota("api/veiculos", "POST", { ...base, responsavelId: "t1", equipeId: "eq1" });
    expect(ok.status).toBe(201);
    const id = ok.json.id;
    expect((await rota("api/veiculos/[id]", "PUT", { ...base, responsavelId: "tE2" }, { id })).status).toBe(400);
    expect((await rota("api/veiculos/[id]", "PUT", { ...base, equipeId: "eqE2" }, { id })).status).toBe(400);
    const v = await prisma.veiculo.findUnique({ where: { id } });
    expect([v.responsavelId, v.equipeId]).toEqual(["t1", "eq1"]);
    expect((await rota("api/veiculos/[id]", "PUT", { ...base, responsavelId: "", equipeId: "" }, { id })).status).toBe(200);
  });

  /* ───────── Contrato ───────── */
  it("contrato: a edição não muda o status — o suspenso continua suspenso, mesmo com status no corpo", async () => {
    como();
    const corpo = { clienteId: "c2", numero: "CT-L4-002", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: "2026-01-01", unidadeIds: [], recorrenciasLocais: [], observacoes: "Revisado" };
    const sem = await rota("api/contratos/[id]", "PUT", corpo, { id: "ctSusp" });
    expect(sem.status).toBe(200);
    const com = await rota("api/contratos/[id]", "PUT", { ...corpo, status: "ATIVO" }, { id: "ctSusp" });
    expect(com.status).toBe(200);
    const c = await prisma.contrato.findUnique({ where: { id: "ctSusp" } });
    expect([c.status, c.observacoes]).toEqual(["SUSPENSO", "Revisado"]);
  });

  /* ───────── Cliente ───────── */
  it("cliente: o impacto de inativar lista o que continua andando (só avisos, nunca bloqueia), da empresa da sessão", async () => {
    como();
    const r = await rota("api/clientes/[id]/impacto", "GET", undefined, { id: "c1" });
    expect(r.status).toBe(200);
    expect(r.json.bloqueio).toBeNull();
    expect(r.json.avisos).toEqual([
      "Tem 1 contrato ativo (CT-L4-001): continua gerando OS e cobrança até o encerramento.",
      "Tem 1 OS em aberto (OS-L4-1): segue normalmente.",
      "Tem 1 orçamento em aberto.",
      "Tem 1 conta a receber em aberto: a cobrança continua.",
    ]);
    // cliente sem nada em andamento: nenhum aviso
    expect((await rota("api/clientes/[id]/impacto", "GET", undefined, { id: "c2" })).json).toEqual({ bloqueio: null, avisos: [] });
    // de outra empresa: 404 (sem dizer que existe)
    expect((await rota("api/clientes/[id]/impacto", "GET", undefined, { id: "cE2" })).status).toBe(404);
    // quem não pode inativar não consulta
    como(montarPermissoes({ clientes: ["visualizar", "editar"] }));
    expect((await rota("api/clientes/[id]/impacto", "GET", undefined, { id: "c1" })).status).toBe(403);
  });

  /* ───────── Modelo de checklist ───────── */
  it("modelo de checklist: o do checklist diário ligado não inativa (409); desligado ou outro modelo, inativa", async () => {
    await prisma.checklistTemplate.createMany({ data: [{ id: "mDiario", empresaId: "e1", nome: "Saída do veículo" }, { id: "mOutro", empresaId: "e1", nome: "Revisão" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1", checklistDiarioAtivo: true, checklistDiarioTemplateId: "mDiario" } });
    como();
    const r = await rota("api/checklist-templates/[id]", "DELETE", undefined, { id: "mDiario" });
    expect(r).toEqual({ status: 409, json: { erro: "Modelo do checklist diário obrigatório: troque o modelo do checklist diário antes de inativar." } });
    expect((await prisma.checklistTemplate.findUnique({ where: { id: "mDiario" } })).ativo).toBe(true);
    expect((await rota("api/checklist-templates/[id]", "DELETE", undefined, { id: "mOutro" })).status).toBe(200);
    // checklist diário desligado: o modelo sai normalmente
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { checklistDiarioAtivo: false } });
    expect((await rota("api/checklist-templates/[id]", "DELETE", undefined, { id: "mDiario" })).status).toBe(200);
  });

  /* ───────── Busca pelo nome fantasia ───────── */
  it("busca pelo fantasia: OS, orçamentos e contratos (o where da lista) e o seletor de clientes — só da empresa", async () => {
    const { whereOrdens, whereOrcamentos, whereContratos } = await import("@/lib/listas/filtros");
    const busca = "mercado do zé";
    expect((await prisma.ordemServico.findMany({ where: whereOrdens("e1", { busca, periodo: "todos" }) /* Leva I: o mês olha a data agendada */, select: { id: true }, orderBy: { id: "asc" } })).map((o: any) => o.id)).toEqual(["os-l4-1", "os-l4-2"]);
    expect((await prisma.orcamento.findMany({ where: whereOrcamentos("e1", { busca }), select: { id: true } })).map((o: any) => o.id)).toEqual(["orc1"]);
    expect((await prisma.contrato.findMany({ where: whereContratos("e1", { busca }), select: { id: true } })).map((o: any) => o.id)).toEqual(["ct1"]);
    como();
    const sel = await rota("api/clientes", "GET", undefined, {}, "?busca=Mercado%20do%20Z%C3%A9");
    expect(sel.status).toBe(200);
    const lista = Array.isArray(sel.json) ? sel.json : sel.json.itens ?? sel.json.clientes;
    expect(lista.map((c: any) => c.id)).toEqual(["c1"]);
  });
});
