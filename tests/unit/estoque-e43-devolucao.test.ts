/**
 * Estoque E4.3 — devolução da sobra + Portões 2/3: a regra PURA (lib/estoque/separacao, lib/estoque/regras, lib/os/central):
 * o que há a devolver (sobra depois do consumo; reservado de OS cancelada), o plano da devolução e do desfazer, o resumo
 * (devolvidos, a devolver, "material prestado contas"), o texto dos Portões 2/3, a central da OS e o corpo do POST.
 */
import { describe, expect, it } from "vitest";
import { calcularMovimento } from "@/lib/estoque/regras";
import { moduloDaRota } from "@/lib/permissoes";
import { centralDaOs } from "@/lib/os/central";
import {
  aDevolver, devolucaoSchema, pendenteDevolucao, planoDesfazerDevolucao, planoDevolucao, resumoSeparacao, textoPortaoPrestacao,
  type MaterialSeparavel,
} from "@/lib/estoque/separacao";

const M = (id: string, quantidade: number, quantidadeSeparada = 0, estadoSeparacao: MaterialSeparavel["estadoSeparacao"] = null, quantidadeConsumida = 0, extra: Partial<MaterialSeparavel> = {}): MaterialSeparavel =>
  ({ id, produtoId: `p-${id}`, descricao: id, unidade: "un", quantidade, quantidadeSeparada, quantidadeConsumida, estadoSeparacao, consumoInformado: estadoSeparacao === "CONSUMIDO" || estadoSeparacao === "DEVOLVIDO", ...extra });

