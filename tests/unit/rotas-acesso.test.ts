/**
 * Rotas da Leva 2 com banco e sessão simulados (sem Postgres):
 * - C2: a senha do portal não sai da API nem fica gravada em texto;
 * - C3: ninguém altera o próprio perfil nem concede mais acesso do que tem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const db = vi.hoisted(() => ({
  usuario: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  perfilAcesso: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  contatoCliente: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  cliente: { update: vi.fn() },
}));
const sessao = vi.hoisted(() => ({ atual: null as any }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
// A checagem de permissão real (permissoes-server) roda; só a sessão é simulada.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

function logar(role: string, permissoes: Permissoes, id = "eu") {
  sessao.atual = { user: { id, empresaId: "e1", role, permissoes } };
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

// Supervisor com permissão de gerenciar configurações (cenário de autopromoção)
const SUPERVISOR_CONFIG: Permissoes = { ...PRESETS.SUPERVISOR, configuracoes: { visualizar: true, gerenciar: true } };

beforeEach(() => {
  vi.clearAllMocks();
  db.usuario.update.mockImplementation(async ({ data }: any) => ({ id: "outro", ...data }));
  db.perfilAcesso.create.mockImplementation(async ({ data }: any) => ({ id: "novo", ...data }));
  db.perfilAcesso.update.mockImplementation(async ({ data }: any) => ({ id: "p1", ...data }));
});

describe("PUT /api/usuarios/[id] (C3)", () => {
  async function vincular(alvoId: string, perfilAcessoId: string | null) {
    const { PUT } = await import("@/app/api/usuarios/[id]/route");
    return PUT(json(`http://localhost/api/usuarios/${alvoId}`, "PUT", { perfilAcessoId }), params({ id: alvoId }));
  }

  it("ninguém altera o próprio perfil (nem para 'sem perfil')", async () => {
    logar("GERENTE", SUPERVISOR_CONFIG, "eu");
    const r = await vincular("eu", null);
    expect(r.status).toBe(403);
    expect(db.usuario.update).not.toHaveBeenCalled();
  });

  it("não-admin não atribui o perfil Administrador a outra pessoa", async () => {
    logar("GERENTE", SUPERVISOR_CONFIG);
    db.usuario.findFirst.mockResolvedValue({ id: "outro", role: "OPERADOR", perfilAcesso: { ativo: true, permissoes: PRESETS.TECNICO } });
    db.perfilAcesso.findFirst.mockResolvedValue({ permissoes: PRESETS.ADMINISTRADOR });
    const r = await vincular("outro", "perfil-admin");
    expect(r.status).toBe(403);
    expect(db.usuario.update).not.toHaveBeenCalled();
  });

  it("não-admin não mexe em quem tem mais acesso que ele", async () => {
    logar("GERENTE", SUPERVISOR_CONFIG);
    db.usuario.findFirst.mockResolvedValue({ id: "outro", role: "GERENTE", perfilAcesso: { ativo: true, permissoes: PRESETS.ADMINISTRADOR } });
    const r = await vincular("outro", null);
    expect(r.status).toBe(403);
  });

  it("perfil de outra empresa ou inativo é recusado", async () => {
    logar("ADMIN", permissoesTotais());
    db.usuario.findFirst.mockResolvedValue({ id: "outro", role: "OPERADOR", perfilAcesso: null });
    db.perfilAcesso.findFirst.mockResolvedValue(null);
    const r = await vincular("outro", "perfil-de-outra-empresa");
    expect(r.status).toBe(400);
    expect(db.perfilAcesso.findFirst.mock.calls[0][0].where).toMatchObject({ empresaId: "e1", ativo: true });
  });

  it("não-admin atribui perfil menor que o seu", async () => {
    logar("GERENTE", SUPERVISOR_CONFIG);
    db.usuario.findFirst.mockResolvedValue({ id: "outro", role: "OPERADOR", perfilAcesso: null });
    db.perfilAcesso.findFirst.mockResolvedValue({ permissoes: PRESETS.TECNICO });
    const r = await vincular("outro", "perfil-tecnico");
    expect(r.status).toBe(200);
    expect(db.usuario.update.mock.calls[0][0].data).toEqual({ perfilAcessoId: "perfil-tecnico" });
  });

  it("admin atribui o perfil Administrador", async () => {
    logar("ADMIN", permissoesTotais());
    db.usuario.findFirst.mockResolvedValue({ id: "outro", role: "OPERADOR", perfilAcesso: null });
    db.perfilAcesso.findFirst.mockResolvedValue({ permissoes: PRESETS.ADMINISTRADOR });
    expect((await vincular("outro", "perfil-admin")).status).toBe(200);
  });
});

describe("perfis de acesso (C3)", () => {
  it("não-admin não cria perfil com acessos que não tem", async () => {
    logar("GERENTE", SUPERVISOR_CONFIG);
    const { POST } = await import("@/app/api/perfis-acesso/route");
    const r = await POST(json("http://localhost/api/perfis-acesso", "POST", { nome: "Tudo", permissoes: PRESETS.ADMINISTRADOR }));
    expect(r.status).toBe(403);
    expect(db.perfilAcesso.create).not.toHaveBeenCalled();
  });

  it("não-admin não edita o perfil ao qual está vinculado", async () => {
    logar("GERENTE", SUPERVISOR_CONFIG);
    db.perfilAcesso.findFirst.mockResolvedValue({ id: "meu-perfil", permissoes: SUPERVISOR_CONFIG });
    db.usuario.findUnique.mockResolvedValue({ perfilAcessoId: "meu-perfil" });
    const { PUT } = await import("@/app/api/perfis-acesso/[id]/route");
    const r = await PUT(json("http://localhost/api/perfis-acesso/meu-perfil", "PUT", { permissoes: PRESETS.ADMINISTRADOR }), params({ id: "meu-perfil" }));
    expect(r.status).toBe(403);
    expect(db.perfilAcesso.update).not.toHaveBeenCalled();
  });

  it("não-admin não amplia outro perfil além do que ele tem", async () => {
    logar("GERENTE", SUPERVISOR_CONFIG);
    db.perfilAcesso.findFirst.mockResolvedValue({ id: "p-tec", permissoes: PRESETS.TECNICO });
    db.usuario.findUnique.mockResolvedValue({ perfilAcessoId: "meu-perfil" });
    const { PUT } = await import("@/app/api/perfis-acesso/[id]/route");
    const r = await PUT(json("http://localhost/api/perfis-acesso/p-tec", "PUT", { permissoes: PRESETS.FINANCEIRO }), params({ id: "p-tec" }));
    expect(r.status).toBe(403);
  });

  it("admin edita qualquer perfil", async () => {
    logar("ADMIN", permissoesTotais());
    db.perfilAcesso.findFirst.mockResolvedValue({ id: "p1", permissoes: PRESETS.TECNICO });
    const { PUT } = await import("@/app/api/perfis-acesso/[id]/route");
    const r = await PUT(json("http://localhost/api/perfis-acesso/p1", "PUT", { permissoes: PRESETS.FINANCEIRO }), params({ id: "p1" }));
    expect(r.status).toBe(200);
  });
});

describe("contatos e acesso ao portal (C2)", () => {
  const contatoNoBanco = { id: "c1", nome: "Ana", email: "ana@cliente.com", senha: "$2a$12$hashsecreto", senhaProvisoria: "abc12345", acessoConcedidoEm: null };

  it("GET de contatos (perfil que só visualiza) não devolve hash nem senha em texto", async () => {
    logar("OPERADOR", PRESETS.FINANCEIRO);
    db.contatoCliente.findMany.mockResolvedValue([contatoNoBanco]);
    const { GET } = await import("@/app/api/clientes/[id]/contatos/route");
    const r = await GET(json("http://localhost/api/clientes/cli1/contatos", "GET"), params({ id: "cli1" }));
    const corpo = await r.json();
    const texto = JSON.stringify(corpo);
    expect(texto).not.toContain("hashsecreto");
    expect(texto).not.toContain("abc12345");
    expect(corpo[0]).toMatchObject({ id: "c1", temAcesso: true });
    expect(corpo[0]).not.toHaveProperty("senha");
    expect(corpo[0]).not.toHaveProperty("senhaProvisoria");
  });

  it("definir senha grava só o hash e devolve a senha só nesta resposta", async () => {
    logar("ADMIN", permissoesTotais());
    db.contatoCliente.findFirst.mockResolvedValueOnce({ ...contatoNoBanco, senha: null }).mockResolvedValueOnce(null);
    db.contatoCliente.update.mockImplementation(async ({ data }: any) => ({ id: "c1", email: data.email, permissoes: {}, senha: data.senha, acessoConcedidoEm: new Date() }));
    const { PUT } = await import("@/app/api/clientes/[id]/contatos/[contatoId]/acesso-portal/route");
    const r = await PUT(
      json("http://localhost/x", "PUT", { email: "ana@cliente.com", senha: "SenhaNova9", permissoes: {} }),
      params({ id: "cli1", contatoId: "c1" }),
    );
    expect(r.status).toBe(200);
    const gravado = db.contatoCliente.update.mock.calls[0][0].data;
    expect(gravado.senhaProvisoria).toBeNull();
    expect(gravado.senha).not.toBe("SenhaNova9");
    expect(await bcrypt.compare("SenhaNova9", gravado.senha)).toBe(true);
    const corpo = await r.json();
    expect(corpo.senhaProvisoria).toBe("SenhaNova9");
    expect(JSON.stringify(corpo)).not.toContain(gravado.senha);
  });

  it("redefinir gera senha forte, grava só o hash e limpa a senha em texto", async () => {
    logar("ADMIN", permissoesTotais());
    db.contatoCliente.findFirst.mockResolvedValue(contatoNoBanco);
    db.contatoCliente.update.mockImplementation(async ({ data }: any) => ({ id: "c1", email: "ana@cliente.com", acessoConcedidoEm: data.acessoConcedidoEm }));
    const { POST } = await import("@/app/api/clientes/[id]/contatos/[contatoId]/acesso-portal/route");
    const r = await POST(json("http://localhost/x", "POST"), params({ id: "cli1", contatoId: "c1" }));
    const corpo = await r.json();
    const gravado = db.contatoCliente.update.mock.calls[0][0].data;
    expect(corpo.senhaProvisoria).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(gravado.senhaProvisoria).toBeNull();
    expect(await bcrypt.compare(corpo.senhaProvisoria, gravado.senha)).toBe(true);
  });

  it("revogar apaga hash e senha em texto", async () => {
    logar("ADMIN", permissoesTotais());
    db.contatoCliente.findFirst.mockResolvedValue(contatoNoBanco);
    const { DELETE } = await import("@/app/api/clientes/[id]/contatos/[contatoId]/acesso-portal/route");
    await DELETE(json("http://localhost/x", "DELETE"), params({ id: "cli1", contatoId: "c1" }));
    expect(db.contatoCliente.update.mock.calls[0][0].data).toEqual({ senha: null, senhaProvisoria: null });
  });
});
