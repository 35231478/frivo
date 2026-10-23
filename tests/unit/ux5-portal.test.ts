/**
 * UX-5 "Portal que cobra sozinho" — PostgreSQL real (schema descartável).
 *  - Y13: token de recuperação do PORTAL (assinado, 1 h, uso único): válido define a senha
 *    (bcrypt) e zera a senha provisória; adulterado/expirado/revogado não; o MESMO link não
 *    vale duas vezes; token de USUÁRIO INTERNO nunca vale no portal (e vice-versa);
 *  - rotas públicas: /api/portal/esqueci-senha responde SEMPRE igual (exista ou não o e-mail),
 *    com limite por e-mail/IP; /api/portal/definir-senha recusa senha fraca e token ruim;
 *  - o envio só alcança contato ATIVO com acesso e portal ligado (e-mail capturado no mock);
 *  - Y12: o login do portal devolve o e-mail digitado junto com o erro (a tela preserva).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/ux5-portal
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_ux5_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const emails = vi.hoisted(() => ({ enviados: [] as { para: string; variaveis: Record<string, string> }[] }));
vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async (_empresaId: string, p: any) => { emails.enviados.push({ para: p.para, variaveis: p.variaveis }); return { ok: true }; }),
}));
// `after` do Next não roda fora do runtime dele: guarda o trabalho para o teste disparar
const depois = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { depois.push(fn); } }));

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("UX-5 — portal que cobra sozinho (PostgreSQL real)", () => {
  let prisma: any;
  let rec: typeof import("@/lib/portal/recuperacao");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ??= "segredo-de-teste-ux5-0123456789";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    rec = await import("@/lib/portal/recuperacao");

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "11.111.111/0001-11", portalAtivo: true } });
    await prisma.contatoCliente.create({ data: {
      id: "ct1", empresaId: "e1", clienteId: "c1", nome: "Maria Gestora", email: "maria@hospital.com",
      senha: await bcrypt.hash("senha-antiga-1", 12), senhaProvisoria: "prov-123", ativo: true,
    } });
    // Sem acesso (senha null) e inativo: nunca recebem link
    await prisma.contatoCliente.create({ data: { id: "ct2", empresaId: "e1", clienteId: "c1", nome: "Sem Acesso", email: "sem@hospital.com", ativo: true } });
    await prisma.contatoCliente.create({ data: { id: "ct3", empresaId: "e1", clienteId: "c1", nome: "Inativa", email: "inativa@hospital.com", senha: "x", ativo: false } });
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  const contato = () => prisma.contatoCliente.findUnique({ where: { id: "ct1" } });

  it("Y13: token válido define a senha nova (bcrypt), zera a provisória e MORRE no segundo uso", async () => {
    const c = await contato();
    const token = rec.gerarTokenSenhaPortal({ id: c.id, senha: c.senha });

    const v = await rec.verificarTokenPortal(token);
    expect(v.ok).toBe(true);

    const r = await rec.definirSenhaPortal(token, "senha-nova-123");
    expect(r.ok).toBe(true);
    const depois = await contato();
    expect(depois.senha).not.toBe(c.senha);
    expect(await bcrypt.compare("senha-nova-123", depois.senha)).toBe(true);
    expect(depois.senhaProvisoria).toBeNull(); // a anotada para o gestor deixa de valer

    // Uso único: a impressão mudou, o mesmo link não vale mais
    const deNovo = await rec.verificarTokenPortal(token);
    expect(deNovo).toEqual({ ok: false, erro: "usado" });
  });

  it("Y13: adulterado, expirado, de usuário INTERNO e de contato revogado não valem", async () => {
    const c = await contato();
    const token = rec.gerarTokenSenhaPortal({ id: c.id, senha: c.senha });

    // Assinatura adulterada
    expect((await rec.verificarTokenPortal(token.slice(0, -2) + "zz")).ok).toBe(false);
    // Expirado (gerado 2 h no passado)
    const velho = rec.gerarTokenSenhaPortal({ id: c.id, senha: c.senha }, Date.now() - 2 * 3600_000);
    expect(await rec.verificarTokenPortal(velho)).toEqual({ ok: false, erro: "expirado" });

    // Token de USUÁRIO INTERNO (mesma assinatura HMAC, sem a marca do portal) NÃO entra
    await prisma.usuario.create({ data: { id: "uX", empresaId: "e1", nome: "Interna", email: "interna@x.com", senha: "hash", role: "ADMIN" } });
    const { gerarTokenSenha } = await import("@/lib/usuarios/convite");
    const interno = gerarTokenSenha({ id: "uX", senha: "hash" }, "recuperacao");
    expect((await rec.verificarTokenPortal(interno)).ok).toBe(false);
    // E o do portal não vale no fluxo interno
    const { verificarTokenConvite } = await import("@/lib/usuarios/convite");
    expect((await verificarTokenConvite(token)).ok).toBe(false);

    // Acesso revogado (senha null): o link antigo morre
    const antes = c.senha;
    await prisma.contatoCliente.update({ where: { id: c.id }, data: { senha: null } });
    expect((await rec.verificarTokenPortal(token)).ok).toBe(false);
    await prisma.contatoCliente.update({ where: { id: c.id }, data: { senha: antes } });
  });

  it("Y13: o envio alcança só contato ativo com acesso e portal ligado — e leva o link certo", async () => {
    emails.enviados.length = 0;
    expect(await rec.enviarRecuperacaoPortal("maria@hospital.com", "https://app.frivo.com.br")).toBe(1);
    expect(emails.enviados).toHaveLength(1);
    expect(emails.enviados[0].para).toBe("maria@hospital.com");
    const link = emails.enviados[0].variaveis.link_definir_senha;
    expect(link).toContain("https://app.frivo.com.br/portal/definir-senha?token=");
    // O link enviado de fato define a senha
    const token = decodeURIComponent(link.split("token=")[1]);
    expect((await rec.verificarTokenPortal(token)).ok).toBe(true);

    expect(await rec.enviarRecuperacaoPortal("sem@hospital.com", "https://x")).toBe(0);      // sem acesso
    expect(await rec.enviarRecuperacaoPortal("inativa@hospital.com", "https://x")).toBe(0);  // inativa
    expect(await rec.enviarRecuperacaoPortal("ninguem@x.com", "https://x")).toBe(0);         // não existe

    // Portal do cliente desligado: ninguém recebe
    await prisma.cliente.update({ where: { id: "c1" }, data: { portalAtivo: false } });
    expect(await rec.enviarRecuperacaoPortal("maria@hospital.com", "https://x")).toBe(0);
    await prisma.cliente.update({ where: { id: "c1" }, data: { portalAtivo: true } });
  });

  it("rotas públicas: esqueci-senha responde SEMPRE igual; definir-senha recusa senha fraca e token ruim", async () => {
    const esqueci = async (email: string, ip = "10.0.0.9") => {
      const { POST } = await import("@/app/api/portal/esqueci-senha/route");
      const res = await POST(new NextRequest("http://localhost/api/portal/esqueci-senha", {
        method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }),
      }));
      return { status: res.status, json: await res.json() };
    };

    emails.enviados.length = 0;
    const existe = await esqueci("maria@hospital.com");
    const naoExiste = await esqueci("fantasma@x.com", "10.0.0.10");
    expect(existe.status).toBe(200);
    expect(naoExiste.status).toBe(200);
    expect(existe.json.mensagem).toBe(naoExiste.json.mensagem); // nada revela quem tem acesso
    // O e-mail só sai DEPOIS da resposta (after) — e só para quem tem acesso
    for (const fn of depois.splice(0)) await fn();
    expect(emails.enviados.map((e) => e.para)).toEqual(["maria@hospital.com"]);

    const { POST: definir } = await import("@/app/api/portal/definir-senha/route");
    const chamarDefinir = async (corpo: unknown) => {
      const res = await definir(new NextRequest("http://localhost/api/portal/definir-senha", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      }));
      return { status: res.status, json: await res.json() };
    };
    const c = await contato();
    const token = rec.gerarTokenSenhaPortal({ id: c.id, senha: c.senha });
    const fraca = await chamarDefinir({ token, senha: "curta" });
    expect(fraca.status).toBe(400);
    const ruim = await chamarDefinir({ token: "abc.def", senha: "senha-valida-1" });
    expect(ruim.status).toBe(400);
    expect(ruim.json.erro).toContain("Link inválido");
    const ok = await chamarDefinir({ token, senha: "senha-valida-1" });
    expect(ok.status).toBe(200);
    expect(await bcrypt.compare("senha-valida-1", (await contato()).senha)).toBe(true);
  });

  it("Y12: o erro de login devolve o e-mail digitado (a tela preserva; a senha não volta)", async () => {
    vi.doMock("@/lib/auth-portal", async () => {
      const { AuthError } = await import("next-auth");
      return { portalSignIn: vi.fn(async () => { throw new AuthError("CredentialsSignin"); }), portalSignOut: vi.fn() };
    });
    const { portalLogin } = await import("@/app/(portal)/portal/actions");
    const fd = new FormData();
    fd.set("email", "maria@hospital.com");
    fd.set("senha", "senha-errada");
    const estado = await portalLogin({}, fd);
    expect(estado.erro).toContain("inválidos");
    expect(estado.email).toBe("maria@hospital.com");
    expect(JSON.stringify(estado)).not.toContain("senha-errada");
    vi.doUnmock("@/lib/auth-portal");
  });
});
