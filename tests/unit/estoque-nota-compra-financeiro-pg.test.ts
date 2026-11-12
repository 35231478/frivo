/**
 * Estoque E2.1 — a central de lançamento com o Prisma real num PostgreSQL real (schema descartável via
 * `prisma db push`). Prova o que o banco em memória não consegue:
 *  - o rascunho (parcelas em JSONB, categoria/centro/forma) volta igual do banco; "voltar à NF" grava NULL;
 *  - lançar grava as contas com centro, categoria, forma e boleto (linha + código de barras), o preço da
 *    linha no produto (decimais certos) e o padrão do fornecedor — e a próxima nota já vem com ele;
 *  - tudo-ou-nada: um erro no meio (mesmo produto com dois preços) desfaz TUDO, inclusive o financeiro
 *    que veio no corpo do lançamento e o que o fornecedor aprenderia;
 *  - nome de centro de custo único sem diferença de maiúsculas (mode insensitive do PostgreSQL).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/estoque-nota-compra-financeiro-pg
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_e21_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const XML1 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4521-frigelar.xml"), "utf8");
const XML2 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4610-frigelar.xml"), "utf8");
const BOLETO = { linha: "10492006506100010004200997263900989810000021403", barras: "10499898100000214032006561000100040099726390" };

describe.skipIf(!URL_PG)("central de lançamento no PostgreSQL real", () => {
  let prisma: any;
  let lib: typeof import("@/lib/compras/notas");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    lib = await import("@/lib/compras/notas");
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.produto.createMany({ data: [
      { id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "un", valorPadrao: 950 },
      { id: "pCap", empresaId: "e1", nome: "Capacitor", unidade: "pc", valorPadrao: 38.9 },
    ] });
    await prisma.categoriaFinanceira.create({ data: { id: "catMat", empresaId: "e1", nome: "Materiais" } });
    await prisma.centroCusto.createMany({ data: [{ id: "ccObra", empresaId: "e1", nome: "Obra Shopping Norte" }, { id: "ccFrota", empresaId: "e1", nome: "Frota" }] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const PODE = { podePrecificar: true, podeFinanceiro: true };
  const itensDa = (notaId: string) => prisma.notaCompraItem.findMany({ where: { notaId }, orderBy: { numeroItem: "asc" } });
  const contagens = async () => ({
    movs: await prisma.movimentacaoEstoque.count(), contas: await prisma.contaPagar.count(), produtos: await prisma.produto.count(), deParas: await prisma.deParaProdutoFornecedor.count(),
  });

  it("erro no meio (mesmo produto com dois preços) desfaz TUDO: estoque, contas, preço, financeiro do corpo e o aprendizado", async () => {
    const { nota } = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML1 });
    const [gas, cap, tubo] = await itensDa(nota.id);
    const antes = await contagens();
    await expect(lib.lancarNota({
      empresaId: "e1", usuarioId: "u1", notaId: nota.id, podePrecificar: true,
      escolhas: [
        { itemId: gas.id, produtoId: "pGas", preco: { modo: "preco", preco: 1000 } },
        { itemId: cap.id, produtoId: "pGas", preco: { modo: "preco", preco: 1100 } },
        { itemId: tubo.id, novo: { nome: "Tubo" } },
      ],
      financeiro: { categoriaId: "catMat", centroCustoId: "ccObra", formaPagamento: "PIX", parcelas: [{ duplicata: null, vencimento: "2026-11-20", valor: 1749.3, boleto: BOLETO.linha }] },
    })).rejects.toThrow("Gás R410A aparece em mais de um item com preços diferentes: deixe o preço de venda em um só.");
    expect(await contagens()).toEqual(antes);
    const depois = await prisma.notaCompra.findUnique({ where: { id: nota.id }, include: { itens: true, fornecedor: true } });
    expect([depois.status, depois.lancadaEm, depois.categoriaId, depois.centroCustoId, depois.formaPagamento, depois.parcelas]).toEqual(["IMPORTADA", null, null, null, "BOLETO", null]);
    expect(depois.itens.every((i: any) => i.produtoId === null && i.precoVenda === null)).toBe(true);
    expect([depois.fornecedor.categoriaPadraoId, depois.fornecedor.centroCustoPadraoId]).toEqual([null, null]);
    expect((await prisma.produto.findUnique({ where: { id: "pGas" } })).valorPadrao.toString()).toBe("950");
    await prisma.notaCompra.delete({ where: { id: nota.id } });
  });

  it("rascunho volta igual do banco; lançar grava contas com centro, categoria, forma e boleto, o preço da linha e o padrão do fornecedor", async () => {
    const { nota } = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML1 });
    expect(nota.formaPagamento).toBe("BOLETO");
    const [gas, cap, tubo] = await itensDa(nota.id);
    const parcelas = [
      { duplicata: null, vencimento: "2026-11-20", valor: 874.65, boleto: BOLETO.barras },
      { duplicata: null, vencimento: "2026-12-20", valor: 874.65, boleto: null },
    ];
    await lib.conciliar({
      empresaId: "e1", notaId: nota.id, ...PODE,
      escolhas: [{ itemId: gas.id, produtoId: "pGas", preco: { modo: "margem", margem: 30 } }, { itemId: cap.id, produtoId: "pCap" }, { itemId: tubo.id, novo: { nome: "Tubo de cobre 1/4" }, preco: { modo: "preco", preco: 19.9 } }],
      financeiro: { categoriaId: "catMat", centroCustoId: "ccObra", formaPagamento: "BOLETO", parcelas: parcelas as any },
    });
    const rascunho = await prisma.notaCompra.findUnique({ where: { id: nota.id } });
    expect(rascunho.parcelas).toEqual([{ ...parcelas[0], boleto: BOLETO.linha }, parcelas[1]]); // JSONB: volta igual (boleto já como linha)
    expect(lib.parcelasDoRascunho(rascunho.parcelas)).toHaveLength(2);
    const itens = await itensDa(nota.id);
    expect([itens[0].precoVenda.toString(), itens[0].margemVenda.toString(), itens[2].precoVenda.toString(), itens[2].margemVenda]).toEqual(["985.57", "30", "19.9", null]);

    const r = await lib.lancarNota({ empresaId: "e1", usuarioId: "u1", notaId: nota.id, podePrecificar: true });
    expect(r.precosAplicados.map((p) => [p.produto, p.precoAnterior, p.preco, p.margem])).toEqual([["Gás R410A", 950, 985.57, 30], ["Tubo de cobre 1/4", null, 19.9, null]]);
    const contas = await prisma.contaPagar.findMany({ where: { notaCompraId: nota.id }, orderBy: { numero: "asc" } });
    expect(contas.map((c: any) => [c.valorTotal.toString(), c.dataVencimento.toISOString(), c.categoriaId, c.centroCustoId, c.formaPagamento, c.linhaDigitavel, c.codigoBarrasBoleto])).toEqual([
      ["874.65", "2026-11-20T12:00:00.000Z", "catMat", "ccObra", "BOLETO", BOLETO.linha, BOLETO.barras],
      ["874.65", "2026-12-20T12:00:00.000Z", "catMat", "ccObra", "BOLETO", null, null],
    ]);
    const gasDepois = await prisma.produto.findUnique({ where: { id: "pGas" } });
    expect([gasDepois.valorPadrao.toString(), gasDepois.margemVenda.toString()]).toEqual(["985.57", "30"]);
    const f = await prisma.fornecedor.findFirst({ where: { empresaId: "e1", documento: "11222333000181" } });
    expect([f.categoriaPadraoId, f.centroCustoPadraoId]).toEqual(["catMat", "ccObra"]);

    // a próxima nota do mesmo fornecedor já vem com a classificação; "voltar à NF" grava NULL de verdade
    const { nota: n2 } = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML2 });
    expect([n2.categoriaId, n2.centroCustoId, n2.formaPagamento]).toEqual(["catMat", "ccObra", "DINHEIRO"]);
    await lib.conciliar({ empresaId: "e1", notaId: n2.id, escolhas: [], ...PODE, financeiro: { parcelas: [{ duplicata: null, vencimento: "2026-11-03", valor: 829.1, boleto: null }] } });
    await lib.conciliar({ empresaId: "e1", notaId: n2.id, escolhas: [], ...PODE, financeiro: { parcelas: null } });
    expect((await prisma.$queryRawUnsafe(`SELECT parcelas IS NULL AS nulo FROM "${SCHEMA}"."notas_compra" WHERE id = $1`, n2.id))[0].nulo).toBe(true);
  });

  it("centro de custo: nome único sem diferença de maiúsculas (cadastro padrão, PostgreSQL de verdade)", async () => {
    const { CADASTROS } = await import("@/lib/cadastros/registro");
    const { criarCadastro, editarCadastro } = await import("@/lib/cadastros/servidor");
    const ator = { id: "u1", nome: "Ana", empresaId: "e1", role: "ADMIN", permissoes: {} as any };
    const dup = await criarCadastro(CADASTROS["centros-custo"], ator, { nome: "OBRA shopping NORTE" });
    expect(dup).toEqual({ ok: false, status: 409, erro: "Já existe o centro de custo “Obra Shopping Norte”." });
    const novo = await criarCadastro(CADASTROS["centros-custo"], ator, { nome: "Administrativo" });
    expect(novo.ok && novo.item).toMatchObject({ nome: "Administrativo", empresaId: "e1", ativo: true });
    expect(await editarCadastro(CADASTROS["centros-custo"], ator, (novo as any).item.id, { nome: "frota" })).toMatchObject({ ok: false, status: 409 });
    expect(await editarCadastro(CADASTROS["centros-custo"], ator, (novo as any).item.id, { nome: "Administrativo central" })).toMatchObject({ ok: true });
  });
});
