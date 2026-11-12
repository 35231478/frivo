/**
 * Estoque E4.2 — consumo de material + Portão 1: a regra PURA (lib/estoque/separacao, lib/estoque/regras, lib/os/central):
 * o plano do consumo sem dupla contagem (estorno da reserva + saída), a baixa a mais, a sobra pendente de devolução,
 * desfazer, o texto do Portão 1, o resumo (consumo pendente / sobras / prestação pendente), a central da OS (aviso com a
 * amarra desligada, trava com ela ligada) e o corpo do POST.
 */
import { describe, expect, it } from "vitest";
import { calcularMovimento } from "@/lib/estoque/regras";
import { centralDaOs } from "@/lib/os/central";
import {
  consumoSchema, mensagemSeparacao, pendenteDevolucao, planoConsumo, planoDesfazerConsumo, resumoSeparacao, semConsumoInformado, situacaoDoMaterial, textoPortaoConsumo,
  type MaterialSeparavel,
} from "@/lib/estoque/separacao";

const M = (id: string, quantidade: number, quantidadeSeparada = 0, estadoSeparacao: MaterialSeparavel["estadoSeparacao"] = null, quantidadeConsumida = 0, produtoId: string | null = `p-${id}`): MaterialSeparavel =>
  ({ id, produtoId, descricao: id, unidade: "un", quantidade, quantidadeSeparada, quantidadeConsumida, estadoSeparacao });

