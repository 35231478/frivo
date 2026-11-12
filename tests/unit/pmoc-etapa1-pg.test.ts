/**
 * PMOC — Etapa 1 (cadastro base): rotas reais com o Prisma real num PostgreSQL real (schema descartável
 * via `prisma db push`). Cobre só o que é desta etapa — identificação, RT/ART, equipamentos cobertos,
 * status e permissões do módulo `pmoc`:
 *  - criar nasce RASCUNHO, mesmo pedindo PUBLICADO; datas, unidade do cliente e RT da empresa são conferidos;
 *  - publicar exige nome do RT, CREA, nº da ART e ao menos 1 equipamento (422); publicado não fica sem equipamento;
 *  - equipamentos: só ativos e do mesmo cliente; sem repetir; excluir do plano não apaga o equipamento;
 *  - ART: PDF/JPG/PNG até 3 MB (Etapa 3: cabe no pedido e no documento); o arquivo nunca vem nas leituras, só no download;
 *  - cópia: Rascunho com os mesmos dados, RT e equipamentos, SEM a ART;
 *  - inativar (soft-delete) e reativar; inativo não aceita edição; o aviso de plano vigente;
 *  - RBAC: visualizar / criar / editar / excluir em cada rota; multiempresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pmoc-etapa1-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";
import { hojeISO } from "@/lib/pmoc";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pmoc_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", extra: Record<string, unknown> = {}) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null, ...extra } };
};
const comPmoc = (...acoes: Acao[]) => como(montarPermissoes({ pmoc: acoes }));

const ROTAS = { lista: "pmocs", item: "pmocs/[id]", equipamentos: "pmocs/[id]/equipamentos", copia: "pmocs/[id]/copia", impacto: "pmocs/[id]/impacto", art: "pmocs/[id]/art" } as const;
async function chamar(rota: keyof typeof ROTAS, metodo: string, op: { id?: string; corpo?: unknown; query?: string } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${ROTAS[rota]}/route`);
  const req = new NextRequest(`http://localhost/api/x${op.query ? `?${op.query}` : ""}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ id: op.id ?? "" }) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json() : null, res };
}

/** Hoje (Brasília) deslocado em dias, em aaaa-mm-dd */
const dia = (delta: number) => { const d = new Date(`${hojeISO()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); };
const PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 ART de teste").toString("base64")}`;
const base = (extra: Record<string, unknown> = {}) => ({ nome: "PMOC 2026 — Hospital (Matriz)", clienteId: "c1", unidadeId: "u1", dataInicio: dia(-30), dataExpiracao: dia(335), ...extra });
const RT = { rtNome: "Eng. Paula Reis", rtCrea: "SP-5061234567", artNumero: "28027230241234567" };

describe.skipIf(!URL_PG)("PMOC — Etapa 1: cadastro base (PostgreSQL real)", () => {
  let prisma: any;
  const criar = async (extra: Record<string, unknown> = {}) => { const r = await chamar("lista", "POST", { corpo: base(extra) }); expect(r.status, JSON.stringify(r.json)).toBe(201); return r.json.id as string; };
  const ler = (id: string) => prisma.pmoc.findUnique({ where: { id }, include: { equipamentos: true } });
  const vincular = (id: string, equipamentoIds: string[]) => chamar("equipamentos", "POST", { id, corpo: { equipamentoIds } });
  const salvar = (id: string, extra: Record<string, unknown> = {}) => chamar("item", "PUT", { id, corpo: base(extra) });
  /** Plano pronto: com RT, ART e um equipamento — e publicado */
  const publicado = async (extra: Record<string, unknown> = {}) => {
    const id = await criar({ ...RT, ...extra });
    expect((await vincular(id, ["q1"])).status).toBe(200);
    expect((await salvar(id, { ...RT, ...extra, status: "PUBLICADO" })).status).toBe(200);
    return id;
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "rt1", empresaId: "e1", nome: "Eng. Paula Reis", cpf: "1", telefone: "1", tipo: "RESPONSAVEL_TECNICO", crea: "SP-5061234567" },
      { id: "rtE2", empresaId: "e2", nome: "Eng. de outra empresa", cpf: "2", telefone: "2", tipo: "RESPONSAVEL_TECNICO", crea: "RJ-1" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "1" },
      { id: "c2", empresaId: "e1", nome: "Shopping Centro", cpfCnpj: "2" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
      { id: "u1b", empresaId: "e1", clienteId: "c1", nome: "Anexo" },
      { id: "u2", empresaId: "e1", clienteId: "c2", nome: "Loja 1" },
      { id: "uE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    const eq = (id: string, unidadeId: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: unidadeId === "uE2" ? "e2" : "e1", unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("q1", "u1", { nome: "Split da recepção", patrimonio: "TAG-001", capacidade: "48000", setor: "Térreo", localizacao: "Recepção" }),
      eq("q2", "u1", { patrimonio: "TAG-002" }),
      eq("q3", "u1b", { patrimonio: "TAG-003" }),          // outra unidade do MESMO cliente
      eq("qInativo", "u1", { ativo: false }),
      eq("qOutroCliente", "u2"),
      eq("qE2", "uE2"),
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    await prisma.pmoc.deleteMany({});
    como();
  });

  /* ───────── identificação ───────── */
  it("criar: nasce RASCUNHO e ativo, com quem criou — mesmo que o pedido venha como PUBLICADO", async () => {
    const id = await criar({ ...RT, status: "PUBLICADO", descricao: "Texto do plano" });
    expect(await ler(id)).toMatchObject({ empresaId: "e1", clienteId: "c1", unidadeId: "u1", status: "RASCUNHO", ativo: true, criadoPorId: "uA", rtNome: "Eng. Paula Reis", descricao: "Texto do plano", equipamentos: [] });
  });

  it("as datas ficam gravadas como DATA (sem hora): o dia não desloca pelo fuso", async () => {
    const id = await criar({ dataInicio: "2026-03-01", dataExpiracao: "2027-02-28" });
    const p = await ler(id);
    expect([p.dataInicio.toISOString(), p.dataExpiracao.toISOString()]).toEqual(["2026-03-01T00:00:00.000Z", "2027-02-28T00:00:00.000Z"]);
  });

  it("validação: nome curto, sem cliente, sem unidade, data inválida e expiração que não vem depois do início → 400, nada gravado", async () => {
    for (const ruim of [{ nome: "ab" }, { clienteId: "" }, { unidadeId: "" }, { dataInicio: "01/03/2026" }, { dataInicio: "2026-03-01", dataExpiracao: "2026-03-01" }, { dataInicio: "2026-03-01", dataExpiracao: "2026-02-01" }]) {
      const r = await chamar("lista", "POST", { corpo: base(ruim) });
      expect(r.status, JSON.stringify(ruim)).toBe(400);
      expect(typeof r.json.erro).toBe("string");
    }
    expect(await prisma.pmoc.count()).toBe(0);
  });

  it("vínculos: unidade de OUTRO cliente, cliente de outra empresa e RT de outra empresa são recusados", async () => {
    expect(await chamar("lista", "POST", { corpo: base({ unidadeId: "u2" }) })).toMatchObject({ status: 400, json: { erro: "A unidade/local não pertence a este cliente." } });
    expect((await chamar("lista", "POST", { corpo: base({ clienteId: "cE2", unidadeId: "uE2" }) })).status).toBe(400);
    expect(await chamar("lista", "POST", { corpo: base({ responsavelTecnicoId: "rtE2" }) })).toMatchObject({ status: 400, json: { erro: "Responsável técnico inválido." } });
    expect(await prisma.pmoc.count()).toBe(0);
  });

  it("RT: nome e CREA ficam gravados como TEXTO no plano (com vínculo opcional ao colaborador)", async () => {
    const id = await criar({ ...RT, responsavelTecnicoId: "rt1" });
    await prisma.tecnico.update({ where: { id: "rt1" }, data: { crea: "SP-NOVO" } });
    expect(await ler(id)).toMatchObject({ responsavelTecnicoId: "rt1", rtNome: "Eng. Paula Reis", rtCrea: "SP-5061234567" }); // o plano guarda o RT da época
    await prisma.tecnico.update({ where: { id: "rt1" }, data: { crea: "SP-5061234567" } });
  });

  /* ───────── equipamentos ───────── */
  it("equipamentos: entram os ativos do mesmo cliente (inclusive de outra unidade); repetir não duplica", async () => {
    const id = await criar();
    const r = await vincular(id, ["q1", "q2", "q3", "q1"]);
    expect(r.status).toBe(200);
    expect(r.json.equipamentos.map((v: any) => v.equipamento.id).sort()).toEqual(["q1", "q2", "q3"]);
    expect((await vincular(id, ["q2"])).json.equipamentos).toHaveLength(3);
    // O que a tela mostra de cada um: TAG, tipo, capacidade e ambiente — do cadastro real
    const q1 = r.json.equipamentos.find((v: any) => v.equipamento.id === "q1").equipamento;
    expect(q1).toMatchObject({ nome: "Split da recepção", patrimonio: "TAG-001", tipo: "AR_CONDICIONADO_SPLIT", capacidade: "48000", setor: "Térreo", localizacao: "Recepção", unidadeId: "u1", ativo: true });
  });

  it("equipamentos: inativo, de outro cliente ou de outra empresa → 400, e nenhum da seleção entra", async () => {
    const id = await criar();
    for (const ruim of ["qInativo", "qOutroCliente", "qE2", "nao-existe"]) {
      const r = await vincular(id, ["q1", ruim]);
      expect(r, ruim).toMatchObject({ status: 400, json: { erro: "Há equipamento(s) inativos ou de outro cliente na seleção." } });
    }
    expect((await vincular(id, [])).status).toBe(400);
    expect((await ler(id)).equipamentos).toEqual([]);
  });

  it("excluir do plano tira só o vínculo: o equipamento continua no cadastro", async () => {
    const id = await criar();
    await vincular(id, ["q1", "q2"]);
    const r = await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" });
    expect(r.status).toBe(200);
    expect(r.json.equipamentos.map((v: any) => v.equipamento.id)).toEqual(["q2"]);
    expect(await prisma.equipamento.findUnique({ where: { id: "q1" } })).toMatchObject({ id: "q1", ativo: true });
    expect((await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" })).status).toBe(404);
  });

  it("trocar o cliente com equipamentos vinculados é recusado (eles são do cliente atual)", async () => {
    const id = await criar();
    await vincular(id, ["q1"]);
    expect((await salvar(id, { clienteId: "c2", unidadeId: "u2" })).status).toBe(409);
    expect(await ler(id)).toMatchObject({ clienteId: "c1", unidadeId: "u1" });
    await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" });
    expect((await salvar(id, { clienteId: "c2", unidadeId: "u2" })).status).toBe(200);
  });

  /* ───────── status ───────── */
  it("publicar exige nome do RT, CREA, nº da ART e ao menos 1 equipamento — o servidor diz o que falta (422)", async () => {
    const id = await criar();
    const r = await salvar(id, { status: "PUBLICADO" });
    expect(r).toMatchObject({ status: 422, json: { erro: "Para publicar, falta: nome do Responsável Técnico, registro CREA do Responsável Técnico, número da ART, pelo menos 1 equipamento coberto." } });
    expect((await salvar(id, { ...RT, status: "PUBLICADO" })).json.erro).toBe("Para publicar, falta: pelo menos 1 equipamento coberto.");
    await vincular(id, ["q1"]);
    expect((await salvar(id, { ...RT, artNumero: "  ", status: "PUBLICADO" })).json.erro).toBe("Para publicar, falta: número da ART.");
    expect((await ler(id)).status).toBe("RASCUNHO");
    const ok = await salvar(id, { ...RT, status: "PUBLICADO" });
    expect(ok).toMatchObject({ status: 200, json: { status: "PUBLICADO" } });
  });

  it("publicado não fica sem equipamento: o último só sai depois de voltar para Rascunho", async () => {
    const id = await publicado();
    expect((await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" })).status).toBe(409);
    expect((await ler(id)).equipamentos).toHaveLength(1);
    expect((await salvar(id, { ...RT, status: "RASCUNHO" })).json.status).toBe("RASCUNHO");
    expect((await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" })).status).toBe(200);
  });

  it("Vigente e Expirado NÃO são gravados: o banco guarda só RASCUNHO ou PUBLICADO, e a data decide", async () => {
    const vigente = await publicado();
    const expirado = await publicado({ dataInicio: dia(-400), dataExpiracao: dia(-1) });
    const venceHoje = await publicado({ dataInicio: dia(-364), dataExpiracao: dia(0) });
    expect((await prisma.pmoc.findMany({ select: { status: true } })).map((p: any) => p.status)).toEqual(["PUBLICADO", "PUBLICADO", "PUBLICADO"]);
    const { filtroStatusPmoc, situacaoPmoc } = await import("@/lib/pmoc");
    const ids = async (status: string) => (await prisma.pmoc.findMany({ where: { empresaId: "e1", ...filtroStatusPmoc(status) }, select: { id: true } })).map((p: any) => p.id).sort();
    expect(await ids("VIGENTE")).toEqual([vigente, venceHoje].sort()); // o dia da expiração ainda vale
    expect(await ids("EXPIRADO")).toEqual([expirado]);
    expect(await ids("RASCUNHO")).toEqual([]);
    // O filtro da lista (SQL) e o selo (cálculo) concordam, plano a plano
    for (const p of await prisma.pmoc.findMany()) expect((await ids(situacaoPmoc(p).status)), p.id).toContain(p.id);
  });

  /* ───────── ART ───────── */
  it("ART: o arquivo é gravado, mas NUNCA vem nas leituras do editor — só no download", async () => {
    const id = await criar({ ...RT, artArquivo: PDF, artArquivoNome: "ART 2026.pdf" });
    expect(await ler(id)).toMatchObject({ artArquivoNome: "ART 2026.pdf", artArquivoTipo: "application/pdf", artArquivoTamanho: 21 });
    const get = await chamar("item", "GET", { id });
    expect(get.json).toMatchObject({ artArquivoNome: "ART 2026.pdf", artArquivoTipo: "application/pdf" });
    expect(JSON.stringify(get.json)).not.toContain("base64");
    expect("artArquivo" in get.json).toBe(false);
    const put = await salvar(id, RT); // salvar sem mandar arquivo mantém a ART
    expect(JSON.stringify(put.json)).not.toContain("base64");
    expect((await ler(id)).artArquivo).toBe(PDF);

    const baixar = await chamar("art", "GET", { id });
    expect(baixar.status).toBe(200);
    expect(baixar.res.headers.get("content-type")).toBe("application/pdf");
    expect(baixar.res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''ART%202026.pdf");
    expect(baixar.res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await baixar.res.arrayBuffer()).toString()).toBe("%PDF-1.4 ART de teste");
    expect((await chamar("art", "GET", { id, query: "inline=1" })).res.headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("ART: só PDF, JPG ou PNG, até 3 MB; excluir o arquivo limpa nome, tipo e tamanho", async () => {
    expect(await chamar("lista", "POST", { corpo: base({ artArquivo: `data:text/html;base64,${Buffer.from("<script>").toString("base64")}` }) })).toMatchObject({ status: 400, json: { erro: "A ART deve ser PDF, JPG ou PNG." } });
    expect(await chamar("lista", "POST", { corpo: base({ artArquivo: "isto não é um arquivo" }) })).toMatchObject({ status: 400, json: { erro: "Arquivo da ART inválido." } });
    const grande = `data:application/pdf;base64,${"A".repeat(Math.ceil((3 * 1024 * 1024 + 10) / 3) * 4)}`;
    expect(await chamar("lista", "POST", { corpo: base({ artArquivo: grande }) })).toMatchObject({ status: 413, json: { erro: "Arquivo da ART acima de 3 MB." } });
    expect(await prisma.pmoc.count()).toBe(0);

    const id = await criar({ artArquivo: PDF, artArquivoNome: "art.pdf" });
    expect((await salvar(id, { removerArt: true })).status).toBe(200);
    expect(await ler(id)).toMatchObject({ artArquivo: null, artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null });
    expect((await chamar("art", "GET", { id })).status).toBe(404);
  });

  /* ───────── cópia ───────── */
  it("criar cópia: Rascunho com os mesmos dados, RT e equipamentos — SEM a ART (número e arquivo)", async () => {
    const id = await publicado({ artArquivo: PDF, artArquivoNome: "art.pdf", responsavelTecnicoId: "rt1", descricao: "Texto" });
    await vincular(id, ["q2"]);
    const r = await chamar("copia", "POST", { id });
    expect(r.status).toBe(201);
    const [orig, copia] = [await ler(id), await ler(r.json.id)];
    expect(copia).toMatchObject({
      nome: "Cópia de PMOC 2026 — Hospital (Matriz)", status: "RASCUNHO", ativo: true, clienteId: "c1", unidadeId: "u1", descricao: "Texto",
      responsavelTecnicoId: "rt1", rtNome: RT.rtNome, rtCrea: RT.rtCrea, criadoPorId: "uA",
      artNumero: null, artArquivo: null, artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null,
    });
    expect([copia.dataInicio, copia.dataExpiracao]).toEqual([orig.dataInicio, orig.dataExpiracao]);
    expect(copia.equipamentos.map((v: any) => v.equipamentoId).sort()).toEqual(["q1", "q2"]);
    // O original fica como estava
    expect(orig).toMatchObject({ status: "PUBLICADO", artNumero: RT.artNumero, artArquivo: PDF });
  });

  /* ───────── inativar / reativar ───────── */
  it("inativar é soft-delete: o plano e os vínculos ficam no banco; inativo não aceita edição; reativar devolve", async () => {
    const id = await publicado();
    expect((await chamar("item", "DELETE", { id })).json).toEqual({ ok: true });
    expect(await ler(id)).toMatchObject({ ativo: false, status: "PUBLICADO", equipamentos: [expect.objectContaining({ equipamentoId: "q1" })] });
    expect(await salvar(id, RT)).toMatchObject({ status: 409, json: { erro: "PMOC inativo: reative antes de editar." } });
    expect((await vincular(id, ["q2"])).status).toBe(409);
    expect((await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" })).status).toBe(409);
    expect((await chamar("item", "PATCH", { id, corpo: { ativo: false } })).status).toBe(400); // PATCH só reativa
    expect((await chamar("item", "PATCH", { id, corpo: { ativo: true } })).json).toEqual({ ok: true });
    expect((await ler(id)).ativo).toBe(true);
    expect((await salvar(id, RT)).status).toBe(200);
  });

  it("o aviso de inativar: plano VIGENTE avisa que o cliente fica sem PMOC ativo; rascunho e expirado, não", async () => {
    const vigente = await publicado();
    const r = await chamar("impacto", "GET", { id: vigente });
    expect(r.json.bloqueio).toBeNull();
    expect(r.json.avisos).toEqual([
      `Este PMOC está vigente até ${dia(335).split("-").reverse().join("/")}.`,
      "Inativado, Hospital Santa Clara fica sem PMOC ativo neste local. A lei exige um plano em vigor.",
      "Os 1 equipamento(s) vinculados continuam no cadastro e no PMOC (nada é apagado).",
    ]);
    const rascunho = await criar();
    expect((await chamar("impacto", "GET", { id: rascunho })).json).toEqual({ bloqueio: null, avisos: [] });
    const expirado = await publicado({ dataInicio: dia(-400), dataExpiracao: dia(-1) });
    expect((await chamar("impacto", "GET", { id: expirado })).json.avisos).toEqual(["Os 1 equipamento(s) vinculados continuam no cadastro e no PMOC (nada é apagado)."]);
  });

  /* ───────── permissões (RBAC do módulo pmoc) ───────── */
  it("sem o módulo PMOC: todas as rotas respondem 403 e nada muda", async () => {
    const id = await publicado({ artArquivo: PDF });
    como(montarPermissoes({ equipamentos: ["visualizar", "criar", "editar", "excluir"], clientes: ["visualizar"] }));
    const chamadas = [
      chamar("lista", "POST", { corpo: base() }), chamar("item", "GET", { id }), chamar("item", "PUT", { id, corpo: base() }), chamar("item", "DELETE", { id }),
      chamar("item", "PATCH", { id, corpo: { ativo: true } }), chamar("equipamentos", "POST", { id, corpo: { equipamentoIds: ["q2"] } }),
      chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" }), chamar("copia", "POST", { id }), chamar("impacto", "GET", { id }), chamar("art", "GET", { id }),
    ];
    for (const r of await Promise.all(chamadas)) expect(r.status).toBe(403);
    expect(await prisma.pmoc.count()).toBe(1);
    expect(await ler(id)).toMatchObject({ ativo: true, status: "PUBLICADO" });
  });

  it("só visualizar: lê o plano e baixa a ART; criar, copiar, salvar, vincular, inativar e reativar → 403", async () => {
    const id = await publicado({ artArquivo: PDF });
    comPmoc("visualizar");
    expect((await chamar("item", "GET", { id })).status).toBe(200);
    expect((await chamar("art", "GET", { id })).status).toBe(200);
    for (const r of [
      await chamar("lista", "POST", { corpo: base() }), await chamar("copia", "POST", { id }), await chamar("item", "PUT", { id, corpo: base() }),
      await chamar("equipamentos", "POST", { id, corpo: { equipamentoIds: ["q2"] } }), await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" }),
      await chamar("item", "DELETE", { id }), await chamar("item", "PATCH", { id, corpo: { ativo: true } }), await chamar("impacto", "GET", { id }),
    ]) expect(r.status).toBe(403);
    expect(await prisma.pmoc.count()).toBe(1);
  });

  it("cada ação tem a sua permissão: criar (novo e cópia), editar (salvar, equipamentos, reativar), excluir (inativar e o aviso)", async () => {
    const id = await publicado();
    comPmoc("visualizar", "criar");
    expect((await chamar("lista", "POST", { corpo: base() })).status).toBe(201);
    expect((await chamar("copia", "POST", { id })).status).toBe(201);
    expect((await salvar(id, RT)).status).toBe(403);
    expect((await chamar("item", "DELETE", { id })).status).toBe(403);

    comPmoc("visualizar", "editar");
    expect((await salvar(id, { ...RT, status: "PUBLICADO" })).status).toBe(200);
    expect((await vincular(id, ["q2"])).status).toBe(200);
    expect((await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q2" })).status).toBe(200);
    expect((await chamar("lista", "POST", { corpo: base() })).status).toBe(403);
    expect((await chamar("copia", "POST", { id })).status).toBe(403);
    expect((await chamar("item", "DELETE", { id })).status).toBe(403);
    expect((await chamar("impacto", "GET", { id })).status).toBe(403);

    comPmoc("visualizar", "excluir");
    expect((await chamar("impacto", "GET", { id })).status).toBe(200);
    expect((await chamar("item", "DELETE", { id })).status).toBe(200);
    expect((await chamar("item", "PATCH", { id, corpo: { ativo: true } })).status).toBe(403); // reativar é "editar"
    comPmoc("visualizar", "editar");
    expect((await chamar("item", "PATCH", { id, corpo: { ativo: true } })).status).toBe(200);
  });

  it("perfis padrão: Supervisor vê, cria e edita (não inativa); o Técnico do app não tem o módulo", async () => {
    const id = await publicado();
    como(PRESETS.SUPERVISOR);
    expect((await chamar("item", "GET", { id })).status).toBe(200);
    expect((await chamar("copia", "POST", { id })).status).toBe(201);
    expect((await salvar(id, { ...RT, status: "PUBLICADO" })).status).toBe(200);
    expect((await chamar("item", "DELETE", { id })).status).toBe(403);
    como(PRESETS.TECNICO, "e1", { role: "TECNICO", tecnicoId: "rt1" });
    for (const r of [await chamar("item", "GET", { id }), await chamar("art", "GET", { id }), await chamar("lista", "POST", { corpo: base() }), await chamar("copia", "POST", { id })]) expect(r.status).toBe(403);
    como(PRESETS.FINANCEIRO);
    expect((await chamar("item", "GET", { id })).status).toBe(403);
  });

  it("multiempresa: o plano de uma empresa não existe para a outra (404 em tudo) e não é alterado", async () => {
    const id = await publicado({ artArquivo: PDF });
    como(permissoesTotais(), "e2");
    for (const r of [
      await chamar("item", "GET", { id }), await chamar("item", "PUT", { id, corpo: base({ clienteId: "cE2", unidadeId: "uE2" }) }), await chamar("item", "DELETE", { id }),
      await chamar("item", "PATCH", { id, corpo: { ativo: true } }), await chamar("equipamentos", "POST", { id, corpo: { equipamentoIds: ["qE2"] } }),
      await chamar("equipamentos", "DELETE", { id, query: "equipamentoId=q1" }), await chamar("copia", "POST", { id }), await chamar("impacto", "GET", { id }), await chamar("art", "GET", { id }),
    ]) expect(r.status).toBe(404);
    expect(await prisma.pmoc.count()).toBe(1);
    expect(await ler(id)).toMatchObject({ empresaId: "e1", ativo: true, status: "PUBLICADO", equipamentos: [expect.objectContaining({ equipamentoId: "q1" })] });
  });
});
