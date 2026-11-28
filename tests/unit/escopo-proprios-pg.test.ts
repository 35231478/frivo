/**
 * COM-1 — "Ver só os próprios" (Orçamentos e OS), com as rotas e o Prisma de verdade no PostgreSQL REAL: VAZAMENTO
 * entre vendedores da MESMA empresa. Ana e Beto têm a marca; o Gestor não; o ADMIN tem a marca e mesmo assim vê tudo.
 *  - listas e busca (API e exportação), seleção em massa (ids do filtro, exportar), painel e sino só com o próprio;
 *  - TODA rota por id de orçamento e de OS (varredura dos arquivos) responde 404/403 para o registro do outro;
 *  - as páginas por id (noEscopo) e o relatório de cumprimento de prazos;
 *  - a OS entra pelo vendedor dela, pelo vendedor do orçamento de origem ou por quem a criou.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/escopo-proprios-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_escopo_proprios_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
const barrados = vi.hoisted(() => [] as { tipo: string; id: string; barrou: boolean }[]);
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: vi.fn(async () => {}), enviarEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/push/eventos", async (o) => ({ ...(await o<object>()), agendarPush: vi.fn(), notificarRespostaOrcamento: vi.fn() }));
// O guarda por id, observado: cada chamada registra se barrou (a varredura confere que a rota passou por ele)
vi.mock("@/lib/escopo/proprios-server", async (o) => {
  const orig = await o<typeof import("@/lib/escopo/proprios-server")>();
  return { ...orig, escopoBarra: vi.fn(async (tipo: "orcamento" | "ordem", id: string) => { const r = await orig.escopoBarra(tipo, id); barrados.push({ tipo, id, barrou: !!r }); return r; }) };
});
vi.setConfig({ testTimeout: 120_000 });

const VENDAS: Permissoes = montarPermissoes({
  orcamentos: ["visualizar", "criar", "editar", "aprovar", "excluir", "verSoProprios"],
  ordens: ["visualizar", "criar", "editar", "concluir", "excluir", "verSoProprios"],
  relatorios: ["visualizar", "exportar"], clientes: ["visualizar"],
});
const GESTOR: Permissoes = montarPermissoes({
  orcamentos: ["visualizar", "criar", "editar", "aprovar", "excluir"], ordens: ["visualizar", "criar", "editar", "concluir", "excluir"],
  relatorios: ["visualizar", "exportar"], clientes: ["visualizar"],
});
const PESSOAS: Record<string, { nome: string; permissoes: Permissoes; role: string }> = {
  uAna: { nome: "Ana Vendas", permissoes: VENDAS, role: "OPERADOR" },
  uBeto: { nome: "Beto Vendas", permissoes: VENDAS, role: "OPERADOR" },
  uGestor: { nome: "Gil Gestor", permissoes: GESTOR, role: "OPERADOR" },
  uAdm: { nome: "Ada Admin", permissoes: VENDAS, role: "ADMIN" }, // a marca ligada não limita o ADMIN
  // Todas as permissões + a marca: nenhuma rota recusa por permissão, então quem responde é o guarda do escopo
  uTudo: { nome: "Tina Total", permissoes: { ...permissoesTotais(), orcamentos: { ...permissoesTotais().orcamentos, verSoProprios: true }, ordens: { ...permissoesTotais().ordens, verSoProprios: true } }, role: "OPERADOR" },
};
const logar = (id: string) => { const p = PESSOAS[id]; sessao.atual = { user: { id, name: p.nome, email: `${id}@ficticio.test`, empresaId: "e1", role: p.role, permissoes: p.permissoes, tecnicoId: null } }; };
const usuario = (id: string) => ({ id, empresaId: "e1", role: PESSOAS[id].role, permissoes: PESSOAS[id].permissoes });

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const texto = await res.text();
  let json: any = null; try { json = JSON.parse(texto); } catch { /* CSV */ }
  return { status: res.status, json, texto };
}

