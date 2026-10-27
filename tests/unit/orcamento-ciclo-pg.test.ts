/**
 * Proposta corporativa (parte 2) — ciclo e aceite, rotas reais com o Prisma real num PostgreSQL real:
 *  - link público: JSON só com o que o cliente vê; abrir = "Visualizado" (1ª vez data + evento com
 *    IP; depois só conta), mas não conta a própria empresa logada, robô de prévia nem rascunho;
 *  - aprovar: nome, CPF, assinatura, data/hora, IP e navegador; evento; conta a receber; aviso por
 *    e-mail ao responsável; atômico (dois cliques ao mesmo tempo aprovam uma vez); expirado = 410;
 *  - recusar: nome + motivo, data/hora e IP; evento; aviso; validações; expirado = 410;
 *  - enviar (rastreável): e-mail pelo Resend ao contato A/C, WhatsApp, link; eventos; RBAC e
 *    empresa da sessão; validade vencida bloqueia;
 *  - PUT de status da equipe: voltar para rascunho zera o "visualizado", recusa registrada pela
 *    equipe, aprovar só pelo cliente; evento STATUS;
 *  - sino: respostas não vistas (por permissão e empresa) e abrir o orçamento tira do sino;
 *  - lista: filtro por etapa (Enviado/Visualizado/Expirado/Recusado) e "respostas novas".
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-ciclo-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { hojeDiaCivil } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_ciclo_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: id === "u1" ? "Ana" : "Bia", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes } };
};
const deslogar = () => { sessao.atual = null; };

// O Resend é o único "de fora": o resto (config criptografada, templates, destinatários, log) é real
const resend = vi.hoisted(() => ({ enviados: [] as any[], falhar: false }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async (m: any) => { resend.enviados.push(m); return resend.falhar ? { error: { message: "Domínio não verificado" } } : { data: { id: "x" } }; } };
  },
}));
// Página pública: cabeçalhos da requisição (IP e navegador) e o router dos botões
const cabecalhos = vi.hoisted(() => ({ atual: {} as Record<string, string> }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(cabecalhos.atual), cookies: async () => new Map() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const ASSINATURA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, cab: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost:3000/api/x", {
    method: metodo, headers: { "Content-Type": "application/json", "user-agent": NAVEGADOR, ...cab },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await (Object.keys(params).length ? mod[metodo](req, { params: Promise.resolve(params) }) : mod[metodo](req));
  return { status: res.status, json: await res.json().catch(() => null) };
}
const publico = (token: string, cab: Record<string, string> = {}) => chamar("publico/orcamentos/[token]", "GET", undefined, { token }, cab);
const aprovar = (token: string, corpo: Record<string, unknown> = {}, cab: Record<string, string> = { "x-forwarded-for": "200.10.20.30, 10.0.0.1" }) =>
  chamar("publico/orcamentos/[token]/aprovar", "POST", { nome: "Juliana Ramos", cpf: "123.456.789-09", assinaturaUrl: ASSINATURA, ...corpo }, { token }, cab);
const recusar = (token: string, corpo: Record<string, unknown> = {}, cab: Record<string, string> = { "x-forwarded-for": "189.1.2.3" }) =>
  chamar("publico/orcamentos/[token]/recusar", "POST", { nome: "Juliana Ramos", motivo: "Preço acima do orçado", ...corpo }, { token }, cab);
const enviar = (id: string, canal?: string) => chamar("orcamentos/[id]/enviar", "POST", canal ? { canal } : undefined, { id });

const AMANHA = hojeDiaCivil(new Date(), 1);
const ONTEM = hojeDiaCivil(new Date(), -1);
const HOJE = hojeDiaCivil(new Date());

describe.skipIf(!URL_PG)("Ciclo do orçamento: link público, aceite/recusa, envio rastreável, sino e lista (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;

  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    process.env.NEXTAUTH_URL = "https://app.frivo.com.br";
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "orcamentos/[id]", "orcamentos/[id]/enviar", "publico/orcamentos/[token]", "publico/orcamentos/[token]/aprovar",
      "publico/orcamentos/[token]/recusar", "alertas",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    const { criptografar } = await import("@/lib/crypto");
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "contato@ct.com.br" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "ana@ct.com.br", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Bia", email: "bia@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara S/A", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "22101333000111", email: "geral@hsc.com.br", celular: "31999990000" },
      { id: "c9", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33444555000100" },
    ] });
    await prisma.contatoCliente.create({ data: { id: "ct1", empresaId: "e1", clienteId: "c1", nome: "Juliana Ramos", email: "compras@hsc.com.br", whatsapp: "31988887777" } });
    await prisma.emailConfig.create({ data: { empresaId: "e1", ativo: true, apiKey: criptografar("re_teste"), remetente: "orcamentos@ct.com.br", nomeRemetente: "Clima Total" } });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(() => { resend.enviados = []; resend.falhar = false; logar(); cabecalhos.atual = {}; });

  const criar = (extra: Record<string, unknown> = {}) => {
    n += 1;
    const e2 = extra.empresaId === "e2";
    return prisma.orcamento.create({ data: {
      empresaId: "e1", codigo: `ORC-2026-${String(n).padStart(4, "0")}`, nome: `Orçamento ${n}`, clienteId: e2 ? "c9" : "c1", criadoPorId: e2 ? "u2" : "u1",
      tokenPublico: `tok-${n}`, status: "ENVIADO", enviadoEm: new Date("2026-10-01T12:00:00Z"), validadeEm: AMANHA, totalServicos: 1000, totalGeral: 1000,
      observacao: "Margem apertada, não mostrar", ...extra,
    } });
  };
  const eventos = (orcamentoId: string) => prisma.orcamentoEvento.findMany({ where: { orcamentoId }, orderBy: { criadoEm: "asc" } });

  describe("link público (JSON) e Visualizado", () => {
    it("só o que o cliente vê (sem observação interna, CPF, IP, navegador, ids) + a etapa", async () => {
      const o = await criar({ assinadoCpf: "12345678909", aprovadoIp: "1.2.3.4", aprovadoUserAgent: "x", recusaMotivo: "segredo" });
      deslogar();
      const r = await publico(o.tokenPublico);
      expect(r.status).toBe(200);
      for (const k of ["observacao", "assinadoCpf", "aprovadoIp", "aprovadoUserAgent", "recusaMotivo", "recusadoIp", "id", "empresaId", "criadoPorId", "tokenPublico", "visualizacoes", "assinaturaUrl"]) {
        expect(r.json).not.toHaveProperty(k);
      }
      expect(JSON.stringify(r.json)).not.toContain("Margem apertada");
      expect(r.json.codigo).toBe(o.codigo);
      expect(r.json.etapa).toBe("ENVIADO"); // a etapa de quando abriu (a 1ª visualização grava em seguida)
    });

    it("1ª abertura grava data + evento com IP; as próximas só contam; a etapa vira Visualizado", async () => {
      const o = await criar();
      deslogar();
      await publico(o.tokenPublico, { "x-forwarded-for": "200.1.2.3" });
      await publico(o.tokenPublico, { "x-forwarded-for": "200.1.2.4" });
      const r = await publico(o.tokenPublico);
      expect(r.json.etapa).toBe("VISUALIZADO");
      const db = await prisma.orcamento.findUnique({ where: { id: o.id } });
      expect(db.visualizadoEm).toBeInstanceOf(Date);
      expect(db.visualizacoes).toBe(3);
      const ev = await eventos(o.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ tipo: "VISUALIZADO", ip: "200.1.2.3", usuarioId: null, empresaId: "e1" });
    });

    it("duas abas ao mesmo tempo: um evento só", async () => {
      const o = await criar();
      deslogar();
      await Promise.all([publico(o.tokenPublico), publico(o.tokenPublico), publico(o.tokenPublico)]);
      expect((await eventos(o.id)).filter((e: any) => e.tipo === "VISUALIZADO")).toHaveLength(1);
      expect((await prisma.orcamento.findUnique({ where: { id: o.id } })).visualizacoes).toBe(3);
    });

    it("não conta: alguém da própria empresa logado, robô de prévia, rascunho/aprovado; outra empresa logada conta", async () => {
      const o = await criar();
      logar(); // da própria empresa
      await publico(o.tokenPublico);
      deslogar();
      await publico(o.tokenPublico, { "user-agent": "WhatsApp/2.23.20.0 A" });
      await publico(o.tokenPublico, { "user-agent": "facebookexternalhit/1.1" });
      let db = await prisma.orcamento.findUnique({ where: { id: o.id } });
      expect(db.visualizadoEm).toBeNull();
      expect(db.visualizacoes).toBe(0);
      logar(permissoesTotais(), "e2", "u2"); // usuário de outra empresa é "de fora"
      await publico(o.tokenPublico);
      db = await prisma.orcamento.findUnique({ where: { id: o.id } });
      expect(db.visualizacoes).toBe(1);

      deslogar();
      const rasc = await criar({ status: "RASCUNHO", enviadoEm: null });
      const aprov = await criar({ status: "APROVADO" });
      await publico(rasc.tokenPublico);
      await publico(aprov.tokenPublico);
      for (const x of [rasc, aprov]) expect((await prisma.orcamento.findUnique({ where: { id: x.id } })).visualizacoes).toBe(0);
    });

    it("cancelado = 410; token inexistente = 404", async () => {
      const o = await criar({ status: "CANCELADO" });
      expect((await publico(o.tokenPublico)).status).toBe(410);
      expect((await publico("nao-existe")).status).toBe(404);
    });
  });

  describe("aprovar no link", () => {
    it("grava nome, CPF, assinatura, data/hora, IP e navegador; evento; conta a receber; avisa o responsável", async () => {
      const o = await criar();
      deslogar();
      const r = await aprovar(o.tokenPublico, { nome: "  Juliana Ramos  " });
      expect(r).toMatchObject({ status: 200, json: { ok: true, status: "APROVADO" } });
      const db = await prisma.orcamento.findUnique({ where: { id: o.id } });
      expect(db).toMatchObject({ status: "APROVADO", assinadoPor: "Juliana Ramos", assinadoCpf: "12345678909", assinaturaUrl: ASSINATURA, aprovadoIp: "200.10.20.30", aprovadoUserAgent: NAVEGADOR, respostaVistaEm: null });
      expect(Date.now() - db.assinadoEm.getTime()).toBeLessThan(60_000);
      const ev = await eventos(o.id);
      expect(ev.at(-1)).toMatchObject({ tipo: "APROVADO", detalhe: "Juliana Ramos", ip: "200.10.20.30", usuarioId: null });
      expect(await prisma.contaReceber.count({ where: { orcamentoId: o.id } })).toBeGreaterThan(0);
      // E-mail ao responsável (quem criou), pelo Resend da empresa
      expect(resend.enviados).toHaveLength(1);
      expect(resend.enviados[0]).toMatchObject({ to: "ana@ct.com.br", from: "Clima Total <orcamentos@ct.com.br>" });
      expect(resend.enviados[0].subject).toBe(`Orçamento Nº 2026-${o.codigo.slice(-4)} aprovado — Hospital Santa Clara`);
      expect(texto(resend.enviados[0].html)).toContain("Hospital Santa Clara aprovou o orçamento Nº");
      expect(resend.enviados[0].html).toContain(`https://app.frivo.com.br/orcamentos/${o.id}`);
    });

    it("não aprova de novo, nem rascunho/recusado; validade vencida = 410 (vence hoje ainda aprova)", async () => {
      const o = await criar();
      expect((await aprovar(o.tokenPublico)).status).toBe(200);
      expect((await aprovar(o.tokenPublico)).status).toBe(400);
      for (const status of ["RASCUNHO", "REPROVADO", "CANCELADO"]) expect((await aprovar((await criar({ status })).tokenPublico)).status).toBe(400);
      expect((await aprovar((await criar({ status: "REPROVADO", validadeEm: ONTEM })).tokenPublico)).status).toBe(400);
      const vencido = await criar({ validadeEm: ONTEM });
      expect((await aprovar(vencido.tokenPublico)).status).toBe(410);
      expect((await prisma.orcamento.findUnique({ where: { id: vencido.id } })).status).toBe("ENVIADO");
      expect((await aprovar((await criar({ validadeEm: HOJE })).tokenPublico)).status).toBe(200);
      expect((await aprovar("nao-existe")).status).toBe(404);
    });

    it("dados inválidos = 400 (CPF, assinatura, nome)", async () => {
      const o = await criar();
      expect((await aprovar(o.tokenPublico, { cpf: "123" })).status).toBe(400);
      expect((await aprovar(o.tokenPublico, { assinaturaUrl: "javascript:alert(1)//aaaaaaaaaaaaaaa" })).status).toBe(400);
      expect((await aprovar(o.tokenPublico, { nome: "Jo" })).status).toBe(400);
      expect((await prisma.orcamento.findUnique({ where: { id: o.id } })).status).toBe("ENVIADO");
    });

    it("dois cliques ao mesmo tempo: aprova uma vez (um evento, uma conta a receber)", async () => {
      const o = await criar();
      const rs = await Promise.all([aprovar(o.tokenPublico), aprovar(o.tokenPublico), aprovar(o.tokenPublico)]);
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect((await eventos(o.id)).filter((e: any) => e.tipo === "APROVADO")).toHaveLength(1);
      expect(await prisma.contaReceber.count({ where: { orcamentoId: o.id } })).toBe(1);
    });

    it("IP lixo não é gravado; sem e-mail configurado a aprovação continua valendo", async () => {
      const o = await criar();
      resend.falhar = true;
      const r = await aprovar(o.tokenPublico, {}, { "x-forwarded-for": "<script>" });
      expect(r.status).toBe(200);
      expect((await prisma.orcamento.findUnique({ where: { id: o.id } })).aprovadoIp).toBeNull();
    });
  });

  describe("recusar no link", () => {
    it("grava nome, motivo, data/hora e IP; evento; avisa o responsável com o motivo", async () => {
      const o = await criar();
      deslogar();
      const r = await recusar(o.tokenPublico, { nome: " Juliana Ramos ", motivo: " Optamos por outro fornecedor <b> " });
      expect(r).toMatchObject({ status: 200, json: { ok: true, status: "REPROVADO" } });
      const db = await prisma.orcamento.findUnique({ where: { id: o.id } });
      expect(db).toMatchObject({ status: "REPROVADO", recusadoPor: "Juliana Ramos", recusaMotivo: "Optamos por outro fornecedor <b>", recusadoIp: "189.1.2.3", respostaVistaEm: null });
      expect(Date.now() - db.recusadoEm.getTime()).toBeLessThan(60_000);
      expect((await eventos(o.id)).at(-1)).toMatchObject({ tipo: "RECUSADO", detalhe: "Juliana Ramos: Optamos por outro fornecedor <b>", ip: "189.1.2.3" });
      expect(resend.enviados).toHaveLength(1);
      expect(resend.enviados[0].subject).toContain("recusado — Hospital Santa Clara");
      // Motivo escapado no HTML (texto do cliente)
      expect(resend.enviados[0].html).toContain("Optamos por outro fornecedor &lt;b&gt;");
      expect(resend.enviados[0].html).not.toContain("fornecedor <b>");
    });

    it("validações: nome e motivo obrigatórios, motivo até 1000; não recusa aprovado/rascunho; vencido = 410", async () => {
      const o = await criar();
      expect(await recusar(o.tokenPublico, { motivo: "ab" })).toMatchObject({ status: 400, json: { erro: "Conte o motivo da recusa." } });
      expect(await recusar(o.tokenPublico, { nome: "J" })).toMatchObject({ status: 400, json: { erro: "Informe seu nome." } });
      expect((await recusar(o.tokenPublico, { motivo: "x".repeat(1001) })).status).toBe(400);
      expect((await recusar(o.tokenPublico, { motivo: "x".repeat(1000) })).status).toBe(200);
      expect((await recusar(o.tokenPublico)).status).toBe(400); // já recusado
      expect((await recusar((await criar({ status: "APROVADO" })).tokenPublico)).status).toBe(400);
      // Já respondido e com a validade vencida: "não disponível" (400), não "expirado"
      expect(await recusar((await criar({ status: "APROVADO", validadeEm: ONTEM })).tokenPublico)).toMatchObject({ status: 400, json: { erro: "Este orçamento não está disponível para resposta" } });
      expect((await recusar((await criar({ status: "RASCUNHO" })).tokenPublico)).status).toBe(400);
      expect((await recusar((await criar({ validadeEm: ONTEM })).tokenPublico)).status).toBe(410);
      expect((await recusar("nao-existe")).status).toBe(404);
    });

    it("aprovar e recusar ao mesmo tempo: só uma resposta vale", async () => {
      const o = await criar();
      const [a, b] = await Promise.all([aprovar(o.tokenPublico), recusar(o.tokenPublico)]);
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect((await eventos(o.id)).filter((e: any) => e.tipo === "APROVADO" || e.tipo === "RECUSADO")).toHaveLength(1);
    });
  });

  describe("enviar (rastreável)", () => {
    it("e-mail pelo Resend: contato A/C primeiro, cliente em cópia; ENVIADO; evento com destinatários; 1ª data de envio fica", async () => {
      const o = await criar({ status: "RASCUNHO", enviadoEm: null, contatoClienteId: "ct1" });
      const r = await enviar(o.id, "EMAIL");
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ emailEnviado: true, para: "compras@hsc.com.br", erroEmail: null, publicUrl: `http://localhost:3000/orcamento/${o.tokenPublico}` });
      expect(resend.enviados[0]).toMatchObject({ to: "compras@hsc.com.br", cc: ["geral@hsc.com.br"] });
      expect(resend.enviados[0].html).toContain(`https://app.frivo.com.br/orcamento/${o.tokenPublico}`);
      const db = await prisma.orcamento.findUnique({ where: { id: o.id } });
      expect(db.status).toBe("ENVIADO");
      const primeiro = db.enviadoEm.getTime();
      expect((await eventos(o.id)).at(-1)).toMatchObject({ tipo: "ENVIADO_EMAIL", detalhe: "compras@hsc.com.br · cópia: geral@hsc.com.br", usuarioId: "u1" });
      // Reenviar não muda a 1ª data de envio
      await new Promise((ok) => setTimeout(ok, 5));
      await enviar(o.id, "EMAIL");
      expect((await prisma.orcamento.findUnique({ where: { id: o.id } })).enviadoEm.getTime()).toBe(primeiro);
      expect(await prisma.emailLog.count({ where: { referenciaId: o.id } })).toBe(2);
    });

    it("falha do Resend: devolve o erro + mailto, sem evento de e-mail enviado", async () => {
      const o = await criar({ contatoClienteId: "ct1" });
      resend.falhar = true;
      const r = await enviar(o.id, "EMAIL");
      expect(r.json).toMatchObject({ emailEnviado: false, erroEmail: "Domínio não verificado" });
      expect(r.json.mailtoUrl).toMatch(/^mailto:compras%40hsc\.com\.br\?subject=/);
      expect((await eventos(o.id)).some((e: any) => e.tipo === "ENVIADO_EMAIL")).toBe(false);
    });

    it("sem Resend configurado: mailto do usuário + evento 'enviado'", async () => {
      const o = await criar({ contatoClienteId: "ct1" });
      await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: false } });
      try {
        const r = await enviar(o.id, "EMAIL");
        expect(r.json).toMatchObject({ emailEnviado: false, erroEmail: null });
        expect(r.json.mailtoUrl).toMatch(/^mailto:compras%40hsc\.com\.br\?subject=/);
        expect(resend.enviados).toHaveLength(0);
        expect((await eventos(o.id)).at(-1)).toMatchObject({ tipo: "ENVIADO", detalhe: "pelo e-mail do usuário, para compras@hsc.com.br" });
      } finally {
        await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: true } });
      }
    });

    it("WhatsApp: link para o WhatsApp do contato A/C (ou celular do cliente) + evento; link copiado + evento", async () => {
      const o = await criar({ contatoClienteId: "ct1" });
      let r = await enviar(o.id, "WHATSAPP");
      expect(r.json.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5531988887777\?text=/);
      expect(decodeURIComponent(r.json.whatsappUrl)).toContain("Olá, Juliana! Segue o orçamento Nº");
      expect((await eventos(o.id)).at(-1)).toMatchObject({ tipo: "ENVIADO_WHATSAPP", detalhe: "Juliana Ramos · 31988887777" });
      const sem = await criar();
      r = await enviar(sem.id, "WHATSAPP");
      expect(r.json.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5531999990000/);
      r = await enviar(sem.id, "LINK");
      expect(r.json.publicUrl).toContain(sem.tokenPublico);
      expect((await eventos(sem.id)).map((e: any) => e.tipo)).toEqual(["ENVIADO_WHATSAPP", "LINK_COPIADO"]);
      expect(resend.enviados).toHaveLength(0);
    });

    it("bloqueia aprovado/cancelado/convertido e validade vencida; canal inválido = 400", async () => {
      for (const status of ["APROVADO", "CANCELADO", "CONVERTIDA"]) expect((await enviar((await criar({ status })).id, "LINK")).status).toBe(400);
      const vencido = await criar({ status: "RASCUNHO", validadeEm: ONTEM });
      const r = await enviar(vencido.id, "EMAIL");
      expect(r.status).toBe(400);
      expect(r.json.erro).toContain("validade");
      expect((await prisma.orcamento.findUnique({ where: { id: vencido.id } })).status).toBe("RASCUNHO");
      expect((await enviar((await criar()).id, "SMS")).status).toBe(400);
    });

    it("RBAC e empresa da sessão: sem editar = 403; de outra empresa = 404", async () => {
      const o = await criar({ status: "RASCUNHO" });
      logar(montarPermissoes({ orcamentos: ["visualizar"] }));
      expect((await enviar(o.id, "LINK")).status).toBe(403);
      logar(permissoesTotais(), "e2", "u2");
      expect((await enviar(o.id, "LINK")).status).toBe(404);
      expect((await prisma.orcamento.findUnique({ where: { id: o.id } })).status).toBe("RASCUNHO");
      expect(await prisma.orcamentoEvento.count({ where: { orcamentoId: o.id } })).toBe(0);
    });
  });

  describe("status pela equipe (PUT)", () => {
    const put = (id: string, status: string) => chamar("orcamentos/[id]", "PUT", { status }, { id });

    it("voltar para rascunho zera envio e visualização (o ciclo recomeça) e registra na linha do tempo", async () => {
      const o = await criar({ visualizadoEm: new Date(), visualizacoes: 4 });
      const r = await put(o.id, "RASCUNHO");
      expect(r.status).toBe(200);
      expect(await prisma.orcamento.findUnique({ where: { id: o.id } })).toMatchObject({ status: "RASCUNHO", enviadoEm: null, visualizadoEm: null, visualizacoes: 0 });
      expect((await eventos(o.id)).at(-1)).toMatchObject({ tipo: "STATUS", detalhe: "Enviado → Rascunho", usuarioId: "u1" });
    });

    it("'Cliente recusou' (por fora do link): Recusado, registrado por quem, sem acender o sino", async () => {
      const o = await criar();
      await put(o.id, "REPROVADO");
      const db = await prisma.orcamento.findUnique({ where: { id: o.id } });
      expect(db).toMatchObject({ status: "REPROVADO", recusadoPor: "Registrado por Ana", recusaMotivo: null });
      expect(db.recusadoEm).toBeInstanceOf(Date);
      expect(db.respostaVistaEm).toBeInstanceOf(Date);
      expect((await eventos(o.id)).at(-1)).toMatchObject({ detalhe: "Enviado → Recusado" });
    });

    it("aprovar é só do cliente; reenviar com validade vencida não; mesmo status = nada muda", async () => {
      const o = await criar();
      const r = await put(o.id, "APROVADO");
      expect(r.status).toBe(400);
      expect(r.json.erro).toContain("cliente");
      const rasc = await criar({ status: "RASCUNHO", validadeEm: ONTEM });
      expect((await put(rasc.id, "ENVIADO")).status).toBe(400);
      expect((await put(o.id, "ENVIADO")).status).toBe(200);
      expect(await prisma.orcamentoEvento.count({ where: { orcamentoId: o.id } })).toBe(0);
      expect((await put((await criar({ status: "APROVADO" })).id, "RASCUNHO")).status).toBe(400);
    });
  });

  describe("sino, abrir o orçamento e lista", () => {
    it("conta só respostas do cliente não vistas, da empresa da sessão e com permissão; abrir tira do sino", async () => {
      await prisma.orcamento.updateMany({ data: { respostaVistaEm: new Date() } });
      const a = await criar();
      const r = await criar();
      await aprovar(a.tokenPublico);
      await recusar(r.tokenPublico);
      await criar({ empresaId: "e2", status: "APROVADO" }); // de outra empresa
      let s = await chamar("alertas", "GET");
      expect(s.json.orcamentosRespondidos).toBe(2);
      expect(s.json.total).toBeGreaterThanOrEqual(2);
      logar(montarPermissoes({ ordens: ["visualizar"] }));
      s = await chamar("alertas", "GET");
      expect(s.json.orcamentosRespondidos).toBe(0);
      logar(permissoesTotais(), "e2", "u2");
      expect((await chamar("alertas", "GET")).json.orcamentosRespondidos).toBe(1);

      // Abrir o orçamento (detalhe) marca como visto — só pela empresa da sessão
      const { marcarRespostaVista } = await import("@/lib/orcamentos/ciclo-server");
      const db = await prisma.orcamento.findUnique({ where: { id: a.id } });
      expect(await marcarRespostaVista(db, "e2")).toBe(false);
      expect(await marcarRespostaVista(db, "e1")).toBe(true);
      expect(await marcarRespostaVista({ ...db, respostaVistaEm: null }, "e1")).toBe(false); // já visto no banco
      expect(await marcarRespostaVista({ ...(await criar()), respostaVistaEm: null }, "e1")).toBe(false); // enviado não é resposta
      logar();
      expect((await chamar("alertas", "GET")).json.orcamentosRespondidos).toBe(1);
      deslogar();
      expect((await chamar("alertas", "GET")).status).toBe(401);
    });

    it("lista filtra pela etapa (Enviado/Visualizado/Expirado/Recusado) e 'respostas novas'", async () => {
      const { whereOrcamentos } = await import("@/lib/listas/filtros");
      await prisma.orcamento.updateMany({ data: { status: "CANCELADO" } });
      const env = await criar();
      const vis = await criar({ visualizadoEm: new Date() });
      const venceHoje = await criar({ validadeEm: HOJE });
      const exp = await criar({ validadeEm: ONTEM, visualizadoEm: new Date() });
      const semValidade = await criar({ validadeEm: null });
      const rec = await criar({ status: "REPROVADO" });
      const recVisto = await criar({ status: "REPROVADO", respostaVistaEm: new Date() });
      const apr = await criar({ status: "APROVADO" });
      const outra = await criar({ empresaId: "e2", status: "REPROVADO" });
      const ids = async (sp: Record<string, string>) =>
        (await prisma.orcamento.findMany({ where: whereOrcamentos("e1", sp), select: { id: true } })).map((x: any) => x.id).sort();
      expect(await ids({ status: "ENVIADO" })).toEqual([env.id, venceHoje.id, semValidade.id].sort());
      expect(await ids({ status: "VISUALIZADO" })).toEqual([vis.id]);
      expect(await ids({ status: "EXPIRADO" })).toEqual([exp.id]);
      expect(await ids({ status: "RECUSADO" })).toEqual([rec.id, recVisto.id].sort());
      expect(await ids({ status: "REPROVADO" })).toEqual([rec.id, recVisto.id].sort()); // links antigos
      expect(await ids({ resposta: "nova" })).toEqual([rec.id, apr.id].sort());
      expect(await ids({ resposta: "nova", status: "APROVADO" })).toEqual([apr.id]);
      expect((await ids({})).includes(outra.id)).toBe(false);
    });
  });

  describe("página pública (o que o cliente vê)", () => {
    const pagina = async (token: string) => {
      const { default: P } = await import("@/app/(publico)/orcamento/[token]/page");
      return renderToStaticMarkup(await P({ params: Promise.resolve({ token }) }));
    };

    it("enviado: botões Aprovar e Recusar; abrir conta como visualização com IP", async () => {
      const o = await criar();
      deslogar();
      cabecalhos.atual = { "x-forwarded-for": "177.1.2.3", "user-agent": NAVEGADOR };
      const h = await pagina(o.tokenPublico);
      expect(h).toContain("data-abrir-aprovacao");
      expect(h).toContain("data-abrir-recusa");
      expect((await eventos(o.id))[0]).toMatchObject({ tipo: "VISUALIZADO", ip: "177.1.2.3" });
      // Prévia de link (robô) e a cópia que o app guarda offline (service worker) não contam
      const p = await criar();
      cabecalhos.atual = { "user-agent": "WhatsApp/2.23" };
      await pagina(p.tokenPublico);
      cabecalhos.atual = { "user-agent": NAVEGADOR, "sec-fetch-dest": "empty", "sec-fetch-mode": "same-origin" };
      await pagina(p.tokenPublico);
      expect(await eventos(p.id)).toHaveLength(0);
      cabecalhos.atual = { "user-agent": NAVEGADOR, "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
      await pagina(p.tokenPublico);
      expect((await prisma.orcamento.findUnique({ where: { id: p.id } })).visualizacoes).toBe(1);
    });

    it("recusado: aviso com quem e quando, sem botões; expirado: aviso, sem botões; aprovado: sem botões", async () => {
      deslogar();
      cabecalhos.atual = { "user-agent": NAVEGADOR };
      const rec = await criar({ status: "REPROVADO", recusadoPor: "Juliana Ramos", recusadoEm: new Date("2026-10-20T13:30:00Z") });
      let h = await pagina(rec.tokenPublico);
      expect(h).toContain("data-aviso-recusado");
      expect(texto(h)).toContain("Recusada por Juliana Ramos em 20/10/2026 às 10:30");
      expect(h).not.toContain("data-abrir-aprovacao");
      h = await pagina((await criar({ validadeEm: ONTEM })).tokenPublico);
      expect(texto(h)).toContain("Orçamento expirado");
      expect(h).not.toContain("data-abrir-recusa");
      h = await pagina((await criar({ status: "APROVADO", assinadoEm: new Date(), assinadoPor: "Juliana" })).tokenPublico);
      expect(h).not.toContain("data-abrir-aprovacao");
      expect(h).not.toContain("data-aviso-recusado");
    });
  });
});
