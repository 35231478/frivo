/**
 * COM-1.2 — Comissão sobre CONTRATO, as regras puras (sem banco): a janela de N meses, a precedência (tipo de contrato
 * vence "todos os contratos"; pessoa > cargo > todos; cada base com a sua), o alvo de cada parte (mensalidade recebida,
 * parcial, contrato parado, estorno; o fixo pela 1ª mensalidade), fechamento × renovação, a tela (o que a regra aceita).
 */
import { describe, expect, it } from "vitest";
import {
  alvoDaParte, chaveDoContrato, competencia, competenciaDe, competenciasDaJanela, descricaoDaParte, ehFechamento, ehRenovacao, inicioDoCiclo, ITEM_FIXO,
  mensalidadeCoberta, mesesDaRegra, naJanela, regraDoContrato, rotuloCompetencia, somarCompetencia, valorDaMensalidade,
} from "@/lib/comissoes/contrato";
import { chaveDaRegra, descricaoDaRegra, normalizarRegra, regraSchema, regraVencedora, textoDosMeses, type RegraComissao } from "@/lib/comissoes/regras";

const regra = (p: Partial<RegraComissao> & Pick<RegraComissao, "id">): RegraComissao => ({
  quemTipo: "TODOS", papel: "VENDEDOR", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 5, ativo: true, meses: 3, tipoContrato: null, ...p,
});
const vitor = { usuarioId: "uV", cargoId: "cgV" };

describe("competências e a janela de N meses", () => {
  it("soma meses virando o ano; o rótulo é MM/AAAA; competência de uma data é a do mês (UTC)", () => {
    expect(somarCompetencia("2027-11", 3)).toBe("2028-02");
    expect(somarCompetencia("2027-01", -1)).toBe("2026-12");
    expect(competencia(2027, 3)).toBe("2027-03");
    expect(rotuloCompetencia("2027-03")).toBe("03/2027");
    expect(competenciaDe(new Date("2027-03-31T23:00:00Z"))).toBe("2027-03");
  });

  it("N meses a partir do 1º mês do ciclo, de passo em passo (a periodicidade), sem passar da vigência", () => {
    expect(competenciasDaJanela({ cicloInicio: "2027-11", meses: 3 })).toEqual(["2027-11", "2027-12", "2028-01"]);
    expect(competenciasDaJanela({ cicloInicio: "2027-01", meses: 6, passo: 3 })).toEqual(["2027-01", "2027-04"]);
    expect(competenciasDaJanela({ cicloInicio: "2027-01", meses: 12, ultimaVigente: "2027-03" })).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(competenciasDaJanela({ cicloInicio: "2027-01", meses: 1 })).toEqual(["2027-01"]);
    // 0 = enquanto o contrato estiver ativo: a janela é aberta (as mensalidades entram conforme o contrato cobra)
    expect(competenciasDaJanela({ cicloInicio: "2027-01", meses: 0 })).toBeNull();
  });

  it("naJanela: do 1º mês até o último da janela; antes do ciclo, nunca; N = 0 não tem fim", () => {
    expect(naJanela("2027-01", "2027-01", 3)).toBe(true);
    expect(naJanela("2027-03", "2027-01", 3)).toBe(true);
    expect(naJanela("2027-04", "2027-01", 3)).toBe(false);
    expect(naJanela("2026-12", "2027-01", 3)).toBe(false);
    expect(naJanela("2031-05", "2027-01", 0)).toBe(true);
    expect(naJanela("2026-12", "2027-01", 0)).toBe(false);
  });

  it("a janela da regra: sem valor (ou inválido) vale o padrão 3; 0 é enquanto ativo", () => {
    expect(mesesDaRegra({ meses: null })).toBe(3);
    expect(mesesDaRegra({ meses: 0 })).toBe(0);
    expect(mesesDaRegra({ meses: 12 })).toBe(12);
    expect(mesesDaRegra({ meses: -1 })).toBe(3);
  });
});

