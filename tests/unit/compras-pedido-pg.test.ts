/**
 * Pedido de Compra completo — rotas e telas do servidor com o Prisma real num PostgreSQL real:
 *  - criar na OS / no orçamento / avulso (permissão de cada origem; avulso só Compras › Gerenciar),
 *    número PCI-AAAA-NNNN pelo MAIOR sequencial da empresa (buraco não repete número), histórico;
 *  - comprador só entre os usuários ATIVOS com Compras (perfil ativo); fornecedor da empresa;
 *  - editar inline com histórico (itens por id: o custo real fica), travado em Concluída/Cancelada;
 *  - baixar / e-mail (Resend, ao contato do cadastro) / WhatsApp: cada um no histórico e
 *    "Solicitado" → "Em cotação"; sem contato, avisa e não muda nada; cancelar;
 *  - última compra (entrada por COMPRA com a NF, ou item de NF com conversão), compradores;
 *  - lista central (status com data, origem, busca), detalhe e o PC público SEM preço;
 *  - empresa sempre a da sessão.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/compras-pedido-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { anoBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_compras_pedido_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const ANO = anoBR();

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/compras/pedidos", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`); },
}));
const resend = vi.hoisted(() => ({ enviados: [] as any[], falhar: false }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async (m: any) => { resend.enviados.push(m); return resend.falhar ? { error: { message: "Domínio não verificado" } } : { data: { id: "x" } }; } };
  },
}));

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
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const item = (descricao: string, extra: Record<string, unknown> = {}) => ({ descricao, quantidade: 2, unidade: "un", ...extra });

describe.skipIf(!URL_PG)("Pedido de Compra completo (PostgreSQL real)", () => {
  let prisma: any;
  const eventos = async (pedidoId: string) =>
    (await prisma.pedidoCompraEvento.findMany({ where: { pedidoId }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] })).map((e: any) => e.tipo);

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
    await Promise.all(["pedidos-compra", "pedidos-compra/[id]", "pedidos-compra/[id]/enviar", "pedidos-compra/[id]/cancelar", "compras/ultima-compra", "compras/compradores"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    const { criptografar } = await import("@/lib/crypto");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", email: "contato@ct.com.br", telefone: "1133334444" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.perfilAcesso.createMany({ data: [
      { id: "pfCompras", empresaId: "e1", nome: "Compras", permissoes: montarPermissoes({ compras: ["visualizar", "gerenciar"] }) },
      { id: "pfAntigo", empresaId: "e1", nome: "Compras antigo", ativo: false, permissoes: montarPermissoes({ compras: ["visualizar"] }) },
      { id: "pfTec", empresaId: "e1", nome: "Técnico", permissoes: montarPermissoes({ ordens: ["visualizar", "editar"] }) },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uAdm", empresaId: "e1", nome: "Ana Admin", email: "a@x.com", senha: "x", role: "ADMIN" },
      { id: "uComp", empresaId: "e1", nome: "Paulo Compras", email: "p@x.com", senha: "x", perfilAcessoId: "pfCompras", telefone: "31988887777" },
      { id: "uAntigo", empresaId: "e1", nome: "Marcos (perfil inativo)", email: "m@x.com", senha: "x", perfilAcessoId: "pfAntigo" },
      { id: "uInativo", empresaId: "e1", nome: "Rita (inativa)", email: "r@x.com", senha: "x", perfilAcessoId: "pfCompras", ativo: false },
      { id: "uTec", empresaId: "e1", nome: "Téo Técnico", email: "t@x.com", senha: "x", perfilAcessoId: "pfTec" },
      { id: "uOutra", empresaId: "e2", nome: "Bia", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "22101333000111" },
      { id: "c2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33444555000100" },
    ] });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-2026-0012", clienteId: "c1", criadoPorId: "uAdm", descricao: "Corretiva" },
      { id: "osOutra", empresaId: "e2", numero: "OS-9", clienteId: "c2", criadoPorId: "uOutra", descricao: "x" },
    ] });
    await prisma.orcamento.createMany({ data: [
      { id: "orcNaOs", empresaId: "e1", codigo: "ORC-2026-0003", nome: "Orç na OS", clienteId: "c1", criadoPorId: "uAdm", tokenPublico: "tok-orc1" },
      { id: "orcSolto", empresaId: "e1", codigo: "ORC-2026-0004", nome: "Orç solto", clienteId: "c1", criadoPorId: "uAdm", tokenPublico: "tok-orc2" },
    ] });
    await prisma.orcamentoOs.create({ data: { orcamentoId: "orcNaOs", ordemServicoId: "os1" } });
    await prisma.produto.createMany({ data: [
      { id: "pFiltro", empresaId: "e1", nome: "Filtro secador", unidade: "un" },
      { id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "kg" },
      { id: "pNovo", empresaId: "e1", nome: "Capacitor", unidade: "un" },
      { id: "pInativo", empresaId: "e1", nome: "Velho", unidade: "un", ativo: false },
      { id: "pOutra", empresaId: "e2", nome: "Da outra", unidade: "un" },
    ] });
    await prisma.fornecedor.createMany({ data: [
      { id: "fFrig", empresaId: "e1", nome: "Frigelar", email: "vendas@frigelar.com.br", telefone: "1133334444" },
      { id: "fSemContato", empresaId: "e1", nome: "Sem Contato Ltda" },
      { id: "fOutra", empresaId: "e2", nome: "Fornecedor da outra", email: "x@y.com" },
    ] });
    // Histórico de compra: Filtro pela NF (entrada no estoque) e Gás por item de NF em cilindro de 11,35 kg
    await prisma.notaCompra.createMany({ data: [
      { id: "nf1", empresaId: "e1", fornecedorId: "fFrig", chaveAcesso: "1".repeat(44), numero: "5188", serie: "1", dataEmissao: new Date("2026-10-15T12:00:00Z"), valorTotal: 73.8, xml: "<x/>", emitenteNome: "FRIGELAR SA", emitenteCnpj: "1" },
      { id: "nf2", empresaId: "e1", fornecedorId: "fFrig", chaveAcesso: "2".repeat(44), numero: "5200", serie: "1", dataEmissao: new Date("2026-10-20T12:00:00Z"), valorTotal: 1135, xml: "<x/>", emitenteNome: "FRIGELAR SA", emitenteCnpj: "1" },
    ] });
    await prisma.movimentacaoEstoque.createMany({ data: [
      { empresaId: "e1", produtoId: "pFiltro", tipo: "ENTRADA", origem: "COMPRA", quantidade: 4, saldoApos: 4, custoUnitario: 17.9, refId: null, data: new Date("2026-09-01T12:00:00Z") },
      { empresaId: "e1", produtoId: "pFiltro", tipo: "ENTRADA", origem: "COMPRA", quantidade: 4, saldoApos: 8, custoUnitario: 18.45, refId: "nf1", data: new Date("2026-10-16T12:00:00Z") },
      { empresaId: "e1", produtoId: "pFiltro", tipo: "SAIDA", origem: "OS", quantidade: -1, saldoApos: 7, custoUnitario: 99, data: new Date("2026-10-20T12:00:00Z") },
    ] });
    // Item de NF do Filtro mais ANTIGO que a entrada da nf1: a entrada (mais recente) é que vale
    await prisma.notaCompra.create({ data: { id: "nf0", empresaId: "e1", fornecedorId: "fSemContato", chaveAcesso: "0".repeat(44), numero: "100", serie: "1", dataEmissao: new Date("2026-08-01T12:00:00Z"), valorTotal: 15, xml: "<x/>", emitenteNome: "ANTIGO", emitenteCnpj: "0" } });
    await prisma.notaCompraItem.create({ data: { notaId: "nf0", numeroItem: 1, codigoFornecedor: "F0", descricaoFornecedor: "FILTRO", unidade: "UN", quantidade: 1, valorUnitario: 15, valorTotal: 15, produtoId: "pFiltro" } });
    await prisma.notaCompraItem.create({ data: { notaId: "nf2", numeroItem: 1, codigoFornecedor: "G1", descricaoFornecedor: "GAS R410A CIL 11,35KG", unidade: "CIL", quantidade: 1, valorUnitario: 1135, valorTotal: 1135, fatorConversao: 11.35, produtoId: "pGas" } });
    await prisma.emailConfig.create({ data: { empresaId: "e1", ativo: true, apiKey: criptografar("re_teste"), remetente: "compras@ct.com.br", nomeRemetente: "Clima Total" } });
    // Pedido da outra empresa com o número que seria o próximo daqui: não conta
    await prisma.pedidoCompraInterno.create({ data: { id: "pcOutra", empresaId: "e2", numero: `PCI-${ANO}-0050`, solicitanteId: "uOutra" } });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(() => { resend.enviados = []; resend.falhar = false; logar(); });

  it("criar na OS: número do ano, comprador avisado, histórico 'Pedido criado'", async () => {
    logar(montarPermissoes({ ordens: ["visualizar", "editar"] }), "uTec");
    const r = await chamar("pedidos-compra", "POST", {
      ordemServicoId: "os1", compradorId: "uComp", prazoNecessario: "2026-11-05", observacao: "Urgente",
      itens: [item("Filtro secador", { produtoId: "pFiltro", quantidade: 4, valorEstimado: 18.45 }), item("Fita isolante")],
    });
    expect(r.status).toBe(201);
    expect(r.json.numero).toBe(`PCI-${ANO}-0001`);
    expect(r.json.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5531988887777\?text=/);
    expect(decodeURIComponent(r.json.whatsappUrl)).toContain("OS: OS-2026-0012 — Hospital Santa Clara");
    const p = await prisma.pedidoCompraInterno.findUnique({ where: { id: r.json.id } });
    expect(p).toMatchObject({ status: "SOLICITADO", solicitanteId: "uTec", motivo: null, empresaId: "e1" });
    expect(p.prazoNecessario.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(await eventos(r.json.id)).toEqual(["CRIADO"]);
  });

  it("número pelo MAIOR sequencial: excluir não faz repetir; outra empresa não conta", async () => {
    const a = await chamar("pedidos-compra", "POST", { orcamentoId: "orcSolto", itens: [item("A")] });
    const b = await chamar("pedidos-compra", "POST", { orcamentoId: "orcSolto", itens: [item("B")] });
    expect([a.json.numero, b.json.numero]).toEqual([`PCI-${ANO}-0002`, `PCI-${ANO}-0003`]);
    await prisma.pedidoCompraInterno.delete({ where: { id: a.json.id } });
    const c = await chamar("pedidos-compra", "POST", { orcamentoId: "orcSolto", itens: [item("C")] });
    expect(c.json.numero).toBe(`PCI-${ANO}-0004`);
    // Pedido legado (PC-…, count) não atrapalha
    await prisma.pedidoCompraInterno.create({ data: { empresaId: "e1", numero: "PC-2026-0031", solicitanteId: "uAdm" } });
    expect((await chamar("pedidos-compra", "POST", { orcamentoId: "orcSolto", itens: [item("D")] })).json.numero).toBe(`PCI-${ANO}-0005`);
  });

  it("avulso: só Compras › Gerenciar; motivo padrão 'Reposição de estoque'", async () => {
    logar(montarPermissoes({ ordens: ["visualizar", "editar"], compras: ["visualizar"] }), "uTec");
    expect((await chamar("pedidos-compra", "POST", { itens: [item("X")] })).status).toBe(403);
    logar(montarPermissoes({ compras: ["visualizar", "gerenciar"] }), "uComp");
    const r = await chamar("pedidos-compra", "POST", { itens: [item("Filtro", { produtoId: "pFiltro" })], fornecedorId: "fFrig" });
    expect(r.status).toBe(201);
    expect(r.json.motivo).toBe("Reposição de estoque");
    const r2 = await chamar("pedidos-compra", "POST", { motivo: "Estoque mínimo da van", itens: [item("Y")] });
    expect(r2.json.motivo).toBe("Estoque mínimo da van");
    expect(decodeURIComponent((await prisma.pedidoCompraEvento.findFirst({ where: { pedidoId: r2.json.id } })).detalhe)).toBe("1 item · Estoque mínimo da van");
    // De OS sem editar OS (nem Compras › Gerenciar): não
    logar(montarPermissoes({ ordens: ["visualizar"] }), "uTec");
    expect((await chamar("pedidos-compra", "POST", { ordemServicoId: "os1", itens: [item("Z")] })).status).toBe(403);
  });

  it("comprador: só ATIVO com Compras (perfil ativo); fornecedor/produto/OS da empresa", async () => {
    const corpo = (extra: Record<string, unknown>) => ({ ordemServicoId: "os1", itens: [item("X")], ...extra });
    for (const compradorId of ["uAntigo", "uInativo", "uTec", "uOutra"]) {
      const r = await chamar("pedidos-compra", "POST", corpo({ compradorId }));
      expect(r.status, compradorId).toBe(400);
      expect(r.json.erro).toBe("O comprador precisa ser um usuário ativo com acesso a Compras.");
    }
    expect((await chamar("pedidos-compra", "POST", corpo({ compradorId: "uAdm" }))).status).toBe(201); // ADMIN tem tudo
    expect((await chamar("pedidos-compra", "POST", corpo({ fornecedorId: "fOutra" }))).status).toBe(400);
    expect((await chamar("pedidos-compra", "POST", corpo({ itens: [item("X", { produtoId: "pOutra" })] }))).status).toBe(400);
    expect((await chamar("pedidos-compra", "POST", corpo({ itens: [item("X", { produtoId: "pInativo" })] }))).status).toBe(400);
    expect((await chamar("pedidos-compra", "POST", { ordemServicoId: "osOutra", itens: [item("X")] })).status).toBe(404);
    // A lista de compradores da tela: os mesmos (ordem alfabética)
    const lista = await chamar("compras/compradores", "GET");
    expect(lista.json.map((c: any) => c.id)).toEqual(["uAdm", "uComp"]);
    logar(montarPermissoes({ clientes: ["visualizar"] }), "uX");
    expect((await chamar("compras/compradores", "GET")).status).toBe(403);
  });

  it("editar inline: histórico com cada mudança; item mantido guarda o custo real; removido sai", async () => {
    const r = await chamar("pedidos-compra", "POST", { ordemServicoId: "os1", compradorId: "uComp", prazoNecessario: "2026-11-05",
      itens: [item("Filtro secador", { produtoId: "pFiltro", quantidade: 4 }), item("Fita isolante")] });
    const id = r.json.id;
    const [i1, i2] = await prisma.pedidoCompraItem.findMany({ where: { pedidoId: id }, orderBy: { id: "asc" } });
    await prisma.pedidoCompraItem.update({ where: { id: i1.id }, data: { valorReal: 18.45 } });

    logar(montarPermissoes({ ordens: ["visualizar", "editar"] }), "uTec"); // quem edita a OS edita o pedido dela
    const e = await chamar("pedidos-compra/[id]", "PUT", {
      compradorId: "uComp", fornecedorId: "fFrig", prazoNecessario: "2026-11-10", observacao: "Entregar na obra",
      itens: [{ id: i1.id, produtoId: "pFiltro", descricao: "Filtro secador", quantidade: 6, unidade: "un", valorEstimado: 18.45 }, item("Gás R410A", { produtoId: "pGas", quantidade: 1, unidade: "kg" })],
    }, { id });
    expect(e.status).toBe(200);
    expect(e.json.mudancas).toEqual([
      "Prazo necessário: 05/11/2026 → 10/11/2026", "Fornecedor: — → Frigelar", "Observação alterada",
      "Quantidade de Filtro secador: 4 un → 6 un", "Item adicionado: Gás R410A (1 kg)", "Item removido: Fita isolante",
    ]);
    const itens = await prisma.pedidoCompraItem.findMany({ where: { pedidoId: id }, orderBy: { descricao: "asc" } });
    expect(itens.map((i: any) => [i.descricao, Number(i.quantidade), i.valorReal == null ? null : Number(i.valorReal)])).toEqual([["Filtro secador", 6, 18.45], ["Gás R410A", 1, null]]);
    expect(itens.some((i: any) => i.id === i2.id)).toBe(false);
    expect(await eventos(id)).toEqual(["CRIADO", "EDITADO"]);
    expect(e.json).toMatchObject({ fornecedor: { nome: "Frigelar" }, prazoNecessario: "2026-11-10", origem: { tipo: "OS" } });

    // Salvar igual: nenhuma linha nova no histórico
    const igual = await chamar("pedidos-compra/[id]", "PUT", {
      compradorId: "uComp", fornecedorId: "fFrig", prazoNecessario: "2026-11-10", observacao: "Entregar na obra",
      itens: e.json.itens.map((i: any) => ({ id: i.id, produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, unidade: i.unidade, valorEstimado: i.valorEstimado })),
    }, { id });
    expect(igual.json.mudancas).toEqual([]);
    expect(await eventos(id)).toEqual(["CRIADO", "EDITADO"]);

    // Id de item de OUTRO pedido não é editado: vira item novo
    const outro = await prisma.pedidoCompraItem.findFirst({ where: { pedidoId: { not: id } } });
    await chamar("pedidos-compra/[id]", "PUT", { itens: [{ id: outro.id, descricao: "Invasor", quantidade: 1, unidade: "un" }] }, { id });
    expect((await prisma.pedidoCompraItem.findUnique({ where: { id: outro.id } })).descricao).not.toBe("Invasor");

    // Sem permissão (só vê a OS) e de outra empresa
    logar(montarPermissoes({ ordens: ["visualizar"] }), "uOutroTec");
    expect((await chamar("pedidos-compra/[id]", "PUT", { itens: [item("X")] }, { id })).status).toBe(403);
    expect((await chamar("pedidos-compra/[id]", "GET", undefined, { id })).status).toBe(200); // vê a OS: vê o pedido
    logar(montarPermissoes({ clientes: ["visualizar"] }), "uX");
    expect((await chamar("pedidos-compra/[id]", "GET", undefined, { id })).status).toBe(403);
    logar(permissoesTotais(), "uOutra", "e2");
    expect((await chamar("pedidos-compra/[id]", "PUT", { itens: [item("X")] }, { id })).status).toBe(404);
    expect((await chamar("pedidos-compra/[id]", "GET", undefined, { id })).status).toBe(404);
  });

  it("Concluída/Cancelada travam a edição e o envio (baixar continua)", async () => {
    const r = await chamar("pedidos-compra", "POST", { orcamentoId: "orcSolto", fornecedorId: "fFrig", itens: [item("X")] });
    await prisma.pedidoCompraInterno.update({ where: { id: r.json.id }, data: { status: "CONCLUIDO" } });
    const e = await chamar("pedidos-compra/[id]", "PUT", { itens: [item("Y")] }, { id: r.json.id });
    expect(e).toMatchObject({ status: 409, json: { erro: "Pedido concluído ou cancelado não pode mais ser editado." } });
    expect((await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "WHATSAPP" }, { id: r.json.id })).status).toBe(409);
    expect((await chamar("pedidos-compra/[id]/cancelar", "POST", {}, { id: r.json.id })).status).toBe(409);
    const b = await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "BAIXAR" }, { id: r.json.id });
    expect(b.status).toBe(200);
    expect(b.json.status).toBe("CONCLUIDO");
    const tela = await chamar("pedidos-compra/[id]", "GET", undefined, { id: r.json.id });
    expect(tela.json).toMatchObject({ podeEditar: false, podeEnviar: true });
  });

  it("baixar e enviar: histórico + 'Em cotação' (uma vez só, com a data); sem contato avisa e não muda", async () => {
    const r = await chamar("pedidos-compra", "POST", { orcamentoId: "orcNaOs", prazoNecessario: "2026-11-05", itens: [item("Filtro")] });
    const id = r.json.id;
    // Sem fornecedor: e-mail/WhatsApp avisam; nada no histórico, status igual
    for (const canal of ["EMAIL", "WHATSAPP"]) {
      const s = await chamar("pedidos-compra/[id]/enviar", "POST", { canal }, { id });
      expect(s).toMatchObject({ status: 400 });
      expect(s.json.erro).toContain("Escolha o fornecedor");
    }
    expect((await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "FAX" }, { id })).status).toBe(400);
    expect(await eventos(id)).toEqual(["CRIADO"]);

    // Baixar: Solicitado → Em cotação
    await prisma.pedidoCompraInterno.update({ where: { id }, data: { statusEm: new Date("2026-01-01T00:00:00Z") } });
    const b = await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "BAIXAR" }, { id });
    expect(b.json).toMatchObject({ status: "COTANDO", pdfUrl: `/pedido-compra/${r.json.tokenPublico}?imprimir=1` });
    let p = await prisma.pedidoCompraInterno.findUnique({ where: { id } });
    expect(p.status).toBe("COTANDO");
    expect(p.statusEm.getTime()).toBeGreaterThan(new Date("2026-01-02").getTime());
    expect(await eventos(id)).toEqual(["CRIADO", "BAIXADO", "STATUS"]);
    expect((await prisma.pedidoCompraEvento.findFirst({ where: { pedidoId: id, tipo: "STATUS" } })).detalhe).toBe("Solicitado → Em cotação");

    // Fornecedor sem contato: avisa por canal
    await prisma.pedidoCompraInterno.update({ where: { id }, data: { fornecedorId: "fSemContato" } });
    expect(await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "EMAIL" }, { id })).toMatchObject({ status: 400, json: { erro: "O fornecedor Sem Contato Ltda não tem e-mail no cadastro." } });
    expect((await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "WHATSAPP" }, { id })).json.erro).toBe("O fornecedor Sem Contato Ltda não tem telefone no cadastro.");

    // Com contato: WhatsApp para o telefone do cadastro, com o link público
    await prisma.pedidoCompraInterno.update({ where: { id }, data: { fornecedorId: "fFrig" } });
    const w = await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "WHATSAPP" }, { id });
    expect(w.json.whatsappUrl).toMatch(/^https:\/\/wa\.me\/551133334444\?text=/);
    expect(decodeURIComponent(w.json.whatsappUrl)).toContain(`Pedido de Compra Nº ${r.json.numero} de Clima Total para cotação (necessário até 05/11/2026):\nhttp://localhost/pedido-compra/${r.json.tokenPublico}`);
    // E-mail pelo Resend da empresa, ao e-mail do fornecedor, com o link público
    const em = await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "EMAIL" }, { id });
    expect(em.json).toMatchObject({ ok: true, emailEnviado: true, status: "COTANDO" });
    expect(resend.enviados).toHaveLength(1);
    expect(resend.enviados[0]).toMatchObject({ to: "vendas@frigelar.com.br", from: "Clima Total <compras@ct.com.br>", subject: `Pedido de Compra ${r.json.numero} — Clima Total` });
    expect(resend.enviados[0].html).toContain(`https://app.frivo.com.br/pedido-compra/${r.json.tokenPublico}`);
    expect(texto(resend.enviados[0].html)).toContain("para cotação (necessário até 05/11/2026)");
    // Já em cotação: não registra STATUS de novo
    expect(await eventos(id)).toEqual(["CRIADO", "BAIXADO", "STATUS", "ENVIADO_WHATSAPP", "ENVIADO_EMAIL"]);
    const det = await prisma.pedidoCompraEvento.findMany({ where: { pedidoId: id, tipo: { in: ["ENVIADO_WHATSAPP", "ENVIADO_EMAIL"] } }, orderBy: { criadoEm: "asc" } });
    expect(det.map((e: any) => e.detalhe)).toEqual(["Frigelar · 1133334444", "Frigelar · vendas@frigelar.com.br"]);

    // Resend falhou: erro, nada registrado
    resend.falhar = true;
    const f = await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "EMAIL" }, { id });
    expect(f).toMatchObject({ status: 502, json: { erro: "Domínio não verificado" } });
    expect((await eventos(id)).length).toBe(5);

    // Sem Resend configurado: abre o e-mail do usuário (mailto) e registra
    resend.falhar = false;
    resend.enviados = [];
    await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: false } });
    try {
      const m = await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "EMAIL" }, { id });
      expect(m.json.mailtoUrl).toMatch(/^mailto:vendas%40frigelar\.com\.br\?subject=/);
      expect(decodeURIComponent(m.json.mailtoUrl)).toContain(`http://localhost/pedido-compra/${r.json.tokenPublico}`);
      expect(resend.enviados).toHaveLength(0);
      expect((await prisma.pedidoCompraEvento.findFirst({ where: { pedidoId: id }, orderBy: { criadoEm: "desc" } })).detalhe).toBe("pelo e-mail do usuário, para vendas@frigelar.com.br");
    } finally {
      await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: true } });
    }
  });

  it("quem envia: Compras ou o comprador designado (quem só edita a OS, não); cancelar com motivo", async () => {
    const r = await chamar("pedidos-compra", "POST", { ordemServicoId: "os1", compradorId: "uComp", fornecedorId: "fFrig", itens: [item("X")] });
    const id = r.json.id;
    logar(montarPermissoes({ ordens: ["visualizar", "editar"] }), "uTec");
    expect((await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "BAIXAR" }, { id })).status).toBe(403);
    expect((await chamar("pedidos-compra/[id]", "GET", undefined, { id })).json).toMatchObject({ podeEditar: true, podeEnviar: false });
    logar(montarPermissoes({}), "uComp"); // sem perfil na sessão, mas é o comprador designado
    expect((await chamar("pedidos-compra/[id]/enviar", "POST", { canal: "BAIXAR" }, { id })).status).toBe(200);
    logar(montarPermissoes({ ordens: ["visualizar"] }), "uTec");
    expect((await chamar("pedidos-compra/[id]/cancelar", "POST", {}, { id })).status).toBe(403);
    logar();
    const c = await chamar("pedidos-compra/[id]/cancelar", "POST", { motivo: "Cliente desistiu" }, { id });
    expect(c.json).toMatchObject({ ok: true, status: "CANCELADO" });
    expect((await prisma.pedidoCompraEvento.findFirst({ where: { pedidoId: id, tipo: "CANCELADO" } })).detalhe).toBe("Cliente desistiu");
    expect((await chamar("pedidos-compra/[id]/cancelar", "POST", {}, { id })).json.erro).toBe("Pedido já cancelada.");
  });

  it("última compra: a mais recente (entrada com a NF ou item de NF convertido); sem histórico não vem", async () => {
    const r = await chamar("compras/ultima-compra", "GET", undefined, {}, "?produtoIds=pFiltro,pGas,pNovo,pOutra");
    expect(Object.keys(r.json).sort()).toEqual(["pFiltro", "pGas"]);
    expect(r.json.pFiltro).toMatchObject({ valorUnitario: 18.45, fornecedor: "Frigelar" });
    expect(new Date(r.json.pFiltro.data).toISOString()).toBe("2026-10-15T12:00:00.000Z"); // data de emissão da NF
    expect(r.json.pGas.valorUnitario).toBeCloseTo(100, 6); // R$ 1.135 o cilindro ÷ 11,35 kg
    expect(r.json.pGas.fornecedor).toBe("Frigelar");
    // Outra empresa não vê o histórico daqui
    logar(permissoesTotais(), "uOutra", "e2");
    expect((await chamar("compras/ultima-compra", "GET", undefined, {}, "?produtoIds=pFiltro")).json).toEqual({});
    logar(montarPermissoes({ clientes: ["visualizar"] }), "uX");
    expect((await chamar("compras/ultima-compra", "GET", undefined, {}, "?produtoIds=pFiltro")).status).toBe(403);
  });

  it("lista central: status com a data, origem (orçamento dentro da OS mostra a OS), busca e filtro; só a empresa", async () => {
    const r = await chamar("pedidos-compra", "POST", { orcamentoId: "orcNaOs", fornecedorId: "fFrig", itens: [item("Capacitor 35uF")] });
    const { default: Lista } = await import("@/app/(dashboard)/compras/pedidos/page");
    const h = renderToStaticMarkup(await Lista({ searchParams: Promise.resolve({}) }));
    const linha = h.split(`data-linha="${r.json.id}"`)[1].split("</tr>")[0];
    expect(texto(linha).replace(/ \)/g, ")")).toContain(`${r.json.numero} Capacitor 35uF (2 un) OS OS-2026-0012 (orçamento ORC-2026-0003) Frigelar — — Solicitado desde`);
    expect(linha).toContain('data-status-pedido="SOLICITADO"');
    expect(linha).toMatch(/data-status-desde="true">desde \d{2}\/\d{2}\/\d{4}/);
    expect(h).toContain('href="/compras/pedidos/novo"');
    expect(h).not.toContain(`PCI-${ANO}-0050`); // da outra empresa

    const busca = renderToStaticMarkup(await Lista({ searchParams: Promise.resolve({ q: "capacitor 35" }) }));
    expect(busca.match(/data-linha="/g)).toHaveLength(1);
    const avulsos = renderToStaticMarkup(await Lista({ searchParams: Promise.resolve({ origem: "AVULSO" }) }));
    expect(texto(avulsos)).toContain("Avulso — Reposição de estoque");
    expect(avulsos).not.toContain("OS-2026-0012");

    logar(montarPermissoes({ compras: ["visualizar"] }), "uComp"); // sem gerenciar: sem "Novo pedido avulso"
    expect(renderToStaticMarkup(await Lista({ searchParams: Promise.resolve({}) }))).not.toContain("data-novo-avulso");
    logar(montarPermissoes({ compras: ["visualizar"] }), "uComp");
    const { default: Novo } = await import("@/app/(dashboard)/compras/pedidos/novo/page");
    await expect(Novo()).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
  });

  it("detalhe: mesma regra da API; o PC público mostra timbre, itens e campos em branco — nenhum preço", async () => {
    const r = await chamar("pedidos-compra", "POST", { ordemServicoId: "os1", compradorId: "uComp", fornecedorId: "fFrig", prazoNecessario: "2026-11-05", observacao: "Urgente",
      itens: [item("Filtro secador", { produtoId: "pFiltro", quantidade: 4, valorEstimado: 987.65 }), item("Gás R410A", { quantidade: 11.35, unidade: "kg", valorEstimado: 432.1 })] });
    const { default: Detalhe } = await import("@/app/(dashboard)/compras/pedidos/[id]/page");
    logar(montarPermissoes({ clientes: ["visualizar"] }), "uX");
    await expect(Detalhe({ params: Promise.resolve({ id: r.json.id }) })).rejects.toThrow("NEXT_REDIRECT /sem-permissao");
    logar(montarPermissoes({ ordens: ["visualizar"] }), "uTec"); // quem vê a OS vê o pedido
    const d = renderToStaticMarkup(await Detalhe({ params: Promise.resolve({ id: r.json.id }) }));
    expect(d).toContain(`data-painel-pedido="${r.json.id}"`);
    expect(d).not.toContain("data-baixar-pc"); // não envia
    expect(d).not.toContain("data-editar-pedido"); // não edita

    const { default: Publico } = await import("@/app/(publico)/pedido-compra/[token]/page");
    const h = renderToStaticMarkup(await Publico({ params: Promise.resolve({ token: r.json.tokenPublico }), searchParams: Promise.resolve({}) }));
    const t = texto(h);
    expect(h).toContain("data-timbre");
    expect(t).toContain("Clima Total Refrigeração Ltda");
    expect(t).toContain(`Pedido de Compra Nº ${r.json.numero}`);
    expect(t).toContain("Necessário até: 05/11/2026");
    expect(t).toContain("Origem: OS OS-2026-0012");
    expect(t).toContain("Frigelar");
    expect(t).toContain("1 Filtro secador 4,00 un");
    expect(t).toContain("2 Gás R410A 11,35 kg");
    expect(t).toContain("Preço unit. (R$)");
    expect(t).toContain("Validade da proposta");
    expect(t).toContain("aos cuidados de Paulo Compras");
    expect(t).not.toMatch(/987|432|R\$ \d/);
    expect(h).toContain("data-imprimir-pedido");
    await expect(Publico({ params: Promise.resolve({ token: "nao-existe" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lista da OS e lista geral: quem vê a OS lista os dela; a geral pede Compras ou Financeiro", async () => {
    logar(montarPermissoes({ ordens: ["visualizar"] }), "uTec");
    const os = await chamar("pedidos-compra", "GET", undefined, {}, "?ordemServicoId=os1");
    expect(os.status).toBe(200);
    expect(os.json.length).toBeGreaterThan(0);
    expect(os.json.every((p: any) => p.ordemServicoId === "os1")).toBe(true);
    expect((await chamar("pedidos-compra", "GET")).status).toBe(403);
    logar(montarPermissoes({ financeiro: ["visualizar"] }), "uFin");
    expect((await chamar("pedidos-compra", "GET")).status).toBe(200);
    logar(permissoesTotais(), "uOutra", "e2");
    expect((await chamar("pedidos-compra", "GET")).json.map((p: any) => p.id)).toEqual(["pcOutra"]);
  });
});
