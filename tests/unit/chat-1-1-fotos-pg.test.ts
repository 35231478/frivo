/**
 * CHAT-1.1 — a foto INTEIRA do chat (os_comentarios_fotos.conteudo, data URL em texto) NUNCA é lida por uma listagem
 * nem pelo tempo real: só a miniatura vai nas conversas; o conteúdo sai do banco só ao AMPLIAR (a rota da foto).
 * No PostgreSQL real, pelas rotas reais, registrando TODO SQL que o Prisma manda ao banco:
 *  - nenhuma consulta das rotas de lista, conversa, tempo real, sino, retrato do app e comentários da OS lê a coluna;
 *  - nenhuma resposta delas traz o conteúdo (marcado) — e o tamanho delas é o das miniaturas, não o das fotos;
 *  - a rota da foto (ampliar) lê e devolve o conteúdo (o controle: o registro do SQL funciona).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/chat-1-1-fotos-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { SEM_OS } from "@/lib/tecnico/despesas";
import { JPEG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_chat11f_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/push/servidor", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/servidor")>()),
  usuariosComAparelho: vi.fn(async () => []),
  enviarPush: vi.fn(async () => ({ enviados: 0 })),
}));

const TOTAIS = permissoesTotais();
const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "uA", email: "uA@clima.test", empresaId: "e1", role: "ADMIN", permissoes: TOTAIS, tecnicoId: null } }; };
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "uT", email: "joao@clima.test", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };

async function chamar(rota: string, params: Record<string, string> = {}, qs = "", metodo = "GET", corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${qs}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, corpo: await res.text() };
}

/** A foto inteira de cada mensagem leva esta marca: se aparecer numa resposta, o conteúdo vazou */
const MARCA = "FOTO-INTEIRA-NAO-PODE-SAIR";
const MINIATURA = `data:image/jpeg;base64,${"M".repeat(20_000)}`; // ~20 KB, como as miniaturas medidas (3–40 KB)
const FOTO = `data:image/jpeg;base64,${MARCA}${"F".repeat(400_000)}`; // ~400 KB, como uma foto típica depois da compressão
const N_FOTOS = 30;
/** O SQL que lê a coluna da foto inteira (o Prisma qualifica: "schema"."os_comentarios_fotos"."conteudo") */
const LE_CONTEUDO = /"os_comentarios_fotos"\."conteudo"/;

describe.skipIf(!URL_PG)("CHAT-1.1: a foto inteira só sai do banco ao ampliar (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  const consultas: string[] = [];
  let fotoId = "";

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    // O mesmo cliente que as rotas usam (lib/prisma lê o global), registrando cada SQL
    prisma = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: "event", level: "query" }] });
    (prisma as any).$on("query", (e: { query: string }) => consultas.push(e.query));
    (globalThis as any).prisma = prisma;
    expect((await import("@/lib/prisma")).prisma).toBe(prisma);

    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total (fictícia)", cnpj: "12.345.678/0001-90", email: "contato@clima.test" } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "uA@clima.test", senha: "x", role: "ADMIN" },
      { id: "uT", empresaId: "e1", nome: "João Técnico", email: "joao@clima.test", senha: "x", role: "TECNICO" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.test" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "1" } });
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-0001", clienteId: "c1", criadoPorId: "uA", descricao: "Manutenção" } });
    await prisma.atividadeOs.create({ data: { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Corretiva", tecnicoId: "t1", status: "EM_ANDAMENTO" } });
    for (let i = 0; i < N_FOTOS; i++) {
      await prisma.osComentario.create({ data: {
        id: `f${i}`, empresaId: "e1", ordemServicoId: i % 2 ? "os1" : null, atividadeId: i % 2 ? "a1" : null, usuarioId: "uT", autorNome: "João Técnico", origem: "APP",
        texto: `Foto ${i}`, clientId: `cf${i}`, criadoEm: new Date(Date.UTC(2026, 10, 12, 12, i)),
        foto: { create: { empresaId: "e1", tipo: "image/jpeg", tamanho: 300_000, conteudo: FOTO, miniatura: MINIATURA } },
      } });
    }
    fotoId = (await prisma.osComentarioFoto.findFirstOrThrow({ where: { comentarioId: "f1" }, select: { id: true } })).id;
    // Uma foto de verdade pela fila do app (o caminho da gravação também não relê o conteúdo)
    comoTecnico();
    const r = await chamar("tecnico/sync", {}, "", "POST", { operacoes: [{ id: randomUUID(), tipo: "comentario", atividadeId: SEM_OS, em: new Date().toISOString(),
      dados: { clientId: "real-1", texto: "", foto: dataUrl("image/jpeg", JPEG), miniatura: dataUrl("image/jpeg", JPEG) } }] });
    expect(JSON.parse(r.corpo).resultados[0].ok).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const ROTAS_ESCRITORIO: [string, Record<string, string>, string][] = [
    ["conversas", {}, ""], ["conversas/[osId]", { osId: "os1" }, ""], ["conversas/novidades", {}, ""], ["conversas/pessoas", {}, ""],
    ["conversas/pessoas/[usuarioId]", { usuarioId: "uT" }, ""], ["conversas/pessoas/[usuarioId]", { usuarioId: "uT" }, "?ate=f0"],
    ["ordens/[id]/comentarios", { id: "os1" }, ""], ["alertas", {}, ""],
  ];
  const ROTAS_APP: [string, Record<string, string>, string][] = [
    ["tecnico/conversas", {}, ""], ["tecnico/conversas", {}, "?ate=f0"], ["tecnico/conversas/novidades", {}, ""], ["tecnico/atividades/[atividadeId]", { atividadeId: "a1" }, ""],
  ];

  it("nenhuma listagem, conversa, tempo real, sino ou retrato lê a coluna da foto inteira — nem a devolve", async () => {
    for (const [lista, quem] of [[ROTAS_ESCRITORIO, comoAdmin], [ROTAS_APP, comoTecnico]] as const) {
      for (const [rota, params, qs] of lista) {
        quem();
        consultas.length = 0;
        const r = await chamar(rota, params, qs);
        expect(r.status, `${rota}${qs}`).toBe(200);
        expect(consultas.length, `${rota}: o registro do SQL funciona`).toBeGreaterThan(0);
        expect(consultas.filter((q) => LE_CONTEUDO.test(q)), `${rota}${qs} leu os_comentarios_fotos.conteudo`).toEqual([]);
        expect(r.corpo.includes(MARCA), `${rota}${qs} devolveu a foto inteira`).toBe(false);
      }
    }
  });

  it("a conversa com 30 fotos pesa o das miniaturas (≈ 20 KB cada), não o das fotos (≈ 400 KB cada)", async () => {
    comoAdmin();
    const r = await chamar("conversas/pessoas/[usuarioId]", { usuarioId: "uT" });
    const kb = r.corpo.length / 1024;
    expect(kb).toBeGreaterThan(N_FOTOS * 19); // as miniaturas estão lá
    expect(kb).toBeLessThan(N_FOTOS * 20 + 60); // e só elas: 30 fotos inteiras dariam ~12 MB
  });

  it("ampliar: a rota da foto lê e devolve o conteúdo (o controle do teste) — uma foto por vez", async () => {
    for (const [rota, quem] of [["conversas/fotos/[fotoId]", comoAdmin], ["tecnico/conversas/fotos/[fotoId]", comoTecnico]] as const) {
      quem();
      consultas.length = 0;
      const r = await chamar(rota, { fotoId });
      expect(r.status, rota).toBe(200);
      expect(consultas.filter((q) => LE_CONTEUDO.test(q)).length, rota).toBe(1);
    }
  });
});
