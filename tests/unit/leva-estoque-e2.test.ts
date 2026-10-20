/**
 * Estoque E2 — entrada por NF-e de compra (XML). Leitor da NF-e com as fixtures 4.00 e rotas reais
 * com banco em memória (DUAS empresas). Prova:
 *  - o XML é lido certo (chave, emitente, itens, duplicatas) e XML errado é recusado com motivo;
 *  - reimportar a mesma nota (mesma chave) é bloqueado — antes e depois de lançar — sem duplicar nada;
 *  - fornecedor criado pelo emitente ou reaproveitado pelo CNPJ (com ou sem máscara);
 *  - nota emitida para outro CNPJ é recusada;
 *  - de-para: cria produto novo (unidade da nota) e vincula existente; aprende e pré-vincula na 2ª nota;
 *  - lançar: entrada no estoque pela função da E1 (origem COMPRA, refId = nota, custo = vUnCom),
 *    contas a pagar uma por duplicata (valor e vencimento certos) ou à vista; pedido recebe valorReal;
 *  - lançar 2x é recusado; empresa sempre da sessão; permissões de Estoque e Financeiro.
 * (Atomicidade/concorrência no PostgreSQL real: estoque-nota-compra-pg.test.ts; o SQL: sql-estoque-nota-compra.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { chaveValida, dvChave, ErroNfe, lerNfe, mesmaRaizCnpj, parcelasDaNota } from "@/lib/compras/nfe";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const por = (T: (m: string) => any[], m: string, id: string | null | undefined) => T(m).find((x) => x.id === id) ?? null;
  return {
    prisma: criarPrisma(db, {
      notaCompra: (n, T) => ({
        criadoEm: n.criadoEm ?? new Date("2026-10-20T12:00:00Z"), // default(now()) do banco
        fornecedor: por(T, "fornecedor", n.fornecedorId),
        itens: T("notaCompraItem").filter((i) => i.notaId === n.id).map((i) => ({ ...i, produto: por(T, "produto", i.produtoId) })),
        contasPagar: T("contaPagar").filter((c) => c.notaCompraId === n.id),
        pedidoCompra: por(T, "pedidoCompraInterno", n.pedidoCompraId),
        usuario: por(T, "usuario", n.usuarioId),
        _count: { itens: T("notaCompraItem").filter((i) => i.notaId === n.id).length },
      }),
      notaCompraItem: (i, T) => ({ produto: por(T, "produto", i.produtoId) }),
      movimentacaoEstoque: (m, T) => ({ produto: por(T, "produto", m.produtoId) }),
      // produto criado pela rota não traz `ativo` (no banco é default true)
      deParaProdutoFornecedor: (d, T) => { const p = por(T, "produto", d.produtoId); return { produto: p && { ...p, ativo: p.ativo ?? true } }; },
      pedidoCompraInterno: (p, T) => ({ contasPagar: T("contaPagar").filter((c) => c.pedidoCompraId === p.id) }),
    }, { notaCompra: { itens: ["notaCompraItem", "notaId"] } }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/estoque/notas", useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", role = "OPERADOR", id = "u1") => {
  sessao.atual = { user: { id, name: "Ana", email: "a@x.com", empresaId, role, permissoes } };
};
const so = (p: Record<string, Record<string, boolean>>): Permissoes => ({ ...permissoesVazias(), ...p });

const FIX = (f: string) => readFileSync(path.resolve(__dirname, "fixtures/nfe", f), "utf8");
const XML1 = FIX("nfe-4521-frigelar.xml"); // 3 itens, 3 duplicatas
const XML2 = FIX("nfe-4610-frigelar.xml"); // mesmo fornecedor: R410A-11 de novo + item novo; sem duplicata
const CHAVE1 = "35261011222333000181550010000045211000045217";
const ANO = new Date().getFullYear();

function semear() {
  db.escritas = [];
  db.t = {
    empresa: [{ id: "e1", cnpj: "12.345.678/0001-90" }, { id: "e2", cnpj: "99888777000166" }],
    usuario: [{ id: "u1", nome: "Ana" }],
    fornecedor: [{ id: "fB", empresaId: "e2", nome: "Frigelar (da outra)", documento: "11222333000181", ativo: true }],
    produto: [
      { id: "pGas", empresaId: "e1", nome: "Gás R410A 11,35 kg", unidade: "un", saldo: 1, ativo: true, estoqueMinimo: 2 },
      { id: "pCap", empresaId: "e1", nome: "Capacitor 35uF", unidade: "un", saldo: 0, ativo: true, estoqueMinimo: null },
      { id: "pB", empresaId: "e2", nome: "Produto da outra", unidade: "un", saldo: 0, ativo: true },
    ],
    notaCompra: [], notaCompraItem: [], deParaProdutoFornecedor: [], movimentacaoEstoque: [],
    contaPagar: [{ id: "cp-antiga", empresaId: "e1", numero: `CP-${ANO}-0007`, valorTotal: 10, notaCompraId: null, pedidoCompraId: null }],
    pedidoCompraInterno: [{ id: "ped1", empresaId: "e1", numero: "PC-0312" }, { id: "pedB", empresaId: "e2", numero: "PC-B" }],
    pedidoCompraItem: [
      { id: "pi1", pedidoId: "ped1", produtoId: "pGas", descricao: "Gás", quantidade: 2, valorEstimado: 650, valorReal: null },
      { id: "pi2", pedidoId: "ped1", produtoId: "pOutro", descricao: "Outro", quantidade: 1, valorEstimado: 10, valorReal: null },
    ],
  };
}
beforeEach(() => { semear(); logar(); });

const T = (m: string) => (db.t as any)[m] as any[];
async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await carregar();
  const req = new NextRequest("http://localhost/api/compras/notas", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const rotaNotas = () => import("@/app/api/compras/notas/route");
const importar = (xml: string) => chamar(rotaNotas, "POST", {}, { xml });
const conciliarApi = (id: string, itens: unknown) => chamar(() => import("@/app/api/compras/notas/[id]/conciliacao/route"), "PUT", { id }, { itens });
const lancarApi = (id: string, corpo: unknown = {}) => chamar(() => import("@/app/api/compras/notas/[id]/lancar/route"), "POST", { id }, corpo);
const notaApi = (id: string) => chamar(() => import("@/app/api/compras/notas/[id]/route"), "GET", { id });
const itensDa = (notaId: string) => T("notaCompraItem").filter((i) => i.notaId === notaId).sort((a, b) => a.numeroItem - b.numeroItem);
const prod = (id: string) => T("produto").find((p) => p.id === id);
/** Importa a nota 1 e concilia: Gás → existente, Capacitor → existente, Tubo → produto novo */
async function nota1Conciliada() {
  const r = await importar(XML1);
  const id = r.json.nota.id;
  const [gas, cap, tubo] = itensDa(id);
  await conciliarApi(id, [{ itemId: gas.id, produtoId: "pGas" }, { itemId: cap.id, produtoId: "pCap" }, { itemId: tubo.id, novo: { nome: "Tubo de cobre 1/4" } }]);
  return id;
}

