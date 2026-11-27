/**
 * "Orçamento E2 — regra de materiais por empresa": regras puras nos DOIS modos.
 *  - INCLUSO (o de sempre): o Material ajusta o serviço pela diferença do padrão; só a Peça vai à parte;
 *  - A_PARTE: o Material também vai em linha própria (quantidade × venda) e soma no total, como a Peça; o serviço
 *    fica na base; o item continua Material (rótulo, custo por Uso);
 *  - sem regra (ou valor estranho) = INCLUSO; a troca Material ⇄ Peça continua valendo nos dois modos;
 *  - documento: com A_PARTE, a lista "Materiais inclusos" não repete o que já é linha; Implantação: o item.
 */
import { describe, expect, it } from "vitest";
import {
  ajusteDosMateriais, cobradoAParte, COBRANCA_PADRAO, diferencaDoMaterial, ehCobranca, LABEL_COBRANCA, pecasDosMateriais,
  prepararServicosComMateriais, regraDeCobranca, resumoMateriais, trocarUso, valorDaLinha, type MaterialOrcamento,
} from "@/lib/orcamentos/materiais";
import { prepararItemOs } from "@/lib/os/materiais";
import { materiaisNoDocumento } from "@/lib/orcamentos/documento-opcoes";
import { montarEtapas, type Contagens } from "@/lib/implantacao/etapas";

const M = (produtoId: string, quantidade: number, quantidadePadrao: number, valorVendaUnit: number, comportamento: MaterialOrcamento["comportamento"], custoUnit: number | null = null): MaterialOrcamento =>
  ({ id: produtoId, produtoId, descricao: produtoId, unidade: "un", comportamento, quantidade, quantidadePadrao, valorVendaUnit, custoUnit, origem: "SOLTO", kitNome: null });
// Tubo 3→5 (padrão 3, 20/un), suporte 1 (60), capacitor (peça) 1 × 80
const MATERIAIS = [M("tubo", 5, 3, 20, "INCLUSO_NO_SERVICO", 12), M("suporte", 1, 1, 60, "INCLUSO_NO_SERVICO"), M("cap", 1, 1, 80, "VENDA_A_PARTE", 45)];
const LINHA = { quantidade: 1, valorUnitario: 800, materiais: MATERIAIS };

describe("a regra", () => {
  it("dois valores e rótulos fixos; sem regra ou valor estranho = INCLUSO", () => {
    expect(LABEL_COBRANCA).toEqual({ INCLUSO: "Incluso no serviço", A_PARTE: "Cobrado à parte" });
    expect(COBRANCA_PADRAO).toBe("INCLUSO");
    for (const v of [undefined, null, "", "a_parte", "VENDA_A_PARTE", 1]) expect(regraDeCobranca(v)).toBe("INCLUSO");
    expect(regraDeCobranca("A_PARTE")).toBe("A_PARTE");
    expect(ehCobranca("A_PARTE")).toBe(true);
    expect(ehCobranca("x")).toBe(false);
  });
  it("vai à parte: a Peça sempre; o Material só com A_PARTE", () => {
    const [tubo, , cap] = MATERIAIS;
    expect([cobradoAParte(tubo), cobradoAParte(tubo, "INCLUSO"), cobradoAParte(tubo, "A_PARTE")]).toEqual([false, false, true]);
    expect([cobradoAParte(cap), cobradoAParte(cap, "INCLUSO"), cobradoAParte(cap, "A_PARTE")]).toEqual([true, true, true]);
  });
});

describe("INCLUSO (como no Orçamento E)", () => {
  it("o Material ajusta o serviço; só a Peça vira linha com valor", () => {
    expect(MATERIAIS.map((m) => diferencaDoMaterial(m, "INCLUSO"))).toEqual([40, 0, 0]);
    expect(ajusteDosMateriais(MATERIAIS, "INCLUSO")).toBe(40);
    expect(valorDaLinha(LINHA, "INCLUSO").valorTotal).toBe(840);
    expect(pecasDosMateriais(MATERIAIS, "INCLUSO").map((p) => [p.descricao, p.valorTotal, p.ehMaterial])).toEqual([["cap", 80, false]]);
  });
  it("sem regra informada é igual ao INCLUSO", () => {
    expect(valorDaLinha(LINHA)).toEqual(valorDaLinha(LINHA, "INCLUSO"));
    expect(pecasDosMateriais(MATERIAIS)).toEqual(pecasDosMateriais(MATERIAIS, "INCLUSO"));
    expect(resumoMateriais(MATERIAIS)).toEqual(resumoMateriais(MATERIAIS, "INCLUSO"));
  });
});

