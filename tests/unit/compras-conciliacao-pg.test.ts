/**
 * Compras 2/2 — Conciliação NF ↔ Pedido de Compra com o Prisma real num PostgreSQL real:
 *  - NF idêntica ao pedido: a tela sugere ("vai ser vinculado sozinho") e o lançamento vincula sozinho,
 *    item a item: valor real da NF, status Concluída, histórico, conta a pagar ligada e o solicitante
 *    avisado (e-mail + sino só dele; abrir o pedido apaga o sino);
 *  - vincular 2× não duplica; desvincular volta o status e o valor real de antes, com histórico;
 *  - entrega parcial: 1ª NF → Parcial; a 2ª é sugerida (não idêntica) e vinculada em 1 clique →
 *    Concluída com o valor real ponderado; tirar a 1ª → Parcial de novo;
 *  - segurança: empresa da sessão, Compras › gerenciar para vincular/desvincular/escolher no lançamento.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/compras-conciliacao-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, moduloDaRota, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_compras_conc_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/estoque/notas", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); },
}));
const resend = vi.hoisted(() => ({ enviados: [] as any[] }));
vi.mock("resend", () => ({ Resend: class { emails = { send: async (m: any) => { resend.enviados.push(m); return { data: { id: "x" } }; } }; } }));

const ESTOQUE_FIN = montarPermissoes({ estoque: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fluxoCaixa"] });
/** vê Compras, mas não gerencia: não vincula nem desvincula */
const COMPRAS_VER = montarPermissoes({ estoque: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fluxoCaixa"], compras: ["visualizar"] });
const logar = (permissoes: Permissoes = permissoesTotais(), id = "uAdm", empresaId = "e1", role = "OPERADOR") => {
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, empresaNome: "Clima Total", role, permissoes } };
};

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const lancar = (id: string, corpo: Record<string, unknown> = {}) => chamar("compras/notas/[id]/lancar", "POST", corpo, { id });
const vincular = (id: string, pedidoId: string) => chamar("compras/notas/[id]/vinculos", "POST", { pedidoId }, { id });
const desvincular = (id: string, pedidoId: string) => chamar("compras/notas/[id]/vinculos", "DELETE", undefined, { id }, `?pedidoId=${pedidoId}`);
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const D = (s: string) => new Date(`${s}T12:00:00Z`);

