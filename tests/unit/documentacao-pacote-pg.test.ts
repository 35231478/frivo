/**
 * DOCUMENTAÇÃO DA EQUIPE PARA O CLIENTE nas rotas de verdade, sobre PostgreSQL de verdade.
 *
 * O que se prova:
 *  - permissão: 401 sem sessão; 403 sem "Documentos do colaborador › enviar ao cliente" — MESMO para
 *    quem gera documento na ficha (criar/gerenciar) ou gerencia colaboradores;
 *  - empresa: cliente, contrato, colaborador e envio de OUTRA empresa são 404 — nunca dados;
 *  - advertência e dados bancários são recusados mesmo que a tela mande;
 *  - VENCIDO segura o pacote (409, com a lista) e nada é gravado; falta pede confirmação;
 *  - o pacote grava a LISTA FECHADA dos arquivos, com as pastas escolhidas;
 *  - as três vias: LINK (token e prazo), ZIP (sem link, baixa com as pastas), EMAIL (leva o LINK,
 *    para os contatos do cadastro do cliente, com "responder para" = a empresa);
 *  - LGPD do link: só os itens do pacote — documento de outro colaborador, de outra gaveta ou
 *    anexado depois não aparece e não baixa, nem trocando id na URL; arquivo excluído some;
 *  - link expirado e revogado: 410, mesma mensagem do link que não existe (404); revogar não apaga;
 *  - o acesso do cliente fica registrado (abrir, baixar arquivo, baixar zip), com IP e navegador;
 *  - link novo é token novo, e pacote com documento que venceu depois não ganha link novo;
 *  - LOTE: um envio por cliente — cada um com o seu token, os seus arquivos e os seus e-mails;
 *    um cliente com vencido não segura os outros;
 *  - quem atende o cliente é sugerido pelo contrato, pelas OS e pela equipe — e ex-colaborador não.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_docequipe_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

/** O envio de e-mail é o único "de fora": aqui ele só registra o que sairia. O resto do módulo é o real. */
const correio = vi.hoisted(() => ({ enviados: [] as any[], falhar: false }));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  enviarEmail: vi.fn(async (empresaId: string, p: any) => {
    if (correio.falhar) return { ok: false, erro: "Resend fora do ar" };
    correio.enviados.push({ empresaId, ...p });
    return { ok: true };
  }),
}));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = empresaId === "e1" ? "uA" : "uB") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@climatotal.com", empresaId, empresaNome: "Empresa", role: "OPERADOR", permissoes, tecnicoId: null } };
};
/** Quem gera documento na ficha e gerencia colaboradores — mas NÃO envia ao cliente. */
const semEnviar = () => como(montarPermissoes({ documentos: ["criar", "gerenciar", "disciplinar"], equipes: ["visualizar", "gerenciar", "excluir"], admissao: ["gerenciar"] }));
const deslogado = () => { sessao.atual = null; };

const ROTAS = {
  sugestoes: "api/documentacao/sugestoes",
  previa: "api/documentacao/previa",
  envios: "api/documentacao/envios",
  lote: "api/documentacao/envios/lote",
  envio: "api/documentacao/envios/[id]",
  zip: "api/documentacao/envios/[id]/zip",
  link: "api/documentacao/envios/[id]/link",
  revogar: "api/documentacao/envios/[id]/revogar",
  email: "api/documentacao/envios/[id]/email",
  pubLista: "api/publico/documentacao/[token]",
  pubArquivo: "api/publico/documentacao/[token]/arquivo/[itemId]",
  pubZip: "api/publico/documentacao/[token]/zip",
} as const;

async function chamar(
  rota: keyof typeof ROTAS, metodo: string,
  op: { id?: string; token?: string; itemId?: string; corpo?: unknown; query?: string; ip?: string } = {},
) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${op.query ? `?${op.query}` : ""}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0)", "x-forwarded-for": op.ip ?? "200.1.2.3" },
    body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
  });
  const res: Response = await mod[metodo](req, {
    params: Promise.resolve({ id: op.id ?? "", token: op.token ?? "", itemId: op.itemId ?? "" }),
  });
  const tipo = res.headers.get("Content-Type") ?? "";
  return {
    status: res.status,
    headers: res.headers,
    json: tipo.includes("json") ? await res.json().catch(() => null) : null,
    bytes: tipo.includes("json") ? null : new Uint8Array(await res.arrayBuffer()),
  };
}

const PDF = (marca: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${marca}\n`).toString("base64")}`;

/** Lê os nomes e o conteúdo de um zip (o formato simples que lib/zip.ts escreve). */
function lerZip(bytes: Uint8Array): Record<string, string> {
  const b = Buffer.from(bytes);
  const saida: Record<string, string> = {};
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const metodo = b.readUInt16LE(p + 8), comprimido = b.readUInt32LE(p + 18);
    const nomeTam = b.readUInt16LE(p + 26), extraTam = b.readUInt16LE(p + 28);
    const nome = b.subarray(p + 30, p + 30 + nomeTam).toString("utf8");
    const dados = b.subarray(p + 30 + nomeTam + extraTam, p + 30 + nomeTam + extraTam + comprimido);
    saida[nome] = (metodo === 8 ? inflateRawSync(dados) : dados).toString("utf8");
    p += 30 + nomeTam + extraTam + comprimido;
  }
  return saida;
}

const SELECAO = { clienteId: "c1", colaboradorIds: ["t1", "t2"], categorias: ["aso", "nr_10"] };

