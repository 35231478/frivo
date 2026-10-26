/**
 * Fotos & Anexos do serviço (aba "Relatórios & Anexos" da OS + app do técnico) — rotas reais com o
 * Prisma real num PostgreSQL real (schema descartável via `prisma db push`). Prova, de ponta a ponta:
 *  - a galeria junta TUDO por equipamento: fotos da execução (checklist/antes/depois), dos serviços
 *    adicionais e as enviadas (escritório e app), com legenda, atividade, quem enviou e quando;
 *    documentos à parte; equipamento desvinculado não some; outra empresa não vê;
 *  - foto nova exige a referência (equipamento DA OS ou "Geral da OS") e a legenda; equipamento de
 *    fora da OS (mesmo do cliente) ou de outra empresa é recusado; documento não precisa de equipamento;
 *  - excluir exige editar a OS, respeita a atividade concluída (foto da execução) e fica no histórico
 *    com QUEM excluiu;
 *  - app do técnico: a foto do serviço sobe pela fila offline com referência + legenda; reenviar não
 *    duplica; aparece no retrato da atividade e na galeria; remover pela fila.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-fotos-anexos-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { MSG_EQUIPAMENTO_FORA, MSG_LEGENDA, MSG_REFERENCIA } from "@/lib/os/galeria";
import { PNG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_fotos_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), id = "uA", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = () => {
  sessao.atual = { user: { id: "uT", name: "João", email: "joao@x.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } };
};
const soVer = () => {
  const p = permissoesVazias() as any;
  p.ordens = { ...p.ordens, visualizar: true };
  return p as Permissoes;
};

async function resposta(res: Response) {
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json() : null };
}
async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return resposta(await mod[metodo](req, { params: Promise.resolve(params) }));
}
/** POST multipart, como o navegador manda */
async function enviar(osId: string, arquivo: { bytes: Uint8Array; nome: string; tipo: string }, campos: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("arquivo", new File([new Uint8Array(arquivo.bytes)], arquivo.nome, { type: arquivo.tipo }));
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  const { POST } = await import("@/app/api/ordens/[id]/anexos/route");
  return resposta(await POST(new NextRequest(`http://localhost/api/ordens/${osId}/anexos`, { method: "POST", body: fd }), { params: Promise.resolve({ id: osId }) }));
}
const FOTO = { bytes: PNG, nome: "foto.png", tipo: "image/png" };
const PDF = { bytes: new TextEncoder().encode("%PDF-1.7\n%conteúdo do laudo"), nome: "laudo-art.pdf", tipo: "application/pdf" };
const galeria = async (osId = "osA") => (await chamar("ordens/[id]/fotos", "GET", { id: osId })).json;
const sync = async (operacoes: unknown[]) => chamar("tecnico/sync", "POST", {}, { operacoes });
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });

