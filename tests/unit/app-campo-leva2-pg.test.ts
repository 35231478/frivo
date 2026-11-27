/**
 * App de campo, leva 2 (PR A) — rotas reais, Prisma real, PostgreSQL real:
 *  - garantia: o retrato e a ficha levam o fim da garantia do cadastro;
 *  - comentários: o técnico comenta pela fila (idempotente; também na atividade concluída; só nas OS dele); o retrato
 *    traz a conversa com "meu"; o escritório lê (marca lido) e responde; o sino conta as OS com comentário do campo
 *    não lido (nunca para o técnico; o do escritório não conta); o modo técnico não usa as rotas do escritório; o
 *    relatório e o link do cliente não leem comentários.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/app-campo-leva2-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { inicioHojeBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_app_campo_l2a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const comoTecnico = (tecnicoId = "t1", id = "uT", email = "joao@clima.com") => {
  sessao.atual = { user: { id, name: "João", email, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};
const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), id = "uA", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@clima.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });
const sync = async (operacoes: unknown[]) => (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[];
const comentar = (atividadeId: string, clientId: string, texto: string) => op("comentario", atividadeId, { dados: { clientId, texto } });
const H = 3_600_000;

describe.skipIf(!URL_PG)("app de campo, leva 2 (PR A): garantia e comentários (PostgreSQL real)", () => {
  let prisma: any;
  const hoje = inicioHojeBR();
  const retrato = async (atividadeId: string) => (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId })).json;
  const sino = async () => (await chamar("alertas", "GET")).json;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "tecnico/atividades/[atividadeId]", "tecnico/equipamentos/qr", "ordens/[id]/comentarios", "alertas"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Maria Souza", email: "maria@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "uA@clima.com", senha: "x" },
      { id: "uB", empresaId: "e1", nome: "Bia Escritório", email: "uB@clima.com", senha: "x" },
      { id: "uE2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "2", email: "maria@clima.com" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "1" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    const eq = (id: string, nome: string, garantiaAte: Date | null) => ({ id, empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTXS", nome, garantiaAte });
    await prisma.equipamento.createMany({ data: [eq("eqG", "Com garantia", new Date("2028-03-24T11:00:00Z")), eq("eqS", "Sem garantia", null)] });
    await prisma.qrcode.create({ data: { empresaId: "e1", codigo: "QR-G", equipamentoId: "eqG", tokenPublico: "tok-G" } });
    const os = (id: string, numero: string) => ({ id, empresaId: "e1", numero, clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Preventiva" });
    await prisma.ordemServico.createMany({ data: [os("osA", "OS-1"), os("osM", "OS-2"), os("osC", "OS-3")] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aA", empresaId: "e1", ordemServicoId: "osA", titulo: "Preventiva", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "EM_ANDAMENTO" },
      { id: "aM", empresaId: "e1", ordemServicoId: "osM", titulo: "Da Maria", tecnicoId: "t2", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "EM_ANDAMENTO" },
      { id: "aC", empresaId: "e1", ordemServicoId: "osC", titulo: "Concluída", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 8 * H), status: "CONCLUIDA" },
    ] });
    await prisma.atividadeEquipamento.createMany({ data: [{ atividadeId: "aA", equipamentoId: "eqG" }, { atividadeId: "aA", equipamentoId: "eqS" }] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("garantia", () => {
    it("o retrato (equipamentos da OS e da unidade) e a ficha levam o fim da garantia; sem garantia, null", async () => {
      comoTecnico();
      const r = await retrato("aA");
      const g = r.execucao.equipamentos.find((e: any) => e.equipamento.id === "eqG");
      expect(g.equipamento.garantiaAte).toBe("2028-03-24T11:00:00.000Z");
      expect(r.execucao.equipamentos.find((e: any) => e.equipamento.id === "eqS").equipamento.garantiaAte).toBeNull();
      expect(r.equipamentosUnidade.find((e: any) => e.id === "eqG").garantiaAte).toBe("2028-03-24T11:00:00.000Z");
      // Ficha pelo QR (fora das OS de hoje: o João não está em nenhuma com o eqG? está na aA → manda abrir a OS; a ficha ainda traz o dado)
      const f = (await chamar("tecnico/equipamentos/qr", "GET", {}, undefined, "?valor=QR-G")).json;
      expect(f.equipamento.garantiaAte).toBe("2028-03-24T11:00:00.000Z");
    });
  });

  describe("comentários pelo app", () => {
    it("o técnico comenta pela fila: grava com autor e origem APP; reenviar ou repetir o clientId não duplica", async () => {
      comoTecnico();
      const o = comentar("aA", "k1", "  Condensadora com ruído no ventilador.  ");
      const [r1] = await sync([o]);
      expect(r1).toMatchObject({ ok: true, status: 201 });
      expect((await sync([o]))[0]).toMatchObject({ ok: true, repetida: true });
      expect((await sync([comentar("aA", "k1", "outro texto")]))[0]).toMatchObject({ ok: true, status: 200 });
      await Promise.all([1, 2, 3].map(() => sync([comentar("aA", "k2", "Simultâneo")])));
      const linhas = await prisma.osComentario.findMany({ where: { ordemServicoId: "osA" }, orderBy: { criadoEm: "asc" } });
      expect(linhas.map((l: any) => [l.clientId, l.texto, l.origem, l.autorNome, l.atividadeId])).toEqual([
        ["k1", "Condensadora com ruído no ventilador.", "APP", "João Silva", "aA"], ["k2", "Simultâneo", "APP", "João Silva", "aA"],
      ]);
    });
    it("vale com a atividade concluída; nunca na OS de outro técnico; texto vazio é recusado", async () => {
      comoTecnico();
      expect((await sync([comentar("aC", "k3", "Esqueci de avisar: dreno entupido.")]))[0]).toMatchObject({ ok: true });
      expect((await sync([comentar("aM", "k4", "Não é minha")]))[0]).toMatchObject({ ok: false, status: 403 });
      expect((await sync([comentar("aA", "k5", "   ")]))[0]).toMatchObject({ ok: false, status: 400 });
      expect(await prisma.osComentario.count({ where: { clientId: { in: ["k4", "k5"] } } })).toBe(0);
      // O mesmo clientId noutra OS: recusado
      expect((await sync([comentar("aC", "k1", "Reaproveitado")]))[0]).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe("escritório", () => {
    it("o sino acende para quem vê OS (por OS, a mais recente); nunca para o técnico", async () => {
      comoEscritorio();
      const s = await sino();
      expect(s.comentariosCampo).toBe(2); // osA e osC
      expect(s.comentarioCampoOsId).toBe("osC");
      comoEscritorio(montarPermissoes({ financeiro: ["visualizar"] } as never));
      expect((await sino()).comentariosCampo).toBe(0);
      comoTecnico();
      expect((await sino()).comentariosCampo).toBe(0);
    });
    it("ler marca como lido só para quem leu; responder grava com origem ESCRITORIO e não acende o sino", async () => {
      comoEscritorio();
      const r = await chamar("ordens/[id]/comentarios", "GET", { id: "osA" });
      expect(r.status).toBe(200);
      expect(r.json.comentarios.map((c: any) => [c.texto, c.origem, c.autor, c.meu])).toEqual([
        ["Condensadora com ruído no ventilador.", "APP", "João Silva", false], ["Simultâneo", "APP", "João Silva", false],
      ]);
      expect((await sino()).comentariosCampo).toBe(1); // só a osC
      comoEscritorio(permissoesTotais(), "uB");
      expect((await sino()).comentariosCampo).toBe(2); // a Bia não leu nada
      comoEscritorio();
      const p = await chamar("ordens/[id]/comentarios", "POST", { id: "osA" }, { texto: "Peça pedida. Chega amanhã." });
      expect(p.status).toBe(201);
      expect(p.json.comentario).toMatchObject({ origem: "ESCRITORIO", autor: "Ana Escritório", meu: true, texto: "Peça pedida. Chega amanhã." });
      expect((await sino()).comentariosCampo).toBe(1);
      expect((await chamar("ordens/[id]/comentarios", "POST", { id: "osA" }, { texto: "  " })).status).toBe(400);
    });
    it("um comentário novo do campo depois da leitura acende de novo; comentário antigo (fora da janela) não", async () => {
      comoTecnico();
      await sync([comentar("aA", "k6", "Peça recebida, obrigado.")]);
      comoEscritorio();
      expect((await sino()).comentariosCampo).toBe(2);
      await prisma.osComentario.updateMany({ where: { ordemServicoId: "osC" }, data: { criadoEm: new Date(Date.now() - 31 * 24 * H) } });
      expect((await sino()).comentariosCampo).toBe(1);
    });
    it("o técnico vê a conversa no retrato, com 'meu' certo e a resposta do escritório", async () => {
      comoTecnico();
      const r = await retrato("aA");
      expect(r.execucao.comentarios.map((c: any) => [c.texto, c.origem, c.meu])).toEqual([
        ["Condensadora com ruído no ventilador.", "APP", true], ["Simultâneo", "APP", true],
        ["Peça pedida. Chega amanhã.", "ESCRITORIO", false], ["Peça recebida, obrigado.", "APP", true],
      ]);
    });
    it("permissões: responder pede OS › Editar; o modo técnico não usa as rotas do escritório; outra empresa não encontra", async () => {
      comoEscritorio(montarPermissoes({ ordens: ["visualizar"] } as never));
      expect((await chamar("ordens/[id]/comentarios", "GET", { id: "osA" })).status).toBe(200);
      expect((await chamar("ordens/[id]/comentarios", "POST", { id: "osA" }, { texto: "x" })).status).toBe(403);
      comoTecnico();
      expect((await chamar("ordens/[id]/comentarios", "GET", { id: "osA" })).status).toBe(403);
      expect((await chamar("ordens/[id]/comentarios", "POST", { id: "osA" }, { texto: "x" })).status).toBe(403);
      comoEscritorio(permissoesTotais(), "uE2", "e2");
      expect((await chamar("ordens/[id]/comentarios", "GET", { id: "osA" })).status).toBe(404);
      expect((await chamar("ordens/[id]/comentarios", "POST", { id: "osA" }, { texto: "x" })).status).toBe(404);
    });
    it("o cliente nunca vê: relatório, PDF e link do aceite não leem os comentários", () => {
      const arquivos = ["lib/relatorio-os", "lib/relatorio-atividade", "app/(publico)/relatorio", "lib/os/aceite-server.ts"].flatMap((p) => {
        const abs = path.join(RAIZ, p);
        if (!fs.existsSync(abs)) return [];
        return fs.statSync(abs).isDirectory() ? fs.readdirSync(abs, { recursive: true }).map((f) => path.join(abs, String(f))).filter((f) => /\.tsx?$/.test(f)) : [abs];
      });
      expect(arquivos.length).toBeGreaterThan(0);
      for (const f of arquivos) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/osComentario|os_comentarios/);
    });
  });
});
