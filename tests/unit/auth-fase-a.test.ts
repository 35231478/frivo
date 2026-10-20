/**
 * Autenticação — Fase A. Usa o Auth.js REAL (lib/auth.ts): login pelo mesmo POST que o formulário faz
 * (csrf → /api/auth/callback/credentials), leitura da sessão por /api/auth/session (mesmo callback jwt
 * de `auth()`), middleware real e as rotas reais. Banco em memória; e-mail falso. Prova:
 *  - "Manter conectado": marcado = 30 dias; desmarcado = 1 dia desde o login (servidor e middleware);
 *    token antigo (de antes desta versão) segue como era;
 *  - limite de tentativas: bloqueia depois de N falhas (por e-mail e por IP), igual para e-mail
 *    cadastrado ou não, libera depois da janela; sem a tabela, o login segue funcionando;
 *  - "Esqueci minha senha": mensagem genérica SEMPRE; e-mail só para usuário existente e ativo;
 *    link de 1 hora, de uso único, que encerra as sessões antigas;
 *  - troca no perfil: exige a senha atual, grava hash (bcrypt), regra forte, outras sessões caem e
 *    esta continua;
 *  - logout apaga a sessão.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { decode, encode } from "next-auth/jwt";
import type { Banco } from "./helpers/banco-memoria";

const SEGREDO = "segredo-de-teste-auth-fase-a-com-32-caracteres!";
process.env.AUTH_SECRET = SEGREDO;
process.env.AUTH_URL = "http://localhost/api/auth";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
const falhar = vi.hoisted(() => ({ tentativas: false }));
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const base = criarPrisma(db, {
    usuario: (r, T) => ({ empresa: T("empresa").find((e) => e.id === r.empresaId), perfilAcesso: null }),
  });
  const quebrado = new Proxy({}, { get: () => async () => { throw new Error('relation "tentativas_acesso" does not exist'); } });
  return { prisma: new Proxy(base, { get: (t, m: string) => (m === "tentativaAcesso" && falhar.tentativas ? quebrado : t[m]) }) };
});
// E-mail (Resend) falso: registra o que sairia
const email = vi.hoisted(() => ({ ok: true, enviados: [] as any[] }));
vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async (empresaId: string, p: any) => { email.enviados.push({ empresaId, ...p }); return email.ok ? { ok: true } : { ok: false, erro: "E-mail não configurado ou inativo." }; }),
}));
// `after` do Next: guarda o trabalho para o teste rodar depois de ver a resposta
const depois = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { depois.push(fn); } }));
// `auth()` das rotas (sem contexto de requisição no teste); o resto do Auth.js é o real
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), auth: vi.fn(async () => sessao.atual) }));

const COOKIE = "authjs.session-token";
const HORA = 3600_000;
const DIA = 24 * HORA;
const T0 = new Date("2026-10-20T12:00:00Z").getTime();
let handlers: typeof import("@/lib/auth").handlers;
let HASH_ANA = "";
const SENHA_ANA = "Senha-antiga1";

beforeAll(async () => {
  ({ handlers } = await import("@/lib/auth"));
  HASH_ANA = await bcrypt.hash(SENHA_ANA, 4);
}, 30_000);

const errorOriginal = console.error;
beforeEach(() => {
  // O Auth.js registra cada login recusado ("CredentialsSignin") e cada token vencido ("JWTSessionError"): esperado aqui
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    const t = String(a[0]);
    if ((t.includes("[auth][error]") && /CredentialsSignin|JWTSessionError/.test(t)) || (/^\s+at /.test(t) && t.includes("@auth/core"))
      || /\[auth\]\[(cause|details)\]/.test(t)) return;
    errorOriginal(...a);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  falhar.tentativas = false;
  email.ok = true; email.enviados = [];
  depois.length = 0;
  sessao.atual = null;
  db.escritas = [];
  db.t = {
    empresa: [{ id: "e1", nomeFantasia: "Clima Total", ativo: true }, { id: "e2", nomeFantasia: "Fechada", ativo: false }],
    usuario: [
      { id: "u1", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: HASH_ANA, ativo: true, role: "OPERADOR", perfilAcessoId: null },
      { id: "u2", empresaId: "e1", nome: "Beto Inativo", email: "beto@x.com", senha: HASH_ANA, ativo: false, role: "OPERADOR", perfilAcessoId: null },
      { id: "u3", empresaId: "e2", nome: "Caio", email: "caio@x.com", senha: HASH_ANA, ativo: true, role: "OPERADOR", perfilAcessoId: null },
    ],
    tentativaAcesso: [],
    emailLog: [],
  };
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const avancar = (ms: number) => vi.setSystemTime(Date.now() + ms);
const ana = () => db.t.usuario.find((u) => u.id === "u1")!;

/** O que o formulário de login faz: pega o csrf e posta as credenciais (signIn("credentials")). */
async function entrar(emailLogin: string, senha: string, o: { lembrar?: boolean; ip?: string } = {}) {
  const c = await handlers.GET(new NextRequest("http://localhost/api/auth/csrf"));
  const { csrfToken } = await c.json();
  const cookieCsrf = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const corpo = new URLSearchParams({ email: emailLogin, senha, csrfToken, callbackUrl: "http://localhost/dashboard" });
  if (o.lembrar !== undefined) corpo.set("lembrar", String(o.lembrar));
  const res = await handlers.POST(new NextRequest("http://localhost/api/auth/callback/credentials", {
    method: "POST", body: corpo,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", cookie: cookieCsrf, "x-forwarded-for": o.ip ?? "200.1.1.1" },
  }));
  const url = new URL((await res.json()).url);
  const setCookie = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`)) ?? "";
  return { ok: !url.searchParams.get("error"), code: url.searchParams.get("code"), cookie: setCookie.split(";")[0], setCookie };
}

/** Uma "requisição" do usuário: lê a sessão como `auth()` faz (e devolve o cookie renovado). */
async function lerSessao(cookie: string) {
  const res = await handlers.GET(new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }));
  const novo = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`)) ?? "";
  return { sessao: await res.json(), cookie: novo.split(";")[0], setCookie: novo };
}
const tokenDo = async (cookie: string) => decode({ token: cookie.slice(COOKIE.length + 1), secret: SEGREDO, salt: COOKIE });
const expiraEm = (setCookie: string) => new Date(/Expires=([^;]+)/i.exec(setCookie)![1]).getTime();

