/**
 * Leva 2 — Portal e público. Auth.js do PORTAL real (lib/auth-portal), rotas e páginas reais,
 * PostgreSQL real (schema descartável via `db push`). Prova:
 *  - S3: login do portal com limite de tentativas (por e-mail e por IP), bcrypt fictício para
 *    e-mail sem acesso (resposta igual) e senha mínima de 8 ao conceder acesso;
 *  - S4: a sessão do portal é reconferida a cada leitura — revogar acesso, inativar contato ou
 *    cliente, desligar o portal ou redefinir a senha derrubam o JWT; permissões são relidas;
 *  - S5: verOS aplicado — agenda só com verOS; chamados com verOS/abrirChamados; navegação idem;
 *  - I13: o detalhe do chamado no portal mostra só marcos públicos e as fotos do próprio chamado,
 *    nunca o histórico interno da OS nem anexos subidos pela equipe;
 *  - I12: QR inativo é 404; "chamado só para logado" FUNCIONA (contato do mesmo cliente abre e a
 *    OS registra o contato; anônimo e contato de outro cliente não);
 *  - S11: rotas públicas de chamado com rate limit (429) e campos com tamanho máximo;
 *  - I14: as fotos do chamado passam por reduzirImagem antes do envio.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva2-portal
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { permissoesTotais } from "@/lib/permissoes";
import { PNG, HTML, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva2_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

process.env.AUTH_SECRET = "segredo-de-teste-leva2-portal-com-32-caracteres!";

// Sessão do PAINEL (rotas internas como acesso-portal): mock simples
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

// Sessão do PORTAL nas páginas/rotas: getPortalSession mockável; o RESTO (handlers, authorize) é o real
const sessaoPortal = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth-portal", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth-portal")>()),
  getPortalSession: vi.fn(async () => sessaoPortal.atual),
}));

// As páginas do portal usam <Link> (client); fora do router do Next ele vira um <a> simples
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...rest }: any) => React.createElement("a", { href: String(href), ...rest }, children) };
});

const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
const comoContato = (p: Record<string, boolean> = {}, extra: Record<string, unknown> = {}) => {
  sessaoPortal.atual = { user: { id: "ct1", name: "Carlos Contato", email: "contato@cliente.com", clienteId: "c1", clienteNome: "Hospital", empresaId: "e1", permissoes: p, ...extra } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, headers: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x`, {
    method: metodo, headers: { "Content-Type": "application/json", ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, headers: res.headers, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}

const COOKIE = "frivo.portal-session-token";
let portalHandlers: typeof import("@/lib/auth-portal").portalHandlers;

/** O que o formulário do portal faz: pega o csrf e posta as credenciais. */
async function entrarPortal(email: string, senha: string, ip = "200.1.1.1") {
  const c = await portalHandlers.GET(new NextRequest("http://localhost/api/portal-auth/csrf"));
  const { csrfToken } = await c.json();
  const cookieCsrf = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const res = await portalHandlers.POST(new NextRequest("http://localhost/api/portal-auth/callback/credentials", {
    method: "POST",
    body: new URLSearchParams({ email, senha, csrfToken, callbackUrl: "http://localhost/portal/dashboard" }),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", cookie: cookieCsrf, "x-forwarded-for": ip },
  }));
  const url = new URL((await res.json()).url);
  const setCookie = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`)) ?? "";
  return { ok: !url.searchParams.get("error"), code: url.searchParams.get("code"), cookie: setCookie.split(";")[0] };
}

/** Uma "requisição" do contato: lê a sessão do portal (mesmo callback jwt de getPortalSession). */
async function lerSessaoPortal(cookie: string) {
  const res = await portalHandlers.GET(new NextRequest("http://localhost/api/portal-auth/session", { headers: { cookie } }));
  return res.json();
}

const SENHA_CONTATO = "senha-do-portal-8";
let HASH_CONTATO = "";

const errorOriginal = console.error;
beforeEach(() => {
  // O Auth.js registra cada login recusado: esperado nos testes de bloqueio
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    const t = String(a[0]);
    if ((t.includes("[auth][error]") && /CredentialsSignin|JWTSessionError|CallbackRouteError/.test(t))
      || (/^\s+at /.test(t) && t.includes("@auth/core")) || /\[auth\]\[(cause|details)\]/.test(t)) return;
    errorOriginal(...a);
  });
});

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Leva 2 — portal e público (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ portalHandlers } = await import("@/lib/auth-portal"));

    HASH_CONTATO = await bcrypt.hash(SENHA_CONTATO, 4);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11", portalAtivo: true },
      { id: "c2", empresaId: "e1", nome: "Padaria", cpfCnpj: "22.222.222/0001-22", portalAtivo: true },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Loja" },
    ] });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", nome: "Carlos Contato", email: "contato@cliente.com", senha: HASH_CONTATO, permissoes: { abrirChamados: true, verOS: true } },
      { id: "ct2", empresaId: "e1", clienteId: "c2", nome: "Outra Cliente", email: "outra@cliente.com", senha: HASH_CONTATO, permissoes: { abrirChamados: true } },
    ] });
    await prisma.usuario.create({ data: { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" } });
    await prisma.equipamento.create({ data: { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTX" } });
    await prisma.qrcode.create({ data: { id: "qr1", empresaId: "e1", codigo: "QR-001", equipamentoId: "eq1", tokenPublico: "tok-qr-1" } });
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  const limparTentativas = async () => { await prisma.tentativaAcesso.deleteMany({}); };

  // ═══════════════ S3 — força bruta no login do portal ═══════════════

  it("S3: 5 senhas erradas bloqueiam o e-mail; depois da janela, a senha certa entra", async () => {
    await limparTentativas();
    for (let i = 0; i < 5; i++) {
      const r = await entrarPortal("contato@cliente.com", "senha-errada-1");
      expect(r).toMatchObject({ ok: false, code: "credentials" });
    }
    const bloqueado = await entrarPortal("contato@cliente.com", SENHA_CONTATO);
    expect(bloqueado.ok).toBe(false);
    expect(bloqueado.code).toMatch(/^bloqueado-\d+$/);

    // Janela de 15 min passou (envelhecemos as tentativas no banco): entra
    await prisma.$executeRawUnsafe(`UPDATE "${SCHEMA}"."tentativas_acesso" SET criado_em = criado_em - interval '16 minutes'`);
    const depois = await entrarPortal("contato@cliente.com", SENHA_CONTATO);
    expect(depois.ok).toBe(true);
    expect(depois.cookie.startsWith(COOKIE)).toBe(true);
  });

  it("S3: e-mail sem acesso responde IGUAL (code credentials) e também conta tentativa; IP estourado bloqueia até a senha certa", async () => {
    await limparTentativas();
    const semAcesso = await entrarPortal("ninguem@nada.com", "qualquer-senha", "10.0.0.9");
    expect(semAcesso).toMatchObject({ ok: false, code: "credentials" });
    const registros = await prisma.tentativaAcesso.count({ where: { tipo: "PORTAL_LOGIN" } });
    expect(registros).toBeGreaterThan(0);

    // 20 tentativas do MESMO IP (e-mails variados) → o IP trava, mesmo com a senha certa
    const { registrarTentativa } = await import("@/lib/acesso/limite");
    for (let i = 0; i < 20; i++) await registrarTentativa("PORTAL_LOGIN", { email: `x${i}@y.com`, ip: "10.0.0.9" });
    const bloqueado = await entrarPortal("contato@cliente.com", SENHA_CONTATO, "10.0.0.9");
    expect(bloqueado.code).toMatch(/^bloqueado-\d+$/);
    await limparTentativas();
  });

  it("S3/L25: conceder acesso com senha curta é 400 (mín. 8); com 8+ grava e o login funciona", async () => {
    comoAdmin();
    const contato = await prisma.contatoCliente.create({ data: { id: "ct3", empresaId: "e1", clienteId: "c1", nome: "Novo", email: "novo@cliente.com" } });
    const curto = await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "PUT", { id: "c1", contatoId: contato.id },
      { email: "novo@cliente.com", senha: "1234", ativo: true, permissoes: {} });
    expect(curto.status).toBe(400);
    expect(curto.json.erro).toContain("8");

    const ok = await chamar("clientes/[id]/contatos/[contatoId]/acesso-portal", "PUT", { id: "c1", contatoId: contato.id },
      { email: "novo@cliente.com", senha: "senha-nova-12", ativo: true, permissoes: { verOS: true } });
    expect(ok.status).toBe(200);
    expect(ok.json.temAcesso).toBe(true);

    const login = await entrarPortal("novo@cliente.com", "senha-nova-12");
    expect(login.ok).toBe(true);
    await limparTentativas();
  });

  // ═══════════════ S4 — sessão do portal reconferida ═══════════════

  it("S4: revogar o acesso, desligar o portal do cliente ou redefinir a senha derrubam a sessão na leitura seguinte; permissões são relidas", async () => {
    await limparTentativas();
    const { cookie } = await entrarPortal("contato@cliente.com", SENHA_CONTATO);
    let s = await lerSessaoPortal(cookie);
    expect(s?.user?.clienteId).toBe("c1");

    // Permissão retirada no banco vale na próxima leitura, sem relogar
    await prisma.contatoCliente.update({ where: { id: "ct1" }, data: { permissoes: { abrirChamados: true } } });
    s = await lerSessaoPortal(cookie);
    expect(s?.user?.permissoes?.verOS).toBeFalsy();
    expect(s?.user?.permissoes?.abrirChamados).toBe(true);

    // Portal do cliente desligado → sessão cai
    await prisma.cliente.update({ where: { id: "c1" }, data: { portalAtivo: false } });
    s = await lerSessaoPortal(cookie);
    expect(s?.user ?? null).toBeNull();
    await prisma.cliente.update({ where: { id: "c1" }, data: { portalAtivo: true } });

    // Acesso revogado (senha removida) → sessão cai
    await prisma.contatoCliente.update({ where: { id: "ct1" }, data: { senha: null } });
    s = await lerSessaoPortal(cookie);
    expect(s?.user ?? null).toBeNull();

    // Senha REDEFINIDA → a sessão antiga (da senha anterior) não volta
    await prisma.contatoCliente.update({ where: { id: "ct1" }, data: { senha: await bcrypt.hash("outra-senha-99", 4) } });
    s = await lerSessaoPortal(cookie);
    expect(s?.user ?? null).toBeNull();

    // volta ao estado original para os demais testes
    await prisma.contatoCliente.update({ where: { id: "ct1" }, data: { senha: HASH_CONTATO, permissoes: { abrirChamados: true, verOS: true } } });
    await limparTentativas();
  });

  it("S4: contato inativado ou cliente inativado derrubam a sessão", async () => {
    const { cookie } = await entrarPortal("contato@cliente.com", SENHA_CONTATO);
    await prisma.contatoCliente.update({ where: { id: "ct1" }, data: { ativo: false } });
    expect((await lerSessaoPortal(cookie))?.user ?? null).toBeNull();
    await prisma.contatoCliente.update({ where: { id: "ct1" }, data: { ativo: true } });

    await prisma.cliente.update({ where: { id: "c1" }, data: { ativo: false } });
    expect((await lerSessaoPortal(cookie))?.user ?? null).toBeNull();
    await prisma.cliente.update({ where: { id: "c1" }, data: { ativo: true } });
    await limparTentativas();
  });

  // ═══════════════ S5 — verOS aplicado nas páginas ═══════════════

  it("S5: agenda exige verOS; chamados aceitam verOS OU abrirChamados; sem nada, SemAcesso", async () => {
    const { SemAcesso } = await import("@/components/portal/sem-acesso");
    const { default: PortalAgenda } = await import("@/app/(portal)/portal/(protegido)/agenda/page");
    const { default: PortalChamados } = await import("@/app/(portal)/portal/(protegido)/chamados/page");

    comoContato({}); // nenhuma permissão
    expect(((await PortalAgenda()) as any).type).toBe(SemAcesso);
    expect(((await PortalChamados()) as any).type).toBe(SemAcesso);

    comoContato({ abrirChamados: true }); // abre chamados mas não vê a agenda
    expect(((await PortalAgenda()) as any).type).toBe(SemAcesso);
    expect(((await PortalChamados()) as any).type).not.toBe(SemAcesso);

    comoContato({ verOS: true });
    expect(((await PortalAgenda()) as any).type).not.toBe(SemAcesso);
    expect(((await PortalChamados()) as any).type).not.toBe(SemAcesso);
  });

  // ═══════════════ I13 — detalhe do chamado sem material interno ═══════════════

  it("I13: o detalhe do chamado mostra marcos públicos e as fotos do chamado — nunca o histórico interno nem anexo subido depois pela equipe", async () => {
    const criada = new Date("2026-10-20T13:00:00Z");
    const os = await prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: "OS-2026-9001", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA",
      status: "EM_ANDAMENTO", origem: "PORTAL_CLIENTE", descricao: "Ar não gela", criadoEm: criada, dataInicio: new Date("2026-10-21T14:00:00Z"),
      anexos: { create: [
        { nome: "foto-cliente.png", tipo: "image/png", tamanho: 70, conteudo: dataUrl("image/png", PNG), criadoEm: criada },
        { nome: "interno-depois.png", tipo: "image/png", tamanho: 70, conteudo: dataUrl("image/png", PNG), criadoEm: new Date(criada.getTime() + 3_600_000) },
      ] },
    } });
    await prisma.osHistorico.create({ data: { ordemServicoId: os.id, usuarioId: "uA", acao: "Nota interna da equipe", detalhes: "cliente difícil, renegociar contrato" } });

    comoContato({ verOS: true });
    const { default: Detalhe } = await import("@/app/(portal)/portal/(protegido)/chamados/[id]/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(await Detalhe({ params: Promise.resolve({ id: os.id }) }) as any);

    expect(html).toContain("Chamado aberto");           // marco público
    expect(html).toContain("Atendimento iniciado");     // marco público
    expect(html).not.toContain("Nota interna da equipe"); // histórico interno NÃO sai
    expect(html).not.toContain("renegociar contrato");
    const fotos = (html.match(/<img/g) ?? []).length;
    expect(fotos).toBe(1); // só a foto enviada com o chamado; a da equipe (1h depois) não
  });

  // ═══════════════ I12 — QR: ativo + "só logado" funcionando ═══════════════

  it("I12: QR inativo não abre chamado (404) nem página; reativado volta", async () => {
    sessaoPortal.atual = null;
    await prisma.qrcode.update({ where: { id: "qr1" }, data: { ativo: false } });
    const r = await chamar("qr/[token]/chamado", "POST", { token: "tok-qr-1" }, { nome: "Zé Anônimo", descricao: "Está pingando água" });
    expect(r.status).toBe(404);

    const { default: QrPage } = await import("@/app/(publico)/qr/[token]/page");
    await expect(QrPage({ params: Promise.resolve({ token: "tok-qr-1" }) })).rejects.toThrow(); // notFound()

    await prisma.qrcode.update({ where: { id: "qr1" }, data: { ativo: true } });
    await limparTentativas();
  });

  it("I12: com 'chamado só para logado', anônimo e contato de OUTRO cliente recebem 403; o contato do cliente abre e a OS registra quem abriu", async () => {
    await limparTentativas();
    await prisma.configuracao.upsert({
      where: { empresaId: "e1" },
      create: { empresaId: "e1", qrConfig: { chamadoSomenteLogado: true } },
      update: { qrConfig: { chamadoSomenteLogado: true } },
    });

    sessaoPortal.atual = null; // anônimo
    const anon = await chamar("qr/[token]/chamado", "POST", { token: "tok-qr-1" }, { nome: "Zé", descricao: "Barulho estranho no split" });
    expect(anon.status).toBe(403);

    sessaoPortal.atual = { user: { id: "ct2", clienteId: "c2", empresaId: "e1", permissoes: { abrirChamados: true } } }; // outro cliente
    const outro = await chamar("qr/[token]/chamado", "POST", { token: "tok-qr-1" }, { nome: "Outra", descricao: "Barulho estranho no split" });
    expect(outro.status).toBe(403);

    comoContato({ abrirChamados: true }); // contato do cliente do equipamento
    const ok = await chamar("qr/[token]/chamado", "POST", { token: "tok-qr-1" }, { nome: "Carlos", descricao: "Barulho estranho no split" });
    expect(ok.status).toBe(201);
    const os = await prisma.ordemServico.findFirst({ where: { chamadoNumero: ok.json.chamadoNumero } });
    expect(os.contatoOrigemId).toBe("ct1");

    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { qrConfig: {} } });
    await limparTentativas();
  });

  // ═══════════════ S11 — rate limit e tamanho máximo ═══════════════

  it("S11: estourou o limite por IP, o QR público responde 429 (sem criar OS)", async () => {
    await limparTentativas();
    sessaoPortal.atual = null;
    const { registrarTentativa } = await import("@/lib/acesso/limite");
    for (let i = 0; i < 10; i++) await registrarTentativa("CHAMADO_PUBLICO", { ip: "177.10.10.10" });
    const antes = await prisma.ordemServico.count({ where: { empresaId: "e1" } });
    const r = await chamar("qr/[token]/chamado", "POST", { token: "tok-qr-1" },
      { nome: "Zé", descricao: "Qualquer coisa aqui" }, { "x-forwarded-for": "177.10.10.10" });
    expect(r.status).toBe(429);
    expect(await prisma.ordemServico.count({ where: { empresaId: "e1" } })).toBe(antes);
    await limparTentativas();
  });

  it("S11: chamado do portal também tem limite por contato (429) e descrição tem tamanho máximo (400)", async () => {
    await limparTentativas();
    comoContato({ abrirChamados: true });
    const longa = await chamar("portal/chamados", "POST", {}, { descricao: "x".repeat(2001) });
    expect(longa.status).toBe(400);

    const { registrarTentativa } = await import("@/lib/acesso/limite");
    for (let i = 0; i < 15; i++) await registrarTentativa("CHAMADO_PUBLICO", { usuarioId: "ct1" });
    const r = await chamar("portal/chamados", "POST", {}, { descricao: "Chamado legítimo de verdade" });
    expect(r.status).toBe(429);
    await limparTentativas();
  });

  it("portal/chamados: continua validando foto pelos BYTES (HTML disfarçado é 400) e exigindo abrirChamados (403)", async () => {
    await limparTentativas();
    comoContato({ verOS: true }); // sem abrirChamados
    expect((await chamar("portal/chamados", "POST", {}, { descricao: "Tentando sem permissão" })).status).toBe(403);

    comoContato({ abrirChamados: true });
    const r = await chamar("portal/chamados", "POST", {}, {
      descricao: "Com foto suspeita", fotos: [{ nome: "x.png", tipo: "image/png", tamanho: 30, conteudo: dataUrl("image/png", HTML) }],
    });
    expect(r.status).toBe(400);
    await limparTentativas();
  });
});

// I14 (compressão das fotos no formulário) fica em leva2-chamado-form-ui.test.ts (ambiente DOM).
