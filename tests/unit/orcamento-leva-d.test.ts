/**
 * Orçamento, leva D — regras puras da impressão do orçamento (lib/orcamentos/documento-opcoes):
 *  - opções: desligado por padrão; "valores" só vale com "materiais";
 *  - materiais do serviço no documento: só os INCLUSOS, com quantidade, na ordem; preço de venda só com a opção;
 *    o custo NUNCA sai (nem como campo);
 *  - o número da OS vira link para a "versão do cliente" (relatório GERAL, /relatorio/os/<token>), da mesma
 *    empresa; sem relatório, sem link; nunca endereço interno.
 */
import { describe, expect, it } from "vitest";
import { materiaisNoDocumento, opcoesDoDocumento, osDoDocumento, type MaterialOrcamentoEntrada } from "@/lib/orcamentos/documento-opcoes";

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
