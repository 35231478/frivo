/**
 * ADMISSÃO DIGITAL de ponta a ponta no servidor: as rotas de verdade (/api/admissoes… do RH e
 * /api/publico/admissao/[token]… do colaborador) sobre PostgreSQL de verdade.
 *
 * O que se prova:
 *  - só quem tem "Admissão digital › gerenciar" mexe (401 sem sessão, 403 sem a permissão) e a
 *    recusa não muda nada; admissão de outra empresa é 404;
 *  - o convite NASCE de um pré-cadastro (nome + CPF + cargo + salário): o colaborador entra inativo
 *    e só vira ATIVO quando é admitido; CPF inválido e CPF repetido são recusados, sem criar nada;
 *  - um colaborador não tem duas admissões vivas; reenviar renova o prazo e manda o e-mail;
 *    invalidar mata o link na hora; cancelar exige motivo e NUNCA apaga;
 *  - o link: token que não existe e token vencido devolvem a MESMA mensagem, e contam no limite por
 *    IP; sem consentimento LGPD nada é salvo; o rascunho só guarda campos conhecidos;
 *  - o e-mail é verificado por código (o banco guarda o hash), com código errado, vencido e
 *    tentativas demais recusados;
 *  - documento com conteúdo disfarçado é recusado; o que passa vira anexo do colaborador;
 *  - concluir exige o que falta e o CPF do convite, e passa os dados ao cadastro (com dependentes);
 *  - assinar sem modelo de contrato é recusado (o sistema não inventa cláusula); assinando, grava
 *    nome, IP, navegador, selfie e o contrato congelado — e a segunda tentativa não assina de novo;
 *  - o que o link devolve nunca traz o CPF inteiro nem dado de outro colaborador.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { CODIGO_MAX_TENTATIVAS, MSG_LINK_INVALIDO } from "@/lib/admissao/admissao";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_admissao_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");

const sessao = vi.hoisted(() => ({ atual: null as any }));
// A rota da assinatura avisa o RH com after(), que só existe numa requisição do Next: aqui não roda
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

/** O envio de e-mail é o único "de fora": aqui ele só registra o que sairia */
const correio = vi.hoisted(() => ({ ativo: true, enviados: [] as any[], internos: [] as any[], falhar: false }));
vi.mock("@/lib/email", () => ({
  emailConfigAtiva: vi.fn(async () => correio.ativo),
  enviarEmail: vi.fn(async (empresaId: string, p: any) => {
    if (correio.falhar) return { ok: false, erro: "Resend fora do ar" };
    correio.enviados.push({ empresaId, ...p });
    return { ok: true, para: p.para };
  }),
  enviarEmailInterno: vi.fn(async (empresaId: string, para: string, assunto: string, html: string) => {
    correio.internos.push({ empresaId, para, assunto, html });
    return { ok: true };
  }),
}));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = empresaId === "e1" ? "uA" : "uB") => {
  sessao.atual = { user: { id, name: "Ana", email: "ana@x.com", empresaId, empresaNome: "Empresa", role: "OPERADOR", permissoes, tecnicoId: null } };
};
const semPermissao = () => como(montarPermissoes({ equipes: ["visualizar", "gerenciar", "excluir"], financeiro: ["visualizar", "folha"] }));
const deslogado = () => { sessao.atual = null; };

const ROTAS = {
  lista: "api/admissoes", uma: "api/admissoes/[id]", reenviar: "api/admissoes/[id]/reenviar",
  invalidar: "api/admissoes/[id]/invalidar", cancelar: "api/admissoes/[id]/cancelar",
  contador: "api/admissoes/[id]/contador", admitir: "api/admissoes/[id]/admitir",
  config: "api/admissoes/config",
  pub: "api/publico/admissao/[token]", consentir: "api/publico/admissao/[token]/consentimento",
  rascunho: "api/publico/admissao/[token]/rascunho", codigo: "api/publico/admissao/[token]/codigo",
  conferir: "api/publico/admissao/[token]/codigo/conferir",
  docs: "api/publico/admissao/[token]/documentos", doc: "api/publico/admissao/[token]/documentos/[documentoId]",
  concluir: "api/publico/admissao/[token]/concluir", assinar: "api/publico/admissao/[token]/assinar",
} as const;

