/**
 * Orçamento, leva D — regras puras da impressão do orçamento (lib/orcamentos/documento-opcoes):
 *  - opções: desligado por padrão; "valores" só vale com "materiais";
 *  - materiais do serviço no documento: só os INCLUSOS, com quantidade, na ordem; preço de venda só com a opção;
 *    o custo NUNCA sai (nem como campo);
 *  - o número da OS vira link para a "versão do cliente" (relatório GERAL, /relatorio/os/<token>), da mesma
 *    empresa; sem relatório, sem link; nunca endereço interno.
 */
import { describe, expect, it } from "vitest";
import { fatorPrecoDoServico, materiaisNoDocumento, opcoesDoDocumento, osDoDocumento, type MaterialOrcamentoEntrada } from "@/lib/orcamentos/documento-opcoes";

const M = (descricao: string, quantidade: unknown, valorVendaUnit: unknown, extra: Partial<MaterialOrcamentoEntrada> & { custoUnit?: unknown } = {}) => ({
  descricao, quantidade, valorVendaUnit, unidade: "un", comportamento: "INCLUSO_NO_SERVICO", ordem: 0, custoUnit: 7.77, ...extra,
});
const LIGADO = { mostrarMateriais: true, mostrarValoresMateriais: false };
const COM_VALORES = { mostrarMateriais: true, mostrarValoresMateriais: true };

describe("opcoesDoDocumento — as duas opções", () => {
  it("padrão (nada gravado) = tudo desligado: o cliente vê só a linha do serviço", () => {
    expect(opcoesDoDocumento(undefined)).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
    expect(opcoesDoDocumento(null)).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
    expect(opcoesDoDocumento({})).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
  });
  it("valores só vale com materiais ligado", () => {
    expect(opcoesDoDocumento({ mostrarMateriais: false, mostrarValoresMateriais: true })).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
    expect(opcoesDoDocumento({ mostrarMateriais: true, mostrarValoresMateriais: false })).toEqual(LIGADO);
    expect(opcoesDoDocumento({ mostrarMateriais: true, mostrarValoresMateriais: true })).toEqual(COM_VALORES);
  });
  it("só `true` liga (nada de 'truthy' vindo de fora)", () => {
    expect(opcoesDoDocumento({ mostrarMateriais: "true" as unknown as boolean, mostrarValoresMateriais: 1 as unknown as boolean })).toEqual({ mostrarMateriais: false, mostrarValoresMateriais: false });
    expect(opcoesDoDocumento({ mostrarMateriais: true, mostrarValoresMateriais: "sim" as unknown as boolean })).toEqual(LIGADO);
  });
});

