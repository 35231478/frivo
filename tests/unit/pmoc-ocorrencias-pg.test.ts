/**
 * PMOC — OCORRÊNCIAS, de ponta a ponta no servidor: rotas de verdade (/api/pmocs/[id]/ocorrencias,
 * …/[ocorrenciaId], …/anexo, o documento e o link público) sobre PostgreSQL de verdade.
 *
 * O que se prova: registrar, editar, resolver, reabrir, excluir e restaurar gravam o que devem e
 * deixam a linha no histórico do plano; o equipamento tem de ser do PRÓPRIO plano e a OS, do mesmo
 * cliente e da mesma empresa; o anexo é conferido pelo conteúdo, nunca vai na lista e sai pela rota
 * dele; as ocorrências que estão valendo entram no DOCUMENTO (a excluída não); renovação e cópia não
 * as levam; e só quem tem "PMOC › Visualizar" vê e só quem tem "PMOC › Editar" muda — na própria empresa.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";
import { PNG, dataUrl, pdfDeTeste, textoDoPdf } from "./pmoc-pdf-util";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pmoc_ocorrencias_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 12/11/2026, 12:00 em Brasília */
const AGORA = new Date("2026-11-12T15:00:00.000Z");
const HOJE = "2026-11-12";
const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", extra: Record<string, unknown> = {}) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, empresaNome: "Empresa", role: "OPERADOR", permissoes, tecnicoId: null, ...extra } };
};
const comPmoc = (acoes: Acao[], extra: Record<string, unknown> = {}) => como(montarPermissoes({ pmoc: acoes }), "e1", extra);
const semModulo = () => como(montarPermissoes({ ordens: ["visualizar", "criar", "editar", "excluir"], equipamentos: ["visualizar", "editar"] }));
const tecnicoDoApp = () => como(PRESETS.TECNICO, "e1", { role: "TECNICO", tecnicoId: "t1" });

