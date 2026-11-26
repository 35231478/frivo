/**
 * PAINEL DE ATIVIDADES da OS — as regras puras (lib/os/painel-atividades) e o destino das abas (lib/os/abas):
 *  - a ordem do painel é a do calendário: pela data agendada, sem data no fim, canceladas por último, empate pela criação;
 *  - a observação curta: uma linha, espaços juntados, cortada numa palavra inteira com reticências; vazia = null;
 *  - o resumo do título: "2 de 4 concluídas", "1 atividade", "Nenhuma atividade" (canceladas não contam);
 *  - 5 abas; "atividades"/"formularios" levam ao painel (num clique a aba não muda; ao abrir, Resumo + painel);
 *    os links antigos caem na aba que os absorveu; "prazos" vai para o Resumo (as etapas com prazo moram lá).
 */
import { describe, expect, it } from "vitest";
import { OBSERVACAO_CURTA_MAX, observacaoCurta, ordenarParaPainel, resumoDoPainel } from "@/lib/os/painel-atividades";
import { ABAS_OS, PAINEL_ATIVIDADES, abaValida, destinoDaAba } from "@/lib/os/abas";

const a = (id: string, status: string, dataAgendada: string | null, criadoEm?: string) => ({ id, status, dataAgendada, criadoEm });

describe("ordenarParaPainel", () => {
  it("pela data agendada (a mais cedo primeiro), sem data no fim, canceladas por último", () => {
    const lista = [
      a("c", "AGENDADA", "2026-11-27T14:00:00Z"), a("x", "CANCELADA", "2026-11-20T10:00:00Z"), a("s", "AGENDADA", null),
      a("a", "CONCLUIDA", "2026-11-23T09:00:00Z"), a("b", "EM_ANDAMENTO", "2026-11-25T08:30:00Z"),
    ];
    expect(ordenarParaPainel(lista).map((x) => x.id)).toEqual(["a", "b", "c", "s", "x"]);
  });
  it("empate na data (ou as duas sem data): a ordem de criação; sem criação, a posição na lista — e a entrada não é mexida", () => {
    const lista = [a("2", "AGENDADA", "2026-11-25T08:00:00Z", "2026-11-02T00:00:00Z"), a("1", "AGENDADA", "2026-11-25T08:00:00Z", "2026-11-01T00:00:00Z"), a("3", "AGENDADA", null), a("4", "AGENDADA", null)];
    expect(ordenarParaPainel(lista).map((x) => x.id)).toEqual(["1", "2", "3", "4"]);
    expect(lista.map((x) => x.id)).toEqual(["2", "1", "3", "4"]);
  });
  it("uma cancelada sem data fica depois de uma cancelada com data; data inválida conta como sem data", () => {
    const lista = [a("x", "CANCELADA", null), a("y", "CANCELADA", "2026-11-20T10:00:00Z"), a("z", "AGENDADA", "não é data")];
    expect(ordenarParaPainel(lista).map((x) => x.id)).toEqual(["z", "y", "x"]);
    // a inválida vai para o fim como as sem data, mesmo vindo antes na lista
    expect(ordenarParaPainel([a("ruim", "AGENDADA", "não é data"), a("boa", "AGENDADA", "2026-11-20T10:00:00Z")]).map((x) => x.id)).toEqual(["boa", "ruim"]);
  });
});

describe("observacaoCurta", () => {
  it("vazia, nula ou só espaços = null; curta vem inteira, só com os espaços juntados", () => {
    expect(observacaoCurta(null)).toBeNull();
    expect(observacaoCurta("")).toBeNull();
    expect(observacaoCurta("  \n  ")).toBeNull();
    expect(observacaoCurta("  Levar   a bomba\tde pressão ")).toBe("Levar a bomba de pressão");
    // até o máximo, inteira (sem reticências), por mais perto do limite que esteja
    const noLimite = "a ".repeat(OBSERVACAO_CURTA_MAX / 2).trimEnd();
    expect(noLimite.length).toBe(OBSERVACAO_CURTA_MAX - 1);
    expect(observacaoCurta(noLimite)).toBe(noLimite);
    expect(observacaoCurta("x".repeat(OBSERVACAO_CURTA_MAX))).toBe("x".repeat(OBSERVACAO_CURTA_MAX));
  });
  it("só a primeira linha com conteúdo; corta numa palavra inteira com reticências", () => {
    expect(observacaoCurta("\n\nPrimeira linha.\nSegunda linha.")).toBe("Primeira linha.");
    const longa = "Capacitores já separados no estoque; conferir a nota fiscal antes de sair, e avisar o porteiro do bloco B que a equipe chega às 14h";
    const curta = observacaoCurta(longa)!;
    expect(curta.endsWith("…")).toBe(true);
    expect(curta.length).toBeLessThanOrEqual(OBSERVACAO_CURTA_MAX + 1);
    expect(longa.startsWith(curta.slice(0, -1))).toBe(true);
    expect(curta.slice(0, -1).endsWith(" ")).toBe(false); // sem espaço antes das reticências
    expect(longa[curta.length - 1]).toBe(" "); // cortou exatamente num espaço
  });
  it("uma palavra enorme sem espaço: corta no máximo mesmo", () => {
    expect(observacaoCurta("x".repeat(200), 10)).toBe(`${"x".repeat(10)}…`);
    expect(observacaoCurta("ab ".repeat(50).trim(), 10)).toBe("ab ab ab…");
  });
});