// ═════════════════════════ 1. Manter conectado ═════════════════════════
describe("manter conectado", () => {
  it("marcado: sessão longa — cookie e token de 30 dias; segue valendo depois de 1 dia", async () => {
    const r = await entrar("ana@x.com", SENHA_ANA, { lembrar: true });
    expect(r.ok).toBe(true);
    expect(await tokenDo(r.cookie)).toMatchObject({ id: "u1", lembrar: true, loginEm: T0 });
    expect(expiraEm(r.setCookie) - T0).toBe(30 * DIA);

    avancar(25 * HORA);
    expect((await lerSessao(r.cookie)).sessao?.user?.id).toBe("u1");
    avancar(28 * DIA); // 29 dias depois do login, sem renovar
    expect((await lerSessao(r.cookie)).sessao?.user?.id).toBe("u1");
    avancar(2 * DIA); // 31 dias sem usar: venceu
    expect((await lerSessao(r.cookie)).sessao).toBeNull();
  });

  it("desmarcado: sessão curta — 1 dia desde o LOGIN, mesmo usando no meio; o cookie é apagado", async () => {
    const r = await entrar("ana@x.com", SENHA_ANA, { lembrar: false });
    expect(r.ok).toBe(true);
    expect(await tokenDo(r.cookie)).toMatchObject({ lembrar: false, loginEm: T0 });

    avancar(12 * HORA);
    const meio = await lerSessao(r.cookie); // usou no meio: o token é renovado, mas o prazo não
    expect(meio.sessao?.user?.id).toBe("u1");
    avancar(11 * HORA + 59 * 60_000); // 23h59 depois do login
    expect((await lerSessao(meio.cookie)).sessao?.user?.id).toBe("u1");
    avancar(2 * 60_000); // 24h01
    const fim = await lerSessao(meio.cookie);
    expect(fim.sessao).toBeNull();
    expect(fim.setCookie).toMatch(new RegExp(`^${COOKIE.replace(".", "\\.")}=;`));
  });

  it("a mesma regra vale no middleware: sessão curta vencida vai para o login", async () => {
    const { default: middleware } = await import("@/middleware");
    const curta = await entrar("ana@x.com", SENHA_ANA, { lembrar: false });
    const longa = await entrar("ana@x.com", SENHA_ANA, { lembrar: true });
    const abrir = async (cookie: string) =>
      (await (middleware as any)(new NextRequest("http://localhost/dashboard", { headers: { cookie } }), {})) as Response;
    expect((await abrir(curta.cookie)).headers.get("location")).toBeNull();
    avancar(25 * HORA);
    expect((await abrir(curta.cookie)).headers.get("location")).toBe("http://localhost/login?callbackUrl=%2Fdashboard");
    expect((await abrir(longa.cookie)).headers.get("location")).toBeNull();
  });

  it("sem o campo (formulário antigo em cache) e token de antes desta versão: como sempre foi, 30 dias", async () => {
    const r = await entrar("ana@x.com", SENHA_ANA);
    expect(await tokenDo(r.cookie)).toMatchObject({ lembrar: true });

    const antigo = `${COOKIE}=${await encode({ salt: COOKIE, secret: SEGREDO, token: { sub: "u1", id: "u1", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "OPERADOR", permissoes: {} } })}`;
    avancar(10 * DIA);
    expect((await lerSessao(antigo)).sessao?.user?.id).toBe("u1");
    expect((await lerSessao(r.cookie)).sessao?.user?.id).toBe("u1");
  });

  it("o formulário manda a escolha (true/false) e explica a duração", async () => {
    const fonte = await import("node:fs").then((fs) => fs.readFileSync("components/auth/login-form.tsx", "utf8"));
    expect(fonte).toMatch(/lembrar: lembrar \? "true" : "false"/);
    expect(fonte).toMatch(/Manter conectado/);
    expect(fonte).toMatch(/href="\/esqueci-senha"/);
  });
});

