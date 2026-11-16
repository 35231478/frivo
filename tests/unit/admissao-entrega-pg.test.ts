/**
 * A ENTREGA AO CONTADOR nas rotas de verdade, sobre PostgreSQL de verdade: a Ficha de Admissão em
 * PDF, o pacote (zip) e o contrato assinado.
 *
 * O que se prova:
 *  - permissão: 401 sem sessão, 403 sem "Admissão digital › gerenciar", e nem um byte sai;
 *  - empresa: admissão de outra empresa é 404 — nunca o arquivo;
 *  - antes de assinar não há entrega (409 com a mensagem certa), e depois de assinar há;
 *  - a FICHA sai nos blocos do eSocial com os dados do cadastro: identificação, documentos,
 *    endereço, contrato de trabalho (com CBO), dependentes (IRRF e salário-família) e banco;
 *  - campo não preenchido sai como "—" e aparece na lista do que ficou sem resposta;
 *  - o PACOTE é um zip de verdade (o `unzip` abre) com a ficha, o contrato e os documentos
 *    enviados, nomeados pelo que a empresa pediu, e a extensão vem dos BYTES;
 *  - documento EXCLUÍDO na ficha não entra no pacote;
 *  - o CONTRATO assinado traz o texto congelado e a prova (nome, data, IP), e é guardado nos
 *    anexos do colaborador na hora da assinatura — sem duplicar se já estiver lá.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { textoDoPdf } from "./pmoc-pdf-util";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_entrega_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
/** O e-mail é o único "de fora": aqui ele só registra o que sairia — e guarda o código. */
const correio = vi.hoisted(() => ({ enviados: [] as any[] }));
vi.mock("@/lib/email", () => ({
  emailConfigAtiva: vi.fn(async () => true),
  enviarEmail: vi.fn(async (empresaId: string, p: any) => { correio.enviados.push({ empresaId, ...p }); return { ok: true, para: p.para }; }),
  enviarEmailInterno: vi.fn(async () => ({ ok: true })),
}));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = empresaId === "e1" ? "uA" : "uB") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@x.com", empresaId, empresaNome: "Empresa", role: "OPERADOR", permissoes, tecnicoId: null } };
};
const semPermissao = () => como(montarPermissoes({ equipes: ["visualizar", "gerenciar", "excluir"] }));
const deslogado = () => { sessao.atual = null; };

const ROTAS = {
  ficha: "api/admissoes/[id]/ficha",
  pacote: "api/admissoes/[id]/documentos",
  contrato: "api/admissoes/[id]/contrato",
  admissoes: "api/admissoes",
  config: "api/admissoes/config",
  consentir: "api/publico/admissao/[token]/consentimento",
  rascunho: "api/publico/admissao/[token]/rascunho",
  docs: "api/publico/admissao/[token]/documentos",
  doc: "api/publico/admissao/[token]/documentos/[documentoId]",
  codigo: "api/publico/admissao/[token]/codigo",
  conferir: "api/publico/admissao/[token]/codigo/conferir",
  concluir: "api/publico/admissao/[token]/concluir",
  assinar: "api/publico/admissao/[token]/assinar",
} as const;