describe("E4.2 — consumo de material (regra pura)", () => {
  it("razão: SAIDA subtrai e ESTORNO_SAIDA devolve — os dois ficam no razão como SAIDA, origem OS", () => {
    expect(calcularMovimento("SAIDA", 10, 3)).toEqual({ tipo: "SAIDA", origem: "OS", delta: -3 });
    expect(calcularMovimento("ESTORNO_SAIDA", 7, 3)).toEqual({ tipo: "SAIDA", origem: "OS", delta: 3 });
  });

  it("plano do consumo sem dupla contagem: consumido = separado → estorno da reserva + saída (líquido zero); menos → sobra pendente de devolução; mais → saída a mais; não separado → só saída", () => {
    expect(planoConsumo(M("a", 5, 5, "SEPARADO"), 5)).toEqual({ ok: true, estorno: 5, saida: 5, quantidadeConsumida: 5, pendenteDevolucao: 0 });
    expect(planoConsumo(M("a", 5, 5, "SEPARADO"), 3)).toEqual({ ok: true, estorno: 3, saida: 3, quantidadeConsumida: 3, pendenteDevolucao: 2 });
    expect(planoConsumo(M("a", 5, 5, "SEPARADO"), 7)).toEqual({ ok: true, estorno: 5, saida: 7, quantidadeConsumida: 7, pendenteDevolucao: 0 });
    expect(planoConsumo(M("a", 5, 2, "SEPARADO"), 0)).toEqual({ ok: true, estorno: 0, saida: 0, quantidadeConsumida: 0, pendenteDevolucao: 2 });
    expect(planoConsumo(M("a", 5), 2)).toEqual({ ok: true, estorno: 0, saida: 2, quantidadeConsumida: 2, pendenteDevolucao: 0 });
    expect(planoConsumo(M("a", 1, 0.5, "SEPARADO"), 0.333)).toEqual({ ok: true, estorno: 0.333, saida: 0.333, quantidadeConsumida: 0.333, pendenteDevolucao: 0.167 });
    // Limites
    expect(planoConsumo(M("a", 5), 0)).toMatchObject({ ok: false, erro: expect.stringMatching(/Nada a baixar/) });
    expect(planoConsumo(M("a", 5, 5, "CONSUMIDO", 5), 1)).toMatchObject({ ok: false, erro: expect.stringMatching(/já informado/) });
    expect(planoConsumo(M("a", 5, 5, "DEVOLVIDO", 5), 1)).toMatchObject({ ok: false, erro: expect.stringMatching(/já devolvido/) });
    expect(planoConsumo(M("a", 5, 5, "SEPARADO"), -1)).toMatchObject({ ok: false, erro: expect.stringMatching(/negativa/) });
    expect(planoConsumo(M("a", 5, 5, "SEPARADO"), 1.0005)).toMatchObject({ ok: false, erro: expect.stringMatching(/3 casas/) });
    expect(planoConsumo(M("a", 5, 5, "SEPARADO", 0, null), 1)).toMatchObject({ ok: false, erro: expect.stringMatching(/sem produto/) });
  });

  it("desfazer: estorna a saída inteira e volta à reserva só o que estava separado; estado volta a SEPARADO (ou nada, se não havia separação)", () => {
    expect(planoDesfazerConsumo(M("a", 5, 5, "CONSUMIDO", 5))).toEqual({ ok: true, estornoSaida: 5, reserva: 5, estado: "SEPARADO" });
    expect(planoDesfazerConsumo(M("a", 5, 5, "CONSUMIDO", 3))).toEqual({ ok: true, estornoSaida: 3, reserva: 3, estado: "SEPARADO" });
    expect(planoDesfazerConsumo(M("a", 5, 5, "CONSUMIDO", 7))).toEqual({ ok: true, estornoSaida: 7, reserva: 5, estado: "SEPARADO" });
    expect(planoDesfazerConsumo(M("a", 5, 0, "CONSUMIDO", 2))).toEqual({ ok: true, estornoSaida: 2, reserva: 0, estado: null });
    expect(planoDesfazerConsumo(M("a", 5, 5, "SEPARADO"))).toMatchObject({ ok: false, erro: expect.stringMatching(/não informado/) });
  });

  it("estado por material: consumido com sobra = pendente de devolução; sem consumo informado = o que o Portão 1 olha; resumo conta tudo", () => {
    expect(pendenteDevolucao(M("a", 5, 5, "CONSUMIDO", 3))).toBe(2);
    expect(pendenteDevolucao(M("a", 5, 5, "CONSUMIDO", 5))).toBe(0);
    expect(pendenteDevolucao(M("a", 5, 5, "CONSUMIDO", 7))).toBe(0);
    expect(pendenteDevolucao(M("a", 5, 5, "SEPARADO"))).toBe(0); // ainda não é sobra: o consumo não foi informado
    expect(situacaoDoMaterial(M("a", 5, 5, "CONSUMIDO", 3))).toBe("consumido");
    const ms = [M("a", 5, 5, "SEPARADO"), M("b", 1, 1, "CONSUMIDO", 1), M("c", 4, 4, "CONSUMIDO", 2), M("d", 2), M("e", 0, 0, "SEPARADO"), M("f", 3, 3, "SEPARADO", 0, null)];
    expect(semConsumoInformado(ms).map((m) => m.id)).toEqual(["a"]); // e: quantidade 0; f: sem produto
    expect(resumoSeparacao(ms)).toMatchObject({ consumoPendente: 1, consumidos: 2, pendentesDevolucao: 1, prestacaoPendente: true, aSeparar: 1 });
    // Tudo consumido sem sobra: nada pendente de prestação
    expect(resumoSeparacao([M("a", 5, 5, "CONSUMIDO", 5), M("b", 1, 1, "CONSUMIDO", 2)])).toMatchObject({ consumoPendente: 0, consumidos: 2, pendentesDevolucao: 0, prestacaoPendente: false, situacao: "completa" });
    // Sobra sem devolução: prestação continua pendente (Portão 2, E4.3)
    expect(resumoSeparacao([M("a", 5, 5, "CONSUMIDO", 3)])).toMatchObject({ consumoPendente: 0, pendentesDevolucao: 1, prestacaoPendente: true });
  });

  it("Portão 1: o texto do que falta lista cada material separado sem consumo (quantidade separada); null quando nada falta", () => {
    expect(textoPortaoConsumo([M("Tubo", 5, 5, "SEPARADO"), M("Cap", 1, 1, "CONSUMIDO", 1), M("Gás", 2, 1.5, "SEPARADO")]))
      .toBe("informar o consumo do material separado (Tubo 5 un, Gás 1,5 un) — aba Materiais & Compras");
    expect(textoPortaoConsumo([M("Cap", 1, 1, "CONSUMIDO", 1), M("Tubo", 5)])).toBeNull();
    expect(textoPortaoConsumo([])).toBeNull();
  });

  it("central da OS: com a amarra DESLIGADA só lembra (ação); LIGADA, avisa que a OS não conclui (alerta); nada quando tudo informado; some na OS cancelada", () => {
    const base = { status: "EM_ANDAMENTO", statusManual: false, previsaoConclusao: null, atividades: [{ id: "a1", titulo: "Visita", status: "EM_ANDAMENTO", dataAgendada: null, prazo: null, tecnico: { nome: "Zé" } }], medicoes: [], itensOrcamento: [], orcamentos: [] };
    const pend = (c: ReturnType<typeof centralDaOs>) => c.falta.find((f) => f.chave === "consumo-material");
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5, 5, "SEPARADO"), M("b", 1, 1, "SEPARADO")] })))
      .toEqual({ chave: "consumo-material", texto: "Informar o consumo de 2 materiais separados", aba: "materiais", nivel: "acao" });
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5, 5, "SEPARADO")], exigirPrestacaoMaterial: true })))
      .toEqual({ chave: "consumo-material", texto: "Informar o consumo de 1 material separado — a OS não conclui sem isso", aba: "materiais", nivel: "alerta" });
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5, 5, "CONSUMIDO", 3)], exigirPrestacaoMaterial: true }))).toBeUndefined();
    expect(pend(centralDaOs({ ...base, materiais: [M("a", 5)], exigirPrestacaoMaterial: true }))).toBeUndefined(); // nem separado
    expect(pend(centralDaOs({ ...base }))).toBeUndefined();
    expect(pend(centralDaOs({ ...base, status: "CANCELADA", materiais: [M("a", 5, 5, "SEPARADO")], exigirPrestacaoMaterial: true }))).toBeUndefined();
  });

  it("corpo do POST do consumo: quantidade por material (aceita vírgula); lista vazia, campo estranho e quantidade em branco recusados", () => {
    expect(consumoSchema.parse({ materiais: [{ id: "m1", quantidade: "1,5" }, { id: "m2", quantidade: 0 }] })).toEqual({ materiais: [{ id: "m1", quantidade: 1.5 }, { id: "m2", quantidade: 0 }] });
    const branco = consumoSchema.safeParse({ materiais: [{ id: "m1", quantidade: "" }] });
    expect(branco.success).toBe(false);
    if (!branco.success) expect(mensagemSeparacao(branco.error)).toBe("Informe a quantidade consumida.");
    expect(consumoSchema.safeParse({ materiais: [] }).success).toBe(false);
    const estranho = consumoSchema.safeParse({ materiais: [{ id: "m1", quantidade: 1, saida: 2 }] });
    expect(estranho.success).toBe(false);
    if (!estranho.success) expect(mensagemSeparacao(estranho.error)).toBe("Campo não permitido: saida.");
  });
});
