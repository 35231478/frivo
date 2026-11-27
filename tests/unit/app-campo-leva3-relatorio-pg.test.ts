/**
 * App de campo, leva 3 (PR B) — RELATÓRIO AO CLIENTE com rotas reais, Prisma real, PostgreSQL real:
 *  - o retrato do app traz o link público (com o token da atividade), a empresa e a OS; outra atividade fora do
 *    escopo do técnico não entrega link nenhum;
 *  - a página pública carrega os materiais usados (sem os removidos) e o aceite CONFIRMADO (assinatura no local);
 *  - o PDF abre com o mesmo token (medições fora do esperado, materiais, assinatura); sem o token certo, 404 —
 *    inclusive o token de OUTRA atividade e o token antigo depois de "Gerar novo link".
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/app-campo-leva3-relatorio-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { inicioHojeBR } from "@/lib/fuso";
import { PNG, dataUrl, textoDoPdf } from "./pmoc-pdf-util";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_app_campo_l3b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "joao@clima.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };
const comoEscritorio = () => { sessao.atual = { user: { id: "uA", name: "Ana", email: "uA@clima.com", empresaId: "e1", role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: null } }; };
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const res: Response = await mod[metodo](new NextRequest("http://localhost/api/x", { method: metodo }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function pdf(id: string, token?: string | null) {
  const mod = await import("@/app/(publico)/relatorio/atividade/[id]/pdf/route");
  const url = `http://localhost/relatorio/atividade/${id}/pdf${token == null ? "" : `?t=${encodeURIComponent(token)}`}`;
  return mod.GET(new NextRequest(url), { params: Promise.resolve({ id }) });
}
const H = 3_600_000;

describe.skipIf(!URL_PG)("app de campo, leva 3 (PR B): relatório ao cliente (PostgreSQL real)", () => {
  let prisma: any;
  const token = async (id: string) => (await prisma.atividadeOs.findUnique({ where: { id }, select: { tokenRelatorio: true } })).tokenRelatorio as string;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/atividades/[atividadeId]", "ordens/[id]/atividades/[atividadeId]/link-relatorio"].map((x) => import(/* @vite-ignore */ `@/app/api/${x}/route`)));
    await import("@/app/(publico)/relatorio/atividade/[id]/pdf/route");
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total Ltda", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana", email: "uA@clima.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" },
      { id: "t2", empresaId: "e1", nome: "Outro Técnico", cpf: "2", telefone: "2", email: "outro@clima.com" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Clínica Exemplo", cpfCnpj: "12345678000199" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "tSplit", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "iFiltro", empresaId: "e1", tipoEquipamentoId: "tSplit", texto: "Limpeza dos filtros de ar", ordem: 1 },
      { id: "iSuc", empresaId: "e1", tipoEquipamentoId: "tSplit", texto: "Pressão de sucção", tipoResposta: "MEDICAO", unidade: "psi", ordem: 2, grandeza: "SUCCAO", valorMin: 115, valorMax: 140 },
    ] });
    const eq = (id: string, nome: string) => ({ id, empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "tSplit", marca: "Daikin", modelo: "FTXS", nome });
    await prisma.equipamento.createMany({ data: [eq("eq1", "Split consultório 1"), eq("eq2", "Split consultório 2")] });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-1301", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Preventiva", status: "CONCLUIDA" },
      { id: "os2", empresaId: "e1", numero: "OS-1302", clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Outra" },
    ] });
    const hoje = inicioHojeBR();
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva mensal PMOC", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "CONCLUIDA" },
      { id: "a2", empresaId: "e1", ordemServicoId: "os2", titulo: "Corretiva", tecnicoId: "t2", dataAgendada: new Date(hoje.getTime() + 10 * H), status: "CONCLUIDA" },
    ] });
    await prisma.atividadeEquipamento.createMany({ data: [
      { atividadeId: "a1", equipamentoId: "eq1", feito: true, feitoEm: new Date() }, { atividadeId: "a1", equipamentoId: "eq2", feito: true, feitoEm: new Date() },
    ] });
    await prisma.checklistResposta.createMany({ data: [
      { empresaId: "e1", atividadeId: "a1", equipamentoId: "eq1", itemId: "iFiltro", textoItem: "Limpeza dos filtros de ar", status: "OK" },
      { empresaId: "e1", atividadeId: "a1", equipamentoId: "eq1", itemId: "iSuc", textoItem: "Pressão de sucção", valor: 95, unidade: "psi", faixaMin: 115, faixaMax: 140, foraDaFaixa: true },
    ] });
    await prisma.atividadeMaterial.createMany({ data: [
      { id: "m1", empresaId: "e1", ordemServicoId: "os1", atividadeId: "a1", equipamentoId: "eq2", descricao: "Fluido refrigerante R-410A", unidade: "kg", quantidade: 0.8, clientId: "m1", criadoEm: new Date(Date.now() - 3000) },
      { id: "m2", empresaId: "e1", ordemServicoId: "os1", atividadeId: "a1", descricao: "Filtro de ar lavável", unidade: "un", quantidade: 3, clientId: "m2", criadoEm: new Date(Date.now() - 2000) },
      { id: "m3", empresaId: "e1", ordemServicoId: "os1", atividadeId: "a1", descricao: "Lançado por engano", unidade: "un", quantidade: 1, clientId: "m3", removidoEm: new Date() },
      { id: "m4", empresaId: "e1", ordemServicoId: "os2", atividadeId: "a2", descricao: "De outra atividade", unidade: "un", quantidade: 1, clientId: "m4" },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("no app", () => {
    it("o retrato traz o link com o token da atividade, a empresa (nome fantasia) e a OS", async () => {
      comoTecnico();
      const r = await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "a1" });
      expect(r.status).toBe(200);
      expect(r.json.relatorio).toEqual({ link: `/relatorio/atividade/a1?t=${await token("a1")}`, empresa: "Clima Total", osNumero: "OS-1301" });
      expect(JSON.stringify(r.json.relatorio)).not.toContain("Clínica");
    });

    it("atividade de outro técnico: recusa e não entrega link", async () => {
      comoTecnico();
      const r = await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "a2" });
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.json)).not.toContain(await token("a2"));
    });
  });

  describe("a página pública", () => {
    it("materiais usados desta atividade (sem os removidos), na ordem em que foram lançados", async () => {
      const { carregarAtividade } = await import("@/lib/relatorio-server");
      const d = (await carregarAtividade("a1", await token("a1")))!;
      expect(d.materiais).toEqual([
        { id: "m1", descricao: "Fluido refrigerante R-410A", quantidade: 0.8, unidade: "kg", equipamento: "Split consultório 2" },
        { id: "m2", descricao: "Filtro de ar lavável", quantidade: 3, unidade: "un", equipamento: null },
      ]);
    });

    it("aceite: pendente não aparece; confirmado no local traz nome, assinatura e quando; pelo link, sem assinatura", async () => {
      const { carregarAtividade } = await import("@/lib/relatorio-server");
      await prisma.osAceite.create({ data: { id: "ac1", empresaId: "e1", ordemServicoId: "os1", token: "tok-aceite-1", situacao: "PENDENTE" } });
      expect((await carregarAtividade("a1", await token("a1")))!.aceite).toBeNull();
      const quando = new Date("2026-11-27T15:00:00Z");
      await prisma.osAceite.update({ where: { id: "ac1" }, data: { situacao: "CONFIRMADO", metodo: "LOCAL", nome: "Carla Mendes", assinatura: dataUrl(PNG, "image/png"), confirmadoEm: quando, atividadeId: "a1" } });
      expect((await carregarAtividade("a1", await token("a1")))!.aceite).toEqual({ nome: "Carla Mendes", assinatura: dataUrl(PNG, "image/png"), confirmadoEm: quando, noLocal: true });
      // Confirmou pelo link (portal/WhatsApp): sem assinatura desenhada e "confirmou pelo link"
      await prisma.osAceite.update({ where: { id: "ac1" }, data: { metodo: "REMOTO", assinatura: null } });
      expect((await carregarAtividade("a1", await token("a1")))!.aceite).toEqual({ nome: "Carla Mendes", assinatura: null, confirmadoEm: quando, noLocal: false });
      await prisma.osAceite.update({ where: { id: "ac1" }, data: { metodo: "LOCAL", assinatura: dataUrl(PNG, "image/png") } });
    });
  });

  describe("o PDF", () => {
    it("abre com o token: PDF inline, sem cache, sem índice, com o nome do relatório", async () => {
      const res = await pdf("a1", await token("a1"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-disposition")).toBe(`inline; filename="relatorio.pdf"; filename*=UTF-8''${encodeURIComponent("Relatório RELATÓRIO - OS-1301.pdf")}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      const t = await textoDoPdf(bytes);
      for (const s of ["Clínica Exemplo", "OS-1301", "Split consultório 1", "Split consultório 2", "95 psi - FORA DO ESPERADO (115–140 psi)", "1 fora do esperado",
        "Fluido refrigerante R-410A", "0,8 kg", "Filtro de ar lavável", "Carla Mendes", "Cliente · assinou no local", "João Silva"]) expect(t, s).toContain(s);
      for (const s of ["Lançado por engano", "De outra atividade"]) expect(t, s).not.toContain(s);
    });

    it("sem o token certo, 404 — sem token, token errado, token de OUTRA atividade", async () => {
      expect((await pdf("a1", null)).status).toBe(404);
      expect((await pdf("a1", "x".repeat(43))).status).toBe(404);
      expect((await pdf("a1", "curto")).status).toBe(404);
      expect((await pdf("a1", await token("a2"))).status).toBe(404);
      expect((await pdf("a2", await token("a2"))).status).toBe(200);
    });

    it("'Gerar novo link' no escritório: o PDF antigo passa a dar 404 e o app recebe o link novo", async () => {
      const velho = await token("a1");
      comoEscritorio();
      const r = await chamar("ordens/[id]/atividades/[atividadeId]/link-relatorio", "POST", { id: "os1", atividadeId: "a1" });
      expect(r.status).toBe(200);
      const novo = await token("a1");
      expect(novo).not.toBe(velho);
      expect((await pdf("a1", velho)).status).toBe(404);
      expect((await pdf("a1", novo)).status).toBe(200);
      comoTecnico();
      expect((await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "a1" })).json.relatorio.link).toBe(`/relatorio/atividade/a1?t=${novo}`);
    });
  });
});