describe("A_PARTE (cobrado à parte)", () => {
  it("o serviço fica na base; cada Material vira linha com quantidade × venda, como a Peça", () => {
    expect(MATERIAIS.map((m) => diferencaDoMaterial(m, "A_PARTE"))).toEqual([0, 0, 0]);
    expect(ajusteDosMateriais(MATERIAIS, "A_PARTE")).toBe(0);
    expect(valorDaLinha(LINHA, "A_PARTE")).toMatchObject({ valorBase: 800, ajuste: 0, valorTotal: 800 });
    expect(pecasDosMateriais(MATERIAIS, "A_PARTE").map((p) => [p.descricao, p.quantidade, p.valorUnitario, p.valorTotal, p.ehMaterial]))
      .toEqual([["tubo", 5, 20, 100, true], ["suporte", 1, 60, 60, true], ["cap", 1, 80, 80, false]]);
  });
  it("material com quantidade 0 (não usado) não vira linha", () => {
    const ms = [M("tubo", 0, 3, 20, "INCLUSO_NO_SERVICO"), M("fita", 2, 0, 15, "INCLUSO_NO_SERVICO")];
    expect(pecasDosMateriais(ms, "A_PARTE").map((p) => p.descricao)).toEqual(["fita"]);
    expect(valorDaLinha({ quantidade: 1, valorUnitario: 800, materiais: ms }, "A_PARTE").valorTotal).toBe(800);
  });
  it("resumo: o que vai à parte soma tudo; o custo continua separado por Uso (Material × Peça)", () => {
    const r = resumoMateriais(MATERIAIS, "A_PARTE");
    expect(r).toMatchObject({ ajuste: 0, pecas: 240, quantasPecas: 3, custoInclusos: 60, custoPecas: 45, custoTotal: 105, semCusto: 1 });
    const i = resumoMateriais(MATERIAIS, "INCLUSO");
    // o custo é o mesmo nos dois modos (só a cobrança muda)
    expect([i.custoInclusos, i.custoPecas, i.custoTotal]).toEqual([r.custoInclusos, r.custoPecas, r.custoTotal]);
  });
  it("valor manual continua valendo", () => {
    expect(valorDaLinha({ ...LINHA, valorManual: true, valorTotal: 999 }, "A_PARTE").valorTotal).toBe(999);
  });
  it("gravar: as linhas à parte saem na ordem dos serviços, marcando o que é Material", () => {
    const { linhas, pecas } = prepararServicosComMateriais([{ ...LINHA, descricao: "Instalação" }, { quantidade: 2, valorUnitario: 150, descricao: "Limpeza" }], "A_PARTE");
    expect(linhas.map((l) => l.valor.valorTotal)).toEqual([800, 300]);
    expect(pecas.map((p) => [p.descricao, p.idxServico, p.ehMaterial])).toEqual([["tubo", 0, true], ["suporte", 0, true], ["cap", 0, false]]);
  });
  it("OS: o item de serviço fica na base e cada material vira item PRODUTO derivado", () => {
    const p = prepararItemOs({ tipo: "SERVICO", descricao: "Instalação", quantidade: 1, valorUnitario: 800, materiais: MATERIAIS }, "A_PARTE");
    expect(p.valorTotal).toBe(800);
    expect(p.pecas.map((x) => [x.descricao, x.valorTotal, x.idxMaterial])).toEqual([["tubo", 100, 0], ["suporte", 60, 1], ["cap", 80, 2]]);
    const i = prepararItemOs({ tipo: "SERVICO", descricao: "Instalação", quantidade: 1, valorUnitario: 800, materiais: MATERIAIS });
    expect([i.valorTotal, i.pecas.length]).toEqual([840, 1]);
  });
});

describe("a troca Material ⇄ Peça continua valendo nos dois modos", () => {
  it("INCLUSO: o Material trocado para Peça sai do ajuste e vira linha", () => {
    const ms = [trocarUso(MATERIAIS[0]), MATERIAIS[1], MATERIAIS[2]];
    expect(ajusteDosMateriais(ms, "INCLUSO")).toBe(0);
    expect(pecasDosMateriais(ms, "INCLUSO").map((p) => p.descricao)).toEqual(["tubo", "cap"]);
  });
  it("A_PARTE: a cobrança é a mesma (os dois vão à parte); muda o Uso do item (rótulo e custo)", () => {
    const ms = [trocarUso(MATERIAIS[0]), MATERIAIS[1], MATERIAIS[2]];
    expect(pecasDosMateriais(ms, "A_PARTE").map((p) => [p.descricao, p.valorTotal, p.ehMaterial])).toEqual([["tubo", 100, false], ["suporte", 60, true], ["cap", 80, false]]);
    expect(resumoMateriais(ms, "A_PARTE").custoPecas).toBe(105); // tubo (5 × 12) + cap (45)
  });
});

describe("documento: a lista dentro do serviço", () => {
  const entrada = MATERIAIS.map((m) => ({ descricao: m.descricao, quantidade: m.quantidade, unidade: "un", comportamento: m.comportamento, ordem: 0 }));
  it("INCLUSO: lista os materiais (sem valor); A_PARTE: vazia (eles já são linhas com valor)", () => {
    expect(materiaisNoDocumento(entrada, { mostrarMateriais: true }, "INCLUSO").map((m) => m.descricao)).toEqual(["tubo", "suporte"]);
    expect(materiaisNoDocumento(entrada, { mostrarMateriais: true })).toHaveLength(2);
    expect(materiaisNoDocumento(entrada, { mostrarMateriais: true }, "A_PARTE")).toEqual([]);
  });
});

describe("Implantação: \"Como você cobra materiais?\" na etapa de configuração", () => {
  const C: Contagens = { dadosEmpresa: true, logo: true, tiposOs: 1, usuarios: 1, clientes: 0, unidades: 0, contatos: 0, equipamentos: 0, produtosEstoque: 0, produtosComSaldo: 0, colaboradores: 0, veiculos: 0, contratos: 0, pmocs: 0 };
  const item = (c: Partial<Contagens>) => montarEtapas({ ...C, ...c }, () => true)[0].itens.find((i) => i.rotulo === "Como você cobra materiais?");
  it("mostra a escolha atual e leva a Configurações › Orçamento; sem configuração gravada, o padrão (Incluso)", () => {
    expect(item({ cobrancaMateriais: "A_PARTE" })).toMatchObject({ texto: "Cobrado à parte", secao: "orcamento", valor: true });
    expect(item({ cobrancaMateriais: "INCLUSO" })!.texto).toBe("Incluso no serviço");
    expect(item({})!.texto).toBe("Incluso no serviço");
  });
  it("é uma decisão (sempre há uma), então não trava a etapa", () => {
    expect(montarEtapas(C, () => true)[0].feita).toBe(true);
  });
});
