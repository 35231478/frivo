/**
 * Legenda editável das fotos da OS (aba Relatórios e app do técnico) — rotas reais, Prisma real, PostgreSQL real:
 *  - o escritório (OS › Editar) muda a legenda das três origens (execução, serviço adicional, anexo), também com a
 *    OS concluída; a galeria, o relatório (PDF) e a cópia para o orçamento passam a usar a nova;
 *  - fica no histórico: quem mudou, a de antes e a nova; repetir a mesma legenda não grava nada;
 *  - sem "OS › Editar", legenda curta/longa, origem errada, foto de outra OS ou de outra empresa: recusado;
 *  - o técnico (app, fila offline) muda a legenda das fotos do serviço DELE enquanto a OS não estiver encerrada
 *    (também com a atividade concluída); com a OS concluída, só o escritório; a de outro técnico, não.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-legenda-foto-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { MSG_LEGENDA, MSG_LEGENDA_OS_ENCERRADA, MSG_LEGENDA_SEM_PERMISSAO } from "@/lib/os/galeria";
import { PNG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_legenda_foto_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), id = "uA", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = (tecnicoId = "t1", id = "uT") => {
  sessao.atual = { user: { id, name: "João", email: `${id}@x.com`, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};
const soVer = () => {
  const p = permissoesVazias() as any;
  p.ordens = { ...p.ordens, visualizar: true };
  return p as Permissoes;
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
const legenda = (fotoId: string, origem: string, texto: unknown, osId = "osA") =>
  chamar("ordens/[id]/fotos/[fotoId]", "PATCH", { id: osId, fotoId }, { legenda: texto }, `?origem=${origem}`);
const sync = async (operacoes: unknown[]) => chamar("tecnico/sync", "POST", {}, { operacoes });
const opLegenda = (atividadeId: string, dados: Record<string, unknown>) => ({ id: randomUUID(), tipo: "fotoOsLegenda", atividadeId, em: new Date().toISOString(), dados });

describe.skipIf(!URL_PG)("legenda editável das fotos da OS (PostgreSQL real)", () => {
  let prisma: any;
  const historico = async () =>
    (await prisma.osHistorico.findMany({ where: { acao: "Legenda da foto alterada" }, orderBy: { criadoEm: "asc" } })).map((h: any) => [h.ordemServicoId, h.usuarioId, h.detalhes]);
  const legendasDaGaleria = async (osId = "osA") => {
    comoEscritorio();
    const g = (await chamar("ordens/[id]/fotos", "GET", { id: osId })).json;
    return Object.fromEntries(g.fotos.map((f: any) => [f.id, f.legenda]));
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens/[id]/fotos", "ordens/[id]/fotos/[fotoId]", "tecnico/sync"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uP", empresaId: "e1", nome: "Pedro Lima", email: "pedro@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" },
      { id: "t2", empresaId: "e1", nome: "Pedro Lima", cpf: "2", telefone: "2", email: "pedro@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Mercado Bom Preço", cpfCnpj: "1" }, { id: "c2", empresaId: "e2", nome: "Padaria", cpfCnpj: "2" }] });
    await prisma.unidade.createMany({ data: [{ id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "un2", empresaId: "e2", clienteId: "c2", nome: "Loja" }] });
    await prisma.equipamento.create({ data: { id: "eqA", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTXS", nome: "Split Recepção" } });
    await prisma.ordemServico.createMany({ data: [
      { id: "osA", empresaId: "e1", numero: "OS-0001", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Preventiva", status: "EM_ANDAMENTO" },
      { id: "osB", empresaId: "e1", numero: "OS-0002", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Corretiva", status: "CONCLUIDA" },
      { id: "osX", empresaId: "e2", numero: "OS-9999", clienteId: "c2", unidadeId: "un2", criadoPorId: "uB", descricao: "Outra" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "osA", titulo: "Preventiva mensal", tecnicoId: "t1", status: "CONCLUIDA" },
      { id: "a3", empresaId: "e1", ordemServicoId: "osA", titulo: "Visita do Pedro", tecnicoId: "t2", status: "EM_ANDAMENTO" },
      { id: "b1", empresaId: "e1", ordemServicoId: "osB", titulo: "Corretiva", tecnicoId: "t1", status: "CONCLUIDA" },
    ] });
    await prisma.atividadeEquipamento.create({ data: { atividadeId: "a1", equipamentoId: "eqA", feito: true } });
    const img = dataUrl("image/png", PNG);
    await prisma.fotoAtendimento.create({ data: { id: "fAntes", empresaId: "e1", atividadeId: "a1", equipamentoId: "eqA", momento: "ANTES", url: img, criadoPorId: "uT" } });
    await prisma.servicoAdicional.create({ data: { id: "s1", empresaId: "e1", ordemServicoId: "osA", atividadeId: "a1", descricao: "Troca do controle remoto", equipamentoId: "eqA", criadoPorId: "uT" } });
    await prisma.servicoAdicionalFoto.create({ data: { id: "fAd", empresaId: "e1", servicoId: "s1", url: img, criadoPorId: "uT" } });
    const anexo = (id: string, ordemServicoId: string, atividadeId: string | null, legendaAtual: string | null, extra: Record<string, unknown> = {}) =>
      ({ id, ordemServicoId, atividadeId, nome: `${id}.png`, tipo: "image/png", tamanho: 10, conteudo: img, legenda: legendaAtual, equipamentoId: "eqA", ...extra });
    await prisma.osAnexo.createMany({ data: [
      anexo("anApp", "osA", "a1", "Dreno sujo", { clientId: "cli-anApp", criadoPorId: "uT" }), // do app, do João, atividade concluída
      anexo("anPedro", "osA", "a3", "Placa da condensadora", { criadoPorId: "uP" }),          // do app, do Pedro
      anexo("anEscr", "osA", null, "Fachada", { criadoPorId: "uA" }),                         // do escritório
      anexo("anOsB", "osB", "b1", "Quadro elétrico", { criadoPorId: "uT" }),                  // OS concluída
      anexo("anOutra", "osX", null, "Da outra empresa"),
      anexo("anPdf", "osA", null, "Laudo", { nome: "laudo.pdf", tipo: "application/pdf", equipamentoId: null }), // documento, não foto
    ] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("escritório: muda a legenda das três origens; a galeria mostra a nova; o histórico guarda a de antes e a nova", async () => {
    expect(await legendasDaGaleria()).toMatchObject({ fAntes: "Antes do serviço", fAd: "Serviço adicional: Troca do controle remoto", anApp: "Dreno sujo" });
    comoEscritorio();
    expect(await legenda("fAntes", "EXECUCAO", "  Evaporadora   antes da limpeza ")).toEqual({ status: 200, json: { legenda: "Evaporadora antes da limpeza" } });
    expect((await legenda("fAd", "ADICIONAL", "Controle remoto novo instalado")).status).toBe(200);
    expect((await legenda("anApp", "ANEXO", "Dreno desobstruído")).status).toBe(200);
    expect(await legendasDaGaleria()).toMatchObject({ fAntes: "Evaporadora antes da limpeza", fAd: "Controle remoto novo instalado", anApp: "Dreno desobstruído" });
    expect(await historico()).toEqual([
      ["osA", "uA", "“Antes do serviço” → “Evaporadora antes da limpeza”"],
      ["osA", "uA", "“Serviço adicional: Troca do controle remoto” → “Controle remoto novo instalado”"],
      ["osA", "uA", "“Dreno sujo” → “Dreno desobstruído”"],
    ]);
    // a mesma legenda de novo: nada muda e nada vai para o histórico
    expect((await legenda("anApp", "ANEXO", "Dreno desobstruído")).status).toBe(200);
    expect(await historico()).toHaveLength(3);
  });

  it("o relatório (PDF) e a cópia para o orçamento usam a legenda escrita", async () => {
    const { relatorioInterno } = await import("@/lib/relatorio-os/dados");
    const rel = JSON.stringify(await relatorioInterno("osA", "e1"));
    expect(rel).toContain("Evaporadora antes da limpeza");
    expect(rel).toContain("Controle remoto novo instalado");
    expect(rel).not.toContain("Adicional — foto 1");
    const { fotoDaOsParaCopiar } = await import("@/lib/orcamentos/anexos-server");
    expect((await fotoDaOsParaCopiar("e1", ["osA"], "EXECUCAO", "fAntes"))?.legenda).toBe("Evaporadora antes da limpeza");
    expect((await fotoDaOsParaCopiar("e1", ["osA"], "ADICIONAL", "fAd"))?.legenda).toBe("Controle remoto novo instalado");
  });

  it("escritório com a OS concluída: pode (a legenda é o texto do relatório)", async () => {
    comoEscritorio();
    expect((await legenda("anOsB", "ANEXO", "Quadro elétrico revisado", "osB")).status).toBe(200);
  });

  it("recusas: sem OS › Editar, legenda inválida, origem errada, foto de outra OS ou de outra empresa", async () => {
    comoEscritorio(soVer());
    expect((await legenda("anEscr", "ANEXO", "Fachada da loja")).status).toBe(403);
    comoEscritorio();
    for (const t of ["a", "x".repeat(201), "   ", null, 3]) expect(await legenda("anEscr", "ANEXO", t), String(t)).toEqual({ status: 400, json: { erro: MSG_LEGENDA } });
    expect((await legenda("anEscr", "OUTRA", "Fachada da loja")).status).toBe(400);
    expect((await legenda("anEscr", "EXECUCAO", "Fachada da loja")).status).toBe(404); // a origem não é a da foto
    expect((await legenda("anOsB", "ANEXO", "Fachada da loja")).status).toBe(404);     // a foto é de outra OS
    expect((await legenda("anOutra", "ANEXO", "Fachada da loja", "osX")).status).toBe(404);
    expect((await legenda("anPdf", "ANEXO", "Laudo da ART")).status).toBe(404); // documento não tem legenda de foto
    comoEscritorio(permissoesTotais(), "uB", "e2");
    expect((await legenda("anEscr", "ANEXO", "Fachada da loja")).status).toBe(404);
    expect(await prisma.osAnexo.findUnique({ where: { id: "anEscr" } })).toMatchObject({ legenda: "Fachada" });
  });

  it("técnico pelo app: muda a legenda da foto DELE (pelo id ou pelo id do aparelho), também com a atividade concluída", async () => {
    comoTecnico();
    let r = await sync([opLegenda("a1", { clientId: "cli-anApp", legenda: "Dreno limpo e testado" })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: true, dados: { legenda: "Dreno limpo e testado", mudou: true } });
    r = await sync([opLegenda("a1", { id: "anApp", legenda: "Dreno limpo, testado com água" })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: true });
    expect((await prisma.osAnexo.findUnique({ where: { id: "anApp" } })).legenda).toBe("Dreno limpo, testado com água");
    expect((await historico()).slice(-2)).toEqual([
      ["osA", "uT", "“Dreno desobstruído” → “Dreno limpo e testado” (app do técnico)"],
      ["osA", "uT", "“Dreno limpo e testado” → “Dreno limpo, testado com água” (app do técnico)"],
    ]);
  });

  it("técnico pelo app: não muda a do outro técnico, a do escritório, nem com a OS concluída", async () => {
    comoTecnico();
    let r = await sync([opLegenda("a3", { id: "anPedro", legenda: "Outra legenda" })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 403 });
    r = await sync([opLegenda("a1", { id: "anEscr", legenda: "Outra legenda" })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 404 }); // a do escritório não é da atividade
    r = await sync([opLegenda("b1", { id: "anOsB", legenda: "Outra legenda" })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 403, erro: MSG_LEGENDA_OS_ENCERRADA });
    expect((await prisma.osAnexo.findMany({ where: { id: { in: ["anPedro", "anEscr", "anOsB"] } }, orderBy: { id: "asc" } })).map((a: any) => a.legenda))
      .toEqual(["Fachada", "Quadro elétrico revisado", "Placa da condensadora"]);
    // a operação malformada (legenda grande demais) nem entra
    r = await sync([opLegenda("a1", { id: "anApp", legenda: "x".repeat(201) })]);
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 400 });
  });

  it("técnico com OS › Editar pela rota do escritório: a mesma regra do app (só a dele, OS aberta, nunca a do escritório)", async () => {
    sessao.atual = { user: { id: "uT", name: "João", email: "uT@x.com", empresaId: "e1", role: "TECNICO", permissoes: permissoesTotais(), tecnicoId: "t1" } };
    expect((await legenda("anPedro", "ANEXO", "Outra legenda")).status).toBe(403);
    expect(await legenda("anEscr", "ANEXO", "Outra legenda")).toEqual({ status: 403, json: { erro: "Esta foto foi enviada pelo escritório." } });
    expect(await legenda("anOsB", "ANEXO", "Outra legenda", "osB")).toEqual({ status: 403, json: { erro: MSG_LEGENDA_OS_ENCERRADA } });
    expect((await legenda("fAntes", "EXECUCAO", "Evaporadora suja, antes")).status).toBe(200);
    expect((await prisma.osAnexo.findUnique({ where: { id: "anPedro" } })).legenda).toBe("Placa da condensadora");
  });

  it("a regra no servidor: sem OS › Editar e fora do modo técnico, recusa com o motivo", async () => {
    const { editarLegendaFoto } = await import("@/lib/os/legenda-foto-server");
    const r = await editarLegendaFoto({ empresaId: "e1", usuarioId: "uA", escopo: { restrito: false } as never, podeEditarOs: false }, "osA", { origem: "ANEXO", fotoId: "anEscr", legenda: "Fachada nova" });
    expect(r).toEqual({ ok: false, status: 403, erro: MSG_LEGENDA_SEM_PERMISSAO });
  });
});