describe.skipIf(!URL_PG)("Fotos & Anexos do serviço (PostgreSQL real)", () => {
  let prisma: any;
  const historico = async (acao: string) =>
    (await prisma.osHistorico.findMany({ where: { ordemServicoId: "osA", acao }, orderBy: { criadoEm: "asc" } })).map((h: any) => [h.usuarioId, h.detalhes]);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "ordens/[id]/fotos", "ordens/[id]/fotos/[fotoId]", "ordens/[id]/anexos", "ordens/[id]/anexos/[anexoId]", "tecnico/sync", "tecnico/atividades/[atividadeId]",
      "ordens/[id]/relatorios",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uE2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "1" },
      { id: "cE2", empresaId: "e2", nome: "Da outra", cpfCnpj: "2" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "unE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" },
    ] });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split Hi-Wall", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    await prisma.checklistTipoItem.create({ data: { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Limpeza dos filtros", pedirFoto: true, ordem: 1 } });
    const eq = (id: string, unidadeId: string, nome: string, empresaId = "e1", extra: Record<string, unknown> = {}) =>
      ({ id, empresaId, unidadeId, tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: empresaId === "e1" ? "te1" : null, marca: "Daikin", modelo: "FTXS", nome, ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("eqA", "un1", "Split Recepção", "e1", { patrimonio: "AC-01" }), eq("eqB", "un1", "Split Sala 2"),
      eq("eqC", "un1", "Split do auditório"), // do cliente, mas FORA da OS
      eq("eqX", "unE2", "Da outra empresa", "e2"),
    ] });
    await prisma.ordemServico.createMany({ data: [
      { id: "osA", empresaId: "e1", numero: "OS-0001", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Preventiva" },
      { id: "osE2", empresaId: "e2", numero: "OS-9999", clienteId: "cE2", unidadeId: "unE2", criadoPorId: "uE2", descricao: "Outra" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "osA", titulo: "Preventiva mensal", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "a2", empresaId: "e1", ordemServicoId: "osA", titulo: "Visita anterior", tecnicoId: "t1", status: "CONCLUIDA" },
    ] });
    await prisma.atividadeEquipamento.createMany({ data: [
      { atividadeId: "a1", equipamentoId: "eqA", feito: true }, { atividadeId: "a2", equipamentoId: "eqB", feito: true },
    ] });
    const img = dataUrl("image/png", PNG);
    await prisma.fotoAtendimento.createMany({ data: [
      { id: "fAntes", empresaId: "e1", atividadeId: "a1", equipamentoId: "eqA", momento: "ANTES", url: img, criadoPorId: "uT", criadoEm: new Date("2026-10-20T13:00:00Z") },
      { id: "fItem", empresaId: "e1", atividadeId: "a2", equipamentoId: "eqB", itemId: "i1", url: img, criadoPorId: "uT", criadoEm: new Date("2026-10-10T13:00:00Z") },
    ] });
    await prisma.servicoAdicional.create({ data: { id: "s1", empresaId: "e1", ordemServicoId: "osA", atividadeId: "a1", descricao: "Troca do controle remoto", equipamentoId: "eqA", criadoPorId: "uT" } });
    await prisma.servicoAdicionalFoto.create({ data: { id: "fAd", empresaId: "e1", servicoId: "s1", url: img, criadoPorId: "uT", criadoEm: new Date("2026-10-20T14:00:00Z") } });
    // Anexo ANTIGO (antes da referência): imagem sem equipamento, sem legenda, sem autor
    await prisma.osAnexo.create({ data: { id: "anAntigo", ordemServicoId: "osA", nome: "IMG_2031.jpg", tipo: "image/png", tamanho: 10, conteudo: img, criadoEm: new Date("2026-10-01T10:00:00Z") } });
    comoEscritorio();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("galeria: junta execução, serviço adicional e anexos, com legenda, atividade, quem e quando; equipamentos da OS como seções", async () => {
    comoEscritorio();
    const g = await galeria();
    expect(g.equipamentos.map((e: any) => [e.id, e.titulo, e.detalhe])).toEqual([
      ["eqA", "Split Recepção", "Split Hi-Wall · Daikin FTXS · TAG AC-01"], ["eqB", "Split Sala 2", "Split Hi-Wall · Daikin FTXS"],
    ]);
    const porChave = Object.fromEntries(g.fotos.map((f: any) => [f.chave, f]));
    expect(porChave["EXECUCAO:fAntes"]).toMatchObject({
      legenda: "Antes do serviço", equipamentoId: "eqA", atividade: { id: "a1", titulo: "Preventiva mensal", aberta: true },
      enviadoPor: "João Silva", enviadoEm: "2026-10-20T13:00:00.000Z", src: "/api/fotos-atendimento/fAntes",
    });
    expect(porChave["EXECUCAO:fItem"]).toMatchObject({ legenda: "Checklist: Limpeza dos filtros", item: "Limpeza dos filtros", equipamentoId: "eqB", atividade: { aberta: false } });
    expect(porChave["ADICIONAL:fAd"]).toMatchObject({ legenda: "Serviço adicional: Troca do controle remoto", equipamentoId: "eqA", src: "/api/servicos-adicionais/fotos/fAd" });
    expect(porChave["ANEXO:anAntigo"]).toMatchObject({ equipamentoId: null, semReferencia: true, enviadoPor: null, src: "/api/ordens/osA/anexos/anAntigo?inline=1" });
    expect(g.documentos).toEqual([]);
    // Só metadados: nada de base64 na galeria
    expect(JSON.stringify(g)).not.toContain("base64");
  });

  it("foto nova: exige a referência e a legenda; equipamento fora da OS ou de outra empresa é recusado", async () => {
    comoEscritorio();
    expect(await enviar("osA", FOTO)).toMatchObject({ status: 400, json: { erro: MSG_REFERENCIA } });
    expect(await enviar("osA", FOTO, { referencia: "GERAL" })).toMatchObject({ status: 400, json: { erro: MSG_LEGENDA } });
    expect(await enviar("osA", FOTO, { referencia: "GERAL", legenda: " x " })).toMatchObject({ status: 400, json: { erro: MSG_LEGENDA } });
    expect(await enviar("osA", FOTO, { referencia: "eqC", legenda: "Auditório" })).toMatchObject({ status: 400, json: { erro: MSG_EQUIPAMENTO_FORA } });
    expect(await enviar("osA", FOTO, { referencia: "eqX", legenda: "Outra empresa" })).toMatchObject({ status: 400, json: { erro: MSG_EQUIPAMENTO_FORA } });
    expect(await prisma.osAnexo.count({ where: { ordemServicoId: "osA" } })).toBe(1);
  });

  it("foto com equipamento da OS e foto Geral: gravadas com quem enviou, legenda e histórico", async () => {
    comoEscritorio();
    const r1 = await enviar("osA", FOTO, { referencia: "eqB", legenda: "  Placa   da condensadora " });
    expect(r1.status).toBe(201);
    expect(r1.json.tipo).toBe("foto");
    expect(r1.json.foto).toMatchObject({ origem: "ANEXO", equipamentoId: "eqB", legenda: "Placa da condensadora", enviadoPor: "Ana Souza", atividade: null });
    const r2 = await enviar("osA", FOTO, { referencia: "GERAL", legenda: "Fachada do prédio" });
    expect(r2.json.foto).toMatchObject({ equipamentoId: null, legenda: "Fachada do prédio" });
    expect(r2.json.foto.semReferencia).toBeUndefined();
    const banco = await prisma.osAnexo.findUnique({ where: { id: r1.json.foto.id } });
    expect(banco).toMatchObject({ equipamentoId: "eqB", legenda: "Placa da condensadora", criadoPorId: "uA", atividadeId: null, tipo: "image/png" });
    expect(await historico("Foto adicionada")).toEqual([["uA", "Placa da condensadora — Split Sala 2"], ["uA", "Fachada do prédio — Geral da OS"]]);
  });

  it("documento (PDF): sem equipamento mesmo se mandarem um, legenda opcional; vai para Documentos", async () => {
    comoEscritorio();
    const r = await enviar("osA", PDF, { referencia: "eqA" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ tipo: "documento", documento: { nome: "laudo-art.pdf", tipo: "application/pdf", legenda: null, enviadoPor: "Ana Souza" } });
    expect((await prisma.osAnexo.findUnique({ where: { id: r.json.documento.id } })).equipamentoId).toBeNull();
    const g = await galeria();
    expect(g.documentos.map((d: any) => d.nome)).toEqual(["laudo-art.pdf"]);
    expect(g.fotos.some((f: any) => f.id === r.json.documento.id)).toBe(false);
  });

  it("sem permissão de editar a OS: vê a galeria, mas não envia nem exclui", async () => {
    comoEscritorio(soVer());
    try {
      expect((await chamar("ordens/[id]/fotos", "GET", { id: "osA" })).status).toBe(200);
      expect((await enviar("osA", FOTO, { referencia: "GERAL", legenda: "Tentativa" })).status).toBe(403);
      expect((await chamar("ordens/[id]/fotos/[fotoId]", "DELETE", { id: "osA", fotoId: "fAntes" }, undefined, "?origem=EXECUCAO")).status).toBe(403);
      expect((await chamar("ordens/[id]/anexos/[anexoId]", "DELETE", { id: "osA", anexoId: "anAntigo" })).status).toBe(403);
      expect(await prisma.fotoAtendimento.count({ where: { id: "fAntes" } })).toBe(1);
    } finally { comoEscritorio(); }
  });

  it("outra empresa não vê nem mexe na galeria desta OS", async () => {
    comoEscritorio(permissoesTotais(), "uE2", "e2");
    try {
      expect((await chamar("ordens/[id]/fotos", "GET", { id: "osA" })).status).toBe(404);
      expect((await enviar("osA", FOTO, { referencia: "GERAL", legenda: "Invasão" })).status).toBe(404);
      expect((await chamar("ordens/[id]/fotos/[fotoId]", "DELETE", { id: "osA", fotoId: "fAntes" }, undefined, "?origem=EXECUCAO")).status).toBe(404);
    } finally { comoEscritorio(); }
  });

  it("excluir foto da execução: atividade concluída recusa (reabrir antes); aberta exclui e registra quem", async () => {
    comoEscritorio();
    const fechada = await chamar("ordens/[id]/fotos/[fotoId]", "DELETE", { id: "osA", fotoId: "fItem" }, undefined, "?origem=EXECUCAO");
    const { MSG_BLOQUEADA } = await import("@/lib/execucao/contexto");
    expect(fechada).toMatchObject({ status: 409, json: { erro: MSG_BLOQUEADA } });
    expect(await prisma.fotoAtendimento.count({ where: { id: "fItem" } })).toBe(1);
    // origem errada / de outra OS: não acha
    expect((await chamar("ordens/[id]/fotos/[fotoId]", "DELETE", { id: "osA", fotoId: "fAntes" }, undefined, "?origem=ADICIONAL")).status).toBe(404);
    expect((await chamar("ordens/[id]/fotos/[fotoId]", "DELETE", { id: "osA", fotoId: "fAntes" })).status).toBe(400);

    const ok = await chamar("ordens/[id]/fotos/[fotoId]", "DELETE", { id: "osA", fotoId: "fAntes" }, undefined, "?origem=EXECUCAO");
    expect(ok.status).toBe(200);
    expect(await prisma.fotoAtendimento.count({ where: { id: "fAntes" } })).toBe(0);
    expect(await historico("Foto da execução excluída")).toEqual([["uA", "Antes do serviço — Split Recepção — Daikin FTXS"]]);

    const ad = await chamar("ordens/[id]/fotos/[fotoId]", "DELETE", { id: "osA", fotoId: "fAd" }, undefined, "?origem=ADICIONAL");
    expect(ad.status).toBe(200);
    expect(await historico("Foto de serviço adicional excluída")).toEqual([["uA", "Serviço adicional: Troca do controle remoto"]]);
  });

  it("excluir foto/documento enviado: registra quem excluiu e o que era", async () => {
    comoEscritorio();
    const g = await galeria();
    const placa = g.fotos.find((f: any) => f.legenda === "Placa da condensadora");
    expect((await chamar("ordens/[id]/anexos/[anexoId]", "DELETE", { id: "osA", anexoId: placa.id })).status).toBe(200);
    const doc = g.documentos[0];
    expect((await chamar("ordens/[id]/anexos/[anexoId]", "DELETE", { id: "osA", anexoId: doc.id })).status).toBe(200);
    expect(await historico("Foto excluída")).toEqual([["uA", "Placa da condensadora — Split Sala 2 — Daikin FTXS"]]);
    expect(await historico("Documento excluído")).toEqual([["uA", "laudo-art.pdf"]]);
  });

  it("app do técnico: foto do serviço com equipamento ou Geral + legenda sobe pela fila; reenviar não duplica; aparece no retrato e na galeria", async () => {
    comoTecnico();
    const clientId = "aparelho-foto-0001";
    const foto = op("fotoOs", "a1", { dados: { dataUrl: dataUrl("image/png", PNG), equipamentoId: "eqA", legenda: "Dreno desobstruído", clientId } });
    const r = await sync([foto]);
    expect(r.status).toBe(200);
    expect(r.json.resultados[0]).toMatchObject({ ok: true, status: 201, dados: { equipamentoId: "eqA", legenda: "Dreno desobstruído", clientId } });
    // Reenvio da MESMA operação e outra operação com o mesmo id do aparelho: nada duplica
    expect((await sync([foto])).json.resultados[0]).toMatchObject({ ok: true, repetida: true });
    expect((await sync([{ ...foto, id: randomUUID() }])).json.resultados[0]).toMatchObject({ ok: true });
    expect(await prisma.osAnexo.count({ where: { clientId } })).toBe(1);
    const gravada = await prisma.osAnexo.findUnique({ where: { clientId } });
    expect(gravada).toMatchObject({ ordemServicoId: "osA", atividadeId: "a1", equipamentoId: "eqA", criadoPorId: "uT", tipo: "image/png" });

    const geral = await sync([op("fotoOs", "a1", { dados: { dataUrl: dataUrl("image/png", PNG), equipamentoId: null, legenda: "Quadro elétrico", clientId: "aparelho-foto-0002" } })]);
    expect(geral.json.resultados[0]).toMatchObject({ ok: true, dados: { equipamentoId: null } });

    // Retrato da atividade (o que o app guarda)
    const x = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "a1" })).json;
    expect(x.execucao.fotosServico.map((f: any) => [f.clientId, f.equipamentoId, f.legenda])).toEqual([
      ["aparelho-foto-0001", "eqA", "Dreno desobstruído"], ["aparelho-foto-0002", null, "Quadro elétrico"],
    ]);

    comoEscritorio();
    const g = await galeria();
    expect(g.fotos.filter((f: any) => f.origem === "ANEXO" && f.atividade?.id === "a1").map((f: any) => [f.equipamentoId, f.legenda, f.enviadoPor])).toEqual([
      ["eqA", "Dreno desobstruído", "João Silva"], [null, "Quadro elétrico", "João Silva"],
    ]);
    expect((await historico("Foto adicionada")).slice(-2)).toEqual([["uT", "Dreno desobstruído — Split Recepção (app do técnico)"], ["uT", "Quadro elétrico — Geral da OS (app do técnico)"]]);
  });

  it("app do técnico: sem legenda ou com equipamento fora da OS é recusado (a fila segura as seguintes)", async () => {
    comoTecnico();
    const semLegenda = op("fotoOs", "a1", { dados: { dataUrl: dataUrl("image/png", PNG), equipamentoId: null, legenda: " ", clientId: "aparelho-foto-0003" } });
    const depois = op("fotoOs", "a1", { dados: { dataUrl: dataUrl("image/png", PNG), equipamentoId: null, legenda: "Depois da recusada", clientId: "aparelho-foto-0004" } });
    const r = await sync([semLegenda, depois]);
    expect(r.json.resultados[0]).toMatchObject({ ok: false, status: 400, erro: MSG_LEGENDA });
    expect(r.json.resultados[1]).toMatchObject({ ok: false, adiada: true });
    const fora = await sync([op("fotoOs", "a1", { dados: { dataUrl: dataUrl("image/png", PNG), equipamentoId: "eqC", legenda: "Auditório", clientId: "aparelho-foto-0005" } })]);
    expect(fora.json.resultados[0]).toMatchObject({ ok: false, status: 400, erro: MSG_EQUIPAMENTO_FORA });
    // Atividade concluída: só leitura
    const fechada = await sync([op("fotoOs", "a2", { dados: { dataUrl: dataUrl("image/png", PNG), equipamentoId: null, legenda: "Tarde demais", clientId: "aparelho-foto-0006" } })]);
    expect(fechada.json.resultados[0]).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.osAnexo.count({ where: { clientId: { in: ["aparelho-foto-0003", "aparelho-foto-0004", "aparelho-foto-0005", "aparelho-foto-0006"] } } })).toBe(0);
  });

  it("app do técnico: remover a foto do serviço pela fila (repetir não é erro) e registrar no histórico", async () => {
    comoTecnico();
    const rem = op("fotoOsRemover", "a1", { dados: { clientId: "aparelho-foto-0002" } });
    expect((await sync([rem])).json.resultados[0]).toMatchObject({ ok: true, dados: { removidas: 1 } });
    expect((await sync([{ ...rem, id: randomUUID() }])).json.resultados[0]).toMatchObject({ ok: true, dados: { removidas: 0 } });
    expect(await prisma.osAnexo.count({ where: { clientId: "aparelho-foto-0002" } })).toBe(0);
    expect((await historico("Foto excluída")).slice(-1)).toEqual([["uT", "Quadro elétrico (app do técnico)"]]);
  });

  it("equipamento desvinculado da OS: as fotos dele continuam na galeria, na seção dele", async () => {
    comoEscritorio();
    await prisma.atividadeEquipamento.deleteMany({ where: { atividadeId: "a2", equipamentoId: "eqB" } });
    const g = await galeria();
    expect(g.equipamentos.map((e: any) => e.id)).toEqual(["eqA", "eqB"]); // eqB entra pelas fotos dele
    expect(g.fotos.find((f: any) => f.chave === "EXECUCAO:fItem").equipamentoId).toBe("eqB");
  });

  it("o resumo dos relatórios conta as MESMAS fotos da galeria (por atividade + as do escritório)", async () => {
    comoEscritorio();
    const g = await galeria();
    const r = (await chamar("ordens/[id]/relatorios", "GET", { id: "osA" })).json;
    expect(r.resumo.totalFotos).toBe(g.fotos.length);
    const porAtividade = Object.fromEntries(r.resumo.atividades.map((a: any) => [a.id, a.fotos]));
    expect(porAtividade).toEqual({
      a1: g.fotos.filter((f: any) => f.atividade?.id === "a1").length,
      a2: g.fotos.filter((f: any) => f.atividade?.id === "a2").length,
    });
    expect(porAtividade.a1).toBeGreaterThan(0);
  });

});
