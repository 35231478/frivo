/**
 * DOCUMENTOS DA FICHA do colaborador nas rotas de verdade, sobre PostgreSQL de verdade.
 *
 * O que se prova:
 *  - permissão: sem sessão 401; ver/anexar/editar pede "Equipes › gerenciar"; EXCLUIR pede
 *    "Equipes › excluir" — e a recusa não muda nada no banco;
 *  - empresa: documento e colaborador de outra empresa são 404, nunca o arquivo;
 *  - anexar: o tipo é decidido pelos BYTES (um HTML com nome de PDF é recusado), e fica gravado
 *    quem anexou, o formato e o tamanho;
 *  - baixar: devolve os bytes com `nosniff` e nome de arquivo; documento sem arquivo é 404;
 *  - excluir COM RASTRO: a linha NÃO some do banco — ganha quem apagou e quando, sai da ficha,
 *    e o segundo clique não reescreve o rastro do primeiro;
 *  - o DEFEITO que esta leva conserta: salvar a ficha (PUT /api/tecnicos/[id]) não apaga mais os
 *    documentos — nem os que o RH anexou, nem os que o colaborador mandou pela admissão;
 *  - integração com a admissão: o arquivo que chega pelo link aparece na MESMA seção, marcado como
 *    "enviado na admissão", e excluir na ficha tira ele da conta de documentos entregues;
 *  - a lista de colaboradores não marca como "documento vencido" quem só tem documento excluído.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_docs_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({
  emailConfigAtiva: vi.fn(async () => false),
  enviarEmail: vi.fn(async () => ({ ok: true })),
  enviarEmailInterno: vi.fn(async () => ({ ok: true })),
}));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = empresaId === "e1" ? "uA" : "uB") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@x.com", empresaId, empresaNome: "Empresa", role: "OPERADOR", permissoes, tecnicoId: null } };
};
/** Edita colaborador, mas não pode excluir (nem documento) */
const semExcluir = () => como(montarPermissoes({ equipes: ["visualizar", "gerenciar"] }));
/** Só vê a lista de equipes: não abre a ficha completa nem os documentos */
const soVisualiza = () => como(montarPermissoes({ equipes: ["visualizar"] }));
const deslogado = () => { sessao.atual = null; };

const ROTAS = {
  docs: "api/tecnicos/[id]/documentos",
  doc: "api/tecnicos/[id]/documentos/[docId]",
  tecnico: "api/tecnicos/[id]",
  pubDocs: "api/publico/admissao/[token]/documentos",
  pubDoc: "api/publico/admissao/[token]/documentos/[documentoId]",
  consentir: "api/publico/admissao/[token]/consentimento",
  admissoes: "api/admissoes",
  admissao: "api/admissoes/[id]",
} as const;

