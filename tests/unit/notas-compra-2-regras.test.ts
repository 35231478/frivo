/**
 * Notas de compra 2 — regras puras:
 *  - a ORDEM das colunas (componente compartilhado): aplicar a ordem do usuário sem mover as fixas; coluna
 *    nova entra junto da vizinha; mover uma posição; a preferência valida, limpa e conta a ordem;
 *  - a DANFE lida do XML (tolerante): emitente, destinatário, itens com ICMS/IPI, totais, protocolo,
 *    duplicatas; o que não é NF-e, o vazio e o XML com DOCTYPE não são lidos;
 *  - o período da lista: pela emissão (padrão) ou pela entrada; todo o período por padrão;
 *  - o PDF da DANFE: abre no pdf-lib, título e metadados.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ajustarPreferencia, lerPreferenciaTabela, moverColuna, ordenarColunas, preferenciaVazia, preferenciaTabelaSchema } from "@/lib/preferencias";
import { lerDanfe, valoresDaNota, MODALIDADE_FRETE } from "@/lib/compras/danfe";
import { enderecoEmLinha, nomeArquivoNota } from "@/lib/compras/danfe-texto";
import { campoDataNota, periodoNotas, whereNotasCompra } from "@/lib/listas/filtros";
import { COLUNAS_NOTAS } from "@/components/compras/notas-lista";

const XML_4521 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4521-frigelar.xml"), "utf8");
const XML_4610 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4610-frigelar.xml"), "utf8");

const C = [
  { id: "sel", fixa: true }, { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "acoes", fixa: true },
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("ordem das colunas (componente compartilhado)", () => {
  it("sem ordem: a da tela; com ordem: a do usuário, e as fixas não saem do lugar", () => {
    expect(ordenarColunas(C, undefined)).toBe(C);
    expect(ordenarColunas(C, [])).toBe(C);
    expect(ids(ordenarColunas(C, ["d", "b", "a", "c"]))).toEqual(["sel", "d", "b", "a", "c", "acoes"]);
    // uma fixa no meio fica no meio
    const meio = [{ id: "a" }, { id: "x", fixa: true }, { id: "b" }, { id: "c" }];
    expect(ids(ordenarColunas(meio, ["c", "b", "a"]))).toEqual(["c", "x", "b", "a"]);
  });

  it("coluna que a preferência não conhece entra logo depois da vizinha anterior; a que sumiu da tela é ignorada", () => {
    expect(ids(ordenarColunas(C, ["c", "a", "fantasma", "d"]))).toEqual(["sel", "c", "a", "b", "d", "acoes"]);
    // desconhecida antes de qualquer conhecida: fica no começo
    const novo = [{ id: "n" }, { id: "a" }, { id: "b" }];
    expect(ids(ordenarColunas(novo, ["b", "a"]))).toEqual(["n", "b", "a"]);
  });

  it("mover uma posição, para o começo, para o fim; fora do alcance para na borda; o mesmo lugar devolve a mesma lista", () => {
    const l = ["a", "b", "c", "d"];
    expect(moverColuna(l, "c", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moverColuna(l, "c", 3)).toEqual(["a", "b", "d", "c"]);
    expect(moverColuna(l, "c", 0)).toEqual(["c", "a", "b", "d"]);
    expect(moverColuna(l, "a", -1)).toBe(l);
    expect(moverColuna(l, "d", 9)).toBe(l);
    expect(moverColuna(l, "x", 0)).toBe(l);
    expect(l).toEqual(["a", "b", "c", "d"]); // não muda a original
  });

  it("a preferência: ordem válida passa; tipo errado ou campo estranho não; ajustar tira o que não existe e repetido", () => {
    expect(preferenciaTabelaSchema.safeParse({ larguras: {}, ordem: ["a", "b"] }).success).toBe(true);
    expect(preferenciaTabelaSchema.safeParse({ larguras: {}, ordem: "a,b" }).success).toBe(false);
    expect(preferenciaTabelaSchema.safeParse({ larguras: {}, ordem: Array.from({ length: 81 }, (_, i) => `c${i}`) }).success).toBe(false);
    expect(lerPreferenciaTabela({ larguras: {}, ordem: 3 })).toEqual({ larguras: {} });
    const p = { larguras: {}, ordem: ["b", "x", "a", "b"] };
    expect(ajustarPreferencia(p, [{ id: "a" }, { id: "b" }])).toEqual({ larguras: {}, ordem: ["b", "a"] });
    const limpa = { larguras: {}, ordem: ["b", "a"] };
    expect(ajustarPreferencia(limpa, [{ id: "a" }, { id: "b" }])).toBe(limpa); // nada mudou: o mesmo objeto
    expect(ajustarPreferencia({ larguras: {} }, [{ id: "a" }])).toEqual({ larguras: {} });
    // "Restaurar padrão" e o botão destacado: a ordem conta como personalização
    expect(preferenciaVazia({ larguras: {}, ordem: ["a"] })).toBe(false);
    expect(preferenciaVazia({ larguras: {} })).toBe(true);
  });

  it("as colunas da lista de notas: o padrão enxuto de hoje, o resto escondido; o olho fixo no fim", () => {
    expect(COLUNAS_NOTAS.filter((c) => !c.oculta && !c.fixa).map((c) => c.id)).toEqual(["nf", "fornecedor", "emissao", "valor", "itens", "situacao"]);
    expect(COLUNAS_NOTAS.filter((c) => c.oculta).map((c) => c.id)).toEqual(["serie", "chave", "cnpj", "entrada", "produtos", "frete", "desconto", "icms", "icmsSt", "ipi", "pedido", "lancadoPor"]);
    expect(COLUNAS_NOTAS.at(-1)).toMatchObject({ id: "ver", fixa: true });
  });
});

describe("a DANFE lida do XML", () => {
  it("emitente, destinatário, protocolo, itens com ICMS, totais e duplicatas", () => {
    const d = lerDanfe(XML_4521)!;
    expect(d).toMatchObject({ chave: "35261011222333000181550010000045211000045217", numero: "4521", serie: "1", naturezaOperacao: "VENDA DE MERCADORIA", tipo: "SAIDA" });
    expect(d.emissao?.toISOString()).toBe("2026-10-15T13:30:00.000Z");
    expect(d.emitente).toMatchObject({ nome: "FRIGELAR COMERCIO E DISTRIBUICAO S.A.", fantasia: "FRIGELAR", documento: "11222333000181", ie: "110042490114" });
    expect(enderecoEmLinha(d.emitente.endereco)).toBe("AV DAS NACOES UNIDAS, 4777 · PINHEIROS · SAO PAULO/SP · CEP 05477-000");
    expect(d.emitente.endereco?.fone).toBe("1130051000");
    expect(d.destinatario).toMatchObject({ nome: "CLIMA TOTAL LTDA", documento: "12345678000190", ie: "123456789110" });
    expect(d.itens.map((i) => [i.numero, i.codigo, i.cfop, i.cst, i.quantidade, i.valorTotal, i.valorIcms, i.aliquotaIcms])).toEqual([
      [1, "R410A-11", "5102", "000", 2, 1379.8, 248.36, 18], [2, "CAP-35UF", "5102", "000", 10, 184.5, 33.21, 18], [3, "TUB-14-15", "5102", "000", 15, 185, 33.3, 18],
    ]);
    expect(d.totais).toMatchObject({ produtos: 1749.3, icms: 314.87, nota: 1749.3, frete: 0, ipi: 0 });
    expect(d.protocolo?.numero).toMatch(/^\d{15}$/);
    expect(d.duplicatas.length).toBe(3);
    expect(valoresDaNota(XML_4521)).toEqual({ produtos: 1749.3, frete: 0, desconto: 0, icms: 314.87, icmsSt: 0, ipi: 0 });
    expect(valoresDaNota(XML_4610)?.frete).toBe(15);
  });

  it("tolerante: campo faltando vira zero/vazio; IPI e CSOSN lidos quando vêm", () => {
    const xml = XML_4521
      .replace(/<vFrete>[^<]*<\/vFrete>/, "")
      .replace("<ICMS><ICMS00><orig>0</orig><CST>00</CST>", "<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN>")
      .replace("</ICMS00></ICMS></imposto>", "</ICMSSN102></ICMS><IPI><IPITrib><CST>50</CST><vBC>1379.80</vBC><pIPI>5.00</pIPI><vIPI>68.99</vIPI></IPITrib></IPI></imposto>")
      .replace(/<modFrete>\d<\/modFrete>/, "<modFrete>9</modFrete>");
    const d = lerDanfe(xml)!;
    expect(d.totais.frete).toBe(0);
    expect([d.itens[0].cst, d.itens[0].valorIpi, d.itens[0].aliquotaIpi]).toEqual(["0102", 68.99, 5]);
    expect(MODALIDADE_FRETE["9"]).toBe("Sem frete");
  });

  it("não lê o que não é NF-e: vazio, só o envelope, lixo, DOCTYPE/ENTITY (sem XXE) e grande demais", () => {
    for (const x of [null, undefined, "", "   ", "<nfeProc/>", "não é xml <<<", "<NFe><outra/></NFe>"]) expect(lerDanfe(x as never), String(x)).toBeNull();
    expect(lerDanfe(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${XML_4521}`)).toBeNull();
    // entidade interna (o leitor aceitaria sozinho — a trava é nossa: nada de DOCTYPE/ENTITY)
    const comEntidade = XML_4521.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE nfeProc [<!ENTITY nome "X">]>');
    expect(comEntidade).toContain("<!ENTITY");
    expect(lerDanfe(comEntidade)).toBeNull();
    expect(lerDanfe(XML_4521 + " ".repeat(2 * 1024 * 1024))).toBeNull();
    expect(valoresDaNota("<nfeProc/>")).toBeNull();
  });

  it("o nome dos arquivos pela chave", () => {
    expect(nomeArquivoNota("3526", "pdf")).toBe("DANFE-3526.pdf");
    expect(nomeArquivoNota("3526", "xml")).toBe("3526-nfe.xml");
    expect(nomeArquivoNota("", "xml")).toBe("nota-nfe.xml");
    expect(enderecoEmLinha(null)).toBe("");
  });
});

describe("o período da lista de notas", () => {
  const agora = new Date("2026-11-27T15:00:00Z");
  it("pela emissão (padrão) ou pela entrada; todo o período por padrão (nada some)", () => {
    expect(campoDataNota({})).toBe("dataEmissao");
    expect(campoDataNota({ data: "entrada" })).toBe("lancadaEm");
    expect(campoDataNota({ data: "outra" })).toBe("dataEmissao");
    expect(periodoNotas({}, agora).tipo).toBe("todos");
    expect(whereNotasCompra("e1", {}, agora)).toEqual({ empresaId: "e1" });
    // "Hoje" em Brasília: de 00h às 24h de 27/11 (03h UTC a 03h UTC)
    const hoje = { gte: new Date("2026-11-27T03:00:00.000Z"), lt: new Date("2026-11-28T03:00:00.000Z") };
    expect(whereNotasCompra("e1", { periodo: "hoje" }, agora)).toEqual({ empresaId: "e1", dataEmissao: hoje });
    expect(whereNotasCompra("e1", { periodo: "hoje", data: "entrada" }, agora)).toEqual({ empresaId: "e1", lancadaEm: hoje });
    // o mês anterior (a seta ‹ do "Este mês")
    expect(whereNotasCompra("e1", { mes: "2026-10" }, agora).dataEmissao).toEqual({ gte: new Date("2026-10-01T03:00:00.000Z"), lt: new Date("2026-11-01T03:00:00.000Z") });
  });
});

describe("o PDF da DANFE", () => {
  it("abre no pdf-lib, com o título da nota e o aviso de que não substitui a DANFE do emitente", async () => {
    const { gerarDanfePdf, AVISO_DANFE_SIMPLIFICADA } = await import("@/lib/compras/danfe-pdf");
    const bytes = await gerarDanfePdf(lerDanfe(XML_4521)!, "27/11/2026 12:00");
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe("DANFE simplificada · NF-e 4521/1");
    expect(pdf.getAuthor()).toBe("FRIGELAR COMERCIO E DISTRIBUICAO S.A.");
    const folhas = pdf.getPageCount();
    expect(folhas).toBeGreaterThanOrEqual(1);
    expect(AVISO_DANFE_SIMPLIFICADA).toMatch(/Não substitui a DANFE do emitente/);
    // muitos itens: a tabela continua noutra folha
    const d = lerDanfe(XML_4521)!;
    const muitos = { ...d, itens: Array.from({ length: 60 }, (_, i) => ({ ...d.itens[0], numero: i + 1 })) };
    expect((await PDFDocument.load(await gerarDanfePdf(muitos, "x"))).getPageCount()).toBeGreaterThan(folhas);
  });
});
