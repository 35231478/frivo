/**
 * Acabamento do documento e da listagem — com o Prisma real num PostgreSQL real:
 *  - lista de orçamentos: em cada linha, baixar PDF, e-mail e WhatsApp; enviar só com permissão
 *    de editar (como a rota); encerrado/vencido desabilitado com o motivo; nome em 1 linha com o
 *    nome inteiro no hover; só orçamentos da empresa da sessão;
 *  - forma de pagamento escolhida na lista vai gravada e sai no documento do cliente; orçamento
 *    antigo (texto livre, nome longo, sem campos novos) segue abrindo igual;
 *  - nome automático curto ao criar; a rota de envio usa a mesma regra de bloqueio da lista.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-acabamento-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { hojeDiaCivil } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_acab_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("NEXT_REDIRECT"); },
}));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes } };
};

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const NOME_LONGO = "Manutenção Corretiva — Samsung WindFree 18k — Hospital Santa Clara · Matriz";

describe.skipIf(!URL_PG)("Acabamento: ações da lista, forma de pagamento e documento (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["orcamentos", "orcamentos/[id]", "orcamentos/[id]/enviar"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Ltda", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara S/A", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "22101333000111", celular: "31999990000" },
      { id: "c9", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33444555000100" },
    ] });
    const base = (id: string, codigo: string, extra: Record<string, unknown> = {}) => ({
      id, empresaId: "e1", codigo, nome: codigo, clienteId: "c1", criadoPorId: "u1", tokenPublico: `tok-${id}`, validadeEm: hojeDiaCivil(new Date(), 10),
      totalServicos: 100, totalGeral: 100, ...extra,
    });
    await prisma.orcamento.createMany({ data: [
      base("oRasc", "ORC-2026-0001", { nome: NOME_LONGO, status: "RASCUNHO", formaPagamento: "PIX à vista ou boleto em 2x" }),
      base("oEnv", "ORC-2026-0002", { status: "ENVIADO", enviadoEm: new Date() }),
      base("oApr", "ORC-2026-0003", { status: "APROVADO" }),
      base("oVenc", "ORC-2026-0004", { status: "ENVIADO", validadeEm: hojeDiaCivil(new Date(), -1) }),
      { id: "oOutra", empresaId: "e2", codigo: "ORC-2026-0001", nome: "Da outra empresa", clienteId: "c9", criadoPorId: "u2", tokenPublico: "tok-outra" },
    ] });
    await prisma.orcamentoServico.create({ data: { orcamentoId: "oRasc", descricao: "Serviço antigo", quantidade: 1, valorUnitario: 100, valorTotal: 100, ordem: 0 } });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const lista = async () => {
    const { default: P } = await import("@/app/(dashboard)/orcamentos/page");
    return renderToStaticMarkup(await P({ searchParams: Promise.resolve({}) }));
  };
  /** O trecho de HTML das ações de um orçamento (na tabela do desktop) */
  const acoesDe = (h: string, id: string) => {
    const blocos = h.split(`data-acoes-linha="${id}"`);
    expect(blocos.length, id).toBeGreaterThan(1);
    return blocos.at(-1)!.split("</div>")[0];
  };

  it("cada linha tem baixar PDF, e-mail e WhatsApp; encerrado e vencido ficam desabilitados com o motivo", async () => {
    const h = await lista();
    for (const id of ["oRasc", "oEnv", "oApr", "oVenc"]) {
      const a = acoesDe(h, id);
      expect(a).toContain(`href="/orcamento/tok-${id}/imprimir"`);
      expect(a).toContain("data-enviar-email-linha");
      expect(a).toContain("data-enviar-whatsapp-linha");
    }
    for (const id of ["oRasc", "oEnv"]) expect(acoesDe(h, id), id).not.toContain('disabled=""');
    expect(acoesDe(h, "oApr")).toMatch(/disabled=""[^>]*title="Orçamento já encerrado, não é possível reenviar"/);
    expect(acoesDe(h, "oVenc")).toContain("title=\"A validade deste orçamento já venceu.");
    // Só os orçamentos da empresa da sessão
    expect(h).not.toContain("oOutra");
    expect(h).not.toContain("Da outra empresa");
  });

  it("nome em 1 linha (reticências) com o nome inteiro no hover; existente não muda", async () => {
    const h = await lista();
    expect(h).toMatch(new RegExp(`<span class="block truncate" title="${NOME_LONGO}" data-nome-orcamento="true">${NOME_LONGO}</span>`));
    expect((await prisma.orcamento.findUnique({ where: { id: "oRasc" } })).nome).toBe(NOME_LONGO);
  });

  it("sem permissão de editar: só o PDF (a rota de envio também recusa)", async () => {
    logar(montarPermissoes({ orcamentos: ["visualizar"] }));
    try {
      const h = await lista();
      expect(h).toContain("data-baixar-pdf");
      expect(h).not.toContain("data-enviar-email-linha");
      expect(h).not.toContain("data-enviar-whatsapp-linha");
      expect((await chamar("orcamentos/[id]/enviar", "POST", { canal: "EMAIL" }, { id: "oEnv" })).status).toBe(403);
    } finally {
      logar();
    }
  });

  it("a rota de envio usa a mesma regra da lista (encerrado e vencido recusados com o mesmo motivo)", async () => {
    let r = await chamar("orcamentos/[id]/enviar", "POST", { canal: "WHATSAPP" }, { id: "oApr" });
    expect(r).toMatchObject({ status: 400, json: { erro: "Orçamento já encerrado, não é possível reenviar" } });
    r = await chamar("orcamentos/[id]/enviar", "POST", { canal: "WHATSAPP" }, { id: "oVenc" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toContain("validade");
    r = await chamar("orcamentos/[id]/enviar", "POST", { canal: "WHATSAPP" }, { id: "oEnv" });
    expect(r.status).toBe(200);
    expect(r.json.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5531999990000\?text=/);
    // Outra empresa: não acha
    expect((await chamar("orcamentos/[id]/enviar", "POST", { canal: "LINK" }, { id: "oOutra" })).status).toBe(404);
  });

  it("forma de pagamento escolhida (parcelado 6x) é gravada e sai no documento; nome automático curto", async () => {
    const r = await chamar("orcamentos", "POST", {
      clienteId: "c1", formaPagamento: "Parcelado no boleto em 6x",
      servicos: [{ descricao: "Instalação de condensadora com suporte de piso e interligação elétrica completa", quantidade: 1, valorUnitario: 1000 }, { descricao: "Gás", quantidade: 1, valorUnitario: 50 }],
      produtos: [],
    });
    expect(r.status).toBe(201);
    expect(r.json.formaPagamento).toBe("Parcelado no boleto em 6x");
    expect(r.json.nome).toBe("Instalação de condensadora com… +1 — Hospital Santa Clara");
    const { default: Imprimir } = await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    const h = renderToStaticMarkup(await Imprimir({ params: Promise.resolve({ token: r.json.tokenPublico }) }));
    expect(texto(h)).toContain("Forma de pagamento Parcelado no boleto em 6x");
    expect(h).toContain("data-tabela-planilha");
    expect(texto(h)).toContain("Total (R$)");
    expect(texto(h)).toMatch(/Total geral R\$ 1\.050,00/);
  });

  it("orçamento antigo (forma de pagamento livre, nome longo) abre igual no documento", async () => {
    const { default: Imprimir } = await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    const h = renderToStaticMarkup(await Imprimir({ params: Promise.resolve({ token: "tok-oRasc" }) }));
    const t = texto(h);
    expect(t).toContain("Forma de pagamento PIX à vista ou boleto em 2x");
    expect(t).toContain(NOME_LONGO);
    expect(t).toContain("Serviço antigo 1 × R$ 100,00 1 100,00 100,00");
    expect(t).not.toMatch(/ISS/);
    expect(h).not.toContain("data-dados-bancarios");
  });
});