// ═════════════════════════ 2. Limite de tentativas ═════════════════════════
describe("limite de tentativas no login", () => {
  it("5 senhas erradas bloqueiam o e-mail — até a senha certa; libera depois de 15 min", async () => {
    for (let i = 0; i < 5; i++) expect(await entrar("ana@x.com", "errada-123")).toMatchObject({ ok: false, code: "credentials" });
    const bloqueado = await entrar("ana@x.com", SENHA_ANA);
    expect(bloqueado).toMatchObject({ ok: false, code: "bloqueado-15", cookie: "" });

    avancar(14 * 60_000);
    expect((await entrar("ana@x.com", SENHA_ANA)).code).toBe("bloqueado-1");
    avancar(60_000 + 1);
    expect((await entrar("ana@x.com", SENHA_ANA)).ok).toBe(true);
  });

  it("o bloqueio dura até a 1ª das 5 falhas sair da janela (falhas espalhadas no tempo)", async () => {
    for (let i = 0; i < 5; i++) { await entrar("ana@x.com", "errada-123"); avancar(60_000); }
    expect((await entrar("ana@x.com", SENHA_ANA)).code).toBe("bloqueado-10"); // 1ª falha em T0; agora T0+5min
    avancar(10 * 60_000 + 1);
    expect((await entrar("ana@x.com", SENHA_ANA)).ok).toBe(true);
  });

  it("trocar maiúsculas do e-mail não escapa do limite", async () => {
    for (const e of ["Ana@x.com", "ANA@x.com", "ana@X.com", "aNa@x.com", "ana@x.COM"]) await entrar(e, "errada-123");
    expect((await entrar("ana@x.com", SENHA_ANA)).code).toBe("bloqueado-15");
  });

  it("4 erros + 1 acerto zera a conta do e-mail", async () => {
    for (let i = 0; i < 4; i++) await entrar("ana@x.com", "errada-123");
    expect((await entrar("ana@x.com", SENHA_ANA)).ok).toBe(true);
    for (let i = 0; i < 4; i++) await entrar("ana@x.com", "errada-123");
    expect((await entrar("ana@x.com", SENHA_ANA)).ok).toBe(true);
  });

  it("não revela se o e-mail existe: mesma resposta e mesmo bloqueio para e-mail sem cadastro (e o bcrypt roda igual)", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    const naoExiste = await entrar("ninguem@x.com", "errada-123");
    const inativo = await entrar("beto@x.com", SENHA_ANA);
    const empresaFechada = await entrar("caio@x.com", SENHA_ANA);
    const senhaErrada = await entrar("ana@x.com", "errada-123");
    for (const r of [naoExiste, inativo, empresaFechada, senhaErrada]) expect(r).toMatchObject({ ok: false, code: "credentials", cookie: "" });
    expect(compare).toHaveBeenCalledTimes(4); // inclusive para quem não existe (tempo de resposta igual)

    db.t.tentativaAcesso = [];
    for (let i = 0; i < 4; i++) await entrar("ninguem@x.com", "errada-123");
    expect((await entrar("ninguem@x.com", "errada-123")).code).toBe("credentials");
    expect((await entrar("ninguem@x.com", "errada-123")).code).toBe("bloqueado-15");
  }, 30_000);

  it("por IP: 20 falhas do mesmo IP (e-mails variados) bloqueiam o IP; outro IP segue entrando", async () => {
    const { registrarTentativa } = await import("@/lib/acesso/limite");
    for (let i = 0; i < 20; i++) await registrarTentativa("LOGIN", { email: `chute${i}@x.com`, ip: "6.6.6.6" });
    expect((await entrar("ana@x.com", SENHA_ANA, { ip: "6.6.6.6" })).code).toBe("bloqueado-15");
    expect((await entrar("ana@x.com", SENHA_ANA, { ip: "200.1.1.1" })).ok).toBe(true);
  });

  it("acertar a senha zera o e-mail, mas não as falhas do IP", async () => {
    const { registrarTentativa } = await import("@/lib/acesso/limite");
    for (let i = 0; i < 19; i++) await registrarTentativa("LOGIN", { email: `chute${i}@x.com`, ip: "6.6.6.6" });
    expect((await entrar("ana@x.com", SENHA_ANA, { ip: "6.6.6.6" })).ok).toBe(true);
    await entrar("ninguem@x.com", "errada-123", { ip: "6.6.6.6" }); // 20ª falha do IP
    expect((await entrar("ana@x.com", SENHA_ANA, { ip: "6.6.6.6" })).code).toBe("bloqueado-15");
  });

  it("IP de quem chamou: o 1º do x-forwarded-for, senão x-real-ip", async () => {
    const { ipDaRequisicao } = await import("@/lib/acesso/limite");
    expect(ipDaRequisicao(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(ipDaRequisicao(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(ipDaRequisicao(new Headers())).toBeNull();
    expect(ipDaRequisicao(undefined)).toBeNull();
  });

  it("guarda só o hash do e-mail e do IP; linhas com mais de 1 dia são apagadas", async () => {
    await entrar("ana@x.com", "errada-123", { ip: "189.10.20.30" });
    const texto = JSON.stringify(db.t.tentativaAcesso);
    expect(db.t.tentativaAcesso).toHaveLength(2);
    expect(texto).not.toMatch(/ana@x\.com|189\.10\.20\.30/);
    expect(db.t.tentativaAcesso.map((t) => t.chave.split(":")[0]).sort()).toEqual(["email", "ip"]);
    avancar(DIA + 1);
    await entrar("ana@x.com", "errada-123", { ip: "189.10.20.30" });
    expect(db.t.tentativaAcesso).toHaveLength(2); // as velhas saíram
  });

  it("sem a tabela (SQL ainda não rodado) ou banco fora no limite: o login continua funcionando", async () => {
    falhar.tentativas = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await entrar("ana@x.com", "errada-123")).code).toBe("credentials");
    expect((await entrar("ana@x.com", SENHA_ANA)).ok).toBe(true);
  });

  it("mensagens do formulário: senha errada é genérica; bloqueio diz quantos minutos", async () => {
    const { mensagemErroLogin } = await import("@/components/auth/login-form");
    expect(mensagemErroLogin("credentials")).toBe("E-mail ou senha inválidos.");
    expect(mensagemErroLogin(undefined)).toBe("E-mail ou senha inválidos.");
    expect(mensagemErroLogin("bloqueado-12")).toMatch(/aguarde 12 min/);
  });
});

// ═════════════════════════ 3. Esqueci minha senha ═════════════════════════
const esqueci = async (corpo: unknown, o: { ip?: string; url?: string } = {}) => {
  const { POST } = await import("@/app/api/publico/esqueci-senha/route");
  const res = await POST(new NextRequest(o.url ?? "http://localhost/api/publico/esqueci-senha", {
    method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "application/json", "x-forwarded-for": o.ip ?? "200.1.1.1" },
  }));
  return { status: res.status, json: await res.json() };
};
const rodarDepois = async () => { for (const fn of depois.splice(0)) await fn(); };
const linkDoEmail = () => new URL(email.enviados.at(-1).variaveis.link_definir_senha);
const definir = async (metodo: "GET" | "POST", token: string, corpo?: unknown) => {
  const mod = await import("@/app/api/publico/definir-senha/route");
  const res = metodo === "GET"
    ? await mod.GET(new NextRequest(`http://localhost/api/publico/definir-senha?token=${encodeURIComponent(token)}`))
    : await mod.POST(new NextRequest("http://localhost/api/publico/definir-senha", { method: "POST", body: JSON.stringify({ token, ...(corpo as object) }) }));
  return { status: res.status, json: await res.json() };
};

