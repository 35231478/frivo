/**
 * O E-MAIL DA DOCUMENTAÇÃO, com o envio de verdade (lib/email.ts) e só o Resend trocado.
 *
 * Esta leva mexeu em `enviarEmail`, que é de todo mundo (boleto, orçamento, OS). O que se prova:
 *  - o modelo "Documentação da equipe" existe, leva o LINK no botão e nenhum anexo;
 *  - vários endereços no "Para" chegam como lista; um só continua chegando como texto — o que os
 *    outros envios da casa mandam não mudou de forma;
 *  - "responder para": o que a empresa configurou no e-mail transacional VENCE; sem configuração,
 *    vale o e-mail da empresa — a resposta do cliente nunca cai no remetente do sistema;
 *  - a empresa pode editar o corpo (modelo por empresa), e o registro do envio guarda os destinos.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_docemail_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const resend = vi.hoisted(() => ({ enviados: [] as any[] }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async (m: any) => { resend.enviados.push(m); return { data: { id: "x" } }; } };
  },
}));

const VARIAVEIS = {
  cliente_nome: "Shopping Ibirapuera", quantidade_colaboradores: "3",
  link_documento: "https://app.exemplo.com/documentacao/tok-123", validade_link: "23/11/2026",
};

describe.skipIf(!URL_PG)("E-mail da documentação da equipe (envio real, Resend trocado)", () => {
  let prisma: any;
  let enviarEmail: typeof import("@/lib/email").enviarEmail;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ enviarEmail } = await import("@/lib/email"));
    const { criptografar } = await import("@/lib/crypto");

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total LTDA", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "contato@climatotal.com" } });
    await prisma.emailConfig.create({ data: { empresaId: "e1", ativo: true, apiKey: criptografar("re_teste"), remetente: "avisos@frivo.app", nomeRemetente: "Clima Total" } });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    resend.enviados.length = 0;
    await prisma.emailLog.deleteMany({});
    await prisma.emailTemplate.deleteMany({});
    await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { replyTo: null } });
  });

  it("o modelo leva o LINK no botão, diz a validade — e nenhum anexo", async () => {
    const r = await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: "seguranca@shopping.com", variaveis: VARIAVEIS });
    expect(r.ok, r.erro).toBe(true);

    const [m] = resend.enviados;
    expect(m.subject).toBe("Documentação da equipe — Clima Total");
    expect(m.html).toContain("https://app.exemplo.com/documentacao/tok-123");
    expect(m.html).toContain("Abrir a documentação");
    expect(m.html).toContain("Shopping Ibirapuera");
    expect(m.html).toContain("23/11/2026");
    expect(m.attachments, "a documentação pesa: vai o link, nunca o arquivo").toBeUndefined();
  });

  it("vários no Para chegam como lista; um só continua chegando como texto", async () => {
    await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: ["rh@shopping.com", "sst@shopping.com"], cc: ["gestor@shopping.com"], variaveis: VARIAVEIS });
    expect(resend.enviados[0].to).toEqual(["rh@shopping.com", "sst@shopping.com"]);
    expect(resend.enviados[0].cc).toEqual(["gestor@shopping.com"]);

    await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: "rh@shopping.com", variaveis: VARIAVEIS });
    expect(resend.enviados[1].to, "o formato dos envios que já existiam não mudou").toBe("rh@shopping.com");

    const logs = await prisma.emailLog.findMany({ orderBy: { enviadoEm: "asc" }, select: { para: true, status: true } });
    expect(logs).toEqual([
      { para: "rh@shopping.com, sst@shopping.com", status: "ENVIADO" },
      { para: "rh@shopping.com", status: "ENVIADO" },
    ]);
  });

  it("sem destinatário não envia", async () => {
    expect((await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: [], variaveis: VARIAVEIS })).ok).toBe(false);
    expect((await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: ["  ", ""], variaveis: VARIAVEIS })).ok).toBe(false);
    expect(resend.enviados).toEqual([]);
  });

  it("responder para: sem configuração, vale o e-mail da empresa", async () => {
    await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: "rh@shopping.com", variaveis: VARIAVEIS, responderPara: "contato@climatotal.com" });
    expect(resend.enviados[0].replyTo).toBe("contato@climatotal.com");
    expect(resend.enviados[0].from, "sai do domínio do sistema").toBe("Clima Total <avisos@frivo.app>");
  });

  it("responder para: o que a empresa configurou no e-mail transacional VENCE", async () => {
    await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { replyTo: "atendimento@climatotal.com" } });
    await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: "rh@shopping.com", variaveis: VARIAVEIS, responderPara: "contato@climatotal.com" });
    expect(resend.enviados[0].replyTo).toBe("atendimento@climatotal.com");
  });

  it("quem não passa \"responder para\" continua como antes (os outros envios da casa)", async () => {
    await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: "rh@shopping.com", variaveis: VARIAVEIS });
    expect(resend.enviados[0].replyTo).toBeUndefined();
  });

  it("o corpo é editável por empresa: o modelo salvo substitui o padrão", async () => {
    await prisma.emailTemplate.create({ data: {
      empresaId: "e1", tipo: "DOCUMENTACAO_EQUIPE", nome: "Documentação da equipe", ativo: true,
      assunto: "Documentos da equipe técnica — {{empresa_nome}}",
      corpo: "<p>Prezados, seguem os documentos de {{quantidade_colaboradores}} técnicos. Válido até {{validade_link}}.</p>",
    } });
    await enviarEmail("e1", { tipo: "DOCUMENTACAO_EQUIPE", para: "rh@shopping.com", variaveis: VARIAVEIS });
    expect(resend.enviados[0].subject).toBe("Documentos da equipe técnica — Clima Total");
    expect(resend.enviados[0].html).toContain("seguem os documentos de 3 técnicos");
    expect(resend.enviados[0].html, "o botão com o link continua lá").toContain("https://app.exemplo.com/documentacao/tok-123");
  });
});
