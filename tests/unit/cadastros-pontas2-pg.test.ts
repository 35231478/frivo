/**
 * PONTAS SOLTAS DE CADASTRO (leva 5) em PostgreSQL real, pelas rotas de verdade (com dados de outra
 * empresa de propósito):
 *  - endereço: impacto (bloqueio e avisos daquele local), inativar e reativar;
 *  - contato: impacto (portal e principal) e reativar;
 *  - contrato: cancelar exige "Contratos › Excluir" (editar não basta; suspender continua com editar);
 *  - veículo: "Inativo" no formulário passa pela mesma regra do botão (motivo anotado, bloqueio, permissão);
 *  - nota de compra: busca e filtro; descartar a não lançada grava o registro; a lançada, 409;
 *  - GET /api/tecnicos exige uma permissão de quem tem seletor de colaborador;
 *  - impacto da OS, do modelo de checklist e do formulário (o modal mostra antes o que o DELETE recusaria).
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, montarPermissoes, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_cad_pontas2_${process.pid}`;
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

describe.skipIf(!URL_PG)("pontas soltas de cadastro, leva 5 (PostgreSQL real)", () => {
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
      { id: "cE2", empresaId: "e2", nome: "Silva & Filhos", cpfCnpj: "33.444.555/0001-66" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "uPrinc", empresaId: "e1", clienteId: "c1", nome: "Matriz", principal: true },
      { id: "uLoja", empresaId: "e1", clienteId: "c1", nome: "Loja Centro" },
      { id: "uComEquip", empresaId: "e1", clienteId: "c1", nome: "Depósito" },
      { id: "uLivre", empresaId: "e1", clienteId: "c1", nome: "Quiosque" },
      { id: "uE2", empresaId: "e2", clienteId: "cE2", nome: "Filial da outra" },
    ] });
    await prisma.equipamento.create({ data: { empresaId: "e1", unidadeId: "uComEquip", tipo: "AR_CONDICIONADO_SPLIT", marca: "Fria", modelo: "X12" } });
    await prisma.equipamento.create({ data: { empresaId: "e1", unidadeId: "uLivre", tipo: "AR_CONDICIONADO_SPLIT", marca: "Fria", modelo: "Velho", ativo: false } });
    await prisma.contrato.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-L5-001", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01T12:00:00Z"), status: "ATIVO" },
      { id: "ctCanc", empresaId: "e1", clienteId: "c1", numero: "CT-L5-002", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01T12:00:00Z"), status: "CANCELADO" },
    ] });
    await prisma.contratoUnidade.createMany({ data: [{ contratoId: "ct1", unidadeId: "uLoja" }, { contratoId: "ctCanc", unidadeId: "uLoja" }] });
    await prisma.pmoc.create({ data: { empresaId: "e1", clienteId: "c1", unidadeId: "uLoja", nome: "PMOC Loja Centro", dataInicio: new Date("2026-01-01"), dataExpiracao: new Date("2026-12-31") } });
    const os = (id: string, status: string, extra: Record<string, unknown> = {}) =>
      ({ id, empresaId: "e1", numero: id.toUpperCase(), clienteId: "c1", criadoPorId: "uA", descricao: "Câmara fria", status, ...extra });
    await prisma.ordemServico.createMany({ data: [os("os-loja", "AGENDADA", { unidadeId: "uLoja" }), os("os-loja-fim", "CONCLUIDA", { unidadeId: "uLoja" }), os("os-med", "ABERTA")] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ctoPortal", empresaId: "e1", clienteId: "c1", nome: "Marina", principal: true, senha: "hash" },
      { id: "ctoInativo", empresaId: "e1", clienteId: "c1", nome: "Paulo", ativo: false },
      // outro cliente da MESMA empresa, com acesso ao portal: pela URL de c1 não pode aparecer
      { id: "ctoHotel", empresaId: "e1", clienteId: "c2", nome: "Recepção do hotel", principal: true, senha: "hash" },
      { id: "ctoE2", empresaId: "e2", clienteId: "cE2", nome: "Da outra" },
    ] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── Endereço ───────── */
  it("endereço: impacto bloqueia principal e equipamento ativo; avisa contrato, PMOC e OS daquele local; outra empresa, 404", async () => {
    como();
    const imp = (id: string) => rota("api/unidades/[id]/impacto", "GET", undefined, { id });
    expect((await imp("uPrinc")).json.bloqueio).toBe("Endereço principal não pode ser inativado: marque outro endereço como principal antes.");
    expect((await imp("uComEquip")).json.bloqueio).toBe("Tem 1 equipamento ativo neste endereço: mova ou inative os equipamentos antes.");
    // contrato CANCELADO, OS concluída e equipamento inativo não contam
    expect(await imp("uLoja")).toEqual({ status: 200, json: { bloqueio: null, avisos: [
      "Está em 1 contrato ativo (CT-L5-001): continua atendendo este local até ser alterado.",
      "Tem 1 PMOC ativo (PMOC Loja Centro): continua valendo até ser inativado.",
      "Tem 1 OS em aberto (OS-LOJA): segue normalmente.",
    ] } });
    expect(await imp("uLivre")).toEqual({ status: 200, json: { bloqueio: null, avisos: [] } });
    expect((await imp("uE2")).status).toBe(404);
    // quem só vê clientes não consulta (o mesmo de inativar: Clientes › Editar)
    como(montarPermissoes({ clientes: ["visualizar"] }));
    expect((await imp("uLoja")).status).toBe(403);
  });

  it("endereço: o DELETE usa o mesmo bloqueio; inativa com aviso; reativa pelo PATCH { ativo: true }", async () => {
    como();
    const del = (id: string) => rota("api/unidades/[id]", "DELETE", { motivo: "" }, { id });
    expect(await del("uPrinc")).toEqual({ status: 409, json: { erro: "Endereço principal não pode ser inativado: marque outro endereço como principal antes." } });
    expect((await del("uComEquip")).status).toBe(409);
    expect(await del("uLoja")).toEqual({ status: 200, json: { ok: true } });
    expect((await prisma.unidade.findUnique({ where: { id: "uLoja" } })).ativo).toBe(false);

    const re = await rota("api/unidades/[id]", "PATCH", { ativo: true }, { id: "uLoja" });
    expect(re.status).toBe(200);
    expect([re.json.id, re.json.nome, re.json.ativo]).toEqual(["uLoja", "Loja Centro", true]);
    // outra empresa não reativa
    await prisma.unidade.update({ where: { id: "uE2" }, data: { ativo: false } });
    expect((await rota("api/unidades/[id]", "PATCH", { ativo: true }, { id: "uE2" })).status).toBe(404);
    expect((await prisma.unidade.findUnique({ where: { id: "uE2" } })).ativo).toBe(false);
    // a edição no contexto (PATCH com nome) continua igual
    expect((await rota("api/unidades/[id]", "PATCH", { nome: "Loja Centro 2" }, { id: "uLoja" })).json.nome).toBe("Loja Centro 2");
  });

  /* ───────── Contato ───────── */
  it("contato: impacto avisa portal e principal; reativa pelo PATCH { ativo: true } sem devolver a senha; outra empresa, 404", async () => {
    como();
    expect(await rota("api/clientes/[id]/contatos/[contatoId]/impacto", "GET", undefined, { id: "c1", contatoId: "ctoPortal" })).toEqual({ status: 200, json: { bloqueio: null, avisos: [
      "Tem acesso ao Portal do Cliente: o acesso fica bloqueado enquanto estiver inativo.",
      "É o contato principal: escolha outro contato principal depois.",
    ] } });
    expect((await rota("api/clientes/[id]/contatos/[contatoId]/impacto", "GET", undefined, { id: "cE2", contatoId: "ctoE2" })).status).toBe(404);
    // o contato de outro cliente pela URL de c1 também não aparece
    expect((await rota("api/clientes/[id]/contatos/[contatoId]/impacto", "GET", undefined, { id: "c1", contatoId: "ctoE2" })).status).toBe(404);
    // nem o de outro cliente da mesma empresa (a empresa sozinha não basta: o contato é do cliente da URL)
    expect((await rota("api/clientes/[id]/contatos/[contatoId]/impacto", "GET", undefined, { id: "c1", contatoId: "ctoHotel" })).status).toBe(404);
    expect((await rota("api/clientes/[id]/contatos/[contatoId]/impacto", "GET", undefined, { id: "c2", contatoId: "ctoHotel" })).json.avisos).toHaveLength(2);

    const re = await rota("api/clientes/[id]/contatos/[contatoId]", "PATCH", { ativo: true }, { id: "c1", contatoId: "ctoInativo" });
    expect([re.status, re.json.ativo, re.json.nome, "senha" in re.json]).toEqual([200, true, "Paulo", false]);
    expect((await rota("api/clientes/[id]/contatos/[contatoId]", "PATCH", { ativo: true }, { id: "cE2", contatoId: "ctoE2" })).status).toBe(404);
  });

  /* ───────── Contrato ───────── */
  it("contrato: cancelar exige Contratos › Excluir (editar não basta; suspender sim); com a permissão, cancela", async () => {
    como(montarPermissoes({ contratos: ["visualizar", "editar"] }));
    const status = (s: string) => rota("api/contratos/[id]/status", "PATCH", { status: s }, { id: "ct1" });
    expect(await status("CANCELADO")).toEqual({ status: 403, json: { erro: "Sem permissão para cancelar contratos (Contratos › Excluir)." } });
    expect((await prisma.contrato.findUnique({ where: { id: "ct1" } })).status).toBe("ATIVO");
    // o impacto é de quem edita (o modal mostra antes de qualquer troca)
    expect((await rota("api/contratos/[id]/impacto", "GET", undefined, { id: "ct1" }, "?status=SUSPENSO")).status).toBe(200);
    expect((await status("SUSPENSO")).status).toBe(200);
    como(montarPermissoes({ contratos: ["visualizar", "editar", "excluir"] }));
    expect((await status("CANCELADO")).status).toBe(200);
    expect((await prisma.contrato.findUnique({ where: { id: "ct1" } })).status).toBe("CANCELADO");
    // sem editar, nem o impacto
    como(montarPermissoes({ contratos: ["visualizar"] }));
    expect((await rota("api/contratos/[id]/impacto", "GET", undefined, { id: "ct1" }, "?status=ATIVO")).status).toBe(403);
  });

  /* ───────── Veículo ───────── */
  it("veículo: Inativo pelo formulário anota o motivo (como o botão); quem não pode inativar recebe 403; reativar pelo formulário volta", async () => {
    await prisma.veiculo.create({ data: { id: "vF", empresaId: "e1", placa: "RTA4F21", modelo: "Strada" } });
    const base = { placa: "RTA4F21", modelo: "Strada", documentos: [] };
    como(montarPermissoes({ veiculos: ["visualizar", "gerenciar"] }));
    expect(await rota("api/veiculos/[id]", "PUT", { ...base, status: "INATIVO", motivoInativacao: "Vendido" }, { id: "vF" })).toEqual({ status: 403, json: { erro: "Sem permissão para inativar veículos" } });
    expect((await prisma.veiculo.findUnique({ where: { id: "vF" } })).status).toBe("ATIVO");

    como();
    const r = await rota("api/veiculos/[id]", "PUT", { ...base, cor: "Branca", status: "INATIVO", motivoInativacao: "Vendido" }, { id: "vF" });
    expect([r.status, r.json.status, r.json.cor]).toEqual([200, "INATIVO", "Branca"]);
    expect(r.json.observacoes).toMatch(/^\[Inativado em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} por Ana\] Motivo: Vendido$/);
    // salvar de novo, já inativo, não anota outra vez
    expect((await rota("api/veiculos/[id]", "PUT", { ...base, cor: "Branca", status: "INATIVO", observacoes: r.json.observacoes }, { id: "vF" })).json.observacoes).toBe(r.json.observacoes);
    expect((await rota("api/veiculos/[id]", "PUT", { ...base, status: "ATIVO", observacoes: r.json.observacoes }, { id: "vF" })).json.status).toBe("ATIVO");
  });

  /* ───────── Nota de compra ───────── */
  it("nota de compra: busca e situação; descartar a importada grava quem, quando e por quê; a lançada, 409; outra empresa, 404", async () => {
    await prisma.fornecedor.createMany({ data: [
      { id: "f1", empresaId: "e1", nome: "Refrigeração Paulista Distribuidora", documento: "11.222.333/0001-44" },
      { id: "fE2", empresaId: "e2", nome: "Fornecedor da outra", documento: "55.666.777/0001-88" },
    ] });
    const nf = (id: string, numero: string, status: string, empresaId = "e1") => ({
      id, empresaId, fornecedorId: empresaId === "e1" ? "f1" : "fE2", chaveAcesso: `3526111122233300014455001${numero.padStart(19, "0")}`, numero, serie: "1",
      dataEmissao: new Date("2026-11-10T12:00:00Z"), valorTotal: 2380.5, status, xml: "<nfeProc/>",
      emitenteNome: empresaId === "e1" ? "Refrigeração Paulista Distribuidora" : "Fornecedor da outra", emitenteCnpj: empresaId === "e1" ? "11222333000144" : "55666777000188",
    });
    await prisma.notaCompra.createMany({ data: [nf("nfImp", "45120", "IMPORTADA"), nf("nfConc", "44987", "CONCILIADA"), nf("nfLanc", "45098", "LANCADA"), nf("nfE2", "45120", "IMPORTADA", "e2")] });
    await prisma.notaCompraItem.create({ data: { notaId: "nfImp", numeroItem: 1, codigoFornecedor: "R410", descricaoFornecedor: "GAS R410A", unidade: "UN", quantidade: 2, valorUnitario: 1190.25, valorTotal: 2380.5 } });

    como();
    const lista = async (q: string) => (await rota("api/compras/notas", "GET", undefined, {}, q)).json;
    expect((await lista("")).total).toBe(3);
    expect((await lista("?q=45120")).notas.map((n: any) => n.id)).toEqual(["nfImp"]);
    expect((await lista("?q=paulista&status=LANCADA")).notas.map((n: any) => n.id)).toEqual(["nfLanc"]);
    expect((await lista("?q=11.222.333")).total).toBe(3);
    expect((await lista("?q=55666777")).total).toBe(0); // o CNPJ da outra empresa não atravessa

    expect(await rota("api/compras/notas/[id]/impacto", "GET", undefined, { id: "nfLanc" })).toEqual({ status: 200, json: { bloqueio: "Nota já lançada não se descarta: o estorno é pela conta a pagar e pelo ajuste de estoque.", avisos: [] } });
    expect(await rota("api/compras/notas/[id]", "DELETE", { motivo: "x" }, { id: "nfLanc" })).toEqual({ status: 409, json: { erro: "Nota já lançada não se descarta: o estorno é pela conta a pagar e pelo ajuste de estoque." } });
    expect((await rota("api/compras/notas/[id]", "DELETE", {}, { id: "nfE2" })).status).toBe(404);
    expect(await prisma.notaCompraDescarte.count()).toBe(0);

    expect(await rota("api/compras/notas/[id]", "DELETE", { motivo: "  XML de outra filial  " }, { id: "nfImp" })).toEqual({ status: 200, json: { ok: true } });
    expect(await prisma.notaCompra.count({ where: { id: "nfImp" } })).toBe(0);
    expect(await prisma.notaCompraItem.count({ where: { notaId: "nfImp" } })).toBe(0);
    const [d] = await prisma.notaCompraDescarte.findMany();
    expect([d.empresaId, d.notaId, d.numero, d.serie, d.emitenteNome, Number(d.valorTotal), d.statusNaHora, d.motivo, d.usuarioId, d.chaveAcesso.endsWith("45120")])
      .toEqual(["e1", "nfImp", "45120", "1", "Refrigeração Paulista Distribuidora", 2380.5, "IMPORTADA", "XML de outra filial", "uA", true]);
    expect(Date.now() - d.descartadoEm.getTime()).toBeLessThan(60_000);
    // a conciliada também descarta (sem motivo, fica nulo); a nota de mesmo número da outra empresa fica
    expect((await rota("api/compras/notas/[id]", "DELETE", undefined, { id: "nfConc" })).status).toBe(200);
    expect((await prisma.notaCompraDescarte.findFirst({ where: { notaId: "nfConc" } })).motivo).toBeNull();
    expect(await prisma.notaCompra.count({ where: { id: "nfE2" } })).toBe(1);
    // descartar é de quem gerencia o estoque
    como(montarPermissoes({ estoque: ["visualizar"] }));
    expect((await rota("api/compras/notas/[id]/impacto", "GET", undefined, { id: "nfLanc" })).status).toBe(403);
  });

  /* ───────── Colaboradores ───────── */
  it("GET /api/tecnicos: só com uma permissão de quem tem seletor de colaborador; isolado por empresa", async () => {
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Carlos", cpf: "1", telefone: "1" },
      { id: "tE2", empresaId: "e2", nome: "Técnico da outra", cpf: "2", telefone: "2" },
    ] });
    sessao.atual = null;
    expect((await rota("api/tecnicos", "GET")).status).toBe(401);
    como(montarPermissoes({ estoque: ["visualizar", "gerenciar"], relatorios: ["visualizar"] }));
    expect(await rota("api/tecnicos", "GET")).toEqual({ status: 403, json: { erro: "Sem permissão para esta ação" } });
    for (const [modulo, acao] of [["equipes", "visualizar"], ["ordens", "visualizar"], ["calendario", "visualizar"], ["pmoc", "visualizar"], ["contratos", "visualizar"], ["veiculos", "visualizar"], ["financeiro", "visualizar"], ["orcamentos", "visualizar"]] as const) {
      como(montarPermissoes({ [modulo]: [acao] }));
      const r = await rota("api/tecnicos", "GET");
      expect([modulo, r.status, r.json.map((t: any) => t.id)]).toEqual([modulo, 200, ["t1"]]);
    }
  });

  /* ───────── Impactos dos modais unificados ───────── */
  it("OS, modelo de checklist e formulário: o impacto mostra antes o que o DELETE recusaria", async () => {
    como();
    // OS já em medição: bloqueia
    await prisma.medicao.create({ data: { id: "m1", empresaId: "e1", clienteId: "c1", numero: "MED-1", tokenPublico: "tk-m1" } });
    await prisma.medicaoItem.create({ data: { medicaoId: "m1", ordemServicoId: "os-med", descricao: "OS", quantidade: 1, valorUnitario: 10, valorTotal: 10 } });
    expect((await rota("api/ordens/[id]/impacto", "GET", undefined, { id: "os-med" })).json.bloqueio).toBe("Esta OS já está na medição MED-1 (financeiro). Cancele ou remova a OS da medição antes de inativá-la.");
    expect(await rota("api/ordens/[id]/impacto", "GET", undefined, { id: "os-loja" })).toEqual({ status: 200, json: { bloqueio: null, avisos: [] } });
    como(montarPermissoes({ ordens: ["visualizar", "editar"] }));
    expect((await rota("api/ordens/[id]/impacto", "GET", undefined, { id: "os-loja" })).status).toBe(403);

    como();
    await prisma.checklistTemplate.createMany({ data: [{ id: "ckDiario", empresaId: "e1", nome: "Checklist Diário" }, { id: "ckOutro", empresaId: "e1", nome: "Checklist de viagem" }, { id: "ckE2", empresaId: "e2", nome: "Da outra" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1", checklistDiarioAtivo: true, checklistDiarioTemplateId: "ckDiario" } });
    expect((await rota("api/checklist-templates/[id]/impacto", "GET", undefined, { id: "ckDiario" })).json.bloqueio).toBe("Modelo do checklist diário obrigatório: troque o modelo do checklist diário antes de inativar.");
    expect(await rota("api/checklist-templates/[id]/impacto", "GET", undefined, { id: "ckOutro" })).toEqual({ status: 200, json: { bloqueio: null, avisos: [] } });
    expect((await rota("api/checklist-templates/[id]/impacto", "GET", undefined, { id: "ckE2" })).status).toBe(404);

    await prisma.tipoOs.create({ data: { id: "to1", empresaId: "e1", nome: "Preventiva" } });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split" } });
    await prisma.formularioTemplate.createMany({ data: [{ id: "fm1", empresaId: "e1", nome: "Limpeza de split" }, { id: "fmE2", empresaId: "e2", nome: "Da outra" }] });
    await prisma.formTypeMapping.create({ data: { empresaId: "e1", tipoEquipamentoId: "te1", tipoOsId: "to1", formularioTemplateId: "fm1" } });
    expect(await rota("api/formularios/[id]/impacto", "GET", undefined, { id: "fm1" })).toEqual({ status: 200, json: { bloqueio: null, avisos: [
      "Em uso em 1 combinação de equipamento e tipo de OS: sai das próximas OS; as respostas já dadas ficam.",
    ] } });
    expect((await rota("api/formularios/[id]/impacto", "GET", undefined, { id: "fmE2" })).status).toBe(404);
  });
});
