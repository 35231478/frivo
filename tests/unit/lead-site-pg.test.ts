/**
 * Lead do site (calculadora de BTU) — ponta a ponta, Prisma real, PostgreSQL real. Prova que uma
 * submissão SEMPRE cria o lead no Frivo e não passa despercebida:
 *  - cálculo de BTU (regra pura): capacidade comercial arredondada, pré-orçamento somado;
 *  - criarLeadDoSite cria o CLIENTE origem=SITE (com contato) + ORÇAMENTO "Lead do site — <nome>"
 *    (com o contexto do BTU na observação); reaproveita o cliente no lead recorrente (não duplica);
 *  - a submissão aparece na tela "Leads do site" (orçamentos nome startsWith "Lead do site");
 *  - o sino (/api/alertas) conta o lead novo (24h), só para quem vê orçamentos;
 *  - validação clara (contato obrigatório) sem perder o lead em silêncio;
 *  - multiempresa: cai na empresa configurada (TERMOFRIO_EMPRESA_ID), nunca na de outro tenant;
 *  - o endpoint público /api/publico/leads exige o token e reusa a mesma função.
 *   PG_TESTE_URL="postgresql://teste_local:teste_local@localhost:5432/frivo_testes_en" npx vitest run tests/unit/lead-site-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { calcularAmbiente, preOrcamento } from "@/lib/leads/btu";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_lead_site_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); }, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() {}, replace() {} }), usePathname: () => "/" }));
// after() do /api/alertas não deve disparar reconciliação de verdade no teste
vi.mock("@/lib/nfse/webhook-server", async (orig) => ({ ...(await orig<object>()), reconciliarEmpresa: vi.fn(async () => {}) }));
// `after` precisa de escopo de request (não existe chamando o handler direto): stub no-op
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => void) => { void fn; } }));

vi.setConfig({ testTimeout: 60_000 });

describe("Cálculo de BTU (regra pura)", () => {
  it("arredonda para a capacidade comercial e soma o pré-orçamento", () => {
    const sala = calcularAmbiente({ nome: "Sala", tipo: "sala", areaM2: 20, pessoas: 3, solTarde: true });
    // 20×600 + 1×600 = 12600, +10% = 13860 → arredonda para 18000
    expect(sala.btuCalculado).toBe(13860);
    expect(sala.btuRecomendado).toBe(18000);
    expect(sala.tipoEquipamento).toBe("Split Hi-Wall Inverter");
    const quarto = calcularAmbiente({ nome: "Quarto", tipo: "quarto", areaM2: 12, pessoas: 2, solTarde: false });
    expect(quarto.btuRecomendado).toBe(9000); // 7200 → 9000
    const total = preOrcamento([sala, quarto]);
    expect(total.totalMin).toBe(sala.faixaPreco[0] + quarto.faixaPreco[0]);
    expect(total.totalMax).toBe(sala.faixaPreco[1] + quarto.faixaPreco[1]);
  });
});

describe.skipIf(!URL_PG)("Lead do site (PostgreSQL real)", () => {
  let prisma: any;
  let criarLeadDoSite: typeof import("@/lib/leads/criar-lead-site").criarLeadDoSite;

  const logar = (empresaId = "e1", role = "ADMIN", permissoes: any = { orcamentos: ["visualizar"] }) => {
    sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@x.com", empresaId, role, permissoes, tecnicoId: null } };
  };
  const lead = (over: Record<string, unknown> = {}) => ({
    nome: "Maria Silva", whatsapp: "(62) 99988-7766", email: "maria@ex.com", cidade: "Goiânia", tipoUso: "Residencial",
    ambientes: [{ nome: "Sala", areaM2: 20, btuCalculado: 13860, btuRecomendado: 18000, tipoEquipamento: "Split Hi-Wall Inverter", justificativa: "x" }],
    preOrcamento: { totalMin: 3200, totalMax: 4500 }, ...over,
  });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.TERMOFRIO_EMPRESA_ID = "e1";
    process.env.SITE_API_TOKEN = "tok-teste";
    delete process.env.TERMOFRIO_EMAIL_NOTIFICACAO; // sem e-mail configurado: o lead ainda tem de entrar
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ criarLeadDoSite } = await import("@/lib/leads/criar-lead-site"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Termofrio", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    logar();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  it("cria o cliente origem=SITE (com contato) + orçamento \"Lead do site\" (com o contexto do BTU); sempre na empresa configurada", async () => {
    const r = await criarLeadDoSite(lead());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.empresaId).toBe("e1");

    const cli = await prisma.cliente.findUnique({ where: { id: r.clienteId } });
    expect(cli).toMatchObject({ empresaId: "e1", origem: "SITE", nome: "Maria Silva", email: "maria@ex.com", celular: "(62) 99988-7766", cidade: "Goiânia" });

    const orc = await prisma.orcamento.findUnique({ where: { id: r.orcamentoId }, include: { produtos: true, servicos: true } });
    expect(orc.nome).toBe("Lead do site — Maria Silva");
    expect(orc.clienteId).toBe(r.clienteId);
    expect(orc.status).toBe("RASCUNHO");
    // contexto do BTU e do contato na observação (o Zé lê direto)
    expect(orc.observacao).toContain("Sala: 20 m²");
    expect(orc.observacao).toContain("18.000 BTU/h");
    expect(orc.observacao).toContain("WhatsApp: (62) 99988-7766");
    // itens: equipamento + instalação
    expect(orc.produtos).toHaveLength(1);
    expect(orc.servicos).toHaveLength(1);
    expect(Number(orc.totalGeral)).toBeGreaterThan(0);
    // e2 não recebeu nada
    expect(await prisma.orcamento.count({ where: { empresaId: "e2" } })).toBe(0);
  });

  it("aparece na tela \"Leads do site\" e o sino conta o lead novo (só para quem vê orçamentos)", async () => {
    const LeadsPage = (await import("@/app/(dashboard)/leads-site/page")).default;
    const html = renderToStaticMarkup(await LeadsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Maria Silva");
    expect(html).toContain("novo"); // badge "N novo(s) em 24h"

    const { GET } = await import("@/app/api/alertas/route");
    const alertas = await (await GET()).json();
    expect(alertas.leadsSite).toBeGreaterThanOrEqual(1);
    expect(alertas.total).toBeGreaterThanOrEqual(1);

    // Quem não vê orçamentos não recebe o alerta
    logar("e1", "OPERADOR", { orcamentos: [] });
    try {
      expect((await (await GET()).json()).leadsSite).toBe(0);
    } finally { logar(); }
  });

  it("lead recorrente (mesmo e-mail, até com outro WhatsApp) reaproveita o cliente — não duplica o cadastro", async () => {
    const antes = await prisma.cliente.count({ where: { empresaId: "e1", origem: "SITE" } });
    // WhatsApp diferente: se não reusar por e-mail, cairia num cadastro novo (placeholder por telefone)
    const r = await criarLeadDoSite(lead({ nome: "Maria S. (de novo)", whatsapp: "(62) 90000-0000" }));
    expect(r.ok).toBe(true);
    expect(await prisma.cliente.count({ where: { empresaId: "e1", origem: "SITE" } })).toBe(antes); // mesmo cliente
    if (r.ok) expect((await prisma.cliente.findUnique({ where: { id: r.clienteId } })).nome).toBe("Maria Silva"); // não renomeia
  });

  it("validação clara (contato obrigatório) sem perder o lead em silêncio", async () => {
    expect(await criarLeadDoSite(lead({ nome: "Jo" }))).toEqual({ ok: false, erro: "Informe o nome completo.", campo: "nome" });
    expect(await criarLeadDoSite(lead({ whatsapp: "123" }))).toMatchObject({ ok: false, campo: "whatsapp" });
    expect(await criarLeadDoSite(lead({ email: "nao-email" }))).toMatchObject({ ok: false, campo: "email" });
    expect(await criarLeadDoSite(lead({ ambientes: [] }))).toMatchObject({ ok: false, campo: "ambientes" });
  });

  it("endpoint público /api/publico/leads: sem token 401; com token reusa a função e cria o lead", async () => {
    const { POST } = await import("@/app/api/publico/leads/route");
    const req = (corpo: unknown, token?: string) => new Request("http://x/api/publico/leads", {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-site-token": token } : {}) }, body: JSON.stringify(corpo),
    });
    expect((await POST(req(lead()))).status).toBe(401);
    expect((await POST(req(lead(), "errado"))).status).toBe(401);
    const antes = await prisma.orcamento.count({ where: { empresaId: "e1", nome: { startsWith: "Lead do site" } } });
    const ok = await POST(req(lead({ email: "novo@ex.com" }), "tok-teste"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).success).toBe(true);
    expect(await prisma.orcamento.count({ where: { empresaId: "e1", nome: { startsWith: "Lead do site" } } })).toBe(antes + 1);
    // corpo inválido → erro claro, nada criado
    const ruim = await POST(req(lead({ nome: "x" }), "tok-teste"));
    expect(ruim.status).toBe(400);
    expect((await ruim.json()).campo).toBe("nome");
  });
});
