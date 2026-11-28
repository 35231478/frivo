/**
 * PJ4 (J1) — o link da admissão não prende o candidato num código que nunca chegou (PostgreSQL real, dados fictícios):
 *  - com o envio de e-mail configurado, pedir o código e o envio FALHAR (provedor fora, modelo inativo) libera a
 *    conclusão sem o código;
 *  - sem pedir código, a confirmação continua exigida (409), e um envio que dá certo depois volta a exigi-la;
 *  - o bloqueio por tentativas erradas não vira atalho: continua exigindo.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pj4-colaborador-admissao-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { CODIGO_MAX_TENTATIVAS, MSG_EMAIL_NAO_VERIFICADO } from "@/lib/admissao/admissao";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pj4_admissao_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const correio = vi.hoisted(() => ({ enviados: [] as any[], falhar: false }));
vi.mock("@/lib/email", () => ({
  emailConfigAtiva: vi.fn(async () => true),
  enviarEmail: vi.fn(async (_e: string, p: any) => {
    if (correio.falhar) return { ok: false, erro: "Template inativo." };
    correio.enviados.push(p);
    return { ok: true, para: p.para };
  }),
  enviarEmailInterno: vi.fn(async () => ({ ok: true })),
}));

const ROTAS = {
  lista: "api/admissoes", config: "api/admissoes/config",
  consentir: "api/publico/admissao/[token]/consentimento", rascunho: "api/publico/admissao/[token]/rascunho",
  codigo: "api/publico/admissao/[token]/codigo", conferir: "api/publico/admissao/[token]/codigo/conferir",
  docs: "api/publico/admissao/[token]/documentos", concluir: "api/publico/admissao/[token]/concluir",
} as const;
async function chamar(r: keyof typeof ROTAS, metodo: string, op: { token?: string; corpo?: unknown } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[r]}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", {
    method: metodo, headers: { "Content-Type": "application/json", "user-agent": "Mozilla/5.0", "x-forwarded-for": "200.1.2.3" },
    body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ token: op.token ?? "" }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
const FOTO = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const CPF = "52998224725";
const FORM = {
  nome: "Marina Alves Pereira", cpf: CPF, rg: "33.444.555-6", dataNascimento: "1995-04-12",
  nomeMae: "Rosa Alves", nomePai: "", estadoCivil: "SOLTEIRO", escolaridade: "MEDIO",
  nacionalidade: "Brasileira", naturalidade: "Campinas/SP", sexo: "F", pis: "12045678905",
  ctpsNumero: "1234567", ctpsSerie: "0010", ctpsUf: "SP", tituloEleitor: "", reservista: "",
  email: "marina@exemplo.com", telefone: "11988887777",
  cep: "13010-000", endereco: "Rua das Flores", numero: "120", complemento: "", bairro: "Centro", cidade: "Campinas", estado: "SP",
  banco: "Banco do Brasil", agencia: "1234-5", conta: "98765-4", contaTipo: "CORRENTE", pixChave: "", dependentes: [],
};

describe.skipIf(!URL_PG)("PJ4 J1 — código de e-mail que não chegou (PostgreSQL real)", () => {
  let prisma: any;

  /** Convite até o fim do preenchimento (falta só concluir) */
  async function preenchido(): Promise<string> {
    const r = await chamar("lista", "POST", { corpo: { nome: "Marina Alves", cpf: CPF, telefone: "11988887777", email: FORM.email } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const token = r.json.token as string;
    await chamar("consentir", "POST", { token });
    expect((await chamar("rascunho", "PUT", { token, corpo: { form: FORM, etapa: "DEPENDENTES" } })).status).toBe(200);
    for (const docId of ["rg", "cpf", "comprovante_residencia", "ctps"]) {
      expect((await chamar("docs", "POST", { token, corpo: { docId, nome: `${docId}.png`, arquivoUrl: FOTO } })).status, docId).toBe(201);
    }
    return token;
  }
  const concluir = async (token: string) => { const r = await chamar("concluir", "POST", { token }); return `${r.status} ${r.json?.erro ?? r.json?.situacao}`; };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total LTDA", cnpj: "12.345.678/0001-90", email: "c@x.com", cidade: "Campinas", estado: "SP" } });
    await prisma.usuario.create({ data: { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" } });
    sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", empresaNome: "Empresa", role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null } };
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    await prisma.tentativaAcesso.deleteMany({});
    await prisma.admissao.deleteMany({});
    await prisma.colaboradorDocumento.deleteMany({});
    await prisma.tecnico.deleteMany({});
    correio.enviados = []; correio.falhar = false;
  });

  it("o envio do código falhou: a conclusão passa sem o código (antes: 409 para sempre)", async () => {
    const token = await preenchido();
    correio.falhar = true;
    const envio = await chamar("codigo", "POST", { token, corpo: { email: FORM.email } });
    expect(envio).toMatchObject({ status: 200, json: { enviado: false } });
    expect(await concluir(token)).toBe("200 AGUARDANDO_ASSINATURA");
  });

  it("sem pedir o código a confirmação continua exigida; um envio que dá certo depois do que falhou volta a exigir", async () => {
    const token = await preenchido();
    expect(await concluir(token)).toBe(`409 ${MSG_EMAIL_NAO_VERIFICADO}`);
    correio.falhar = true;
    await chamar("codigo", "POST", { token, corpo: { email: FORM.email } });
    correio.falhar = false;
    expect((await chamar("codigo", "POST", { token, corpo: { email: FORM.email } })).json.enviado).toBe(true);
    expect(await concluir(token)).toBe(`409 ${MSG_EMAIL_NAO_VERIFICADO}`);
    const codigo = correio.enviados.at(-1)!.variaveis.codigo;
    expect((await chamar("conferir", "POST", { token, corpo: { email: FORM.email, codigo } })).status).toBe(200);
    expect(await concluir(token)).toBe("200 AGUARDANDO_ASSINATURA");
  });

  it("o código bloqueado por tentativas não vira atalho: continua exigindo", async () => {
    const token = await preenchido();
    await chamar("codigo", "POST", { token, corpo: { email: FORM.email } });
    const certo = correio.enviados.at(-1)!.variaveis.codigo as string;
    const errado = certo === "000000" ? "999999" : "000000";
    for (let i = 0; i <= CODIGO_MAX_TENTATIVAS; i++) await chamar("conferir", "POST", { token, corpo: { email: FORM.email, codigo: errado } });
    expect((await chamar("conferir", "POST", { token, corpo: { email: FORM.email, codigo: certo } })).status).toBe(409);
    expect(await concluir(token)).toBe(`409 ${MSG_EMAIL_NAO_VERIFICADO}`);
  });
});