async function chamar(rota: keyof typeof ROTAS, metodo: string, op: { id?: string; token?: string; documentoId?: string; corpo?: unknown; query?: string; ip?: string } = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${ROTAS[rota]}/route`);
  const req = new NextRequest(`https://app.exemplo.com/x${op.query ? `?${op.query}` : ""}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "user-agent": "Mozilla/5.0 (iPhone)", "x-forwarded-for": op.ip ?? "200.1.2.3" },
    body: op.corpo === undefined ? undefined : JSON.stringify(op.corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ id: op.id ?? "", token: op.token ?? "", documentoId: op.documentoId ?? "" }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`; };

/** Um PNG mínimo de verdade (o tipo é decidido pelos bytes) */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
const dataUrl = (bytes: Uint8Array, tipo: string) => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;
const FOTO = dataUrl(PNG, "image/png");
/** Um HTML com script, com nome e cabeçalho de imagem: o conteúdo é que decide */
const DISFARCADO = dataUrl(new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/png");

const CPF_CARLOS = "11144477735";
const CPF_MARINA = "52998224725";
/** PIS/NIS válido pelo dígito verificador */
const PIS = "12045678905";

const MODELO = [
  "CONTRATO DE TRABALHO",
  "{{empresa}}, CNPJ {{empresaCnpj}}, admite {{nome}}, CPF {{cpf}}, RG {{rg}}, residente em {{endereco}},",
  "no cargo de {{cargo}}, salário de {{salario}}, jornada {{jornada}}.",
  "Experiência de {{experienciaDias}} dias, prorrogável por {{experienciaProrrogacaoDias}}.",
  "{{cidade}}, {{data}}.",
].join("\n");

/** O formulário completo e válido do colaborador (o que a última etapa exige) */
const FORM = {
  nome: "Marina Alves Pereira", cpf: CPF_MARINA, rg: "33.444.555-6", dataNascimento: "1995-04-12",
  nomeMae: "Rosa Alves", nomePai: "João Pereira", estadoCivil: "SOLTEIRO", escolaridade: "MEDIO",
  nacionalidade: "Brasileira", naturalidade: "Campinas/SP", sexo: "F", pis: PIS,
  ctpsNumero: "1234567", ctpsSerie: "0010", ctpsUf: "SP", tituloEleitor: "123456789012", reservista: "",
  email: "marina@exemplo.com", telefone: "11988887777",
  cep: "13010-000", endereco: "Rua das Flores", numero: "120", complemento: "Apto 32",
  bairro: "Centro", cidade: "Campinas", estado: "SP",
  banco: "Banco do Brasil", agencia: "1234-5", conta: "98765-4", contaTipo: "CORRENTE", pixChave: "",
  dependentes: [{ nome: "Luca Alves Pereira", nascimento: "2020-02-10", cpf: CPF_CARLOS, parentesco: "FILHO", irrf: true, salarioFamilia: true }],
};

describe.skipIf(!URL_PG)("Admissão digital (PostgreSQL real)", () => {
  let prisma: any;

  /** Um convite novo para a Marina (pré-cadastro), já com a configuração da empresa */
  const convidar = async (corpo: Record<string, unknown> = {}) => {
    const r = await chamar("lista", "POST", { corpo: { nome: "Marina Alves", cpf: CPF_MARINA, cargoId: "g1", salario: 3200, telefone: "11988887777", email: "marina@exemplo.com", ...corpo } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json as any;
  };
  const gravada = (id: string) => prisma.admissao.findUnique({ where: { id } });
  const colaborador = (id: string) => prisma.tecnico.findUnique({ where: { id } });
  /** Leva o convite até "aguardando assinatura": consentimento, rascunho, documentos e conclusão */
  const atePronta = async (token: string, form: Record<string, unknown> = {}) => {
    const cheio = { ...FORM, ...form };
    await chamar("consentir", "POST", { token });
    await chamar("rascunho", "PUT", { token, corpo: { form: cheio, etapa: "DEPENDENTES" } });
    if (cheio.email) {
      await chamar("codigo", "POST", { token, corpo: { email: cheio.email } });
      const r = await chamar("conferir", "POST", { token, corpo: { email: cheio.email, codigo: correio.enviados.at(-1)!.variaveis.codigo } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    }
    for (const docId of ["rg", "cpf", "comprovante_residencia", "ctps"]) {
      const r = await chamar("docs", "POST", { token, corpo: { docId, nome: `${docId}.png`, arquivoUrl: FOTO } });
      expect(r.status, docId).toBe(201);
    }
    const c = await chamar("concluir", "POST", { token });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    return c.json as any;
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(Object.values(ROTAS).map((r) => import(/* @vite-ignore */ `@/app/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total LTDA", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com", cidade: "Campinas", estado: "SP" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cargo.createMany({ data: [
      { id: "g1", empresaId: "e1", nome: "Técnico de refrigeração", cbo: "9112-05" },
      { id: "gE2", empresaId: "e2", nome: "Cargo da outra empresa" },
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
    await prisma.tentativaAcesso.deleteMany({});
    await prisma.admissao.deleteMany({});
    await prisma.colaboradorDependente.deleteMany({});
    await prisma.colaboradorDocumento.deleteMany({});
    await prisma.tecnico.deleteMany({});
    await prisma.admissaoConfig.deleteMany({});
    correio.enviados = []; correio.internos = []; correio.ativo = true; correio.falhar = false;
    como();
    // A empresa configurou o modelo de contrato e as orientações (nada hardcoded)
    const r = await chamar("config", "PUT", { corpo: { contratoModelo: MODELO, orientacoes: "Exame admissional na Clínica Vida, rua 7 de Setembro, 100.", validadeDias: 7 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  });

  /* ───────── permissão ───────── */

  it("só quem tem \"Admissão digital › gerenciar\" mexe: 401 sem sessão, 403 sem a permissão — e nada muda", async () => {
    deslogado();
    expect(await erro(chamar("lista", "GET"))).toBe("401 Não autorizado");
    expect(await erro(chamar("lista", "POST", { corpo: { nome: "X", cpf: CPF_MARINA } }))).toBe("401 Não autorizado");
    semPermissao();
    expect(await erro(chamar("lista", "GET"))).toBe("403 Sem permissão para esta ação");
    expect(await erro(chamar("lista", "POST", { corpo: { nome: "Marina", cpf: CPF_MARINA } }))).toBe("403 Sem permissão para esta ação");
    expect(await erro(chamar("config", "PUT", { corpo: { orientacoes: "invadido" } }))).toBe("403 Sem permissão para esta ação");
    // nem colaborador, nem admissão, nem configuração mexida
    expect(await prisma.tecnico.count()).toBe(0);
    expect(await prisma.admissao.count()).toBe(0);
    como();
    expect((await chamar("config", "GET")).json.orientacoes).toContain("Clínica Vida");
  });

  it("admissão de outra empresa: 404 — e a de lá continua intacta", async () => {
    const tE2 = await prisma.tecnico.create({ data: { empresaId: "e2", nome: "Da outra", cpf: "1", telefone: "1" }, select: { id: true } });
    const aE2 = await prisma.admissao.create({ data: { empresaId: "e2", colaboradorId: tE2.id, token: "tok-da-outra", expiraEm: new Date("2026-12-01") }, select: { id: true } });
    expect(await erro(chamar("uma", "GET", { id: aE2.id }))).toBe("404 Admissão não encontrada");
    expect(await erro(chamar("cancelar", "POST", { id: aE2.id, corpo: { motivo: "não é minha" } }))).toBe("404 Admissão não encontrada");
    expect((await gravada(aE2.id)).situacao).toBe("CONVIDADO");
  });

  /* ───────── o convite ───────── */

  it("o convite nasce de um PRÉ-CADASTRO: colaborador inativo, token forte, prazo da empresa", async () => {
    const a = await convidar();
    expect(a).toMatchObject({
      situacao: "CONVIDADO", situacaoRotulo: "Convidado", expirado: false, envios: 0,
      abertoEm: null, consentimentoEm: null, assinaturaEm: null, criadoPor: "Ana Souza",
      colaborador: { nome: "Marina Alves", cpf: CPF_MARINA, cargo: "Técnico de refrigeração" },
      documentosEnviados: 0, documentosObrigatorios: 4,
    });
    expect(a.token.length).toBeGreaterThanOrEqual(40); // randomBytes(32) em base64url
    expect(a.expiraEm.slice(0, 10)).toBe("2026-11-23"); // 7 dias
    const t = await colaborador(a.colaborador.id);
    expect(t).toMatchObject({ empresaId: "e1", nome: "Marina Alves", cpf: CPF_MARINA, cargoId: "g1", ativo: false, statusColaborador: "INATIVO" });
    expect(Number(t.salario)).toBe(3200);
    expect((await gravada(a.id)).criadoPorId).toBe("uA");
  });

  it("CPF inválido e CPF já cadastrado são recusados — sem criar colaborador nenhum", async () => {
    expect(await erro(chamar("lista", "POST", { corpo: { nome: "Marina Alves", cpf: "11111111111" } }))).toBe("400 CPF inválido");
    expect(await erro(chamar("lista", "POST", { corpo: { nome: "Ma", cpf: CPF_MARINA } }))).toBe("400 Informe o nome completo do colaborador");
    expect(await prisma.tecnico.count()).toBe(0);
    const a = await convidar();
    const r = await chamar("lista", "POST", { corpo: { nome: "Marina Outra Vez", cpf: CPF_MARINA } });
    expect(r.status).toBe(409);
    expect(r.json.erro).toContain("Já existe colaborador com este CPF");
    expect(await prisma.tecnico.count()).toBe(1);
    expect(await prisma.admissao.count()).toBe(1);
    expect(a.colaborador.cpf).toBe(CPF_MARINA);
  });

  it("um colaborador não tem duas admissões vivas; depois de cancelar, pode outra", async () => {
    const a = await convidar();
    const r = await chamar("lista", "POST", { corpo: { colaboradorId: a.colaborador.id } });
    expect(r.status).toBe(409);
    expect(r.json.erro).toContain("já tem uma admissão em andamento (Convidado)");
    await chamar("cancelar", "POST", { id: a.id, corpo: { motivo: "Desistiu da vaga" } });
    const outra = await chamar("lista", "POST", { corpo: { colaboradorId: a.colaborador.id, salario: 3500 } });
    expect(outra.status).toBe(201);
    expect(await prisma.admissao.count()).toBe(2); // a cancelada FICA
    expect(Number((await colaborador(a.colaborador.id)).salario)).toBe(3500);
  });

  it("reenviar manda o e-mail com o link e renova o prazo; sem e-mail configurado diz o motivo e não some com o link", async () => {
    const a = await convidar();
    const r = await chamar("reenviar", "POST", { id: a.id });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ emailEnviado: true, emailPara: "marina@exemplo.com", erroEmail: null });
    expect(r.json.url).toBe(`https://app.exemplo.com/admissao/${a.token}`);
    expect(r.json.whatsappUrl).toContain("wa.me");
    expect(r.json.admissao).toMatchObject({ envios: 1, enviadoCanal: "EMAIL", enviadoPara: "marina@exemplo.com · WhatsApp 11988887777" });
    const [email] = correio.enviados;
    expect(email).toMatchObject({ empresaId: "e1", tipo: "ADMISSAO_CONVITE", para: "marina@exemplo.com", referenciaTipo: "Admissao" });
    expect(email.variaveis).toMatchObject({ colaborador_nome: "Marina Alves", cargo_nome: "Técnico de refrigeração", validade_link: "7 dia(s)" });
    expect(email.variaveis.link_admissao).toContain(a.token);

    correio.ativo = false;
    const r2 = await chamar("reenviar", "POST", { id: a.id });
    expect(r2.json).toMatchObject({ emailEnviado: false, erroEmail: "e-mail da empresa não configurado", admissao: { envios: 2, enviadoCanal: "WHATSAPP" } });
    expect(r2.json.url).toContain(a.token); // o link continua: o RH copia e manda como quiser
  });

  it("invalidar mata o link na hora; reenviar depois dá prazo novo e o link volta a abrir", async () => {
    const a = await convidar();
    expect((await chamar("pub", "GET", { token: a.token })).status).toBe(200);
    const inv = await chamar("invalidar", "POST", { id: a.id });
    expect(inv.json).toMatchObject({ situacao: "EXPIRADA", situacaoRotulo: "Expirada", expirado: true });
    expect(await erro(chamar("pub", "GET", { token: a.token }))).toBe(`410 ${MSG_LINK_INVALIDO}`);
    const re = await chamar("reenviar", "POST", { id: a.id });
    expect(re.json.admissao).toMatchObject({ situacao: "CONVIDADO", expirado: false });
    expect((await chamar("pub", "GET", { token: a.token })).status).toBe(200);
  });

  it("cancelar exige motivo e NUNCA apaga: situação, razão, quem e quando — o colaborador fica", async () => {
    const a = await convidar();
    expect(await erro(chamar("cancelar", "POST", { id: a.id, corpo: { motivo: "ops" } }))).toContain("400 Diga o motivo do cancelamento");
    expect((await gravada(a.id)).situacao).toBe("CONVIDADO");
    const r = await chamar("cancelar", "POST", { id: a.id, corpo: { motivo: "Candidata aceitou outra proposta" } });
    expect(r.json).toMatchObject({ situacao: "CANCELADA", cancelamentoMotivo: "Candidata aceitou outra proposta", canceladaPor: "Ana Souza" });
    expect((await gravada(a.id)).canceladaPorId).toBe("uA");
    expect(await prisma.admissao.count()).toBe(1);
    expect(await colaborador(a.colaborador.id)).toBeTruthy();
    // cancelada não reabre nem pelo link nem por reenvio
    expect(await erro(chamar("pub", "GET", { token: a.token }))).toBe("409 Esta admissão foi cancelada.");
    expect(await erro(chamar("reenviar", "POST", { id: a.id }))).toBe("409 Esta admissão foi cancelada.");
  });

  it("contador e admitido só depois de assinado, na ordem — e admitir põe o colaborador no quadro", async () => {
    const a = await convidar();
    expect(await erro(chamar("contador", "POST", { id: a.id }))).toContain("409 Só depois de assinado");
    expect(await erro(chamar("admitir", "POST", { id: a.id }))).toContain("409 Só depois de assinado");
    await atePronta(a.token);
    const ass = await chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO } });
    expect(ass.status, JSON.stringify(ass.json)).toBe(200);
    expect((await chamar("contador", "POST", { id: a.id })).json).toMatchObject({ situacao: "ENVIADO_CONTADOR" });
    expect((await gravada(a.id)).enviadoContadorPorId).toBe("uA");
    expect((await colaborador(a.colaborador.id))).toMatchObject({ ativo: false, statusColaborador: "INATIVO" });
    const adm = await chamar("admitir", "POST", { id: a.id });
    expect(adm.json).toMatchObject({ situacao: "ADMITIDO" });
    expect(await colaborador(a.colaborador.id)).toMatchObject({ ativo: true, statusColaborador: "ATIVO" });
    expect((await colaborador(a.colaborador.id)).dataAdmissao?.toISOString()).toBe(AGORA.toISOString());
  });

  it("a lista e o progresso mostram onde parou e o que falta", async () => {
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: { ...FORM, cep: "", endereco: "" }, etapa: "ENDERECO" } });
    const p = await chamar("uma", "GET", { id: a.id });
    expect(p.json).toMatchObject({ etapaPendente: "ENDERECO", faltando: ["CEP", "Endereço"] });
    expect(p.json.documentosFaltando.map((d: any) => d.id)).toEqual(["rg", "cpf", "comprovante_residencia", "ctps"]);
    expect(p.json.admissao).toMatchObject({ situacao: "PREENCHENDO", etapa: "ENDERECO" });
    const lista = await chamar("lista", "GET", { query: "busca=Marina" });
    expect(lista.json).toHaveLength(1);
    expect(lista.json[0]).toMatchObject({ id: a.id, situacao: "PREENCHENDO" });
    expect((await chamar("lista", "GET", { query: "situacao=ASSINADO" })).json).toHaveLength(0);
    expect((await chamar("lista", "GET", { query: `busca=${CPF_MARINA}` })).json).toHaveLength(1);
  });

  /* ───────── o link do colaborador ───────── */

  it("token que não existe e token vencido dizem a MESMA coisa, e contam no limite por IP", async () => {
    expect(await erro(chamar("pub", "GET", { token: "nao-existe" }))).toBe(`404 ${MSG_LINK_INVALIDO}`);
    const a = await convidar();
    await prisma.admissao.update({ where: { id: a.id }, data: { expiraEm: new Date("2026-11-01T12:00:00.000Z") } });
    expect(await erro(chamar("pub", "GET", { token: a.token }))).toBe(`410 ${MSG_LINK_INVALIDO}`);
    expect(await prisma.tentativaAcesso.count({ where: { tipo: "ADMISSAO_PUBLICA" } })).toBe(2);
    await prisma.admissao.update({ where: { id: a.id }, data: { expiraEm: new Date("2026-11-23T12:00:00.000Z") } });
    // o limite é por IP: 20 na janela de uma hora
    for (let i = 0; i < 18; i++) await chamar("pub", "GET", { token: `varredura-${i}` });
    const barrado = await chamar("pub", "GET", { token: "varredura-19" });
    expect(barrado.status).toBe(429);
    expect(barrado.json.erro).toContain("Muitas tentativas");
    // de outro IP, nada a ver — e o link BOM continua abrindo
    expect((await chamar("pub", "GET", { token: a.token, ip: "177.9.9.9" })).status).toBe(200);
  });

  it("link vencido não escreve nada: nem rascunho, nem documento, nem conclusão, nem assinatura", async () => {
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: FORM, etapa: "DADOS" } });
    for (const docId of ["rg", "cpf", "comprovante_residencia", "ctps"]) {
      await chamar("docs", "POST", { token: a.token, corpo: { docId, nome: `${docId}.png`, arquivoUrl: FOTO } });
    }
    // o prazo passou (o RH não reenviou): daqui em diante o link só olha, não grava
    await prisma.admissao.update({ where: { id: a.id }, data: { expiraEm: new Date("2026-11-10T12:00:00.000Z") } });
    const vencido = `410 ${MSG_LINK_INVALIDO}`;
    expect(await erro(chamar("rascunho", "PUT", { token: a.token, corpo: { form: { ...FORM, rg: "99.999.999-9" } } }))).toBe(vencido);
    expect(await erro(chamar("docs", "POST", { token: a.token, corpo: { docId: "foto", nome: "x.png", arquivoUrl: FOTO } }))).toBe(vencido);
    expect(await erro(chamar("codigo", "POST", { token: a.token, corpo: { email: "marina@exemplo.com" } }))).toBe(vencido);
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toBe(vencido);
    expect(await erro(chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO } }))).toBe(vencido);
    expect(await erro(chamar("consentir", "POST", { token: a.token }))).toBe(vencido);
    // nada mudou: situação, rascunho, documentos e a falta de assinatura
    const linha = await gravada(a.id);
    expect(linha).toMatchObject({ situacao: "PREENCHENDO", etapa: "DADOS", assinaturaEm: null, contratoTexto: null });
    expect(linha.rascunho.rg).toBe(FORM.rg);
    expect(await prisma.colaboradorDocumento.count()).toBe(4);
    expect(correio.enviados.filter((e) => e.tipo === "ADMISSAO_CODIGO")).toHaveLength(0);
  });

  it("dois cliques ao mesmo tempo no \"Assinar\": uma assinatura só, e a prova é de quem chegou primeiro", async () => {
    const a = await convidar();
    await atePronta(a.token);
    const [um, dois] = await Promise.all([
      chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO }, ip: "191.7.7.7" }),
      chamar("assinar", "POST", { token: a.token, corpo: { nome: "Outra Pessoa Qualquer", selfie: FOTO }, ip: "191.7.7.8" }),
    ]);
    const status = [um.status, dois.status].sort();
    expect(status, JSON.stringify([um.json, dois.json])).toEqual([200, 409]);
    const recusada = um.status === 409 ? um : dois;
    expect(recusada.json.erro).toBe("Este contrato já foi assinado.");
    const linha = await gravada(a.id);
    // uma assinatura, e a prova é inteira de UMA das duas tentativas (nome e IP combinam)
    const vencedora = (um.status === 200 ? um : dois).json;
    expect(linha.assinaturaNome).toBe(vencedora.assinaturaNome);
    expect(linha.assinaturaIp).toBe(vencedora.assinaturaNome === FORM.nome ? "191.7.7.7" : "191.7.7.8");
    expect(linha.situacao).toBe("ASSINADO");
    expect(await prisma.admissao.count({ where: { situacao: "ASSINADO" } })).toBe(1);
  });

  it("o link não entrega o CPF inteiro nem dado de outro colaborador; antes do consentimento não mostra formulário", async () => {
    const a = await convidar();
    await prisma.tecnico.create({ data: { empresaId: "e1", nome: "Carlos Oliveira", cpf: CPF_CARLOS, telefone: "11999990000", salario: 9999 } });
    const r = await chamar("pub", "GET", { token: a.token });
    expect(r.json).toMatchObject({
      situacao: "CONVIDADO", empresa: "Clima Total",
      colaborador: { nome: "Marina Alves", cpfMascarado: "***.982.247-**", cargo: "Técnico de refrigeração" },
      consentidoEm: null, form: null, documentos: [], enviados: [], contrato: null, orientacoes: null,
    });
    const texto = JSON.stringify(r.json);
    expect(texto).not.toContain(CPF_MARINA);
    expect(texto).not.toContain("Carlos");
    expect(texto).not.toContain("9999");
    expect(texto).not.toContain(a.token); // o token não volta no corpo
    expect((await gravada(a.id)).abertoEm?.toISOString()).toBe(AGORA.toISOString());
  });

  it("sem consentimento LGPD nada é salvo; com ele grava data, IP e navegador e passa a Preenchendo", async () => {
    const a = await convidar();
    expect(await erro(chamar("rascunho", "PUT", { token: a.token, corpo: { form: FORM } }))).toBe("403 É preciso aceitar o tratamento dos dados para continuar.");
    expect(await erro(chamar("docs", "POST", { token: a.token, corpo: { docId: "rg", arquivoUrl: FOTO } }))).toContain("403");
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toContain("403");
    expect((await gravada(a.id)).rascunho).toBeNull();

    const r = await chamar("consentir", "POST", { token: a.token, ip: "189.5.5.5" });
    expect(r.json).toMatchObject({ situacao: "PREENCHENDO" });
    expect(r.json.consentidoEm).toBe(AGORA.toISOString());
    expect(await gravada(a.id)).toMatchObject({ situacao: "PREENCHENDO", consentimentoIp: "189.5.5.5", consentimentoUserAgent: "Mozilla/5.0 (iPhone)" });
    // o formulário já abre com o nome do pré-cadastro
    expect(r.json.form).toMatchObject({ nome: "Marina Alves", nacionalidade: "Brasileira", contaTipo: "CORRENTE", dependentes: [] });
    expect(r.json.documentos.map((d: any) => d.id)).toEqual(["rg", "cpf", "comprovante_residencia", "ctps", "foto", "titulo_eleitor", "certidao_nascimento_filhos", "comprovante_escolaridade"]);
  });

  it("o rascunho guarda SÓ campos conhecidos, com teto de tamanho — e não perde nada ao voltar", async () => {
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    const r = await chamar("rascunho", "PUT", {
      token: a.token,
      corpo: { form: { ...FORM, nome: "x".repeat(500), invadido: "DROP TABLE", dependentes: Array.from({ length: 50 }, () => ({ nome: "Filho", parentesco: "INVENTADO" })) }, etapa: "DADOS" },
    });
    expect(r.status).toBe(200);
    const salvo = (await gravada(a.id)).rascunho;
    expect(Object.keys(salvo)).not.toContain("invadido");
    expect(salvo.nome).toHaveLength(200);
    expect(salvo.dependentes).toHaveLength(20);
    expect(salvo.dependentes[0].parentesco).toBe("FILHO"); // parentesco inventado volta ao padrão
    expect(salvo.rg).toBe(FORM.rg);
    // fecha e volta: o rascunho está lá
    expect((await chamar("pub", "GET", { token: a.token })).json.form.rg).toBe(FORM.rg);
    expect((await chamar("pub", "GET", { token: a.token })).json.etapa).toBe("DADOS");
  });

  it("o e-mail é verificado por código: o banco guarda só o hash, e errado, vencido ou tentativas demais não passam", async () => {
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    const envio = await chamar("codigo", "POST", { token: a.token, corpo: { email: "Marina@Exemplo.com " } });
    expect(envio.json).toMatchObject({ enviado: true, para: "marina@exemplo.com", erro: null });
    const codigo = correio.enviados.find((e) => e.tipo === "ADMISSAO_CODIGO")!.variaveis.codigo as string;
    expect(codigo).toMatch(/^\d{6}$/);
    const linha = await gravada(a.id);
    expect(linha.emailCodigoHash).not.toContain(codigo);
    expect(linha.emailCodigoHash).toHaveLength(64); // sha-256 em hex
    expect(linha.emailVerificado).toBeNull();

    expect(await erro(chamar("conferir", "POST", { token: a.token, corpo: { email: "marina@exemplo.com", codigo: "12" } }))).toBe("400 O código tem 6 números.");
    expect(await erro(chamar("conferir", "POST", { token: a.token, corpo: { email: "marina@exemplo.com", codigo: codigo === "000000" ? "999999" : "000000" } }))).toBe("400 Código incorreto. Confira o e-mail e tente de novo.");
    expect((await gravada(a.id)).emailCodigoTentativas).toBe(1);

    const ok = await chamar("conferir", "POST", { token: a.token, corpo: { email: "marina@exemplo.com", codigo } });
    expect(ok.json).toEqual({ verificado: true, email: "marina@exemplo.com" });
    expect(await gravada(a.id)).toMatchObject({ emailVerificado: "marina@exemplo.com", emailCodigoHash: null, emailCodigoTentativas: 0 });

    // vencido: 16 minutos depois o código não vale mais
    await chamar("codigo", "POST", { token: a.token, corpo: { email: "marina@exemplo.com" } });
    const novo = correio.enviados.at(-1)!.variaveis.codigo as string;
    vi.setSystemTime(new Date(AGORA.getTime() + 16 * 60_000));
    expect(await erro(chamar("conferir", "POST", { token: a.token, corpo: { email: "marina@exemplo.com", codigo: novo } }))).toBe("410 O código venceu. Peça outro.");
    vi.setSystemTime(AGORA);

    // tentativas demais: o código morre
    await chamar("codigo", "POST", { token: a.token, corpo: { email: "marina@exemplo.com" } });
    const terceiro = correio.enviados.at(-1)!.variaveis.codigo as string;
    const errado = terceiro === "111111" ? "222222" : "111111";
    for (let i = 0; i < CODIGO_MAX_TENTATIVAS; i++) await chamar("conferir", "POST", { token: a.token, corpo: { email: "marina@exemplo.com", codigo: errado } });
    expect(await erro(chamar("conferir", "POST", { token: a.token, corpo: { email: "marina@exemplo.com", codigo: terceiro } }))).toBe("429 Código bloqueado por tentativas. Peça outro.");
  });

  it("pedir código demais é barrado (por IP e por admissão), e trocar o e-mail derruba a verificação", async () => {
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    for (let i = 0; i < 5; i++) expect((await chamar("codigo", "POST", { token: a.token, corpo: { email: "marina@exemplo.com" } })).status).toBe(200);
    const barrado = await chamar("codigo", "POST", { token: a.token, corpo: { email: "marina@exemplo.com" } });
    expect(barrado.status).toBe(429);
    expect(barrado.json.erro).toContain("Muitos códigos pedidos");

    const codigo = correio.enviados.at(-1)!.variaveis.codigo as string;
    await chamar("conferir", "POST", { token: a.token, corpo: { email: "marina@exemplo.com", codigo } });
    expect((await gravada(a.id)).emailVerificado).toBe("marina@exemplo.com");
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: { ...FORM, email: "outro@exemplo.com" } } });
    expect((await gravada(a.id)).emailVerificado).toBeNull();
  });

  it("documento: o conteúdo é que decide (HTML disfarçado de PNG não entra) e o que passa vira anexo do colaborador", async () => {
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    expect(await erro(chamar("docs", "POST", { token: a.token, corpo: { docId: "rg", nome: "rg.png", arquivoUrl: DISFARCADO } }))).toContain("400");
    expect(await erro(chamar("docs", "POST", { token: a.token, corpo: { docId: "inventado", nome: "x.png", arquivoUrl: FOTO } }))).toBe("400 Este documento não está na lista da empresa.");
    expect(await prisma.colaboradorDocumento.count()).toBe(0);

    const r = await chamar("docs", "POST", { token: a.token, corpo: { docId: "rg", nome: "rg frente.png", arquivoUrl: FOTO } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ docId: "rg", nome: "rg frente.png" });
    const anexo = await prisma.colaboradorDocumento.findUnique({ where: { id: r.json.id } });
    expect(anexo).toMatchObject({ colaboradorId: a.colaborador.id, tipo: "rg" });
    expect(anexo.arquivoUrl.startsWith("data:image/png;base64,")).toBe(true);
    // a lista do link mostra o que chegou, sem o conteúdo do arquivo
    const pub = await chamar("pub", "GET", { token: a.token });
    expect(pub.json.enviados).toEqual([{ id: r.json.id, docId: "rg", nome: "rg frente.png" }]);
    expect(JSON.stringify(pub.json)).not.toContain("base64");
    // e ele mesmo apaga o que mandou errado. A EXPECTATIVA MUDOU na leva dos documentos da ficha:
    // apagar não remove mais a linha, marca. O arquivo sai da lista do link e da ficha do RH, e
    // fica o registro de quando saiu — documento de colaborador não some sem rastro. Sem autor:
    // quem apagou foi o próprio colaborador, pelo link, e ele não é usuário do sistema.
    expect((await chamar("doc", "DELETE", { token: a.token, documentoId: r.json.id })).json).toEqual({ ok: true });
    const apagado = await prisma.colaboradorDocumento.findUnique({ where: { id: r.json.id } });
    expect(apagado.excluidoEm).not.toBeNull();
    expect(apagado.excluidoPorId).toBeNull();
    expect(apagado.arquivoUrl, "o arquivo também fica").not.toBeNull();
    // para o link e para a admissão, porém, ele não existe mais
    expect((await chamar("pub", "GET", { token: a.token })).json.enviados).toEqual([]);
    expect(await erro(chamar("doc", "DELETE", { token: a.token, documentoId: r.json.id }))).toBe("404 Documento não encontrado");
  });

  it("concluir exige o que falta, o CPF do convite e o e-mail verificado — depois passa tudo ao cadastro", async () => {
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: { ...FORM, nomeMae: "" } } });
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toBe("400 Ainda falta: Nome da mãe");
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: FORM } });
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toContain("400 Ainda falta: rg, cpf, comprovante_residencia, ctps");
    for (const docId of ["rg", "cpf", "comprovante_residencia", "ctps"]) {
      await chamar("docs", "POST", { token: a.token, corpo: { docId, nome: `${docId}.png`, arquivoUrl: FOTO } });
    }
    // CPF que não é o do convite: é a conferência de identidade do link
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: { ...FORM, cpf: CPF_CARLOS } } });
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toBe("409 O CPF não confere com o do convite. Confira o número.");
    // Leva J: sem e-mail (ou com um que não é e-mail) não passa
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: { ...FORM, email: "" } } });
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toBe("400 Ainda falta: E-mail");
    // e-mail digitado sem verificar não passa (a empresa envia e-mail)
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: FORM } });
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toBe("409 Confirme o e-mail com o código antes de continuar.");
    await chamar("codigo", "POST", { token: a.token, corpo: { email: FORM.email } });
    await chamar("conferir", "POST", { token: a.token, corpo: { email: FORM.email, codigo: correio.enviados.at(-1)!.variaveis.codigo } });

    const r = await chamar("concluir", "POST", { token: a.token });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ situacao: "AGUARDANDO_ASSINATURA", etapaPendente: null, faltando: [] });
    expect((await gravada(a.id)).concluidoEm?.toISOString()).toBe(AGORA.toISOString());
    const t = await colaborador(a.colaborador.id);
    expect(t).toMatchObject({
      nome: FORM.nome, cpf: CPF_MARINA, rg: FORM.rg, pis: PIS, nomeMae: "Rosa Alves", nomePai: "João Pereira",
      estadoCivil: "SOLTEIRO", escolaridade: "MEDIO", sexo: "F", ctpsNumero: "1234567", ctpsSerie: "0010", ctpsUf: "SP",
      cep: "13010-000", endereco: "Rua das Flores", numero: "120", complemento: "Apto 32", bairro: "Centro", cidade: "Campinas", estado: "SP",
      banco: "Banco do Brasil", agencia: "1234-5", conta: "98765-4", contaTipo: "CORRENTE",
      email: FORM.email, telefone: FORM.telefone,
      // continua FORA do quadro até ser admitido
      ativo: false, statusColaborador: "INATIVO",
    });
    expect(t.dataNascimento?.toISOString().slice(0, 10)).toBe("1995-04-12");
    const deps = await prisma.colaboradorDependente.findMany({ where: { colaboradorId: a.colaborador.id } });
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ nome: "Luca Alves Pereira", cpf: CPF_CARLOS, parentesco: "FILHO", irrf: true, salarioFamilia: true });
    // concluir de novo não duplica dependente
    await chamar("concluir", "POST", { token: a.token });
    expect(await prisma.colaboradorDependente.count()).toBe(1);
  });

  /* ───────── a assinatura ───────── */

  it("Leva J: empresa sem o envio de e-mail configurado — o e-mail é obrigatório, mas a confirmação por código não trava", async () => {
    correio.ativo = false;
    const a = await convidar();
    await chamar("consentir", "POST", { token: a.token });
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: { ...FORM, email: "nao-e-email" } } });
    for (const docId of ["rg", "cpf", "comprovante_residencia", "ctps"]) {
      await chamar("docs", "POST", { token: a.token, corpo: { docId, nome: `${docId}.png`, arquivoUrl: FOTO } });
    }
    expect(await erro(chamar("concluir", "POST", { token: a.token }))).toBe("400 Ainda falta: E-mail");
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: FORM } });
    const r = await chamar("concluir", "POST", { token: a.token });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await colaborador(a.colaborador.id))!.email).toBe(FORM.email);
  });

  it("sem modelo de contrato o sistema NÃO assina (não inventa cláusula)", async () => {
    await chamar("config", "PUT", { corpo: { contratoModelo: "" } });
    const a = await convidar();
    await atePronta(a.token);
    expect((await chamar("pub", "GET", { token: a.token })).json.contrato).toBeNull();
    expect(await erro(chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO } })))
      .toBe("409 A empresa ainda não cadastrou o modelo de contrato. Fale com o RH.");
    expect((await gravada(a.id)).situacao).toBe("AGUARDANDO_ASSINATURA");
  });

  it("assinar grava nome, IP, navegador, selfie e o contrato CONGELADO — e a segunda tentativa não assina de novo", async () => {
    const a = await convidar();
    await prisma.tecnico.update({ where: { id: a.colaborador.id }, data: { jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["SEG", "TER", "QUA", "QUI", "SEX"] } });
    await atePronta(a.token);
    // o contrato aparece preenchido antes de assinar
    const antes = await chamar("pub", "GET", { token: a.token });
    expect(antes.json.contrato).toContain("Clima Total, CNPJ 12.345.678/0001-90, admite Marina Alves Pereira");
    expect(antes.json.contrato).toMatch(/no cargo de Técnico de refrigeração, salário de R\$\s3\.200,00, jornada 08:00 às 18:00, de segunda a sexta\./);
    expect(antes.json.contrato).toContain("Experiência de 45 dias, prorrogável por 45.");
    expect(antes.json.contrato).toContain("Campinas/SP, 16/11/2026.");
    expect(antes.json.orientacoes).toBeNull(); // só depois de assinar

    expect(await erro(chamar("assinar", "POST", { token: a.token, corpo: { nome: "Ma", selfie: FOTO } }))).toBe("400 Digite o seu nome completo para assinar.");
    expect(await erro(chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: "" } }))).toBe("400 Tire a foto para concluir a assinatura.");
    expect(await erro(chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: DISFARCADO } }))).toContain("400");
    expect((await gravada(a.id)).assinaturaEm).toBeNull();

    const r = await chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO }, ip: "191.7.7.7" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ situacao: "ASSINADO", assinaturaNome: FORM.nome });
    expect(r.json.orientacoes).toContain("Clínica Vida"); // as orientações finais entram agora
    const linha = await gravada(a.id);
    expect(linha).toMatchObject({ situacao: "ASSINADO", assinaturaNome: FORM.nome, assinaturaIp: "191.7.7.7", assinaturaUserAgent: "Mozilla/5.0 (iPhone)" });
    expect(linha.assinaturaEm.toISOString()).toBe(AGORA.toISOString());
    expect(linha.selfie.startsWith("data:image/png;base64,")).toBe(true);
    expect(linha.contratoTexto).toContain("admite Marina Alves Pereira");

    // segunda vez: não assina de novo e não reescreve a prova
    expect(await erro(chamar("assinar", "POST", { token: a.token, corpo: { nome: "Outra Pessoa Qualquer", selfie: FOTO } }))).toBe("409 Este contrato já foi assinado.");
    expect((await gravada(a.id)).assinaturaNome).toBe(FORM.nome);
  });

  it("depois de assinado o link abre nas orientações, mas não aceita mais rascunho nem documento", async () => {
    const a = await convidar();
    await atePronta(a.token);
    await chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO } });
    const r = await chamar("pub", "GET", { token: a.token });
    expect(r.json).toMatchObject({ situacao: "ASSINADO" });
    expect(r.json.orientacoes).toContain("Exame admissional");
    expect(r.json.contrato).toContain("admite Marina Alves Pereira"); // o texto congelado
    expect(await erro(chamar("rascunho", "PUT", { token: a.token, corpo: { form: FORM } }))).toBe("409 Este contrato já foi assinado.");
    expect(await erro(chamar("docs", "POST", { token: a.token, corpo: { docId: "foto", nome: "x.png", arquivoUrl: FOTO } }))).toBe("409 Este contrato já foi assinado.");
    // e o link vencido depois de assinado continua abrindo (é a tela de orientações)
    vi.setSystemTime(new Date("2026-12-30T12:00:00.000Z"));
    expect((await chamar("pub", "GET", { token: a.token })).status).toBe(200);
    vi.setSystemTime(AGORA);
  });

  it("a configuração é por empresa: documentos, validade e experiência mandam no link", async () => {
    await chamar("config", "PUT", {
      corpo: {
        documentos: [{ id: "rg", rotulo: "RG", obrigatorio: true }, { id: "diploma", rotulo: "Diploma", obrigatorio: false }],
        validadeDias: 2, experienciaDias: 30, experienciaProrrogacaoDias: 60,
      },
    });
    const cfg = await chamar("config", "GET");
    expect(cfg.json).toMatchObject({ validadeDias: 2, experienciaDias: 30, experienciaProrrogacaoDias: 60, camposDesconhecidos: [] });
    const a = await convidar();
    expect(a.expiraEm.slice(0, 10)).toBe("2026-11-18"); // 2 dias
    expect(a.documentosObrigatorios).toBe(1);
    await chamar("consentir", "POST", { token: a.token });
    await chamar("rascunho", "PUT", { token: a.token, corpo: { form: FORM } });
    await chamar("docs", "POST", { token: a.token, corpo: { docId: "rg", nome: "rg.png", arquivoUrl: FOTO } });
    // o e-mail é obrigatório desde a Leva J: confirmado pelo código
    await chamar("codigo", "POST", { token: a.token, corpo: { email: FORM.email } });
    await chamar("conferir", "POST", { token: a.token, corpo: { email: FORM.email, codigo: correio.enviados.at(-1)!.variaveis.codigo } });
    expect((await chamar("concluir", "POST", { token: a.token })).status).toBe(200); // só o RG era obrigatório
    const ass = await chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO } });
    expect(ass.json.contrato).toContain("Experiência de 30 dias, prorrogável por 60.");
    // validade fora da faixa é recusada
    expect(await erro(chamar("config", "PUT", { corpo: { validadeDias: 999 } }))).toContain("400 Validade do link");
    // campo que o modelo usa e o sistema não conhece: a tela avisa em vez de assinar em branco
    await chamar("config", "PUT", { corpo: { contratoModelo: "{{nome}} e {{inventado}}" } });
    expect((await chamar("config", "GET")).json.camposDesconhecidos).toEqual(["inventado"]);
  });

  it("o sino do RH conta as admissões assinadas esperando o contador", async () => {
    const { contarAdmissoesAssinadas } = await import("@/lib/admissao/admissao-server");
    expect(await contarAdmissoesAssinadas("e1")).toEqual({ admissoesAssinadas: 0, admissaoAssinadaId: null });
    const a = await convidar();
    await atePronta(a.token);
    await chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO } });
    expect(await contarAdmissoesAssinadas("e1")).toEqual({ admissoesAssinadas: 1, admissaoAssinadaId: a.id });
    await chamar("contador", "POST", { id: a.id });
    expect(await contarAdmissoesAssinadas("e1")).toEqual({ admissoesAssinadas: 0, admissaoAssinadaId: null });
  });

  it("quem gerou o convite é avisado por e-mail quando a admissão é assinada", async () => {
    const { avisarRh } = await import("@/lib/admissao/admissao-server");
    const a = await convidar();
    await atePronta(a.token);
    await chamar("assinar", "POST", { token: a.token, corpo: { nome: FORM.nome, selfie: FOTO } });
    expect(await avisarRh(a.id, "https://app.exemplo.com")).toEqual({ ok: true });
    expect(correio.internos).toHaveLength(1);
    expect(correio.internos[0]).toMatchObject({ empresaId: "e1", para: "ana@x.com", assunto: `Admissão assinada: ${FORM.nome}` });
    expect(correio.internos[0].html).toContain("https://app.exemplo.com/admissoes");
  });
});
