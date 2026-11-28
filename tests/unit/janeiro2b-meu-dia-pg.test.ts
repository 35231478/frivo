/**
 * App pronto pra janeiro 2 · PR B — os avisos novos do Meu dia, nas rotas de verdade (PostgreSQL real):
 *  - D9 "Saiu do seu dia": dos ids que o aparelho tinha hoje (cabeçalho), o que o escritório cancelou, reagendou (com a
 *    data nova ou sem data) ou passou a outro técnico; o que o próprio técnico mudou por último não é aviso; id de outra
 *    empresa não diz nada; o que continua no dia não é aviso;
 *  - D11 "gravações no outro aparelho": cada aparelho conta quantas gravações tem na fila (Meu dia e envio); o aparelho
 *    novo é avisado; quando o antigo envia, o aviso some; sem os cabeçalhos (app antigo), nada muda.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/janeiro2b-meu-dia-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS } from "@/lib/permissoes";
import { inicioHojeBR, chaveDiaBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_j2b_meudia_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const comoTecnico = (tecnicoId = "t1", id = "uT", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "João", email: `${id}@x.com`, empresaId, role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};
const H = 3_600_000;
const APARELHO_A = "aparelho-antigo-0001", APARELHO_B = "aparelho-novo-0002";

async function meuDia(cab: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/tecnico/meu-dia/route");
  const res = await GET(new NextRequest("http://localhost/api/tecnico/meu-dia", { headers: cab }));
  return res.json();
}
async function sync(operacoes: unknown[], cab: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/tecnico/sync/route");
  const res = await POST(new NextRequest("http://localhost/api/tecnico/sync", { method: "POST", headers: { "Content-Type": "application/json", ...cab }, body: JSON.stringify({ operacoes }) }));
  return res.json();
}

describe.skipIf(!URL_PG)("Meu dia: 'Saiu do seu dia' (D9) e o outro aparelho (D11) — PostgreSQL real", () => {
  let prisma: any;
  const hoje = inicioHojeBR();
  const diaHoje = chaveDiaBR(new Date());
  const amanha = new Date(hoje.getTime() + 24 * H + 10 * H);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/meu-dia", "tecnico/sync"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima", cnpj: "1", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "2", email: "o@x.com" }] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1", appUmDispositivo: true }, { empresaId: "e2" }] });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João", email: "uT@x.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana", email: "uA@x.com", senha: "x" },
      { id: "uX", empresaId: "e2", nome: "Beto", email: "uX@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João", cpf: "1", telefone: "1", email: "uT@x.com" },
      { id: "t2", empresaId: "e1", nome: "Maria", cpf: "2", telefone: "2" },
      { id: "tx", empresaId: "e2", nome: "Outro", cpf: "3", telefone: "3" },
    ] });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "1" }, { id: "cx", empresaId: "e2", nome: "X", cpfCnpj: "2" }] });
    const os = (id: string, numero: string, empresaId = "e1", clienteId = "c1") => ({ id, empresaId, numero, clienteId, criadoPorId: empresaId === "e1" ? "uA" : "uX", descricao: "Visita" });
    await prisma.ordemServico.createMany({ data: [os("os1", "OS-2601"), os("os2", "OS-2602"), os("os3", "OS-2603"), os("os4", "OS-2604"), os("os5", "OS-2605"), os("os6", "OS-2606"), os("osx", "OS-9", "e2", "cx")] });
    const at = (id: string, osId: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", ordemServicoId: osId, titulo: "Visita", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "AGENDADA", ...extra });
    await prisma.atividadeOs.createMany({ data: [
      at("a1", "os1"), at("a2", "os2"), at("a3", "os3"), at("a4", "os4"), at("a5", "os5"), at("a6", "os6"),
      { id: "ax", empresaId: "e2", ordemServicoId: "osx", titulo: "X", tecnicoId: "tx", status: "CANCELADA" },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("D9: o que o escritório tirou do dia, e por quê; o que continua não é aviso; sem o cabeçalho, nada", async () => {
    comoTecnico();
    const antes = await meuDia();
    expect(antes.atividades.map((c: any) => c.atividadeId).sort()).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    expect(antes.saidas).toEqual([]);
    // O escritório mexe (e registra no histórico da OS); o técnico mexe numa (a dele não é aviso)
    await prisma.atividadeOs.update({ where: { id: "a2" }, data: { status: "CANCELADA" } });
    await prisma.atividadeOs.update({ where: { id: "a3" }, data: { dataAgendada: amanha } });
    await prisma.atividadeOs.update({ where: { id: "a4" }, data: { dataAgendada: null } });
    await prisma.atividadeOs.update({ where: { id: "a5" }, data: { tecnicoId: "t2" } });
    await prisma.atividadeOs.update({ where: { id: "a6" }, data: { dataAgendada: null } });
    await prisma.osHistorico.createMany({ data: [
      { ordemServicoId: "os2", usuarioId: "uA", acao: "Atividade cancelada" },
      { ordemServicoId: "os3", usuarioId: "uA", acao: "Atividade reagendada" },
      { ordemServicoId: "os6", usuarioId: "uT", acao: "Visita não concluída — reagendar" },
    ] });
    const d = await meuDia({ "x-frivo-antes": "a1,a2,a3,a4,a5,a6,ax,nao-existe" });
    expect(d.atividades.map((c: any) => c.atividadeId)).toEqual(["a1"]);
    const por = Object.fromEntries(d.saidas.map((s: any) => [s.atividadeId, [s.osNumero, s.motivo, s.novaData]]));
    expect(por).toEqual({
      a2: ["OS-2602", "cancelada", null],
      a3: ["OS-2603", "reagendada", chaveDiaBR(amanha)],
      a4: ["OS-2604", "reagendada", null],
      a5: ["OS-2605", "outro-tecnico", null],
      // a6: o próprio técnico encerrou como não concluída — não é aviso; ax: outra empresa — nada
    });
    expect(JSON.stringify(d.saidas)).not.toMatch(/Hospital|cliente/i);
    expect((await meuDia()).saidas).toEqual([]);
    expect(d.dia).toBe(diaHoje);
  });

  it("D11: o aparelho conta a fila; o aparelho novo é avisado; o antigo envia e o aviso some; app antigo (sem cabeçalho) não muda nada", async () => {
    comoTecnico();
    // o antigo (A) abriu o Meu dia com 3 gravações na fila
    expect((await meuDia({ "x-frivo-aparelho": APARELHO_A, "x-frivo-fila": "3" })).outroAparelho).toBeNull();
    // o técnico entra no novo (B)
    const b = await meuDia({ "x-frivo-aparelho": APARELHO_B, "x-frivo-fila": "0" });
    expect(b.outroAparelho).toEqual({ pendentes: 3, em: expect.any(String), umAparelho: true });
    // sem cabeçalho (app antigo): nada
    expect((await meuDia()).outroAparelho).toBeNull();
    // o antigo envia 2 das 3 (o envio desconta as que subiram)
    const op = () => ({ id: randomUUID(), tipo: "iniciar", atividadeId: "a1", em: new Date().toISOString() });
    const r = await sync([op()], { "x-frivo-aparelho": APARELHO_A, "x-frivo-fila": "3" });
    expect(r.resultados[0].ok).toBe(true);
    expect((await meuDia({ "x-frivo-aparelho": APARELHO_B, "x-frivo-fila": "0" })).outroAparelho).toMatchObject({ pendentes: 2 });
    // enviou tudo: o aviso some
    await meuDia({ "x-frivo-aparelho": APARELHO_A, "x-frivo-fila": "0" });
    expect((await meuDia({ "x-frivo-aparelho": APARELHO_B, "x-frivo-fila": "0" })).outroAparelho).toBeNull();
    // cabeçalho inválido: ignorado
    expect((await meuDia({ "x-frivo-aparelho": "x", "x-frivo-fila": "9" })).outroAparelho).toBeNull();
    const pref = await prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId: "uT", chave: "app:filaPorAparelho" } } });
    expect(Object.keys(pref.valor).sort()).toEqual([APARELHO_B, APARELHO_A].sort());
  });
});
