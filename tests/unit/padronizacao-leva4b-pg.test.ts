/**
 * PADRONIZAÇÃO — LEVA 4B: Veículos, Colaboradores e Equipes, pelas ROTAS reais com PostgreSQL real.
 *
 * Prioridade nº 1 da leva: botão destrutivo (Inativar/Excluir) ou de ação sensível só para quem pode —
 * e o SERVIDOR recusa de qualquer jeito. Aqui fica travado o lado do servidor:
 *
 *  - quem só VISUALIZA veículos, equipes e configurações leva 403 em TODA rota que grava, inativa ou
 *    reativa nas telas da leva — e o banco inteiro fica idêntico (todas as tabelas); sem login, 401;
 *  - checklist de veículo PREENCHIDO (o conserto 1): detalhe, edição, exclusão reversível e reativação,
 *    cada um com a sua permissão; o alerta e a situação são recalculados no servidor; o inativado sai
 *    da lista e das contagens, não se edita, e volta inteiro ao reativar;
 *  - responsável técnico (o conserto 2): o cadastro rápido cria o colaborador já com o tipo e o CREA, e
 *    o "editar no contexto" muda só nome, telefone e CREA (o resto da ficha não é tocado);
 *  - formulário de OS e modelo de checklist inativados (o conserto 3): a leitura devolve os inativos
 *    sob filtro e o Reativar os traz de volta inteiros;
 *  - equipe: o "editar no contexto" muda só o nome (membros e veículos ficam).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva4b-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { ERRO_CHECKLIST_INATIVO } from "@/lib/veiculos/checklist";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva4b_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "u1" : "u2", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

/** Vê as telas da leva; não preenche, não gerencia, não exclui */
const SO_VE = montarPermissoes({ veiculos: ["visualizar"], equipes: ["visualizar"], configuracoes: ["visualizar"] });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const COLABORADOR = { nome: "Invasor Silva", cpf: "111.444.777-35", telefone: "(11) 90000-0000" };
const VEICULO = { placa: "INV4D00", modelo: "Invadido" };
const MODELO = { nome: "Invadido", frequencia: "DIARIO", itens: [{ categoria: "Motor", descricao: "Óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"] }] };

/** Toda chamada que GRAVA nas telas da leva: [nome, rota, método, corpo, params, query] */
const GRAVACOES: [string, string, string, unknown, Record<string, string>, string?][] = [
  ["checklist preenchido: preencher", "checklists", "POST", { veiculoId: "v1", templateId: "ck1", itens: [{ itemTemplateId: "i1", valor: "OK" }] }, {}],
  ["checklist preenchido: editar", "checklists/[id]", "PUT", { itens: [{ itemTemplateId: "i1", valor: "NOK" }] }, { id: "p1" }],
  ["checklist preenchido: excluir (inativar)", "checklists/[id]", "DELETE", undefined, { id: "p1" }],
  ["checklist preenchido: reativar", "checklists/[id]", "PATCH", { ativo: true }, { id: "p2" }],
  ["veículo: criar", "veiculos", "POST", VEICULO, {}],
  ["veículo: editar", "veiculos/[id]", "PUT", VEICULO, { id: "v1" }],
  ["veículo: inativar", "veiculos/[id]", "DELETE", undefined, { id: "v1" }],
  ["veículo: reativar", "veiculos/[id]", "PATCH", { ativo: true }, { id: "v2" }],
  ["manutenção: registrar", "veiculos/[id]/manutencoes", "POST", { tipo: "PREVENTIVA", descricao: "Invadida", dataRealizacao: "2026-01-10" }, { id: "v1" }],
  ["manutenção: excluir", "veiculos/[id]/manutencoes", "DELETE", undefined, { id: "v1" }, "?manutencaoId=m1"],
  ["colaborador: criar (o cadastro rápido usa esta)", "tecnicos", "POST", COLABORADOR, {}],
  ["responsável técnico: criar pelo cadastro rápido", "tecnicos", "POST", { ...COLABORADOR, tipo: "RESPONSAVEL_TECNICO", crea: "999-D/SP" }, {}],
  ["colaborador: editar no contexto", "tecnicos/[id]", "PATCH", { nome: "Invadido" }, { id: "t1" }],
  ["colaborador: inativar", "tecnicos/[id]", "DELETE", undefined, { id: "t1" }],
  ["colaborador: reativar", "tecnicos/[id]", "PATCH", { ativo: true }, { id: "t3" }],
  ["equipe: criar", "equipes", "POST", { nome: "Invadida" }, {}],
  ["equipe: editar", "equipes/[id]", "PUT", { nome: "Invadida" }, { id: "eqA" }],
  ["equipe: editar no contexto", "equipes/[id]", "PATCH", { nome: "Invadida" }, { id: "eqA" }],
  ["equipe: inativar", "equipes/[id]", "DELETE", undefined, { id: "eqA" }],
  ["equipe: reativar", "equipes/[id]", "PATCH", { ativo: true }, { id: "eqB" }],
  ["montador: salvar a composição", "equipes/montador", "POST", { equipes: [{ id: "eqA", chave: "eqA", nome: "Invadida", cor: "#0EA5E9", liderId: null, membroIds: [] }] }, {}],
  ["dados da empresa: trocar o responsável técnico", "empresa", "PUT", { nome: "Invadida", responsavelTecnicoId: "t2" }, {}],
  ["app do colaborador: salvar", "configuracoes", "PUT", { appEsconderValores: false }, {}],
  ["formulário: criar", "formularios", "POST", { nome: "Invadido" }, {}],
  ["formulário: editar", "formularios/[id]", "PUT", { nome: "Invadido" }, { id: "f1" }],
  ["formulário: inativar", "formularios/[id]", "DELETE", undefined, { id: "f1" }],
  ["formulário: reativar", "formularios/[id]", "PUT", { ativo: true }, { id: "f2" }],
  ["modelo de checklist: criar", "checklist-templates", "POST", MODELO, {}],
  ["modelo de checklist: editar", "checklist-templates/[id]", "PUT", { nome: "Invadido" }, { id: "ck1" }],
  ["modelo de checklist: inativar", "checklist-templates/[id]", "DELETE", undefined, { id: "ck1" }],
  ["modelo de checklist: reativar", "checklist-templates/[id]", "PUT", { ativo: true }, { id: "ck2" }],
];