// ═════════════════════════ Leitura do XML ═════════════════════════
describe("leitura da NF-e (layout 4.00)", () => {
  it("lê a fixture: chave, número, emitente, destinatário, itens, totais, duplicatas e protocolo", () => {
    const n = lerNfe(XML1);
    expect([n.chave, n.numero, n.serie, n.dataEmissao.toISOString()]).toEqual([CHAVE1, "4521", "1", "2026-10-15T13:30:00.000Z"]);
    expect(n.emitente).toEqual({ cnpj: "11222333000181", nome: "FRIGELAR COMERCIO E DISTRIBUICAO S.A.", fantasia: "FRIGELAR", telefone: "1130051000", email: null });
    expect(n.destinatario).toEqual({ documento: "12345678000190", nome: "CLIMA TOTAL LTDA" });
    expect(n.itens.map((i) => [i.numeroItem, i.codigo, i.descricao, i.ncm, i.cfop, i.unidade, i.quantidade, i.valorUnitario, i.valorTotal, i.ean])).toEqual([
      [1, "R410A-11", "GAS REFRIGERANTE R410A CILINDRO 11,35KG", "29037990", "5102", "UN", 2, 689.9, 1379.8, "7891234567895"],
      [2, "CAP-35UF", "CAPACITOR 35UF 440V", "85322590", "5102", "PC", 10, 18.45, 184.5, null],
      [3, "TUB-14-15", "TUBO COBRE FLEXIVEL 1/4 ROLO 15M", "74111010", "5102", "M", 15, 12.3333333333, 185, null],
    ]);
    expect(n.totais).toEqual({ produtos: 1749.3, frete: 0, desconto: 0, outros: 0, ipi: 0, st: 0, nota: 1749.3 });
    expect(n.duplicatas).toEqual([
      { numero: "001", vencimento: "2026-11-14", valor: 583.1 },
      { numero: "002", vencimento: "2026-12-14", valor: 583.1 },
      { numero: "003", vencimento: "2027-01-13", valor: 583.1 },
    ]);
    expect(n.status).toEqual({ codigo: "100", motivo: "Autorizado o uso da NF-e" });
    expect(n.informacoes).toBe("PEDIDO DO CLIENTE PC-0312");
    const n2 = lerNfe(XML2);
    expect([n2.duplicatas, n2.totais.nota, n2.totais.frete]).toEqual([[], 829.1, 15]);
    // sem o envelope nfeProc (só a NFe) também vale
    const soNfe = XML1.replace(/^[\s\S]*?(<NFe )/, "$1").replace(/<\/NFe>[\s\S]*$/, "</NFe>");
    expect(lerNfe(soNfe)).toMatchObject({ chave: CHAVE1, status: null });
  });

  it("nota com UM item só e UMA duplicata (caso comum) também vira lista", () => {
    const umItem = XML2.replace(/<det nItem="2">[\s\S]*?<\/det>/, "")
      .replace("<transp>", "<cobr><dup><nDup>001</nDup><dVenc>2026-12-03</dVenc><vDup>829.10</vDup></dup></cobr><transp>");
    const n = lerNfe(umItem);
    expect(n.itens.map((i) => [i.numeroItem, i.codigo, i.quantidade])).toEqual([[1, "R410A-11", 1]]);
    expect(n.duplicatas).toEqual([{ numero: "001", vencimento: "2026-12-03", valor: 829.1 }]);
  });

  it("chave de acesso: dígito verificador (módulo 11)", () => {
    expect(dvChave(CHAVE1.slice(0, 43))).toBe("7");
    expect(chaveValida(CHAVE1)).toBe(true);
    expect(chaveValida(CHAVE1.slice(0, 43) + "8")).toBe(false);
    expect(chaveValida(CHAVE1.slice(1))).toBe(false);
    expect(dvChave("35261111222333000181550010000046101000046103".slice(0, 43))).toBe("3");
    // resto 0 e resto 1 → DV 0 (não "11"/"10")
    expect(dvChave("3526101122233300018155001000004521100000000")).toBe("0");
    expect(dvChave("3526101122233300018155001000004521100000006")).toBe("0");
    expect(chaveValida("35261011222333000181550010000045211000000060")).toBe(true);
  });

  it("recusa com motivo: não é NF-e, layout/modelo errado, chave inválida, não autorizada, DOCTYPE, sem itens", () => {
    const erro = (x: string) => { try { lerNfe(x); return null; } catch (e) { expect(e).toBeInstanceOf(ErroNfe); return (e as Error).message; } };
    expect(erro("")).toBe("Arquivo vazio.");
    expect(erro("<html><body>oi</body></html>")).toMatch(/não é uma NF-e/);
    expect(erro("isso não é xml <<<")).toMatch(/não é uma NF-e|não é um XML válido/);
    expect(erro(XML1.replace('versao="4.00">\n      <ide>', 'versao="3.10">\n      <ide>'))).toBe("Layout 3.10 não suportado: só NF-e 4.00.");
    expect(erro(XML1.replace("<mod>55</mod>", "<mod>65</mod>"))).toMatch(/Modelo 65 não suportado/);
    expect(erro(XML1.replace(`NFe${CHAVE1}`, `NFe${CHAVE1.slice(0, 43)}9`))).toMatch(/Chave de acesso inválida/);
    expect(erro(XML1.replace("<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>", "<cStat>110</cStat><xMotivo>Uso Denegado</xMotivo>"))).toBe("NF-e não autorizada (110 — Uso Denegado).");
    expect(erro(XML1.replace(`<chNFe>${CHAVE1}</chNFe>`, "<chNFe>35261111222333000181550010000046101000046103</chNFe>"))).toMatch(/protocolo não é desta nota/);
    expect(erro(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]>` + XML1.replace(/^<\?xml[^>]*>/, ""))).toMatch(/DOCTYPE/);
    expect(erro(XML2.replace(/<det nItem="1">[\s\S]*<\/det>/, ""))).toBe("A nota não tem itens.");
    expect(erro(XML1.replace("<dVenc>2026-11-14</dVenc>", "<dVenc>14/11/2026</dVenc>"))).toBe("Duplicata 1 sem vencimento válido.");
    expect(erro(XML1.replace("<qCom>2.0000</qCom>", "<qCom>abc</qCom>"))).toMatch(/Valor inválido em qCom do item 1/);
    expect(erro(XML1.replace("<vNF>1749.30</vNF>", ""))).toMatch(/vNF/);
    expect(erro(XML1.replace("<qCom>10.0000</qCom>", "<qCom>0.0000</qCom>"))).toBe("Há item com quantidade zero ou negativa.");
  });

  it("parcelas: duplicatas (meio-dia UTC = mesmo dia no Brasil) ou à vista na emissão", () => {
    const n = lerNfe(XML1);
    expect(parcelasDaNota({ duplicatas: n.duplicatas, valorTotal: 1749.3, dataEmissao: n.dataEmissao }).map((p) => [p.numero, p.vencimento.toISOString(), p.valor])).toEqual([
      ["001", "2026-11-14T12:00:00.000Z", 583.1], ["002", "2026-12-14T12:00:00.000Z", 583.1], ["003", "2027-01-13T12:00:00.000Z", 583.1],
    ]);
    // emissão às 23h30 em Brasília = já é outro dia em UTC; o vencimento à vista continua no dia certo
    expect(parcelasDaNota({ duplicatas: [], valorTotal: 50, dataEmissao: new Date("2026-11-03T23:30:00-03:00") })[0].vencimento.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("CNPJ da empresa: mesma raiz (matriz/filial) vale; com ou sem máscara", () => {
    expect(mesmaRaizCnpj("12345678000190", "12.345.678/0001-90")).toBe(true);
    expect(mesmaRaizCnpj("12345678000271", "12345678000190")).toBe(true);
    expect(mesmaRaizCnpj("12345679000190", "12345678000190")).toBe(false);
    expect(mesmaRaizCnpj("12345678901", "12345678000190")).toBe(false); // CPF
    expect(mesmaRaizCnpj(null, "12345678000190")).toBe(false);
  });
});

// ═════════════════════════ Importar ═════════════════════════
describe("importar o XML", () => {
  it("cria a nota com os itens, o fornecedor pelo emitente (CNPJ só dígitos) e status IMPORTADA", async () => {
    const r = await importar(XML1);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ nota: { status: "IMPORTADA" }, preVinculados: 0, totalItens: 3, avisos: [] });
    const nota = T("notaCompra")[0];
    expect(nota).toMatchObject({ empresaId: "e1", chaveAcesso: CHAVE1, numero: "4521", serie: "1", valorTotal: 1749.3, emitenteNome: "FRIGELAR COMERCIO E DISTRIBUICAO S.A.", emitenteCnpj: "11222333000181", usuarioId: "u1", xml: XML1 });
    expect(nota.duplicatas).toHaveLength(3);
    const forn = T("fornecedor").filter((f) => f.empresaId === "e1");
    expect(forn).toEqual([expect.objectContaining({ nome: "FRIGELAR COMERCIO E DISTRIBUICAO S.A.", documento: "11222333000181", telefone: "1130051000" })]);
    expect(nota.fornecedorId).toBe(forn[0].id);
    expect(itensDa(nota.id).map((i) => [i.numeroItem, i.codigoFornecedor, i.unidade, i.quantidade, i.valorUnitario, i.valorTotal, i.produtoId])).toEqual([
      [1, "R410A-11", "UN", 2, 689.9, 1379.8, null], [2, "CAP-35UF", "PC", 10, 18.45, 184.5, null], [3, "TUB-14-15", "M", 15, 12.3333333333, 185, null],
    ]);
    // importar NÃO mexe em estoque nem em contas
    expect(T("movimentacaoEstoque")).toEqual([]);
    expect(T("contaPagar")).toHaveLength(1);
  });

  it("fornecedor já cadastrado (CNPJ com máscara) é reaproveitado, não duplicado", async () => {
    T("fornecedor").push({ id: "fF", empresaId: "e1", nome: "Frigelar", documento: "11.222.333/0001-81", ativo: true });
    await importar(XML1);
    expect(T("notaCompra")[0].fornecedorId).toBe("fF");
    expect(T("fornecedor").filter((f) => f.empresaId === "e1")).toHaveLength(1);
  });

  it("dedup pela chave: a mesma nota 2x é bloqueada com aviso — nada duplica (antes e depois de lançar)", async () => {
    const r1 = await importar(XML1);
    const r2 = await importar(XML1);
    expect(r2.status).toBe(409);
    expect(r2.json.erro).toMatch(/^Esta NF já foi importada em \d{2}\/\d{2}\/\d{4} \(NF 4521 · FRIGELAR COMERCIO E DISTRIBUICAO S\.A\. · Importada\)\. Nada foi lançado de novo\.$/);
    expect(r2.json.notaId).toBe(r1.json.nota.id);
    expect([T("notaCompra").length, T("notaCompraItem").length, T("fornecedor").filter((f) => f.empresaId === "e1").length]).toEqual([1, 3, 1]);
    // lança e tenta de novo: continua bloqueado, estoque e contas não mudam
    const id = r1.json.nota.id;
    const [gas, cap, tubo] = itensDa(id);
    expect((await lancarApi(id, { itens: [{ itemId: gas.id, produtoId: "pGas" }, { itemId: cap.id, produtoId: "pCap" }, { itemId: tubo.id, novo: { nome: "Tubo" } }] })).status).toBe(201);
    const antes = [T("movimentacaoEstoque").length, T("contaPagar").length, prod("pGas").saldo];
    const r3 = await importar(XML1);
    expect([r3.status, r3.json.erro]).toEqual([409, expect.stringContaining("· Lançada). Nada foi lançado de novo.")]);
    expect([T("movimentacaoEstoque").length, T("contaPagar").length, prod("pGas").saldo]).toEqual(antes);
  });

  it("a mesma chave em OUTRA empresa é outra nota (cada empresa importa a sua)", async () => {
    T("empresa")[1].cnpj = "12345678000271"; // filial da mesma raiz do destinatário
    await importar(XML1);
    logar(permissoesTotais(), "e2");
    const r = await importar(XML1);
    expect(r.status).toBe(201);
    expect(T("notaCompra").map((n) => n.empresaId)).toEqual(["e1", "e2"]);
    expect(T("notaCompra")[1].fornecedorId).toBe("fB"); // fornecedor da e2
  });

  it("nota emitida para outro CNPJ é recusada", async () => {
    const r = await importar(XML1.replace("<CNPJ>12345678000190</CNPJ><xNome>CLIMA TOTAL LTDA</xNome>", "<CNPJ>55666777000100</CNPJ><xNome>OUTRA EMPRESA</xNome>"));
    expect([r.status, r.json.erro]).toEqual([400, "Esta NF foi emitida para o CNPJ/CPF 55.666.777/0001-00 (OUTRA EMPRESA), não para a sua empresa."]);
    expect(T("notaCompra")).toEqual([]);
    expect(T("fornecedor").filter((f) => f.empresaId === "e1")).toEqual([]);
  });

  it("XML inválido = 400 com o motivo; multipart sem arquivo = 400", async () => {
    expect(await importar("<a/>")).toEqual({ status: 400, json: { erro: expect.stringMatching(/não é uma NF-e/) } });
    const mod = await rotaNotas();
    const fd = new FormData();
    const sem = await mod.POST(new NextRequest("http://localhost/api/compras/notas", { method: "POST", body: fd }));
    expect([sem.status, (await sem.json()).erro]).toEqual([400, "Envie o arquivo XML da nota."]);
    const com = new FormData();
    com.append("xml", new File([XML2], "nfe.xml", { type: "text/xml" }));
    const ok = await mod.POST(new NextRequest("http://localhost/api/compras/notas", { method: "POST", body: com }));
    expect(ok.status).toBe(201);
  });

  it("avisa quando as duplicatas não batem com o valor da nota", async () => {
    const r = await importar(XML1.replace("<vDup>583.10</vDup></dup>\n      </cobr>", "<vDup>500.00</vDup></dup>\n      </cobr>"));
    expect(r.json.avisos).toEqual(["As duplicatas somam 1666.20 e a nota 1749.30: as contas a pagar seguem as duplicatas."]);
  });
});

// ═════════════════════════ Conciliação (de-para) ═════════════════════════
describe("conciliação", () => {
  it("vincula a produto existente e cria produto novo (unidade da nota); tudo vinculado = CONCILIADA", async () => {
    const id = (await importar(XML1)).json.nota.id;
    const [gas, cap, tubo] = itensDa(id);
    const parcial = await conciliarApi(id, [{ itemId: gas.id, produtoId: "pGas" }]);
    expect(parcial.json).toEqual({ status: "IMPORTADA", faltam: 2 });
    const r = await conciliarApi(id, [{ itemId: cap.id, produtoId: "pCap" }, { itemId: tubo.id, novo: { nome: "Tubo de cobre 1/4" } }]);
    expect(r).toEqual({ status: 200, json: { status: "CONCILIADA", faltam: 0 } });
    const novo = T("produto").find((p) => p.nome === "Tubo de cobre 1/4");
    expect(novo).toMatchObject({ empresaId: "e1", unidade: "M" });
    expect(itensDa(id).map((i) => i.produtoId)).toEqual(["pGas", "pCap", novo.id]);
    expect(T("notaCompra")[0].status).toBe("CONCILIADA");
    // trocar um vínculo continua permitido antes de lançar
    expect((await conciliarApi(id, [{ itemId: cap.id, novo: { nome: "Capacitor 35uF 440V", unidade: "pc" } }])).status).toBe(200);
    expect(T("produto").find((p) => p.nome === "Capacitor 35uF 440V").unidade).toBe("pc");
  });

  it("recusa: produto de outra empresa, item de outra nota, item repetido, nome curto, campo extra", async () => {
    const id = (await importar(XML1)).json.nota.id;
    const outro = (await importar(XML2)).json.nota.id;
    const [gas] = itensDa(id);
    const [deOutra] = itensDa(outro);
    const casos: [unknown, string][] = [
      [[{ itemId: gas.id, produtoId: "pB" }], "Produto inválido(a)."],
      [[{ itemId: deOutra.id, produtoId: "pGas" }], "Item não é desta nota."],
      [[{ itemId: gas.id, produtoId: "pGas" }, { itemId: gas.id, produtoId: "pCap" }], "Item escolhido duas vezes."],
      [[{ itemId: gas.id, novo: { nome: "x" } }], "Dê um nome ao produto novo."],
      [[{ itemId: gas.id, produtoId: "pGas", empresaId: "e2" }], expect.any(String)],
    ];
    for (const [itens, erro] of casos) {
      const r = await conciliarApi(id, itens);
      expect([r.status, r.json.erro]).toEqual([400, erro]);
    }
    expect(itensDa(id).every((i) => i.produtoId === null)).toBe(true);
  });

  it("nota lançada não muda mais os vínculos", async () => {
    const id = await nota1Conciliada();
    await lancarApi(id);
    const r = await conciliarApi(id, [{ itemId: itensDa(id)[0].id, produtoId: "pCap" }]);
    expect([r.status, r.json.erro]).toEqual([409, "Nota já lançada: os vínculos não mudam mais."]);
  });
});

// ═════════════════════════ Lançar ═════════════════════════
describe("lançar a nota", () => {
  it("entrada no estoque com o custo da NF (origem COMPRA, refId = nota) e saldo somado", async () => {
    const id = await nota1Conciliada();
    const r = await lancarApi(id);
    expect(r.status).toBe(201);
    const tubo = T("produto").find((p) => p.nome === "Tubo de cobre 1/4");
    expect(r.json.entradas).toEqual([
      { itemId: expect.any(String), produto: "Gás R410A 11,35 kg", unidade: "un", quantidade: 2, custoUnitario: 689.9, fator: 1, saldo: 3 },
      { itemId: expect.any(String), produto: "Capacitor 35uF", unidade: "un", quantidade: 10, custoUnitario: 18.45, fator: 1, saldo: 10 },
      { itemId: expect.any(String), produto: "Tubo de cobre 1/4", unidade: "M", quantidade: 15, custoUnitario: 12.3333, fator: 1, saldo: 15 },
    ]);
    expect(T("movimentacaoEstoque").map((m) => [m.produtoId, m.tipo, m.origem, m.quantidade, m.saldoApos, m.custoUnitario, m.refId, m.usuarioId])).toEqual([
      ["pGas", "ENTRADA", "COMPRA", 2, 3, 689.9, id, "u1"],
      ["pCap", "ENTRADA", "COMPRA", 10, 10, 18.45, id, "u1"],
      [tubo.id, "ENTRADA", "COMPRA", 15, 15, 12.3333, id, "u1"],
    ]);
    expect(T("movimentacaoEstoque")[0].observacao).toBe("NF 4521/1 · FRIGELAR COMERCIO E DISTRIBUICAO S.A. · item 1");
    // unidade da nota diferente da do produto, sem fator informado: 1:1 e a observação registra a conversão
    expect(T("movimentacaoEstoque")[1].observacao).toBe("NF 4521/1 · FRIGELAR COMERCIO E DISTRIBUICAO S.A. · item 2 · 10 PC × 1");
    expect([prod("pGas").saldo, prod("pCap").saldo, tubo.saldo]).toEqual([3, 10, 15]);
    expect(T("notaCompra")[0]).toMatchObject({ status: "LANCADA", lancadaEm: expect.any(Date), usuarioId: "u1" });
  });

  it("conta a pagar: uma por duplicata, com valor, vencimento, número e vínculos certos", async () => {
    const id = await nota1Conciliada();
    const r = await lancarApi(id);
    const fornecedorId = T("notaCompra")[0].fornecedorId;
    const novas = T("contaPagar").filter((c) => c.notaCompraId === id);
    expect(novas.map((c) => [c.numero, c.valorTotal, c.saldoRestante, c.valorPago, c.status, c.dataVencimento.toISOString(), c.descricao])).toEqual([
      [`CP-${ANO}-0008`, 583.1, 583.1, 0, "PENDENTE", "2026-11-14T12:00:00.000Z", "NF 4521/1 — parcela 1/3"],
      [`CP-${ANO}-0009`, 583.1, 583.1, 0, "PENDENTE", "2026-12-14T12:00:00.000Z", "NF 4521/1 — parcela 2/3"],
      [`CP-${ANO}-0010`, 583.1, 583.1, 0, "PENDENTE", "2027-01-13T12:00:00.000Z", "NF 4521/1 — parcela 3/3"],
    ]);
    expect(novas.every((c) => c.empresaId === "e1" && c.fornecedorId === fornecedorId && c.fornecedor === "FRIGELAR COMERCIO E DISTRIBUICAO S.A." && c.fornecedorCnpj === "11222333000181" && c.pedidoCompraId === null)).toBe(true);
    expect(novas[0].observacao).toBe(`Duplicata 001 da NF-e ${CHAVE1}`);
    expect(r.json.contas.map((c: any) => [c.numero, c.valor])).toEqual([[`CP-${ANO}-0008`, 583.1], [`CP-${ANO}-0009`, 583.1], [`CP-${ANO}-0010`, 583.1]]);
  });

  it("aprendizado: a 2ª nota do mesmo fornecedor já vem com o item conhecido vinculado; sem duplicata = 1 conta à vista", async () => {
    const id1 = await nota1Conciliada();
    await lancarApi(id1);
    expect(T("deParaProdutoFornecedor").map((d) => [d.codigoFornecedor, d.produtoId])).toEqual([
      ["R410A-11", "pGas"], ["CAP-35UF", "pCap"], ["TUB-14-15", T("produto").find((p) => p.nome === "Tubo de cobre 1/4").id],
    ]);
    const r2 = await importar(XML2);
    expect(r2.json).toMatchObject({ nota: { status: "IMPORTADA" }, preVinculados: 1, totalItens: 2 });
    const [gas, filtro] = itensDa(r2.json.nota.id);
    expect([gas.produtoId, filtro.produtoId]).toEqual(["pGas", null]);
    // conclui o de-para do item novo e lança: 1 conta à vista no valor da nota (com frete), vencendo na emissão
    const l = await lancarApi(r2.json.nota.id, { itens: [{ itemId: filtro.id, novo: { nome: "Filtro secador 032S" } }] });
    expect(l.status).toBe(201);
    const conta = T("contaPagar").filter((c) => c.notaCompraId === r2.json.nota.id);
    expect(conta.map((c) => [c.valorTotal, c.dataVencimento.toISOString(), c.descricao])).toEqual([[829.1, "2026-11-03T12:00:00.000Z", "NF 4610/1"]]);
    expect(prod("pGas").saldo).toBe(4); // 1 + 2 + 1
    // a 3ª nota com os dois itens já viria toda vinculada (CONCILIADA)
    T("notaCompra").length = 0; T("notaCompraItem").length = 0;
    expect((await importar(XML2)).json).toMatchObject({ nota: { status: "CONCILIADA" }, preVinculados: 2 });
  });

  it("de-para não pré-vincula produto inativo nem de outro fornecedor", async () => {
    T("fornecedor").push({ id: "fX", empresaId: "e1", nome: "Outro fornecedor", documento: "44555666000177", ativo: true });
    T("deParaProdutoFornecedor").push({ id: "d1", empresaId: "e1", fornecedorId: "fX", codigoFornecedor: "R410A-11", descricaoFornecedor: "x", produtoId: "pGas" });
    const r = await importar(XML1);
    expect(r.json.preVinculados).toBe(0);
    const forn = T("notaCompra")[0].fornecedorId;
    T("notaCompra").length = 0; T("notaCompraItem").length = 0;
    T("deParaProdutoFornecedor").push({ id: "d2", empresaId: "e1", fornecedorId: forn, codigoFornecedor: "R410A-11", descricaoFornecedor: "x", produtoId: "pGas" });
    prod("pGas").ativo = false;
    expect((await importar(XML1)).json.preVinculados).toBe(0);
    prod("pGas").ativo = true;
    expect((await importar(XML1.replace(CHAVE1, CHAVE1).replace("<nNF>4521</nNF>", "<nNF>4521</nNF>"))).status).toBe(409);
  });

  it("unidade divergente sem fator informado: entra 1:1 (como antes) e o de-para guarda a unidade e o fator", async () => {
    const id = await nota1Conciliada();
    const r = await lancarApi(id);
    expect(r.json.avisos).toEqual([]);
    expect(T("deParaProdutoFornecedor").find((d) => d.produtoId === "pCap")).toMatchObject({ unidadeOrigem: "PC", fatorConversao: 1 });
  });

  it("pedido de compra: recebe o custo real (valorReal) e as contas ficam ligadas a ele", async () => {
    const id = await nota1Conciliada();
    const r = await lancarApi(id, { pedidoCompraId: "ped1" });
    expect(r.json.itensPedido).toBe(1);
    expect(T("pedidoCompraItem").map((i) => [i.id, i.valorReal])).toEqual([["pi1", 689.9], ["pi2", null]]);
    expect(T("contaPagar").filter((c) => c.notaCompraId === id).every((c) => c.pedidoCompraId === "ped1")).toBe(true);
    expect(T("notaCompra")[0].pedidoCompraId).toBe("ped1");
  });

  it("pedido já com conta a pagar (duplicaria a dívida) ou de outra empresa: recusado", async () => {
    const id = await nota1Conciliada();
    T("contaPagar").push({ id: "cp-ped", empresaId: "e1", numero: `CP-${ANO}-0005`, pedidoCompraId: "ped1", notaCompraId: null });
    const r = await lancarApi(id, { pedidoCompraId: "ped1" });
    expect([r.status, r.json.erro]).toEqual([409, `O pedido PC-0312 já tem a conta a pagar CP-${ANO}-0005: lance a nota sem vincular o pedido, ou cancele aquela conta antes.`]);
    const id2 = (await importar(XML2)).json.nota.id;
    const r2 = await lancarApi(id2, { pedidoCompraId: "pedB", itens: itensDa(id2).map((i) => ({ itemId: i.id, produtoId: "pGas" })) });
    expect([r2.status, r2.json.erro]).toEqual([400, "Pedido de compra inválido."]);
  });

  it("lançar 2x é recusado: estoque e contas não dobram", async () => {
    const id = await nota1Conciliada();
    expect((await lancarApi(id)).status).toBe(201);
    const antes = [T("movimentacaoEstoque").length, T("contaPagar").length, prod("pGas").saldo];
    const r = await lancarApi(id);
    expect([r.status, r.json.erro]).toEqual([409, "Esta nota já foi lançada: o estoque e as contas não são lançados de novo."]);
    expect([T("movimentacaoEstoque").length, T("contaPagar").length, prod("pGas").saldo]).toEqual(antes);
  });

  it("falta produto em item: 400 com a lista; produto de outra empresa nas escolhas: 400", async () => {
    const id = (await importar(XML1)).json.nota.id;
    const r = await lancarApi(id, { itens: [{ itemId: itensDa(id)[0].id, produtoId: "pGas" }] });
    expect([r.status, r.json.erro]).toEqual([400, "Falta escolher o produto de 2 item(ns): CAPACITOR 35UF 440V; TUBO COBRE FLEXIVEL 1/4 ROLO 15M."]);
    semear(); logar();
    const id2 = (await importar(XML1)).json.nota.id;
    const r2 = await lancarApi(id2, { itens: itensDa(id2).map((i) => ({ itemId: i.id, produtoId: "pB" })) });
    expect([r2.status, r2.json.erro]).toEqual([400, "Produto inválido(a)."]);
  });
});

// ═════════════════════════ Empresa e permissão ═════════════════════════
describe("empresa e permissão", () => {
  it("nota de outra empresa: 404 em ver, conciliar e lançar — nada muda", async () => {
    const id = await nota1Conciliada();
    logar(permissoesTotais(), "e2");
    expect((await notaApi(id)).status).toBe(404);
    expect((await conciliarApi(id, [{ itemId: itensDa(id)[0].id, produtoId: "pB" }])).status).toBe(404);
    expect((await lancarApi(id)).status).toBe(404);
    expect(T("notaCompra")[0].status).toBe("CONCILIADA");
    expect(T("movimentacaoEstoque")).toEqual([]);
    expect((await chamar(rotaNotas, "GET", {})).json).toEqual({ total: 0, notas: [] });
  });

  it("ver/listar = Estoque › visualizar; importar e conciliar = › gerenciar; lançar = + Financeiro › fluxo de caixa", async () => {
    const id = await nota1Conciliada();
    sessao.atual = null;
    expect((await importar(XML2)).status).toBe(401);
    expect((await notaApi(id)).status).toBe(401);
    logar(so({ estoque: { visualizar: true, gerenciar: false } }));
    expect((await notaApi(id)).status).toBe(200);
    expect((await notaApi(id)).json).not.toHaveProperty("xml");
    expect((await chamar(rotaNotas, "GET", {})).json.total).toBe(1);
    expect((await importar(XML2)).status).toBe(403);
    expect((await conciliarApi(id, [])).status).toBe(403);
    expect((await lancarApi(id)).status).toBe(403);
    logar(so({ estoque: { visualizar: true, gerenciar: false }, financeiro: { fluxoCaixa: true } }));
    expect((await lancarApi(id)).status).toBe(403); // Financeiro sozinho não lança estoque
    logar(so({ clientes: { visualizar: true } }));
    expect((await chamar(rotaNotas, "GET", {})).status).toBe(403);
    logar(so({ estoque: { visualizar: true, gerenciar: true } }));
    const r = await lancarApi(id);
    expect([r.status, r.json.erro]).toEqual([403, "Lançar a nota gera conta a pagar: precisa também de Financeiro › fluxo de caixa."]);
    expect(T("movimentacaoEstoque")).toEqual([]);
    logar(so({ estoque: { visualizar: true, gerenciar: true }, financeiro: { fluxoCaixa: true } }));
    expect((await lancarApi(id)).status).toBe(201);
    logar(permissoesVazias(), "e1", "ADMIN");
    expect((await importar(XML2)).status).toBe(201);
  });
});

// ═════════════════════════ Telas ═════════════════════════
const lista = async () => { const { default: P } = await import("@/app/(dashboard)/estoque/notas/page"); return renderToStaticMarkup(await P({ searchParams: Promise.resolve({}) })); };
const detalhe = async (id: string) => { const { default: P } = await import("@/app/(dashboard)/estoque/notas/[id]/page"); return renderToStaticMarkup(await P({ params: Promise.resolve({ id }) })); };
const attrs = (h: string, a: string) => [...h.matchAll(new RegExp(`${a}="([^"]+)"`, "g"))].map((m) => m[1]);

describe("telas", () => {
  it("lista: upload só para quem gerencia; notas com situação", async () => {
    T("pedidoCompraInterno").forEach((p) => { p.status = "COMPRADO"; });
    const id = (await importar(XML1)).json.nota.id;
    const h = await lista();
    expect(h).toContain("data-upload-xml");
    expect(attrs(h, "data-nota")).toEqual([id, id]); // cartão + linha
    expect(h).toContain("FRIGELAR COMERCIO E DISTRIBUICAO S.A.");
    expect(h).toContain("Importada");
    logar(so({ estoque: { visualizar: true } }));
    expect(await lista()).not.toContain("data-upload-xml");
  });

  it("conciliação: itens, aprendido marcado, aviso de unidade, parcelas e pedidos; sem Financeiro não lança", async () => {
    T("pedidoCompraInterno")[0].status = "COMPRADO";
    const id1 = await nota1Conciliada();
    await lancarApi(id1);
    const id2 = (await importar(XML2)).json.nota.id;
    const h = await detalhe(id2);
    expect(attrs(h, "data-item")).toEqual(["1", "2"]);
    expect(attrs(h, "data-vinculo")).toEqual(["existente", "pendente"]);
    expect(h).toContain("data-aprendido");
    expect(h).toContain("aprendido de nota anterior");
    expect(h).not.toContain("data-unidade-divergente"); // gás: UN × un é a mesma unidade
    // E2.1: parcelas editáveis — sem duplicata, uma parcela única (à vista) vencendo na emissão
    expect(h).toMatch(/data-parcela="1"/);
    expect(h).toMatch(/name="vencimento-1"[^>]*value="2026-11-03"|value="2026-11-03"[^>]*name="vencimento-1"/);
    expect(h).toContain("Sem duplicata na NF: à vista, no valor da nota.");
    expect(h).toContain(">PC-0312</option>");
    expect(h).toContain("Confirmar e lançar");
    logar(so({ estoque: { visualizar: true, gerenciar: true } }));
    const sem = await detalhe(id2);
    expect(sem).toContain("data-sem-lancar");
    expect(sem).not.toContain(">PC-0312</option>");
    logar(so({ estoque: { visualizar: true } }));
    const leitura = await detalhe(id2);
    expect(leitura).not.toContain("Confirmar e lançar");
    expect(leitura).toContain("Só quem gerencia o Estoque concilia e lança a nota.");
  });

  it("resultado: entradas com custo, contas a pagar e a conversão usada; outra empresa = 404", async () => {
    const id = await nota1Conciliada();
    await lancarApi(id);
    const h = await detalhe(id);
    expect(h).toContain("data-resultado");
    expect(h).toContain("Nota lançada: 3 entrada(s) no estoque e 3 conta(s) a pagar.");
    expect(attrs(h, "data-conta")).toEqual([`CP-${ANO}-0008`, `CP-${ANO}-0009`, `CP-${ANO}-0010`]);
    expect(h).toMatch(/R\$\s12,3333/); // custo da NF com 4 casas (espaço do R$ é não separável)
    expect(h).toContain("vence 14/11/2026");
    expect(h).toContain("data-conversoes");
    expect(h).toContain("Capacitor 35uF: 1 PC = 1 un — 10 PC entraram como 10 un.");
    expect(h).toContain("3526 1011 2223 3300 0181 5500 1000 0045 2110 0004 5217");
    logar(permissoesTotais(), "e2");
    await expect(detalhe(id)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("função de entrada da E1 dentro da transação da nota", () => {
  it("com a transação de quem chama: produto de outra empresa é recusado como 'Produto inválido(a).'", async () => {
    const { movimentar } = await import("@/lib/estoque/servidor");
    const { prisma } = await import("@/lib/prisma");
    await expect(movimentar({ empresaId: "e1", produtoId: "pB", operacao: "ENTRADA", valor: 1 }, prisma as any)).rejects.toThrow("Produto inválido(a).");
    await expect(movimentar({ empresaId: "e1", produtoId: "nao-existe", operacao: "ENTRADA", valor: 1 }, prisma as any)).rejects.toThrow("Produto inválido(a).");
    expect(T("movimentacaoEstoque")).toEqual([]);
    const ok = await movimentar({ empresaId: "e1", produtoId: "pGas", operacao: "ENTRADA", valor: 2, custoUnitario: 0.0345, origem: "COMPRA", refId: "n1" }, prisma as any);
    expect(ok.saldo).toBe(3);
    expect(T("movimentacaoEstoque")[0]).toMatchObject({ origem: "COMPRA", refId: "n1", custoUnitario: 0.0345 });
  });
});