describe("E4.3 — devolução da sobra (regra pura)", () => {
  it("razão: DEVOLUCAO soma e ESTORNO_DEVOLUCAO tira — os dois ficam no razão como DEVOLUCAO, origem OS; a rota /estoque/devolucao é de quem separa", () => {
    expect(calcularMovimento("DEVOLUCAO", 5, 2)).toEqual({ tipo: "DEVOLUCAO", origem: "OS", delta: 2 });
    expect(calcularMovimento("ESTORNO_DEVOLUCAO", 7, 2)).toEqual({ tipo: "DEVOLUCAO", origem: "OS", delta: -2 });
    expect(moduloDaRota("/estoque/devolucao")).toBeNull();
    expect(moduloDaRota("/estoque/devolucao/os1")).toBeNull();
  });

  it("o que há a devolver: a sobra depois do consumo (separado − consumido − devolvido); na OS cancelada, todo o reservado; nada no separado de OS viva, no devolvido, no sem produto", () => {
    expect(aDevolver(M("a", 5, 5, "CONSUMIDO", 3), false)).toBe(2);
    expect(aDevolver(M("a", 5, 5, "CONSUMIDO", 5), false)).toBe(0);
    expect(aDevolver(M("a", 5, 5, "CONSUMIDO", 7), false)).toBe(0);
    expect(aDevolver(M("a", 5, 5, "SEPARADO"), false)).toBe(0); // consumo ainda não informado: não é sobra
    expect(aDevolver(M("a", 5, 5, "SEPARADO"), true)).toBe(5); // OS cancelada: libera o reservado
    expect(aDevolver(M("a", 5, 2, "SEPARADO"), true)).toBe(2);
    expect(aDevolver(M("a", 5, 5, "CONSUMIDO", 3), true)).toBe(2); // cancelada depois do consumo: a sobra
    expect(aDevolver(M("a", 5, 5, "DEVOLVIDO", 3, { quantidadeDevolvida: 2 }), false)).toBe(0);
    expect(aDevolver(M("a", 5, 0, null), true)).toBe(0);
    expect(aDevolver({ ...M("a", 5, 5, "CONSUMIDO", 3), produtoId: null }, false)).toBe(0);
    expect(pendenteDevolucao(M("a", 5, 5, "CONSUMIDO", 3, { quantidadeDevolvida: 2 }))).toBe(0);
    expect(pendenteDevolucao(M("a", 1, 1, "CONSUMIDO", 0.333))).toBe(0.667);
  });

  it("plano da devolução: devolve tudo o que há a devolver; separado de OS viva pede o consumo antes; já devolvido e nada a devolver são recusados; OS cancelada devolve o reservado", () => {
    expect(planoDevolucao(M("a", 5, 5, "CONSUMIDO", 3), false)).toEqual({ ok: true, quantidade: 2, quantidadeDevolvida: 2 });
    expect(planoDevolucao(M("a", 5, 5, "SEPARADO"), true)).toEqual({ ok: true, quantidade: 5, quantidadeDevolvida: 5 });
    expect(planoDevolucao(M("a", 5, 5, "SEPARADO"), false)).toMatchObject({ ok: false, erro: expect.stringMatching(/Informe o consumo antes/) });
    expect(planoDevolucao(M("a", 5, 5, "CONSUMIDO", 5), false)).toMatchObject({ ok: false, erro: "Nada a devolver." });
    expect(planoDevolucao(M("a", 5, 5, "DEVOLVIDO", 3, { quantidadeDevolvida: 2 }), false)).toMatchObject({ ok: false, erro: expect.stringMatching(/já feita/) });
    expect(planoDevolucao(M("a", 5), false)).toMatchObject({ ok: false, erro: "Nada a devolver." });
    expect(planoDevolucao({ ...M("a", 5, 5, "CONSUMIDO", 3), produtoId: null }, false)).toMatchObject({ ok: false, erro: expect.stringMatching(/sem produto/) });
  });

  it("desfazer a devolução: estorna tudo; volta a CONSUMIDO quando o consumo foi informado, a SEPARADO quando era reserva de OS cancelada; sem devolução não há o que desfazer", () => {
    expect(planoDesfazerDevolucao(M("a", 5, 5, "DEVOLVIDO", 3, { quantidadeDevolvida: 2, consumoInformado: true }))).toEqual({ ok: true, quantidade: 2, estado: "CONSUMIDO" });
    expect(planoDesfazerDevolucao(M("a", 5, 5, "DEVOLVIDO", 0, { quantidadeDevolvida: 5, consumoInformado: false }))).toEqual({ ok: true, quantidade: 5, estado: "SEPARADO" });
    expect(planoDesfazerDevolucao(M("a", 5, 5, "DEVOLVIDO", 0, { quantidadeDevolvida: 0, consumoInformado: true }))).toMatchObject({ ok: false, erro: expect.stringMatching(/sem quantidade/) });
    expect(planoDesfazerDevolucao(M("a", 5, 5, "CONSUMIDO", 3))).toMatchObject({ ok: false, erro: expect.stringMatching(/não feita/) });
  });

  it("resumo: devolvidos, a devolver e 'material prestado contas' (tudo consumido/devolvido sem sobra); OS cancelada não pede consumo e conta o reservado como a devolver", () => {
    expect(resumoSeparacao([M("a", 5, 5, "CONSUMIDO", 3), M("b", 1, 1, "CONSUMIDO", 1)])).toMatchObject({ consumidos: 2, devolvidos: 0, aDevolver: 1, pendentesDevolucao: 1, prestacaoPendente: true, prestado: false });
    expect(resumoSeparacao([M("a", 5, 5, "DEVOLVIDO", 3, { quantidadeDevolvida: 2 }), M("b", 1, 1, "CONSUMIDO", 1)])).toMatchObject({ consumidos: 1, devolvidos: 1, aDevolver: 0, prestacaoPendente: false, prestado: true });
    expect(resumoSeparacao([M("a", 5, 5, "CONSUMIDO", 5)])).toMatchObject({ prestado: true, prestacaoPendente: false }); // sem sobra: nada a devolver
    expect(resumoSeparacao([M("a", 5, 5, "SEPARADO")])).toMatchObject({ consumoPendente: 1, aDevolver: 0, prestado: false, prestacaoPendente: true });
    expect(resumoSeparacao([M("a", 5, 5, "SEPARADO")], true)).toMatchObject({ consumoPendente: 0, aDevolver: 1, prestacaoPendente: true, prestado: false });
    expect(resumoSeparacao([M("a", 5, 5, "DEVOLVIDO", 0, { quantidadeDevolvida: 5 })], true)).toMatchObject({ aDevolver: 0, devolvidos: 1, prestacaoPendente: false, prestado: true });
    expect(resumoSeparacao([M("a", 5), M("b", 1, 1, "CONSUMIDO", 1)])).toMatchObject({ prestado: false }); // um ainda nem separado
    expect(resumoSeparacao([])).toMatchObject({ prestado: false, aDevolver: 0 });
  });

  it("Portões 2/3: o texto junta o consumo não informado e a sobra não devolvida; null quando tudo prestado contas", () => {
    expect(textoPortaoPrestacao([M("Tubo", 5, 5, "CONSUMIDO", 3), M("Cap", 1, 1, "SEPARADO"), M("Gás", 2, 2, "CONSUMIDO", 2)]))
      .toBe("informar o consumo de Cap 1 un e devolver ao estoque Tubo 2 un — aba Materiais & Compras");
    expect(textoPortaoPrestacao([M("Tubo", 5, 5, "CONSUMIDO", 3)])).toBe("devolver ao estoque Tubo 2 un — aba Materiais & Compras");
    expect(textoPortaoPrestacao([M("Tubo", 5, 5, "DEVOLVIDO", 3, { quantidadeDevolvida: 2 }), M("Gás", 2, 2, "CONSUMIDO", 2)])).toBeNull();
    expect(textoPortaoPrestacao([M("Tubo", 5)])).toBeNull(); // nem separado: nada a prestar contas
  });

  it("central da OS: 'Devolver a sobra' entra no que falta (ação com a amarra desligada; alerta 'não fatura' ligada); some quando devolvido", () => {
    const base = { status: "CONCLUIDA", statusManual: false, previsaoConclusao: null, atividades: [{ id: "a1", titulo: "Visita", status: "CONCLUIDA", dataAgendada: null, prazo: null, tecnico: { nome: "Zé" } }], medicoes: [], itensOrcamento: [], orcamentos: [] };
    const pend = (c: ReturnType<typeof centralDaOs>) => c.falta.find((f) => f.chave === "devolucao-material");
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5, 5, "CONSUMIDO", 3), M("b", 2, 2, "CONSUMIDO", 1)] })))
      .toEqual({ chave: "devolucao-material", texto: "Devolver a sobra de 2 materiais ao estoque", aba: "materiais", nivel: "acao" });
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5, 5, "CONSUMIDO", 3)], exigirPrestacaoMaterial: true })))
      .toEqual({ chave: "devolucao-material", texto: "Devolver a sobra de 1 material ao estoque — a OS não fatura sem isso", aba: "materiais", nivel: "alerta" });
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5, 5, "DEVOLVIDO", 3, { quantidadeDevolvida: 2 })], exigirPrestacaoMaterial: true }))).toBeUndefined();
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5, 5, "SEPARADO")], exigirPrestacaoMaterial: true }))).toBeUndefined(); // é consumo pendente, não sobra
  });

  it("corpo do POST da devolução: lista de ids; vazia, campo estranho e id comprido recusados", () => {
    expect(devolucaoSchema.parse({ materiais: ["m1", " m2 "] })).toEqual({ materiais: ["m1", "m2"] });
    expect(devolucaoSchema.safeParse({ materiais: [] }).success).toBe(false);
    expect(devolucaoSchema.safeParse({ materiais: ["m1"], tudo: true }).success).toBe(false);
    expect(devolucaoSchema.safeParse({ materiais: ["x".repeat(41)] }).success).toBe(false);
  });
});