describe.skipIf(!URL_PG)("COM-1 — Ver só os próprios: nada vaza entre vendedores da mesma empresa (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=12`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Fictícia", cnpj: "12345678000190", email: "e1@ficticio.test" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: Object.entries(PESSOAS).map(([id, p]) => ({ id, empresaId: "e1", nome: p.nome, email: `${id}@ficticio.test`, senha: "x", role: p.role })) });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "11222333000181" } });
    const orc = (id: string, vendedorId: string, extra: object = {}) => prisma.orcamento.create({ data: {
      id, empresaId: "e1", codigo: `ORC-${id}`, nome: `Venda ${id}`, clienteId: "c1", criadoPorId: vendedorId, vendedorId,
      status: "ENVIADO", tipo: "COMUM", tokenPublico: `tok-${id}`, totalGeral: 100, ...extra,
    } });
    await orc("oAna", "uAna");
    await orc("oBeto", "uBeto", { status: "APROVADO", respostaVistaEm: null });
    const os = (id: string, extra: object) => prisma.ordemServico.create({ data: { id, empresaId: "e1", numero: `OS-${id}`, clienteId: "c1", descricao: `Serviço ${id}`, criadoPorId: "uGestor", ...extra } });
    await os("osDaVendaAna", { orcamentoOrigemId: "oAna" }); // entra pelo vendedor do orçamento de origem
    await os("osCriadaAna", { criadoPorId: "uAna" }); // entra porque a Ana criou
    await os("osVendaAna", { vendedorId: "uAna" }); // entra pelo vendedor da OS
    await os("osBeto", { vendedorId: "uBeto", orcamentoOrigemId: "oBeto" });
    await os("osSemDono", {}); // de ninguém: só quem não tem a marca vê
  }, 300_000);
  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma?.$disconnect();
  });

  const ids = (lista: any[]) => lista.map((x: any) => x.id).sort();

  it("listas e busca de orçamentos (API): cada vendedor só os seus; quem não tem a marca e o ADMIN veem todos", async () => {
    logar("uAna"); expect(ids((await chamar("orcamentos", "GET")).json)).toEqual(["oAna"]);
    logar("uBeto"); expect(ids((await chamar("orcamentos", "GET")).json)).toEqual(["oBeto"]);
    logar("uAna"); expect((await chamar("orcamentos", "GET", {}, undefined, "?busca=ORC-oBeto")).json).toEqual([]); // buscar o do outro não acha
    logar("uGestor"); expect(ids((await chamar("orcamentos", "GET")).json)).toEqual(["oAna", "oBeto"]);
    logar("uAdm"); expect(ids((await chamar("orcamentos", "GET")).json)).toEqual(["oAna", "oBeto"]);
  });

  it("listas, busca e exportação de OS: as ligadas às vendas da pessoa ou criadas por ela; nada do outro", async () => {
    logar("uAna");
    expect(ids((await chamar("ordens", "GET")).json)).toEqual(["osCriadaAna", "osDaVendaAna", "osVendaAna"]);
    expect((await chamar("ordens", "GET", {}, undefined, "?busca=OS-osBeto")).json).toEqual([]);
    const csv = (await chamar("ordens/export", "GET", {}, undefined, "?status=&periodo=todos") /* Leva I: OS sem agendamento */).texto;
    expect(csv).toContain("OS-osVendaAna");
    expect(csv).not.toMatch(/OS-osBeto|OS-osSemDono/);
    logar("uBeto"); expect(ids((await chamar("ordens", "GET")).json)).toEqual(["osBeto"]);
    logar("uGestor"); expect(ids((await chamar("ordens", "GET")).json)).toHaveLength(5);
    logar("uAdm"); expect(ids((await chamar("ordens", "GET")).json)).toHaveLength(5);
  });

  it("seleção em massa: 'ids do filtro' só conta os próprios; exportar/alterar ids do outro não passa", async () => {
    logar("uAna");
    const filtro = await chamar("acoes-massa", "POST", {}, { entidade: "ordens", acao: "ids-do-filtro", filtro: "periodo=todos" } /* Leva I: OS sem agendamento */);
    expect(filtro.json.total).toBe(3);
    expect(filtro.json.ids).not.toContain("osBeto");
    const exp = await chamar("acoes-massa", "POST", {}, { entidade: "orcamentos", acao: "exportar", ids: ["oAna", "oBeto"] });
    expect(exp.texto).toContain("ORC-oAna");
    expect(exp.texto).not.toContain("ORC-oBeto");
    const sóDoOutro = await chamar("acoes-massa", "POST", {}, { entidade: "orcamentos", acao: "inativar", ids: ["oBeto"], motivo: "Teste de vazamento" });
    expect(sóDoOutro.status).toBe(400); // a seleção fica vazia: nenhum registro
    expect((await prisma.orcamento.findUnique({ where: { id: "oBeto" } })).status).toBe("APROVADO");
  });

  it("painel e sino: as contagens de OS e orçamento são só da pessoa", async () => {
    const { carregarBlocos } = await import("@/lib/dashboard/dados");
    const { contarSino } = await import("@/lib/alertas/sino-server");
    const ctx = (id: string) => ({ empresaId: "e1", podeVer: () => true, quem: usuario(id) });
    const ana = await carregarBlocos(["operacional", "comercial"], ctx("uAna")) as any;
    const gestor = await carregarBlocos(["operacional", "comercial"], ctx("uGestor")) as any;
    expect([ana.operacional.abertas, gestor.operacional.abertas]).toEqual([3, 5]);
    expect([ana.comercial.orcamentosAbertos, gestor.comercial.orcamentosAbertos]).toEqual([1, 1]); // só o da Ana está ENVIADO
    expect([ana.comercial.orcamentosEnviados.quantidade, gestor.comercial.orcamentosEnviados.quantidade]).toEqual([1, 1]);
    const escopo = { orcamentos: true } as any;
    const sinoAna = await contarSino({ empresaId: "e1", usuarioId: "uAna", escopo, filtroTecnico: {} as any, quem: usuario("uAna") }) as any;
    const sinoGestor = await contarSino({ empresaId: "e1", usuarioId: "uGestor", escopo, filtroTecnico: {} as any, quem: usuario("uGestor") }) as any;
    // O cliente respondeu o orçamento do Beto: avisa quem não tem a marca, não a Ana
    expect(JSON.stringify(sinoAna)).not.toContain("oBeto");
    expect(JSON.stringify(sinoGestor)).toContain("oBeto");
  });

  it("páginas por id: o registro do outro não existe para a pessoa (notFound); o próprio e o ADMIN passam", async () => {
    const { noEscopo } = await import("@/lib/escopo/proprios-server");
    const ana = { ...usuario("uAna") };
    expect(await noEscopo(ana, "orcamento", "oBeto")).toBe(false);
    expect(await noEscopo(ana, "orcamento", "oAna")).toBe(true);
    expect(await noEscopo(ana, "ordem", "osBeto")).toBe(false);
    expect(await noEscopo(ana, "ordem", "osDaVendaAna")).toBe(true);
    expect(await noEscopo(usuario("uAdm"), "orcamento", "oBeto")).toBe(true);
    expect(await noEscopo(usuario("uGestor"), "ordem", "osSemDono")).toBe(true);
    // O guarda amarra a empresa da sessão: o mesmo id de vendedor noutra empresa não abre o registro desta
    expect(await noEscopo({ ...ana, empresaId: "e2" }, "orcamento", "oAna")).toBe(false);
    expect(await noEscopo({ ...ana, empresaId: "e2" }, "ordem", "osVendaAna")).toBe(false);
  });

  it("relatório de cumprimento de prazos: só as OS do escopo", async () => {
    const { relatorioCumprimento } = await import("@/lib/prazos/cumprimento-server");
    const so = (r: any) => r.semPrazo + r.linhas.length;
    expect(so(await relatorioCumprimento("e1", {}, new Date(), usuario("uAna")))).toBe(3);
    expect(so(await relatorioCumprimento("e1", {}, new Date(), usuario("uGestor")))).toBe(5);
  });

  /* ───────── a varredura: TODA rota por id de orçamento e de OS ───────── */
  const rotasPorId = (pasta: string) => {
    const r: string[] = [];
    const andar = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) andar(p); else if (f.name === "route.ts") r.push(p); } };
    andar(path.join(RAIZ, pasta));
    return r.map((p) => path.relative(path.join(RAIZ, "app/api"), path.dirname(p)));
  };
  const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const PARAMS_FALSOS = { atividadeId: "x", equipamentoId: "x", vinculoId: "x", itemId: "x", fotoId: "x", anexoId: "x", linhaId: "x", servicoId: "x" };

  it("varredura: toda rota de /api/orcamentos/[id] e /api/ordens/[id] passa pelo guarda e recusa o registro do outro com 404, mesmo com todas as permissões", async () => {
    const rotas = [...rotasPorId("app/api/orcamentos/[id]"), ...rotasPorId("app/api/ordens/[id]")];
    expect(rotas.length).toBeGreaterThan(50);
    const falhas: string[] = [];
    let chamadas = 0;
    for (const rota of rotas) {
      const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
      const tipo = rota.startsWith("ordens/") ? "ordem" : "orcamento";
      const alvo = tipo === "ordem" ? "osBeto" : "oBeto";
      for (const m of METODOS.filter((x) => typeof mod[x] === "function")) {
        // Com todas as permissões nenhuma rota recusa por permissão: TEM de ser o 404 do guarda (rota que chama o guarda
        // e ignora a resposta cai aqui)
        logar("uTudo");
        barrados.length = 0;
        const r = await chamar(rota, m, { id: alvo, ...PARAMS_FALSOS }, m === "GET" || m === "DELETE" ? undefined : {});
        chamadas++;
        const passou = barrados.some((b) => b.tipo === tipo && b.id === alvo && b.barrou);
        if (r.status !== 404 || !passou) falhas.push(`${m} ${rota} → ${r.status}${passou ? "" : " (sem o guarda)"}`);
      }
    }
    expect(falhas).toEqual([]);
    expect(chamadas).toBeGreaterThanOrEqual(80);
    // O próprio registro passa pelo guarda SEM ser barrado (o escopo não trava o que é dela)
    logar("uAna"); barrados.length = 0;
    await chamar("orcamentos/[id]", "GET", { id: "oAna" });
    expect(barrados).toEqual([{ tipo: "orcamento", id: "oAna", barrou: false }]);
    // Quem não tem a marca passa direto no registro de qualquer vendedor
    logar("uGestor"); barrados.length = 0;
    expect((await chamar("orcamentos/[id]", "GET", { id: "oBeto" })).status).toBe(200);
    expect(barrados).toEqual([{ tipo: "orcamento", id: "oBeto", barrou: false }]);
  });

  it("pedido do cliente (PC-1/PC-2): informar, liberar, a gaveta e o pedido do outro vendedor não passam; sem a marca, segue igual", async () => {
    const ped = await prisma.pedidoCliente.create({ data: { empresaId: "e1", clienteId: "c1", numero: "PC-BETO-1", data: new Date("2026-11-20"), anexo: Buffer.from("%PDF-1.4 pedido ficticio").toString("base64"), anexoNome: "pedido.pdf", ordens: { connect: [{ id: "osBeto" }] } } });
    logar("uTudo");
    expect((await chamar("pedidos-cliente", "POST", {}, { numero: "PC-1", osIds: ["osBeto"], orcamentoIds: [] })).status).toBe(404);
    expect((await chamar("pedidos-cliente/liberar", "POST", {}, { osIds: [], orcamentoIds: ["oBeto"], motivo: "Cliente autorizou por telefone" })).status).toBe(404);
    // A gaveta (leitura): a Ana pede as dela e as do Beto; voltam só as dela
    logar("uAna");
    const alvos = await chamar("pedidos-cliente/alvos", "GET", {}, undefined, "?os=osBeto,osVendaAna&orc=oBeto,oAna");
    expect(alvos.status).toBe(200);
    expect(alvos.json.itens.map((i: any) => i.id).sort()).toEqual(["oAna", "osVendaAna"]);
    logar("uTudo");
    for (const [rota, metodo, corpo] of [["pedidos-cliente/[id]", "GET", undefined], ["pedidos-cliente/[id]", "PATCH", { numero: "PC-X" }], ["pedidos-cliente/[id]/anexo", "GET", undefined], ["pedidos-cliente/[id]/conferir", "POST", { acao: "recusar", motivo: "Não confere" }]] as const) {
      expect([rota, metodo, (await chamar(rota, metodo, { id: ped.id }, corpo)).status]).toEqual([rota, metodo, 404]);
    }
    expect((await prisma.pedidoCliente.findUnique({ where: { id: ped.id } })).numero).toBe("PC-BETO-1");
    // Sem a marca: o pedido abre normalmente
    logar("uGestor");
    expect((await chamar("pedidos-cliente/[id]", "GET", { id: ped.id })).status).toBe(200);
    // (o anexo existe: o 404 de cima é do escopo, não de "anexo não encontrado")
    expect((await chamar("pedidos-cliente/[id]/anexo", "GET", { id: ped.id })).status).toBe(200);
  });

  it("os prazos da OS (rota pelo id do prazo) também respeitam o escopo", async () => {
    const p = await prisma.osPrazo.create({ data: { ordemServicoId: "osBeto", nome: "Entrega", status: "ATIVO" } });
    logar("uAna");
    expect((await chamar("os-prazos/[id]", "DELETE", { id: p.id })).status).toBe(404);
    expect((await prisma.osPrazo.findUnique({ where: { id: p.id } })).status).toBe("ATIVO");
  });
});