async function chamar(rota: keyof typeof ROTAS, metodo: string, op: { id?: string; token?: string; documentoId?: string; corpo?: unknown; query?: string } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${op.query ? `?${op.query}` : ""}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "user-agent": "Mozilla/5.0 (iPhone)", "x-forwarded-for": "200.1.2.3" },
    body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
  });
  const res: Response = await mod[metodo](req, {
    params: Promise.resolve({ id: op.id ?? "", token: op.token ?? "", documentoId: op.documentoId ?? "" }),
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
const PDF_BYTES = new Uint8Array([...new TextEncoder().encode("%PDF-1.4\n"), ...new Uint8Array(300).fill(0x20)]);
const FOTO = dataUrl(PNG, "image/png");
const DOC_PDF = dataUrl(PDF_BYTES, "application/pdf");

const CPF_MARINA = "52998224725";
const PIS = "12045678905";

const MODELO = [
  "CONTRATO DE TRABALHO",
  "",
  "{{empresa}} admite {{nome}}, CPF {{cpf}}, no cargo de {{cargo}}, salário {{salario}}.",
  "",
  "{{cidade}}, {{data}}.",
].join("\n");

const FORM = {
  nome: "Marina Alves Pereira", cpf: CPF_MARINA, rg: "33.444.555-6", dataNascimento: "1995-04-12",
  nomeMae: "Rosa Alves", nomePai: "João Pereira", estadoCivil: "SOLTEIRO", escolaridade: "MEDIO",
  nacionalidade: "Brasileira", naturalidade: "Campinas/SP", sexo: "F", pis: PIS,
  ctpsNumero: "1234567", ctpsSerie: "0010", ctpsUf: "SP", tituloEleitor: "123456789012", reservista: "",
  email: "marina@exemplo.com", telefone: "11988887777",
  cep: "13010-000", endereco: "Rua das Flores", numero: "120", complemento: "Apto 32",
  bairro: "Centro", cidade: "Campinas", estado: "SP",
  banco: "Banco do Brasil", agencia: "1234-5", conta: "98765-4", contaTipo: "CORRENTE", pixChave: "",
  dependentes: [{ nome: "Luca Alves Pereira", nascimento: "2020-02-10", cpf: "11144477735", parentesco: "FILHO", irrf: true, salarioFamilia: true }],
};

/** Há `unzip` nesta máquina? */
const TEM_UNZIP = (() => {
  try { execFileSync("unzip", ["-v"], { stdio: "pipe" }); return true; } catch { return false; }
})();

describe.skipIf(!URL_PG)("Entrega ao contador (PostgreSQL real)", () => {
  let prisma: any;
  let dirTmp = "";

  /** Cria o convite, preenche, envia documentos, conclui e assina. Devolve o id da admissão. */
  async function ateAssinada(): Promise<{ id: string; token: string; colaboradorId: string }> {
    como();
    const nova = await chamar("admissoes", "POST", { corpo: { nome: "Marina Alves Pereira", cpf: CPF_MARINA, cargoId: "g1", salario: 3200, telefone: "11988887777", email: "marina@exemplo.com" } });
    expect(nova.status, JSON.stringify(nova.json)).toBe(201);
    const linha = await prisma.admissao.findUnique({ where: { id: nova.json.id } });
    const token = linha.token as string;

    await chamar("consentir", "POST", { token });
    await chamar("rascunho", "PUT", { token, corpo: { form: FORM, etapa: "DEPENDENTES" } });
    for (const [docId, arquivo] of [["rg", FOTO], ["cpf", DOC_PDF], ["comprovante_residencia", FOTO], ["ctps", FOTO]] as const) {
      const r = await chamar("docs", "POST", { token, corpo: { docId, nome: `${docId}`, arquivoUrl: arquivo } });
      expect(r.status, docId).toBe(201);
    }
    // o e-mail é verificado por código antes de concluir — é o que o fluxo exige
    await chamar("codigo", "POST", { token, corpo: { email: FORM.email } });
    const conf = await chamar("conferir", "POST", { token, corpo: { email: FORM.email, codigo: correio.enviados.at(-1)!.variaveis.codigo } });
    expect(conf.status, JSON.stringify(conf.json)).toBe(200);

    const c = await chamar("concluir", "POST", { token });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    const a = await chamar("assinar", "POST", { token, corpo: { nome: "Marina Alves Pereira", selfie: FOTO } });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    como();
    return { id: nova.json.id, token, colaboradorId: linha.colaboradorId };
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));
    dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), "entrega-"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total LTDA", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com", cidade: "Campinas", estado: "SP" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto Dias", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cargo.create({ data: { id: "g1", empresaId: "e1", nome: "Técnico de refrigeração", cbo: "9112-05" } });
  }, 180_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    fs.rmSync(dirTmp, { recursive: true, force: true });
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    await prisma.admissao.deleteMany({});
    await prisma.colaboradorDocumento.deleteMany({});
    await prisma.colaboradorDependente.deleteMany({});
    await prisma.tecnico.deleteMany({});
    await prisma.admissaoConfig.deleteMany({});
    correio.enviados = [];
    como();
    const r = await chamar("config", "PUT", { corpo: { contratoModelo: MODELO, orientacoes: "Exame na Clínica Vida.", validadeDias: 7 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  });

  /* ───────────────────────── permissão e empresa ───────────────────────── */

  it("sem sessão é 401 nas três rotas, e nem um byte sai", async () => {
    const { id } = await ateAssinada();
    deslogado();
    for (const rota of ["ficha", "pacote", "contrato"] as const) {
      const r = await chamar(rota, "GET", { id });
      expect(`${rota}: ${r.status}`).toBe(`${rota}: 401`);
      expect(r.bytes, rota).toBeNull();
    }
  });

  it("sem \"Admissão digital › gerenciar\" é 403 — mesmo para quem gerencia colaboradores", async () => {
    const { id } = await ateAssinada();
    semPermissao();
    for (const rota of ["ficha", "pacote", "contrato"] as const) {
      const r = await chamar(rota, "GET", { id });
      expect(`${rota}: ${r.status} ${r.json?.erro}`).toBe(`${rota}: 403 Sem permissão para esta ação`);
      expect(r.bytes, rota).toBeNull();
    }
  });

  it("admissão de OUTRA empresa é 404 — nunca o arquivo", async () => {
    const { id } = await ateAssinada();
    como(permissoesTotais(), "e2");
    for (const rota of ["ficha", "pacote", "contrato"] as const) {
      const r = await chamar(rota, "GET", { id });
      expect(`${rota}: ${r.status} ${r.json?.erro}`).toBe(`${rota}: 404 Admissão não encontrada`);
      expect(r.bytes, rota).toBeNull();
    }
  });

  /* ───────────────────────── antes e depois de assinar ───────────────────────── */

  it("antes de assinar não há entrega: 409 dizendo o porquê", async () => {
    const nova = await chamar("admissoes", "POST", { corpo: { nome: "Marina Alves Pereira", cpf: CPF_MARINA, cargoId: "g1", salario: 3200, telefone: "11988887777" } });
    const id = nova.json.id as string;
    for (const rota of ["ficha", "pacote", "contrato"] as const) {
      const r = await chamar(rota, "GET", { id });
      expect(`${rota}: ${r.status}`).toBe(`${rota}: 409`);
      expect(r.json.erro, rota).toContain("quando o colaborador assinar");
    }
  });

  /* ───────────────────────── a ficha ───────────────────────── */

  it("a ficha sai nos blocos do eSocial, com os dados do cadastro", async () => {
    const { id } = await ateAssinada();
    const r = await chamar("ficha", "GET", { id });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(r.bytes!.slice(0, 5)).toString("latin1")).toBe("%PDF-");

    const texto = await textoDoPdf(r.bytes!);
    expect(texto).toContain("Ficha de Admissão");
    expect(texto).toContain("S-2200");
    for (const bloco of ["Identificação", "Documentos", "Endereço", "Contrato de trabalho", "Dependentes", "Dados bancários"]) {
      expect(texto, bloco).toContain(bloco);
    }
    // identificação e documentos
    expect(texto).toContain("Marina Alves Pereira");
    expect(texto).toContain("529.982.247-25");
    expect(texto).toContain("Rosa Alves");
    expect(texto).toContain("Médio completo");
    expect(texto).toContain("120.45678.90-5"); // o PIS no formato do PIS/NIS
    // contrato de trabalho, com o CBO
    expect(texto).toContain("Técnico de refrigeração");
    expect(texto).toContain("9112-05");
    // dependente, com IRRF e salário-família
    expect(texto).toContain("Luca Alves Pereira");
    expect(texto).toContain("Filho(a)");
    // banco
    expect(texto).toContain("Banco do Brasil");
    expect(texto).toContain("Conta corrente");
  });

  it("campo sem resposta sai como travessão e aparece na lista do que faltou", async () => {
    const { id } = await ateAssinada();
    // some nas DUAS fontes: o cadastro manda, e o rascunho é a segunda fonte de propósito — só
    // está mesmo em falta o que não está em nenhum dos dois
    await prisma.tecnico.updateMany({ data: { rg: null } });
    await prisma.admissao.update({ where: { id }, data: { rascunho: { ...FORM, rg: "" } } });

    const r = await chamar("ficha", "GET", { id });
    const texto = await textoDoPdf(r.bytes!);
    expect(texto).toContain("—");
    expect(texto).toContain("Campos sem resposta");
    expect(texto.toLowerCase()).toContain("rg");
  });

  it("?ver=1 abre no navegador; sem ele, baixa", async () => {
    const { id } = await ateAssinada();
    expect((await chamar("ficha", "GET", { id })).headers.get("Content-Disposition")).toContain("attachment");
    expect((await chamar("ficha", "GET", { id, query: "ver=1" })).headers.get("Content-Disposition")).toContain("inline");
  });

  /* ───────────────────────── o contrato ───────────────────────── */

  it("o contrato traz o texto congelado e a prova da assinatura", async () => {
    const { id } = await ateAssinada();
    const r = await chamar("contrato", "GET", { id });
    expect(r.status).toBe(200);
    const texto = await textoDoPdf(r.bytes!);
    expect(texto).toContain("CONTRATO DE TRABALHO");
    expect(texto).toContain("Clima Total");
    expect(texto).toContain("Prova da assinatura");
    expect(texto).toContain("Marina Alves Pereira");
    expect(texto).toContain("200.1.2.3");
  });

  it("o contrato é guardado nos anexos do colaborador na assinatura, e não duplica", async () => {
    const { id, colaboradorId } = await ateAssinada();
    const guardados = await prisma.colaboradorDocumento.findMany({
      where: { colaboradorId, tipo: "_contrato_assinado" },
      select: { categoria: true, origem: true, arquivoTipo: true, tamanho: true, nome: true },
    });
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({ categoria: "contrato", origem: "ADMISSAO", arquivoTipo: "application/pdf" });
    expect(guardados[0].tamanho).toBeGreaterThan(500);

    // uma segunda chamada não duplica o anexo
    const { guardarContratoNosAnexos } = await import("@/lib/admissao/admissao-entrega-server");
    await guardarContratoNosAnexos(id, "e1");
    expect(await prisma.colaboradorDocumento.count({ where: { colaboradorId, tipo: "_contrato_assinado" } })).toBe(1);
  });

  it("o contrato guardado NÃO conta como documento entregue da admissão", async () => {
    const { colaboradorId } = await ateAssinada();
    const lista = await chamar("admissoes", "GET");
    // a empresa pede 4 obrigatórios e o colaborador mandou os 4; o contrato não entra nessa conta
    expect(lista.json[0].documentosEnviados).toBe(4);
    expect(await prisma.colaboradorDocumento.count({ where: { colaboradorId } })).toBe(5);
  });

  /* ───────────────────────── o pacote ───────────────────────── */

  it.skipIf(!TEM_UNZIP)("o pacote é um zip de verdade, com a ficha, o contrato e os documentos", async () => {
    const { id } = await ateAssinada();
    const r = await chamar("pacote", "GET", { id });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/zip");
    expect(r.headers.get("Content-Disposition")).toContain("attachment");

    const arquivo = path.join(dirTmp, "pacote.zip");
    fs.writeFileSync(arquivo, Buffer.from(r.bytes!));
    expect(execFileSync("unzip", ["-t", arquivo], { encoding: "utf8" })).toContain("No errors detected");

    const dentro = execFileSync("unzip", ["-Z", "-1", arquivo], { encoding: "utf8" }).trim().split("\n");
    expect(dentro.some((n) => n.startsWith("Ficha de Admissao"))).toBe(true);
    expect(dentro.some((n) => n.startsWith("Contrato assinado"))).toBe(true);
    // os documentos vão com o rótulo que a EMPRESA pede, e a extensão vem dos bytes
    expect(dentro).toContain("Documentos enviados/RG (frente e verso).png");
    expect(dentro).toContain("Documentos enviados/CPF.pdf");
    expect(dentro.filter((n) => n.startsWith("Documentos enviados/"))).toHaveLength(4);
  });

  it.skipIf(!TEM_UNZIP)("documento EXCLUÍDO na ficha não entra no pacote", async () => {
    const { id, colaboradorId } = await ateAssinada();
    await prisma.colaboradorDocumento.updateMany({ where: { colaboradorId, tipo: "rg" }, data: { excluidoEm: AGORA } });

    const r = await chamar("pacote", "GET", { id });
    const arquivo = path.join(dirTmp, "pacote2.zip");
    fs.writeFileSync(arquivo, Buffer.from(r.bytes!));
    const dentro = execFileSync("unzip", ["-Z", "-1", arquivo], { encoding: "utf8" }).trim().split("\n");
    expect(dentro.some((n) => n.includes("RG (frente e verso)"))).toBe(false);
    expect(dentro.filter((n) => n.startsWith("Documentos enviados/"))).toHaveLength(3);
  });

  it("sem nenhum documento enviado, o pacote é recusado com a mensagem — não um zip vazio", async () => {
    const { id, colaboradorId } = await ateAssinada();
    await prisma.colaboradorDocumento.updateMany({ where: { colaboradorId }, data: { excluidoEm: AGORA } });
    expect(await erro(chamar("pacote", "GET", { id }))).toBe("409 O colaborador não enviou nenhum documento nesta admissão.");
  });
});

