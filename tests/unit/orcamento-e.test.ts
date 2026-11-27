/**
 * "Orçamento E — Material × Peça": regras puras.
 *  - termos únicos: Material (vai dentro do serviço, sem valor) e Peça (linha própria, com valor);
 *  - o Uso do PRODUTO manda; a categoria só sugere o Uso de um produto novo; sem nenhum, Material;
 *  - trocar o Uso de um item só naquele orçamento (o snapshot muda; o produto não);
 *  - cadastro do produto (schema) e planilha de importação aceitam o Uso; filtro do estoque por Uso.
 */
import { describe, expect, it } from "vitest";
import {
  comportamentoDoProduto, comportamentoDoUso, cobraSeparado, ehUso, LABEL_COMPORTAMENTO, LABEL_USO, OPCOES_USO,
  usoDoComportamento, usoSugeridoPelaCategoria, USO_PADRAO,
} from "@/lib/estoque/categoria";
import { ehIncluso, ehPeca, trocarUso } from "@/lib/orcamentos/materiais";
import { CADASTROS } from "@/lib/cadastros/registro";
import { IMPORTACOES } from "@/lib/importacao/entidades";
import { whereEstoque } from "@/lib/estoque/servidor";

describe("termos e conversões", () => {
  it("só dois termos, iguais em todo lugar: Material e Peça", () => {
    expect(LABEL_USO).toEqual({ MATERIAL: "Material", PECA: "Peça" });
    expect(LABEL_COMPORTAMENTO).toEqual({ INCLUSO_NO_SERVICO: "Material", VENDA_A_PARTE: "Peça" });
    expect(OPCOES_USO.map((o) => o.value)).toEqual(["MATERIAL", "PECA"]);
    expect(OPCOES_USO.map((o) => o.label.split(" — ")[0])).toEqual(["Material", "Peça"]);
    expect(USO_PADRAO).toBe("MATERIAL");
  });
  it("Uso ↔ comportamento do item (ida e volta)", () => {
    expect(comportamentoDoUso("PECA")).toBe("VENDA_A_PARTE");
    expect(comportamentoDoUso("MATERIAL")).toBe("INCLUSO_NO_SERVICO");
    expect(usoDoComportamento("VENDA_A_PARTE")).toBe("PECA");
    expect(usoDoComportamento("INCLUSO_NO_SERVICO")).toBe("MATERIAL");
    for (const u of ["MATERIAL", "PECA"] as const) expect(usoDoComportamento(comportamentoDoUso(u))).toBe(u);
  });
  it("ehUso só aceita os dois valores", () => {
    expect(ehUso("MATERIAL")).toBe(true);
    expect(ehUso("PECA")).toBe(true);
    for (const v of ["peca", "Peça", "", null, undefined, "SERVICO", 1]) expect(ehUso(v)).toBe(false);
  });
});

describe("o Uso do produto manda; a categoria só sugere", () => {
  it("Uso gravado vence a categoria (nos dois sentidos)", () => {
    expect(comportamentoDoProduto({ uso: "PECA", categoriaProduto: { comportamento: "INCLUSO_NO_SERVICO" } })).toBe("VENDA_A_PARTE");
    expect(comportamentoDoProduto({ uso: "MATERIAL", categoriaProduto: { comportamento: "VENDA_A_PARTE" } })).toBe("INCLUSO_NO_SERVICO");
    expect(cobraSeparado({ uso: "PECA" })).toBe(true);
    expect(cobraSeparado({ uso: "MATERIAL", categoriaProduto: { comportamento: "VENDA_A_PARTE" } })).toBe(false);
  });
  it("lido sem o Uso (dado antigo): cai na categoria; sem nada: Material", () => {
    expect(comportamentoDoProduto({ categoriaProduto: { comportamento: "VENDA_A_PARTE" } })).toBe("VENDA_A_PARTE");
    expect(comportamentoDoProduto({ uso: null, categoriaProduto: { comportamento: "INCLUSO_NO_SERVICO" } })).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto({ uso: "lixo" as string, categoriaProduto: null })).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto(null)).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto(undefined)).toBe("INCLUSO_NO_SERVICO");
  });
  it("produto novo sem Uso: a categoria sugere; sem categoria (ou valor estranho), Material", () => {
    expect(usoSugeridoPelaCategoria("VENDA_A_PARTE")).toBe("PECA");
    expect(usoSugeridoPelaCategoria("INCLUSO_NO_SERVICO")).toBe("MATERIAL");
    expect(usoSugeridoPelaCategoria(undefined)).toBe("MATERIAL");
    expect(usoSugeridoPelaCategoria(null)).toBe("MATERIAL");
    expect(usoSugeridoPelaCategoria("PECA")).toBe("MATERIAL");
  });
});

