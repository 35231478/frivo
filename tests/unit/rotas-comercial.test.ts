/**
 * Leva 3 (C4 comercial + C5): rotas de orçamentos, contratos e pedidos de compra exigem a
 * permissão do perfil. Rotas reais, checagem de permissão real; só banco e sessão simulados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PRESETS, type Permissoes } from "@/lib/permissoes";

// Prisma simulado: qualquer model/método existe; por padrão "não encontrado"/vazio.
const overrides = vi.hoisted(() => new Map<string, (...a: any[]) => any>());
const chamadas = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/prisma", () => {
  const model = (nome: string) => new Proxy({}, {
    get: (_t, metodo: string) => async (...args: any[]) => {
      chamadas.push(`${nome}.${metodo}`);
      const o = overrides.get(`${nome}.${metodo}`);
      if (o) return o(...args);
      if (metodo === "findMany") return [];
      if (metodo === "count") return 0;
      return null;
    },
  });
  const prisma: any = new Proxy({}, { get: (_t, nome: string) => (nome === "$transaction" ? async (fn: any) => fn(prisma) : model(nome)) });
  return { prisma };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes, id = "u1") => { sessao.atual = { user: { id, empresaId: "e1", role: "OPERADOR", permissoes } }; };
const p = <T,>(v: T) => ({ params: Promise.resolve(v) });
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** true se a rota passou da checagem de permissão (qualquer resposta que não seja 401/403). */
async function passou(chamar: () => Promise<Response>) {
  try {
    const r = await chamar();
    return r.status !== 401 && r.status !== 403;
  } catch {
    return true; // estourou depois da checagem, com o banco simulado vazio
  }
}

beforeEach(() => { overrides.clear(); chamadas.length = 0; });

const rotas = {
  orcamentos: () => import("@/app/api/orcamentos/route"),
  orcamento: () => import("@/app/api/orcamentos/[id]/route"),
  enviar: () => import("@/app/api/orcamentos/[id]/enviar/route"),
  gerarContrato: () => import("@/app/api/orcamentos/[id]/gerar-contrato/route"),
  contratos: () => import("@/app/api/contratos/route"),
  contrato: () => import("@/app/api/contratos/[id]/route"),
  contratoStatus: () => import("@/app/api/contratos/[id]/status/route"),
  contratoAnexos: () => import("@/app/api/contratos/[id]/anexos/route"),
  contratoAnexo: () => import("@/app/api/contratos/[id]/anexos/[anexoId]/route"),
  proximoNumero: () => import("@/app/api/contratos/proximo-numero/route"),
  pedidos: () => import("@/app/api/pedidos-compra/route"),
  pedido: () => import("@/app/api/pedidos-compra/[id]/route"),
};

/** Chamadas de rotas comerciais que um técnico (sem orçamentos/contratos/financeiro) NÃO pode fazer. */
const SO_COMERCIAL: [string, () => Promise<Response>][] = [
  ["GET /api/orcamentos", async () => (await rotas.orcamentos()).GET(req("/api/orcamentos"))],
  ["POST /api/orcamentos", async () => (await rotas.orcamentos()).POST(req("/api/orcamentos", "POST", {}))],
  ["GET /api/orcamentos/[id]", async () => (await rotas.orcamento()).GET(req("/x"), p({ id: "o1" }))],
  ["PUT /api/orcamentos/[id] {status: APROVADO}", async () => (await rotas.orcamento()).PUT(req("/x", "PUT", { status: "APROVADO" }), p({ id: "o1" }))],
  ["POST /api/orcamentos/[id]/enviar", async () => (await rotas.enviar()).POST(req("/x", "POST"), p({ id: "o1" }))],
  ["POST /api/orcamentos/[id]/gerar-contrato", async () => (await rotas.gerarContrato()).POST(req("/x", "POST"), p({ id: "o1" }))],
  ["POST /api/contratos", async () => (await rotas.contratos()).POST(req("/api/contratos", "POST", {}))],
  ["GET /api/contratos/[id]", async () => (await rotas.contrato()).GET(req("/x"), p({ id: "c1" }))],
  ["PUT /api/contratos/[id]", async () => (await rotas.contrato()).PUT(req("/x", "PUT", {}), p({ id: "c1" }))],
  ["DELETE /api/contratos/[id] (encerrar)", async () => (await rotas.contrato()).DELETE(req("/x", "DELETE"), p({ id: "c1" }))],
  ["PATCH /api/contratos/[id]/status", async () => (await rotas.contratoStatus()).PATCH(req("/x", "PATCH", { status: "CANCELADO" }), p({ id: "c1" }))],
  ["GET /api/contratos/[id]/anexos", async () => (await rotas.contratoAnexos()).GET(req("/x"), p({ id: "c1" }))],
  ["POST /api/contratos/[id]/anexos", async () => (await rotas.contratoAnexos()).POST(req("/x", "POST"), p({ id: "c1" }))],
  ["GET /api/contratos/[id]/anexos/[anexoId]", async () => (await rotas.contratoAnexo()).GET(req("/x"), p({ id: "c1", anexoId: "a1" }))],
  ["DELETE /api/contratos/[id]/anexos/[anexoId]", async () => (await rotas.contratoAnexo()).DELETE(req("/x", "DELETE"), p({ id: "c1", anexoId: "a1" }))],
  ["GET /api/contratos/proximo-numero", async () => (await rotas.proximoNumero()).GET(req("/x"))],
  ["GET /api/pedidos-compra (lista geral)", async () => (await rotas.pedidos()).GET(req("/api/pedidos-compra"))],
];