describe("esqueci minha senha", () => {
  it("usuário ativo: resposta genérica e e-mail (Resend da empresa) com o link de 1 hora", async () => {
    const r = await esqueci({ email: "ana@x.com" });
    const { MENSAGEM_ESQUECI } = await import("@/lib/acesso/recuperacao");
    expect(r).toEqual({ status: 200, json: { ok: true, mensagem: MENSAGEM_ESQUECI } });
    expect(email.enviados).toHaveLength(0); // sai DEPOIS da resposta
    await rodarDepois();
    expect(email.enviados).toHaveLength(1);
    expect(email.enviados[0]).toMatchObject({ empresaId: "e1", tipo: "RECUPERACAO_SENHA", para: "ana@x.com", variaveis: { usuario_nome: "Ana Souza", validade_link: "60 minutos" } });
    expect(linkDoEmail().pathname).toBe("/definir-senha");
    expect((await definir("GET", linkDoEmail().searchParams.get("token")!)).json).toEqual({ nome: "Ana Souza", email: "ana@x.com", finalidade: "recuperacao" });
  });

  it("e-mail sem cadastro, usuário inativo, empresa inativa: MESMA resposta, nenhum e-mail", async () => {
    const certo = await esqueci({ email: "ana@x.com" });
    for (const e of ["ninguem@x.com", "beto@x.com", "caio@x.com"]) {
      expect(await esqueci({ email: e })).toEqual(certo);
    }
    await rodarDepois();
    expect(email.enviados.map((x) => x.para)).toEqual(["ana@x.com"]);
  });

  it("maiúsculas não importam; e-mail não configurado: mesma resposta, só um aviso no log (sem o link)", async () => {
    email.ok = false;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const certo = await esqueci({ email: "ninguem@x.com" });
    expect(await esqueci({ email: "  ANA@X.com " })).toEqual(certo);
    await rodarDepois();
    expect(email.enviados.map((x) => x.para)).toEqual(["ana@x.com"]);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).not.toMatch(/token|definir-senha/);
  });

  it("o link usa a URL configurada do sistema, não o Host de quem pediu", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.frivo.com.br");
    await esqueci({ email: "ana@x.com" }, { url: "http://golpe.example/api/publico/esqueci-senha" });
    await rodarDepois();
    expect(linkDoEmail().origin).toBe("https://app.frivo.com.br");
    vi.unstubAllEnvs();
  });

  it("limite: 3 pedidos por e-mail por hora (cadastrado ou não, igual); 10 por IP", async () => {
    for (const e of ["ana@x.com", "ninguem@x.com"]) {
      for (let i = 0; i < 3; i++) expect((await esqueci({ email: e })).status).toBe(200);
      expect(await esqueci({ email: e })).toEqual({ status: 429, json: { erro: "Muitos pedidos seguidos. Aguarde 60 min e tente de novo." } });
    }
    await rodarDepois();
    expect(email.enviados).toHaveLength(3);
    for (let i = 0; i < 4; i++) await esqueci({ email: `outro${i}@x.com` }); // 10 do mesmo IP no total
    expect((await esqueci({ email: "mais1@x.com" })).status).toBe(429);
    expect((await esqueci({ email: "mais1@x.com" }, { ip: "177.7.7.7" })).status).toBe(200);
    avancar(HORA + 1);
    expect((await esqueci({ email: "ana@x.com" })).status).toBe(200);
  });

  it("e-mail inválido ou campo a mais: 400", async () => {
    expect((await esqueci({ email: "nao-e-email" })).status).toBe(400);
    expect((await esqueci({ email: "ana@x.com", empresaId: "e2" })).status).toBe(400);
    expect((await esqueci(null)).status).toBe(400);
  });

  it("é rota pública no middleware (e a página também)", async () => {
    const fonte = await import("node:fs").then((fs) => fs.readFileSync("middleware.ts", "utf8"));
    expect(fonte).toMatch(/"\/esqueci-senha"/);
    expect(fonte).toMatch(/"\/api\/publico\/"/);
  });
});

