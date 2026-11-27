/**
 * Implantação, leva 5 — lotes de importação e "Desfazer lote", com as rotas reais e o Prisma real num PostgreSQL real:
 *  - toda importação confirmada vira um lote (quem, quando, arquivo, contagens) com o que criou e o que atualizou,
 *    inclusive o que a gravação cria por conta própria (unidade "Principal", tipo de equipamento, cargo);
 *  - a prévia separa o que APAGA, o que FICA (com o motivo) e o que o lote só ATUALIZOU (nunca desfeito);
 *  - "em uso" = qualquer vínculo fora do próprio desfazer (lido do schema), inclusive os que apagariam em CASCATA;
 *  - alterado depois da importação fica; a unidade principal só sai junto com o cliente;
 *  - filhos antes dos pais; o que ficou segura o pai; o desfazer confere o uso de novo na hora de apagar;
 *  - estoque não se desfaz (o extrato nunca é apagado): só lista;
 *  - permissão (Configurações › Gerenciar + excluir do cadastro), módulo desligado, outra empresa;
 *  - o SQL pendente: 3×, aditivo e igual ao Prisma.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/implantacao-5-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { gerarCsv } from "@/lib/folha/planilha";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_implantacao5_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 90_000 });

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Zé", email: "ze@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const fmt = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const CNPJ_A = "11222333000181", CNPJ_B = "11444777000161", CNPJ_C = "45723174000110";
function cpf(base: string) {
  const d = base.split("").map(Number);
  const dv = (n: number) => { const s = d.slice(0, n).reduce((a, x, i) => a + x * (n + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  d.push(dv(9)); d.push(dv(10)); return d.join("");
}

type Planilha = (string | number | null)[][];
const csv = (linhas: Planilha, nome = "dados.csv") => new File([gerarCsv(linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))))], nome, { type: "text/csv" });

async function importar(entidade: string, arquivo: File, etapa: "previa" | "confirmar" = "confirmar") {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("etapa", etapa);
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const res: Response = await mod.POST(new NextRequest(`http://localhost/api/importacao/${entidade}`, { method: "POST", body: fd }), { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function lotes() {
  const mod = await import("@/app/api/importacao/lotes/route");
  const res: Response = await mod.GET();
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function previa(id: string) {
  const mod = await import("@/app/api/importacao/lotes/[id]/route");
  const res: Response = await mod.GET(new Request(`http://localhost/api/importacao/lotes/${id}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function desfazer(id: string) {
  const mod = await import("@/app/api/importacao/lotes/[id]/desfazer/route");
  const res: Response = await mod.POST(new Request(`http://localhost/api/importacao/lotes/${id}/desfazer`, { method: "POST" }), { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const rotulos = (xs: any[]) => xs.map((x) => `${x.entidade}:${x.rotulo}`).sort();
const motivosDe = (p: any, rotulo: string) => p.ficam.find((f: any) => f.rotulo === rotulo)?.motivos.join(" | ");

describe.skipIf(!URL_PG)("Implantação, leva 5 — lotes e desfazer (PostgreSQL real)", () => {
  let prisma: any;
  let esquecerModulos: (e?: string) => void;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ esquecerModulos } = await import("@/lib/modulos/servidor"));
    await Promise.all([
      import("@/app/api/importacao/[entidade]/route"), import("@/app/api/importacao/lotes/route"),
      import("@/app/api/importacao/lotes/[id]/route"), import("@/app/api/importacao/lotes/[id]/desfazer/route"),
    ]);
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    for (const m of ["importacaoLote", "movimentacaoEstoque", "qrcode", "interacaoCliente", "veiculo", "equipamento", "tipoEquipamentoCustom", "unidade", "contatoCliente", "cliente", "tecnico", "cargo", "produto", "empresaModulo", "usuario", "empresa"])
      await prisma[m].deleteMany({});
    esquecerModulos();
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Zé", email: "ze@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Ana", email: "ana@x.com", senha: "x" }] });
    logar();
  });

  const importarClientes = (nome = "clientes-ficticios.csv") => importar("clientes", csv([
    ["nome", "cnpj_cpf", "cidade"],
    ["Clínica Alfa (fictícia)", fmt(CNPJ_A), "Belo Horizonte"],
    ["Mercado Beta (fictício)", fmt(CNPJ_B), "Contagem"],
    ["Escola Gama (fictícia)", fmt(CNPJ_C), "Betim"],
  ], nome));
  const loteMaisNovo = async () => (await prisma.importacaoLote.findFirst({ where: { empresaId: "e1" }, orderBy: { criadoEm: "desc" }, include: { itens: true } }));

  it("toda importação confirmada vira um lote: quem, quando, arquivo, contagens, o criado e o atualizado (inclusive a Principal)", async () => {
    expect((await importarClientes()).json).toMatchObject({ criados: 3 });
    // A prévia não grava nada, nem lote
    await importar("clientes", csv([["nome", "cnpj_cpf"], ["X", fmt(CNPJ_A)]]), "previa");
    // Gravar sem o arquivo (uso interno, fora da tela de importação) não registra lote nem avisa de lote
    const { gravarImportacao } = await import("@/lib/importacao/servidor");
    const interno = await gravarImportacao("clientes", { linhas: [], resumo: { total: 0, criar: 0, atualizar: 0, erros: 0, avisos: 0 }, colunasIgnoradas: [], colunas: { cabecalho: [], ligadas: {}, faltando: [] } } as any, "e1");
    expect(interno.loteId).toBeUndefined();
    expect(interno.observacoes.join(" ")).not.toMatch(/lote/);
    expect(await prisma.importacaoLote.count()).toBe(1);
    const l1 = await loteMaisNovo();
    expect(l1).toMatchObject({ entidade: "clientes", arquivo: "clientes-ficticios.csv", usuarioId: "u1", criados: 3, atualizados: 0, comErro: 0, desfeitoEm: null });
    expect(l1.itens.map((i: any) => `${i.entidade}:${i.acao}:${i.linha ?? "-"}`).sort()).toEqual([
      "clientes:CRIADO:2", "clientes:CRIADO:3", "clientes:CRIADO:4", "unidades:CRIADO:-", "unidades:CRIADO:-", "unidades:CRIADO:-",
    ]);
    // Reimportar: o lote novo só ATUALIZOU
    const r = await importar("clientes", csv([["nome", "cnpj_cpf", "cidade"], ["Clínica Alfa (fictícia)", fmt(CNPJ_A), "Nova Lima"], ["Sem documento", "123", ""]], "de-novo.csv"));
    expect(r.json).toMatchObject({ atualizados: 1, comErro: 1, loteId: expect.any(String) });
    const l2 = await loteMaisNovo();
    expect(l2).toMatchObject({ arquivo: "de-novo.csv", atualizados: 1, comErro: 1 });
    expect(l2.itens.map((i: any) => i.acao)).toEqual(["ATUALIZADO"]);
    // A lista: da mais nova para a mais antiga, com quem importou e quantos criados ainda estão de pé
    const ls = await lotes();
    expect(ls.json.lotes.map((l: any) => [l.arquivo, l.quem, l.criados, l.atualizados, l.pendentes])).toEqual([["de-novo.csv", "Zé", 0, 1, 0], ["clientes-ficticios.csv", "Zé", 3, 0, 6]]);
    // Usuário da sessão que não está no banco: o lote fica sem "quem", a importação não quebra
    logar(permissoesTotais(), "e1", "fantasma");
    expect((await importar("clientes", csv([["nome", "cnpj_cpf"], ["Clínica Alfa (fictícia)", fmt(CNPJ_A)]], "f.csv"))).status).toBe(200);
    expect((await loteMaisNovo()).usuarioId).toBeNull();
  });

  it("desfazer: apaga só o criado sem uso; o usado fica com o motivo (mesmo vínculo em cascata); a Principal acompanha o cliente; atualizado só é listado", async () => {
    await importarClientes();
    const lote = await loteMaisNovo();
    const b = await prisma.cliente.findFirst({ where: { cpfCnpj: fmt(CNPJ_B) } });
    const c = await prisma.cliente.findFirst({ where: { cpfCnpj: fmt(CNPJ_C) } });
    // B tem uma interação (relação em CASCATA: apagar o cliente apagaria a interação junto — por isso B fica)
    await prisma.interacaoCliente.create({ data: { empresaId: "e1", clienteId: b.id, usuarioId: "u1", tipo: "LIGACAO", descricao: "Ligação de teste" } });
    // C foi alterado depois da importação
    await prisma.cliente.update({ where: { id: c.id }, data: { atualizadoEm: new Date(Date.now() + 60_000) } });
    // Um lote que só atualizou A
    await importar("clientes", csv([["nome", "cnpj_cpf", "cidade"], ["Clínica Alfa (fictícia)", fmt(CNPJ_A), "Nova Lima"]], "atualiza.csv"));
    const soAtualizou = await loteMaisNovo();

    const p = (await previa(lote.id)).json;
    expect(rotulos(p.apagar)).toEqual(["clientes:Clínica Alfa (fictícia)", "unidades:Principal — Clínica Alfa (fictícia)"]);
    // Filhos antes dos pais
    expect(p.apagar.map((i: any) => i.entidade)).toEqual(["unidades", "clientes"]);
    expect(motivosDe(p, "Mercado Beta (fictício)")).toBe("1 interações");
    expect(motivosDe(p, "Escola Gama (fictícia)")).toMatch(/alterado depois desta importação/);
    expect(motivosDe(p, "Principal — Mercado Beta (fictício)")).toBe("é a unidade principal de um cliente que fica");
    expect(motivosDe(p, "Principal — Escola Gama (fictícia)")).toBe("é a unidade principal de um cliente que fica");
    expect(p.atualizados).toEqual([]);
    // O lote que só atualizou: nada a apagar, só a lista
    const p2 = (await previa(soAtualizou.id)).json;
    expect(p2).toMatchObject({ apagar: [], ficam: [] });
    expect(rotulos(p2.atualizados)).toEqual(["clientes:Clínica Alfa (fictícia)"]);

    const d = await desfazer(lote.id);
    expect(d.json).toMatchObject({ ok: true, apagados: 2 });
    expect(await prisma.cliente.count({ where: { cpfCnpj: fmt(CNPJ_A) } })).toBe(0);
    expect(await prisma.cliente.count({ where: { id: { in: [b.id, c.id] } } })).toBe(2);
    expect(await prisma.interacaoCliente.count()).toBe(1); // a cascata não levou nada
    expect(await prisma.unidade.count({ where: { clienteId: { in: [b.id, c.id] } } })).toBe(2);
    const depois = await prisma.importacaoLote.findUnique({ where: { id: lote.id }, include: { itens: true } });
    expect(depois).toMatchObject({ apagados: 2, desfeitoPorId: "u1" });
    expect(depois.desfeitoEm).not.toBeNull();
    expect(depois.itens.filter((i: any) => i.desfeitoEm).length).toBe(2);
    // O lote que só atualizou (agora de um cliente que não existe mais): desfazer não apaga nada
    expect((await desfazer(soAtualizou.id)).json).toMatchObject({ apagados: 0 });
    // Desfazer de novo, depois que o uso sumiu: B sai (e a Principal dele junto)
    await prisma.interacaoCliente.deleteMany({});
    const p3 = (await previa(lote.id)).json;
    expect(rotulos(p3.apagar)).toEqual(["clientes:Mercado Beta (fictício)", "unidades:Principal — Mercado Beta (fictício)"]);
    expect((await desfazer(lote.id)).json).toMatchObject({ apagados: 2 });
    expect((await prisma.importacaoLote.findUnique({ where: { id: lote.id } })).apagados).toBe(4);
  });

  it("equipamentos: o com QR Code fica; o tipo personalizado criado pelo lote só sai se nenhum equipamento que fica o usa", async () => {
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Cliente Fictício", cpfCnpj: fmt(CNPJ_A), tipoPessoa: "JURIDICA" } });
    await prisma.unidade.create({ data: { id: "u1p", empresaId: "e1", clienteId: "c1", nome: "Principal", principal: true } });
    const r = await importar("equipamentos", csv([
      ["cnpj_cpf", "tipo", "marca", "modelo", "numero_serie"],
      [CNPJ_A, "piso teto", "Midea", "MPT-60", "PT-1"],
      [CNPJ_A, "piso teto", "Midea", "MPT-60", "PT-2"],
      [CNPJ_A, "cassete", "Daikin", "FCQ", "CS-1"],
    ], "equipamentos.csv"));
    expect(r.json).toMatchObject({ criados: 3 });
    const lote = await loteMaisNovo();
    expect(lote.itens.filter((i: any) => i.entidade === "tiposEquipamento").length).toBe(2);
    const pt1 = await prisma.equipamento.findFirst({ where: { numeroSerie: "PT-1" } });
    await prisma.qrcode.create({ data: { empresaId: "e1", codigo: "QR-1", equipamentoId: pt1.id } });
    const p = (await previa(lote.id)).json;
    expect(motivosDe(p, "Midea MPT-60")).toBe("QR Code");
    expect(motivosDe(p, "Piso-Teto")).toBe("1 equipamentos");
    expect(rotulos(p.apagar)).toEqual(["equipamentos:Daikin FCQ", "equipamentos:Midea MPT-60", "tiposEquipamento:Cassete"]);
    expect(p.apagar.map((i: any) => i.entidade)).toEqual(["equipamentos", "equipamentos", "tiposEquipamento"]);
    await desfazer(lote.id);
    expect((await prisma.equipamento.findMany({ select: { numeroSerie: true } })).map((e: any) => e.numeroSerie)).toEqual(["PT-1"]);
    expect((await prisma.tipoEquipamentoCustom.findMany({ select: { nome: true } })).map((t: any) => t.nome)).toEqual(["Piso-Teto"]);
    expect(await prisma.qrcode.count()).toBe(1);
    // O tipo que JÁ existia (Piso-Teto ficou) não entra no próximo lote: só o equipamento
    await importar("equipamentos", csv([["cnpj_cpf", "tipo", "marca", "modelo", "numero_serie"], [CNPJ_A, "piso teto", "Midea", "MPT-80", "PT-9"]], "mais.csv"));
    expect((await loteMaisNovo()).itens.map((i: any) => `${i.entidade}:${i.acao}`)).toEqual(["equipamentos:CRIADO"]);
  });

  it("colaborador e cargo criados: o colaborador que é responsável de veículo fica (e o cargo dele também); desfazendo os veículos antes, os dois saem", async () => {
    await importar("colaboradores", csv([["nome", "cpf", "telefone", "cargo"], ["Rafael (fictício)", cpf("731004501"), "31988880101", "Encarregado"]], "colaboradores.csv"));
    const lColab = await loteMaisNovo();
    expect(lColab.itens.map((i: any) => `${i.entidade}:${i.acao}`).sort()).toEqual(["cargos:CRIADO", "colaboradores:CRIADO"]);
    await importar("veiculos", csv([["placa", "modelo", "responsavel_cpf"], ["FRV1A23", "Fiorino", cpf("731004501")]], "veiculos.csv"));
    const lVeic = await loteMaisNovo();
    const p = (await previa(lColab.id)).json;
    expect(motivosDe(p, "Rafael (fictício)")).toBe("1 veículos sob responsabilidade");
    expect(motivosDe(p, "Encarregado")).toBe("1 colaboradores");
    expect((await desfazer(lColab.id)).json.apagados).toBe(0);
    // O mais novo primeiro: veículos, depois colaboradores
    expect((await desfazer(lVeic.id)).json.apagados).toBe(1);
    expect((await desfazer(lColab.id)).json.apagados).toBe(2);
    expect(await prisma.tecnico.count()).toBe(0);
    expect(await prisma.cargo.count()).toBe(0);
  });

  it("estoque: o lote só ATUALIZOU produtos — nada é apagado, o extrato fica e a prévia explica como corrigir", async () => {
    await prisma.produto.create({ data: { id: "p1", empresaId: "e1", codigo: 1, nome: "Gás R22" } });
    await importar("estoque", csv([["codigo", "produto", "quantidade"], ["1", "", "5"]], "estoque.csv"));
    const lote = await loteMaisNovo();
    expect(lote.itens.map((i: any) => `${i.entidade}:${i.acao}`)).toEqual(["produtos:ATUALIZADO"]);
    const p = (await previa(lote.id)).json;
    expect(p).toMatchObject({ apagar: [], ficam: [], atualizados: [expect.objectContaining({ rotulo: "Gás R22" })] });
    expect(p.nota).toMatch(/importe a planilha de novo com o saldo certo/);
    expect((await desfazer(lote.id)).json.apagados).toBe(0);
    expect(await prisma.movimentacaoEstoque.count()).toBe(1);
    expect(Number((await prisma.produto.findUnique({ where: { id: "p1" } })).saldo)).toBe(5);
  });

  it("permissão: lotes pedem Configurações › Gerenciar; sem excluir clientes, os clientes ficam; módulo desligado; outra empresa = 404", async () => {
    await importarClientes();
    const lote = await loteMaisNovo();
    logar(montarPermissoes({ configuracoes: ["visualizar"], clientes: ["visualizar", "criar", "editar", "excluir"] }));
    expect((await lotes()).status).toBe(403);
    expect((await previa(lote.id)).status).toBe(403);
    expect((await desfazer(lote.id)).status).toBe(403);
    logar(montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], clientes: ["visualizar"] }));
    const p = (await previa(lote.id)).json;
    expect(p.apagar).toEqual([]);
    expect(p.ficam.every((f: any) => f.motivos.join() === "você não tem permissão para excluir clientes")).toBe(true);
    expect((await desfazer(lote.id)).json.apagados).toBe(0);
    expect(await prisma.cliente.count()).toBe(3);
    // Outra empresa não enxerga nem desfaz o lote
    logar(permissoesTotais(), "e2", "u2");
    expect((await previa(lote.id)).status).toBe(404);
    expect((await desfazer(lote.id)).status).toBe(404);
    expect((await lotes()).json.lotes).toEqual([]);
    // Módulo Equipamentos desligado: o equipamento do lote fica (o desfazer não mexe em módulo desligado)
    logar();
    await prisma.unidade.updateMany({ data: {} });
    const c = await prisma.cliente.findFirst({ where: { cpfCnpj: fmt(CNPJ_A) } });
    await importar("equipamentos", csv([["cnpj_cpf", "marca", "modelo", "numero_serie"], [CNPJ_A, "LG", "S4", "LG-1"]]));
    const lEq = await loteMaisNovo();
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "equipamentos", ativo: false } }); esquecerModulos();
    expect(motivosDe((await previa(lEq.id)).json, "LG S4")).toBe("o módulo de equipamentos está desligado");
    // e o desfazer (que reconfere na hora) também não apaga
    expect((await desfazer(lEq.id)).json.apagados).toBe(0);
    expect(await prisma.equipamento.count({ where: { numeroSerie: "LG-1" } })).toBe(1);
    expect(c).toBeTruthy();
  });

  it("o desfazer confere de novo na hora: o que passou a ser usado entre a prévia e o clique fica (com a Principal dele)", async () => {
    await importarClientes();
    const lote = await loteMaisNovo();
    const { desfazerLote, previaDesfazer } = await import("@/lib/importacao/lotes");
    const ctx = { empresaId: "e1", usuarioId: "u1", pode: () => true, temModulo: () => true };
    const a = await prisma.cliente.findFirst({ where: { cpfCnpj: fmt(CNPJ_A) } });
    // a prévia que a pessoa viu: a Clínica Alfa ia sair
    expect((await previaDesfazer(lote.id, ctx))!.apagar.map((x) => x.rotulo)).toContain("Clínica Alfa (fictícia)");
    // entre a prévia e o clique, alguém registra uma interação com ela
    await prisma.interacaoCliente.create({ data: { empresaId: "e1", clienteId: a!.id, usuarioId: "u1", tipo: "EMAIL", descricao: "Chegou no meio" } });
    const r = await desfazerLote(lote.id, ctx);
    expect(r!.ficam.find((f) => f.rotulo === "Clínica Alfa (fictícia)")?.motivos).toEqual(["1 interações"]);
    expect(await prisma.cliente.count({ where: { id: a!.id } })).toBe(1);
    expect(await prisma.unidade.count({ where: { clienteId: a!.id, principal: true } })).toBe(1);
    expect(await prisma.interacaoCliente.count()).toBe(1);
  });

  it("tudo ou nada: se um registro some no meio do desfazer, nada é apagado e o lote segue pendente", async () => {
    await importarClientes();
    const lote = await loteMaisNovo();
    const { desfazerLote } = await import("@/lib/importacao/lotes");
    const ctx = { empresaId: "e1", usuarioId: "u1", pode: () => true, temModulo: () => true };
    const antes = await prisma.cliente.count();
    // a exclusão de clientes "não acha" o registro (como se outra tela o tivesse apagado no meio); as unidades já saíram
    const real = prisma.$transaction.bind(prisma);
    const espiao = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, o: unknown) =>
      real(async (tx: any) => fn(new Proxy(tx, {
        get: (t, k) => (k === "cliente" ? new Proxy(t.cliente, { get: (d, m) => (m === "deleteMany" ? async () => ({ count: 0 }) : d[m]) }) : t[k]),
      })), o)) as any);
    await expect(desfazerLote(lote.id, ctx)).rejects.toThrow(/mudou durante o desfazer/);
    // pela rota: 409 com a mensagem (e nada apagado)
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, o: unknown) =>
      real(async (tx: any) => fn(new Proxy(tx, {
        get: (t, k) => (k === "cliente" ? new Proxy(t.cliente, { get: (d, m) => (m === "deleteMany" ? async () => ({ count: 0 }) : d[m]) }) : t[k]),
      })), o)) as any);
    const d = await desfazer(lote.id);
    expect(d.status).toBe(409);
    expect(d.json.erro).toMatch(/mudou durante o desfazer\. Tente de novo\./);
    espiao.mockRestore();
    expect(await prisma.cliente.count()).toBe(antes);
    expect(await prisma.unidade.count()).toBeGreaterThanOrEqual(3);
    const l = await prisma.importacaoLote.findUnique({ where: { id: lote.id } });
    expect(l!.desfeitoEm).toBeNull();
    expect(l!.apagados).toBe(0);
  });

  it("SQL pendente (2027-01-30_importacao_lotes): 3×, aditivo, não apaga lotes, igual ao que o Prisma espera", () => {
    const ARQ = path.join(RAIZ, "prisma/sql/2027-01-30_importacao_lotes.sql");
    const SQLS = `${SCHEMA}_sql`;
    const psql = (args: string[]) => execFileSync("psql", [URL_PG!, "-q", "-At", "-v", "ON_ERROR_STOP=1", ...args], { env: { ...process.env, PGOPTIONS: `-c search_path=${SQLS}` } }).toString().trim();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SQLS} CASCADE; CREATE SCHEMA ${SQLS};`]);
    psql(["-c", `CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY); CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY); INSERT INTO "empresas" VALUES ('e1'); INSERT INTO "usuarios" VALUES ('u1');`]);
    for (let i = 0; i < 3; i++) psql(["-f", ARQ]);
    psql(["-c", `INSERT INTO "importacao_lotes" ("id","empresa_id","usuario_id","entidade","arquivo") VALUES ('l1','e1','u1','clientes','a.csv'); INSERT INTO "importacao_lote_itens" ("id","lote_id","empresa_id","entidade","registro_id","acao") VALUES ('i1','l1','e1','clientes','c1','CRIADO');`]);
    psql(["-f", ARQ]);
    expect(psql(["-c", `SELECT count(*) FROM "importacao_lote_itens"`])).toBe("1");
    // Apagar o usuário não apaga o lote: o "quem" fica vazio
    psql(["-c", `DELETE FROM "usuarios" WHERE id = 'u1'`]);
    expect(psql(["-c", `SELECT coalesce("usuario_id", '-') FROM "importacao_lotes"`])).toBe("-");
    const descrever = (schema: string) => execFileSync("psql", [URL_PG!, "-q", "-At", "-c", `
      SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' || is_nullable || ':' || coalesce(column_default, ''), ' ' ORDER BY table_name, column_name)
      FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name IN ('importacao_lotes', 'importacao_lote_itens');
      SELECT string_agg(indexname || '=' || replace(indexdef, '${schema}.', ''), ' ' ORDER BY indexname) FROM pg_indexes WHERE schemaname = '${schema}' AND tablename IN ('importacao_lotes', 'importacao_lote_itens');
      SELECT string_agg(conname || '=' || pg_get_constraintdef(c.oid), ' ' ORDER BY conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = '${schema}' AND conrelid::regclass::text IN ('importacao_lotes', 'importacao_lote_itens', '${schema}.importacao_lotes', '${schema}.importacao_lote_itens');`]).toString().replaceAll(`${schema}.`, "").trim();
    expect(descrever(SQLS)).toBe(descrever(SCHEMA));
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SQLS} CASCADE;`]);
  });
});