describe("técnico (sem módulos comerciais) é barrado", () => {
  it.each(SO_COMERCIAL)("%s → 403", async (_nome, chamar) => {
    logar(PRESETS.TECNICO);
    const r = await chamar();
    expect(r.status).toBe(403);
    // Nada foi lido/gravado no banco antes da recusa
    expect(chamadas.filter((c) => !c.startsWith("usuario."))).toEqual([]);
  });
});

describe("financeiro/comercial continua com acesso", () => {
  it.each(SO_COMERCIAL)("%s passa da permissão", async (_nome, chamar) => {
    logar(PRESETS.FINANCEIRO);
    expect(await passou(chamar)).toBe(true);
  });
});

describe("usos legítimos fora do módulo comercial continuam funcionando", () => {
  it("técnico lista contratos do cliente ao abrir OS (ordens.criar)", async () => {
    logar(PRESETS.TECNICO);
    const r = await (await rotas.contratos()).GET(req("/api/contratos?clienteId=cli1"));
    expect(r.status).toBe(200);
  });

  it("auxiliar (só vê OS) não lista contratos", async () => {
    logar(PRESETS.AUXILIAR);
    expect((await (await rotas.contratos()).GET(req("/api/contratos?clienteId=cli1"))).status).toBe(403);
  });

  it("técnico vê e pede compras da OS", async () => {
    logar(PRESETS.TECNICO);
    expect((await (await rotas.pedidos()).GET(req("/api/pedidos-compra?ordemServicoId=os1"))).status).toBe(200);
    overrides.set("ordemServico.findFirst", async () => ({ id: "os1" }));
    const corpo = { ordemServicoId: "os1", itens: [{ descricao: "Gás R410", quantidade: 1, unidade: "kg" }] };
    expect(await passou(async () => (await rotas.pedidos()).POST(req("/api/pedidos-compra", "POST", corpo)))).toBe(true);
  });

  it("auxiliar (só vê OS) não pede compra", async () => {
    logar(PRESETS.AUXILIAR);
    const corpo = { ordemServicoId: "os1", itens: [{ descricao: "Gás R410", quantidade: 1, unidade: "kg" }] };
    expect((await (await rotas.pedidos()).POST(req("/api/pedidos-compra", "POST", corpo))).status).toBe(403);
  });

  it("pedido apontando para OS de outra empresa é recusado", async () => {
    logar(PRESETS.TECNICO);
    const corpo = { ordemServicoId: "os-de-outra-empresa", itens: [{ descricao: "Gás", quantidade: 1, unidade: "kg" }] };
    expect((await (await rotas.pedidos()).POST(req("/api/pedidos-compra", "POST", corpo))).status).toBe(404);
  });

  it("comprador designado anda com o status do pedido; outro técnico não", async () => {
    overrides.set("pedidoCompraInterno.findFirst", async () => ({ id: "pc1", numero: "PC-1", compradorId: "comprador", ordemServicoId: "os1", orcamentoId: null, ordemServico: null }));
    logar(PRESETS.TECNICO, "comprador");
    expect(await passou(async () => (await rotas.pedido()).PUT(req("/x", "PUT", { status: "COTANDO" }), p({ id: "pc1" })))).toBe(true);
    logar(PRESETS.TECNICO, "outro");
    expect((await (await rotas.pedido()).PUT(req("/x", "PUT", { status: "COTANDO" }), p({ id: "pc1" }))).status).toBe(403);
  });
});

describe("C5: status do orçamento só por transições permitidas", () => {
  async function mudar(de: string, para: string, permissoes: Permissoes = PRESETS.FINANCEIRO) {
    logar(permissoes);
    overrides.set("orcamento.findFirst", async () => ({ id: "o1", status: de, enviadoEm: null }));
    overrides.set("orcamento.update", async ({ data }: any) => ({ id: "o1", ...data }));
    return (await rotas.orcamento()).PUT(req("/x", "PUT", { status: para }), p({ id: "o1" }));
  }
  const gravou = () => chamadas.includes("orcamento.update");

  it("APROVADO manual é recusado (só com assinatura do cliente)", async () => {
    const r = await mudar("ENVIADO", "APROVADO");
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toMatch(/assinatura/);
    expect(gravou()).toBe(false);
  });

  it.each([
    ["CONVERTIDA", "RASCUNHO"],
    ["APROVADO", "RASCUNHO"],
    ["ENVIADO", "CONVERTIDA"],
    ["CONVERTIDA", "CANCELADO"],
    ["ENVIADO", "STATUS_INVENTADO"],
  ])("%s → %s é recusado", async (de, para) => {
    expect((await mudar(de, para)).status).toBe(400);
    expect(gravou()).toBe(false);
  });

  it("ENVIADO → REPROVADO (botão 'Marcar como reprovado') continua funcionando", async () => {
    const r = await mudar("ENVIADO", "REPROVADO");
    expect(r.status).toBe(200);
    expect(gravou()).toBe(true);
  });

  it("cancelar exige 'excluir' em orçamentos", async () => {
    const semExcluir = { ...PRESETS.FINANCEIRO, orcamentos: { ...PRESETS.FINANCEIRO.orcamentos, excluir: false } };
    expect((await mudar("ENVIADO", "CANCELADO", semExcluir)).status).toBe(403);
  });
});