async function chamar(rota: keyof typeof ROTAS, metodo: string, op: { id?: string; docId?: string; token?: string; documentoId?: string; corpo?: unknown; query?: string } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${op.query ? `?${op.query}` : ""}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "user-agent": "Mozilla/5.0", "x-forwarded-for": "200.1.2.3" },
    body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
  });
  const res: Response = await mod[metodo](req, {
    params: Promise.resolve({ id: op.id ?? "", docId: op.docId ?? "", token: op.token ?? "", documentoId: op.documentoId ?? "" }),
  });
  const tipo = res.headers.get("Content-Type") ?? "";
  return {
    status: res.status,
    headers: res.headers,
    json: tipo.includes("json") ? await res.json().catch(() => null) : null,
    bytes: tipo.includes("json") ? null : new Uint8Array(await res.arrayBuffer()),
  };
}
const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`; };

const dataUrl = (bytes: Uint8Array, tipo: string) => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
const PDF = new Uint8Array([...new TextEncoder().encode("%PDF-1.4\n"), ...new Uint8Array(400).fill(0x20)]);
const FOTO = dataUrl(PNG, "image/png");
const DOCUMENTO = dataUrl(PDF, "application/pdf");
/** Um HTML com script, com nome e cabeçalho de PDF: o conteúdo é que decide */
const DISFARCADO = dataUrl(new TextEncoder().encode("<html><script>alert(1)</script></html>"), "application/pdf");

const CPF_CARLOS = "11144477735";

/** O cadastro completo que o PUT de /api/tecnicos/[id] exige */
const CADASTRO = {
  nome: "Carlos Eduardo Lima", cpf: CPF_CARLOS, telefone: "11977776666",
  tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO", statusColaborador: "ATIVO",
  competenciaIds: [], especialidades: [],
};

describe.skipIf(!URL_PG)("Documentos da ficha do colaborador (PostgreSQL real)", () => {
  let prisma: any;

  const anexar = async (corpo: Record<string, unknown> = {}, id = "t1") =>
    chamar("docs", "POST", { id, corpo: { categoria: "contrato", nome: "Contrato 2024", arquivoUrl: DOCUMENTO, ...corpo } });

  const anexado = async (corpo: Record<string, unknown> = {}, id = "t1") => {
    const r = await anexar(corpo, id);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json.documento as any;
  };

  const listar = async (id = "t1") => {
    const r = await chamar("docs", "GET", { id });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return r.json.documentos as any[];
  };

  const gravado = (docId: string) => prisma.colaboradorDocumento.findUnique({ where: { id: docId } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total LTDA", cnpj: "12.345.678/0001-90", email: "c@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto Dias", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cargo.create({ data: { id: "g1", empresaId: "e1", nome: "Técnico de refrigeração" } });
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    await prisma.admissao.deleteMany({});
    await prisma.colaboradorDocumento.deleteMany({});
    await prisma.tecnico.deleteMany({});
    await prisma.admissaoConfig.deleteMany({});
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Carlos Eduardo Lima", cpf: CPF_CARLOS, telefone: "11977776666", cargoId: "g1" },
      { id: "tE2", empresaId: "e2", nome: "Pessoa da outra empresa", cpf: "52998224725", telefone: "11966665555" },
    ] });
    como();
  });

  /* ───────────────────────── permissão ───────────────────────── */

  it("sem sessão é 401 em tudo, e nada é gravado", async () => {
    deslogado();
    expect(await erro(chamar("docs", "GET", { id: "t1" }))).toBe("401 Não autorizado");
    expect(await erro(anexar())).toBe("401 Não autorizado");
    expect(await prisma.colaboradorDocumento.count()).toBe(0);
  });

  it("quem só VISUALIZA equipes não vê nem anexa documento (é dado sensível da pessoa)", async () => {
    soVisualiza();
    expect(await erro(chamar("docs", "GET", { id: "t1" }))).toBe("403 Sem permissão para esta ação");
    expect(await erro(anexar())).toBe("403 Sem permissão para esta ação");
    expect(await prisma.colaboradorDocumento.count()).toBe(0);
  });

  it("BAIXAR um documento pede a mesma permissão: quem só visualiza equipes não recebe o arquivo", async () => {
    const doc = await anexado({ arquivoUrl: DOCUMENTO });
    soVisualiza();
    const r = await chamar("doc", "GET", { id: "t1", docId: doc.id });
    expect(`${r.status} ${r.json?.erro ?? ""}`).toBe("403 Sem permissão para esta ação");
    expect(r.bytes, "nem um byte do arquivo sai").toBeNull();
    // e editar também não
    expect(await erro(chamar("doc", "PATCH", { id: "t1", docId: doc.id, corpo: { nome: "Outro" } }))).toBe("403 Sem permissão para esta ação");
    deslogado();
    expect(await erro(chamar("doc", "GET", { id: "t1", docId: doc.id }))).toBe("401 Não autorizado");
  });

  it("EXCLUIR pede a permissão alta: quem só gerencia recebe 403 e o documento continua na ficha", async () => {
    const doc = await anexado();
    semExcluir();
    expect(await erro(chamar("doc", "DELETE", { id: "t1", docId: doc.id }))).toBe("403 Sem permissão para esta ação");
    expect((await gravado(doc.id)).excluidoEm).toBeNull();
    // mas continua podendo editar e baixar
    expect((await chamar("doc", "PATCH", { id: "t1", docId: doc.id, corpo: { nome: "Outro nome" } })).status).toBe(200);
    expect((await chamar("doc", "GET", { id: "t1", docId: doc.id })).status).toBe(200);
  });

  /* ───────────────────────── empresa ───────────────────────── */

  it("colaborador e documento de OUTRA empresa são 404 — nunca o arquivo", async () => {
    const doc = await anexado();
    como(permissoesTotais(), "e2");
    expect(await erro(chamar("docs", "GET", { id: "t1" }))).toBe("404 Colaborador não encontrado");
    expect(await erro(anexar({}, "t1"))).toBe("404 Colaborador não encontrado");
    // o id do documento é de outra empresa: não devolve bytes, devolve 404
    expect(await erro(chamar("doc", "GET", { id: "tE2", docId: doc.id }))).toBe("404 Documento não encontrado");
    expect(await erro(chamar("doc", "DELETE", { id: "tE2", docId: doc.id }))).toBe("404 Documento não encontrado");
    expect((await gravado(doc.id)).excluidoEm).toBeNull();
  });

  it("o id certo com o colaborador errado DENTRO da mesma empresa também é 404", async () => {
    const doc = await anexado();
    await prisma.tecnico.create({ data: { id: "t2", empresaId: "e1", nome: "Outra pessoa", cpf: "52998224725", telefone: "11955554444" } });
    expect(await erro(chamar("doc", "GET", { id: "t2", docId: doc.id }))).toBe("404 Documento não encontrado");
  });

  /* ───────────────────────── anexar ───────────────────────── */

  it("anexar grava o arquivo, a categoria, quem anexou, o formato e o tamanho", async () => {
    const doc = await anexado({ categoria: "aso", nome: "ASO admissional", dataVencimento: "2027-03-10", arquivoUrl: DOCUMENTO });
    expect(doc).toMatchObject({
      nome: "ASO admissional", categoria: "aso", origem: "MANUAL",
      arquivoTipo: "application/pdf", criadoPorNome: "Ana Souza", temArquivo: true,
    });
    expect(doc.tamanho).toBe(PDF.length);
    const linha = await gravado(doc.id);
    expect(linha.criadoPorId).toBe("uA");
    expect(linha.dataVencimento.toISOString()).toBe("2027-03-10T00:00:00.000Z");
    expect(linha.arquivoUrl.startsWith("data:application/pdf;base64,")).toBe(true);
  });

  it("o TIPO é decidido pelos bytes: HTML com nome de PDF é recusado e nada é gravado", async () => {
    expect(await erro(anexar({ arquivoUrl: DISFARCADO }))).toMatch(/^400 /);
    expect(await prisma.colaboradorDocumento.count()).toBe(0);
  });

  it("sem arquivo, categoria inventada e data torta são recusados", async () => {
    expect(await erro(anexar({ arquivoUrl: "" }))).toMatch(/^400 /);
    expect(await erro(chamar("doc", "PATCH", { id: "t1", docId: (await anexado()).id, corpo: { categoria: "gaveta_inventada" } }))).toBe("400 Categoria inválida");
    expect(await erro(anexar({ dataVencimento: "ontem" }))).toBe("400 Data de validade inválida");
  });

  it("categoria que NÃO existe é recusada no anexar — não arquivada em \"Outros\" em silêncio", async () => {
    expect(await erro(anexar({ categoria: "gaveta_inventada" }))).toBe("400 Categoria inválida");
    expect(await prisma.colaboradorDocumento.count(), "e nada é gravado").toBe(0);
    // categoria em branco, sim, vira "Outros": é ausência, não erro de digitação
    expect((await anexado({ categoria: "" })).categoria).toBe("outros");
    expect((await anexado({ categoria: undefined })).categoria).toBe("outros");
  });

  it("sem nome digitado, o documento ganha o nome do arquivo (a lista não fica ilegível)", async () => {
    const doc = await anexado({ nome: "", arquivoUrl: FOTO });
    expect(doc.nome.length).toBeGreaterThan(0);
    expect(doc.arquivoTipo).toBe("image/png");
  });

  /* ───────────────────────── baixar ───────────────────────── */

  it("baixar devolve os bytes guardados, com nosniff e nome de arquivo", async () => {
    const doc = await anexado({ arquivoUrl: DOCUMENTO });
    const r = await chamar("doc", "GET", { id: "t1", docId: doc.id });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Disposition")).toContain("attachment");
    expect(Array.from(r.bytes!.slice(0, 5))).toEqual(Array.from(PDF.slice(0, 5)));
    // ?ver=1 abre na aba em vez de baixar
    const ver = await chamar("doc", "GET", { id: "t1", docId: doc.id, query: "ver=1" });
    expect(ver.headers.get("Content-Disposition")).toContain("inline");
  });

  it("documento ANTIGO sem arquivo guardado é 404 no download, e a lista avisa que não tem arquivo", async () => {
    const legado = await prisma.colaboradorDocumento.create({
      data: { colaboradorId: "t1", tipo: "Diploma", nome: "Diploma (papel)", arquivoUrl: null },
    });
    expect(await erro(chamar("doc", "GET", { id: "t1", docId: legado.id }))).toBe("404 Este documento não tem arquivo anexado.");
    const lista = await listar();
    expect(lista.find((d) => d.id === legado.id)).toMatchObject({ temArquivo: false, categoria: null, tipo: "Diploma" });
  });

  /* ───────────────────────── excluir com rastro ───────────────────────── */

  it("excluir tira da ficha e NÃO apaga do banco: fica quem apagou e quando", async () => {
    const doc = await anexado();
    const r = await chamar("doc", "DELETE", { id: "t1", docId: doc.id });
    expect(r.status).toBe(200);

    expect(await listar()).toHaveLength(0);
    const linha = await gravado(doc.id);
    expect(linha, "a linha continua no banco").not.toBeNull();
    expect(linha.excluidoPorId).toBe("uA");
    expect(linha.excluidoEm.toISOString()).toBe(AGORA.toISOString());
    expect(linha.arquivoUrl, "o arquivo também fica").not.toBeNull();
  });

  it("o segundo clique em excluir é 404 e NÃO reescreve o rastro do primeiro", async () => {
    const doc = await anexado();
    await chamar("doc", "DELETE", { id: "t1", docId: doc.id });
    const antes = await gravado(doc.id);

    vi.setSystemTime(new Date(AGORA.getTime() + 60 * 60_000));
    como(permissoesTotais(), "e1", "uA");
    expect(await erro(chamar("doc", "DELETE", { id: "t1", docId: doc.id }))).toBe("404 Documento não encontrado");

    const depois = await gravado(doc.id);
    expect(depois.excluidoEm.toISOString()).toBe(antes.excluidoEm.toISOString());
  });

  it("documento excluído não volta por editar nem por download", async () => {
    const doc = await anexado();
    await chamar("doc", "DELETE", { id: "t1", docId: doc.id });
    expect(await erro(chamar("doc", "PATCH", { id: "t1", docId: doc.id, corpo: { nome: "Ressuscitar" } }))).toBe("404 Documento não encontrado");
    expect(await erro(chamar("doc", "GET", { id: "t1", docId: doc.id }))).toBe("404 Documento não encontrado");
  });

  /* ───────────────────────── editar ───────────────────────── */

  it("editar muda gaveta, nome e validade — e nunca o arquivo", async () => {
    const doc = await anexado({ arquivoUrl: DOCUMENTO });
    const r = await chamar("doc", "PATCH", { id: "t1", docId: doc.id, corpo: { categoria: "nr_35", nome: "NR-35 2026", dataVencimento: "2027-01-20" } });
    expect(r.status).toBe(200);
    expect(r.json.documento).toMatchObject({ categoria: "nr_35", nome: "NR-35 2026", temArquivo: true });

    const linha = await gravado(doc.id);
    expect(linha.dataVencimento.toISOString()).toBe("2027-01-20T00:00:00.000Z");
    expect(linha.arquivoUrl).toBe((await gravado(doc.id)).arquivoUrl);
    // tirar a validade é mandar vazio
    await chamar("doc", "PATCH", { id: "t1", docId: doc.id, corpo: { dataVencimento: "" } });
    expect((await gravado(doc.id)).dataVencimento).toBeNull();
  });

  it("nome em branco é recusado e nada muda", async () => {
    const doc = await anexado({ nome: "Contrato 2024" });
    expect(await erro(chamar("doc", "PATCH", { id: "t1", docId: doc.id, corpo: { nome: "   " } }))).toBe("400 O documento precisa de um nome.");
    expect((await gravado(doc.id)).nome).toBe("Contrato 2024");
  });

  /* ───────────────────── o defeito que esta leva conserta ───────────────────── */

  it("salvar a ficha NÃO apaga mais os documentos (antes fazia deleteMany na lista inteira)", async () => {
    const a = await anexado({ nome: "Contrato assinado" });
    const b = await anexado({ categoria: "aso", nome: "ASO 2026", arquivoUrl: FOTO });

    const r = await chamar("tecnico", "PUT", { id: "t1", corpo: { ...CADASTRO, nome: "Carlos Eduardo Lima Filho" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    const depois = await listar();
    expect(depois.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
    // o id e a data de envio continuam os MESMOS (antes eram recriados a cada salvada)
    expect((await gravado(a.id)).criadoEm.toISOString()).toBe(AGORA.toISOString());
    expect((await gravado(a.id)).criadoPorId).toBe("uA");
  });

  it("salvar a ficha também não derruba o que o colaborador acabou de mandar pela admissão", async () => {
    const admissao = await criarAdmissao();
    await chamar("consentir", "POST", { token: admissao.token });
    const env = await chamar("pubDocs", "POST", { token: admissao.token, corpo: { docId: "rg", nome: "rg.png", arquivoUrl: FOTO } });
    expect(env.status, JSON.stringify(env.json)).toBe(201);

    como();
    const r = await chamar("tecnico", "PUT", { id: admissao.colaboradorId, corpo: { ...CADASTRO, nome: "Marina Alves", cpf: "52998224725", telefone: "11988887777" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await listar(admissao.colaboradorId)).toHaveLength(1);
  });

  /* ───────────────────── integração com a admissão ───────────────────── */

  it("o que chega pelo link aparece na MESMA seção, marcado como enviado na admissão", async () => {
    const admissao = await criarAdmissao();
    await chamar("consentir", "POST", { token: admissao.token });
    await chamar("pubDocs", "POST", { token: admissao.token, corpo: { docId: "comprovante_residencia", nome: "conta-luz.png", arquivoUrl: FOTO } });

    como();
    const lista = await listar(admissao.colaboradorId);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      origem: "ADMISSAO", categoria: "comprovante_residencia", tipo: "comprovante_residencia",
      criadoPorNome: null, arquivoTipo: "image/png", temArquivo: true,
    });
    // e dá para baixar pela ficha, como qualquer outro
    expect((await chamar("doc", "GET", { id: admissao.colaboradorId, docId: lista[0].id })).status).toBe(200);
  });

  it("o progresso da admissão também para de contar o documento excluído na ficha", async () => {
    const admissao = await criarAdmissao();
    await chamar("consentir", "POST", { token: admissao.token });
    await chamar("pubDocs", "POST", { token: admissao.token, corpo: { docId: "rg", nome: "rg.png", arquivoUrl: FOTO } });

    como();
    const antes = await chamar("admissao", "GET", { id: admissao.id });
    expect(antes.json.documentos.map((d: any) => d.docId)).toEqual(["rg"]);
    expect(antes.json.documentosFaltando.some((d: any) => d.id === "rg")).toBe(false);

    const lista = await listar(admissao.colaboradorId);
    await chamar("doc", "DELETE", { id: admissao.colaboradorId, docId: lista[0].id });

    const depois = await chamar("admissao", "GET", { id: admissao.id });
    expect(depois.json.documentos, "o arquivo excluído sai do progresso").toEqual([]);
    expect(depois.json.documentosFaltando.some((d: any) => d.id === "rg"), "e volta a faltar").toBe(true);
  });

  it("excluir na ficha tira o documento da conta de entregues da admissão (uma verdade só)", async () => {
    const admissao = await criarAdmissao();
    await chamar("consentir", "POST", { token: admissao.token });
    await chamar("pubDocs", "POST", { token: admissao.token, corpo: { docId: "rg", nome: "rg.png", arquivoUrl: FOTO } });

    como();
    const lista = await listar(admissao.colaboradorId);
    const antes = await chamar("admissoes", "GET");
    expect(antes.json[0].documentosEnviados).toBe(1);

    await chamar("doc", "DELETE", { id: admissao.colaboradorId, docId: lista[0].id });
    const depois = await chamar("admissoes", "GET");
    expect(depois.json[0].documentosEnviados).toBe(0);
  });

  it("o colaborador apagando pelo link também deixa rastro (não some da base)", async () => {
    const admissao = await criarAdmissao();
    await chamar("consentir", "POST", { token: admissao.token });
    const env = await chamar("pubDocs", "POST", { token: admissao.token, corpo: { docId: "rg", nome: "rg.png", arquivoUrl: FOTO } });
    const docId = env.json.id as string;

    const r = await chamar("pubDoc", "DELETE", { token: admissao.token, documentoId: docId });
    expect(r.status).toBe(200);
    const linha = await gravado(docId);
    expect(linha, "a linha continua no banco").not.toBeNull();
    expect(linha.excluidoEm).not.toBeNull();
    expect(linha.excluidoPorId, "quem apagou foi o colaborador, que não é usuário do sistema").toBeNull();

    como();
    expect(await listar(admissao.colaboradorId)).toHaveLength(0);
  });

  /* ───────────────────── a lista de colaboradores ───────────────────── */

  it("documento EXCLUÍDO não marca mais o colaborador como vencido na lista", async () => {
    const { lerFiltrosColaboradores, montarWhereColaboradores } = await import("@/lib/colaborador-listagem");
    const doc = await anexado({ dataVencimento: "2026-10-01" });

    const where = (aviso: string) => montarWhereColaboradores("e1", lerFiltrosColaboradores({ aviso }));
    expect(await prisma.tecnico.count({ where: where("doc_vencido") })).toBe(1);

    await chamar("doc", "DELETE", { id: "t1", docId: doc.id });
    expect(await prisma.tecnico.count({ where: where("doc_vencido") })).toBe(0);
  });

  /** Um convite de admissão para uma pessoa nova (a rota cria o pré-cadastro inativo) */
  async function criarAdmissao() {
    como();
    const r = await chamar("admissoes", "POST", { corpo: { nome: "Marina Alves", cpf: "52998224725", cargoId: "g1", salario: 3200, telefone: "11988887777" } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const a = await prisma.admissao.findUnique({ where: { id: r.json.id } });
    return { token: a.token as string, colaboradorId: a.colaboradorId as string, id: a.id as string };
  }
});
