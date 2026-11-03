/**
 * Numeração de documentos no PostgreSQL REAL (schema descartável via `prisma db push`):
 *  - semente no 1º uso: o maior já gravado + 1, em QUALQUER ano (numeração contínua), por empresa;
 *  - concorrência: 30 gerações ao mesmo tempo (transações separadas, caminhos diferentes) saem sem
 *    repetir e sem pular; o número digitado à mão (contrato) nunca é repetido;
 *  - a rota de Configurações: GET (visualizar), PUT (gerenciar) com a trava do mínimo (409 com o
 *    mínimo), 400 em corpo torto, 401/403, e o "próximo" valendo na geração seguinte;
 *  - espiar não consome; outra empresa tem a sua própria numeração; os documentos existentes não mudam.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/numeracao-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_numeracao_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", role = "ADMIN") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role, permissoes, tecnicoId: null } };
};
async function chamar(metodo: "GET" | "PUT", corpo?: unknown) {
  const mod = await import("@/app/api/configuracoes/numeracao/route");
  const req = new NextRequest("http://localhost/api/configuracoes/numeracao", { method: metodo, headers: { "Content-Type": "application/json" }, ...(corpo !== undefined && { body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }) });
  const res = await (metodo === "GET" ? mod.GET() : mod.PUT(req));
  return { status: res.status, json: await res.json() };
}

describe.skipIf(!URL_PG)("Numeração de documentos (PostgreSQL real)", () => {
  let prisma: any;
  let n: typeof import("@/lib/numeracao-server");
  const AGORA = new Date("2026-11-04T12:00:00.000Z");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=40`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    n = await import("@/lib/numeracao-server");
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "11111111000191", email: "h@x.com" },
      { id: "c2", empresaId: "e2", nome: "Outro cliente", cpfCnpj: "22222222000192", email: "o2@x.com" },
    ] });
    // Histórico "do Field Control": orçamentos em 2025 e 2026 (o maior é de 2025), OS de 2 anos, um chamado, um contrato digitado
    await prisma.orcamento.createMany({ data: [
      { id: "o1", empresaId: "e1", clienteId: "c1", criadoPorId: "u1", codigo: "ORC-2025-0120", nome: "A", tokenPublico: "t1" },
      { id: "o2", empresaId: "e1", clienteId: "c1", criadoPorId: "u1", codigo: "ORC-2026-0045", nome: "B", tokenPublico: "t2" },
      { id: "o3", empresaId: "e2", clienteId: "c2", criadoPorId: "u1", codigo: "ORC-2026-0900", nome: "C", tokenPublico: "t3" },
    ] });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", clienteId: "c1", criadoPorId: "u1", numero: "OS-2025-9999", descricao: "x", status: "ABERTA" },
      { id: "os2", empresaId: "e1", clienteId: "c1", criadoPorId: "u1", numero: "OS-2026-0003", chamadoNumero: "CHM-2026-0007", descricao: "y", status: "ABERTA", origem: "PORTAL_CLIENTE" },
    ] });
    await prisma.contrato.create({ data: { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-2026-010", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01"), valorMensal: 100 } });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("maior usado: por empresa, em qualquer ano, só no formato do tipo (chamado lê outra coluna; parcela conta pelo lançamento)", async () => {
    expect(await n.maiorUsado(prisma, "e1", "orcamento")).toBe(120); // 2025 > 2026: contínua
    expect(await n.maiorUsado(prisma, "e2", "orcamento")).toBe(900);
    expect(await n.maiorUsado(prisma, "e1", "os")).toBe(9999);
    expect(await n.maiorUsado(prisma, "e1", "chamado")).toBe(7);
    expect(await n.maiorUsado(prisma, "e1", "contrato")).toBe(10);
    expect(await n.maiorUsado(prisma, "e1", "medicao")).toBe(0);
    expect(await n.maiorUsado(prisma, "e2", "os")).toBe(0);
  });

  it("1º uso semeia com o maior + 1 (não reinicia no ano: depois de ORC-2025-0120 vem ORC-2026-0121); a empresa 2 segue a dela", async () => {
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "orcamento", 2026))).toBe("ORC-2026-0121");
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "orcamento", 2026))).toBe("ORC-2026-0122");
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e2", "orcamento", 2026))).toBe("ORC-2026-0901");
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "os", 2026))).toBe("OS-2026-10000"); // cresce além dos 4 dígitos
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "chamado", 2026))).toBe("CHM-2026-0008");
    const c = await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "orcamento" } } });
    expect(c.proximo).toBe(123);
  });

  it("concorrência: 30 gerações ao mesmo tempo por caminhos diferentes saem sem repetir nem pular", async () => {
    const tarefas = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0 ? prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "medicao", 2026))
        : i % 3 === 1 ? n.comNumero("e1", "medicao", async (numero) => numero, { ano: 2026 })
        : prisma.$transaction((tx: any) => n.reservarNumeros(tx, "e1", "medicao", 1, 2026)).then((xs: string[]) => xs[0]));
    const numeros = await Promise.all(tarefas);
    const seqs = numeros.map((x) => Number(x.split("-")[2])).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(30);
    expect(seqs).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const c = await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "medicao" } } });
    expect(c.proximo).toBe(31);
  });

  it("reservar em lote dá uma sequência contígua; a transação que falha devolve o número? não: o lote só vale no commit", async () => {
    const lote = await prisma.$transaction((tx: any) => n.reservarNumeros(tx, "e1", "qrcode", 3, 2026));
    expect(lote).toEqual(["QR-2026-0001", "QR-2026-0002", "QR-2026-0003"]);
    await expect(prisma.$transaction(async (tx: any) => { await n.proximoNumero(tx, "e1", "qrcode", 2026); throw new Error("desistiu"); })).rejects.toThrow("desistiu");
    // A transação desfeita não consumiu o 4: ele sai agora
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "qrcode", 2026))).toBe("QR-2026-0004");
  });

  it("número digitado à mão (contrato) acima do contador: a geração pula para depois dele, nunca repete", async () => {
    expect(await n.espiarProximo("e1", "contrato", 2026)).toBe("CT-2026-011");
    await prisma.contrato.create({ data: { id: "ct2", empresaId: "e1", clienteId: "c1", numero: "CT-2026-050", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01"), valorMensal: 100 } });
    expect(await n.espiarProximo("e1", "contrato", 2026)).toBe("CT-2026-051");
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "contrato", 2026))).toBe("CT-2026-051");
    // espiar não consome: o mesmo 52 aparece duas vezes e depois é gerado
    expect(await n.espiarProximo("e1", "contrato", 2026)).toBe("CT-2026-052");
    expect(await n.espiarProximo("e1", "contrato", 2026)).toBe("CT-2026-052");
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "contrato", 2026))).toBe("CT-2026-052");
    // O contador JÁ existe (53) e alguém digita um contrato bem acima: o contador não pode ficar para trás
    await prisma.contrato.create({ data: { id: "ct3", empresaId: "e1", clienteId: "c1", numero: "CT-2026-080", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01"), valorMensal: 100 } });
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "contrato", 2026))).toBe("CT-2026-081");
  });

  it("Configurações: GET traz cada tipo com maior usado, próximo e exemplo; PUT define o próximo; a geração seguinte usa", async () => {
    logar();
    const g = await chamar("GET");
    expect(g.status).toBe(200);
    const orc = g.json.numeracoes.find((x: any) => x.tipo === "orcamento");
    expect(orc).toMatchObject({ rotulo: "Orçamento", prefixo: "ORC", maiorUsado: 120, proximo: 123, configurado: true }); // gerar número não grava documento: o maior usado segue o dos orçamentos gravados
    expect(orc.exemplo).toMatch(/^ORC-\d{4}-0123$/);
    expect(g.json.numeracoes.find((x: any) => x.tipo === "pedido_compra")).toMatchObject({ maiorUsado: 0, proximo: 1, configurado: false });
    // Contador do contrato está em 82, mas um contrato digitado à mão (090) passou dele: a tela mostra o que vai sair de verdade
    await prisma.contrato.create({ data: { id: "ct4", empresaId: "e1", clienteId: "c1", numero: "CT-2026-090", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01"), valorMensal: 100 } });
    expect((await chamar("GET")).json.numeracoes.find((x: any) => x.tipo === "contrato")).toMatchObject({ maiorUsado: 90, proximo: 91, configurado: true });
    expect(g.json.numeracoes.map((x: any) => x.tipo)).toHaveLength(10);

    const p = await chamar("PUT", { tipo: "orcamento", proximo: 3358 });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ tipo: "orcamento", proximo: 3358 });
    expect(p.json.exemplo).toMatch(/^ORC-\d{4}-3358$/);
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "orcamento", 2026))).toBe("ORC-2026-3358");
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "orcamento", 2026))).toBe("ORC-2026-3359");
    // os orçamentos antigos não mudaram
    expect((await prisma.orcamento.findUnique({ where: { id: "o1" } })).codigo).toBe("ORC-2025-0120");
  });

  it("trava do mínimo: próximo igual ou abaixo do maior já usado = 409 com a mensagem e o mínimo (3360); o contador não muda", async () => {
    logar();
    // O documento de verdade (ORC-2026-3359 gravado) é o que conta como "maior usado"
    await prisma.orcamento.create({ data: { id: "o4", empresaId: "e1", clienteId: "c1", criadoPorId: "u1", codigo: "ORC-2026-3359", nome: "D", tokenPublico: "t4" } });
    for (const proximo of [3359, 100, 1]) {
      const r = await chamar("PUT", { tipo: "orcamento", proximo });
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ erro: "O próximo número de orçamento precisa ser pelo menos 3360: o maior já usado é 3359.", minimo: 3360 });
    }
    expect((await chamar("PUT", { tipo: "orcamento", proximo: 3360 })).status).toBe(200);
    // sem documento nenhum, o mínimo é 1
    expect((await chamar("PUT", { tipo: "conta_pagar", proximo: 1 })).status).toBe(200);
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "conta_pagar", 2026))).toBe("CP-2026-0001");
  });

  it("corpo torto = 400; sem sessão = 401; sem Configurações › gerenciar = 403 no PUT (e o GET só pede visualizar)", async () => {
    logar();
    expect((await chamar("PUT", { tipo: "nfse", proximo: 1 })).status).toBe(400);
    expect((await chamar("PUT", { tipo: "os", proximo: 0 })).status).toBe(400);
    expect((await chamar("PUT", "{torto")).status).toBe(400);
    sessao.atual = null;
    expect((await chamar("GET")).status).toBe(401);
    expect((await chamar("PUT", { tipo: "os", proximo: 20000 })).status).toBe(401);
    logar(permissoesVazias(), "e1", "OPERADOR");
    expect((await chamar("PUT", { tipo: "os", proximo: 20000 })).status).toBe(403);
    expect((await chamar("GET")).status).toBe(403);
    // Só "visualizar" em Configurações: vê a tela, mas não salva
    logar(montarPermissoes({ configuracoes: ["visualizar"] }), "e1", "OPERADOR");
    expect((await chamar("GET")).status).toBe(200);
    expect((await chamar("PUT", { tipo: "os", proximo: 20000 })).status).toBe(403);
    // nada mudou
    expect((await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId: "e1", tipo: "os" } } })).proximo).toBe(10001);
  });

  it("isolamento: a empresa 2 vê e define só a numeração dela", async () => {
    logar(permissoesTotais(), "e2");
    const g = await chamar("GET");
    expect(g.json.numeracoes.find((x: any) => x.tipo === "orcamento")).toMatchObject({ maiorUsado: 900, proximo: 902 });
    expect(g.json.numeracoes.find((x: any) => x.tipo === "os")).toMatchObject({ maiorUsado: 0, proximo: 1 });
    expect((await chamar("PUT", { tipo: "os", proximo: 5000 })).status).toBe(200);
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e2", "os", 2026))).toBe("OS-2026-5000");
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e1", "os", 2026))).toBe("OS-2026-10001");
    // A trava é por empresa E tipo: a empresa 1 segurando a sua trava (transação longa) não faz a empresa 2 esperar
    const longa = prisma.$transaction(async (tx: any) => { await n.proximoNumero(tx, "e1", "os", 2026); await new Promise((r) => setTimeout(r, 1500)); }, { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 200)); // a longa já pegou a trava
    const t0 = Date.now();
    expect(await prisma.$transaction((tx: any) => n.proximoNumero(tx, "e2", "os", 2026))).toBe("OS-2026-5001");
    expect(Date.now() - t0).toBeLessThan(1000);
    await longa;
  });

  it("os helpers das telas passam pelo contador: conta a receber/pagar e pedido (fora e dentro de transação), lote de QR", async () => {
    const f = await import("@/lib/financeiro-server");
    const pedido = await import("@/lib/compras/pedido-server");
    const qr = await import("@/lib/qrcode-server");
    const cr1 = await f.proximoNumeroContaReceber("e1", 2026);
    const cr2 = await prisma.$transaction((tx: any) => f.proximoNumeroContaReceber("e1", 2026, tx));
    expect([cr1, cr2]).toEqual(["CR-2026-0001", "CR-2026-0002"]);
    expect(await f.proximoNumeroContaPagar("e1", 2026)).toBe("CP-2026-0002");
    expect(await pedido.proximoNumeroPedido("e1", 2026)).toBe("PCI-2026-0001");
    expect(await qr.gerarLoteQrCodes("e1", 2)).toEqual(["QR-2026-0005", "QR-2026-0006"]);
    expect(await prisma.qrcode.count({ where: { empresaId: "e1" } })).toBe(2);
    // O QR de um equipamento (cadastro e "gerar QR") continua a mesma sequência do lote
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.equipamento.create({ data: { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "X" } });
    expect((await qr.gerarQrCodeEquipamento("e1", "eq1")).codigo).toBe("QR-2026-0007");
    void AGORA;
  });
});