describe("resumoDoPainel", () => {
  it("conta as que não foram canceladas e as concluídas", () => {
    expect(resumoDoPainel([])).toEqual({ total: 0, concluidas: 0, texto: "Nenhuma atividade" });
    expect(resumoDoPainel([{ status: "CANCELADA" }])).toEqual({ total: 0, concluidas: 0, texto: "Nenhuma atividade" });
    expect(resumoDoPainel([{ status: "AGENDADA" }])).toEqual({ total: 1, concluidas: 0, texto: "1 atividade" });
    expect(resumoDoPainel([{ status: "AGENDADA" }, { status: "EM_ANDAMENTO" }])).toEqual({ total: 2, concluidas: 0, texto: "2 atividades" });
    expect(resumoDoPainel([{ status: "CONCLUIDA" }])).toEqual({ total: 1, concluidas: 1, texto: "1 de 1 concluída" });
    expect(resumoDoPainel([{ status: "CONCLUIDA" }, { status: "EM_ANDAMENTO" }, { status: "AGENDADA" }, { status: "AGENDADA" }, { status: "CANCELADA" }]))
      .toEqual({ total: 4, concluidas: 1, texto: "1 de 4 concluídas" });
  });
});

describe("abas da central e o painel", () => {
  it("são 5 abas (Atividades virou painel) e o id do painel é 'atividades'", () => {
    expect(ABAS_OS).toEqual(["resumo", "comercial", "materiais", "financeiro", "relatorios"]);
    expect(PAINEL_ATIVIDADES).toBe("atividades");
  });
  it("num clique: aba conhecida troca a aba; 'atividades'/'formularios' não trocam a aba e levam ao painel; o resto cai na aba que absorveu", () => {
    expect(destinoDaAba("financeiro")).toEqual({ aba: "financeiro", painel: false });
    expect(destinoDaAba("atividades")).toEqual({ aba: null, painel: true });
    expect(destinoDaAba("formularios")).toEqual({ aba: null, painel: true });
    expect(destinoDaAba("prazos")).toEqual({ aba: "resumo", painel: false });
    expect(destinoDaAba("orcamentos")).toEqual({ aba: "comercial", painel: false });
    expect(destinoDaAba("compras")).toEqual({ aba: "materiais", painel: false });
    expect(destinoDaAba("anexos")).toEqual({ aba: "relatorios", painel: false });
    expect(destinoDaAba("xyz")).toEqual({ aba: "resumo", painel: false });
    expect(destinoDaAba(undefined)).toEqual({ aba: "resumo", painel: false });
  });
  it("ao abrir pelo link (?aba=): 'atividades' abre o Resumo E rola até o painel; abaValida dá sempre uma aba", () => {
    expect(destinoDaAba("atividades", true)).toEqual({ aba: "resumo", painel: true });
    expect(destinoDaAba("formularios", true)).toEqual({ aba: "resumo", painel: true });
    expect(destinoDaAba("materiais", true)).toEqual({ aba: "materiais", painel: false });
    expect([undefined, "geral", "historico", "prazos", "formularios", "atividades", "orcamentos", "orcamento", "compras", "anexos", "financeiro", "xyz"].map(abaValida))
      .toEqual(["resumo", "resumo", "resumo", "resumo", "resumo", "resumo", "comercial", "comercial", "materiais", "relatorios", "financeiro", "resumo"]);
  });
});
