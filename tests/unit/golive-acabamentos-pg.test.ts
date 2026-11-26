/**
 * ACABAMENTOS DO GO-LIVE (leva 3) em PostgreSQL real, pelas rotas de verdade:
 *  b) satisfação = média do aceite das OS do cliente, da empresa da sessão; a edição do cliente não apaga
 *     o campo manual antigo;
 *  c) o sino (/api/alertas): o técnico do app só recebe o que é dele — antes recebia OS atrasadas e chamados
 *     do portal da empresa inteira —, e o gestor recebe a nota baixa do aceite com o link da OS.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_golive_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const como = (id: string, role: string, permissoes: Permissoes, extra: Record<string, unknown> = {}, empresaId = "e1") => {
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, empresaNome: "Clima Total", role, permissoes, tecnicoId: null, ...extra } };
};
const gestor = () => como("uA", "OPERADOR", PRESETS.SUPERVISOR);
const tecnico = () => como("uT", "TECNICO", PRESETS.TECNICO, { tecnicoId: "t1" });

async function rota(caminho: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${caminho}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("acabamentos do go-live (PostgreSQL real)", () => {
  let prisma: any;
  const dias = (n: number) => new Date(Date.now() + n * 86_400_000);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Gestora", email: "ana@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "Carlos", email: "carlos@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Carlos", cpf: "1", telefone: "1", email: "carlos@x.com" },
      { id: "t2", empresaId: "e1", nome: "Davi", cpf: "2", telefone: "2" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Clínica Vida Plena", cpfCnpj: "11.222.333/0001-81", satisfacao: 4 },
      { id: "c2", empresaId: "e1", nome: "Hotel Mirante", cpfCnpj: "22.333.444/0001-55" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33.444.555/0001-66" },
    ] });
    const os = (id: string, clienteId: string, extra: Record<string, unknown> = {}, empresaId = "e1") =>
      ({ id, empresaId, numero: id.toUpperCase(), clienteId, criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao: "Serviço", ...extra });
    await prisma.ordemServico.createMany({ data: [
      os("osAtrasada", "c1", { status: "AGENDADA", prazoExecucao: dias(-4) }),            // de outro técnico, atrasada
      os("osPortal", "c1", { status: "AGUARDANDO_ATENDIMENTO", origem: "PORTAL_CLIENTE" }), // chamado do portal
      os("osCarlos", "c2", { status: "CONCLUIDA" }), os("os5", "c1", { status: "CONCLUIDA" }), os("os2", "c1", { status: "CONCLUIDA" }),
      os("os4visto", "c1", { status: "CONCLUIDA" }), os("osPendente", "c1", { status: "CONCLUIDA" }), os("osE2", "cE2", { status: "CONCLUIDA" }, "e2"),
      os("os3", "c2", { status: "CONCLUIDA" }), os("osPendNota", "c1", { status: "CONCLUIDA" }),
      // dados CRUZADOS (não deveriam existir): cada filtro de empresa tem de segurar sozinho
      os("osMix", "c2", { status: "CONCLUIDA" }), os("osE2b", "cE2", { status: "CONCLUIDA" }, "e2"),
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aOutro", empresaId: "e1", ordemServicoId: "osAtrasada", titulo: "Corretiva", tecnicoId: "t2", status: "AGENDADA" },
      { id: "aCarlos", empresaId: "e1", ordemServicoId: "osCarlos", titulo: "Preventiva", tecnicoId: "t1", status: "CONCLUIDA" },
      { id: "aOs5", empresaId: "e1", ordemServicoId: "os5", titulo: "Preventiva", tecnicoId: "t2", status: "CONCLUIDA" },
      { id: "aOs2", empresaId: "e1", ordemServicoId: "os2", titulo: "Preventiva", tecnicoId: "t2", status: "CONCLUIDA" },
    ] });
    const aceite = (id: string, ordemServicoId: string, avaliacao: number | null, extra: Record<string, unknown> = {}, empresaId = "e1") =>
      ({ id, empresaId, ordemServicoId, token: `tk-${id}`, situacao: "CONFIRMADO", metodo: "REMOTO", nome: "Resp.", avaliacao, confirmadoEm: dias(-1), ...extra });
    await prisma.osAceite.createMany({ data: [
      aceite("acCarlos", "osCarlos", 1),                       // nota baixa, OS do Carlos
      aceite("ac5", "os5", 5),                                 // confirmado, boa nota
      aceite("ac2", "os2", 2),                                 // nota baixa
      aceite("ac4", "os4visto", 4, { vistoEm: dias(0) }),     // já visto: sai do sino, mas conta na média
      aceite("acPend", "osPendente", null, { situacao: "PENDENTE", confirmadoEm: null }), // não confirmado: fora
      aceite("acE2", "osE2", 1, {}, "e2"),                     // outra empresa
      aceite("ac3", "os3", 3),                                 // 3 estrelas: confirmado, NÃO é nota baixa
      aceite("acPendNota", "osPendNota", 1, { situacao: "PENDENTE" }), // voltou a pendente com a nota antiga: fora
      aceite("acMix", "osMix", 5, {}, "e2"),                   // aceite da e2 numa OS da e1: fora da e1
      aceite("acX", "osE2b", 5),                               // aceite da e1 numa OS da e2: fora da e1
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── b) satisfação ───────── */

  it("b) a satisfação é a média do aceite confirmado das OS do cliente — e só da empresa da sessão", async () => {
    const { satisfacaoDosClientes } = await import("@/lib/clientes/satisfacao-server");
    const s = await satisfacaoDosClientes("e1", ["c1", "c2", "cE2"]);
    expect(s.get("c1")).toEqual({ media: 3.7, avaliacoes: 3 }); // 5, 2 e 4 (os pendentes não contam, nem com nota)
    expect(s.get("c2")).toEqual({ media: 2, avaliacoes: 2 }); // 1 e 3 (o aceite da outra empresa na OS dele não conta)
    expect(s.has("cE2"), "cliente de outra empresa não aparece — nem por um aceite com o empresaId trocado").toBe(false);
    expect((await satisfacaoDosClientes("e2", ["c1"])).size, "nem pela outra empresa").toBe(0);
    expect((await satisfacaoDosClientes("e1", [])).size).toBe(0);
  });

  it("b) salvar o cadastro do cliente sem o campo de estrelas não apaga o valor antigo do banco", async () => {
    como("uA", "ADMIN", permissoesTotais());
    const r = await rota("api/clientes/[id]", "PUT", { nome: "Clínica Vida Plena", cpfCnpj: "11.222.333/0001-81", tipoPessoa: "JURIDICA", telefone: "1133334444" }, { id: "c1" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await prisma.cliente.findUnique({ where: { id: "c1" } })).satisfacao).toBe(4);
  });

  /* ───────── c) o sino ───────── */

  it("c) separar a nota baixa: cada confirmação conta num aviso só (ressalva › nota baixa › confirmada)", async () => {
    const { avisosDeAceite } = await import("@/lib/os/aceite-server");
    const separado = await avisosDeAceite("e1", {}, { separarNotaBaixa: true });
    // 1 e 2 estrelas são nota baixa; 3 e 5 são confirmadas
    expect(separado).toMatchObject({ avaliacoesBaixas: 2, aceitesConfirmados: 2, aceitesRessalva: 0 });
    expect(["os5", "os3"]).toContain(separado.aceiteConfirmadoOsId);
    expect(["osCarlos", "os2"]).toContain(separado.avaliacaoBaixaOsId);
    const junto = await avisosDeAceite("e1");
    expect(junto).toMatchObject({ avaliacoesBaixas: 0, aceitesConfirmados: 4 });
  });

  it("c) gestor: OS atrasadas, chamados do portal e a nota baixa do aceite, com o link para a OS", async () => {
    gestor();
    const r = await rota("api/alertas", "GET");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ atendimentosAtraso: 1, chamadosPortal: 1, avaliacoesBaixas: 2, aceitesConfirmados: 2 });
    expect(["osCarlos", "os2"]).toContain(r.json.avaliacaoBaixaOsId);
    expect(r.json.total).toBeGreaterThanOrEqual(5);
  });

  it("c) técnico do app: nada da empresa inteira — só o aceite da OS dele (e sem o alerta de nota baixa)", async () => {
    tecnico();
    const r = await rota("api/alertas", "GET");
    expect(r.status).toBe(200);
    // antes: atendimentosAtraso 1 e chamadosPortal 1 (de OS que não são dele)
    expect(r.json).toMatchObject({ atendimentosAtraso: 0, chamadosPortal: 0, prazosVencidos: 0, pedidosPendentes: 0, avaliacoesBaixas: 0 });
    expect(r.json.aceitesConfirmados, "só a OS em que ele tem atividade").toBe(1);
    expect(r.json.aceiteConfirmadoOsId).toBe("osCarlos");
    const numeros = Object.entries(r.json).filter(([, v]) => typeof v === "number" && v > 0).map(([k]) => k).sort();
    expect(numeros).toEqual(["aceitesConfirmados", "total"]);
    expect(r.json.total).toBe(1);
  });

  it("c) quando alguém do escritório abre a OS (visto), a nota baixa sai do sino", async () => {
    await prisma.osAceite.updateMany({ where: { id: { in: ["acCarlos", "ac2"] } }, data: { vistoEm: new Date() } });
    gestor();
    expect((await rota("api/alertas", "GET")).json).toMatchObject({ avaliacoesBaixas: 0, avaliacaoBaixaOsId: null });
  });
});