describe("link de nova senha", () => {
  async function pedirLink() {
    await esqueci({ email: "ana@x.com" });
    await rodarDepois();
    return linkDoEmail().searchParams.get("token")!;
  }

  it("define a senha (regra forte), grava hash e o link morre: uso único", async () => {
    const token = await pedirLink();
    expect((await definir("POST", token, { senha: "abcdefgh", confirmar: "abcdefgh" })).json.erro).toBe("A senha precisa ter pelo menos um número.");
    expect((await definir("POST", token, { senha: "1234567", confirmar: "1234567" })).json.erro).toBe("A senha precisa ter pelo menos 8 caracteres.");
    expect((await definir("POST", token, { senha: "Nova-senha9", confirmar: "Nova-senha8" })).status).toBe(400);
    expect(await definir("POST", token, { senha: "Nova-senha9", confirmar: "Nova-senha9" })).toEqual({ status: 200, json: { ok: true, email: "ana@x.com" } });
    expect(ana().senha).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("Nova-senha9", ana().senha)).toBe(true);

    const reuso = await definir("POST", token, { senha: "Outra-senha1", confirmar: "Outra-senha1" });
    expect(reuso.status).toBe(400);
    expect(reuso.json.erro).toMatch(/já foi usado.*Esqueci minha senha/);
    expect((await definir("GET", token)).json.erro).toMatch(/já foi usado/);
    expect(await bcrypt.compare("Nova-senha9", ana().senha)).toBe(true);
  });

  it("expira em 1 hora", async () => {
    const token = await pedirLink();
    avancar(59 * 60_000);
    expect((await definir("GET", token)).status).toBe(200);
    avancar(2 * 60_000);
    const r = await definir("POST", token, { senha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect(r).toEqual({ status: 400, json: { erro: expect.stringMatching(/expirou \(vale 60 minutos\).*Esqueci minha senha/) } });
    expect(await bcrypt.compare(SENHA_ANA, ana().senha)).toBe(true);
  });

  it("adulterado (ex.: trocar o usuário) não vale; o convite segue com 72 h", async () => {
    const token = await pedirLink();
    const [corpo, assinatura] = token.split(".");
    const outro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, "base64url").toString()), u: "u3" })).toString("base64url");
    expect((await definir("GET", `${outro}.${assinatura}`)).json.erro).toMatch(/Link inválido.*Esqueci minha senha/);
    const { gerarTokenConvite, verificarTokenConvite } = await import("@/lib/usuarios/convite");
    const convite = gerarTokenConvite(ana() as { id: string; senha: string });
    expect(await verificarTokenConvite(convite, Date.now() + 71 * HORA)).toMatchObject({ ok: true, finalidade: "convite" });
  });

  it("a senha nova encerra as sessões abertas com a antiga e zera o bloqueio do login", async () => {
    const aberta = await entrar("ana@x.com", SENHA_ANA, { lembrar: true });
    for (let i = 0; i < 5; i++) await entrar("ana@x.com", "errada-123");
    expect((await entrar("ana@x.com", SENHA_ANA)).code).toBe("bloqueado-15");

    await definir("POST", await pedirLink(), { senha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect((await lerSessao(aberta.cookie)).sessao).toBeNull();
    expect((await entrar("ana@x.com", SENHA_ANA)).code).toBe("credentials");
    expect((await entrar("ana@x.com", "Nova-senha9")).ok).toBe(true);
  });

  it("sessão aberta antes desta versão passa a levar a impressão da senha — e também cai na troca", async () => {
    const antigo = `${COOKIE}=${await encode({ salt: COOKIE, secret: SEGREDO, token: { sub: "u1", id: "u1", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "OPERADOR", permissoes: {} } })}`;
    const lida = await lerSessao(antigo);
    expect(lida.sessao?.user?.id).toBe("u1");
    expect((await tokenDo(lida.cookie))?.fs).toEqual(expect.any(String));
    await definir("POST", await pedirLink(), { senha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect((await lerSessao(lida.cookie)).sessao).toBeNull();
  });
});

// ═════════════════════════ 4. Troca de senha no perfil ═════════════════════════
describe("troca de senha (Meu perfil › Segurança)", () => {
  async function trocar(corpo: unknown, cookie = "") {
    const { PATCH } = await import("@/app/api/perfil/senha/route");
    const res = await PATCH(new NextRequest("http://localhost/api/perfil/senha", {
      method: "PATCH", body: JSON.stringify(corpo), headers: { "content-type": "application/json", cookie },
    }));
    const novo = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`)) ?? "";
    return { status: res.status, json: await res.json(), cookie: novo.split(";")[0], setCookie: novo };
  }
  const logarAna = () => { sessao.atual = { user: { id: "u1", empresaId: "e1", role: "OPERADOR", permissoes: {} } }; };

  it("sem sessão: 401", async () => {
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).status).toBe(401);
  });

  it("exige a senha atual certa; nada muda com ela errada", async () => {
    logarAna();
    const r = await trocar({ senhaAtual: "errada-123", novaSenha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect(r).toMatchObject({ status: 400, json: { erro: "Senha atual incorreta." } });
    expect(ana().senha).toBe(HASH_ANA);
  });

  it("regra forte, confirmação e diferente da atual; usuário/empresa no corpo são recusados", async () => {
    logarAna();
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "curta1", confirmar: "curta1" })).json.erro).toMatch(/pelo menos 8/);
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "somenteletras", confirmar: "somenteletras" })).json.erro).toMatch(/número/);
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "12345678", confirmar: "12345678" })).json.erro).toMatch(/letra/);
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha8" })).json.erro).toMatch(/confirmação/);
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: SENHA_ANA, confirmar: SENHA_ANA })).json.erro).toMatch(/diferente da atual/);
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9", usuarioId: "u3" })).status).toBe(400);
    expect(ana().senha).toBe(HASH_ANA);
  });

  it("grava o HASH (bcrypt) da nova; a antiga deixa de entrar", async () => {
    logarAna();
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).json).toEqual({ ok: true });
    expect(ana().senha).not.toContain("Nova-senha9");
    expect(ana().senha).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("Nova-senha9", ana().senha)).toBe(true);
    expect((await entrar("ana@x.com", SENHA_ANA)).ok).toBe(false);
    expect((await entrar("ana@x.com", "Nova-senha9")).ok).toBe(true);
  });

  it("quem trocou segue conectado (cookie regravado); a sessão do outro aparelho cai", async () => {
    const aqui = await entrar("ana@x.com", SENHA_ANA, { lembrar: false });
    const celular = await entrar("ana@x.com", SENHA_ANA, { lembrar: true });
    logarAna();
    avancar(HORA);
    const r = await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" }, aqui.cookie);
    expect(r.status).toBe(200);
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).not.toMatch(/; Secure/i); // http local: igual ao cookie do Auth.js
    expect(await tokenDo(r.cookie)).toMatchObject({ id: "u1", lembrar: false, loginEm: T0 }); // mantém a escolha e o prazo
    expect((await lerSessao(r.cookie)).sessao?.user?.id).toBe("u1");
    expect((await lerSessao(celular.cookie)).sessao).toBeNull();
    expect((await lerSessao(aqui.cookie)).sessao).toBeNull(); // o cookie velho deste aparelho também não vale mais
  });

  it("acertar a senha atual zera os erros anteriores", async () => {
    logarAna();
    for (let i = 0; i < 4; i++) await trocar({ senhaAtual: "chute-123", novaSenha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).status).toBe(200);
    for (let i = 0; i < 4; i++) await trocar({ senhaAtual: "chute-123", novaSenha: "Outra-senha1", confirmar: "Outra-senha1" });
    expect((await trocar({ senhaAtual: "Nova-senha9", novaSenha: "Outra-senha1", confirmar: "Outra-senha1" })).status).toBe(200);
  });

  it("em produção (https) o cookie regravado mantém o nome __Secure- e a marca Secure", async () => {
    const { regravarSessaoAtual } = await import("@/lib/acesso/sessao-cookie");
    const { NextResponse } = await import("next/server");
    const nome = "__Secure-authjs.session-token";
    const valor = await encode({ salt: nome, secret: SEGREDO, token: { id: "u1", fs: "velha" } });
    const res = NextResponse.json({ ok: true });
    const req = new NextRequest("https://app.frivo.com.br/api/perfil/senha", { headers: { cookie: `${nome}=${valor}` } });
    expect(await regravarSessaoAtual(req, res, (t) => ({ ...t, fs: "nova" }))).toBe(true);
    const sc = res.headers.getSetCookie()[0];
    expect(sc).toMatch(/^__Secure-authjs\.session-token=/);
    expect(sc).toMatch(/; Secure/i);
    expect(await decode({ token: sc.split(";")[0].slice(nome.length + 1), secret: SEGREDO, salt: nome })).toMatchObject({ id: "u1", fs: "nova" });
    // sem sessão no pedido: não grava nada
    const vazio = NextResponse.json({});
    expect(await regravarSessaoAtual(new NextRequest("https://app.frivo.com.br/x"), vazio, (t) => t)).toBe(false);
    expect(vazio.headers.getSetCookie()).toEqual([]);
  });

  it("5 erros na senha atual bloqueiam a troca por 15 min (quem pegou a sessão aberta não fica chutando)", async () => {
    logarAna();
    for (let i = 0; i < 5; i++) expect((await trocar({ senhaAtual: "chute-123", novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).status).toBe(400);
    const r = await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" });
    expect(r).toMatchObject({ status: 429, json: { erro: expect.stringMatching(/Aguarde 15 min/) } });
    expect(ana().senha).toBe(HASH_ANA);
    avancar(15 * 60_000 + 1);
    expect((await trocar({ senhaAtual: SENHA_ANA, novaSenha: "Nova-senha9", confirmar: "Nova-senha9" })).status).toBe(200);
  });
});

// ═════════════════════════ 5. Logout ═════════════════════════
describe("logout", () => {
  it("sair apaga o cookie da sessão; sem ele, o middleware manda para o login", async () => {
    const r = await entrar("ana@x.com", SENHA_ANA, { lembrar: true });
    const c = await handlers.GET(new NextRequest("http://localhost/api/auth/csrf"));
    const { csrfToken } = await c.json();
    const cookieCsrf = c.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
    const res = await handlers.POST(new NextRequest("http://localhost/api/auth/signout", {
      method: "POST", body: new URLSearchParams({ csrfToken, callbackUrl: "http://localhost/login" }),
      headers: { "content-type": "application/x-www-form-urlencoded", "x-auth-return-redirect": "1", cookie: `${cookieCsrf}; ${r.cookie}` },
    }));
    const apagado = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE}=`))!;
    expect(apagado).toMatch(new RegExp(`^${COOKIE.replace(".", "\\.")}=;`));
    expect(apagado).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect((await res.json()).url).toBe("http://localhost/login");

    const { default: middleware } = await import("@/middleware");
    const depoisDeSair = (await (middleware as any)(new NextRequest("http://localhost/dashboard"), {})) as Response;
    expect(depoisDeSair.headers.get("location")).toBe("http://localhost/login?callbackUrl=%2Fdashboard");
  });

  it("os botões Sair chamam o signOut do Auth.js", async () => {
    const fs = await import("node:fs");
    for (const f of ["components/layout/sidebar.tsx", "components/layout/header.tsx"]) {
      expect(fs.readFileSync(f, "utf8")).toMatch(/signOut\(\{ callbackUrl: "\/login" \}\)/);
    }
  });
});
