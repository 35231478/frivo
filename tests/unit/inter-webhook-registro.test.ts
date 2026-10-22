/**
 * Webhook do Inter — registro AUTOMÁTICO ao gerar a URL (rotas reais, Prisma real,
 * PostgreSQL real em schema descartável). Prova que:
 *  - com a integração ATIVA e completa (credenciais + certificado), gerar a URL chama
 *    configurarWebhookInter() com a MESMA URL devolvida à tela → registradoNoInter: true;
 *  - se o Inter recusa/cai, a resposta explica a pendência (registroPendente com o motivo)
 *    e o segredo novo CONTINUA valendo (o antigo já foi revogado — não há rollback);
 *  - integração desativada ou incompleta NÃO chama o Inter e explica exatamente o que falta;
 *  - salvar a configuração sem regerar não registra nada;
 *  - RBAC: técnico não gera webhook (403).
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/inter-webhook-registro
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, PRESETS } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_webhook_inter_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-para-criptografia";
process.env.NEXTAUTH_URL = "https://app.frivo.teste";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const inter = vi.hoisted(() => ({ configurar: vi.fn() }));
vi.mock("@/lib/inter-api", () => ({
  configurarWebhookInter: inter.configurar,
  consultarBoletoInter: vi.fn(),
  testarConexaoInter: vi.fn(),
}));

const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } }; };
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "j@x.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: null } }; };

async function chamar(metodo: string, corpo?: unknown) {
  const mod = await import("@/app/api/integracoes/inter/route");
  const req = new NextRequest("http://localhost/api/integracoes/inter", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await (mod as any)[metodo](req);
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Webhook do Inter: registro automático ao gerar a URL (PostgreSQL real)", () => {
  let prisma: any;
  let criptografar: (s: string) => string;

  /** Deixa a integração da e1 no estado desejado (sobrescreve credenciais/certificado). */
  async function configurarIntegracao(dados: { ativo: boolean; comCredenciais?: boolean; comCertificado?: boolean }) {
    const { ativo, comCredenciais = true, comCertificado = true } = dados;
    const data = {
      ativo,
      ambiente: "SANDBOX" as const,
      clientId: comCredenciais ? "cid-teste" : null,
      clientSecret: comCredenciais ? criptografar("secret-teste") : null,
      certificado: comCertificado ? criptografar("CERTIFICADO PEM") : null,
      chavePrivada: comCertificado ? criptografar("CHAVE PEM") : null,
    };
    await prisma.integracaoInter.upsert({ where: { empresaId: "e1" }, create: { empresaId: "e1", ...data }, update: data });
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ criptografar } = await import("@/lib/crypto"));

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" } });
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  beforeEach(() => { inter.configurar.mockReset(); comoAdmin(); });

  it("integração ativa e completa: gerar a URL REGISTRA no Inter com a mesma URL devolvida à tela", async () => {
    await configurarIntegracao({ ativo: true });
    inter.configurar.mockResolvedValueOnce(undefined);

    const r = await chamar("PUT", { regerarWebhook: true });
    expect(r.status).toBe(200);
    expect(r.json.webhookUrl).toMatch(/^https:\/\/app\.frivo\.teste\/api\/webhooks\/inter\?token=[0-9a-f]{64}$/);
    expect([r.json.registradoNoInter, r.json.registroPendente]).toEqual([true, null]);
    expect(inter.configurar).toHaveBeenCalledExactlyOnceWith("e1", r.json.webhookUrl);
  });

  it("Inter recusa/cai: a pendência volta com o MOTIVO e o segredo novo continua valendo (o antigo já era)", async () => {
    await configurarIntegracao({ ativo: true });
    inter.configurar.mockResolvedValueOnce(undefined);
    const antes = await chamar("PUT", { regerarWebhook: true });
    const secretAntigo = antes.json.webhookUrl.split("token=")[1];

    inter.configurar.mockRejectedValueOnce(new Error("Falha ao configurar webhook (401): credencial inválida"));
    const r = await chamar("PUT", { regerarWebhook: true });
    expect(r.status).toBe(200);
    expect(r.json.registradoNoInter).toBe(false);
    expect(r.json.registroPendente).toContain("Falha ao configurar webhook (401)");

    // Sem rollback: o segredo girou mesmo com o registro pendente (o antigo foi revogado)
    const secretNovo = r.json.webhookUrl.split("token=")[1];
    expect(secretNovo).not.toBe(secretAntigo);
    const reg = await prisma.integracaoInter.findUnique({ where: { empresaId: "e1" } });
    expect(reg.webhookSecret).toBe(secretNovo);
  });

  it("integração DESATIVADA: não chama o Inter e a pendência diz isso", async () => {
    await configurarIntegracao({ ativo: false });
    const r = await chamar("PUT", { regerarWebhook: true });
    expect(r.status).toBe(200);
    expect(r.json.webhookUrl).toBeTruthy(); // a URL existe do nosso lado mesmo assim
    expect(r.json.registradoNoInter).toBe(false);
    expect(r.json.registroPendente).toContain("desativada");
    expect(inter.configurar).not.toHaveBeenCalled();
  });

  it("sem certificado ou sem credenciais: não chama o Inter e a pendência NOMEIA o que falta", async () => {
    await configurarIntegracao({ ativo: true, comCertificado: false });
    const semCert = await chamar("PUT", { regerarWebhook: true });
    expect(semCert.json.registradoNoInter).toBe(false);
    expect(semCert.json.registroPendente).toContain("certificado");

    await configurarIntegracao({ ativo: true, comCredenciais: false });
    const semCred = await chamar("PUT", { regerarWebhook: true });
    expect(semCred.json.registroPendente).toContain("Client ID/Secret");
    expect(inter.configurar).not.toHaveBeenCalled();
  });

  it("salvar a configuração SEM regerar não registra nada no Inter nem devolve URL", async () => {
    await configurarIntegracao({ ativo: true });
    await chamar("PUT", { regerarWebhook: true }); // garante que já existe segredo
    inter.configurar.mockReset();

    const r = await chamar("PUT", { ativo: true });
    expect(r.status).toBe(200);
    expect(r.json.webhookUrl).toBeUndefined();
    expect(inter.configurar).not.toHaveBeenCalled();
  });

  it("RBAC: técnico não gera webhook (403) e o Inter não é chamado", async () => {
    comoTecnico();
    const r = await chamar("PUT", { regerarWebhook: true });
    expect(r.status).toBe(403);
    expect(inter.configurar).not.toHaveBeenCalled();
  });
});
