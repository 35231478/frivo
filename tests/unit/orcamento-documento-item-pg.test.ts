// @vitest-environment happy-dom
/**
 * Documento do orçamento com o Prisma real num PostgreSQL real:
 *  - título das páginas públicas (link e /imprimir) = nome do PDF "Orçamento 2026-0015 - CLIENTE",
 *    sem o " | Frivo" e sem caracteres inválidos; token que não existe = "Orçamento";
 *  - a página de impressão separa o item pelo nome ATUAL do catálogo (include do documento) e deixa
 *    o item antigo digitado à mão como estava.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/orcamento-documento-item-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_orc_doc_item_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: () => { throw new Error("NEXT_REDIRECT"); },
}));

describe.skipIf(!URL_PG)("Documento do orçamento: título do PDF e item do catálogo (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total Ltda", cnpj: "12345678000190", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "CENTRO DE ATIVIDADES SESI RIO VERDE", cpfCnpj: "22101333000111" },
      { id: "c2", empresaId: "e1", nome: 'Hospital S/A: "Matriz" | BH', cpfCnpj: "11444777000161" },
    ] });
    await prisma.servico.create({ data: { id: "s1", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza de Filtro", descricao: "Higienização completa" } });
    await prisma.servico.create({ data: { id: "s2", empresaId: "e1", codigo: "SPLI01", nome: "Split — 12.000 BTUs", descricao: "Instalação padrão" } });
    await prisma.produto.createMany({ data: [
      { id: "p1", empresaId: "e1", codigo: 1, nome: "Capacitor 35uF (novo nome)" },
      { id: "p2", empresaId: "e1", codigo: 2, nome: "Tubo — 1/4 pol" },
    ] });
    await prisma.orcamento.createMany({ data: [
      { id: "o1", empresaId: "e1", codigo: "ORC-2026-0015", nome: "Manutenção", clienteId: "c1", criadoPorId: "u1", tokenPublico: "tok-1", totalServicos: 380, totalProdutos: 60, totalGeral: 440 },
      { id: "o2", empresaId: "e1", codigo: "ORC-2026-0016", nome: "Outro", clienteId: "c2", criadoPorId: "u1", tokenPublico: "tok-2" },
    ] });
    await prisma.orcamentoServico.createMany({ data: [
      { orcamentoId: "o1", servicoId: "s1", descricao: "Limpeza de Filtro — Higienização completa", quantidade: 1, valorUnitario: 80, valorTotal: 80, observacao: "2º andar", ordem: 0 },
      { orcamentoId: "o1", descricao: "Instalação — 2 aparelhos", quantidade: 1, valorUnitario: 300, valorTotal: 300, ordem: 1 },
      // Nome do catálogo com " — ": só o nome atual (include do documento) separa no lugar certo
      { orcamentoId: "o1", servicoId: "s2", descricao: "Split — 12.000 BTUs — Instalação padrão", quantidade: 1, valorUnitario: 0, valorTotal: 0, ordem: 2 },
    ] });
    // Produto renomeado depois de entrar no orçamento: separa no 1º " — "
    await prisma.orcamentoProduto.createMany({ data: [
      { orcamentoId: "o1", produtoId: "p1", descricao: "Capacitor 35uF — Duplo", quantidade: 2, valorUnitario: 30, valorTotal: 60, ordem: 0 },
      { orcamentoId: "o1", produtoId: "p2", descricao: "Tubo — 1/4 pol — Cobre flexível", quantidade: 1, valorUnitario: 0, valorTotal: 0, ordem: 1 },
    ] });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const meta = async (rota: string, token: string) => {
    const mod = await import(/* @vite-ignore */ `@/app/(publico)/orcamento/[token]/${rota}`);
    return mod.generateMetadata({ params: Promise.resolve({ token }) });
  };

  it("título = nome do PDF nas duas páginas (absoluto, sem ' | Frivo'), limpo e sem indexar", async () => {
    for (const rota of ["imprimir/page", "page"]) {
      const m = await meta(rota, "tok-1");
      expect(m.title).toEqual({ absolute: "Orçamento 2026-0015 - CENTRO DE ATIVIDADES SESI RIO VERDE" });
      expect(m.robots).toEqual({ index: false, follow: false });
      expect((await meta(rota, "tok-2")).title).toEqual({ absolute: "Orçamento 2026-0016 - Hospital S A Matriz BH" });
      expect((await meta(rota, "nao-existe")).title).toEqual({ absolute: "Orçamento" });
    }
  });

  it("impressão: item do catálogo em nome + descrição + Obs.; renomeado separa no ' — '; à mão fica inteiro", async () => {
    const { default: Pagina } = await import("@/app/(publico)/orcamento/[token]/imprimir/page");
    const html = renderToStaticMarkup(await Pagina({ params: Promise.resolve({ token: "tok-1" }) }));
    const d = document.createElement("div");
    d.innerHTML = html;
    const linhas = (g: string) => [...d.querySelectorAll(`[data-grupo-documento='${g}'] tr[data-linha-item]`)].map((tr) =>
      [...tr.querySelectorAll("[data-nome-item], [data-descricao-item], [data-observacao-item]")].map((e) => e.textContent));
    expect(linhas("serviços")).toEqual([
      ["Limpeza de Filtro", "Higienização completa", "Obs.: 2º andar"], ["Instalação — 2 aparelhos"], ["Split — 12.000 BTUs", "Instalação padrão"],
    ]);
    expect(linhas("produtos")).toEqual([["Capacitor 35uF", "Duplo"], ["Tubo — 1/4 pol", "Cobre flexível"]]);
  });
});