describe.skipIf(!URL_PG)("Documentação da equipe para o cliente (PostgreSQL real)", () => {
  let prisma: any;

  const criar = (extra: Record<string, unknown> = {}) =>
    chamar("envios", "POST", { corpo: { ...SELECAO, via: "LINK", ...extra } });
  const tokenDe = async (id: string) => (await prisma.documentacaoEnvio.findUnique({ where: { id }, select: { token: true } })).token as string;
  const eventos = async (id: string) => (await prisma.documentacaoEnvioEvento.findMany({ where: { envioId: id }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] })).map((e: any) => e.tipo);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total LTDA", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "contato@climatotal.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@climatotal.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto Dias", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Shopping Ibirapuera S.A.", nomeFantasia: "Shopping Ibirapuera", cpfCnpj: "11.111.111/0001-11", email: "geral@shopping.com" },
      { id: "c2", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "22.222.222/0001-22", email: "compras@hospital.com" },
      { id: "c3", empresaId: "e1", nome: "Padaria sem e-mail", cpfCnpj: "33.333.333/0001-33" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "44.444.444/0001-44", email: "x@x.com" },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "k1", empresaId: "e1", clienteId: "c1", nome: "Rita (segurança)", tipo: "OPERACIONAL", email: "seguranca@shopping.com", principal: true },
      { id: "k2", empresaId: "e1", clienteId: "c1", nome: "Caio (manutenção)", tipo: "OPERACIONAL", email: "manutencao@shopping.com" },
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
    correio.enviados = []; correio.falhar = false;
    await prisma.tentativaAcesso.deleteMany({});
    await prisma.documentacaoEnvio.deleteMany({});
    await prisma.ordemServico.deleteMany({});
    await prisma.contrato.deleteMany({});
    await prisma.equipe.deleteMany({});
    await prisma.colaboradorDocumento.deleteMany({});
    await prisma.tecnico.deleteMany({});
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Marina Alves", cpf: "52998224725", telefone: "(19) 98888-7777" },
      { id: "t2", empresaId: "e1", nome: "João Lima", cpf: "11144477735", telefone: "(19) 97777-6666" },
      { id: "t3", empresaId: "e1", nome: "Carla Reis", cpf: "39053344705", telefone: "(19) 96666-5555" },
      { id: "t4", empresaId: "e1", nome: "Ex Colaborador", cpf: "86288366757", telefone: "(19) 95555-4444", ativo: false },
      { id: "tX", empresaId: "e2", nome: "Pedro de Outra Empresa", cpf: "71428793860", telefone: "(19) 94444-3333" },
    ] });
    await prisma.colaboradorDocumento.createMany({ data: [
      { id: "d-m-aso", colaboradorId: "t1", tipo: "aso", categoria: "aso", nome: "ASO periódico", arquivoUrl: PDF("aso-marina"), tamanho: 30, dataVencimento: dia("2027-06-01") },
      { id: "d-m-nr10", colaboradorId: "t1", tipo: "nr_10", categoria: "nr_10", nome: "Certificado NR-10", arquivoUrl: PDF("nr10-marina"), tamanho: 30, dataVencimento: dia("2027-03-01") },
      { id: "d-m-adv", colaboradorId: "t1", tipo: "disciplinar", categoria: "disciplinar", nome: "Advertência", arquivoUrl: PDF("advertencia-marina"), tamanho: 30 },
      { id: "d-m-contrato", colaboradorId: "t1", tipo: "contrato", categoria: "contrato", nome: "Contrato de trabalho", arquivoUrl: PDF("contrato-marina"), tamanho: 30 },
      { id: "d-j-aso", colaboradorId: "t2", tipo: "aso", categoria: "aso", nome: "ASO periódico", arquivoUrl: PDF("aso-joao"), tamanho: 30, dataVencimento: dia("2027-06-01") },
      { id: "d-j-nr10", colaboradorId: "t2", tipo: "nr_10", categoria: "nr_10", nome: "Certificado NR-10", arquivoUrl: PDF("nr10-joao"), tamanho: 30, dataVencimento: dia("2027-03-01") },
      { id: "d-c-aso", colaboradorId: "t3", tipo: "aso", categoria: "aso", nome: "ASO periódico", arquivoUrl: PDF("aso-carla"), tamanho: 30, dataVencimento: dia("2027-06-01") },
      { id: "d-x-aso", colaboradorId: "tX", tipo: "aso", categoria: "aso", nome: "ASO de outra empresa", arquivoUrl: PDF("aso-outra-empresa"), tamanho: 30 },
    ] });
    como();
  });

  /* ───────────────────────── permissão e empresa ───────────────────────── */

  it("sem sessão é 401 em todas as rotas internas, e nem um byte sai", async () => {
    deslogado();
    for (const [rota, metodo] of [["sugestoes", "GET"], ["previa", "POST"], ["envios", "GET"], ["envios", "POST"], ["lote", "POST"], ["envio", "GET"], ["zip", "GET"], ["link", "POST"], ["revogar", "POST"], ["email", "POST"]] as const) {
      const r = await chamar(rota, metodo, { id: "x", corpo: metodo === "POST" ? {} : undefined });
      expect(r.status, `${metodo} ${rota}`).toBe(401);
      expect(r.bytes, `${metodo} ${rota}`).toBeNull();
    }
  });

  it("gerar documento e gerenciar colaborador NÃO dão o direito de enviar ao cliente: 403", async () => {
    const g = await criar();
    expect(g.status, JSON.stringify(g.json)).toBe(201);

    semEnviar();
    expect((await chamar("previa", "POST", { corpo: SELECAO })).status).toBe(403);
    expect((await criar()).status).toBe(403);
    expect((await chamar("envios", "GET")).status).toBe(403);
    expect((await chamar("envio", "GET", { id: g.json.envio.id })).status).toBe(403);
    expect((await chamar("zip", "GET", { id: g.json.envio.id })).status).toBe(403);
    expect((await chamar("revogar", "POST", { id: g.json.envio.id })).status).toBe(403);
    expect((await chamar("lote", "POST", { corpo: { via: "LINK", envios: [SELECAO] } })).status).toBe(403);
    // e nada mudou: o link continua vivo
    como();
    expect((await chamar("envio", "GET", { id: g.json.envio.id })).json.link).toBe("ATIVO");
  });

  it("cliente, contrato e colaborador de OUTRA empresa são 404 — e nada é gravado", async () => {
    expect((await criar({ clienteId: "cX" })).status).toBe(404);
    expect((await criar({ colaboradorIds: ["t1", "tX"] })).status, "um id de fora derruba o pedido inteiro").toBe(404);
    await prisma.contrato.create({ data: { id: "kX", empresaId: "e1", clienteId: "c2", numero: "CT-9", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: AGORA } });
    expect((await criar({ contratoId: "kX" })).status, "contrato de outro cliente").toBe(404);
    expect(await prisma.documentacaoEnvio.count()).toBe(0);
  });

  it("envio de outra empresa é 404 em todas as rotas que recebem o id", async () => {
    const g = await criar();
    como(permissoesTotais(), "e2");
    for (const [rota, metodo] of [["envio", "GET"], ["zip", "GET"], ["link", "POST"], ["revogar", "POST"], ["email", "POST"]] as const) {
      const r = await chamar(rota, metodo, { id: g.json.envio.id, corpo: metodo === "POST" ? {} : undefined });
      expect(r.status, `${metodo} ${rota}`).toBe(404);
      expect(r.bytes, `${metodo} ${rota}`).toBeNull();
    }
    expect((await chamar("envios", "GET")).json.envios).toEqual([]);
    como();
    expect((await chamar("envio", "GET", { id: g.json.envio.id })).json.link, "e não foi revogado pela outra empresa").toBe("ATIVO");
  });

  /* ───────────────────────── o que pode sair ───────────────────────── */

  it("advertência e dados bancários são recusados mesmo que a tela mande", async () => {
    const r = await criar({ categorias: ["aso", "disciplinar"] });
    expect(r.status).toBe(400);
    expect(r.json.erro).toContain("não pode ser enviado a cliente");
    expect((await criar({ categorias: ["dados_bancarios"] })).status).toBe(400);
    expect((await criar({ categorias: ["inventada"] })).status).toBe(400);
    expect(await prisma.documentacaoEnvio.count()).toBe(0);
  });

  it("a seleção é conferida: sem cliente, sem colaborador ou sem tipo não gera", async () => {
    expect((await criar({ clienteId: "" })).json.erro).toContain("cliente");
    expect((await criar({ colaboradorIds: [] })).json.erro).toContain("colaborador");
    expect((await criar({ categorias: [] })).json.erro).toContain("tipo de documento");
    expect((await criar({ via: "WHATSAPP" })).status).toBe(400);
    expect((await criar({ organizacao: "QUALQUER" })).status).toBe(400);
  });

  /* ───────────────────────── a prévia e o bloqueio ───────────────────────── */

  it("a prévia mostra o que entra, o que falta e os e-mails do cadastro — sem gravar nada", async () => {
    const r = await chamar("previa", "POST", { corpo: { ...SELECAO, colaboradorIds: ["t1", "t3"] } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.cliente.nome).toBe("Shopping Ibirapuera");
    expect(r.json.itens.map((i: any) => `${i.colaboradorNome}:${i.categoria}`).sort())
      .toEqual(["Carla Reis:aso", "Marina Alves:aso", "Marina Alves:nr_10"]);
    expect(r.json.faltando).toEqual([expect.objectContaining({ colaboradorNome: "Carla Reis", categoria: "nr_10" })]);
    expect(r.json.vencidos).toEqual([]);
    expect(r.json.liberado).toBe(true);
    // os contatos operacionais do cliente: o principal no Para, o resto na cópia
    expect(r.json.email).toEqual({ para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"] });
    expect(await prisma.documentacaoEnvio.count()).toBe(0);
  });

  it("documento VENCIDO segura o pacote: 409 com a lista, e nada é gravado", async () => {
    await prisma.colaboradorDocumento.update({ where: { id: "d-j-aso" }, data: { dataVencimento: dia("2026-10-01") } });

    const previa = await chamar("previa", "POST", { corpo: SELECAO });
    expect(previa.json.liberado).toBe(false);
    expect(previa.json.mensagemVencidos).toContain("ASO (exame) de João Lima");

    for (const via of ["LINK", "ZIP", "EMAIL"]) {
      const r = await criar({ via });
      expect(r.status, via).toBe(409);
      expect(r.json.erro, via).toContain("vencido");
      expect(r.json.detalhe.vencidos, via).toEqual([expect.objectContaining({ colaboradorNome: "João Lima", categoria: "aso", documentoId: "d-j-aso" })]);
    }
    expect(await prisma.documentacaoEnvio.count()).toBe(0);
    expect(correio.enviados, "nem o e-mail saiu").toEqual([]);
  });

  it("\"ciente das faltas\" NÃO libera vencido — não existe atalho para documento vencido", async () => {
    await prisma.colaboradorDocumento.update({ where: { id: "d-j-aso" }, data: { dataVencimento: dia("2026-10-01") } });
    expect((await criar({ cienteDasFaltas: true })).status).toBe(409);
  });

  it("tirar o colaborador do pacote destrava; renovar o documento também", async () => {
    await prisma.colaboradorDocumento.update({ where: { id: "d-j-aso" }, data: { dataVencimento: dia("2026-10-01") } });
    expect((await criar({ colaboradorIds: ["t1"] })).status, "sem o João").toBe(201);

    await prisma.colaboradorDocumento.create({ data: { id: "d-j-aso2", colaboradorId: "t2", tipo: "aso", categoria: "aso", nome: "ASO 2026", arquivoUrl: PDF("aso-joao-novo"), tamanho: 30, dataVencimento: dia("2027-10-01") } });
    const r = await criar();
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const itens = await prisma.documentacaoEnvioItem.findMany({ where: { envioId: r.json.envio.id, colaboradorId: "t2", categoria: "aso" } });
    expect(itens.map((i: any) => i.documentoId), "vai o novo; o vencido fica de fora").toEqual(["d-j-aso2"]);
  });

  it("documento FALTANDO pede confirmação: 409 com a lista, e com \"ciente\" gera", async () => {
    const semConfirmar = await criar({ colaboradorIds: ["t1", "t3"] });
    expect(semConfirmar.status).toBe(409);
    expect(semConfirmar.json.detalhe.faltando).toEqual([expect.objectContaining({ colaboradorNome: "Carla Reis", categoria: "nr_10" })]);
    expect(await prisma.documentacaoEnvio.count()).toBe(0);

    const r = await criar({ colaboradorIds: ["t1", "t3"], cienteDasFaltas: true });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.envio.arquivos).toBe(3);
  });

  it("nenhum documento dos tipos marcados: 409, nada gravado", async () => {
    const r = await criar({ colaboradorIds: ["t3"], categorias: ["nr_35"], cienteDasFaltas: true });
    expect(r.status).toBe(409);
    expect(await prisma.documentacaoEnvio.count()).toBe(0);
  });

  /* ───────────────────────── as três vias ───────────────────────── */

  it("LINK: nasce o token com o prazo pedido, e o pacote grava a lista fechada", async () => {
    const r = await criar({ validadeDias: 15 });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.envio).toMatchObject({ clienteNome: "Shopping Ibirapuera", colaboradores: 2, arquivos: 4, link: "ATIVO" });
    expect(r.json.envio.caminho).toMatch(/^\/documentacao\/[A-Za-z0-9_-]{40,}$/);
    expect(r.json.envio.expiraEm).toBe("2026-12-01T12:00:00.000Z");

    const itens = await prisma.documentacaoEnvioItem.findMany({ where: { envioId: r.json.envio.id }, orderBy: { caminho: "asc" } });
    expect(itens.map((i: any) => i.caminho)).toEqual([
      "João Lima/ASO (exame) - ASO periódico", "João Lima/NR-10 - Certificado NR-10",
      "Marina Alves/ASO (exame) - ASO periódico", "Marina Alves/NR-10 - Certificado NR-10",
    ]);
    expect(await eventos(r.json.envio.id)).toEqual(["CRIADO", "LINK_GERADO"]);
  });

  it("validade fora da lista vira o padrão de 7 dias — nunca link eterno", async () => {
    const r = await criar({ validadeDias: 3650 });
    expect(r.json.envio.expiraEm).toBe("2026-11-23T12:00:00.000Z");
  });

  it("ZIP: não nasce link, e o arquivo baixa com as pastas escolhidas", async () => {
    const r = await criar({ via: "ZIP", organizacao: "POR_TIPO" });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.envio).toMatchObject({ link: "SEM_LINK", caminho: null, expiraEm: null });
    expect(await tokenDe(r.json.envio.id)).toBeNull();

    const zip = await chamar("zip", "GET", { id: r.json.envio.id });
    expect(zip.status).toBe(200);
    expect(zip.headers.get("Content-Type")).toBe("application/zip");
    expect(zip.headers.get("Content-Disposition")).toContain("Documentacao - Shopping Ibirapuera.zip");
    const arquivos = lerZip(zip.bytes!);
    expect(Object.keys(arquivos).sort()).toEqual([
      "ASO (exame)/João Lima - ASO periódico.pdf", "ASO (exame)/Marina Alves - ASO periódico.pdf",
      "NR-10/João Lima - Certificado NR-10.pdf", "NR-10/Marina Alves - Certificado NR-10.pdf",
    ]);
    expect(arquivos["ASO (exame)/Marina Alves - ASO periódico.pdf"]).toContain("aso-marina");
    expect(await eventos(r.json.envio.id)).toEqual(["CRIADO", "ZIP_BAIXADO"]);
  });

  it("EMAIL: vai o LINK (nunca anexo) para os contatos do cliente, com resposta para a empresa", async () => {
    const r = await criar({ via: "EMAIL" });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.email).toEqual({ ok: true, para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"] });

    expect(correio.enviados).toHaveLength(1);
    const [email] = correio.enviados;
    expect(email).toMatchObject({
      empresaId: "e1", tipo: "DOCUMENTACAO_EQUIPE",
      para: ["seguranca@shopping.com"], cc: ["manutencao@shopping.com"],
      responderPara: "contato@climatotal.com",
      referenciaTipo: "DOCUMENTACAO_ENVIO", referenciaId: r.json.envio.id,
    });
    expect(email.variaveis.link_documento).toBe(`https://app.exemplo.com${r.json.envio.caminho}`);
    expect(email.variaveis).toMatchObject({ cliente_nome: "Shopping Ibirapuera", quantidade_colaboradores: "2", validade_link: "23/11/2026" });
    expect(JSON.stringify(email), "nenhum arquivo viaja no e-mail").not.toMatch(/anexo|attachment|base64/i);
    expect(await eventos(r.json.envio.id)).toEqual(["CRIADO", "LINK_GERADO", "EMAIL_ENVIADO"]);
  });

  it("os destinatários são editáveis: vários no Para, cópia, e cópia para quem está enviando", async () => {
    const r = await criar({ via: "EMAIL", email: { para: "rh@shopping.com; sst@shopping.com", cc: ["gestor@shopping.com"], copiaParaMim: true } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(correio.enviados[0].para).toEqual(["rh@shopping.com", "sst@shopping.com"]);
    expect(correio.enviados[0].cc).toEqual(["gestor@shopping.com", "ana@climatotal.com"]);
  });

  it("cópia digitada sem mexer no Para soma à do cadastro — em lista ou em texto", async () => {
    await criar({ via: "EMAIL", email: { cc: "diretoria@shopping.com; juridico@shopping.com" } });
    expect(correio.enviados[0].para, "o Para continua o do cadastro").toEqual(["seguranca@shopping.com"]);
    expect(correio.enviados[0].cc).toEqual(["manutencao@shopping.com", "diretoria@shopping.com", "juridico@shopping.com"]);
  });

  it("destinatário torto não deixa pacote órfão: 400 antes de gravar", async () => {
    const r = await criar({ via: "EMAIL", email: { para: "sem-arroba" } });
    expect(r.status).toBe(400);
    expect(await prisma.documentacaoEnvio.count()).toBe(0);
  });

  it("cliente sem e-mail no cadastro: pede o endereço em vez de mandar para ninguém", async () => {
    const r = await criar({ via: "EMAIL", clienteId: "c3" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toContain("não tem e-mail no cadastro");
    expect(correio.enviados).toEqual([]);
  });

  it("e-mail que falhou fica registrado — o pacote e o link existem, e dá para mandar de novo", async () => {
    correio.falhar = true;
    const r = await criar({ via: "EMAIL" });
    expect(r.status).toBe(201);
    expect(r.json.email).toMatchObject({ ok: false, erro: "Resend fora do ar" });
    expect(await eventos(r.json.envio.id)).toEqual(["CRIADO", "LINK_GERADO", "EMAIL_FALHOU"]);

    correio.falhar = false;
    const de_novo = await chamar("email", "POST", { id: r.json.envio.id, corpo: {} });
    expect(de_novo.status, JSON.stringify(de_novo.json)).toBe(200);
    expect(de_novo.json.email.ok).toBe(true);
    expect(correio.enviados[0].variaveis.link_documento, "o MESMO link: quem já recebeu não fica com outro").toContain(await tokenDe(r.json.envio.id));
  });

  /* ───────────────────────── o link público (LGPD) ───────────────────────── */

  it("o link entrega SÓ os itens do pacote — nem outra gaveta, nem outro colaborador, nem o que veio depois", async () => {
    const r = await criar({ colaboradorIds: ["t1"], categorias: ["aso"] });
    const token = await tokenDe(r.json.envio.id);
    // depois do envio, a ficha ganha mais um ASO — ele NÃO entra no link
    await prisma.colaboradorDocumento.create({ data: { id: "d-m-aso-novo", colaboradorId: "t1", tipo: "aso", categoria: "aso", nome: "ASO de retorno", arquivoUrl: PDF("aso-depois"), tamanho: 30 } });

    deslogado();
    const lista = await chamar("pubLista", "GET", { token });
    expect(lista.status, JSON.stringify(lista.json)).toBe(200);
    expect(lista.json.empresa.nome).toBe("Clima Total");
    expect(lista.json.cliente).toBe("Shopping Ibirapuera");
    expect(lista.json.itens).toHaveLength(1);
    expect(lista.json.itens[0]).toMatchObject({ colaboradorNome: "Marina Alves", categoriaRotulo: "ASO (exame)", nome: "ASO periódico", vencido: false });
    const texto = JSON.stringify(lista.json);
    for (const proibido of ["Advertência", "Contrato de trabalho", "NR-10", "João Lima", "ASO de retorno", "d-m-aso", "arquivoUrl", "base64", "52998224725"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("trocar o id na URL não alcança arquivo de fora do pacote", async () => {
    const r = await criar({ colaboradorIds: ["t1"], categorias: ["aso"] });
    const token = await tokenDe(r.json.envio.id);
    const outro = await criar({ colaboradorIds: ["t2"], categorias: ["aso"] });
    const itemDoOutro = (await prisma.documentacaoEnvioItem.findFirst({ where: { envioId: outro.json.envio.id } })).id;
    deslogado();

    // ids de DOCUMENTO (a advertência, o contrato, o ASO do João, o de outra empresa) e o item de outro pacote
    for (const id of ["d-m-adv", "d-m-contrato", "d-j-aso", "d-x-aso", "d-m-aso", itemDoOutro, "../d-m-adv"]) {
      const a = await chamar("pubArquivo", "GET", { token, itemId: id });
      expect(a.status, id).toBe(404);
      expect(a.bytes, id).toBeNull();
    }
  });

  it("o cliente baixa o arquivo certo, e o zip dele traz só o pacote", async () => {
    const r = await criar({ colaboradorIds: ["t1"], categorias: ["aso", "nr_10"] });
    const token = await tokenDe(r.json.envio.id);
    deslogado();
    const lista = await chamar("pubLista", "GET", { token });
    const aso = lista.json.itens.find((i: any) => i.categoriaRotulo === "ASO (exame)");

    const arq = await chamar("pubArquivo", "GET", { token, itemId: aso.id });
    expect(arq.status).toBe(200);
    expect(arq.headers.get("Content-Type")).toBe("application/pdf");
    expect(arq.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(arq.headers.get("Cache-Control")).toContain("no-store");
    expect(Buffer.from(arq.bytes!).toString()).toContain("aso-marina");

    const zip = await chamar("pubZip", "GET", { token });
    expect(zip.status).toBe(200);
    const arquivos = lerZip(zip.bytes!);
    expect(Object.keys(arquivos).sort()).toEqual(["Marina Alves/ASO (exame) - ASO periódico.pdf", "Marina Alves/NR-10 - Certificado NR-10.pdf"]);
    expect(Object.values(arquivos).join(" ")).not.toMatch(/advertencia|contrato|joao/);
  });

  it("arquivo excluído da ficha depois do envio some do link (lista, download e zip)", async () => {
    const r = await criar({ colaboradorIds: ["t1"], categorias: ["aso", "nr_10"] });
    const token = await tokenDe(r.json.envio.id);
    const itemAso = (await prisma.documentacaoEnvioItem.findFirst({ where: { envioId: r.json.envio.id, categoria: "aso" } })).id;
    await prisma.colaboradorDocumento.update({ where: { id: "d-m-aso" }, data: { excluidoEm: AGORA, excluidoPorId: "uA" } });

    deslogado();
    expect((await chamar("pubLista", "GET", { token })).json.itens.map((i: any) => i.categoriaRotulo)).toEqual(["NR-10"]);
    expect((await chamar("pubArquivo", "GET", { token, itemId: itemAso })).status).toBe(404);
    expect(Object.keys(lerZip((await chamar("pubZip", "GET", { token })).bytes!))).toEqual(["Marina Alves/NR-10 - Certificado NR-10.pdf"]);
    // e na empresa o item aparece como indisponível, não some do histórico
    como();
    const det = await chamar("envio", "GET", { id: r.json.envio.id });
    expect(det.json.itens.find((i: any) => i.categoria === "aso").disponivel).toBe(false);
  });

  it("o acesso do cliente fica registrado: abrir, baixar um arquivo e baixar o pacote — com IP e navegador", async () => {
    const r = await criar({ colaboradorIds: ["t1"], categorias: ["aso"] });
    const token = await tokenDe(r.json.envio.id);
    deslogado();
    const lista = await chamar("pubLista", "GET", { token, ip: "189.10.20.30" });
    await chamar("pubLista", "GET", { token, ip: "189.10.20.30" }); // recarregou a página: não duplica
    await chamar("pubArquivo", "GET", { token, itemId: lista.json.itens[0].id, ip: "189.10.20.30" });
    await chamar("pubZip", "GET", { token, ip: "189.10.20.30" });

    como();
    const det = await chamar("envio", "GET", { id: r.json.envio.id });
    const doCliente = det.json.eventos.filter((e: any) => ["ACESSO", "DOWNLOAD", "DOWNLOAD_ZIP"].includes(e.tipo));
    expect(doCliente.map((e: any) => e.tipo).sort()).toEqual(["ACESSO", "DOWNLOAD", "DOWNLOAD_ZIP"]);
    for (const e of doCliente) {
      expect(e.ip).toBe("189.10.20.30");
      expect(e.navegador).toContain("Mozilla");
      expect(e.por, "quem fez foi o cliente, pelo link").toBeNull();
    }
    expect(det.json.eventos.find((e: any) => e.tipo === "CRIADO").por).toBe("Ana Souza");
  });

  it("a linha do tempo usa o relógio da aplicação: cada passo sai com a hora em que aconteceu, na ordem", async () => {
    const r = await criar({ via: "EMAIL" });
    const token = await tokenDe(r.json.envio.id);
    vi.setSystemTime(new Date("2026-11-17T15:30:00.000Z"));
    deslogado();
    await chamar("pubLista", "GET", { token });
    como();
    vi.setSystemTime(new Date("2026-11-18T09:00:00.000Z"));
    await chamar("revogar", "POST", { id: r.json.envio.id });

    const det = await chamar("envio", "GET", { id: r.json.envio.id });
    // do mais novo para o mais velho, sem empate deixado ao acaso
    expect(det.json.eventos.map((e: any) => e.tipo)).toEqual(["REVOGADO", "ACESSO", "EMAIL_ENVIADO", "LINK_GERADO", "CRIADO"]);
    const em = Object.fromEntries(det.json.eventos.map((e: any) => [e.tipo, e.em]));
    expect(em.ACESSO).toBe("2026-11-17T15:30:00.000Z");
    expect(em.REVOGADO).toBe("2026-11-18T09:00:00.000Z");
    expect(em.CRIADO).toBe(AGORA.toISOString());
  });

  it("recarregar a página não repete o acesso; voltar mais tarde conta de novo", async () => {
    const r = await criar({ colaboradorIds: ["t1"], categorias: ["aso"] });
    const token = await tokenDe(r.json.envio.id);
    deslogado();
    await chamar("pubLista", "GET", { token });
    vi.setSystemTime(new Date(AGORA.getTime() + 4 * 60 * 1000));
    await chamar("pubLista", "GET", { token });
    expect((await eventos(r.json.envio.id)).filter((x: string) => x === "ACESSO"), "4 minutos depois ainda é a mesma visita").toHaveLength(1);

    vi.setSystemTime(new Date(AGORA.getTime() + 10 * 60 * 1000));
    await chamar("pubLista", "GET", { token });
    expect((await eventos(r.json.envio.id)).filter((x: string) => x === "ACESSO"), "10 minutos depois é outra").toHaveLength(2);
    // outro aparelho conta na hora
    await chamar("pubLista", "GET", { token, ip: "177.0.0.9" });
    expect((await eventos(r.json.envio.id)).filter((x: string) => x === "ACESSO")).toHaveLength(3);
  });

  it("link que não existe é 404; expirado e revogado são 410 — com a MESMA mensagem", async () => {
    const r = await criar({ validadeDias: 3 });
    const token = await tokenDe(r.json.envio.id);
    deslogado();

    const inexistente = await chamar("pubLista", "GET", { token: "nao-existe" });
    expect(inexistente.status).toBe(404);

    vi.setSystemTime(new Date("2026-11-19T12:00:01.000Z")); // 3 dias e 1 segundo depois
    for (const rota of ["pubLista", "pubZip"] as const) {
      const x = await chamar(rota, "GET", { token });
      expect(x.status, rota).toBe(410);
      expect(x.json.erro, rota).toBe(inexistente.json.erro);
      expect(x.bytes, rota).toBeNull();
    }
  });

  it("revogar mata o link na hora, sem apagar o envio nem o histórico", async () => {
    const r = await criar();
    const token = await tokenDe(r.json.envio.id);
    const rev = await chamar("revogar", "POST", { id: r.json.envio.id });
    expect(rev.status, JSON.stringify(rev.json)).toBe(200);
    expect(rev.json).toMatchObject({ link: "REVOGADO", caminho: null });
    expect(rev.json.revogadoEm).toBe(AGORA.toISOString());

    deslogado();
    expect((await chamar("pubLista", "GET", { token })).status).toBe(410);
    const item = (await prisma.documentacaoEnvioItem.findFirst({ where: { envioId: r.json.envio.id } })).id;
    expect((await chamar("pubArquivo", "GET", { token, itemId: item })).status).toBe(410);

    como();
    expect(await prisma.documentacaoEnvioItem.count({ where: { envioId: r.json.envio.id } })).toBe(4);
    expect(await eventos(r.json.envio.id)).toEqual(["CRIADO", "LINK_GERADO", "REVOGADO"]);
    // revogar de novo não duplica o evento
    await chamar("revogar", "POST", { id: r.json.envio.id });
    expect((await eventos(r.json.envio.id)).filter((t: string) => t === "REVOGADO")).toHaveLength(1);
  });

  it("varrer tokens no escuro esbarra no limite por IP; link bom não conta", async () => {
    const r = await criar();
    const token = await tokenDe(r.json.envio.id);
    deslogado();
    for (let i = 0; i < 25; i++) expect((await chamar("pubLista", "GET", { token, ip: "10.0.0.1" })).status).toBe(200);

    let bloqueou = false;
    for (let i = 0; i < 25 && !bloqueou; i++) bloqueou = (await chamar("pubLista", "GET", { token: `chute-${i}`, ip: "10.0.0.2" })).status === 429;
    expect(bloqueou, "token errado em série acaba em 429").toBe(true);
    expect((await chamar("pubLista", "GET", { token, ip: "10.0.0.2" })).status, "e o IP bloqueado não abre nem o link bom").toBe(429);
    expect((await chamar("pubLista", "GET", { token, ip: "10.0.0.1" })).status, "quem só usou link bom segue").toBe(200);
  });

  /* ───────────────────────── link novo e reenvio ───────────────────────── */

  it("gerar link num pacote que nasceu em zip; link ativo não é trocado; link novo é token novo", async () => {
    const r = await criar({ via: "ZIP" });
    const g = await chamar("link", "POST", { id: r.json.envio.id, corpo: { validadeDias: 3 } });
    expect(g.status, JSON.stringify(g.json)).toBe(200);
    expect(g.json.link).toBe("ATIVO");
    const primeiro = await tokenDe(r.json.envio.id);

    await chamar("link", "POST", { id: r.json.envio.id, corpo: { validadeDias: 30 } });
    expect(await tokenDe(r.json.envio.id), "quem já recebeu não fica com o endereço morto").toBe(primeiro);

    await chamar("revogar", "POST", { id: r.json.envio.id });
    const novo = await chamar("link", "POST", { id: r.json.envio.id, corpo: {} });
    expect(novo.json.link).toBe("ATIVO");
    expect(await tokenDe(r.json.envio.id), "o revogado não volta a valer").not.toBe(primeiro);
    deslogado();
    expect((await chamar("pubLista", "GET", { token: primeiro })).status).toBe(404);
  });

  it("pacote com documento que venceu DEPOIS do envio não ganha link novo, nem zip, nem e-mail", async () => {
    const r = await criar({ validadeDias: 3 });
    const token = await tokenDe(r.json.envio.id);
    vi.setSystemTime(new Date("2027-03-02T12:00:00.000Z")); // a NR-10 venceu em 01/03/2027

    for (const [rota, metodo] of [["link", "POST"], ["email", "POST"], ["zip", "GET"]] as const) {
      const x = await chamar(rota, metodo, { id: r.json.envio.id, corpo: metodo === "POST" ? {} : undefined });
      expect(x.status, rota).toBe(409);
      expect(x.json.erro, rota).toContain("venceu depois do envio");
    }
    expect(await tokenDe(r.json.envio.id), "o token velho não foi trocado").toBe(token);
    expect(correio.enviados).toEqual([]);
  });

  it("reenviar o e-mail de um link expirado gera link novo junto", async () => {
    const r = await criar({ via: "EMAIL", validadeDias: 3 });
    const antigo = await tokenDe(r.json.envio.id);
    vi.setSystemTime(new Date("2026-11-25T12:00:00.000Z"));

    const de_novo = await chamar("email", "POST", { id: r.json.envio.id, corpo: { validadeDias: 7 } });
    expect(de_novo.status, JSON.stringify(de_novo.json)).toBe(200);
    expect(de_novo.json.envio.link).toBe("ATIVO");
    const atual = await tokenDe(r.json.envio.id);
    expect(atual).not.toBe(antigo);
    expect(correio.enviados.at(-1).variaveis.link_documento).toContain(atual);
  });

  /* ───────────────────────── histórico ───────────────────────── */

  it("o histórico diz o que foi, para quem, por quem e quando — e filtra por cliente", async () => {
    await criar();
    await criar({ clienteId: "c2", colaboradorIds: ["t3"], categorias: ["aso"], via: "ZIP" });

    const todos = await chamar("envios", "GET");
    expect(todos.json.total).toBe(2);
    expect(todos.json.envios.map((e: any) => e.clienteNome).sort()).toEqual(["Hospital Santa Clara", "Shopping Ibirapuera"]);
    expect(todos.json.envios[0]).toMatchObject({ criadoPor: "Ana Souza", criadoEm: AGORA.toISOString() });
    expect(JSON.stringify(todos.json), "o token nunca vai solto na lista — só o caminho do link ativo").not.toContain('"token"');

    const doHospital = await chamar("envios", "GET", { query: "clienteId=c2" });
    expect(doHospital.json.envios).toHaveLength(1);
    expect(doHospital.json.envios[0]).toMatchObject({ clienteNome: "Hospital Santa Clara", link: "SEM_LINK", arquivos: 1 });
  });

  /* ───────────────────────── o lote ───────────────────────── */

  it("LOTE: um envio por cliente — cada um com o seu token e SÓ os seus arquivos", async () => {
    const r = await chamar("lote", "POST", { corpo: { via: "LINK", validadeDias: 15, envios: [
      { clienteId: "c1", colaboradorIds: ["t1"], categorias: ["aso"] },
      { clienteId: "c2", colaboradorIds: ["t3"], categorias: ["aso"] },
    ] } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.resultados.map((x: any) => x.ok)).toEqual([true, true]);

    const [a, b] = r.json.resultados.map((x: any) => x.envio);
    expect(a.caminho).not.toBe(b.caminho);
    expect(a.loteId).toBe(r.json.loteId);
    expect(b.loteId).toBe(r.json.loteId);

    deslogado();
    const doShopping = await chamar("pubLista", "GET", { token: a.caminho.split("/").pop() });
    const doHospital = await chamar("pubLista", "GET", { token: b.caminho.split("/").pop() });
    expect(doShopping.json.cliente).toBe("Shopping Ibirapuera");
    expect(doShopping.json.itens.map((i: any) => i.colaboradorNome)).toEqual(["Marina Alves"]);
    expect(doHospital.json.cliente).toBe("Hospital Santa Clara");
    expect(doHospital.json.itens.map((i: any) => i.colaboradorNome)).toEqual(["Carla Reis"]);
    expect(JSON.stringify(doShopping.json)).not.toMatch(/Hospital|Carla/);
    expect(JSON.stringify(doHospital.json)).not.toMatch(/Shopping|Marina/);
  });

  it("LOTE por e-mail: um e-mail por cliente, cada um só com os contatos dele — nenhum em cópia do outro", async () => {
    const r = await chamar("lote", "POST", { corpo: { via: "EMAIL", envios: [
      { clienteId: "c1", colaboradorIds: ["t1"], categorias: ["aso"] },
      { clienteId: "c2", colaboradorIds: ["t3"], categorias: ["aso"] },
    ] } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(correio.enviados).toHaveLength(2);

    const [shopping, hospital] = correio.enviados;
    expect([shopping.para, shopping.cc]).toEqual([["seguranca@shopping.com"], ["manutencao@shopping.com"]]);
    expect([hospital.para, hospital.cc]).toEqual([["compras@hospital.com"], []]);
    expect(JSON.stringify(shopping)).not.toContain("hospital");
    expect(JSON.stringify(hospital)).not.toContain("shopping");
    expect(shopping.variaveis.link_documento).not.toBe(hospital.variaveis.link_documento);
  });

  it("LOTE: um cliente com documento vencido não segura os outros — volta com o motivo", async () => {
    await prisma.colaboradorDocumento.update({ where: { id: "d-c-aso" }, data: { dataVencimento: dia("2026-10-01") } });
    const r = await chamar("lote", "POST", { corpo: { via: "LINK", envios: [
      { clienteId: "c1", colaboradorIds: ["t1"], categorias: ["aso"] },
      { clienteId: "c2", colaboradorIds: ["t3"], categorias: ["aso"] },
      { clienteId: "cX", colaboradorIds: ["t1"], categorias: ["aso"] },
    ] } });
    expect(r.status).toBe(201);
    expect(r.json.resultados.map((x: any) => [x.clienteId, x.ok])).toEqual([["c1", true], ["c2", false], ["cX", false]]);
    expect(r.json.resultados[1].erro).toContain("vencido");
    expect(r.json.resultados[2].erro).toBe("Cliente não encontrado.");
    expect(await prisma.documentacaoEnvio.count()).toBe(1);
  });

  it("LOTE: o mesmo cliente duas vezes, zip em lote e lote vazio são recusados", async () => {
    const um = { clienteId: "c1", colaboradorIds: ["t1"], categorias: ["aso"] };
    expect((await chamar("lote", "POST", { corpo: { via: "LINK", envios: [um, um] } })).status).toBe(400);
    expect((await chamar("lote", "POST", { corpo: { via: "ZIP", envios: [um] } })).status).toBe(400);
    expect((await chamar("lote", "POST", { corpo: { via: "LINK", envios: [] } })).status).toBe(400);
    expect(await prisma.documentacaoEnvio.count()).toBe(0);
  });

  /* ───────────────────────── quem atende o cliente ───────────────────────── */

  it("sugere quem atende: o técnico do contrato, quem executou OS do cliente, e a equipe — sem ex-colaborador", async () => {
    await prisma.contrato.create({ data: { id: "kt1", empresaId: "e1", clienteId: "c1", numero: "CT-1", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: AGORA, responsavelTecnicoId: "t1" } });
    await prisma.ordemServico.create({ data: {
      id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", criadoPorId: "uA", descricao: "Preventiva", criadoEm: new Date("2026-08-01T12:00:00.000Z"),
      atividades: { create: [{ empresaId: "e1", titulo: "Visita", tecnicoId: "t2", tecnicosEquipe: { create: [{ tecnicoId: "t4" }] } }] },
    } });
    // OS de outro cliente e OS antiga demais não contam
    await prisma.ordemServico.create({ data: { id: "os2", empresaId: "e1", numero: "OS-2", clienteId: "c2", criadoPorId: "uA", descricao: "x", atividades: { create: [{ empresaId: "e1", titulo: "V", tecnicoId: "t3" }] } } });

    const r = await chamar("sugestoes", "GET", { query: "clienteId=c1" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.colaboradores.map((c: any) => [c.nome, c.motivo])).toEqual([["João Lima", "ATENDEU"], ["Marina Alves", "CONTRATO"]]);
    expect(r.json.email.para).toEqual(["seguranca@shopping.com"]);

    await prisma.equipe.create({ data: { id: "eq1", empresaId: "e1", nome: "Equipe A", liderId: "t3", membros: { connect: [{ id: "t2" }] } } });
    const eq = await chamar("sugestoes", "GET", { query: "equipeId=eq1" });
    expect(eq.json.colaboradores.map((c: any) => c.nome)).toEqual(["Carla Reis", "João Lima"]);

    expect((await chamar("sugestoes", "GET", { query: "clienteId=cX" })).status, "cliente de outra empresa").toBe(404);
  });
});