describe.skipIf(!URL_PG)("Conciliação NF ↔ Pedido de Compra (PostgreSQL real)", () => {
  let prisma: any;
  const pedido = (id: string) => prisma.pedidoCompraInterno.findUnique({ where: { id }, include: { itens: { orderBy: { descricao: "asc" } }, eventos: { orderBy: [{ criadoEm: "asc" }, { id: "asc" }] } } });
  const valores = async (id: string) => (await pedido(id)).itens.map((i: any) => [i.descricao, i.valorReal == null ? null : Number(i.valorReal)]);
  const tipos = async (id: string) => (await pedido(id)).eventos.map((e: any) => e.tipo);
  const sino = async (id: string, perms: Permissoes) => { logar(perms, id); const r = await chamar("alertas", "GET"); logar(); return r.json; };

  let seq = 0;
  /** NF da empresa com os itens já com produto (como depois do de-para) */
  async function nota(itens: { produtoId: string | null; descricao: string; quantidade: number; valorUnitario: number; unidade?: string; fator?: number }[], x: Record<string, unknown> = {}) {
    seq++;
    const total = itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
    return (await prisma.notaCompra.create({ data: {
      empresaId: "e1", fornecedorId: "fFrig", chaveAcesso: String(seq).padStart(44, "9"), numero: String(4600 + seq), serie: "1",
      dataEmissao: D("2026-10-20"), valorTotal: total, xml: "<x/>", emitenteNome: "FRIGELAR SA", emitenteCnpj: "11222333000181", ...x,
      itens: { create: itens.map((i, k) => ({
        numeroItem: k + 1, codigoFornecedor: `C${seq}-${k}`, descricaoFornecedor: i.descricao, unidade: i.unidade ?? "UN",
        quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorTotal: i.quantidade * i.valorUnitario, produtoId: i.produtoId, fatorConversao: i.fator ?? 1,
      })) },
    } })).id as string;
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    process.env.NEXTAUTH_URL = "https://app.frivo.com.br";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["compras/notas/[id]/lancar", "compras/notas/[id]/vinculos", "alertas"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    const { criptografar } = await import("@/lib/crypto");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "contato@ct.com.br" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.perfilAcesso.createMany({ data: [
      { id: "pfTec", empresaId: "e1", nome: "Técnico", permissoes: montarPermissoes({ ordens: ["visualizar", "editar"] }) },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uAdm", empresaId: "e1", nome: "Ana Admin", email: "a@x.com", senha: "x", role: "ADMIN" },
      { id: "uSol", empresaId: "e1", nome: "Sérgio Técnico", email: "sergio@ct.com.br", senha: "x", perfilAcessoId: "pfTec" },
      { id: "uOutra", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.produto.createMany({ data: [
      { id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "kg" },
      { id: "pFil", empresaId: "e1", nome: "Filtro secador", unidade: "un" },
      { id: "pCap", empresaId: "e1", nome: "Capacitor", unidade: "un" },
    ] });
    await prisma.fornecedor.createMany({ data: [
      { id: "fFrig", empresaId: "e1", nome: "Frigelar", documento: "11222333000181" },
      { id: "fOutro", empresaId: "e1", nome: "Outro fornecedor" },
      { id: "fE2", empresaId: "e2", nome: "Da outra" },
    ] });
    await prisma.emailConfig.create({ data: { empresaId: "e1", ativo: true, apiKey: criptografar("re_teste"), remetente: "compras@ct.com.br", nomeRemetente: "Clima Total" } });

    const pc = (id: string, numero: string, itens: any[], x: Record<string, unknown> = {}) => prisma.pedidoCompraInterno.create({ data: {
      id, empresaId: "e1", numero, solicitanteId: "uSol", fornecedorId: "fFrig", status: "COTANDO", criadoEm: D("2026-10-05"), ...x,
      itens: { create: itens }, eventos: { create: [{ empresaId: x.empresaId ?? "e1", tipo: "BAIXADO", detalhe: "PC baixado" }] },
    } });
    // A: idêntico à NF 1 (gás 11,35 kg em 1 cilindro + 4 filtros). B: entrega parcial (gás 10 kg, filtro 4)
    await pc("pcA", "PCI-2026-0001", [
      { id: "aGas", produtoId: "pGas", descricao: "Gás R410A", quantidade: 11.35, unidade: "kg", valorEstimado: 95, valorReal: 88 },
      { id: "aFil", produtoId: "pFil", descricao: "Filtro secador", quantidade: 4, unidade: "un", valorEstimado: 25 },
    ]);
    await pc("pcB", "PCI-2026-0002", [
      { id: "bGas", produtoId: "pGas", descricao: "Gás R410A", quantidade: 10, unidade: "kg", valorEstimado: 100 },
      { id: "bFil", produtoId: "pFil", descricao: "Filtro secador", quantidade: 4, unidade: "un", valorEstimado: 25 },
    ], { criadoEm: D("2026-10-06") });
    await pc("pcFechado", "PCI-2026-0003", [{ produtoId: "pCap", descricao: "Capacitor", quantidade: 1 }], { status: "CONCLUIDO" });
    await prisma.pedidoCompraInterno.create({ data: { id: "pcE2", empresaId: "e2", numero: "PCI-2026-0001", solicitanteId: "uOutra", status: "COTANDO",
      itens: { create: [{ produtoId: null, descricao: "Gás R410A", quantidade: 1 }] } } });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(() => { resend.enviados = []; logar(); });

  let n1 = "";

  it("NF idêntica: a central sugere o pedido e avisa que vai vincular sozinho (com os motivos)", async () => {
    // 1 cilindro de 11,35 kg (de-para com fator) + 4 filtros: idêntico ao PCI-0001
    n1 = await nota([
      { produtoId: "pGas", descricao: "GAS R410A CIL 11,35KG", quantidade: 1, valorUnitario: 1021.5, unidade: "CIL", fator: 11.35 },
      { produtoId: "pFil", descricao: "FILTRO SECADOR 032S", quantidade: 4, valorUnitario: 27.9 },
    ]);
    const { default: NotaPage } = await import("@/app/(dashboard)/estoque/notas/[id]/page");
    const h = renderToStaticMarkup(await NotaPage({ params: Promise.resolve({ id: n1 }) }));
    const t = texto(h);
    expect(t).toContain("Esta NF parece ser do Pedido PCI-2026-0001 — vincular?");
    expect(t).toContain("Mesmo fornecedor da NF");
    expect(t).toContain("2 de 2 itens batem: Filtro secador (produto); Gás R410A (produto)");
    expect(t).toContain("Quantidades: a NF cobre tudo o que falta");
    expect(h).toContain("data-vai-sozinho");
    expect(h).toContain(">Automático (o pedido idêntico)</option>");
    expect(h).toContain('data-escolher-pedido="pcA"');
    // o B também combina (mesmo fornecedor e produtos), mas não é idêntico: aparece como "também pode ser"
    expect(t).toContain("Também pode ser do Pedido PCI-2026-0002 — vincular?");
    // pedido fechado e de outra empresa: nem no select
    expect(h).not.toContain("PCI-2026-0003");
    expect(h.match(/<option value="pc[^"]*"/g)).toEqual(['<option value="pcB"', '<option value="pcA"']); // mais novo primeiro

    // sem Compras › gerenciar: vê a sugestão, mas não escolhe (o idêntico vincula sozinho mesmo assim)
    logar(ESTOQUE_FIN, "uAdm");
    const sem = renderToStaticMarkup(await NotaPage({ params: Promise.resolve({ id: n1 }) }));
    expect(sem).toContain("data-sugestoes-pedido");
    expect(sem).toContain("data-sem-compras");
    expect(sem).not.toContain("data-escolher-pedido");
    expect(sem).not.toContain("data-pedido=");
  });

  it("lançar: o idêntico vincula sozinho item a item — valor real, Concluída, histórico, conta ligada e e-mail ao solicitante", async () => {
    logar(ESTOQUE_FIN, "uAdm"); // nem precisa de Compras: o vínculo idêntico é do sistema
    const r = await lancar(n1);
    expect(r.status).toBe(201);
    expect(r.json.vinculoPedido).toMatchObject({ pedidoId: "pcA", numero: "PCI-2026-0001", status: "CONCLUIDO", automatico: true, criados: 2 });
    const vs = await prisma.pedidoCompraVinculo.findMany({ where: { notaId: n1 }, orderBy: { pedidoItemId: "asc" } });
    expect(vs.map((v: any) => [v.pedidoItemId, Number(v.quantidade), Number(v.valorUnitario), v.valorRealAnterior == null ? null : Number(v.valorRealAnterior), v.criterio, v.automatico, v.empresaId]))
      .toEqual([["aFil", 4, 27.9, null, "PRODUTO", true, "e1"], ["aGas", 11.35, 90, 88, "PRODUTO", true, "e1"]]);
    const p = await pedido("pcA");
    expect(p.status).toBe("CONCLUIDO");
    expect(await valores("pcA")).toEqual([["Filtro secador", 27.9], ["Gás R410A", 90]]);
    expect(p.nfVinculadaEm).not.toBeNull();
    expect(p.nfVistaEm).toBeNull();
    expect(p.eventos.at(-1)).toMatchObject({ tipo: "NF_VINCULADA", usuarioId: "uAdm" });
    expect(p.eventos.at(-1).detalhe).toBe(`NF ${4600 + 1}/1 vinculada automaticamente (idêntica ao pedido): Filtro secador 4 un; Gás R410A 11,35 kg — status Concluída`);
    const n = await prisma.notaCompra.findUnique({ where: { id: n1 }, include: { contasPagar: true } });
    expect(n.pedidoCompraId).toBe("pcA");
    expect(n.contasPagar.map((c: any) => c.pedidoCompraId)).toEqual(["pcA"]);
    expect(resend.enviados).toHaveLength(1);
    expect(resend.enviados[0]).toMatchObject({ to: "sergio@ct.com.br", subject: `Pedido PCI-2026-0001: chegou a NF ${4600 + 1} — Concluída` });
    expect(resend.enviados[0].html).toContain("https://app.frivo.com.br/compras/pedidos/pcA");
    expect(resend.enviados[0].html).toContain("Gás R410A: 11,35 kg");
  });

  it("sino: só o solicitante vê 'NF chegou' (sem precisar de Compras); abrir o pedido apaga", async () => {
    const tec = montarPermissoes({ ordens: ["visualizar", "editar"] });
    expect(await sino("uSol", tec)).toMatchObject({ nfPedidos: 1, nfPedidoId: "pcA", pedidosPendentes: 0 });
    expect((await sino("uSol", tec)).total).toBeGreaterThanOrEqual(1);
    expect(await sino("uAdm", permissoesTotais())).toMatchObject({ nfPedidos: 0, nfPedidoId: null });
    // o detalhe do pedido não passa pelo gate de Compras do middleware (a página decide: quem pediu entra)
    expect(moduloDaRota("/compras/pedidos/pcA")).toBeNull();
    expect(moduloDaRota("/compras/pedidos")).toBe("compras");
    expect(moduloDaRota("/compras/pedidos/novo")).toBe("compras");
    const { default: PedidoPage } = await import("@/app/(dashboard)/compras/pedidos/[id]/page");
    // outra pessoa (admin) abrir não apaga o sino do solicitante
    renderToStaticMarkup(await PedidoPage({ params: Promise.resolve({ id: "pcA" }) }));
    expect((await pedido("pcA")).nfVistaEm).toBeNull();
    logar(tec, "uSol");
    const h = renderToStaticMarkup(await PedidoPage({ params: Promise.resolve({ id: "pcA" }) }));
    expect(h).toContain(`data-nota-pedido="${n1}"`);
    expect(h).toContain("data-nota-automatica");
    expect(texto(h)).toContain("recebido 11,35");
    expect(h).not.toContain("data-desvincular-nota"); // o solicitante vê, não desvincula
    expect((await pedido("pcA")).nfVistaEm).not.toBeNull();
    expect(await sino("uSol", tec)).toMatchObject({ nfPedidos: 0 });
    // técnico que NÃO pediu: não entra
    await prisma.usuario.create({ data: { id: "uTec2", empresaId: "e1", nome: "Outro técnico", email: "t2@x.com", senha: "x", perfilAcessoId: "pfTec" } });
    logar(tec, "uTec2");
    await expect(PedidoPage({ params: Promise.resolve({ id: "pcA" }) })).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
  });

  it("vincular 2× não duplica; desvincular volta status e valor real de antes, com histórico; 2º desvincular = 404", async () => {
    const de = await vincular(n1, "pcA");
    expect([de.status, de.json.criados]).toEqual([409, undefined]); // Concluído não recebe mais NF
    expect(de.json.erro).toBe("O pedido PCI-2026-0001 está Concluída: não recebe NF.");
    expect(await prisma.pedidoCompraVinculo.count({ where: { notaId: n1 } })).toBe(2);

    const d = await desvincular(n1, "pcA");
    expect([d.status, d.json.status, d.json.removidos]).toEqual([200, "COTANDO", 2]);
    expect(await valores("pcA")).toEqual([["Filtro secador", null], ["Gás R410A", 88]]);
    expect(await tipos("pcA")).toEqual(["BAIXADO", "NF_VINCULADA", "NF_DESVINCULADA"]);
    expect((await pedido("pcA")).eventos.at(-1).detalhe).toBe(`NF ${4600 + 1}/1 desvinculada: Filtro secador 4 un; Gás R410A 11,35 kg — status Em cotação`);
    expect((await prisma.notaCompra.findUnique({ where: { id: n1 } })).pedidoCompraId).toBeNull();
    const de2 = await desvincular(n1, "pcA");
    expect([de2.status, de2.json.erro]).toEqual([404, "Esta NF não está vinculada a este pedido."]);

    // depois de lançada: a NF mostra a sugestão com "Vincular" (1 clique)
    const { default: NotaPage } = await import("@/app/(dashboard)/estoque/notas/[id]/page");
    const h = renderToStaticMarkup(await NotaPage({ params: Promise.resolve({ id: n1 }) }));
    expect(h).toContain('data-vincular-pedido="pcA"');
    expect(h).not.toContain("data-vinculo-pedido");

    // vincular de novo (à mão) e de novo: o 2º não duplica nem gera histórico
    const v1 = await vincular(n1, "pcA");
    expect([v1.status, v1.json.criados, v1.json.automatico, v1.json.status]).toEqual([201, 2, false, "CONCLUIDO"]);
    // vínculo novo acende o sino de quem pediu de novo (ele já tinha visto o anterior)
    expect((await pedido("pcA")).nfVistaEm).toBeNull();
    expect((await prisma.notaCompra.findUnique({ where: { id: n1 } })).pedidoCompraId).toBe("pcA");
    await prisma.pedidoCompraInterno.update({ where: { id: "pcA" }, data: { status: "PARCIAL" } }); // força reabrir para tentar de novo
    const v2 = await vincular(n1, "pcA");
    expect([v2.status, v2.json.criados]).toEqual([200, 0]);
    expect(await prisma.pedidoCompraVinculo.count({ where: { notaId: n1 } })).toBe(2);
    expect((await tipos("pcA")).filter((t: string) => t === "NF_VINCULADA")).toHaveLength(2);
    expect(resend.enviados).toHaveLength(1); // só o vínculo que criou avisa
    await prisma.pedidoCompraInterno.update({ where: { id: "pcA" }, data: { status: "CONCLUIDO" } });

    const h2 = renderToStaticMarkup(await NotaPage({ params: Promise.resolve({ id: n1 }) }));
    expect(h2).toContain('data-vinculo-pedido="pcA"');
    expect(h2).toContain('data-desvincular-pedido="pcA"');
    expect(h2).not.toContain("data-vinculo-automatico");
    expect(texto(h2)).toContain("(recebido 4 de 4)");
    logar(ESTOQUE_FIN, "uAdm"); // sem Compras: lê, não mexe
    const leitura = renderToStaticMarkup(await NotaPage({ params: Promise.resolve({ id: n1 }) }));
    expect(leitura).toContain('data-vinculo-pedido="pcA"');
    expect(leitura).not.toContain("data-desvincular-pedido");
  });

  it("entrega parcial: 1ª NF → Parcial; 2ª sugerida e vinculada em 1 clique → Concluída (valor real ponderado); tirar a 1ª → Parcial", async () => {
    const n2 = await nota([{ produtoId: "pGas", descricao: "GAS R410A", quantidade: 4, valorUnitario: 95 }], { dataEmissao: D("2026-10-21") });
    const r = await lancar(n2, { pedidoCompraId: "pcB" });
    expect(r.status).toBe(201);
    expect(r.json.vinculoPedido).toMatchObject({ pedidoId: "pcB", status: "PARCIAL", automatico: false, criados: 1, itens: [{ descricao: "Gás R410A", quantidade: 4, unidade: "kg" }] });
    expect((await pedido("pcB")).status).toBe("PARCIAL");
    expect(await valores("pcB")).toEqual([["Filtro secador", null], ["Gás R410A", 95]]);
    expect(resend.enviados[0].subject).toBe(`Pedido PCI-2026-0002: chegou a NF ${4600 + 2} — Parcial`);

    // 2ª NF: o resto (6 kg) + os filtros. Não é idêntica (o pedido já recebeu NF): só sugere
    const n3 = await nota([
      { produtoId: "pGas", descricao: "GAS R410A", quantidade: 6, valorUnitario: 105 },
      { produtoId: "pFil", descricao: "FILTRO", quantidade: 4, valorUnitario: 25 },
    ], { dataEmissao: D("2026-10-25") });
    const { sugestoesDaNota } = await import("@/lib/compras/conciliacao-server");
    const s = (await sugestoesDaNota("e1", n3))!;
    expect(s.automatico).toBeNull();
    expect(s.sugestoes.map((x: any) => x.pedidoId)).toEqual(["pcB"]); // nem o fechado (A), nem o da outra empresa
    expect(s.sugestoes[0]).toMatchObject({ pedidoId: "pcB", identico: false, itensAbertos: 2, itensCobertos: 2 });
    expect(s.sugestoes[0].pares.map((p: any) => [p.pedidoItemId, p.quantidade]).sort()).toEqual([["bFil", 4], ["bGas", 6]]);
    const l3 = await lancar(n3);
    expect([l3.status, l3.json.vinculoPedido]).toEqual([201, null]);
    expect(await prisma.pedidoCompraVinculo.count({ where: { notaId: n3 } })).toBe(0);
    const v = await vincular(n3, "pcB");
    expect([v.status, v.json.status, v.json.criados]).toEqual([201, "CONCLUIDO", 2]);
    // gás: 4 kg a 95 + 6 kg a 105 = 101 (ponderado)
    expect(await valores("pcB")).toEqual([["Filtro secador", 25], ["Gás R410A", 101]]);
    // a NF 1 já foi toda para o pedido A: o que sobrou dela não é sugerido para o B
    expect((await sugestoesDaNota("e1", n1))!.sugestoes).toEqual([]);

    const d = await desvincular(n2, "pcB");
    expect([d.status, d.json.status]).toEqual([200, "PARCIAL"]);
    expect(await valores("pcB")).toEqual([["Filtro secador", 25], ["Gás R410A", 105]]);
    const d3 = await desvincular(n3, "pcB");
    expect(d3.json.status).toBe("COTANDO"); // nada recebido: volta ao de antes da NF (o PC tinha sido baixado)
    expect(await valores("pcB")).toEqual([["Filtro secador", null], ["Gás R410A", null]]);
    expect(await tipos("pcB")).toEqual(["BAIXADO", "NF_VINCULADA", "NF_VINCULADA", "NF_DESVINCULADA", "NF_DESVINCULADA"]);
  });

  it("segurança: empresa da sessão, Compras › gerenciar, NF lançada, pedido em aberto", async () => {
    const solta = await nota([{ produtoId: "pCap", descricao: "CAPACITOR", quantidade: 1, valorUnitario: 30 }]);
    // NF ainda não lançada: o vínculo vem no lançamento
    expect(await vincular(solta, "pcB")).toMatchObject({ status: 409, json: { erro: "Lance a nota antes: o vínculo usa os produtos e as quantidades já conferidos." } });
    // sem Compras › gerenciar (só visualizar): nem vincular, nem desvincular, nem escolher o pedido ao lançar
    logar(COMPRAS_VER, "uAdm");
    expect((await vincular(n1, "pcB")).status).toBe(403);
    expect((await desvincular(n1, "pcA")).status).toBe(403);
    expect(await lancar(solta, { pedidoCompraId: "pcB" })).toMatchObject({ status: 403, json: { erro: "Vincular a nota a um pedido de compra precisa de Compras › gerenciar." } });
    logar();
    // outra empresa: a NF daqui não existe para ela; o pedido de lá não existe para cá
    logar(permissoesTotais(), "uOutra", "e2");
    expect(await vincular(n1, "pcE2")).toMatchObject({ status: 404, json: { erro: "Nota não encontrada." } });
    expect((await desvincular(n1, "pcA")).status).toBe(404);
    logar();
    expect(await vincular(n1, "pcE2")).toMatchObject({ status: 404, json: { erro: "Pedido de compra não encontrado." } });
    expect(await vincular(n1, "pcFechado")).toMatchObject({ status: 409, json: { erro: "O pedido PCI-2026-0003 está Concluída: não recebe NF." } });
    // nada casa: recusa explicando (a NF 1 e o B não têm o que casar — o gás e o filtro dela já foram para o A)
    expect(await vincular(n1, "pcB")).toMatchObject({ status: 409, json: { erro: "Nenhum item desta NF casa com o que falta no pedido PCI-2026-0002." } });
    expect(await chamar("compras/notas/[id]/vinculos", "POST", {}, { id: n1 })).toMatchObject({ status: 400 });
    expect(await chamar("compras/notas/[id]/vinculos", "DELETE", undefined, { id: n1 })).toMatchObject({ status: 400 });
    expect(await prisma.pedidoCompraVinculo.count({ where: { empresaId: "e2" } })).toBe(0);
  });

  it("dois pedidos idênticos à mesma NF: ambíguo — sugere os dois e não vincula sozinho", async () => {
    const itens = [{ produtoId: "pCap", descricao: "Capacitor", quantidade: 2, unidade: "un" }];
    for (const [id, numero] of [["pcC1", "PCI-2026-0010"], ["pcC2", "PCI-2026-0011"]])
      await prisma.pedidoCompraInterno.create({ data: { id, empresaId: "e1", numero, solicitanteId: "uSol", fornecedorId: "fFrig", status: "SOLICITADO", criadoEm: D("2026-10-05"), itens: { create: itens } } });
    const n = await nota([{ produtoId: "pCap", descricao: "CAPACITOR 35UF", quantidade: 2, valorUnitario: 30 }]);
    const r = await lancar(n);
    expect([r.status, r.json.vinculoPedido]).toEqual([201, null]);
    const { sugestoesDaNota } = await import("@/lib/compras/conciliacao-server");
    expect((await sugestoesDaNota("e1", n))!.sugestoes.map((s: any) => s.pedidoId).sort()).toEqual(["pcC1", "pcC2"]);
    // outro fornecedor: idêntico em itens, mas não vincula sozinho
    await prisma.pedidoCompraInterno.update({ where: { id: "pcC2" }, data: { status: "CANCELADO" } });
    await prisma.pedidoCompraInterno.update({ where: { id: "pcC1" }, data: { fornecedorId: "fOutro" } });
    const n4 = await nota([{ produtoId: "pCap", descricao: "CAPACITOR 35UF", quantidade: 2, valorUnitario: 30 }]);
    expect((await lancar(n4)).json.vinculoPedido).toBeNull();
    expect((await sugestoesDaNota("e1", n4))!.sugestoes[0].motivos[0]).toBe("Fornecedor do pedido é outro");
  });

  it("2ª NF escolhida no mesmo pedido (entrega parcial) lança: só conta a pagar lançada à mão trava; o sino aponta o pedido mais recente", async () => {
    const tec = montarPermissoes({ ordens: ["visualizar", "editar"] });
    for (const [id, numero, dia] of [["pcD", "PCI-2026-0020", "2026-10-07"], ["pcE", "PCI-2026-0021", "2026-10-08"]])
      await prisma.pedidoCompraInterno.create({ data: { id, empresaId: "e1", numero, solicitanteId: "uSol", fornecedorId: "fFrig", status: "COTANDO", criadoEm: D(dia),
        itens: { create: [{ id: `${id}Gas`, produtoId: "pGas", descricao: "Gás R410A", quantidade: 10, unidade: "kg" }] } } });
    const a = await nota([{ produtoId: "pGas", descricao: "GAS", quantidade: 4, valorUnitario: 90 }]);
    expect((await lancar(a, { pedidoCompraId: "pcD" })).json.vinculoPedido).toMatchObject({ status: "PARCIAL" });
    const b = await nota([{ produtoId: "pGas", descricao: "GAS", quantidade: 6, valorUnitario: 90 }]);
    const r = await lancar(b, { pedidoCompraId: "pcD" });
    expect([r.status, r.json.vinculoPedido?.status]).toEqual([201, "CONCLUIDO"]);
    expect((await prisma.contaPagar.findMany({ where: { notaCompraId: { in: [a, b] } } })).map((c: any) => c.pedidoCompraId)).toEqual(["pcD", "pcD"]);
    // conta lançada à mão no pedido: aí sim duplicaria a dívida
    await prisma.contaPagar.create({ data: { empresaId: "e1", numero: "CP-MANUAL-1", fornecedor: "Outro", descricao: "Adiantamento", valorTotal: 100, saldoRestante: 100, pedidoCompraId: "pcE", dataVencimento: D("2026-11-01") } });
    const c = await nota([{ produtoId: "pGas", descricao: "GAS", quantidade: 10, valorUnitario: 90 }]);
    expect(await lancar(c, { pedidoCompraId: "pcE" })).toMatchObject({ status: 409, json: { erro: "O pedido PCI-2026-0021 já tem a conta a pagar CP-MANUAL-1: lance a nota sem vincular o pedido, ou cancele aquela conta antes." } });
    // e o idêntico que vincula sozinho não liga a conta da NF a ele (mas vincula os itens)
    const l = await lancar(c);
    expect(l.json.vinculoPedido).toMatchObject({ pedidoId: "pcE", automatico: true, status: "CONCLUIDO" });
    expect((await prisma.contaPagar.findMany({ where: { notaCompraId: c } })).map((x: any) => x.pedidoCompraId)).toEqual([null]);
    // dois pedidos com NF nova para o mesmo solicitante: o sino conta 2 e aponta o mais recente
    await prisma.pedidoCompraInterno.updateMany({ where: { solicitanteId: "uSol" }, data: { nfVistaEm: new Date() } });
    await prisma.pedidoCompraInterno.update({ where: { id: "pcD" }, data: { nfVinculadaEm: new Date("2026-10-26T10:00:00Z"), nfVistaEm: null } });
    await prisma.pedidoCompraInterno.update({ where: { id: "pcE" }, data: { nfVinculadaEm: new Date("2026-10-26T11:00:00Z"), nfVistaEm: null } });
    const s = await sino("uSol", tec);
    expect([s.nfPedidos, s.nfPedidoId]).toEqual([2, "pcE"]);
  });

  it("pedido cancelado depois do vínculo: desvincular não o reabre; solicitante inativo não recebe e-mail", async () => {
    await prisma.pedidoCompraInterno.create({ data: { id: "pcF", empresaId: "e1", numero: "PCI-2026-0030", solicitanteId: "uSol", fornecedorId: "fFrig", status: "COTANDO", criadoEm: D("2026-10-07"),
      itens: { create: [{ id: "fFil", produtoId: "pFil", descricao: "Filtro secador", quantidade: 3, unidade: "un", valorReal: 20 }] } } });
    await prisma.usuario.update({ where: { id: "uSol" }, data: { ativo: false } });
    const n = await nota([{ produtoId: "pFil", descricao: "FILTRO", quantidade: 3, valorUnitario: 26 }]);
    expect((await lancar(n, { pedidoCompraId: "pcF" })).json.vinculoPedido).toMatchObject({ status: "CONCLUIDO", criados: 1 });
    expect(resend.enviados).toEqual([]);
    await prisma.usuario.update({ where: { id: "uSol" }, data: { ativo: true } });
    await prisma.pedidoCompraInterno.update({ where: { id: "pcF" }, data: { status: "CANCELADO" } });
    const d = await desvincular(n, "pcF");
    expect([d.status, d.json.status]).toEqual([200, "CANCELADO"]);
    expect((await pedido("pcF")).status).toBe("CANCELADO");
    expect(await valores("pcF")).toEqual([["Filtro secador", 20]]);
  });
});
