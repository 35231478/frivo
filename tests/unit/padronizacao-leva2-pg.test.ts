/**
 * Padronização — leva 2: "editar no contexto" ligado nas telas de OS e de Orçamento.
 * Rotas reais com o Prisma real num PostgreSQL real (schema descartável via `prisma db push`).
 *
 * REFERÊNCIA (o cadastro-mãe, muda em todo lugar):
 *  - cliente, contato, unidade e equipamento têm edição PARCIAL e ESTRITA: só o que mudou vem no corpo,
 *    o resto do cadastro não é tocado, campo fora da lista = 400; mesma permissão da edição completa;
 *    outra empresa não lê nem grava; continua editável com a OS fechada (a trava é do uso).
 *
 * USO (a linha da transação, muda só ali):
 *  - linha da OS: descrição, quantidade e preço aplicado NAQUELA OS — o serviço e o produto do catálogo
 *    não mudam, e o retrato dos materiais copiado para a linha fica como está;
 *  - o retrato copiado não muda com o catálogo: reprecificar ou renomear o serviço, o produto ou a
 *    composição depois não reescreve as linhas já lançadas;
 *  - linha do orçamento: o mesmo, com os totais (desconto, ISS, serviço com materiais) pela mesma conta
 *    do salvar do formulário.
 *
 * TRAVA de registro fechado:
 *  - OS concluída, assinada, faturada ou com nota: a linha não se edita, não sai e não entra linha nova
 *    — cada caso com o seu motivo; marcar executado continua (é o que leva a OS ao faturamento);
 *  - orçamento: só o rascunho se edita; aprovado e convertido são registro fechado.
 *
 * RBAC: sem a permissão, 403; sem login, 401.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva2-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import {
  TRAVA_APROVADO, TRAVA_ASSINADA, TRAVA_CONCLUIDA, TRAVA_FATURADO, TRAVA_NOTA, TRAVA_LINHA_DO_ORCAMENTO, TRAVA_LINHA_EXECUTADA, TRAVA_LINHA_PECA,
  TRAVA_ORCAMENTO_CANCELADO, TRAVA_ORCAMENTO_ENVIADO, TRAVA_ORCAMENTO_REPROVADO,
} from "@/lib/edicao-contexto";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva2_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = empresaId === "e1" ? "u1" : "u2") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, url = "http://localhost/api/x") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const itens = (osId: string) => ({
  criar: (corpo: unknown) => chamar("ordens/[id]/orcamento", "POST", corpo, { id: osId }),
  regravar: (itemId: string, corpo: unknown) => chamar("ordens/[id]/orcamento/[itemId]", "PUT", corpo, { id: osId, itemId }),
  /** A edição "deste item" (uso) */
  editar: (itemId: string, corpo: unknown) => chamar("ordens/[id]/orcamento/[itemId]", "PATCH", corpo, { id: osId, itemId }),
  apagar: (itemId: string) => chamar("ordens/[id]/orcamento/[itemId]", "DELETE", undefined, { id: osId, itemId }),
  catalogo: (qs: string) => chamar("ordens/[id]/orcamento/catalogo", "GET", undefined, { id: osId }, `http://localhost/x?${qs}`),
});
const linhaOrc = (orcamentoId: string, linhaId: string, corpo: unknown) => chamar("orcamentos/[id]/linhas/[linhaId]", "PATCH", corpo, { id: orcamentoId, linhaId });
const n = (v: unknown) => Number(v);