describe("a regra que vale para o contrato", () => {
  it("tipo de contrato (específica) vence todos os contratos (geral); no mesmo alvo, pessoa > cargo > todos", () => {
    const geralTodos = regra({ id: "a", valor: 2 });
    const geralCargo = regra({ id: "b", quemTipo: "CARGO", cargoId: "cgV", valor: 3 });
    const tipoTodos = regra({ id: "c", tipoContrato: "MANUTENCAO_PREVENTIVA", valor: 4 });
    const geralPessoa = regra({ id: "d", quemTipo: "PESSOA", usuarioId: "uV", valor: 6 });
    const regras = [geralTodos, geralCargo, tipoTodos, geralPessoa];
    // No contrato de preventiva, a regra do tipo vence até a da pessoa (o "item" manda, como no orçamento)
    expect(regraDoContrato(regras, vitor, "MANUTENCAO_PREVENTIVA", "PERC_MENSALIDADE")?.id).toBe("c");
    // Em outro tipo, a geral: a pessoa vence o cargo, que vence todos
    expect(regraDoContrato(regras, vitor, "LOCACAO", "PERC_MENSALIDADE")?.id).toBe("d");
    expect(regraDoContrato([geralTodos, geralCargo], vitor, "LOCACAO", "PERC_MENSALIDADE")?.id).toBe("b");
    expect(regraDoContrato([geralTodos, geralCargo], { usuarioId: "uX", cargoId: null }, "LOCACAO", "PERC_MENSALIDADE")?.id).toBe("a");
  });

  it("cada base tem a sua precedência (o % das mensalidades e o fixo podem valer juntos)", () => {
    const perc = regra({ id: "p" });
    const fixo = regra({ id: "f", base: "FIXO_CONTRATO", valor: 200 });
    expect(regraDoContrato([perc, fixo], vitor, null, "PERC_MENSALIDADE")?.id).toBe("p");
    expect(regraDoContrato([perc, fixo], vitor, null, "FIXO_CONTRATO")?.id).toBe("f");
    expect(regraDoContrato([perc], vitor, null, "FIXO_CONTRATO")).toBeNull();
  });

  it("não vale: desativada, papel Executor, sobre serviços, de outra pessoa ou de outro cargo", () => {
    for (const r of [
      regra({ id: "x", ativo: false }), regra({ id: "x", papel: "EXECUTOR" }), regra({ id: "x", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA" }),
      regra({ id: "x", quemTipo: "PESSOA", usuarioId: "outro" }), regra({ id: "x", quemTipo: "CARGO", cargoId: "outro" }),
      regra({ id: "x", tipoContrato: "LOCACAO" }),
    ]) expect(regraDoContrato([r], vitor, "MANUTENCAO_PREVENTIVA", "PERC_MENSALIDADE")).toBeNull();
    // Cargo exige o cargo da pessoa (sem cadastro de colaborador, não casa)
    expect(regraDoContrato([regra({ id: "x", quemTipo: "CARGO", cargoId: "cgV" })], { usuarioId: "uV", cargoId: null }, null, "PERC_MENSALIDADE")).toBeNull();
  });

  it("empate de peso (regras repetidas): fica sempre a de menor id", () => {
    expect(regraDoContrato([regra({ id: "z" }), regra({ id: "m" })], vitor, null, "PERC_MENSALIDADE")?.id).toBe("m");
  });

  it("regra de contrato NUNCA vale para item de orçamento ou de OS (nem para peça)", () => {
    const ct = regra({ id: "ct", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 50 });
    expect(regraVencedora([ct], vitor, { tipo: "SERVICO", servicoId: "s", categoria: "x" })).toBeNull();
    expect(regraVencedora([ct], vitor, { tipo: "PRODUTO", servicoId: null, categoria: null })).toBeNull();
    const servico = regra({ id: "sv", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA" });
    expect(regraVencedora([ct, servico], vitor, { tipo: "SERVICO", servicoId: "s", categoria: "x" })?.id).toBe("sv");
  });

  it("a chave da regra separa as bases do contrato e o tipo (não colidem com a de serviço)", () => {
    const base = { papel: "VENDEDOR" as const, quemTipo: "TODOS" as const, usuarioId: null, cargoId: null, sobreTipo: "CONTRATOS" as const, servicoId: null, categoria: null };
    const k1 = chaveDaRegra({ ...base, base: "PERC_MENSALIDADE", tipoContrato: null });
    const k2 = chaveDaRegra({ ...base, base: "FIXO_CONTRATO", tipoContrato: null });
    const k3 = chaveDaRegra({ ...base, base: "PERC_MENSALIDADE", tipoContrato: "LOCACAO" });
    expect(new Set([k1, k2, k3]).size).toBe(3);
    expect(k1).toBe("VENDEDOR|TODOS:*|CONTRATOS:*:PERC_MENSALIDADE");
    expect(chaveDaRegra({ ...base, sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA" })).toBe("VENDEDOR|TODOS:*|TODOS_SERVICOS:*");
  });

  it("a descrição congelada diz o tipo, o % e a janela (ou o fixo no fechamento)", () => {
    expect(descricaoDaRegra(regra({ id: "a", valor: 5, meses: 3 }))).toBe("Todos · Todos os contratos · 5% das mensalidades nos 3 primeiros meses");
    expect(descricaoDaRegra(regra({ id: "a", valor: 2.5, meses: 0, tipoContrato: "LOCACAO", quemTipo: "CARGO", cargoId: "c" }), { cargo: "Vendedores" }))
      .toBe("Vendedores (cargo) · Contratos de Locação · 2,5% das mensalidades enquanto o contrato estiver ativo");
    expect(descricaoDaRegra(regra({ id: "a", base: "FIXO_CONTRATO", valor: 200, quemTipo: "PESSOA", usuarioId: "u" }), { pessoa: "Vitor" }))
      .toBe("Vitor (pessoa) · Todos os contratos · R$ 200,00 no fechamento");
    expect(textoDosMeses(1)).toBe("no 1º mês");
    expect(textoDosMeses(null)).toBe("nos 3 primeiros meses");
  });
});

describe("o que a tela manda (regra de contrato)", () => {
  const ok = (r: object) => regraSchema.safeParse({ quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 5, ...r });
  const erro = (r: object) => { const p = ok(r); return p.success ? null : p.error.errors[0]?.message; };

  it("Contratos aceita só as bases dele; as bases dele só em Contratos", () => {
    expect(ok({}).success).toBe(true);
    expect(ok({ base: "FIXO_CONTRATO", valor: 300 }).success).toBe(true);
    expect(erro({ base: "PERC_VENDA" })).toMatch(/Em contratos, escolha/);
    expect(erro({ base: "FIXO_ITEM" })).toMatch(/Em contratos, escolha/);
    expect(erro({ sobreTipo: "TODOS_SERVICOS" })).toBe("Esta base é só para contratos.");
  });

  it("é do vendedor; o % vai de 0 a 100 (o fixo pode passar de 100); a janela vai de 0 a 120 meses inteiros", () => {
    expect(erro({ papel: "EXECUTOR" })).toBe("Comissão sobre contrato é do vendedor.");
    expect(erro({ valor: 101 })).toBe("O percentual vai de 0 a 100.");
    expect(ok({ base: "FIXO_CONTRATO", valor: 1500 }).success).toBe(true);
    expect(ok({ meses: 0 }).success).toBe(true);
    expect(ok({ meses: 120 }).success).toBe(true);
    expect(ok({ meses: 121 }).success).toBe(false);
    expect(ok({ meses: -1 }).success).toBe(false);
    expect(ok({ meses: 2.5 }).success).toBe(false);
    expect(ok({ tipoContrato: "INEXISTENTE" }).success).toBe(false);
  });

  it("normalizar: o tipo só em Contratos; a janela só no % das mensalidades (padrão 3); o fixo não guarda janela", () => {
    expect(normalizarRegra(regraSchema.parse({ quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 5, tipoContrato: "LOCACAO" })))
      .toMatchObject({ sobreTipo: "CONTRATOS", tipoContrato: "LOCACAO", meses: 3, categoria: null, servicoId: null, divisao: "IGUAL" });
    expect(normalizarRegra(regraSchema.parse({ quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 5, meses: 0 }))).toMatchObject({ meses: 0, tipoContrato: null });
    expect(normalizarRegra(regraSchema.parse({ quemTipo: "TODOS", sobreTipo: "CONTRATOS", base: "FIXO_CONTRATO", valor: 200, meses: 6 }))).toMatchObject({ meses: null });
    expect(normalizarRegra(regraSchema.parse({ quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 2, tipoContrato: "LOCACAO", meses: 6 })))
      .toMatchObject({ tipoContrato: null, meses: null });
  });
});

describe("o alvo de cada parte (o que já é devido)", () => {
  const base = { base: "PERC_MENSALIDADE" as const, taxa: 5, valor: 50, mensalidade: 1000, coberta: true, jaLiberado: 0 };

  it("mensalidade: a taxa sobre o que ENTROU dela (parcial = proporcional), sem passar da mensalidade", () => {
    expect(alvoDaParte({ ...base, recebido: 0 })).toBe(0);
    expect(alvoDaParte({ ...base, recebido: 400 })).toBe(20);
    expect(alvoDaParte({ ...base, recebido: 1000 })).toBe(50);
    expect(alvoDaParte({ ...base, recebido: 1300 })).toBe(50); // recebido a mais não gera comissão a mais
    expect(valorDaMensalidade(5, 1000)).toBe(50);
    expect(valorDaMensalidade(5, -10)).toBe(0);
  });

  it("contrato parado: a mensalidade que não conta mais não libera nada novo, mas estorna se o dinheiro voltar", () => {
    expect(alvoDaParte({ ...base, recebido: 1000, coberta: false, jaLiberado: 0 })).toBe(0);
    expect(alvoDaParte({ ...base, recebido: 1000, coberta: false, jaLiberado: 50 })).toBe(50); // o que já foi liberado fica
    expect(alvoDaParte({ ...base, recebido: 0, coberta: false, jaLiberado: 50 })).toBe(0); // estornada: estorna
  });

  it("fixo no fechamento: o valor × a fração recebida da 1ª mensalidade (mensalidade zero não libera)", () => {
    const fixo = { ...base, base: "FIXO_CONTRATO" as const, valor: 300 };
    expect(alvoDaParte({ ...fixo, recebido: 0 })).toBe(0);
    expect(alvoDaParte({ ...fixo, recebido: 500 })).toBe(150);
    expect(alvoDaParte({ ...fixo, recebido: 1000 })).toBe(300);
    expect(alvoDaParte({ ...fixo, recebido: 5000 })).toBe(300);
    expect(alvoDaParte({ ...fixo, recebido: 100, mensalidade: 0 })).toBe(0);
  });

  it("a mensalidade conta: contrato ativo sempre; parado, só as de antes do mês em que parou", () => {
    expect(mensalidadeCoberta("2031-01", { ativo: true, paradoDesde: null })).toBe(true);
    expect(mensalidadeCoberta("2027-02", { ativo: false, paradoDesde: "2027-03" })).toBe(true);
    expect(mensalidadeCoberta("2027-03", { ativo: false, paradoDesde: "2027-03" })).toBe(false);
    expect(mensalidadeCoberta("2027-01", { ativo: false, paradoDesde: null })).toBe(false);
  });
});

describe("o ciclo: fechamento e renovação", () => {
  it("fecha quando sai de Aguardando assinatura para Ativo; renova quando volta a Ativo de Em renovação ou Vencido", () => {
    expect(ehFechamento("AGUARDANDO_ASSINATURA", "ATIVO")).toBe(true);
    expect(ehFechamento("SUSPENSO", "ATIVO")).toBe(false);
    expect(ehFechamento("AGUARDANDO_ASSINATURA", "CANCELADO")).toBe(false);
    expect(ehRenovacao("EM_RENOVACAO", "ATIVO")).toBe(true);
    expect(ehRenovacao("VENCIDO", "ATIVO")).toBe(true);
    expect(ehRenovacao("SUSPENSO", "ATIVO")).toBe(false);
    expect(ehRenovacao("EM_RENOVACAO", "CANCELADO")).toBe(false);
  });

  it("o 1º mês do ciclo: o mais tarde entre o início e o fechamento (sem retroativo); na renovação, o mês dela", () => {
    const agora = new Date("2027-05-10T12:00:00Z");
    expect(inicioDoCiclo({ renovacao: false, dataInicio: new Date("2027-07-01T12:00:00Z"), agora })).toBe("2027-07");
    expect(inicioDoCiclo({ renovacao: false, dataInicio: new Date("2025-01-01T12:00:00Z"), agora })).toBe("2027-05");
    expect(inicioDoCiclo({ renovacao: true, dataInicio: new Date("2027-07-01T12:00:00Z"), agora })).toBe("2027-05");
  });

  it("a chave e a descrição de cada parte", () => {
    expect(chaveDoContrato("ct1", "2027-05", "2027-06", "uV")).toBe("ct:ct1:2027-05:2027-06:uV");
    expect(descricaoDaParte("2027-06")).toBe("Mensalidade 06/2027");
    expect(descricaoDaParte(ITEM_FIXO)).toBe("Fechamento do contrato");
    expect(descricaoDaParte(ITEM_FIXO, true)).toBe("Renovação do contrato");
  });
});
