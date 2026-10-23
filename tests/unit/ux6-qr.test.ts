/**
 * UX-6 "QR completo" — PostgreSQL real (schema descartável), rota pública do chamado do QR:
 *  - C2: o chamado anônimo aceita FOTOS (validadas pelo conteúdo, como no portal) e elas
 *    ficam anexadas na OS; arquivo que não é imagem é recusado SEM criar OS;
 *  - Y17: `contatoOrigemId` quando identificável — e-mail de contato ATIVO do MESMO cliente
 *    identifica a origem; e-mail desconhecido ou de OUTRO cliente não; logado continua valendo;
 *  - limite de 6 fotos respeitado.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/ux6-qr
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_ux6_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

// Anônimo por padrão; cada teste pode "logar" trocando o valor
const sessaoPortal = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => sessaoPortal.atual) }));

vi.setConfig({ testTimeout: 60_000 });

// PNG 1×1 de verdade: passa na validação por CONTEÚDO (magic bytes)
const PNG_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const foto = (nome = "problema.png", conteudo = PNG_1x1) => ({ nome, tipo: "image/png", tamanho: 100, conteudo });

describe.skipIf(!URL_PG)("UX-6 — chamado do QR com foto e origem identificada (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Gestor", email: "g@x.com", senha: "hash", role: "ADMIN" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11.111.111/0001-11", portalAtivo: true },
      { id: "c2", empresaId: "e1", nome: "Outro Cliente", cpfCnpj: "22.222.222/0001-22" },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.equipamento.create({ data: { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTX" } });
    await prisma.qrcode.create({ data: { id: "qr1", empresaId: "e1", codigo: "QR-001", equipamentoId: "eq1", tokenPublico: "tok-ux6" } });
    await prisma.contatoCliente.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", nome: "Maria", email: "maria@hospital.com", ativo: true },
      { id: "ct2", empresaId: "e1", clienteId: "c1", nome: "Inativa", email: "inativa@hospital.com", ativo: false },
      { id: "ct3", empresaId: "e1", clienteId: "c2", nome: "De Outro Cliente", email: "outro@cliente.com", ativo: true },
    ] });
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  const chamar = async (corpo: unknown, ip = "10.1.1.1") => {
    const { POST } = await import("@/app/api/qr/[token]/chamado/route");
    const res = await POST(
      new NextRequest("http://localhost/api/qr/tok-ux6/chamado", {
        method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(corpo),
      }),
      { params: Promise.resolve({ token: "tok-ux6" }) },
    );
    return { status: res.status, json: await res.json() };
  };
  const base = { tipo: "CHAMADO", nome: "Visitante", descricao: "Equipamento pingando muito na recepção" };

  it("C2: chamado anônimo COM foto cria a OS com o anexo (validado pelo conteúdo)", async () => {
    const r = await chamar({ ...base, fotos: [foto()] });
    expect(r.status).toBe(201);
    const os = await prisma.ordemServico.findFirst({ where: { chamadoNumero: r.json.chamadoNumero }, include: { anexos: true } });
    expect(os.anexos).toHaveLength(1);
    expect(os.anexos[0].tipo).toBe("image/png");
    expect(os.contatoOrigemId).toBeNull(); // sem e-mail: anônimo de verdade
  });

  it("C2: arquivo que NÃO é imagem é recusado sem criar OS; mais de 6 fotos idem", async () => {
    const antes = await prisma.ordemServico.count();
    const falso = await chamar({ ...base, fotos: [foto("nota.png", "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64"))] });
    expect(falso.status).toBe(400);
    const demais = await chamar({ ...base, fotos: Array.from({ length: 7 }, (_, i) => foto(`f${i}.png`)) });
    expect(demais.status).toBe(400);
    expect(await prisma.ordemServico.count()).toBe(antes);
  });

  it("Y17: e-mail de contato ATIVO do MESMO cliente identifica a origem; de outro cliente ou inativo, não", async () => {
    const conhecido = await chamar({ ...base, email: "MARIA@hospital.com" }, "10.1.1.2");
    expect(conhecido.status).toBe(201);
    expect((await prisma.ordemServico.findFirst({ where: { chamadoNumero: conhecido.json.chamadoNumero } })).contatoOrigemId).toBe("ct1");

    const deOutro = await chamar({ ...base, email: "outro@cliente.com" }, "10.1.1.3");
    expect((await prisma.ordemServico.findFirst({ where: { chamadoNumero: deOutro.json.chamadoNumero } })).contatoOrigemId).toBeNull();

    const inativa = await chamar({ ...base, email: "inativa@hospital.com" }, "10.1.1.4");
    expect((await prisma.ordemServico.findFirst({ where: { chamadoNumero: inativa.json.chamadoNumero } })).contatoOrigemId).toBeNull();

    const desconhecido = await chamar({ ...base, email: "ninguem@x.com" }, "10.1.1.5");
    expect((await prisma.ordemServico.findFirst({ where: { chamadoNumero: desconhecido.json.chamadoNumero } })).contatoOrigemId).toBeNull();
  });

  it("Y17: contato LOGADO do mesmo cliente segue identificado pela sessão (não pelo e-mail digitado)", async () => {
    sessaoPortal.atual = { user: { id: "ct1", empresaId: "e1", clienteId: "c1", permissoes: { abrirChamados: true } } };
    try {
      const r = await chamar({ ...base, email: "ninguem@x.com" }, "10.1.1.6");
      expect(r.status).toBe(201);
      expect((await prisma.ordemServico.findFirst({ where: { chamadoNumero: r.json.chamadoNumero } })).contatoOrigemId).toBe("ct1");
    } finally { sessaoPortal.atual = null; }
  });
});