describe.skipIf(!URL_PG)("Leva 4B: Veículos, Colaboradores e Equipes — o servidor recusa quem não pode (PostgreSQL real)", () => {
  let prisma: any;

  /** O banco INTEIRO num retrato: uma assinatura por tabela (qualquer linha que mude, em qualquer tabela, aparece) */
  async function retrato(): Promise<Record<string, string>> {
    const tabelas: { table_name: string }[] = await prisma.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_type = 'BASE TABLE' ORDER BY table_name`);
    const r: Record<string, string> = {};
    for (const { table_name: t } of tabelas) {
      const [{ h }]: { h: string }[] = await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${SCHEMA}"."${t}" x`);
      r[t] = h;
    }
    return r;
  }
  const INATIVADO_EM = new Date("2026-03-01T12:00:00Z");
  /** Os checklists preenchidos de volta ao estado inicial (os testes que gravam não vazam para os seguintes) */
  async function checklistsIniciais() {
    await prisma.checklistPreenchido.deleteMany({ where: { id: { notIn: ["p1", "p2", "p9"] } } });
    await prisma.checklistPreenchido.update({ where: { id: "p1" }, data: { status: "CONCLUIDO", colaboradorId: "t1", observacaoGeral: "Tudo certo", editadoEm: null, editadoPorId: null, inativadoEm: null, inativadoPorId: null } });
    await prisma.checklistPreenchido.update({ where: { id: "p2" }, data: { inativadoEm: INATIVADO_EM, inativadoPorId: "u1" } });
    await prisma.checklistItemPreenchido.update({ where: { id: "r1" }, data: { valor: "OK", foto: null, alerta: false } });
    await prisma.checklistItemPreenchido.update({ where: { id: "r2" }, data: { valor: "Cheio", foto: null, alerta: false } });
    await prisma.checklistItemPreenchido.update({ where: { id: "r3" }, data: { valor: "Sem ruído", foto: null, alerta: false } });
    await prisma.checklistItemPreenchido.update({ where: { id: "r4" }, data: { valor: null, foto: "data:image/png;base64,FOTO", alerta: false } });
  }
  const p1 = () => prisma.checklistPreenchido.findUnique({ where: { id: "p1" }, include: { itens: { orderBy: { id: "asc" } } } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([...new Set(GRAVACOES.map(([, rota]) => rota))].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Motorista", cpf: "529.982.247-25", telefone: "(11) 91111-1111", rg: "12.345.678-9" },
      { id: "t2", empresaId: "e1", nome: "Eng. Rosa Lima", cpf: "390.533.447-05", telefone: "(11) 92222-2222", tipo: "RESPONSAVEL_TECNICO", crea: "5012345-D/SP" },
      { id: "t3", empresaId: "e1", nome: "Antigo Inativo", cpf: "153.509.460-56", telefone: "(11) 93333-3333", ativo: false, statusColaborador: "INATIVO" },
      { id: "t9", empresaId: "e2", nome: "Da outra empresa", cpf: "529.982.247-25", telefone: "(11) 94444-4444" },
    ] });
    await prisma.veiculo.createMany({ data: [
      { id: "v1", empresaId: "e1", placa: "FRV1A01", modelo: "Fiorino" },
      { id: "v2", empresaId: "e1", placa: "FRV2B02", modelo: "Saveiro", status: "INATIVO" },
      { id: "v9", empresaId: "e2", placa: "OUT9Z99", modelo: "Strada" },
    ] });
    await prisma.veiculoManutencao.create({ data: { id: "m1", veiculoId: "v1", descricao: "Troca de óleo", dataRealizacao: new Date("2026-01-05T12:00:00Z") } });
    await prisma.equipe.create({ data: { id: "eqA", empresaId: "e1", nome: "Equipe Alfa", liderId: "t1", membros: { connect: [{ id: "t1" }] }, veiculos: { connect: [{ id: "v1" }] } } });
    await prisma.equipe.create({ data: { id: "eqB", empresaId: "e1", nome: "Equipe Antiga", status: "INATIVA" } });
    await prisma.equipe.create({ data: { id: "eq9", empresaId: "e2", nome: "Da outra empresa" } });
    await prisma.checklistTemplate.createMany({ data: [
      { id: "ck1", empresaId: "e1", nome: "Checklist diário" },
      { id: "ck2", empresaId: "e1", nome: "Checklist antigo", ativo: false },
      { id: "ck9", empresaId: "e2", nome: "Da outra empresa" },
    ] });
    await prisma.checklistItemTemplate.createMany({ data: [
      { id: "i1", templateId: "ck1", categoria: "Motor", descricao: "Nível do óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem: 0 },
      { id: "i2", templateId: "ck1", categoria: "Motor", descricao: "Combustível", tipo: "NIVEL", opcoes: ["Cheio", "Meio", "Reserva"], obrigatorio: false, ordem: 1 },
      { id: "i3", templateId: "ck1", categoria: "Cabine", descricao: "Ruídos", tipo: "TEXTO", opcoes: [], obrigatorio: false, ordem: 2 },
      { id: "i4", templateId: "ck1", categoria: "Cabine", descricao: "Foto do painel", tipo: "FOTO", opcoes: [], obrigatorio: true, ordem: 3 },
      { id: "i5", templateId: "ck2", categoria: "Geral", descricao: "Item antigo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], ordem: 0 },
      { id: "i9", templateId: "ck9", categoria: "Geral", descricao: "Item da outra", tipo: "OK_NOK", opcoes: ["OK", "NOK"], ordem: 0 },
    ] });
    await prisma.checklistPreenchido.createMany({ data: [
      { id: "p1", empresaId: "e1", veiculoId: "v1", templateId: "ck1", colaboradorId: "t1", status: "CONCLUIDO", observacaoGeral: "Tudo certo" },
      { id: "p2", empresaId: "e1", veiculoId: "v1", templateId: "ck1", status: "COM_ALERTAS", inativadoEm: INATIVADO_EM, inativadoPorId: "u1" },
      { id: "p9", empresaId: "e2", veiculoId: "v9", templateId: "ck9", status: "CONCLUIDO" },
    ] });
    await prisma.checklistItemPreenchido.createMany({ data: [
      { id: "r1", checklistId: "p1", itemTemplateId: "i1", valor: "OK" },
      { id: "r2", checklistId: "p1", itemTemplateId: "i2", valor: "Cheio" },
      { id: "r3", checklistId: "p1", itemTemplateId: "i3", valor: "Sem ruído" },
      { id: "r4", checklistId: "p1", itemTemplateId: "i4", foto: "data:image/png;base64,FOTO" },
      { id: "r5", checklistId: "p2", itemTemplateId: "i1", valor: "NOK", alerta: true },
      { id: "r9", checklistId: "p9", itemTemplateId: "i9", valor: "OK" },
    ] });
    await prisma.formularioTemplate.createMany({ data: [
      { id: "f1", empresaId: "e1", nome: "Preventiva" },
      { id: "f2", empresaId: "e1", nome: "Formulário antigo", ativo: false },
      { id: "f9", empresaId: "e2", nome: "Da outra empresa", ativo: false },
    ] });
    await prisma.formularioCampo.createMany({ data: [
      { id: "fc1", formularioId: "f2", label: "Pressão", tipo: "NUMERO", ordem: 0 },
      { id: "fc2", formularioId: "f2", label: "Campo removido", tipo: "TEXTO_CURTO", ordem: 1, ativo: false },
    ] });
  }, 240_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });
  beforeEach(() => logar());

  describe("quem só visualiza: 403 em toda gravação, e nada muda no banco", () => {
    it.each(GRAVACOES)("%s", async (_nome, rota, metodo, corpo, params, query) => {
      const antes = await retrato();
      logar(SO_VE);
      const r = await chamar(rota, metodo, corpo, params, query);
      expect(r.status).toBe(403);
      expect(typeof r.json?.erro).toBe("string");
      expect(await retrato()).toEqual(antes);
    });
  });

  it("sem login: 401 em toda gravação, e nada muda no banco", async () => {
    const antes = await retrato();
    sessao.atual = null;
    for (const [nome, rota, metodo, corpo, params, query] of GRAVACOES) {
      expect([nome, (await chamar(rota, metodo, corpo, params, query)).status]).toEqual([nome, 401]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("quem só visualiza continua LENDO as listas e o detalhe do checklist", async () => {
    logar(SO_VE);
    for (const rota of ["veiculos", "equipes", "checklists", "checklist-templates", "formularios"]) expect([rota, (await chamar(rota, "GET")).status]).toEqual([rota, 200]);
    expect((await chamar("checklists/[id]", "GET", undefined, { id: "p1" })).status).toBe(200);
    expect((await chamar("checklists", "GET", undefined, {}, "?inativos=1")).status).toBe(200);
  });

  describe("checklist de veículo preenchido: detalhe, edição, exclusão reversível e reativação", () => {
    const VE = montarPermissoes({ veiculos: ["visualizar"] });
    const GERENCIA = montarPermissoes({ veiculos: ["visualizar", "gerenciar"] });
    const EXCLUI = montarPermissoes({ veiculos: ["visualizar", "excluir"] });
    beforeEach(checklistsIniciais);
    afterAll(checklistsIniciais);

    it("a lista traz só os ativos da empresa, sem as fotos, com a contagem de itens e de alertas; os inativos vêm sob filtro", async () => {
      logar(VE);
      const ativos = (await chamar("checklists", "GET")).json;
      expect(ativos.map((c: any) => c.id)).toEqual(["p1"]);
      expect(ativos[0]).toMatchObject({ status: "CONCLUIDO", totalItens: 4, alertas: 0, veiculo: { placa: "FRV1A01" }, template: { nome: "Checklist diário" }, colaborador: { nome: "João Motorista" } });
      expect(JSON.stringify(ativos)).not.toContain("base64");
      const inativos = (await chamar("checklists", "GET", undefined, {}, "?inativos=1")).json;
      expect(inativos.map((c: any) => c.id)).toEqual(["p2"]);
      expect(inativos[0]).toMatchObject({ totalItens: 1, alertas: 1, inativadoPor: { nome: "Ana" } });
      expect(inativos[0].inativadoEm).toBe(INATIVADO_EM.toISOString());
      // o filtro por veículo vale nas duas abas
      expect((await chamar("checklists", "GET", undefined, {}, "?veiculoId=v2")).json).toEqual([]);
      expect((await chamar("checklists", "GET", undefined, {}, "?veiculoId=v1&inativos=1")).json.map((c: any) => c.id)).toEqual(["p2"]);
    });

    it("detalhe: as respostas com o item do modelo e a foto; o de outra empresa não existe (404)", async () => {
      logar(VE);
      const r = await chamar("checklists/[id]", "GET", undefined, { id: "p1" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: "p1", observacaoGeral: "Tudo certo", veiculo: { placa: "FRV1A01", modelo: "Fiorino" }, colaborador: { id: "t1", nome: "João Motorista" }, editadoPor: null, inativadoPor: null });
      const itens = Object.fromEntries(r.json.itens.map((i: any) => [i.itemTemplateId, i]));
      expect(itens.i1).toMatchObject({ valor: "OK", alerta: false, itemTemplate: { descricao: "Nível do óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true } });
      expect(itens.i4).toMatchObject({ valor: null, foto: "data:image/png;base64,FOTO" });
      for (const metodo of ["GET", "PUT", "DELETE", "PATCH"]) {
        logar(permissoesTotais());
        expect([metodo, (await chamar("checklists/[id]", metodo, metodo === "PATCH" ? { ativo: true } : metodo === "PUT" ? { itens: [] } : undefined, { id: "p9" })).status]).toEqual([metodo, 404]);
      }
      expect((await prisma.checklistPreenchido.findUnique({ where: { id: "p9" } })).inativadoEm).toBeNull();
    });

    it("editar: grava as respostas, RECALCULA o alerta e a situação (a tela não decide) e registra quem editou", async () => {
      logar(GERENCIA);
      const r = await chamar("checklists/[id]", "PUT", {
        colaboradorId: null, observacaoGeral: "  Corrigido depois  ", status: "CONCLUIDO",
        // Como a tela manda: TODO item do checklist, e o de foto SEM a chave `foto` quando ela não mudou
        itens: [{ itemTemplateId: "i1", valor: "NOK", alerta: false }, { itemTemplateId: "i2", valor: "Reserva" }, { itemTemplateId: "i3", valor: "  " }, { itemTemplateId: "i4", valor: null }],
      }, { id: "p1" });
      expect(r.status).toBe(200);
      const c = await p1();
      expect(c).toMatchObject({ status: "COM_ALERTAS", colaboradorId: null, observacaoGeral: "Corrigido depois", editadoPorId: "u1", inativadoEm: null });
      expect(c.editadoEm).toBeInstanceOf(Date);
      expect(c.itens.map((i: any) => [i.id, i.valor, i.alerta])).toEqual([["r1", "NOK", true], ["r2", "Reserva", true], ["r3", null, false], ["r4", null, false]]);
      // a foto que não veio no corpo continua a mesma
      expect(c.itens[3].foto).toBe("data:image/png;base64,FOTO");
      expect(r.json).toMatchObject({ status: "COM_ALERTAS", editadoPor: { nome: "Ana" } });

      // voltar à primeira opção tira o alerta e a situação volta a Concluído
      expect((await chamar("checklists/[id]", "PUT", { itens: [{ itemTemplateId: "i1", valor: "OK" }, { itemTemplateId: "i2", valor: "Cheio" }] }, { id: "p1" })).status).toBe(200);
      const d = await p1();
      expect(d.status).toBe("CONCLUIDO");
      expect(d.itens.map((i: any) => i.alerta)).toEqual([false, false, false, false]);
      // o que não veio (observação, colaborador) fica como estava
      expect(d).toMatchObject({ observacaoGeral: "Corrigido depois", colaboradorId: null });
    });

    it("editar a foto: trocar grava a nova; tirar a de um item obrigatório é recusado e nada muda", async () => {
      logar(GERENCIA);
      expect((await chamar("checklists/[id]", "PUT", { itens: [{ itemTemplateId: "i4", foto: "data:image/png;base64,NOVA" }] }, { id: "p1" })).status).toBe(200);
      expect((await p1()).itens[3].foto).toBe("data:image/png;base64,NOVA");
      const antes = await retrato();
      const r = await chamar("checklists/[id]", "PUT", { itens: [{ itemTemplateId: "i4", foto: null }] }, { id: "p1" });
      expect([r.status, r.json.erro]).toEqual([400, "Anexe a foto: Foto do painel"]);
      expect(await retrato()).toEqual(antes);
    });

    it("editar recusado não grava nada: obrigatório vazio, item que não é do checklist, colaborador de outra empresa, corpo inválido", async () => {
      logar(GERENCIA);
      const antes = await retrato();
      const casos: [string, unknown, number, string][] = [
        ["obrigatório vazio", { itens: [{ itemTemplateId: "i1", valor: "" }] }, 400, "Preencha: Nível do óleo"],
        ["item de outro modelo", { itens: [{ itemTemplateId: "i9", valor: "OK" }] }, 400, "Item de checklist inválido."],
        ["item do modelo que este checklist não tem", { itens: [{ itemTemplateId: "i5", valor: "OK" }] }, 400, "Item de checklist inválido."],
        ["colaborador de outra empresa", { colaboradorId: "t9", itens: [] }, 400, "Colaborador inválido(a)."],
        ["corpo que não é um checklist", { itens: "tudo" }, 400, "Dados inválidos"],
      ];
      for (const [nome, corpo, status, erro] of casos) {
        const r = await chamar("checklists/[id]", "PUT", corpo, { id: "p1" });
        expect([nome, r.status, r.json.erro]).toEqual([nome, status, erro]);
      }
      expect(await retrato()).toEqual(antes);
    });

    it("excluir é reversível e exige Veículos › excluir: quem só gerencia não exclui; quem só exclui não edita nem reativa", async () => {
      const antes = await retrato();
      logar(GERENCIA);
      expect((await chamar("checklists/[id]", "DELETE", undefined, { id: "p1" })).status).toBe(403);
      logar(EXCLUI);
      expect((await chamar("checklists/[id]", "PUT", { itens: [{ itemTemplateId: "i1", valor: "NOK" }] }, { id: "p1" })).status).toBe(403);
      expect((await chamar("checklists/[id]", "PATCH", { ativo: true }, { id: "p2" })).status).toBe(403);
      expect(await retrato()).toEqual(antes);

      const r = await chamar("checklists/[id]", "DELETE", undefined, { id: "p1" });
      expect([r.status, r.json]).toEqual([200, { ok: true, ativo: false }]);
      const c = await p1();
      expect(c.inativadoPorId).toBe("u1");
      expect(c.inativadoEm).toBeInstanceOf(Date);
      // nada foi apagado: as respostas e a foto continuam
      expect(c.itens.map((i: any) => [i.valor, i.foto])).toEqual([["OK", null], ["Cheio", null], ["Sem ruído", null], [null, "data:image/png;base64,FOTO"]]);
      expect(c).toMatchObject({ status: "CONCLUIDO", observacaoGeral: "Tudo certo", colaboradorId: "t1" });
      // repetir não muda a data nem o autor da primeira vez
      logar(EXCLUI, "e1");
      expect((await chamar("checklists/[id]", "DELETE", undefined, { id: "p1" })).status).toBe(200);
      expect((await p1()).inativadoEm).toEqual(c.inativadoEm);
    });

    it("o inativado sai da lista e das contagens, não se edita (409), e o Reativar o devolve inteiro", async () => {
      const { contarAlertasVeiculos } = await import("@/lib/veiculo-server");
      const { whereAviso } = await import("@/lib/veiculo-listagem");
      const semChecklist = () => prisma.veiculo.count({ where: { empresaId: "e1", ...whereAviso("sem_checklist")! } });
      // p1 foi preenchido agora (hoje): o veículo v1 está em dia
      expect((await contarAlertasVeiculos("e1")).checklistPendente).toBe(0);
      expect(await semChecklist()).toBe(0);

      expect((await chamar("checklists/[id]", "DELETE", undefined, { id: "p1" })).status).toBe(200);
      expect((await chamar("checklists", "GET")).json).toEqual([]);
      expect((await chamar("checklists", "GET", undefined, {}, "?inativos=1")).json.map((c: any) => c.id).sort()).toEqual(["p1", "p2"]);
      // inativado é como não preenchido: o veículo volta a ficar pendente
      expect((await contarAlertasVeiculos("e1")).checklistPendente).toBe(1);
      expect(await semChecklist()).toBe(1);

      const antes = await retrato();
      const r = await chamar("checklists/[id]", "PUT", { itens: [{ itemTemplateId: "i1", valor: "NOK" }] }, { id: "p1" });
      expect([r.status, r.json.erro]).toEqual([409, ERRO_CHECKLIST_INATIVO]);
      // reativar pede exatamente { ativo: true }
      for (const corpo of [{ ativo: false }, {}, { ativo: "sim" }]) {
        const x = await chamar("checklists/[id]", "PATCH", corpo, { id: "p1" });
        expect([x.status, x.json.erro]).toEqual([400, "Ação inválida"]);
      }
      expect(await retrato()).toEqual(antes);

      const v = await chamar("checklists/[id]", "PATCH", { ativo: true }, { id: "p1" });
      expect([v.status, v.json]).toEqual([200, { ok: true, ativo: true }]);
      expect(await p1()).toMatchObject({ inativadoEm: null, inativadoPorId: null, status: "CONCLUIDO" });
      expect((await chamar("checklists", "GET")).json.map((c: any) => c.id)).toEqual(["p1"]);
      expect((await contarAlertasVeiculos("e1")).checklistPendente).toBe(0);
      expect(await semChecklist()).toBe(0);
    });

    it("com alertas: o inativado também sai da contagem de checklists com alerta de hoje", async () => {
      const { contarAlertasVeiculos } = await import("@/lib/veiculo-server");
      await prisma.checklistPreenchido.update({ where: { id: "p1" }, data: { status: "COM_ALERTAS" } });
      expect((await contarAlertasVeiculos("e1")).checklistsComAlertas).toBe(1);
      expect((await chamar("checklists/[id]", "DELETE", undefined, { id: "p1" })).status).toBe(200);
      expect((await contarAlertasVeiculos("e1")).checklistsComAlertas).toBe(0);
    });
  });

  describe("responsável técnico e colaborador pelo seletor (cadastrar na hora e editar no contexto)", () => {
    const GERENCIA = montarPermissoes({ equipes: ["visualizar", "gerenciar"] });
    beforeEach(() => logar(GERENCIA));
    const t = (id: string) => prisma.tecnico.findUnique({ where: { id }, include: { competencias: { select: { id: true } } } });

    it("o cadastro rápido cria o colaborador já como responsável técnico, com o CREA, e ele passa a servir de RT da empresa", async () => {
      const r = await chamar("tecnicos", "POST", { nome: "eng. carla souza", cpf: "168.995.350-09", telefone: "(11) 95555-5555", tipo: "RESPONSAVEL_TECNICO", crea: "7001-D/SP" });
      expect(r.status).toBe(201);
      expect(await t(r.json.id)).toMatchObject({ empresaId: "e1", tipo: "RESPONSAVEL_TECNICO", crea: "7001-D/SP", ativo: true });
      // é o que a rota de Dados da empresa exige do RT padrão: responsável técnico, ativo, desta empresa
      expect(await prisma.tecnico.count({ where: { id: r.json.id, empresaId: "e1", tipo: "RESPONSAVEL_TECNICO", ativo: true } })).toBe(1);
      await prisma.tecnico.delete({ where: { id: r.json.id } });
    });

    it("editar no contexto muda só nome, telefone e CREA — CPF, RG, tipo e o resto da ficha ficam", async () => {
      const antes = await t("t2");
      const r = await chamar("tecnicos/[id]", "PATCH", { nome: "eng. rosa lima santos", crea: "  5012345-D/RJ " }, { id: "t2" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: "t2", crea: "5012345-D/RJ", tipo: "RESPONSAVEL_TECNICO" });
      const depois = await t("t2");
      expect(depois.crea).toBe("5012345-D/RJ");
      expect(depois.nome).toBe(r.json.nome);
      expect(depois.nome).not.toBe(antes.nome);
      expect({ ...depois, nome: "", crea: "", atualizadoEm: null }).toEqual({ ...antes, nome: "", crea: "", atualizadoEm: null });
      expect((await chamar("tecnicos/[id]", "PATCH", { telefone: "(11) 96666-6666" }, { id: "t1" })).status).toBe(200);
      expect(await t("t1")).toMatchObject({ telefone: "(11) 96666-6666", nome: "João Motorista", rg: "12.345.678-9" });
      await prisma.tecnico.update({ where: { id: "t2" }, data: { nome: antes.nome, crea: antes.crea } });
      await prisma.tecnico.update({ where: { id: "t1" }, data: { telefone: "(11) 91111-1111" } });
    });

    it("recusado não grava: RT sem CREA, campo fora dos três, nada para alterar, valor ruim, outra empresa", async () => {
      const antes = await retrato();
      const casos: [string, string, unknown, number, string][] = [
        ["RT sem CREA", "t2", { crea: "  " }, 400, "Informe o CREA do responsável técnico."],
        ["campo fora dos três (CPF)", "t1", { nome: "Outro Nome", cpf: "000.000.000-00" }, 400, "Ação inválida"],
        ["campo fora dos três (tipo)", "t1", { tipo: "RESPONSAVEL_TECNICO" }, 400, "Ação inválida"],
        ["nada para alterar", "t1", {}, 400, "Ação inválida"],
        ["{ ativo: false } não inativa por aqui", "t1", { ativo: false }, 400, "Ação inválida"],
        ["nome curto demais", "t1", { nome: "A" }, 400, "Nome deve ter pelo menos 2 caracteres"],
        ["telefone curto demais", "t1", { telefone: "123" }, 400, "Telefone inválido"],
        ["colaborador de outra empresa", "t9", { nome: "Invadido" }, 404, "Não encontrado"],
      ];
      for (const [nome, id, corpo, status, erro] of casos) {
        const r = await chamar("tecnicos/[id]", "PATCH", corpo, { id });
        expect([nome, r.status, r.json.erro]).toEqual([nome, status, erro]);
      }
      expect(await retrato()).toEqual(antes);
    });

    it("técnico de campo pode ficar sem CREA (o campo é só do responsável técnico)", async () => {
      await prisma.tecnico.update({ where: { id: "t1" }, data: { crea: "X" } });
      expect((await chamar("tecnicos/[id]", "PATCH", { crea: "" }, { id: "t1" })).status).toBe(200);
      expect((await t("t1")).crea).toBeNull();
    });

    it("reativar pelo mesmo PATCH continua valendo ({ ativo: true })", async () => {
      expect((await chamar("tecnicos/[id]", "PATCH", { ativo: true }, { id: "t3" })).status).toBe(200);
      expect(await t("t3")).toMatchObject({ ativo: true, statusColaborador: "ATIVO" });
      await prisma.tecnico.update({ where: { id: "t3" }, data: { ativo: false, statusColaborador: "INATIVO" } });
    });
  });

  describe("equipe pelo seletor do veículo (cadastrar na hora e editar no contexto)", () => {
    const GERENCIA = montarPermissoes({ equipes: ["visualizar", "gerenciar"] });
    beforeEach(() => logar(GERENCIA));
    const eq = (id: string) => prisma.equipe.findUnique({ where: { id }, include: { membros: { select: { id: true } }, veiculos: { select: { id: true } } } });

    it("criar só com o nome: equipe ativa, sem membros nem veículos", async () => {
      const r = await chamar("equipes", "POST", { nome: "equipe sul" });
      expect(r.status).toBe(201);
      expect(await eq(r.json.id)).toMatchObject({ empresaId: "e1", status: "ATIVA", liderId: null, membros: [], veiculos: [] });
      await prisma.equipe.delete({ where: { id: r.json.id } });
    });

    it("editar no contexto muda só o nome: líder, membros e veículos ficam", async () => {
      const r = await chamar("equipes/[id]", "PATCH", { nome: "Equipe Alfa Norte" }, { id: "eqA" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: "eqA", nome: "Equipe Alfa Norte", status: "ATIVA" });
      expect(await eq("eqA")).toMatchObject({ nome: "Equipe Alfa Norte", liderId: "t1", membros: [{ id: "t1" }], veiculos: [{ id: "v1" }] });
      await prisma.equipe.update({ where: { id: "eqA" }, data: { nome: "Equipe Alfa" } });
    });

    it("recusado não grava: campo fora de nome e cor, nome vazio, cor inválida, outra empresa", async () => {
      const antes = await retrato();
      const casos: [string, string, unknown, number, string][] = [
        ["tirar os membros por aqui", "eqA", { nome: "X", membroIds: [] }, 400, "Ação inválida"],
        ["trocar o status por aqui", "eqA", { status: "INATIVA" }, 400, "Ação inválida"],
        ["nada para alterar", "eqA", {}, 400, "Ação inválida"],
        ["nome vazio", "eqA", { nome: "   " }, 400, "Nome é obrigatório"],
        ["cor inválida", "eqA", { cor: "vermelho" }, 400, "Cor inválida"],
        ["equipe de outra empresa", "eq9", { nome: "Invadida" }, 404, "Não encontrada"],
      ];
      for (const [nome, id, corpo, status, erro] of casos) {
        const r = await chamar("equipes/[id]", "PATCH", corpo, { id });
        expect([nome, r.status, r.json.erro]).toEqual([nome, status, erro]);
      }
      expect(await retrato()).toEqual(antes);
    });
  });

  describe("reativar o que foi inativado na Leva 3 (formulário de OS e modelo de checklist)", () => {
    const CONFIG = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
    beforeEach(() => logar(CONFIG));

    it("formulários: a leitura padrão traz só os ativos; ?inativos=1 traz só os inativados da empresa, com os campos ativos", async () => {
      expect((await chamar("formularios", "GET")).json.map((f: any) => f.id)).toEqual(["f1"]);
      const inativos = (await chamar("formularios", "GET", undefined, {}, "?inativos=1")).json;
      expect(inativos.map((f: any) => f.id)).toEqual(["f2"]);
      expect(inativos[0].campos.map((c: any) => c.id)).toEqual(["fc1"]);
    });

    it("formulário: Reativar devolve o inativado inteiro (nome e campos intactos); o de outra empresa, 404", async () => {
      const r = await chamar("formularios/[id]", "PUT", { ativo: true }, { id: "f2" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: "f2", nome: "Formulário antigo", ativo: true });
      expect(await prisma.formularioCampo.findMany({ where: { formularioId: "f2" }, orderBy: { id: "asc" }, select: { id: true, ativo: true, label: true } }))
        .toEqual([{ id: "fc1", ativo: true, label: "Pressão" }, { id: "fc2", ativo: false, label: "Campo removido" }]);
      expect((await chamar("formularios", "GET")).json.map((f: any) => f.id).sort()).toEqual(["f1", "f2"]);
      expect((await chamar("formularios", "GET", undefined, {}, "?inativos=1")).json).toEqual([]);
      // inativar de novo manda de volta para a aba Inativos
      expect((await chamar("formularios/[id]", "DELETE", undefined, { id: "f2" })).status).toBe(200);
      expect((await chamar("formularios", "GET", undefined, {}, "?inativos=1")).json.map((f: any) => f.id)).toEqual(["f2"]);

      expect((await chamar("formularios/[id]", "PUT", { ativo: true }, { id: "f9" })).status).toBe(404);
      expect((await prisma.formularioTemplate.findUnique({ where: { id: "f9" } })).ativo).toBe(false);
    });

    it("modelo de checklist: a leitura traz ativos e inativos (a tela separa nas abas) e o Reativar devolve o inativado inteiro", async () => {
      const lista = (await chamar("checklist-templates", "GET")).json;
      expect(lista.map((m: any) => [m.id, m.ativo])).toEqual([["ck2", false], ["ck1", true]]);
      const r = await chamar("checklist-templates/[id]", "PUT", { ativo: true }, { id: "ck2" });
      expect(r.status).toBe(200);
      expect(await prisma.checklistTemplate.findUnique({ where: { id: "ck2" }, include: { itens: { select: { id: true, ativo: true } } } }))
        .toMatchObject({ nome: "Checklist antigo", ativo: true, frequencia: "DIARIO", itens: [{ id: "i5", ativo: true }] });
      // reativado, volta a valer para preencher
      logar(montarPermissoes({ veiculos: ["visualizar", "checklist"] }));
      expect((await chamar("checklists", "POST", { veiculoId: "v1", templateId: "ck2", itens: [{ itemTemplateId: "i5", valor: "OK" }] })).status).toBe(201);
      await prisma.checklistPreenchido.deleteMany({ where: { templateId: "ck2" } });
      await prisma.checklistTemplate.update({ where: { id: "ck2" }, data: { ativo: false } });

      logar(CONFIG);
      expect((await chamar("checklist-templates/[id]", "PUT", { ativo: true }, { id: "ck9" })).status).toBe(404);
    });

    it("quem tem Frota › gerenciar (sem Configurações) também reativa o modelo; o formulário é só de Configurações", async () => {
      logar(montarPermissoes({ veiculos: ["visualizar", "gerenciar"] }));
      expect((await chamar("checklist-templates/[id]", "PUT", { ativo: true }, { id: "ck2" })).status).toBe(200);
      expect((await chamar("formularios/[id]", "PUT", { ativo: true }, { id: "f2" })).status).toBe(403);
      await prisma.checklistTemplate.update({ where: { id: "ck2" }, data: { ativo: false } });
    });
  });

  describe("manutenção do veículo (a tela só muda quando o servidor aceita)", () => {
    it("registrar e excluir exigem Veículos › gerenciar; a de outro veículo não é excluída", async () => {
      logar(montarPermissoes({ veiculos: ["visualizar", "gerenciar"] }));
      const r = await chamar("veiculos/[id]/manutencoes", "POST", { tipo: "PREVENTIVA", descricao: "Alinhamento", dataRealizacao: "2026-02-01" }, { id: "v1" });
      expect(r.status).toBe(201);
      expect(await prisma.veiculoManutencao.count({ where: { veiculoId: "v1" } })).toBe(2);
      // pelo veículo errado, a manutenção m1 (do v1) não sai
      await chamar("veiculos/[id]/manutencoes", "DELETE", undefined, { id: "v2" }, "?manutencaoId=m1");
      expect(await prisma.veiculoManutencao.count({ where: { id: "m1" } })).toBe(1);
      expect((await chamar("veiculos/[id]/manutencoes", "DELETE", undefined, { id: "v1" }, `?manutencaoId=${r.json.id}`)).status).toBe(200);
      expect(await prisma.veiculoManutencao.findMany({ where: { veiculoId: "v1" }, select: { id: true } })).toEqual([{ id: "m1" }]);
    });
  });
});