describe("materiaisNoDocumento — os materiais dentro do serviço", () => {
  const lista = [
    M("Fita isolante", "2.000", "12.50", { ordem: 2 }),
    M("Filtro G4", 2, 89.9, { ordem: 0 }),
    M("Peça à parte", 1, 300, { ordem: 1, comportamento: "VENDA_A_PARTE" }),
    M("Retirado do padrão", 0, 10, { ordem: 3 }),
    M("   ", 1, 10, { ordem: 4 }),
  ];

  it("desligado: nenhum material (como sempre)", () => {
    expect(materiaisNoDocumento(lista, { mostrarMateriais: false, mostrarValoresMateriais: false })).toEqual([]);
    // mesmo que "valores" chegue ligado sozinho
    expect(materiaisNoDocumento(lista, { mostrarMateriais: false, mostrarValoresMateriais: true })).toEqual([]);
  });

  it("ligado sem valores: só os inclusos, com quantidade e unidade, na ordem do orçamento; sem preço", () => {
    expect(materiaisNoDocumento(lista, LIGADO)).toEqual([
      { descricao: "Filtro G4", quantidade: 2, unidade: "un", valorUnitario: null, valorTotal: null },
      { descricao: "Fita isolante", quantidade: 2, unidade: "un", valorUnitario: null, valorTotal: null },
    ]);
  });

  it("com valores: o PREÇO DE VENDA (unitário e unitário × quantidade, em centavos)", () => {
    expect(materiaisNoDocumento([M("Gás", "1.500", "120.33", { unidade: "kg" }), M("Filtro", 2, 89.9)], COM_VALORES)).toEqual([
      { descricao: "Gás", quantidade: 1.5, unidade: "kg", valorUnitario: 120.33, valorTotal: 180.5 },
      { descricao: "Filtro", quantidade: 2, unidade: "un", valorUnitario: 89.9, valorTotal: 179.8 },
    ]);
  });

  it("o custo NUNCA sai — nem como campo, nem com valores ligados", () => {
    const r = materiaisNoDocumento([M("Filtro", 2, 89.9, { custoUnit: 38.5 })], COM_VALORES);
    expect(Object.keys(r[0]).sort()).toEqual(["descricao", "quantidade", "unidade", "valorTotal", "valorUnitario"]);
    expect(JSON.stringify(r)).not.toMatch(/custo|38\.5/);
  });

  it("sem unidade = 'un'; descrição aparada; sem materiais = lista vazia", () => {
    expect(materiaisNoDocumento([M("  Tubo  ", 3, 1, { unidade: null })], LIGADO)).toEqual([{ descricao: "Tubo", quantidade: 3, unidade: "un", valorUnitario: null, valorTotal: null }]);
    expect(materiaisNoDocumento([M("Tubo", 3, 1, { unidade: "  " })], LIGADO)[0].unidade).toBe("un");
    expect(materiaisNoDocumento(null, COM_VALORES)).toEqual([]);
    expect(materiaisNoDocumento(undefined, COM_VALORES)).toEqual([]);
  });

  it("ordem ausente conta como 0 e a ordem original se mantém no empate", () => {
    const r = materiaisNoDocumento([M("B", 1, 1, { ordem: 1 }), M("A", 1, 1, { ordem: null }), M("C", 1, 1, { ordem: undefined })], LIGADO);
    expect(r.map((m) => m.descricao)).toEqual(["A", "C", "B"]);
  });

  it("quantidade e preço inválidos não quebram (viram 0: quantidade 0 sai)", () => {
    expect(materiaisNoDocumento([M("X", "abc", 1)], LIGADO)).toEqual([]);
    expect(materiaisNoDocumento([M("X", 1, "abc")], COM_VALORES)).toEqual([{ descricao: "X", quantidade: 1, unidade: "un", valorUnitario: 0, valorTotal: 0 }]);
  });

  it("não altera a lista recebida", () => {
    const original = [M("B", 1, 1, { ordem: 1 }), M("A", 1, 1, { ordem: 0 })];
    materiaisNoDocumento(original, LIGADO);
    expect(original.map((m) => m.descricao)).toEqual(["B", "A"]);
  });
});

describe("ISS embutido — o material na MESMA base de preço do serviço (versão do cliente)", () => {
  const soma = (xs: { valorTotal: number | null }[]) => Math.round(xs.reduce((a, m) => a + (m.valorTotal ?? 0), 0) * 100) / 100;

  it("fator do serviço = valor no documento ÷ valor gravado; sem ISS (ou valor zerado) = 1", () => {
    expect(fatorPrecoDoServico(440, 462)).toBeCloseTo(1.05, 10);
    expect(fatorPrecoDoServico(440, 440)).toBe(1);
    expect(fatorPrecoDoServico(0, 10)).toBe(1);
    expect(fatorPrecoDoServico(440, 0)).toBe(1);
    expect(fatorPrecoDoServico(Number.NaN, 10)).toBe(1);
  });

  it("ISS 5%: cada material sobe o mesmo 5% do serviço; a SOMA exibida bate exatamente com Σ preço × qtd × fator", () => {
    const lista = [M("Filtro G4", 2, 89.9), M("Limpa-serpentina", 1, 38, { unidade: "L" }), M("Fita", 2, 12.5, { unidade: "rl" })];
    const r = materiaisNoDocumento(lista, COM_VALORES, fatorPrecoDoServico(440, 462));
    expect(r.map((m) => [m.valorUnitario, m.valorTotal])).toEqual([[94.4, 188.79], [39.9, 39.9], [13.13, 26.25]]);
    // 242,80 × 1,05 = 254,94: a soma do que o cliente lê é exatamente essa
    expect(soma(r)).toBe(254.94);
    expect(soma(r)).toBe(Math.round(soma(materiaisNoDocumento(lista, COM_VALORES)) * 1.05 * 100) / 100);
  });

  it("fator que gera dízima: a sobra de centavo vai para quem tem a maior fração (nada se perde)", () => {
    const lista = [M("A", 1, 10), M("B", 1, 10), M("C", 1, 10)];
    const f = 30.01 / 30; // 30,00 → 30,01: um centavo que não divide por 3
    const r = materiaisNoDocumento(lista, COM_VALORES, f);
    expect(soma(r)).toBe(30.01);
    expect(r.map((m) => m.valorTotal)).toEqual([10.01, 10, 10]);
  });

  it("fator 1 (sem ISS / versão interna): o preço cadastrado, intacto", () => {
    expect(materiaisNoDocumento([M("Filtro", 2, 89.9)], COM_VALORES, 1)).toEqual([{ descricao: "Filtro", quantidade: 2, unidade: "un", valorUnitario: 89.9, valorTotal: 179.8 }]);
  });

  it("fator inválido vira 1; sem a opção de valores o fator não importa (nada de preço)", () => {
    expect(materiaisNoDocumento([M("Filtro", 2, 89.9)], COM_VALORES, Number.NaN)[0].valorTotal).toBe(179.8);
    expect(materiaisNoDocumento([M("Filtro", 2, 89.9)], COM_VALORES, -2)[0].valorTotal).toBe(179.8);
    expect(materiaisNoDocumento([M("Filtro", 2, 89.9)], LIGADO, 1.05)[0]).toMatchObject({ valorUnitario: null, valorTotal: null });
  });
});