describe.skipIf(!URL_PG)("Leva 2: editar no contexto na OS e no orçamento (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;
  const novaOs = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSL-${++seq}`, clienteId: "c1", unidadeId: "un1", criadoPorId: "u1", status: "EM_ANDAMENTO", origem: "MANUAL", descricao: "OS de teste", ...dados } });
  const item = (id: string) => prisma.osItemOrcamento.findUnique({ where: { id }, include: { materiais: { orderBy: { ordem: "asc" } } } });
  /** O catálogo como está — para provar que a edição da linha não o toca */
  const catalogo = async () => JSON.stringify({
    servicos: await prisma.servico.findMany({ orderBy: { id: "asc" }, include: { materiais: { orderBy: { ordem: "asc" } } } }),
    produtos: await prisma.produto.findMany({ orderBy: { id: "asc" } }),
    kits: await prisma.kitMaterial.findMany({ orderBy: { id: "asc" }, include: { itens: { orderBy: { ordem: "asc" } } } }),
  });
  /** OS com um serviço de catálogo com materiais (base 800 + ajuste 40 = 840; peça de 80 à parte) e uma linha livre */
  async function osComItens(dados: Record<string, unknown> = {}) {
    const os = await novaOs(dados);
    const { materiais } = (await itens(os.id).catalogo("servicoId=sInst")).json;
    const servico = (await itens(os.id).criar({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, materiais: materiais.map((m: any) => ({ ...m, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade })) })).json;
    const livre = (await itens(os.id).criar({ tipo: "SERVICO", descricao: "Visita técnica", quantidade: 2, valorUnitario: 100 })).json;
    const produto = (await itens(os.id).criar({ tipo: "PRODUTO", produtoId: "fita", descricao: "Fita", quantidade: 3, valorUnitario: 15 })).json;
    return { os, servico, peca: servico.pecas[0], livre, produto };
  }
  const fechar = (osId: string) => prisma.ordemServico.update({ where: { id: osId }, data: { status: "CONCLUIDA", dataConclusao: new Date() } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["clientes/[id]", "clientes/[id]/contatos", "clientes/[id]/contatos/[contatoId]", "unidades/[id]", "equipamentos/[id]", "ordens/[id]/orcamento", "ordens/[id]/orcamento/[itemId]",
      "ordens/[id]/orcamento/catalogo", "orcamentos", "orcamentos/[id]", "orcamentos/[id]/linhas/[linhaId]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1", issAliquota: 5 } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia Ltda", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "22101333000111", telefone: "(11) 3333-0000", email: "contato@hospital.com.br", observacoes: "Cliente antigo", cidade: "Santos" },
      { id: "c9", empresaId: "e2", nome: "Da outra", cpfCnpj: "33444555000100", telefone: "(21) 0000-0000" },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", nome: "Marta Lima", cargo: "Compras", telefone: "(11) 98888-0000", email: "marta@hospital.com.br", principal: true },
      { id: "ct9", empresaId: "e2", clienteId: "c9", nome: "Da outra" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz", logradouro: "Av. Paulista", numero: "1000", cidade: "São Paulo", estado: "SP", cep: "01310-100", principal: true, telefone: "(11) 3000-0000" },
      { id: "un9", empresaId: "e2", clienteId: "c9", nome: "Sede" },
    ] });
    await prisma.equipamento.createMany({ data: [
      { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "Dual Inverter", numeroSerie: "SN-001", capacidade: "12000", localizacao: "Recepção" },
      { id: "eq9", empresaId: "e2", unidadeId: "un9", tipo: "AR_CONDICIONADO_SPLIT", marca: "X", modelo: "Y" },
    ] });
    const pecas = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Peças", comportamento: "VENDA_A_PARTE" } });
    const mat = await prisma.categoriaProduto.create({ data: { empresaId: "e1", nome: "Materiais", comportamento: "INCLUSO_NO_SERVICO" } });
    const p = (id: string, nome: string, unidade: string, cat: string | null, valorPadrao: number) => prisma.produto.create({ data: { id, empresaId: "e1", nome, unidade, categoriaProdutoId: cat, valorPadrao, saldo: 10 } });
    await p("tubo", "Tubo de cobre 1/4", "m", mat.id, 20); await p("filtro", "Filtro secador", "un", mat.id, 35);
    await p("cap", "Capacitor 35uF", "un", pecas.id, 80); await p("fita", "Fita", "un", null, 15);
    const kit = await prisma.kitMaterial.create({ data: { empresaId: "e1", nome: "Kit instalação", itens: { create: [{ produtoId: "tubo", quantidade: 3, ordem: 0 }, { produtoId: "filtro", quantidade: 1, ordem: 1 }] } } });
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800, materiais: { create: [{ kitId: kit.id, quantidade: 1, ordem: 0 }, { produtoId: "cap", quantidade: 1, ordem: 1 }] } } });
    await prisma.servico.create({ data: { id: "sLimp", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza", valorPadrao: 150 } });
  }, 240_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });
  beforeEach(() => logar());

  /* ═════════ REFERÊNCIA ═════════ */
  describe("referência: edição parcial do cadastro-mãe", () => {
    it("cliente: só telefone, celular e e-mail; o que não veio não muda; vazio grava nulo; fora da lista = 400", async () => {
      const antes = await prisma.cliente.findUnique({ where: { id: "c1" } });
      const r = await chamar("clientes/[id]", "PATCH", { telefone: "(11) 4444-1111" }, { id: "c1" });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ id: "c1", nome: antes.nome, nomeFantasia: antes.nomeFantasia, telefone: "(11) 4444-1111", celular: null, email: "contato@hospital.com.br" });
      expect(await prisma.cliente.findUnique({ where: { id: "c1" } })).toMatchObject({ ...antes, telefone: "(11) 4444-1111", atualizadoEm: expect.anything() });
      // e-mail: minúsculo, e apagar é uma mudança (vira nulo)
      expect((await chamar("clientes/[id]", "PATCH", { email: "  Financeiro@Hospital.com.br ", celular: "(11) 97777-0000" }, { id: "c1" })).json).toMatchObject({ email: "financeiro@hospital.com.br", celular: "(11) 97777-0000", telefone: "(11) 4444-1111" });
      expect((await chamar("clientes/[id]", "PATCH", { celular: "" }, { id: "c1" })).json.celular).toBeNull();
      // estrito: nada além dos três campos entra por aqui
      const cadastro = await prisma.cliente.findUnique({ where: { id: "c1" } });
      for (const corpo of [{ nome: "Outro nome" }, { cpfCnpj: "00000000000000" }, { telefone: "1", empresaId: "e2" }, { email: "não é e-mail" }, { tabelaPrecoId: "x" }, { statusFinanceiro: "INADIMPLENTE" }, {}]) {
        expect((await chamar("clientes/[id]", "PATCH", corpo, { id: "c1" })).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(await prisma.cliente.findUnique({ where: { id: "c1" } })).toEqual(cadastro);
      // a inativação pelo PATCH { ativo } continua como sempre
      expect((await chamar("clientes/[id]", "PATCH", { ativo: "sim" }, { id: "c1" })).status).toBe(400);
      expect((await chamar("clientes/[id]", "PATCH", { ativo: true }, { id: "c1" })).json).toEqual({ ok: true, ativo: true });
    });

    it("contato do cliente: PATCH só do que mudou; adicionar pelo POST de sempre; de outro cliente = 404", async () => {
      const antes = await prisma.contatoCliente.findUnique({ where: { id: "ct1" } });
      const r = await chamar("clientes/[id]/contatos/[contatoId]", "PATCH", { telefone: "(11) 95555-1234" }, { id: "c1", contatoId: "ct1" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: "ct1", nome: "Marta Lima", cargo: "Compras", telefone: "(11) 95555-1234", email: "marta@hospital.com.br", principal: true });
      expect(r.json).not.toHaveProperty("senha");
      expect(await prisma.contatoCliente.findUnique({ where: { id: "ct1" } })).toMatchObject({ ...antes, telefone: "(11) 95555-1234", atualizadoEm: expect.anything() });
      expect((await chamar("clientes/[id]/contatos/[contatoId]", "PATCH", { cargo: "" }, { id: "c1", contatoId: "ct1" })).json.cargo).toBeNull();
      // campo proibido junto de um válido: recusa tudo (não grava o válido e ignora o resto)
      for (const corpo of [{ principal: false }, { tipo: "FINANCEIRO" }, { senha: "x" }, { nome: "A" }, {}, { telefone: "(11) 1", principal: false }, { cargo: "Novo", senha: "x" }]) {
        expect((await chamar("clientes/[id]/contatos/[contatoId]", "PATCH", corpo, { id: "c1", contatoId: "ct1" })).status, JSON.stringify(corpo)).toBe(400);
      }
      // contato de outro cliente/empresa pelo caminho deste cliente
      expect((await chamar("clientes/[id]/contatos/[contatoId]", "PATCH", { nome: "Invadido" }, { id: "c1", contatoId: "ct9" })).status).toBe(404);
      const novo = await chamar("clientes/[id]/contatos", "POST", { nome: "paulo souza", telefone: "(11) 91111-2222" }, { id: "c1" });
      expect(novo.status).toBe(201);
      expect(await prisma.contatoCliente.findUnique({ where: { id: novo.json.id } })).toMatchObject({ clienteId: "c1", empresaId: "e1", nome: "Paulo Souza", telefone: "(11) 91111-2222", principal: false });
    });

    it("unidade: nome e endereço; cliente, principal e telefone da unidade não são tocados", async () => {
      const antes = await prisma.unidade.findUnique({ where: { id: "un1" } });
      const r = await chamar("unidades/[id]", "PATCH", { numero: "1578", bairro: "Bela Vista" }, { id: "un1" });
      expect(r.status).toBe(200);
      expect(await prisma.unidade.findUnique({ where: { id: "un1" } })).toMatchObject({ ...antes, numero: "1578", bairro: "Bela Vista", atualizadoEm: expect.anything() });
      const gravada = await prisma.unidade.findUnique({ where: { id: "un1" } });
      // campo proibido junto de um válido: recusa tudo
      for (const corpo of [{ clienteId: "c9" }, { principal: false }, { nome: "" }, { latitude: 1 }, {}, { numero: "9", clienteId: "c9" }, { cidade: "Outra", principal: false }]) {
        expect((await chamar("unidades/[id]", "PATCH", corpo, { id: "un1" })).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(await prisma.unidade.findUnique({ where: { id: "un1" } })).toEqual(gravada);
      expect(gravada.clienteId).toBe("c1");
    });

    it("equipamento: identificação; tipo, unidade e dados técnicos não são tocados; série sem espaço nas pontas", async () => {
      const antes = await prisma.equipamento.findUnique({ where: { id: "eq1" } });
      const r = await chamar("equipamentos/[id]", "PATCH", { numeroSerie: "  SN-002 ", localizacao: "Sala 2" }, { id: "eq1" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: "eq1", marca: "LG", modelo: "Dual Inverter", numeroSerie: "SN-002", localizacao: "Sala 2", unidadeId: "un1" });
      expect(await prisma.equipamento.findUnique({ where: { id: "eq1" } })).toMatchObject({ ...antes, numeroSerie: "SN-002", localizacao: "Sala 2", atualizadoEm: expect.anything() });
      expect((await chamar("equipamentos/[id]", "PATCH", { nome: "Split da recepção", patrimonio: "PAT-9" }, { id: "eq1" })).json).toMatchObject({ nome: "Split da recepção", patrimonio: "PAT-9" });
      const gravado = await prisma.equipamento.findUnique({ where: { id: "eq1" } });
      // campo proibido junto de um válido: recusa tudo
      for (const corpo of [{ unidadeId: "un9" }, { tipo: "AR_CONDICIONADO_JANELA" }, { marca: "" }, { capacidade: "9000" }, { fotos: [] }, {}, { marca: "Outra", unidadeId: "un9" }, { modelo: "Outro", capacidade: "9000" }]) {
        expect((await chamar("equipamentos/[id]", "PATCH", corpo, { id: "eq1" })).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(await prisma.equipamento.findUnique({ where: { id: "eq1" } })).toEqual(gravado);
      expect(await prisma.equipamento.findUnique({ where: { id: "eq1" } })).toMatchObject({ unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", capacidade: "12000" });
    });

    it("multiempresa: o cadastro de outra empresa não é lido nem gravado", async () => {
      const foto = async () => JSON.stringify([await prisma.cliente.findUnique({ where: { id: "c9" } }), await prisma.unidade.findUnique({ where: { id: "un9" } }), await prisma.equipamento.findUnique({ where: { id: "eq9" } }), await prisma.contatoCliente.findUnique({ where: { id: "ct9" } })]);
      const antes = await foto();
      expect((await chamar("clientes/[id]", "PATCH", { telefone: "1" }, { id: "c9" })).status).toBe(404);
      expect((await chamar("clientes/[id]/contatos/[contatoId]", "PATCH", { nome: "Invadido" }, { id: "c9", contatoId: "ct9" })).status).toBe(404);
      expect((await chamar("unidades/[id]", "PATCH", { nome: "Invadida" }, { id: "un9" })).status).toBe(404);
      expect((await chamar("equipamentos/[id]", "PATCH", { marca: "Invadida" }, { id: "eq9" })).status).toBe(404);
      expect(await foto()).toBe(antes);
    });

    it("RBAC: editar cliente, contato e unidade exige Clientes › editar; equipamento, Equipamentos › editar; sem login, 401", async () => {
      const foto = async () => JSON.stringify([await prisma.cliente.findUnique({ where: { id: "c1" } }), await prisma.unidade.findUnique({ where: { id: "un1" } }), await prisma.equipamento.findUnique({ where: { id: "eq1" } }), await prisma.contatoCliente.findUnique({ where: { id: "ct1" } })]);
      const antes = await foto();
      const tentar = async () => [
        (await chamar("clientes/[id]", "PATCH", { telefone: "9" }, { id: "c1" })).status, (await chamar("clientes/[id]/contatos/[contatoId]", "PATCH", { nome: "Sem permissão" }, { id: "c1", contatoId: "ct1" })).status,
        (await chamar("unidades/[id]", "PATCH", { nome: "Sem permissão" }, { id: "un1" })).status, (await chamar("equipamentos/[id]", "PATCH", { marca: "Sem permissão" }, { id: "eq1" })).status,
      ];
      // quem opera OS e só VÊ clientes e equipamentos
      logar(montarPermissoes({ ordens: ["visualizar", "criar", "editar"], orcamentos: ["visualizar", "criar", "editar"], clientes: ["visualizar"], equipamentos: ["visualizar"] }));
      expect(await tentar()).toEqual([403, 403, 403, 403]);
      // cada cadastro com a permissão dele
      logar(montarPermissoes({ clientes: ["visualizar", "editar"] }));
      expect((await chamar("equipamentos/[id]", "PATCH", { marca: "Sem permissão" }, { id: "eq1" })).status).toBe(403);
      logar(montarPermissoes({ equipamentos: ["visualizar", "editar"] }));
      expect((await chamar("clientes/[id]", "PATCH", { telefone: "9" }, { id: "c1" })).status).toBe(403);
      expect((await chamar("unidades/[id]", "PATCH", { nome: "Sem permissão" }, { id: "un1" })).status).toBe(403);
      sessao.atual = null;
      expect(await tentar()).toEqual([401, 401, 401, 401]);
      expect(await foto()).toBe(antes);
    });
  });

  /* ═════════ USO: a linha da OS ═════════ */
  describe("uso: a linha da OS", () => {
    it("quantidade, preço e descrição mudam SÓ na linha: o catálogo fica intacto, e só o que veio muda", async () => {
      const { os, livre, produto } = await osComItens();
      const antes = await catalogo();
      const r = await itens(os.id).editar(produto.id, { quantidade: 5 });
      expect(r.status).toBe(200);
      expect(await item(produto.id)).toMatchObject({ descricao: "Fita", produtoId: "fita", tipo: "PRODUTO" });
      expect([n(r.json.quantidade), n(r.json.valorUnitario), n(r.json.valorTotal)]).toEqual([5, 15, 75]);
      // o preço aplicado NESTA OS — o produto do catálogo continua a 15
      expect((await itens(os.id).editar(produto.id, { valorUnitario: 22.5, descricao: " Fita isolante 19mm " })).status).toBe(200);
      const p = await item(produto.id);
      expect([p.descricao, n(p.quantidade), n(p.valorUnitario), n(p.valorTotal), p.produtoId]).toEqual(["Fita isolante 19mm", 5, 22.5, 112.5, "fita"]);
      expect(await prisma.produto.findUnique({ where: { id: "fita" } })).toMatchObject({ nome: "Fita", valorPadrao: expect.anything() });
      expect(n((await prisma.produto.findUnique({ where: { id: "fita" } })).valorPadrao)).toBe(15);
      // linha livre: o mesmo
      await itens(os.id).editar(livre.id, { quantidade: 3, valorUnitario: 120 });
      expect(n((await item(livre.id)).valorTotal)).toBe(360);
      expect(await catalogo()).toBe(antes);
      // a outra OS com o mesmo produto do catálogo não muda
      const outra = await osComItens();
      expect([n(outra.produto.valorUnitario), outra.produto.descricao]).toEqual([15, "Fita"]);
    });

    it("serviço com materiais: muda a base e o total (base + ajuste); o retrato dos materiais e a peça ficam como estão", async () => {
      const { os, servico, peca } = await osComItens();
      const materiaisAntes = JSON.stringify((await item(servico.id)).materiais);
      const pecaAntes = JSON.stringify(await item(peca.id));
      const antes = await catalogo();
      expect([n(servico.valorBase), n(servico.ajusteMateriais), n(servico.valorTotal)]).toEqual([800, 40, 840]);
      // preço base 800 → 900 nesta OS
      const r = await itens(os.id).editar(servico.id, { valorUnitario: 900 });
      expect(r.status).toBe(200);
      const s = await item(servico.id);
      expect([n(s.valorBase), n(s.ajusteMateriais), n(s.valorTotal), n(s.valorUnitario), s.valorManual, s.servicoId]).toEqual([900, 40, 940, 940, false, "sInst"]);
      // quantidade 1 → 2: a base dobra; os materiais não são multiplicados pela quantidade da linha
      await itens(os.id).editar(servico.id, { quantidade: 2 });
      const s2 = await item(servico.id);
      expect([n(s2.quantidade), n(s2.valorBase), n(s2.ajusteMateriais), n(s2.valorTotal), n(s2.valorUnitario)]).toEqual([2, 1800, 40, 1840, 920]);
      // o retrato copiado: mesmas linhas, mesmos ids, mesmos valores — e a peça derivada também
      expect(JSON.stringify(s2.materiais)).toBe(materiaisAntes);
      expect(JSON.stringify(await item(peca.id))).toBe(pecaAntes);
      expect(await catalogo()).toBe(antes);
      expect(n((await prisma.servico.findUnique({ where: { id: "sInst" } })).valorPadrao)).toBe(800);
    });

    it("total digitado à mão: a descrição e a quantidade mudam, o total fica; trocar o unitário é recusado", async () => {
      const os = await novaOs();
      const { materiais } = (await itens(os.id).catalogo("servicoId=sInst")).json;
      const manual = (await itens(os.id).criar({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação", quantidade: 1, valorUnitario: 800, valorTotal: 1000, valorManual: true, materiais })).json;
      expect([manual.valorManual, n(manual.valorTotal)]).toEqual([true, 1000]);
      const r = await itens(os.id).editar(manual.id, { valorUnitario: 700 });
      expect(r.status).toBe(400);
      expect(r.json.erro).toMatch(/valor manual/i);
      expect((await itens(os.id).editar(manual.id, { descricao: "Instalação com andaime", quantidade: 2 })).status).toBe(200);
      const m = await item(manual.id);
      expect([m.descricao, n(m.quantidade), m.valorManual, n(m.valorTotal), n(m.valorUnitario), m.materiais.length]).toEqual(["Instalação com andaime", 2, true, 1000, 500, materiais.length]);
    });

    it("o retrato copiado não muda com o catálogo: reprecificar, renomear e mexer na composição depois não reescreve a linha", async () => {
      const { os, servico, peca, produto } = await osComItens();
      const linhas = async () => JSON.stringify(await prisma.osItemOrcamento.findMany({ where: { ordemServicoId: os.id }, orderBy: { ordem: "asc" }, include: { materiais: { orderBy: { ordem: "asc" } } } }));
      const antes = await linhas();
      // o catálogo muda de verdade: preço, nome, preço dos materiais e a composição do serviço
      await prisma.servico.update({ where: { id: "sInst" }, data: { nome: "Instalação split (novo nome)", valorPadrao: 1500 } });
      await prisma.produto.update({ where: { id: "tubo" }, data: { nome: "Tubo novo", valorPadrao: 99 } });
      await prisma.produto.update({ where: { id: "cap" }, data: { valorPadrao: 300 } });
      await prisma.produto.update({ where: { id: "fita" }, data: { nome: "Fita nova", valorPadrao: 50 } });
      await prisma.servicoMaterial.deleteMany({ where: { servicoId: "sInst", produtoId: "cap" } });
      try {
        expect(await linhas()).toBe(antes);
        // uma OS NOVA pega o catálogo novo; a antiga continua com o retrato dela
        const nova = (await itens((await novaOs()).id).catalogo("servicoId=sInst")).json;
        expect([nova.valorUnitario, nova.descricao, nova.materiais.some((m: any) => m.produtoId === "cap")]).toEqual([1500, "Instalação split (novo nome)", false]);
        // editar a linha antiga (uso) também não puxa nada do catálogo novo
        expect((await itens(os.id).editar(servico.id, { quantidade: 2 })).status).toBe(200);
        const s = await item(servico.id);
        expect([s.descricao, n(s.valorBase), n(s.ajusteMateriais), n(s.valorTotal)]).toEqual(["Instalação split", 1600, 40, 1640]);
        expect(s.materiais.map((m: any) => [m.produtoId, m.descricao, n(m.valorVendaUnit)])).toEqual(JSON.parse(antes)[0].materiais.map((m: any) => [m.produtoId, m.descricao, n(m.valorVendaUnit)]));
        expect(s.materiais.find((m: any) => m.produtoId === "tubo")).toMatchObject({ descricao: "Tubo de cobre 1/4" });
        expect(n(s.materiais.find((m: any) => m.produtoId === "tubo").valorVendaUnit)).toBe(20);
        expect([(await item(peca.id)).descricao, n((await item(peca.id)).valorUnitario)]).toEqual(["Capacitor 35uF", 80]);
        await itens(os.id).editar(produto.id, { quantidade: 4 });
        expect([(await item(produto.id)).descricao, n((await item(produto.id)).valorUnitario), n((await item(produto.id)).valorTotal)]).toEqual(["Fita", 15, 60]);
      } finally {
        await prisma.servico.update({ where: { id: "sInst" }, data: { nome: "Instalação split", valorPadrao: 800, materiais: { create: [{ produtoId: "cap", quantidade: 1, ordem: 1 }] } } });
        await prisma.produto.update({ where: { id: "tubo" }, data: { nome: "Tubo de cobre 1/4", valorPadrao: 20 } });
        await prisma.produto.update({ where: { id: "cap" }, data: { valorPadrao: 80 } });
        await prisma.produto.update({ where: { id: "fita" }, data: { nome: "Fita", valorPadrao: 15 } });
      }
    });

    it("estrito e validado: campo fora da lista, quantidade zero, preço negativo e corpo vazio = 400, sem gravar; fica no histórico o que mudou", async () => {
      const { os, livre } = await osComItens();
      const antes = JSON.stringify(await item(livre.id));
      // (os três últimos: campo proibido junto de um válido — recusa tudo, não troca o serviço do catálogo por baixo do pano)
      for (const corpo of [{ servicoId: "sLimp" }, { produtoId: "fita" }, { tipo: "PRODUTO" }, { valorTotal: 1 }, { executado: true }, { materiais: [] }, { quantidade: 0 }, { quantidade: -1 }, { valorUnitario: -5 }, { descricao: "   " }, {},
        { quantidade: 7, servicoId: "sLimp" }, { quantidade: 7, executado: true }, { descricao: "Outra", valorTotal: 1 }]) {
        expect((await itens(os.id).editar(livre.id, corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(JSON.stringify(await item(livre.id))).toBe(antes);
      await itens(os.id).editar(livre.id, { quantidade: 4 });
      const h = await prisma.osHistorico.findFirst({ where: { ordemServicoId: os.id, acao: "Item da OS editado" }, orderBy: { criadoEm: "desc" } });
      expect(h).toMatchObject({ usuarioId: "u1" });
      expect(h.detalhes).toMatch(/^Visita técnica — quantidade: 2 → 4; total: R\$\s?200,00 → R\$\s?400,00$/);
    });

    it("linha que não se edita por ela mesma: peça derivada, item do orçamento aprovado e item executado", async () => {
      const { os, peca, livre, produto } = await osComItens();
      expect((await itens(os.id).editar(peca.id, { quantidade: 9 })).json).toEqual({ erro: TRAVA_LINHA_PECA });
      await prisma.osItemOrcamento.update({ where: { id: produto.id }, data: { executado: true } });
      expect((await itens(os.id).editar(produto.id, { quantidade: 9 })).json).toEqual({ erro: TRAVA_LINHA_EXECUTADA });
      // item copiado de um orçamento aprovado
      const orc = (await chamar("orcamentos", "POST", { clienteId: "c1", servicos: [{ descricao: "Do orçamento", quantidade: 1, valorUnitario: 50 }], produtos: [] })).json;
      const linha = await prisma.orcamentoServico.findFirst({ where: { orcamentoId: orc.id } });
      await prisma.osItemOrcamento.update({ where: { id: livre.id }, data: { orcamentoServicoId: linha.id } });
      const r = await itens(os.id).editar(livre.id, { quantidade: 9 });
      expect([r.status, r.json]).toEqual([400, { erro: TRAVA_LINHA_DO_ORCAMENTO }]);
      expect([n((await item(peca.id)).quantidade), n((await item(produto.id)).quantidade), n((await item(livre.id)).quantidade)]).toEqual([1, 3, 2]);
    });

    it("RBAC e empresa: sem Ordens › editar = 403; a OS de outra empresa = 404; item de outra OS = 404", async () => {
      const { os, livre } = await osComItens();
      const outra = await novaOs();
      logar(montarPermissoes({ ordens: ["visualizar", "concluir"], clientes: ["visualizar", "editar"] }));
      expect((await itens(os.id).editar(livre.id, { quantidade: 9 })).status).toBe(403);
      logar(permissoesTotais(), "e2");
      expect((await itens(os.id).editar(livre.id, { quantidade: 9 })).status).toBe(404);
      logar();
      expect((await itens(outra.id).editar(livre.id, { quantidade: 9 })).status).toBe(404);
      sessao.atual = null;
      expect((await itens(os.id).editar(livre.id, { quantidade: 9 })).status).toBe(401);
      expect(n((await item(livre.id)).quantidade)).toBe(2);
    });
  });

  /* ═════════ TRAVA: registro fechado ═════════ */
  describe("trava de registro fechado na OS", () => {
    /** Tudo o que tentaria mexer nas linhas — e o que a rota respondeu */
    async function tentativas(osId: string, itemId: string) {
      return {
        editar: await itens(osId).editar(itemId, { quantidade: 9 }),
        regravar: await itens(osId).regravar(itemId, { quantidade: 9 }),
        apagar: await itens(osId).apagar(itemId),
        incluir: await itens(osId).criar({ tipo: "SERVICO", descricao: "Depois de fechada", quantidade: 1, valorUnitario: 10 }),
      };
    }
    const linhasDa = async (osId: string) => JSON.stringify(await prisma.osItemOrcamento.findMany({ where: { ordemServicoId: osId }, orderBy: { ordem: "asc" }, include: { materiais: { orderBy: { ordem: "asc" } } } }));

    it.each([
      ["concluída", TRAVA_CONCLUIDA, async (_os: any) => {}],
      ["assinada pelo cliente", TRAVA_ASSINADA, async (os: any) => { await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: os.id, token: `tk-${os.id}`, situacao: "CONFIRMADO" } }); }],
      ["faturada", TRAVA_FATURADO, async (os: any) => {
        const med = await prisma.medicao.create({ data: { empresaId: "e1", clienteId: "c1", numero: `M-${os.numero}`, tokenPublico: `tp-${os.id}` } });
        await prisma.medicaoItem.create({ data: { medicaoId: med.id, ordemServicoId: os.id, descricao: "OS", valorUnitario: 10, valorTotal: 10 } });
      }],
      ["com nota fiscal emitida", TRAVA_NOTA, async (os: any) => {
        await prisma.notaFiscal.create({ data: { empresaId: "e1", clienteId: "c1", ordemServicoId: os.id, origem: "OS", ambiente: "HOMOLOGACAO", status: "CONCLUIDO", grupo: "g", valorServicos: 10, discriminacao: "x", tomadorCpfCnpj: "22101333000111", tomadorNome: "Hospital" } });
      }],
    ])("OS %s: não edita, não regrava, não apaga e não entra linha — com o motivo dito; nada muda no banco", async (_nome, motivo, fecharComo) => {
      const { os, livre } = await osComItens();
      await fechar(os.id);
      await fecharComo(os);
      const antes = await linhasDa(os.id);
      const t = await tentativas(os.id, livre.id);
      for (const [acao, r] of Object.entries(t)) expect([acao, r.status, r.json], acao).toEqual([acao, 400, { erro: motivo }]);
      expect(await linhasDa(os.id)).toBe(antes);
    });

    it("OS assinada sem estar com o status concluído (aceite colhido em campo) também trava", async () => {
      const { os, livre } = await osComItens();
      await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: os.id, token: `tk2-${os.id}`, situacao: "CONFIRMADO" } });
      expect((await itens(os.id).editar(livre.id, { quantidade: 9 })).json).toEqual({ erro: TRAVA_ASSINADA });
    });

    it("o que NÃO trava: aceite pendente, fatura cancelada e nota rejeitada — a OS aberta continua editável", async () => {
      const { os, livre } = await osComItens();
      await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: os.id, token: `tk3-${os.id}`, situacao: "PENDENTE" } });
      const med = await prisma.medicao.create({ data: { empresaId: "e1", clienteId: "c1", numero: `MC-${os.numero}`, tokenPublico: `tpc-${os.id}`, status: "CANCELADA" } });
      await prisma.medicaoItem.create({ data: { medicaoId: med.id, ordemServicoId: os.id, descricao: "OS", valorUnitario: 10, valorTotal: 10 } });
      for (const status of ["REJEITADO", "CANCELADO", "INTERROMPIDO"]) {
        await prisma.notaFiscal.create({ data: { empresaId: "e1", clienteId: "c1", ordemServicoId: os.id, origem: "OS", ambiente: "HOMOLOGACAO", status, grupo: status, valorServicos: 10, discriminacao: "x", tomadorCpfCnpj: "22101333000111", tomadorNome: "Hospital" } });
      }
      expect((await itens(os.id).editar(livre.id, { quantidade: 9 })).status).toBe(200);
      expect((await itens(os.id).criar({ tipo: "SERVICO", descricao: "Mais um", quantidade: 1, valorUnitario: 10 })).status).toBe(201);
      // nota a caminho (enviando) já trava: o que vai para a prefeitura não pode mudar
      await prisma.notaFiscal.create({ data: { empresaId: "e1", clienteId: "c1", ordemServicoId: os.id, origem: "OS", ambiente: "HOMOLOGACAO", status: "ENVIANDO", grupo: "env", valorServicos: 10, discriminacao: "x", tomadorCpfCnpj: "22101333000111", tomadorNome: "Hospital" } });
      expect((await itens(os.id).editar(livre.id, { quantidade: 5 })).json).toEqual({ erro: TRAVA_NOTA });
    });

    it("OS fechada: marcar executado continua (leva ao faturamento) e o cadastro-mãe continua editável — a trava é do uso", async () => {
      const { os, livre } = await osComItens();
      await fechar(os.id);
      const r = await itens(os.id).regravar(livre.id, { executado: true });
      expect([r.status, r.json.executado]).toEqual([200, true]);
      // referência: cliente, unidade e equipamento da OS fechada continuam corrigíveis no cadastro deles
      expect((await chamar("clientes/[id]", "PATCH", { telefone: "(11) 4000-0001" }, { id: "c1" })).status).toBe(200);
      expect((await chamar("unidades/[id]", "PATCH", { complemento: "Bloco B" }, { id: "un1" })).status).toBe(200);
      expect((await chamar("equipamentos/[id]", "PATCH", { localizacao: "UTI" }, { id: "eq1" })).status).toBe(200);
      expect((await chamar("clientes/[id]/contatos/[contatoId]", "PATCH", { cargo: "Diretoria" }, { id: "c1", contatoId: "ct1" })).status).toBe(200);
    });

    it("reabrir a OS destrava as linhas", async () => {
      const { os, livre } = await osComItens();
      await fechar(os.id);
      expect((await itens(os.id).editar(livre.id, { quantidade: 9 })).status).toBe(400);
      await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "EM_ANDAMENTO" } });
      expect((await itens(os.id).editar(livre.id, { quantidade: 9 })).status).toBe(200);
      expect(n((await item(livre.id)).quantidade)).toBe(9);
    });
  });

  /* ═════════ USO: a linha do orçamento ═════════ */
  describe("uso: a linha do orçamento", () => {
    async function novoOrcamento(extra: Record<string, unknown> = {}) {
      const { materiais } = (await itens((await novaOs()).id).catalogo("servicoId=sInst")).json;
      const r = await chamar("orcamentos", "POST", {
        clienteId: "c1", descontoServicos: 10, tipoDescontoServicos: "PERCENTUAL", descontoProdutos: 5, tipoDescontoProdutos: "VALOR",
        servicos: [
          { catalogoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, observacao: "Com andaime", materiais: materiais.map((m: any) => ({ ...m, quantidade: m.produtoId === "tubo" ? 5 : m.quantidade })) },
          { catalogoId: "sLimp", descricao: "Limpeza", quantidade: 2, valorUnitario: 150 },
        ],
        produtos: [{ catalogoId: "fita", descricao: "Fita", quantidade: 3, valorUnitario: 15 }],
        ...extra,
      });
      expect(r.status).toBe(201);
      return ler(r.json.id);
    }
    const ler = async (id: string) => prisma.orcamento.findUnique({ where: { id }, include: { servicos: { orderBy: { ordem: "asc" }, include: { materiais: { orderBy: { ordem: "asc" } } } }, produtos: { orderBy: { ordem: "asc" } } } });
    const totais = (o: any) => ({ servicos: n(o.totalServicos), produtos: n(o.totalProdutos), desconto: n(o.desconto), iss: n(o.valorIss), geral: n(o.totalGeral) });

    it("edita uma linha e os totais saem da MESMA conta do salvar do formulário (desconto, ISS, serviço com materiais)", async () => {
      const o = await novoOrcamento();
      const [inst, limp] = o.servicos;
      const antes = await catalogo();
      // Limpeza: 2 × 150 → 3 × 180
      const r = await linhaOrc(o.id, limp.id, { quantidade: 3, valorUnitario: 180, observacao: " Fora do horário comercial " });
      expect(r.status).toBe(200);
      expect(r.json.linha).toEqual({ id: limp.id, tipo: "SERVICO", descricao: "Limpeza", quantidade: 3, valorUnitario: 180, valorTotal: 540, observacao: "Fora do horário comercial" });
      const depois = await ler(o.id);
      // o que o formulário gravaria com a mesma mudança: um orçamento novo, igual, já com a linha alterada
      const esperado = await novoOrcamento({ servicos: undefined });
      const igual = await chamar("orcamentos/[id]", "PUT", {
        clienteId: "c1", descontoServicos: 10, tipoDescontoServicos: "PERCENTUAL", descontoProdutos: 5, tipoDescontoProdutos: "VALOR",
        servicos: [
          { catalogoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, observacao: "Com andaime", materiais: inst.materiais.map((m: any) => ({ produtoId: m.produtoId, descricao: m.descricao, unidade: m.unidade, comportamento: m.comportamento, quantidade: n(m.quantidade), quantidadePadrao: n(m.quantidadePadrao), valorVendaUnit: n(m.valorVendaUnit), custoUnit: m.custoUnit == null ? null : n(m.custoUnit), origem: m.origem, kitNome: m.kitNome })) },
          { catalogoId: "sLimp", descricao: "Limpeza", quantidade: 3, valorUnitario: 180, observacao: "Fora do horário comercial" },
        ],
        produtos: [{ catalogoId: "fita", descricao: "Fita", quantidade: 3, valorUnitario: 15 }],
      }, { id: esperado.id });
      expect(igual.status).toBe(200);
      expect(totais(depois)).toEqual(totais(await ler(esperado.id)));
      expect(r.json.totalGeral).toBe(totais(depois).geral);
      // e a conta bate à mão: serviços 840 + 540 = 1380; desconto 10% = 138; produtos 45 + peça 80 = 125, menos 5
      expect(totais(depois)).toMatchObject({ servicos: 1380, produtos: 125 });
      // só a linha editada mudou: as outras, os materiais e a peça ficaram como estavam (mesmos ids)
      expect(JSON.stringify(depois.servicos[0])).toBe(JSON.stringify(inst));
      expect(JSON.stringify(depois.produtos)).toBe(JSON.stringify(o.produtos));
      expect(depois.servicos[1]).toMatchObject({ id: limp.id, servicoId: "sLimp", ordem: limp.ordem });
      expect(await catalogo()).toBe(antes);
      expect(n((await prisma.servico.findUnique({ where: { id: "sLimp" } })).valorPadrao)).toBe(150);
    });

    it("serviço com materiais: o preço que muda é a BASE; o retrato dos materiais fica; produto e observação também se editam", async () => {
      const o = await novoOrcamento();
      const [inst] = o.servicos;
      const fita = o.produtos.find((p: any) => !p.materialId), peca = o.produtos.find((p: any) => p.materialId);
      expect((await linhaOrc(o.id, inst.id, { valorUnitario: 1000, descricao: "Instalação split 12.000 BTU" })).status).toBe(200);
      const d = await ler(o.id);
      expect([d.servicos[0].descricao, n(d.servicos[0].valorBase), n(d.servicos[0].ajusteMateriais), n(d.servicos[0].valorTotal), d.servicos[0].observacao]).toEqual(["Instalação split 12.000 BTU", 1000, 40, 1040, "Com andaime"]);
      expect(JSON.stringify(d.servicos[0].materiais)).toBe(JSON.stringify(inst.materiais));
      // produto do usuário
      const r = await linhaOrc(o.id, fita.id, { quantidade: 10, observacao: "" });
      expect(r.json.linha).toMatchObject({ tipo: "PRODUTO", quantidade: 10, valorUnitario: 15, valorTotal: 150, observacao: null });
      expect(n((await ler(o.id)).totalProdutos)).toBe(230);
      // a peça derivada segue os materiais do serviço
      expect((await linhaOrc(o.id, peca.id, { quantidade: 9 })).json).toEqual({ erro: TRAVA_LINHA_PECA });
      // mexer só na descrição não mexe em nenhum valor
      const antes = totais(await ler(o.id));
      await linhaOrc(o.id, fita.id, { descricao: "Fita isolante" });
      expect(totais(await ler(o.id))).toEqual(antes);
    });

    it("o retrato copiado não muda com o catálogo: reprecificar o serviço depois não reescreve o orçamento", async () => {
      const o = await novoOrcamento();
      await prisma.servico.update({ where: { id: "sLimp" }, data: { nome: "Limpeza premium", valorPadrao: 999 } });
      try {
        const d = await ler(o.id);
        expect([d.servicos[1].descricao, n(d.servicos[1].valorUnitario), n(d.totalGeral)]).toEqual(["Limpeza", 150, n(o.totalGeral)]);
        await linhaOrc(o.id, d.servicos[1].id, { quantidade: 4 });
        const e = await ler(o.id);
        expect([e.servicos[1].descricao, n(e.servicos[1].valorUnitario), n(e.servicos[1].valorTotal)]).toEqual(["Limpeza", 150, 600]);
      } finally {
        await prisma.servico.update({ where: { id: "sLimp" }, data: { nome: "Limpeza", valorPadrao: 150 } });
      }
    });

    it("só o rascunho se edita: enviado, reprovado e cancelado com a frase de cada um; aprovado e convertido são registro fechado", async () => {
      const o = await novoOrcamento();
      const linha = o.servicos[1];
      // linhas e totais (o status e a data de atualização o próprio teste muda)
      const retrato = async () => { const x = await ler(o.id); return JSON.stringify([x.servicos, x.produtos, totais(x)]); };
      const antes = await retrato();
      for (const [status, motivo] of [["ENVIADO", TRAVA_ORCAMENTO_ENVIADO], ["REPROVADO", TRAVA_ORCAMENTO_REPROVADO], ["CANCELADO", TRAVA_ORCAMENTO_CANCELADO], ["APROVADO", TRAVA_APROVADO], ["CONVERTIDA", TRAVA_APROVADO]]) {
        await prisma.orcamento.update({ where: { id: o.id }, data: { status } });
        const r = await linhaOrc(o.id, linha.id, { quantidade: 9 });
        expect([status, r.status, r.json]).toEqual([status, 400, { erro: motivo }]);
      }
      await prisma.orcamento.update({ where: { id: o.id }, data: { status: "RASCUNHO" } });
      expect(await retrato()).toBe(antes);
      expect((await linhaOrc(o.id, linha.id, { quantidade: 9 })).status).toBe(200);
    });

    it("orçamento já faturado (pela medição): registro fechado, mesmo se o status voltasse a rascunho", async () => {
      const o = await novoOrcamento();
      const med = await prisma.medicao.create({ data: { empresaId: "e1", clienteId: "c1", numero: `MO-${o.codigo}`, tokenPublico: `tpo-${o.id}` } });
      await prisma.medicaoItem.create({ data: { medicaoId: med.id, orcamentoId: o.id, descricao: "Orçamento", valorUnitario: 10, valorTotal: 10 } });
      expect((await linhaOrc(o.id, o.servicos[1].id, { quantidade: 9 })).json).toEqual({ erro: TRAVA_FATURADO });
    });

    it("estrito, validado, RBAC e empresa", async () => {
      const o = await novoOrcamento();
      const linha = o.servicos[1];
      const antes = JSON.stringify(await ler(o.id));
      // (os dois últimos: campo proibido junto de um válido — recusa tudo)
      for (const corpo of [{ catalogoId: "sInst" }, { servicoId: "sInst" }, { valorTotal: 1 }, { materiais: [] }, { quantidade: 0 }, { valorUnitario: -1 }, { descricao: "" }, {}, { quantidade: 7, catalogoId: "sInst" }, { quantidade: 7, valorTotal: 1 }]) {
        expect((await linhaOrc(o.id, linha.id, corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      expect((await linhaOrc(o.id, "nao-existe", { quantidade: 2 })).status).toBe(404);
      logar(montarPermissoes({ orcamentos: ["visualizar"], ordens: ["visualizar", "editar"] }));
      expect((await linhaOrc(o.id, linha.id, { quantidade: 2 })).status).toBe(403);
      logar(permissoesTotais(), "e2");
      expect((await linhaOrc(o.id, linha.id, { quantidade: 2 })).status).toBe(404);
      sessao.atual = null;
      expect((await linhaOrc(o.id, linha.id, { quantidade: 2 })).status).toBe(401);
      expect(JSON.stringify(await ler(o.id))).toBe(antes);
    });

    it("linha com total digitado (3 × 33,33 = 100,00): mudar só a descrição mantém o total; mudar o preço, mesmo em 1 centavo, recalcula", async () => {
      const r = await chamar("orcamentos", "POST", { clienteId: "c1", produtos: [], servicos: [{ descricao: "Antigo", quantidade: 3, valorUnitario: 33.33, valorTotal: 100 }] });
      const o = await ler(r.json.id);
      expect([n(o.servicos[0].valorTotal), n(o.totalServicos)]).toEqual([100, 100]);
      await linhaOrc(o.id, o.servicos[0].id, { descricao: "Antigo (revisado)" });
      expect([n((await ler(o.id)).servicos[0].valorTotal), n((await ler(o.id)).totalServicos)]).toEqual([100, 100]);
      await linhaOrc(o.id, o.servicos[0].id, { valorUnitario: 33.34 });
      const d = await ler(o.id);
      expect([n(d.servicos[0].valorUnitario), n(d.servicos[0].valorTotal), n(d.totalServicos)]).toEqual([33.34, 100.02, 100.02]);
      // 2 × 50,00 com total digitado 100,01. Preço novo 50,01: o total antigo ainda "bateria" com ele dentro do
      // arredondamento (100,01 × 100,02) — mas o preço mudou, então o total é o do preço novo, não o antigo
      const r2 = await chamar("orcamentos", "POST", { clienteId: "c1", produtos: [], servicos: [{ descricao: "Arredondado", quantidade: 2, valorUnitario: 50, valorTotal: 100.01 }] });
      const o2 = await ler(r2.json.id);
      expect(n(o2.servicos[0].valorTotal)).toBe(100.01);
      await linhaOrc(o2.id, o2.servicos[0].id, { valorUnitario: 50.01 });
      const d2 = await ler(o2.id);
      expect([n(d2.servicos[0].valorUnitario), n(d2.servicos[0].valorTotal), n(d2.totalServicos)]).toEqual([50.01, 100.02, 100.02]);
    });

    it("serviço com total digitado à mão: trocar o unitário é recusado; a descrição muda e o total fica", async () => {
      const { materiais } = (await itens((await novaOs()).id).catalogo("servicoId=sInst")).json;
      const r = await chamar("orcamentos", "POST", { clienteId: "c1", produtos: [], servicos: [{ catalogoId: "sInst", descricao: "Instalação", quantidade: 1, valorUnitario: 800, valorTotal: 1000, valorManual: true, materiais }] });
      const o = await ler(r.json.id);
      expect((await linhaOrc(o.id, o.servicos[0].id, { valorUnitario: 700 })).status).toBe(400);
      expect((await linhaOrc(o.id, o.servicos[0].id, { descricao: "Instalação em altura" })).status).toBe(200);
      const d = await ler(o.id);
      expect([d.servicos[0].descricao, d.servicos[0].valorManual, n(d.servicos[0].valorTotal), n(d.totalServicos)]).toEqual(["Instalação em altura", true, 1000, 1000]);
    });
  });
});
