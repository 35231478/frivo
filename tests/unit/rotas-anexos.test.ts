/**
 * Testes das rotas de anexo com banco e sessão simulados (sem Postgres).
 * Cobrem o item C1 da auditoria: anexo não pode virar HTML/script servido pelo painel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HTML, PNG, SVG, dataUrl } from "./arquivos-exemplo";

const db = vi.hoisted(() => ({
  osAnexo: { findFirst: vi.fn(), create: vi.fn() },
  osHistorico: { create: vi.fn() },
  usuario: { findFirst: vi.fn() },
  ordemServico: { count: vi.fn(), create: vi.fn() },
  unidade: { findFirst: vi.fn() },
  equipamento: { findFirst: vi.fn() },
}));
const portal = vi.hoisted(() => ({ sessao: null as any }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/os-server", () => ({ osDaEmpresa: vi.fn(async () => true), proximoNumeroOs: vi.fn(async () => "OS-2026-0001") }));
vi.mock("@/lib/permissoes-server", () => ({
  exigirPermissao: vi.fn(async () => ({ erro: false, session: { user: { id: "u1", empresaId: "e1" } } })),
}));
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => portal.sessao) }));

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  db.osAnexo.create.mockImplementation(async ({ data }: any) => ({ id: "a1", nome: data.nome, tipo: data.tipo, tamanho: data.tamanho }));
});

describe("GET /api/ordens/[id]/anexos/[anexoId]", () => {
  async function baixar(conteudo: string, nome: string, inline = true) {
    db.osAnexo.findFirst.mockResolvedValue({ id: "a1", nome, tipo: "image/png", conteudo });
    const { GET } = await import("@/app/api/ordens/[id]/anexos/[anexoId]/route");
    const req = new NextRequest(`http://localhost/api/ordens/os1/anexos/a1${inline ? "?inline=1" : ""}`);
    return GET(req, params({ id: "os1", anexoId: "a1" }));
  }

  it("anexo HTML antigo (vindo do portal) não é servido como página", async () => {
    const r = await baixar(dataUrl("text/html", HTML), "foto.png");
    expect(r.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("SVG com script não abre inline", async () => {
    const r = await baixar(dataUrl("image/svg+xml", SVG), "planta.svg");
    expect(r.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  it("foto continua abrindo no navegador", async () => {
    const r = await baixar(dataUrl("image/png", PNG), "foto.png");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/png");
    expect(r.headers.get("Content-Disposition")).toMatch(/^inline;/);
  });
});

describe("POST /api/ordens/[id]/anexos", () => {
  async function enviar(bytes: Uint8Array, nome: string, tipoDeclarado: string) {
    const fd = new FormData();
    fd.append("arquivo", new File([new Uint8Array(bytes)], nome, { type: tipoDeclarado }));
    const { POST } = await import("@/app/api/ordens/[id]/anexos/route");
    const req = new NextRequest("http://localhost/api/ordens/os1/anexos", { method: "POST", body: fd });
    return POST(req, params({ id: "os1" }));
  }

  it("recusa HTML declarado como image/png", async () => {
    const r = await enviar(HTML, "foto.png", "image/png");
    expect(r.status).toBe(400);
    expect(db.osAnexo.create).not.toHaveBeenCalled();
  });

  it("recusa SVG", async () => {
    const r = await enviar(SVG, "planta.svg", "image/svg+xml");
    expect(r.status).toBe(400);
    expect(db.osAnexo.create).not.toHaveBeenCalled();
  });

  it("aceita foto e grava o tipo detectado (não o declarado)", async () => {
    const r = await enviar(PNG, "foto.png", "application/octet-stream");
    expect(r.status).toBe(201);
    const data = db.osAnexo.create.mock.calls[0][0].data;
    expect(data.tipo).toBe("image/png");
    expect(data.conteudo.startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("POST /api/portal/chamados (fotos do cliente)", () => {
  beforeEach(() => {
    portal.sessao = { user: { id: "c1", clienteId: "cli1", empresaId: "e1", name: "Cliente", permissoes: { abrirChamados: true } } };
    db.usuario.findFirst.mockResolvedValue({ id: "u1" });
    db.ordemServico.count.mockResolvedValue(0);
    db.ordemServico.create.mockResolvedValue({ id: "os1" });
  });

  async function abrir(fotos: { nome: string; tipo: string; tamanho: number; conteudo: string }[]) {
    const { POST } = await import("@/app/api/portal/chamados/route");
    const req = new NextRequest("http://localhost/api/portal/chamados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descricao: "Ar-condicionado pingando", urgencia: "NORMAL", fotos }),
    });
    return POST(req);
  }

  it("recusa 'foto' que é HTML (o ataque do item C1)", async () => {
    const r = await abrir([{ nome: "a.png", tipo: "image/png", tamanho: 1, conteudo: dataUrl("text/html", HTML) }]);
    expect(r.status).toBe(400);
    expect(db.ordemServico.create).not.toHaveBeenCalled();
  });

  it("recusa PDF (portal aceita só fotos)", async () => {
    const r = await abrir([{ nome: "a.pdf", tipo: "application/pdf", tamanho: 1, conteudo: dataUrl("application/pdf", new TextEncoder().encode("%PDF-1.7")) }]);
    expect(r.status).toBe(400);
  });

  it("recusa mais de 6 fotos", async () => {
    const foto = { nome: "a.png", tipo: "image/png", tamanho: PNG.length, conteudo: dataUrl("image/png", PNG) };
    const r = await abrir(Array(7).fill(foto));
    expect(r.status).toBe(400);
  });

  it("aceita foto e grava com o tipo real", async () => {
    const r = await abrir([{ nome: "a.png", tipo: "text/html", tamanho: 1, conteudo: dataUrl("image/png", PNG) }]);
    expect(r.status).toBe(201);
    const anexos = db.ordemServico.create.mock.calls[0][0].data.anexos.create;
    expect(anexos).toHaveLength(1);
    expect(anexos[0].tipo).toBe("image/png");
    expect(anexos[0].conteudo.startsWith("data:image/png;base64,")).toBe(true);
  });
});