const ROTAS = {
  lista: "api/pmocs/[id]/ocorrencias", uma: "api/pmocs/[id]/ocorrencias/[ocorrenciaId]", anexo: "api/pmocs/[id]/ocorrencias/[ocorrenciaId]/anexo",
  documento: "api/pmocs/[id]/documento", publico: "(publico)/relatorio/pmoc/[token]", historico: "api/pmocs/[id]/historico",
  renovacao: "api/pmocs/[id]/renovacao", copia: "api/pmocs/[id]/copia",
} as const;
async function chamar(rota: keyof typeof ROTAS, metodo: string, op: { id?: string; oc?: string; token?: string; corpo?: unknown; query?: string } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${op.query ? `?${op.query}` : ""}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ id: op.id ?? "", ocorrenciaId: op.oc ?? "", token: op.token ?? "" }) });
  const tipo = res.headers.get("content-type") ?? "";
  const json = tipo.includes("json");
  return { status: res.status, tipo, headers: res.headers, json: json ? await res.json() : null, bytes: json ? null : new Uint8Array(await res.arrayBuffer()) };
}
const VAZAMENTO = { data: "2026-11-10", descricao: "Vazamento de água na bandeja da evaporadora", gravidade: "ALTA" };
/** Um JPEG mínimo (só o começo do arquivo basta para o tipo ser reconhecido pelo conteúdo) */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const HTML = dataUrl(new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/png");

describe.skipIf(!URL_PG)("PMOC — ocorrências (PostgreSQL real)", () => {
  let prisma: any;
  /** Plano publicado do Hospital (cliente c1), com q1 e q2; q3 é do mesmo cliente mas está FORA do plano */
  const plano = async (extra: Record<string, unknown> = {}, empresaId = "e1") => {
    const e1 = empresaId === "e1";
    return (await prisma.pmoc.create({ data: {
      empresaId, clienteId: e1 ? "c1" : "cE2", unidadeId: e1 ? "u1" : "uE2", nome: e1 ? "PMOC 2027 — Hospital" : "PMOC da outra empresa", status: "PUBLICADO",
      rtNome: "Eng. Paula Reis", rtCrea: "SP-5061234567", artNumero: "28027230241234567", dataInicio: dia("2026-08-01"), dataExpiracao: dia("2027-07-31"),
      equipamentos: { create: (e1 ? ["q1", "q2"] : ["qE2"]).map((equipamentoId) => ({ equipamentoId })) }, ...extra,
    }, select: { id: true } })).id as string;
  };
  const criar = async (id: string, extra: Record<string, unknown> = {}) => {
    const r = await chamar("lista", "POST", { id, corpo: { ...VAZAMENTO, ...extra } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json as { id: string } & Record<string, any>;
  };
  const gravada = (id: string) => prisma.pmocOcorrencia.findUnique({ where: { id } });
  const total = () => prisma.pmocOcorrencia.count();
  const historico = async (id: string) => (await prisma.pmocHistorico.findMany({ where: { pmocId: id }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] })).map((h: any) => `${h.acao} | ${h.detalhes ?? ""} | ${h.usuarioId ?? "-"}`);
  const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`; };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com" }, { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" }] });
    await prisma.usuario.createMany({ data: [{ id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" }, { id: "uC", empresaId: "e1", nome: "Caio Lima", email: "caio@x.com", senha: "x" }, { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" }] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" }, { id: "c2", empresaId: "e1", nome: "Shopping Norte", cpfCnpj: "2" }, { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [{ id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "u2", empresaId: "e1", clienteId: "c2", nome: "Loja" }, { id: "uE2", empresaId: "e2", clienteId: "cE2", nome: "Sede" }] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "Carlos Oliveira", cpf: "1", telefone: "1" } });
    const eq = (id: string, unidadeId: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: unidadeId === "uE2" ? "e2" : "e1", unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("q1", "u1", { patrimonio: "AC-001", nome: "Split da recepção" }), eq("q2", "u1", { patrimonio: "AC-002", nome: "Split UTI 1" }),
      eq("q3", "u1", { patrimonio: "AC-003", nome: "Split do almoxarifado" }), eq("qE2", "uE2", { patrimonio: "ZZ-900", nome: "Equipamento da outra empresa" }),
    ] });
    const os = (id: string, numero: string, empresaId: string, clienteId: string, descricao: string, criadoEm: string) => ({ id, numero, empresaId, clienteId, criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao, criadoEm: new Date(criadoEm) });
    await prisma.ordemServico.createMany({ data: [
      os("os1", "OS-101", "e1", "c1", "Manutenção   Preventiva\nde novembro", "2026-11-01T12:00:00Z"), os("os2", "OS-102", "e1", "c1", "Limpeza Química", "2026-11-05T12:00:00Z"),
      os("osOutro", "OS-900", "e1", "c2", "OS de outro cliente", "2026-11-06T12:00:00Z"), os("osE2", "OS-1", "e2", "cE2", "OS da outra empresa", "2026-11-07T12:00:00Z"),
    ] });
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    await prisma.pmoc.deleteMany({});
    como();
  });

  /* ───────── registrar ───────── */
  it("REGISTRAR o mínimo: nasce Aberta, geral da unidade, manual, da empresa de quem registra — com a linha no histórico", async () => {
    const id = await plano();
    const r = await chamar("lista", "POST", { id, corpo: VAZAMENTO });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ data: "2026-11-10", descricao: VAZAMENTO.descricao, gravidade: "ALTA", situacao: "ABERTA", resolvidaEm: null, resolucao: null, equipamento: null, ordemServico: null, anexo: null, origem: "MANUAL", ativo: true });
    expect(await gravada(r.json.id)).toMatchObject({
      empresaId: "e1", pmocId: id, equipamentoId: null, ordemServicoId: null, atividadeId: null, checklistRespostaId: null, orcamentoId: null, osCorretivaId: null,
      situacao: "ABERTA", origem: "MANUAL", ativo: true, criadoPorId: "uA", resolvidaPorId: null, resolvidaEm: null, resolucao: null, anexo: null,
    });
    expect(iso((await gravada(r.json.id)).data)).toBe("2026-11-10");
    expect(await historico(id)).toEqual([`Ocorrência registrada | Alta · Geral da unidade — ${VAZAMENTO.descricao} | uA`]);
  });

  it("REGISTRAR completo: equipamento do plano, OS do cliente, já resolvida (data e o que foi feito) e foto anexada", async () => {
    const id = await plano();
    const o = await criar(id, { equipamentoId: "q1", ordemServicoId: "os1", situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Dreno desobstruído", anexo: dataUrl(JPEG, "image/jpeg"), anexoNome: "bandeja.jpg" });
    expect(o).toMatchObject({
      situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Dreno desobstruído",
      equipamento: { id: "q1", rotulo: "AC-001 · Split da recepção", tag: "AC-001" }, ordemServico: { id: "os1", numero: "OS-101" },
      anexo: { nome: "bandeja.jpg", tipo: "image/jpeg", tamanho: JPEG.length },
    });
    expect(await gravada(o.id)).toMatchObject({ equipamentoId: "q1", ordemServicoId: "os1", resolvidaPorId: "uA", anexoNome: "bandeja.jpg", anexoTipo: "image/jpeg", anexoTamanho: JPEG.length });
    expect(iso((await gravada(o.id)).resolvidaEm)).toBe("2026-11-11");
    expect(await historico(id)).toEqual([`Ocorrência registrada | Alta · AC-001 · Split da recepção — ${VAZAMENTO.descricao} | uA`]);
    // Resolvida sem data: vale o dia de hoje (em Brasília)
    const semData = await criar(id, { situacao: "RESOLVIDA" });
    expect(semData).toMatchObject({ situacao: "RESOLVIDA", resolvidaEm: HOJE, resolucao: null });
    // Aberta que chega com resolução: a resolução não é gravada
    const aberta = await criar(id, { situacao: "EM_ANDAMENTO", resolvidaEm: "2026-11-11", resolucao: "não vale" });
    expect(await gravada(aberta.id)).toMatchObject({ situacao: "EM_ANDAMENTO", resolvidaEm: null, resolucao: null, resolvidaPorId: null });
  });

  it("o que NÃO registra: dado faltando, data futura, resolução fora do intervalo — e nada é gravado", async () => {
    const id = await plano();
    const tentar = (extra: Record<string, unknown>) => erro(chamar("lista", "POST", { id, corpo: { ...VAZAMENTO, ...extra } }));
    expect(await tentar({ descricao: "" })).toBe("400 Descreva o problema (mín. 3 caracteres).");
    expect(await tentar({ gravidade: undefined })).toBe("400 Escolha a gravidade.");
    expect(await tentar({ gravidade: "URGENTE" })).toBe("400 Escolha a gravidade.");
    expect(await tentar({ data: "10/11/2026" })).toBe("400 Informe a data da ocorrência.");
    expect(await tentar({ situacao: "FECHADA" })).toBe("400 Situação inválida.");
    expect(await tentar({ data: "2026-11-13" })).toBe("400 A data da ocorrência não pode ser futura.");
    expect(await tentar({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-09" })).toBe("400 A resolução não pode ser antes da data da ocorrência.");
    expect(await tentar({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-13" })).toBe("400 A data da resolução não pode ser futura.");
    expect(await tentar({ situacao: "RESOLVIDA", resolvidaEm: "ontem" })).toBe("400 Data da resolução inválida.");
    expect(await erro(chamar("lista", "POST", { id }))).toBe("400 Informe a data da ocorrência."); // sem corpo
    expect(await tentar({ data: HOJE })).toMatch(/^201/); // hoje pode
    expect(await total()).toBe(1);
    expect(await historico(id)).toHaveLength(1);
  });

  it("VÍNCULOS: o equipamento tem de estar NESTE plano; a OS, ser do mesmo cliente e da mesma empresa", async () => {
    const id = await plano();
    const tentar = (extra: Record<string, unknown>) => erro(chamar("lista", "POST", { id, corpo: { ...VAZAMENTO, ...extra } }));
    expect(await tentar({ equipamentoId: "q3" })).toBe("400 Este equipamento não está no PMOC. Inclua-o na aba Equipamentos AVAC."); // do cliente, fora do plano
    expect(await tentar({ equipamentoId: "qE2" })).toBe("400 Este equipamento não está no PMOC. Inclua-o na aba Equipamentos AVAC."); // de outra empresa
    expect(await tentar({ equipamentoId: "nao-existe" })).toBe("400 Este equipamento não está no PMOC. Inclua-o na aba Equipamentos AVAC.");
    expect(await tentar({ ordemServicoId: "osOutro" })).toBe("400 Esta OS é de outro cliente.");
    expect(await tentar({ ordemServicoId: "osE2" })).toBe("400 OS inválida.");
    expect(await tentar({ ordemServicoId: "nao-existe" })).toBe("400 OS inválida.");
    expect(await total()).toBe(0);
    // O equipamento de OUTRO plano da mesma empresa também não serve
    const outro = await plano({ nome: "PMOC do almoxarifado", equipamentos: { create: [{ equipamentoId: "q3" }] } });
    expect(await tentar({ equipamentoId: "q3" })).toMatch(/^400 Este equipamento não está no PMOC/);
    expect((await chamar("lista", "POST", { id: outro, corpo: { ...VAZAMENTO, equipamentoId: "q3" } })).status).toBe(201);
    expect(await erro(chamar("lista", "POST", { id: outro, corpo: { ...VAZAMENTO, equipamentoId: "q1" } }))).toMatch(/^400 Este equipamento não está no PMOC/);
  });

  /* ───────── anexo ───────── */
  it("ANEXO: foto ou PDF conferidos pelo CONTEÚDO; nunca vai na lista; sai pela rota dele, sem executar", async () => {
    const id = await plano();
    const foto = await criar(id, { anexo: dataUrl(JPEG, "application/pdf"), anexoNome: "foto do vazamento.jpg" }); // o tipo declarado está errado: vale o conteúdo
    expect(foto.anexo).toEqual({ nome: "foto do vazamento.jpg", tipo: "image/jpeg", tamanho: JPEG.length });
    const pdf = await pdfDeTeste(1, "Laudo");
    const laudo = await criar(id, { descricao: "Corrosão na base", anexo: dataUrl(pdf, "application/pdf"), anexoNome: "laudo.pdf" });
    const png = await criar(id, { descricao: "Filtro rasgado", anexo: dataUrl(PNG, "image/png") });
    expect(png.anexo).toEqual({ nome: "anexo", tipo: "image/png", tamanho: PNG.length }); // sem nome: "anexo"

    const lista = await chamar("lista", "GET", { id });
    expect(JSON.stringify(lista.json)).not.toContain("base64");
    expect(lista.json.ocorrencias.map((o: any) => o.anexo?.tipo)).toEqual(["image/png", "application/pdf", "image/jpeg"]);

    const baixar = await chamar("anexo", "GET", { id, oc: foto.id });
    expect(baixar).toMatchObject({ status: 200, tipo: "image/jpeg" });
    expect([...baixar.bytes!]).toEqual([...JPEG]);
    expect(baixar.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''foto%20do%20vazamento.jpg");
    expect(baixar.headers.get("x-content-type-options")).toBe("nosniff");
    expect(baixar.headers.get("cache-control")).toBe("private, no-store");
    expect((await chamar("anexo", "GET", { id, oc: foto.id, query: "inline=1" })).headers.get("content-disposition")).toMatch(/^inline;/);
    const doLaudo = await chamar("anexo", "GET", { id, oc: laudo.id, query: "inline=1" });
    expect(doLaudo).toMatchObject({ status: 200, tipo: "application/pdf" });
    expect(doLaudo.bytes!.length).toBe(pdf.length);

    // O que não entra: outro tipo (mesmo disfarçado de imagem), arquivo vazio, texto que não é arquivo, e acima de 3 MB
    const tentar = (anexo: string, anexoNome = "x.png") => erro(chamar("lista", "POST", { id, corpo: { ...VAZAMENTO, anexo, anexoNome } }));
    expect(await tentar(HTML)).toBe("400 O anexo deve ser foto (JPG ou PNG) ou PDF.");
    expect(await tentar(dataUrl(new TextEncoder().encode("GIF89a........"), "image/gif"), "x.gif")).toBe("400 O anexo deve ser foto (JPG ou PNG) ou PDF.");
    expect(await tentar("isto não é um arquivo")).toBe("400 O anexo deve ser foto (JPG ou PNG) ou PDF.");
    expect(await tentar("data:image/png;base64,")).toBe("400 Arquivo vazio.");
    const grande = new Uint8Array(3 * 1024 * 1024 + 1); grande.set(JPEG);
    expect(await tentar(dataUrl(grande, "image/jpeg"), "grande.jpg")).toBe("413 Anexo acima de 3 MB.");
    const noLimite = new Uint8Array(3 * 1024 * 1024); noLimite.set(JPEG);
    expect((await chamar("lista", "POST", { id, corpo: { ...VAZAMENTO, anexo: dataUrl(noLimite, "image/jpeg"), anexoNome: "limite.jpg" } })).status).toBe(201);
    expect(await total()).toBe(4);
    // Ocorrência sem anexo, de outro plano ou que não existe: 404
    const sem = await criar(id);
    expect(await erro(chamar("anexo", "GET", { id, oc: sem.id }))).toBe("404 Esta ocorrência não tem anexo.");
    expect((await chamar("anexo", "GET", { id, oc: "nao-existe" })).status).toBe(404);
    expect((await chamar("anexo", "GET", { id: await plano({ nome: "Outro plano" }), oc: foto.id })).status).toBe(404);
  });

  /* ───────── listar ───────── */
  it("LISTAR: a mais recente primeiro, com as excluídas marcadas; as OS do cliente só para quem edita", async () => {
    const id = await plano();
    const antiga = await criar(id, { data: "2026-10-23", descricao: "Corrosão na base", gravidade: "BAIXA", equipamentoId: "q2" });
    const nova = await criar(id, { data: HOJE, descricao: "Ruído anormal", gravidade: "CRITICA", situacao: "EM_ANDAMENTO" });
    const meio = await criar(id);
    await chamar("uma", "DELETE", { id, oc: meio.id });
    await criar(await plano({ nome: "Outro plano" }), { descricao: "Ocorrência de outro plano" });

    const r = await chamar("lista", "GET", { id });
    expect(r.status).toBe(200);
    expect(r.json.ocorrencias.map((o: any) => [o.id, o.data, o.ativo])).toEqual([[nova.id, HOJE, true], [meio.id, "2026-11-10", false], [antiga.id, "2026-10-23", true]]);
    expect(r.json.ocorrencias[2]).toMatchObject({ descricao: "Corrosão na base", gravidade: "BAIXA", situacao: "ABERTA", equipamento: { id: "q2", rotulo: "AC-002 · Split UTI 1", tag: "AC-002" } });
    // As OS oferecidas no formulário: só as DESTE cliente, da mais nova para a mais antiga, com a descrição numa linha
    expect(r.json.ordens).toEqual([{ id: "os2", numero: "OS-102", descricao: "Limpeza Química" }, { id: "os1", numero: "OS-101", descricao: "Manutenção Preventiva de novembro" }]);
    comPmoc(["visualizar"]);
    const soVe = await chamar("lista", "GET", { id });
    expect(soVe.json.ocorrencias).toHaveLength(3);
    expect(soVe.json.ordens).toEqual([]);
    comPmoc(["visualizar", "editar"]);
    expect((await chamar("lista", "GET", { id })).json.ordens).toHaveLength(2);
  });

  /* ───────── editar ───────── */
  it("EDITAR: troca os dados, mantém o anexo quando ele não vem, troca ou exclui quando pedido — e registra no histórico", async () => {
    const id = await plano();
    const o = await criar(id, { equipamentoId: "q1", anexo: dataUrl(JPEG, "image/jpeg"), anexoNome: "antes.jpg" });
    const editado = await chamar("uma", "PUT", { id, oc: o.id, corpo: { data: "2026-11-08", descricao: "Vazamento de gás na linha de sucção", gravidade: "CRITICA", situacao: "EM_ANDAMENTO", equipamentoId: "q2", ordemServicoId: "os2" } });
    expect(editado.status).toBe(200);
    expect(editado.json).toMatchObject({
      id: o.id, data: "2026-11-08", descricao: "Vazamento de gás na linha de sucção", gravidade: "CRITICA", situacao: "EM_ANDAMENTO",
      equipamento: { id: "q2" }, ordemServico: { id: "os2", numero: "OS-102" }, anexo: { nome: "antes.jpg", tipo: "image/jpeg" },
    });
    expect(await gravada(o.id)).toMatchObject({ criadoPorId: "uA", anexoNome: "antes.jpg", equipamentoId: "q2", ordemServicoId: "os2" });
    const corpo = { data: "2026-11-08", descricao: "Vazamento de gás na linha de sucção", gravidade: "CRITICA", situacao: "EM_ANDAMENTO" };
    const trocado = await chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, anexo: dataUrl(PNG, "image/png"), anexoNome: "depois.png" } });
    expect(trocado.json).toMatchObject({ equipamento: null, ordemServico: null, anexo: { nome: "depois.png", tipo: "image/png", tamanho: PNG.length } }); // sem equipamento e sem OS no pedido: geral, sem OS
    expect([...(await chamar("anexo", "GET", { id, oc: o.id })).bytes!]).toEqual([...PNG]);
    const semAnexo = await chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, removerAnexo: true } });
    expect(semAnexo.json.anexo).toBeNull();
    expect(await gravada(o.id)).toMatchObject({ anexo: null, anexoNome: null, anexoTipo: null, anexoTamanho: null });
    expect((await historico(id)).slice(1)).toEqual([
      "Ocorrência alterada | Crítica · AC-002 · Split UTI 1 — Vazamento de gás na linha de sucção | uA",
      "Ocorrência alterada | Crítica · Geral da unidade — Vazamento de gás na linha de sucção | uA",
      "Ocorrência alterada | Crítica · Geral da unidade — Vazamento de gás na linha de sucção | uA",
    ]);
    // Edição inválida não muda nada
    const antes = JSON.stringify(await gravada(o.id));
    expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, descricao: "x" } }))).toBe("400 Descreva o problema (mín. 3 caracteres).");
    expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, data: "2026-12-01" } }))).toBe("400 A data da ocorrência não pode ser futura.");
    expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, equipamentoId: "q3" } }))).toMatch(/^400 Este equipamento não está no PMOC/);
    expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, ordemServicoId: "osOutro" } }))).toBe("400 Esta OS é de outro cliente.");
    expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, anexo: HTML } }))).toBe("400 O anexo deve ser foto (JPG ou PNG) ou PDF.");
    expect(JSON.stringify(await gravada(o.id))).toBe(antes);
    expect(await historico(id)).toHaveLength(4);
  });

  it("equipamento que SAIU do plano depois: a ocorrência antiga continua editável com ele; trocar para outro de fora não passa", async () => {
    const id = await plano();
    const o = await criar(id, { equipamentoId: "q2", ordemServicoId: "os1" });
    await prisma.pmocEquipamento.deleteMany({ where: { pmocId: id, equipamentoId: "q2" } });
    await prisma.ordemServico.update({ where: { id: "os1" }, data: { clienteId: "c2" } }); // a OS mudou de cliente depois
    try {
      const corpo = { ...VAZAMENTO, descricao: "Vazamento na bandeja, com gotejamento", equipamentoId: "q2", ordemServicoId: "os1" };
      expect((await chamar("uma", "PUT", { id, oc: o.id, corpo })).json).toMatchObject({ descricao: "Vazamento na bandeja, com gotejamento", equipamento: { id: "q2" }, ordemServico: { id: "os1" } });
      expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: { ...corpo, equipamentoId: "q3" } }))).toMatch(/^400 Este equipamento não está no PMOC/);
      expect(await erro(chamar("lista", "POST", { id, corpo: { ...VAZAMENTO, equipamentoId: "q2" } }))).toMatch(/^400 Este equipamento não está no PMOC/); // em ocorrência nova, não
      expect(await erro(chamar("lista", "POST", { id, corpo: { ...VAZAMENTO, ordemServicoId: "os1" } }))).toBe("400 Esta OS é de outro cliente.");
    } finally { await prisma.ordemServico.update({ where: { id: "os1" }, data: { clienteId: "c1" } }); }
  });

  /* ───────── resolver e reabrir ───────── */
  it("RESOLVER: grava a data, o que foi feito e quem resolveu; sem data vale hoje; a resolução vai para o histórico", async () => {
    const id = await plano();
    const o = await criar(id, { equipamentoId: "q1" });
    como(permissoesTotais(), "e1", { id: "uC" });
    const r = await chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Dreno  desobstruído\ne bandeja limpa" } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: o.id, situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Dreno  desobstruído\ne bandeja limpa", descricao: VAZAMENTO.descricao, equipamento: { id: "q1" } });
    expect(await gravada(o.id)).toMatchObject({ situacao: "RESOLVIDA", resolvidaPorId: "uC", criadoPorId: "uA", gravidade: "ALTA" });
    expect((await historico(id)).at(-1)).toBe(`Ocorrência resolvida | Alta · AC-001 · Split da recepção — ${VAZAMENTO.descricao} Resolução: Dreno desobstruído e bandeja limpa | uC`);
    // Sem data: hoje. Sem observação: a linha do histórico fica sem ela.
    const outra = await criar(id, { descricao: "Filtro rasgado" });
    expect((await chamar("uma", "PATCH", { id, oc: outra.id, corpo: { situacao: "RESOLVIDA" } })).json).toMatchObject({ situacao: "RESOLVIDA", resolvidaEm: HOJE, resolucao: null });
    expect((await historico(id)).at(-1)).toBe("Ocorrência resolvida | Alta · Geral da unidade — Filtro rasgado | uC");
    // Editar a resolvida (outra pessoa) não troca quem resolveu
    como();
    await chamar("uma", "PUT", { id, oc: o.id, corpo: { ...VAZAMENTO, equipamentoId: "q1", situacao: "RESOLVIDA", resolvidaEm: "2026-11-12", resolucao: "Dreno desobstruído" } });
    expect(await gravada(o.id)).toMatchObject({ resolvidaPorId: "uC", resolucao: "Dreno desobstruído" });
    expect(iso((await gravada(o.id)).resolvidaEm)).toBe("2026-11-12");
    expect((await historico(id)).at(-1)).toMatch(/^Ocorrência alterada \|/);
  });

  it("resolução fora do intervalo ou situação inválida não passa, e a ocorrência fica como estava", async () => {
    const id = await plano();
    const o = await criar(id);
    const tentar = (corpo: unknown) => erro(chamar("uma", "PATCH", { id, oc: o.id, corpo }));
    expect(await tentar({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-09" })).toBe("400 A resolução não pode ser antes da data da ocorrência.");
    expect(await tentar({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-13" })).toBe("400 A data da resolução não pode ser futura.");
    expect(await tentar({ situacao: "CANCELADA" })).toBe("400 Situação inválida.");
    expect(await tentar({})).toBe("400 Situação inválida.");
    expect(await tentar({ restaurar: "sim" })).toBe("400 Situação inválida."); // só `restaurar: true` restaura
    expect(await gravada(o.id)).toMatchObject({ situacao: "ABERTA", resolvidaEm: null, ativo: true });
    expect(await historico(id)).toHaveLength(1);
    expect(await tentar({ situacao: "RESOLVIDA", resolvidaEm: "2026-11-10" })).toMatch(/^200/); // no mesmo dia da ocorrência
  });

  it("REABRIR e EM ANDAMENTO: a resolução é limpa (data, texto e quem resolveu); o histórico diz o que houve", async () => {
    const id = await plano();
    const o = await criar(id, { situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Dreno desobstruído" });
    expect((await chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "ABERTA", resolvidaEm: "2026-11-11", resolucao: "não vale" } })).json).toMatchObject({ situacao: "ABERTA", resolvidaEm: null, resolucao: null });
    expect(await gravada(o.id)).toMatchObject({ situacao: "ABERTA", resolvidaEm: null, resolucao: null, resolvidaPorId: null });
    expect((await chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "EM_ANDAMENTO" } })).json.situacao).toBe("EM_ANDAMENTO");
    await chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "RESOLVIDA" } });
    // Reabrir pelo formulário (PUT) também limpa
    await chamar("uma", "PUT", { id, oc: o.id, corpo: { ...VAZAMENTO, situacao: "EM_ANDAMENTO", resolvidaEm: "2026-11-11", resolucao: "não vale" } });
    expect(await gravada(o.id)).toMatchObject({ situacao: "EM_ANDAMENTO", resolvidaEm: null, resolucao: null, resolvidaPorId: null });
    expect((await historico(id)).map((h: string) => h.split(" | ")[0])).toEqual(["Ocorrência registrada", "Ocorrência reaberta", "Ocorrência alterada", "Ocorrência resolvida", "Ocorrência reaberta"]);
  });

  /* ───────── excluir e restaurar ───────── */
  it("EXCLUIR guarda fora da lista (não apaga); a excluída não é editada nem resolvida; RESTAURAR desfaz", async () => {
    const id = await plano();
    const o = await criar(id, { equipamentoId: "q1", anexo: dataUrl(JPEG, "image/jpeg"), anexoNome: "foto.jpg" });
    const excluida = await chamar("uma", "DELETE", { id, oc: o.id });
    expect(excluida).toMatchObject({ status: 200, json: { id: o.id, ativo: false, situacao: "ABERTA" } });
    expect(await gravada(o.id)).toMatchObject({ ativo: false, descricao: VAZAMENTO.descricao, anexoNome: "foto.jpg" }); // continua no banco, com o anexo
    expect((await chamar("uma", "DELETE", { id, oc: o.id })).json.ativo).toBe(false); // de novo: não muda nada nem repete o histórico
    expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: VAZAMENTO }))).toBe("409 Ocorrência excluída: restaure antes de editar.");
    expect(await erro(chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "RESOLVIDA" } }))).toBe("409 Ocorrência excluída: restaure antes de editar.");
    expect(await gravada(o.id)).toMatchObject({ ativo: false, situacao: "ABERTA" });
    expect((await chamar("anexo", "GET", { id, oc: o.id })).status).toBe(200); // o anexo da excluída ainda abre (para conferir antes de restaurar)

    const restaurada = await chamar("uma", "PATCH", { id, oc: o.id, corpo: { restaurar: true } });
    expect(restaurada).toMatchObject({ status: 200, json: { id: o.id, ativo: true } });
    expect((await chamar("uma", "PATCH", { id, oc: o.id, corpo: { restaurar: true } })).json.ativo).toBe(true);
    expect((await historico(id)).map((h: string) => h.split(" | ")[0])).toEqual(["Ocorrência registrada", "Ocorrência excluída", "Ocorrência restaurada"]);
    expect((await historico(id))[1]).toBe(`Ocorrência excluída | Alta · AC-001 · Split da recepção — ${VAZAMENTO.descricao} | uA`);
    expect((await chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "RESOLVIDA" } })).status).toBe(200); // restaurada: volta a aceitar mudança
  });

  /* ───────── plano inativo, o que não existe e a outra empresa ───────── */
  it("plano INATIVO: dá para ver, mas nenhuma mudança passa (409)", async () => {
    const id = await plano();
    const o = await criar(id, { anexo: dataUrl(JPEG, "image/jpeg") });
    await prisma.pmoc.update({ where: { id }, data: { ativo: false } });
    const antes = JSON.stringify(await gravada(o.id));
    const msg = "409 PMOC inativo: reative antes de editar.";
    expect(await erro(chamar("lista", "POST", { id, corpo: VAZAMENTO }))).toBe(msg);
    expect(await erro(chamar("uma", "PUT", { id, oc: o.id, corpo: { ...VAZAMENTO, gravidade: "BAIXA" } }))).toBe(msg);
    expect(await erro(chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "RESOLVIDA" } }))).toBe(msg);
    expect(await erro(chamar("uma", "PATCH", { id, oc: o.id, corpo: { restaurar: true } }))).toBe(msg);
    expect(await erro(chamar("uma", "DELETE", { id, oc: o.id }))).toBe(msg);
    expect(JSON.stringify(await gravada(o.id))).toBe(antes);
    expect(await total()).toBe(1);
    expect((await chamar("lista", "GET", { id })).json.ocorrencias).toHaveLength(1);
    expect((await chamar("anexo", "GET", { id, oc: o.id })).status).toBe(200);
  });

  it("MULTIEMPRESA e o que não existe: plano de outra empresa é 404 para tudo; ocorrência de OUTRO plano também", async () => {
    const id = await plano();
    const o = await criar(id, { anexo: dataUrl(JPEG, "image/jpeg") });
    const outroPlano = await plano({ nome: "Outro plano da mesma empresa" });
    const daOutra = await plano({}, "e2");
    const antes = JSON.stringify(await gravada(o.id));
    const todas = async (alvo: { id: string; oc: string }) => [
      (await chamar("lista", "GET", { id: alvo.id })).status, (await chamar("lista", "POST", { id: alvo.id, corpo: VAZAMENTO })).status,
      (await chamar("uma", "PUT", { ...alvo, corpo: { ...VAZAMENTO, gravidade: "BAIXA" } })).status, (await chamar("uma", "PATCH", { ...alvo, corpo: { situacao: "RESOLVIDA" } })).status,
      (await chamar("uma", "PATCH", { ...alvo, corpo: { restaurar: true } })).status, (await chamar("uma", "DELETE", alvo)).status, (await chamar("anexo", "GET", alvo)).status,
    ];
    // A outra empresa, mesmo com todas as permissões, não vê nem muda o plano da e1
    como(permissoesTotais(), "e2");
    expect(await todas({ id, oc: o.id })).toEqual([404, 404, 404, 404, 404, 404, 404]);
    expect((await chamar("lista", "GET", { id: daOutra })).status).toBe(200);
    // E a e1 não escreve no plano da e2, nem liga coisa da e2
    como();
    expect(await todas({ id: daOutra, oc: o.id })).toEqual([404, 404, 404, 404, 404, 404, 404]);
    expect(await todas({ id: "nao-existe", oc: o.id })).toEqual([404, 404, 404, 404, 404, 404, 404]);
    // A ocorrência é de UM plano: pelo endereço de outro plano (da mesma empresa) ela não existe
    expect((await todas({ id: outroPlano, oc: o.id })).slice(2)).toEqual([404, 404, 404, 404, 404]);
    expect((await todas({ id, oc: "nao-existe" })).slice(2)).toEqual([404, 404, 404, 404, 404]);
    expect(await erro(chamar("uma", "PUT", { id: outroPlano, oc: o.id, corpo: VAZAMENTO }))).toBe("404 Ocorrência não encontrada");
    expect(JSON.stringify(await gravada(o.id))).toBe(antes);
    expect(await prisma.pmocOcorrencia.count({ where: { pmocId: daOutra } })).toBe(0);
    expect(await prisma.pmocOcorrencia.count({ where: { empresaId: "e1" } })).toBe(3); // a original + as duas criadas pelas chamadas válidas da e1 (plano e outroPlano)
  });

  /* ───────── permissões ───────── */
  it("RBAC: ver = PMOC › Visualizar; registrar, editar, resolver, restaurar e excluir = PMOC › Editar; técnico do app e sem módulo = 403", async () => {
    const id = await plano();
    const o = await criar(id, { anexo: dataUrl(JPEG, "image/jpeg") });
    const antes = `${JSON.stringify(await gravada(o.id))} ${await total()} ${(await historico(id)).length}`;
    const leituras = async () => [(await chamar("lista", "GET", { id })).status, (await chamar("anexo", "GET", { id, oc: o.id })).status];
    const escritas = async () => [
      (await chamar("lista", "POST", { id, corpo: VAZAMENTO })).status, (await chamar("uma", "PUT", { id, oc: o.id, corpo: { ...VAZAMENTO, gravidade: "BAIXA" } })).status,
      (await chamar("uma", "PATCH", { id, oc: o.id, corpo: { situacao: "RESOLVIDA" } })).status, (await chamar("uma", "PATCH", { id, oc: o.id, corpo: { restaurar: true } })).status,
      (await chamar("uma", "DELETE", { id, oc: o.id })).status,
    ];
    comPmoc(["visualizar"]);
    expect([await leituras(), await escritas()]).toEqual([[200, 200], [403, 403, 403, 403, 403]]);
    comPmoc(["visualizar", "criar", "excluir"]); // criar e excluir PMOC não dão direito a mexer nas ocorrências
    expect([await leituras(), await escritas()]).toEqual([[200, 200], [403, 403, 403, 403, 403]]);
    comPmoc(["editar"]); // editar sem visualizar: muda, mas não lista
    expect(await leituras()).toEqual([403, 403]);
    semModulo();
    expect([await leituras(), await escritas()]).toEqual([[403, 403], [403, 403, 403, 403, 403]]);
    tecnicoDoApp();
    expect([await leituras(), await escritas()]).toEqual([[403, 403], [403, 403, 403, 403, 403]]);
    for (const preset of [PRESETS.FINANCEIRO, PRESETS.AUXILIAR]) { como(preset); expect((await escritas()).every((s) => s === 403), JSON.stringify(preset.pmoc)).toBe(true); }
    sessao.atual = null;
    expect([await leituras(), await escritas()]).toEqual([[401, 401], [401, 401, 401, 401, 401]]);
    expect(`${JSON.stringify(await gravada(o.id))} ${await total()} ${(await historico(id)).length}`).toBe(antes);
    // Com "Visualizar" e "Editar" (sem criar nem excluir PMOC): faz tudo
    comPmoc(["visualizar", "editar"]);
    expect([await leituras(), await escritas()]).toEqual([[200, 200], [201, 200, 200, 200, 200]]);
    // O administrador passa sempre
    como({}, "e1", { role: "ADMIN" });
    expect(await leituras()).toEqual([200, 200]);
  });

  /* ───────── documento, número da aba, renovação e cópia ───────── */
  it("DOCUMENTO: as ocorrências que estão valendo entram no PDF (o do sistema e o do link público); a excluída não", async () => {
    const id = await plano({ tokenPublico: "token-publico-do-plano-de-teste-0001" });
    await criar(id, { equipamentoId: "q1" });
    await criar(id, { data: "2026-10-23", descricao: "Corrosão na base do chiller", gravidade: "MEDIA", situacao: "RESOLVIDA", resolvidaEm: "2026-11-04", resolucao: "Base lixada e pintada" });
    await criar(id, { data: "2026-11-07", descricao: "Ruído anormal no compressor", gravidade: "CRITICA", situacao: "EM_ANDAMENTO", equipamentoId: "q2" });
    const engano = await criar(id, { descricao: "Falha registrada por engano", gravidade: "BAIXA" });
    await chamar("uma", "DELETE", { id, oc: engano.id });
    await criar(await plano({ nome: "Outro plano" }), { descricao: "Ocorrência de outro plano" });

    const { carregarDocumento } = await import("@/lib/pmoc-documento-server");
    const carregado = await carregarDocumento({ id, empresaId: "e1" });
    expect(carregado!.dados.ocorrencias!.map((o) => [o.data, o.descricao, o.gravidade, o.situacao, o.resolvidaEm, o.resolucao, o.equipamento?.patrimonio ?? null])).toEqual([
      ["2026-10-23", "Corrosão na base do chiller", "MEDIA", "RESOLVIDA", "2026-11-04", "Base lixada e pintada", null],
      ["2026-11-07", "Ruído anormal no compressor", "CRITICA", "EM_ANDAMENTO", null, null, "AC-002"],
      ["2026-11-10", VAZAMENTO.descricao, "ALTA", "ABERTA", null, null, "AC-001"],
    ]);
    for (const r of [await chamar("documento", "GET", { id }), await chamar("publico", "GET", { token: "token-publico-do-plano-de-teste-0001" })]) {
      expect(r).toMatchObject({ status: 200, tipo: "application/pdf" });
      const texto = await textoDoPdf(r.bytes!);
      for (const trecho of ["5. Ocorrências", "3 ocorrências: 1 aberta, 1 em andamento e 1 resolvida.", "23/10/2026", "Geral da unidade", "Corrosão na base do chiller", "Resolução: Base lixada e pintada", "Média", "Resolvida em", "04/11/2026",
        "07/11/2026", "AC-002 · Split UTI 1", "Ruído anormal no compressor", "Crítica", "Em andamento", "10/11/2026", "AC-001 · Split da recepção", "Alta", "Aberta"]) expect(texto.replace(/\n/g, " "), trecho).toContain(trecho);
      expect(texto).not.toContain("registrada por engano");
      expect(texto).not.toContain("Ocorrência de outro plano");
      expect(texto.indexOf("Corrosão na base")).toBeLessThan(texto.indexOf("Ruído anormal"));
      expect(texto.indexOf("Ruído anormal")).toBeLessThan(texto.indexOf("Vazamento de água"));
    }
    // Restaurada, volta para o documento
    await chamar("uma", "PATCH", { id, oc: engano.id, corpo: { restaurar: true } });
    expect(await textoDoPdf((await chamar("documento", "GET", { id })).bytes!)).toContain("Falha registrada por engano");
    // A outra empresa não baixa
    como(permissoesTotais(), "e2");
    expect((await chamar("documento", "GET", { id })).status).toBe(404);
  });

  it("o NÚMERO DA ABA: as não resolvidas que estão valendo, só deste plano", async () => {
    const { ocorrenciasPendentes } = await import("@/lib/pmoc-ocorrencias-server");
    const id = await plano();
    expect(await ocorrenciasPendentes(id)).toBe(0);
    await criar(id); await criar(id, { situacao: "EM_ANDAMENTO" }); await criar(id, { situacao: "RESOLVIDA" });
    const excluida = await criar(id);
    await chamar("uma", "DELETE", { id, oc: excluida.id });
    await criar(await plano({ nome: "Outro plano" }));
    expect(await ocorrenciasPendentes(id)).toBe(2);
  });

  it("RENOVAÇÃO e CÓPIA não levam as ocorrências: elas ficam no plano em que foram registradas", async () => {
    const id = await plano();
    await criar(id, { equipamentoId: "q1" }); await criar(id, { situacao: "RESOLVIDA" });
    const renovado = await chamar("renovacao", "POST", { id, corpo: { nome: "PMOC 2028 — Hospital", dataInicio: "2027-08-01", dataExpiracao: "2028-07-31" } });
    const copia = await chamar("copia", "POST", { id });
    expect([renovado.status, copia.status]).toEqual([201, 201]);
    for (const novo of [renovado.json.id, copia.json.id]) {
      expect(await prisma.pmocOcorrencia.count({ where: { pmocId: novo } })).toBe(0);
      expect((await chamar("lista", "GET", { id: novo })).json.ocorrencias).toEqual([]);
      expect(await textoDoPdf((await chamar("documento", "GET", { id: novo })).bytes!)).toContain("Nenhuma ocorrência registrada neste plano até a emissão deste documento.");
    }
    expect(await prisma.pmocOcorrencia.count({ where: { pmocId: id } })).toBe(2);
    // O histórico do plano (a aba) mostra as linhas das ocorrências, com quem fez
    const linhas = (await chamar("historico", "GET", { id })).json.historico as { acao: string; usuario: string | null }[];
    expect(linhas.filter((l) => l.acao === "Ocorrência registrada").map((l) => l.usuario)).toEqual(["Ana Souza", "Ana Souza"]);
  });
});
