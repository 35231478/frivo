/**
 * Leva 6B — as REGRAS das sugestões de item do orçamento (Princípio 9), sem banco e sem tela.
 *
 * O que elas prometem:
 *  - conta ORÇAMENTOS distintos, não linhas (três linhas do mesmo serviço no mesmo orçamento = 1);
 *  - só sugere o que apareceu em pelo menos MINIMO_ORCAMENTOS (histórico fino não sugere);
 *  - o preço é o da linha mais recente — o último praticado, nunca média;
 *  - item do catálogo é o mesmo item em qualquer orçamento; escrito à mão vale pelo texto;
 *  - serviço e produto com o mesmo nome são itens diferentes;
 *  - no máximo MAXIMO_SUGESTOES, do mais usado para o menos; empate desempata pelo mais recente;
 *  - a janela é móvel (JANELA_MESES meses).
 */
import { describe, expect, it } from "vitest";
import {
  JANELA_MESES,
  MAXIMO_SUGESTOES,
  MINIMO_ORCAMENTOS,
  chaveDoItem,
  inicioDaJanela,
  motivoDaSugestao,
  sugestoesDoHistorico,
  type LinhaDoHistorico,
} from "@/lib/orcamentos/sugestoes-itens";

const dia = (d: string) => new Date(`${d}T12:00:00Z`);
const linha = (o: Partial<LinhaDoHistorico> & { orcamentoId: string }): LinhaDoHistorico => ({
  tipo: "SERVICO", catalogoId: "s1", descricao: "Limpeza de split", valorUnitario: 200, criadoEm: dia("2026-10-01"), ...o,
});

describe("sugestões de item: o que entra", () => {
  it("menos de dois orçamentos não sugere (histórico fino)", () => {
    expect(sugestoesDoHistorico([linha({ orcamentoId: "o1" })])).toEqual([]);
    expect(MINIMO_ORCAMENTOS).toBe(2);
  });

  it("o mesmo item repetido NO MESMO orçamento conta uma vez", () => {
    const linhas = [linha({ orcamentoId: "o1" }), linha({ orcamentoId: "o1" }), linha({ orcamentoId: "o1" })];
    expect(sugestoesDoHistorico(linhas)).toEqual([]);
  });

  it("em dois orçamentos, sugere — com o preço da linha mais recente e a contagem", () => {
    const s = sugestoesDoHistorico([
      linha({ orcamentoId: "o1", valorUnitario: 180, criadoEm: dia("2026-07-10") }),
      linha({ orcamentoId: "o2", valorUnitario: 240, criadoEm: dia("2026-09-20") }),
    ]);
    expect(s).toHaveLength(1);
    expect([s[0].descricao, s[0].valorUnitario, s[0].vezes]).toEqual(["Limpeza de split", 240, 2]);
    expect(motivoDaSugestao(s[0])).toBe(`2 orçamentos deste cliente nos últimos ${JANELA_MESES} meses`);
  });

  it("a ordem das linhas não muda o preço: vale a data, não quem veio primeiro", () => {
    const nova = linha({ orcamentoId: "o2", valorUnitario: 240, criadoEm: dia("2026-09-20") });
    const velha = linha({ orcamentoId: "o1", valorUnitario: 180, criadoEm: dia("2026-07-10") });
    expect(sugestoesDoHistorico([nova, velha])[0].valorUnitario).toBe(240);
    expect(sugestoesDoHistorico([velha, nova])[0].valorUnitario).toBe(240);
  });

  it("linha sem descrição não vira sugestão", () => {
    const linhas = [linha({ orcamentoId: "o1", catalogoId: null, descricao: "  " }), linha({ orcamentoId: "o2", catalogoId: null, descricao: "" })];
    expect(sugestoesDoHistorico(linhas)).toEqual([]);
  });
});