describe("osDoDocumento — o número da OS vira link público", () => {
  const OS = (numero: string, criadoEm: string, relatorios: { tokenPublico: string; escopo?: string; empresaId?: string }[] = [], empresaId = "e1") =>
    ({ ordemServico: { numero, criadoEm, empresaId, relatorios } });
  const TK = "5ff6ddb2-d03c-4865-b40a-1d433ddcc5d0";

  it("com a versão do cliente (relatório GERAL) → /relatorio/os/<token>; sem ela → só o número", () => {
    expect(osDoDocumento([OS("OS-2", "2026-11-03T10:00:00Z"), OS("OS-1", "2026-11-02T10:00:00Z", [{ tokenPublico: TK, escopo: "GERAL", empresaId: "e1" }])], "e1")).toEqual([
      { numero: "OS-1", href: `/relatorio/os/${TK}` },
      { numero: "OS-2", href: null },
    ]);
  });

  it("só o relatório GERAL (a versão do cliente da OS inteira), não o de uma atividade nem a medição", () => {
    expect(osDoDocumento([OS("OS-1", "2026-11-02T10:00:00Z", [{ tokenPublico: "atividade-123", escopo: "ATIVIDADE" }, { tokenPublico: "medicao-1234", escopo: "MEDICAO_COMPLETA" }])], "e1"))
      .toEqual([{ numero: "OS-1", href: null }]);
    expect(osDoDocumento([OS("OS-1", "2026-11-02T10:00:00Z", [{ tokenPublico: "atividade-123", escopo: "ATIVIDADE" }, { tokenPublico: TK, escopo: "GERAL" }])], "e1"))
      .toEqual([{ numero: "OS-1", href: `/relatorio/os/${TK}` }]);
  });

  it("multiempresa: OS ou relatório de outra empresa não entram", () => {
    expect(osDoDocumento([OS("OS-9", "2026-11-01T10:00:00Z", [{ tokenPublico: TK, escopo: "GERAL" }], "e2")], "e1")).toEqual([]);
    expect(osDoDocumento([OS("OS-1", "2026-11-02T10:00:00Z", [{ tokenPublico: TK, escopo: "GERAL", empresaId: "e2" }])], "e1")).toEqual([{ numero: "OS-1", href: null }]);
  });

  it("token estranho não vira link (nada de montar endereço com lixo)", () => {
    for (const ruim of ["", "curto", "../../ordens/x", "a b c d e f g h", "javascript:alert(1)"]) {
      expect(osDoDocumento([OS("OS-1", "2026-11-02T10:00:00Z", [{ tokenPublico: ruim, escopo: "GERAL" }])], "e1")).toEqual([{ numero: "OS-1", href: null }]);
    }
  });

  it("o mesmo número (vínculo repetido) aparece uma vez, com o link de quem tiver; nunca endereço interno", () => {
    const r = osDoDocumento([OS("OS-1", "2026-11-02T10:00:00Z"), OS(" OS-1 ", "2026-11-03T10:00:00Z", [{ tokenPublico: TK }])], "e1");
    expect(r).toEqual([{ numero: "OS-1", href: `/relatorio/os/${TK}` }]);
    expect(JSON.stringify(r)).not.toMatch(/\/ordens\/|\/orcamentos\/|\/api\//);
  });

  it("sem vínculos: nada", () => {
    expect(osDoDocumento(null, "e1")).toEqual([]);
    expect(osDoDocumento(undefined)).toEqual([]);
    expect(osDoDocumento([{ ordemServico: null }], "e1")).toEqual([]);
  });
});