/**
 * O cabeçalho da tabela de dependentes sai em MAIÚSCULAS e num corpo menor; se não couber na
 * coluna, vaza por cima da vizinha — e na última, por cima da margem da folha. Isso não aparece
 * no texto extraído do PDF (o `pdftotext` lê o mesmo), só no olho. Então mede-se com a fonte de
 * verdade, que é como o pdf-lib desenha.
 */
describe("a tabela de dependentes cabe na folha", () => {
  it("cada cabeçalho cabe na sua coluna", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const { A4, MARGEM } = await import("@/lib/pdf/desenho");
    const { colunasDependentes } = await import("@/lib/admissao/admissao-pdf");

    const doc = await PDFDocument.create();
    const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
    const util = A4[0] - 2 * MARGEM;
    const RECUO = 5, CORPO = 7; // os mesmos de `Desenho.tabela`

    const colunas = colunasDependentes(util);
    for (const c of colunas) {
      const largura = negrito.widthOfTextAtSize(c.titulo.toUpperCase(), CORPO) + 2 * RECUO;
      expect(largura, `cabeçalho "${c.titulo}" em ${c.largura}pt`).toBeLessThanOrEqual(c.largura);
    }
    // e a soma das colunas é a largura útil: nem sobra faixa branca, nem passa da margem
    expect(colunas.reduce((s, c) => s + c.largura, 0)).toBeCloseTo(util, 5);
  });
});