describe("sugestões de item: o que é 'o mesmo item'", () => {
  it("o do catálogo é o mesmo em qualquer orçamento, mesmo com a descrição editada", () => {
    const s = sugestoesDoHistorico([
      linha({ orcamentoId: "o1", descricao: "Limpeza de split" }),
      linha({ orcamentoId: "o2", descricao: "Limpeza de split (hi-wall)" }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].vezes).toBe(2);
  });

  it("o escrito à mão vale pelo texto, sem ligar para caixa nem espaço repetido", () => {
    const s = sugestoesDoHistorico([
      linha({ orcamentoId: "o1", catalogoId: null, descricao: "Troca  de FILTRO" }),
      linha({ orcamentoId: "o2", catalogoId: null, descricao: "troca de filtro" }),
    ]);
    expect(s).toHaveLength(1);
    expect(chaveDoItem({ tipo: "SERVICO", catalogoId: null, descricao: "Troca  de FILTRO" }))
      .toBe(chaveDoItem({ tipo: "SERVICO", catalogoId: null, descricao: "troca de filtro" }));
  });

  it("serviço e produto com o MESMO id de catálogo são itens diferentes", () => {
    const s = sugestoesDoHistorico([
      linha({ orcamentoId: "o1", tipo: "SERVICO", catalogoId: "x1", descricao: "Higienização" }),
      linha({ orcamentoId: "o2", tipo: "PRODUTO", catalogoId: "x1", descricao: "Higienização" }),
    ]);
    expect(s).toEqual([]);
    expect(chaveDoItem({ tipo: "SERVICO", catalogoId: "x1", descricao: "a" }))
      .not.toBe(chaveDoItem({ tipo: "PRODUTO", catalogoId: "x1", descricao: "a" }));
  });

  it("serviço e produto com o mesmo nome são itens diferentes", () => {
    const s = sugestoesDoHistorico([
      linha({ orcamentoId: "o1", tipo: "SERVICO", catalogoId: null, descricao: "Gás R-410A" }),
      linha({ orcamentoId: "o2", tipo: "PRODUTO", catalogoId: null, descricao: "Gás R-410A" }),
    ]);
    expect(s).toEqual([]);
  });
});

describe("sugestões de item: a ordem e o tamanho da lista", () => {
  const comVezes = (id: string, vezes: number, dias: number) =>
    Array.from({ length: vezes }, (_, i) => linha({
      orcamentoId: `${id}-o${i}`, catalogoId: id, descricao: id,
      criadoEm: new Date(dia("2026-10-01").getTime() - dias * 86400000),
    }));

  it("do mais usado para o menos usado", () => {
    const s = sugestoesDoHistorico([...comVezes("a", 2, 1), ...comVezes("b", 4, 1), ...comVezes("c", 3, 1)]);
    expect(s.map((x) => x.descricao)).toEqual(["b", "c", "a"]);
  });

  it("empate no número de orçamentos: na frente o mais recente", () => {
    const s = sugestoesDoHistorico([...comVezes("antigo", 2, 60), ...comVezes("recente", 2, 1)]);
    expect(s.map((x) => x.descricao)).toEqual(["recente", "antigo"]);
  });

  it(`no máximo ${MAXIMO_SUGESTOES} itens — o que não cabe não aparece`, () => {
    const linhas = ["a", "b", "c", "d", "e", "f", "g"].flatMap((id, i) => comVezes(id, 2 + i, 1));
    const s = sugestoesDoHistorico(linhas);
    expect(s).toHaveLength(MAXIMO_SUGESTOES);
    expect(s.map((x) => x.descricao)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("o mínimo e o máximo são ajustáveis (a rota usa os padrões)", () => {
    const linhas = comVezes("a", 1, 1);
    expect(sugestoesDoHistorico(linhas, { minimo: 1 })).toHaveLength(1);
    expect(sugestoesDoHistorico([...comVezes("a", 2, 1), ...comVezes("b", 2, 2)], { maximo: 1 })).toHaveLength(1);
  });
});

describe("a janela móvel", () => {
  it(`começa ${JANELA_MESES} meses antes de agora`, () => {
    const agora = dia("2026-11-15");
    const inicio = inicioDaJanela(agora);
    expect(inicio.getFullYear()).toBe(2026);
    expect(inicio.getMonth()).toBe(agora.getMonth() - JANELA_MESES);
    expect(inicio.getDate()).toBe(agora.getDate());
  });

  it("vira o ano quando precisa", () => {
    const inicio = inicioDaJanela(dia("2026-02-10"));
    expect([inicio.getFullYear(), inicio.getMonth()]).toEqual([2025, 7]); // agosto/2025
  });
});
