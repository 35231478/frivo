/**
 * PADRONIZAÇÃO — LEVA 3: as telas pequenas de Configurações, pelas ROTAS reais com PostgreSQL real.
 *
 * Prioridade nº 1 da leva: botão destrutivo ou de configuração sensível só para quem pode — e o
 * SERVIDOR recusa de qualquer jeito. Aqui fica travado o lado do servidor:
 *
 *  - quem só VISUALIZA as Configurações (e a Frota) leva 403 em TODA rota que grava, exclui, inativa,
 *    testa integração ou aplica a padronização — e o banco inteiro fica idêntico (todas as tabelas);
 *  - sem login, 401;
 *  - com Configurações › gerenciar: formulário cria, edita e inativa (some da lista, continua no banco);
 *  - checklists de veículo: Frota › gerenciar sozinha basta (o link fica no menu da Frota), e
 *    Configurações › gerenciar sozinha também; inativar não apaga;
 *  - "carregar modelos padrão" de e-mail só cria os que faltam: o modelo já editado NÃO é sobrescrito
 *    (por isso a tela não o chama mais de "restaurar");
 *  - excluir a logo exige a permissão.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva3-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva3_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "u1" : "u2", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
vi.setConfig({ testTimeout: 60_000 });

/** Vê as Configurações e a Frota; não gerencia nada */
const SO_VE = montarPermissoes({ configuracoes: ["visualizar"], veiculos: ["visualizar"], financeiro: ["visualizar"] });
const SO_CONFIG = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const SO_FROTA = montarPermissoes({ veiculos: ["visualizar", "gerenciar"] });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const CAMPOS = [{ label: "Dreno testado", tipo: "SIM_NAO", obrigatorio: true, ordem: 1 }];
const ITENS = [{ categoria: "Motor", descricao: "Nível do óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], obrigatorio: true, ordem: 0 }];

/** Toda chamada que GRAVA nas telas da leva: [nome, rota, método, corpo, params] */
const GRAVACOES: [string, string, string, unknown, Record<string, string>][] = [
  ["formulário: criar", "formularios", "POST", { nome: "Invadido", campos: CAMPOS }, {}],
  ["formulário: editar", "formularios/[id]", "PUT", { nome: "Invadido", campos: CAMPOS }, { id: "f1" }],
  ["formulário: inativar", "formularios/[id]", "DELETE", undefined, { id: "f1" }],
  ["checklist de veículo: criar", "checklist-templates", "POST", { nome: "Invadido", frequencia: "DIARIO", itens: ITENS }, {}],
  ["checklist de veículo: editar", "checklist-templates/[id]", "PUT", { nome: "Invadido", frequencia: "DIARIO", itens: ITENS }, { id: "ck1" }],
  ["checklist de veículo: inativar", "checklist-templates/[id]", "DELETE", undefined, { id: "ck1" }],
  ["numeração: mudar o próximo número", "configuracoes/numeracao", "PUT", { tipo: "orcamento", proximo: 9000 }, {}],
  ["padronização: prévia", "configuracoes/padronizacao", "GET", undefined, {}],
  ["padronização: aplicar", "configuracoes/padronizacao", "POST", undefined, {}],
  ["e-mail: salvar", "email/config", "PUT", { ativo: true, remetente: "invadido@x.com" }, {}],
  ["e-mail: testar envio", "email/config", "POST", {}, {}],
  ["modelos de e-mail: carregar padrões", "email/templates", "POST", { restaurarPadroes: true }, {}],
  ["modelos de e-mail: editar", "email/templates/[id]", "PUT", { assunto: "Invadido", corpo: "x", ativo: false }, { id: "et1" }],
  ["modelos de e-mail: excluir", "email/templates/[id]", "DELETE", undefined, { id: "et1" }],
  ["empresa: salvar", "empresa", "PUT", { nome: "Invadida" }, {}],
  ["empresa: excluir a logo", "empresa/logo", "DELETE", undefined, {}],
  ["preferências e padrões do orçamento: salvar", "configuracoes", "PUT", { orcamentoValidadeDias: 99 }, {}],
  ["QR Code: salvar", "configuracoes/qr-code", "PUT", { paginaPublicaAtiva: false }, {}],
  ["impressão da OS: salvar", "configuracoes/impressao-os", "PUT", {}, {}],
  ["Banco Inter: salvar", "integracoes/inter", "PUT", { ativo: true, clientId: "invadido" }, {}],
  ["Banco Inter: gerar o webhook", "integracoes/inter", "PUT", { regerarWebhook: true }, {}],
  ["Banco Inter: testar conexão", "integracoes/inter", "POST", undefined, {}],
];

describe.skipIf(!URL_PG)("Leva 3: Configurações — o servidor recusa quem não pode (PostgreSQL real)", () => {
  let prisma: any;

  /** O banco INTEIRO num retrato: uma assinatura por tabela (qualquer linha que mude, em qualquer tabela, aparece) */
  async function retrato(): Promise<Record<string, string>> {
    const tabelas: { table_name: string }[] = await prisma.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_type = 'BASE TABLE' ORDER BY table_name`);
    const r: Record<string, string> = {};
    for (const { table_name: t } of tabelas) {
      const [{ h }]: { h: string }[] = await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${SCHEMA}"."${t}" x`);
      r[t] = h;
    }
    return r;
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([...new Set(GRAVACOES.map(([, rota]) => rota))].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com", logo: "data:image/png;base64,AAAA" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [{ id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" }, { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.formularioTemplate.create({ data: { id: "f1", empresaId: "e1", nome: "Checklist de instalação", campos: { create: [{ label: "Dreno testado", tipo: "SIM_NAO", obrigatorio: true, ordem: 1 }] } } });
    await prisma.formularioTemplate.create({ data: { id: "f9", empresaId: "e2", nome: "Da outra empresa", campos: { create: [{ label: "X", tipo: "SIM_NAO", ordem: 1 }] } } });
    await prisma.checklistTemplate.create({ data: { id: "ck1", empresaId: "e1", nome: "Checklist diário", frequencia: "DIARIO", itens: { create: [{ categoria: "Motor", descricao: "Nível do óleo", tipo: "OK_NOK", opcoes: ["OK", "NOK"], ordem: 0 }] } } });
    await prisma.emailTemplate.create({ data: { id: "et1", empresaId: "e1", tipo: "ORCAMENTO_ENVIADO", nome: "Orçamento enviado", assunto: "Assunto EDITADO pela empresa", corpo: "<p>Corpo próprio</p>", ativo: true } });
  }, 240_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });
  beforeEach(() => logar());

  describe("quem só visualiza: 403 em toda gravação, e nada muda no banco", () => {
    it.each(GRAVACOES)("%s", async (_nome, rota, metodo, corpo, params) => {
      const antes = await retrato();
      logar(SO_VE);
      const r = await chamar(rota, metodo, corpo, params);
      expect(r.status).toBe(403);
      expect(typeof r.json?.erro).toBe("string");
      expect(await retrato()).toEqual(antes);
    });
  });

  it("sem login: 401 em toda gravação, e nada muda no banco", async () => {
    const antes = await retrato();
    sessao.atual = null;
    for (const [nome, rota, metodo, corpo, params] of GRAVACOES) {
      expect([nome, (await chamar(rota, metodo, corpo, params)).status]).toEqual([nome, 401]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("quem só visualiza continua LENDO as telas (a leitura não exige gerenciar)", async () => {
    logar(SO_VE);
    for (const rota of ["formularios", "checklist-templates", "configuracoes/numeracao", "email/config", "email/templates", "configuracoes/impressao-os", "integracoes/inter"]) {
      expect([rota, (await chamar(rota, "GET")).status]).toEqual([rota, 200]);
    }
    // segredos nunca saem na leitura
    const inter = (await chamar("integracoes/inter", "GET")).json;
    expect(Object.keys(inter).filter((k) => /secret|chavePrivada$|certificado$/i.test(k) && !/^tem/.test(k))).toEqual([]);
    expect((await chamar("email/config", "GET")).json?.apiKey).toBeUndefined();
  });

  it("formulário, com Configurações › gerenciar: cria, edita e inativa — inativo some da lista e continua no banco", async () => {
    logar(SO_CONFIG);
    const novo = await chamar("formularios", "POST", { nome: "Vistoria de entrega", descricao: "", tipoOsId: null, campos: [{ label: "Ambiente limpo", tipo: "SIM_NAO", obrigatorio: true, ordem: 1 }] });
    expect([novo.status, novo.json?.nome, novo.json?.campos?.length]).toEqual([201, "Vistoria de entrega", 1]);
    const id = novo.json.id;
    const editado = await chamar("formularios/[id]", "PUT", { nome: "Vistoria final", descricao: "", tipoOsId: null, campos: [{ id: novo.json.campos[0].id, label: "Ambiente limpo", tipo: "SIM_NAO", obrigatorio: false, ordem: 1 }] }, { id });
    expect([editado.status, editado.json?.nome, editado.json?.campos?.[0]?.obrigatorio]).toEqual([200, "Vistoria final", false]);
    expect((await chamar("formularios/[id]", "DELETE", undefined, { id })).status).toBe(200);
    const lista = (await chamar("formularios", "GET")).json as { id: string }[];
    expect(lista.map((f) => f.id)).not.toContain(id);
    expect(await prisma.formularioTemplate.findUnique({ where: { id }, select: { ativo: true, nome: true } })).toEqual({ ativo: false, nome: "Vistoria final" });
    // de outra empresa: não acha (e não inativa)
    expect((await chamar("formularios/[id]", "DELETE", undefined, { id: "f9" })).status).toBe(404);
    expect((await prisma.formularioTemplate.findUnique({ where: { id: "f9" } })).ativo).toBe(true);
  });

  it("checklists de veículo: Frota › gerenciar sozinha basta, e Configurações › gerenciar sozinha também; inativar não apaga", async () => {
    logar(SO_FROTA);
    const a = await chamar("checklist-templates", "POST", { nome: "Semanal da frota", descricao: "", frequencia: "SEMANAL", itens: ITENS });
    expect([a.status < 300, a.json?.nome]).toEqual([true, "Semanal da frota"]);
    logar(SO_CONFIG);
    const b = await chamar("checklist-templates", "POST", { nome: "Mensal da frota", descricao: "", frequencia: "MENSAL", itens: ITENS });
    expect(b.status < 300).toBe(true);
    expect((await chamar("checklist-templates/[id]", "DELETE", undefined, { id: a.json.id })).status).toBe(200);
    const guardado = await prisma.checklistTemplate.findUnique({ where: { id: a.json.id }, include: { itens: true } });
    expect([guardado.ativo, guardado.itens.length]).toEqual([false, 1]);
    // quem só opera OS não entra nem para ler
    logar(montarPermissoes({ ordens: ["visualizar", "editar"] }));
    expect((await chamar("checklist-templates", "GET")).status).toBe(403);
  });

  it("modelos de e-mail: 'carregar padrões' só cria os que faltam — o modelo já editado NÃO é sobrescrito", async () => {
    logar(SO_CONFIG);
    const { TEMPLATES_PADRAO } = await import("@/lib/email-templates");
    const r = await chamar("email/templates", "POST", { restaurarPadroes: true });
    expect(r.status).toBe(200);
    expect((r.json as unknown[]).length).toBe(TEMPLATES_PADRAO.length);
    expect(await prisma.emailTemplate.findUnique({ where: { id: "et1" }, select: { assunto: true, corpo: true } })).toEqual({ assunto: "Assunto EDITADO pela empresa", corpo: "<p>Corpo próprio</p>" });
    // de novo: não duplica nem mexe
    const antes = await retrato();
    await chamar("email/templates", "POST", { restaurarPadroes: true });
    expect((await retrato()).email_templates).toBe(antes.email_templates);
  });

  it("logo da empresa: quem gerencia exclui; quem só vê, não (a logo continua lá)", async () => {
    logar(SO_VE);
    expect((await chamar("empresa/logo", "DELETE")).status).toBe(403);
    expect((await prisma.empresa.findUnique({ where: { id: "e1" } })).logo).toBe("data:image/png;base64,AAAA");
    logar(SO_CONFIG);
    expect((await chamar("empresa/logo", "DELETE")).status).toBe(200);
    expect((await prisma.empresa.findUnique({ where: { id: "e1" } })).logo).toBeNull();
  });
});
