/**
 * Orçamento, leva D (revista no "Orçamento E — Material × Peça") — regras puras da impressão do orçamento
 * (lib/orcamentos/documento-opcoes):
 *  - "Mostrar materiais": LIGADO por padrão; só `false` desliga. A opção "valores dos materiais" saiu ("Orçamento E":
 *    material vai embutido no preço do serviço, sem valor; quem tem valor é a peça, em linha própria);
 *  - materiais do serviço no documento: só os MATERIAIS (inclusos), com quantidade, na ordem; NUNCA valor nem custo;
 *  - o número da OS vira link para a "versão do cliente" (relatório GERAL, /relatorio/os/<token>), da mesma
 *    empresa; sem relatório, sem link; nunca endereço interno.
 */
import { describe, expect, it } from "vitest";
import { materiaisNoDocumento, opcoesDoDocumento, osDoDocumento, type MaterialOrcamentoEntrada } from "@/lib/orcamentos/documento-opcoes";

const M = (descricao: string, quantidade: unknown, valorVendaUnit: unknown, extra: Partial<MaterialOrcamentoEntrada> & { custoUnit?: unknown } = {}) => ({
  descricao, quantidade, valorVendaUnit, unidade: "un", comportamento: "INCLUSO_NO_SERVICO", ordem: 0, custoUnit: 7.77, ...extra,
});
const LIGADO = { mostrarMateriais: true };
const DESLIGADO = { mostrarMateriais: false };

describe("opcoesDoDocumento — mostrar materiais", () => {
  it("padrão (nada gravado) = LIGADO: o cliente vê a lista de materiais dentro do serviço", () => {
    expect(opcoesDoDocumento(undefined)).toEqual(LIGADO);
    expect(opcoesDoDocumento(null)).toEqual(LIGADO);
    expect(opcoesDoDocumento({})).toEqual(LIGADO);
    expect(opcoesDoDocumento({ mostrarMateriais: null })).toEqual(LIGADO);
  });
  it("só `false` desliga; gravado `true` fica ligado", () => {
    expect(opcoesDoDocumento({ mostrarMateriais: false })).toEqual(DESLIGADO);
    expect(opcoesDoDocumento({ mostrarMateriais: true })).toEqual(LIGADO);
  });
  it("o antigo 'valores dos materiais' não existe mais na resposta (nem vindo ligado de um registro antigo)", () => {
    const r = opcoesDoDocumento({ mostrarMateriais: true, mostrarValoresMateriais: true } as { mostrarMateriais: boolean });
    expect(r).toEqual(LIGADO);
    expect(Object.keys(r)).toEqual(["mostrarMateriais"]);
  });
});

describe("materiaisNoDocumento — os materiais dentro do serviço, sem valor", () => {
  const lista = [
    M("Fita isolante", "2.000", "12.50", { ordem: 2 }),
    M("Filtro G4", 2, 89.9, { ordem: 0 }),
    M("Compressor (peça)", 1, 300, { ordem: 1, comportamento: "VENDA_A_PARTE" }),
    M("Retirado do padrão", 0, 10, { ordem: 3 }),
    M("   ", 1, 10, { ordem: 4 }),
  ];

  it("desligado: nenhum material", () => {
    expect(materiaisNoDocumento(lista, DESLIGADO)).toEqual([]);
  });

  it("ligado: só os materiais (peça fica de fora), com quantidade e unidade, na ordem do orçamento", () => {
    expect(materiaisNoDocumento(lista, LIGADO)).toEqual([
      { descricao: "Filtro G4", quantidade: 2, unidade: "un" },
      { descricao: "Fita isolante", quantidade: 2, unidade: "un" },
    ]);
  });

  it("nem valor nem custo saem — nem como campo", () => {
    const r = materiaisNoDocumento([M("Filtro", 2, 89.9, { custoUnit: 38.5 })], LIGADO);
    expect(Object.keys(r[0]).sort()).toEqual(["descricao", "quantidade", "unidade"]);
    expect(JSON.stringify(r)).not.toMatch(/custo|valor|38\.5|89\.9/);
  });

  it("quantidade com 3 casas; sem unidade = 'un'; descrição aparada; sem materiais = lista vazia", () => {
    expect(materiaisNoDocumento([M("Gás", "1.5004", 120, { unidade: "kg" })], LIGADO)).toEqual([{ descricao: "Gás", quantidade: 1.5, unidade: "kg" }]);
    expect(materiaisNoDocumento([M("  Tubo  ", 3, 1, { unidade: null })], LIGADO)).toEqual([{ descricao: "Tubo", quantidade: 3, unidade: "un" }]);
    expect(materiaisNoDocumento([M("Tubo", 3, 1, { unidade: "  " })], LIGADO)[0].unidade).toBe("un");
    expect(materiaisNoDocumento(null, LIGADO)).toEqual([]);
    expect(materiaisNoDocumento(undefined, LIGADO)).toEqual([]);
  });

  it("ordem ausente conta como 0 e a ordem original se mantém no empate", () => {
    const r = materiaisNoDocumento([M("B", 1, 1, { ordem: 1 }), M("A", 1, 1, { ordem: null }), M("C", 1, 1, { ordem: undefined })], LIGADO);
    expect(r.map((m) => m.descricao)).toEqual(["A", "C", "B"]);
  });

  it("quantidade inválida não quebra (vira 0 e sai)", () => {
    expect(materiaisNoDocumento([M("X", "abc", 1)], LIGADO)).toEqual([]);
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