describe("trocar o Uso só neste orçamento", () => {
  const gas = { id: "m1", produtoId: "gas", descricao: "Gás R410A", quantidade: 1.5, comportamento: "INCLUSO_NO_SERVICO" as const, valorVendaUnit: 120 };
  it("Material ↔ Peça, sem mexer no resto do item; ida e volta devolve o original", () => {
    const peca = trocarUso(gas);
    expect(peca).toEqual({ ...gas, comportamento: "VENDA_A_PARTE" });
    expect(ehPeca(peca)).toBe(true);
    expect(ehIncluso(peca)).toBe(false);
    expect(trocarUso(peca)).toEqual(gas);
  });
  it("não altera o objeto recebido (o snapshot muda; o cadastro do produto não é tocado aqui)", () => {
    const copia = { ...gas };
    trocarUso(gas);
    expect(gas).toEqual(copia);
  });
});

describe("cadastro do produto: campo e coluna Uso", () => {
  const def = CADASTROS.produtos;
  it("o formulário tem o campo Uso com as duas opções; a lista tem a coluna Uso com os rótulos", () => {
    const campo = def.campos.find((c: any) => c.key === "uso") as any;
    expect(campo).toBeTruthy();
    expect(campo.opcoes.map((o: any) => o.value)).toEqual(["MATERIAL", "PECA"]);
    const coluna = def.colunas.find((c: any) => c.key === "uso") as any;
    expect(coluna.label).toBe("Uso");
    expect(coluna.rotulos).toEqual({ MATERIAL: "Material", PECA: "Peça" });
  });
  it("schema: aceita MATERIAL/PECA; vazio = não informado (o servidor decide); outro valor = erro", () => {
    const ok = (uso: unknown) => def.schemaCriar.safeParse({ nome: "Compressor", unidade: "un", uso });
    expect(ok("PECA").success && (ok("PECA") as any).data.uso).toBe("PECA");
    expect(ok("MATERIAL").success).toBe(true);
    expect(ok("").success && (ok("") as any).data.uso).toBeUndefined();
    expect(ok(undefined).success).toBe(true);
    expect(ok("SERVICO").success).toBe(false);
  });
});

describe("planilha de produtos (Implantação): coluna uso", () => {
  const ctx = { existentes: new Map(), refs: {}, podeAtualizar: true } as any;
  const validar = (uso: unknown) => IMPORTACOES.produtos.validar({ nome: "Compressor", uso } as any, ctx) as any;
  it("a coluna existe, com as opções Material e Peça", () => {
    const col = IMPORTACOES.produtos.colunas.find((c) => c.chave === "uso")!;
    expect(col.opcoes).toEqual(["Material", "Peça"]);
  });
  it("aceita o rótulo, sem acento e minúsculo; vazio não manda Uso (novo vira Material no banco; o existente não muda)", () => {
    expect(validar("Peça").dados.uso).toBe("PECA");
    expect(validar("peca").dados.uso).toBe("PECA");
    expect(validar("material").dados.uso).toBe("MATERIAL");
    expect(validar("").dados).not.toHaveProperty("uso");
  });
  it("valor desconhecido: erro que diz as opções", () => {
    const r = validar("compressor");
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toMatch(/uso .*Material, Peça/);
  });
  it("exportar escreve o rótulo", () => {
    expect(IMPORTACOES.produtos.exportar({ nome: "A", uso: "PECA" }, {}).uso).toBe("Peça");
    expect(IMPORTACOES.produtos.exportar({ nome: "A", uso: "MATERIAL" }, {}).uso).toBe("Material");
  });
});

describe("lista do estoque: filtro por Uso", () => {
  it("MATERIAL ou PECA filtram; vazio ou valor estranho na URL = sem filtro", () => {
    expect(whereEstoque("e1", { uso: "PECA" })).toMatchObject({ empresaId: "e1", uso: "PECA" });
    expect(whereEstoque("e1", { uso: "MATERIAL" })).toMatchObject({ uso: "MATERIAL" });
    expect(whereEstoque("e1", {})).not.toHaveProperty("uso");
    expect(whereEstoque("e1", { uso: "x" })).not.toHaveProperty("uso");
    expect(whereEstoque("e1", { uso: "peca" })).not.toHaveProperty("uso");
  });
});
