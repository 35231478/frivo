/**
 * Segurança — relatório PÚBLICO de atividade só abre com o token (falha C12 da auditoria).
 * Prisma real num PostgreSQL real (schema descartável via `prisma db push`, com o padrão do banco que
 * gera o token), a página pública e as rotas de verdade:
 *  - sem token, token errado, token de outra atividade/empresa, id inexistente → a MESMA 404;
 *  - token certo → abre;
 *  - enumerar ids não abre nada; o banco é consultado só pelo token (o id não muda o caminho);
 *  - os links do sistema (aba Relatórios da OS e histórico do equipamento) já vêm com o token;
 *  - "Gerar novo link": troca o token, o antigo vira 404; exige OS › editar e a empresa da sessão.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/relatorio-atividade-token-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesVazias, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_reltok_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const FORMATO = /^[A-Za-z0-9_-]{43}$/;

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); },
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}));

function logar(empresaId: string, role: "ADMIN" | "OPERADOR" = "ADMIN", permissoes: Permissoes = permissoesVazias()) {
  sessao.atual = { user: { id: `u-${empresaId}`, name: "Ana", email: "a@x.com", empresaId, role, permissoes } };
}
const comOrdens = (...acoes: string[]) => { const p = permissoesVazias(); (p as any).ordens = Object.fromEntries(acoes.map((a) => [a, true])); return p; };

describe.skipIf(!URL_PG)("relatório público de atividade exige token (PostgreSQL real)", () => {
  let prisma: any;
  const tk: Record<string, string> = {};

  /** Abre a página pública como o navegador abriria a URL (path + query). */
  async function abrir(url: string) {
    const u = new URL(url, "http://frivo.test");
    const id = decodeURIComponent(u.pathname.replace(/^\/relatorio\/atividade\//, ""));
    const t = u.searchParams.getAll("t");
    const { default: Pagina } = await import("@/app/(publico)/relatorio/atividade/[id]/page");
    return renderToStaticMarkup(await Pagina({ params: Promise.resolve({ id }), searchParams: Promise.resolve(t.length === 0 ? {} : { t: t.length === 1 ? t[0] : t }) }));
  }
  /** O que a página respondeu: "ABRIU" ou a mensagem do erro (404 = NEXT_NOT_FOUND). */
  const resposta = (url: string) => abrir(url).then(() => "ABRIU", (e: Error) => e.message);
  const link = (id: string, token: string) => `/relatorio/atividade/${id}?t=${token}`;

  const relatoriosDaOs = async (osId: string) => {
    const { GET } = await import("@/app/api/ordens/[id]/relatorios/route");
    return GET(new NextRequest(`http://frivo.test/api/ordens/${osId}/relatorios`), { params: Promise.resolve({ id: osId }) });
  };
  const gerarNovo = async (osId: string, atividadeId: string) => {
    const { POST } = await import("@/app/api/ordens/[id]/atividades/[atividadeId]/link-relatorio/route");
    return POST(new NextRequest(`http://frivo.test/api/ordens/${osId}/atividades/${atividadeId}/link-relatorio`, { method: "POST" }), { params: Promise.resolve({ id: osId, atividadeId }) });
  };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    for (const [e, cnpj] of [["e1", "11.111.111/0001-11"], ["e2", "22.222.222/0001-22"]]) {
      await prisma.empresa.create({ data: { id: e, nome: e === "e1" ? "Clima Total" : "Gelo Norte", cnpj, email: `${e}@x.com` } });
      await prisma.usuario.create({ data: { id: `u-${e}`, empresaId: e, nome: "Ana", email: `ana@${e}.com`, senha: "x" } });
    }
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Shopping Norte", cpfCnpj: "33.333.333/0001-33" } });
    await prisma.cliente.create({ data: { id: "c2", empresaId: "e2", nome: "Hospital Sul", cpfCnpj: "44.444.444/0001-44" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Loja 12" } });
    await prisma.equipamento.create({ data: { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTX" } });
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", unidadeId: "un1", criadoPorId: "u-e1", descricao: "Preventiva" } });
    await prisma.ordemServico.create({ data: { id: "os2", empresaId: "e2", numero: "OS-1", clienteId: "c2", criadoPorId: "u-e2", descricao: "Corretiva" } });
    // o app NÃO manda token: o banco gera
    for (const [id, os, emp, titulo] of [["a1", "os1", "e1", "Limpeza do split da loja 12"], ["a2", "os1", "e1", "Troca de filtro"], ["b1", "os2", "e2", "Vazamento UTI"]]) {
      const a = await prisma.atividadeOs.create({ data: { id, ordemServicoId: os, empresaId: emp, titulo, status: "CONCLUIDA" } });
      tk[id] = a.tokenRelatorio;
    }
    await prisma.atividadeEquipamento.create({ data: { atividadeId: "a1", equipamentoId: "eq1", feito: true } });
    // Carrega (compila) a página e as rotas uma vez, fora do tempo de cada teste
    await Promise.all([
      import("@/app/(publico)/relatorio/atividade/[id]/page"), import("@/app/api/ordens/[id]/relatorios/route"),
      import("@/app/api/ordens/[id]/atividades/[atividadeId]/link-relatorio/route"), import("@/lib/equipamento-historico"),
    ]);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("toda atividade nasce com token do banco: 43 caracteres base64url (32 bytes), um por atividade", async () => {
    await prisma.atividadeOs.createMany({ data: Array.from({ length: 60 }, (_, n) => ({ id: `m${n}`, ordemServicoId: "os2", empresaId: "e2", titulo: `Lote ${n}` })) });
    const todos = (await prisma.atividadeOs.findMany({ select: { tokenRelatorio: true } })).map((a: any) => a.tokenRelatorio);
    expect(todos).toHaveLength(63);
    expect(todos.every((t: string) => FORMATO.test(t) && Buffer.from(t, "base64url").length === 32)).toBe(true);
    expect(new Set(todos).size).toBe(63);
    await prisma.atividadeOs.deleteMany({ where: { id: { startsWith: "m" } } });
  });

  it("token certo: abre o relatório (cliente, atividade e equipamento)", async () => {
    const html = await abrir(link("a1", tk.a1));
    expect(html).toContain("Limpeza do split da loja 12");
    expect(html).toContain("Shopping Norte");
    expect(await resposta(link("b1", tk.b1))).toBe("ABRIU");
  });

  it("a página não é indexada e não manda o endereço (com o token) como Referer para outros sites", async () => {
    const { metadata } = await import("@/app/(publico)/relatorio/atividade/[id]/page");
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" });
  });

  it("sem token (o link antigo), token errado, token de outra atividade ou empresa, id inexistente: a MESMA 404", async () => {
    const casos = {
      "link antigo, só o id": "/relatorio/atividade/a1",
      "t vazio": "/relatorio/atividade/a1?t=",
      "token errado no formato certo": link("a1", randomBytes(32).toString("base64url")),
      "token quase certo (1 letra trocada)": link("a1", (tk.a1[0] === "A" ? "B" : "A") + tk.a1.slice(1)),
      "token certo cortado": link("a1", tk.a1.slice(0, 42)),
      "token certo + 1 letra": link("a1", `${tk.a1}A`),
      "token em maiúsculas": link("a1", tk.a1.toUpperCase() === tk.a1 ? tk.a1.toLowerCase() : tk.a1.toUpperCase()),
      "token da outra atividade da mesma OS": link("a1", tk.a2),
      "token de outra empresa": link("a1", tk.b1),
      "id inexistente + token qualquer": link("nao-existe", randomBytes(32).toString("base64url")),
      "id inexistente + token válido de outro": link("nao-existe", tk.a1),
      "dois t (o certo e outro)": `${link("a1", tk.a1)}&t=${tk.a2}`,
      "token com injeção": link("a1", encodeURIComponent("' OR '1'='1")),
    };
    const obtido = Object.fromEntries(await Promise.all(Object.entries(casos).map(async ([k, u]) => [k, await resposta(u)])));
    expect(obtido).toEqual(Object.fromEntries(Object.keys(casos).map((k) => [k, "NEXT_NOT_FOUND"])));
  });

  it("enumerar ids não abre nada: todo id, sem token ou com o token de outra, dá 404; só o par exato abre", async () => {
    const ids = (await prisma.atividadeOs.findMany({ select: { id: true } })).map((a: any) => a.id);
    expect(ids.sort()).toEqual(["a1", "a2", "b1"]);
    for (const id of ids) {
      expect(await resposta(`/relatorio/atividade/${id}`)).toBe("NEXT_NOT_FOUND");
      for (const outro of ids) expect(await resposta(link(id, tk[outro]))).toBe(outro === id ? "ABRIU" : "NEXT_NOT_FOUND");
    }
  });

  it("o banco é consultado SÓ pelo token (o id não muda o caminho); token fora do formato nem chega ao banco", async () => {
    // embrulha o findUnique de verdade (o delegate do Prisma é um proxy: vi.spyOn não restaura direito)
    const delegate = prisma.atividadeOs;
    const original = delegate.findUnique;
    const consultas: unknown[] = [];
    delegate.findUnique = (q: any) => { consultas.push(q.where); return original.call(delegate, q); };
    try {
      await resposta(link("a1", tk.a2));
      await resposta(link("nao-existe", tk.a2));
      expect(consultas).toEqual([{ tokenRelatorio: tk.a2 }, { tokenRelatorio: tk.a2 }]);
      consultas.length = 0;
      await resposta("/relatorio/atividade/a1?t=curto");
      await resposta("/relatorio/atividade/a1");
      expect(consultas).toEqual([]);
    } finally { delegate.findUnique = original; }
    expect(await resposta(link("a1", tk.a1))).toBe("ABRIU");
  });

  it("aba Relatórios da OS: cada atividade traz o link já com o token, e ele abre", async () => {
    logar("e1", "OPERADOR", comOrdens("visualizar"));
    const r = await relatoriosDaOs("os1");
    expect(r.status).toBe(200);
    const { resumo } = await r.json();
    expect(resumo.atividades.map((a: any) => [a.id, a.linkRelatorio])).toEqual([["a1", link("a1", tk.a1)], ["a2", link("a2", tk.a2)]]);
    expect(await resposta(resumo.atividades[0].linkRelatorio)).toBe("ABRIU");
    logar("e2", "OPERADOR", comOrdens("visualizar"));
    expect((await relatoriosDaOs("os1")).status).toBe(404); // empresa da sessão
  });

  it("histórico do equipamento: o link 'Relatório' já vem com o token", async () => {
    const { carregarHistoricoEquipamento } = await import("@/lib/equipamento-historico");
    const eventos = await carregarHistoricoEquipamento("e1", "eq1");
    expect(eventos.map((e) => [e.atividadeId, e.linkRelatorio])).toEqual([["a1", link("a1", tk.a1)]]);
    expect(await carregarHistoricoEquipamento("e2", "eq1")).toEqual([]);
  });

  it("gerar novo link: troca o token, o antigo vira 404 e o novo abre", async () => {
    logar("e1", "OPERADOR", comOrdens("visualizar", "editar"));
    const antigo = tk.a2;
    const r = await gerarNovo("os1", "a2");
    expect(r.status).toBe(200);
    const { link: novo } = await r.json();
    const novoToken = new URL(novo, "http://frivo.test").searchParams.get("t")!;
    expect(novoToken).toMatch(FORMATO);
    expect(novoToken).not.toBe(antigo);
    expect(novo).toBe(link("a2", novoToken));
    expect((await prisma.atividadeOs.findUnique({ where: { id: "a2" } })).tokenRelatorio).toBe(novoToken);
    expect(await resposta(link("a2", antigo))).toBe("NEXT_NOT_FOUND");
    expect(await resposta(novo)).toBe("ABRIU");
    expect(await resposta(link("a1", tk.a1))).toBe("ABRIU"); // as outras atividades não mudam
    tk.a2 = novoToken;
  });

  it("gerar novo link exige OS › editar, a empresa da sessão e a atividade daquela OS; sem isso nada muda", async () => {
    const tokensAntes = async () => (await prisma.atividadeOs.findMany({ orderBy: { id: "asc" }, select: { id: true, tokenRelatorio: true } }));
    const antes = await tokensAntes();
    sessao.atual = null;
    expect((await gerarNovo("os1", "a1")).status).toBe(401);
    logar("e1", "OPERADOR", comOrdens("visualizar", "concluir"));
    expect((await gerarNovo("os1", "a1")).status).toBe(403);
    logar("e2", "ADMIN");
    expect((await gerarNovo("os1", "a1")).status).toBe(404); // atividade de outra empresa
    logar("e1", "ADMIN");
    expect((await gerarNovo("os2", "b1")).status).toBe(404); // OS de outra empresa
    expect((await gerarNovo("os2", "a1")).status).toBe(404); // atividade que não é daquela OS
    expect((await gerarNovo("os1", "nao-existe")).status).toBe(404);
    expect(await tokensAntes()).toEqual(antes);
  });
});
