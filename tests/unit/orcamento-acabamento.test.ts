/**
 * Acabamento do documento e da listagem — regras puras:
 *  - forma de pagamento: uma opção da lista (parcelado com 2x a 12x) ou "Outro" com texto; o texto
 *    gravado volta para a mesma escolha; texto antigo abre como "Outro";
 *  - tabela estilo planilha: quantidades e valores alinhados pela vírgula;
 *  - "Não incluso": sugestões de HVAC, sem repetir;
 *  - quando a proposta não pode ser enviada (ícones da lista e rota usam a mesma regra).
 */
import { describe, expect, it } from "vitest";
import {
  FORMAS_PAGAMENTO, OPCAO_OUTRO, PARCELAS_MAX, PARCELAS_MIN, lerFormaPagamento, textoFormaPagamento,
} from "@/lib/orcamentos/forma-pagamento";
import { NAO_INCLUSO_SUGESTOES, NAO_INCLUSO_VISIVEIS, adicionarNaoIncluso, quantidadesAlinhadas, valorSemMoeda } from "@/lib/orcamentos/proposta";
import { MSG_ENVIO_ENCERRADO, MSG_ENVIO_VENCIDO, bloqueioEnvio } from "@/lib/orcamentos/ciclo";

describe("forma de pagamento", () => {
  it("lista rica de climatização/corporativo, uma escolha só; 'Outro' fora da lista", () => {
    expect(FORMAS_PAGAMENTO.map((o) => o.rotulo)).toEqual([
      "À vista", "PIX", "Boleto à vista", "Transferência / TED", "Cartão de crédito", "Cartão de crédito parcelado",
      "Parcelado no boleto", "Entrada + saldo na entrega/conclusão", "Faturado 30 dias", "30/60/90 dias", "Conforme contrato",
    ]);
    expect(FORMAS_PAGAMENTO.filter((o) => o.parcelas).map((o) => o.valor)).toEqual(["CARTAO_PARCELADO", "PARCELADO_BOLETO"]);
    expect(new Set(FORMAS_PAGAMENTO.map((o) => o.valor)).size).toBe(FORMAS_PAGAMENTO.length);
    expect(FORMAS_PAGAMENTO.some((o) => o.valor === OPCAO_OUTRO)).toBe(false);
  });

  it("texto que vai para o documento", () => {
    expect(textoFormaPagamento({ opcao: "", parcelas: 3, outro: "x" })).toBe("");
    expect(textoFormaPagamento({ opcao: "PIX", parcelas: 3, outro: "" })).toBe("PIX");
    expect(textoFormaPagamento({ opcao: "FATURADO_30", parcelas: 9, outro: "" })).toBe("Faturado 30 dias");
    expect(textoFormaPagamento({ opcao: "PARCELADO_BOLETO", parcelas: 6, outro: "" })).toBe("Parcelado no boleto em 6x");
    expect(textoFormaPagamento({ opcao: "CARTAO_PARCELADO", parcelas: 12, outro: "" })).toBe("Cartão de crédito parcelado em 12x");
    // Parcelas sempre entre 2 e 12
    expect(textoFormaPagamento({ opcao: "PARCELADO_BOLETO", parcelas: 1, outro: "" })).toBe("Parcelado no boleto em 2x");
    expect(textoFormaPagamento({ opcao: "PARCELADO_BOLETO", parcelas: 30, outro: "" })).toBe("Parcelado no boleto em 12x");
    expect(textoFormaPagamento({ opcao: "PARCELADO_BOLETO", parcelas: Number.NaN, outro: "" })).toBe("Parcelado no boleto em 3x");
    expect(textoFormaPagamento({ opcao: OPCAO_OUTRO, parcelas: 3, outro: "  40% na aprovação   e 60% em 30 dias " })).toBe("40% na aprovação e 60% em 30 dias");
    expect(textoFormaPagamento({ opcao: OPCAO_OUTRO, parcelas: 3, outro: "x".repeat(250) })).toHaveLength(200);
    expect(textoFormaPagamento({ opcao: "INVENTADA", parcelas: 3, outro: "" })).toBe("");
  });

  it("o texto gravado volta para a mesma escolha (ida e volta)", () => {
    for (const op of FORMAS_PAGAMENTO) {
      const parcelas = op.parcelas ? 7 : 3;
      const texto = textoFormaPagamento({ opcao: op.valor, parcelas, outro: "" });
      expect(lerFormaPagamento(texto), op.valor).toEqual({ opcao: op.valor, parcelas, outro: "" });
    }
    for (let n = PARCELAS_MIN; n <= PARCELAS_MAX; n++) expect(lerFormaPagamento(`Parcelado no boleto em ${n}x`).parcelas).toBe(n);
    expect(lerFormaPagamento("  pix  ")).toEqual({ opcao: "PIX", parcelas: 3, outro: "" }); // maiúsculas/espaços
  });

  it("vazio = não informado; texto antigo/livre (ou parcelas fora de 2–12) abre como 'Outro' com o texto", () => {
    expect(lerFormaPagamento(null)).toEqual({ opcao: "", parcelas: 3, outro: "" });
    expect(lerFormaPagamento("   ")).toEqual({ opcao: "", parcelas: 3, outro: "" });
    expect(lerFormaPagamento("PIX à vista ou boleto em 2x")).toEqual({ opcao: OPCAO_OUTRO, parcelas: 3, outro: "PIX à vista ou boleto em 2x" });
    expect(lerFormaPagamento("Parcelado no boleto em 13x").opcao).toBe(OPCAO_OUTRO);
    expect(lerFormaPagamento("Parcelado no boleto em 1x").opcao).toBe(OPCAO_OUTRO);
    expect(lerFormaPagamento("PIX e boleto").opcao).toBe(OPCAO_OUTRO);
  });
});

describe("tabela estilo planilha", () => {
  it("quantidades alinhadas pela vírgula: tudo inteiro sem casas; com fração, todas com as mesmas casas", () => {
    expect(quantidadesAlinhadas([1, 3, 12])).toEqual(["1", "3", "12"]);
    expect(quantidadesAlinhadas([1, 2.5, 10])).toEqual(["1,0", "2,5", "10,0"]);
    expect(quantidadesAlinhadas([1.25, 3])).toEqual(["1,25", "3,00"]);
    expect(quantidadesAlinhadas([0.1234, 2])).toEqual(["0,123", "2,000"]); // no máximo 3 casas
    expect(quantidadesAlinhadas([1500, 2])).toEqual(["1.500", "2"]);
    expect(quantidadesAlinhadas([])).toEqual([]);
    expect(quantidadesAlinhadas([Number.NaN as number])).toEqual(["0"]);
  });
  it("valores sem 'R$', sempre 2 casas", () => {
    expect(valorSemMoeda(472.5)).toBe("472,50");
    expect(valorSemMoeda(1234567.891)).toBe("1.234.567,89");
    expect(valorSemMoeda(0)).toBe("0,00");
  });
});

describe("Não incluso: sugestões de HVAC", () => {
  it("tem as exclusões comuns de climatização, sem repetir, e as mais usadas primeiro", () => {
    for (const s of [
      "Remoção e descarte do equipamento antigo", "Suportes e mão-francesa", "Tubulação frigorígena além de 3 metros", "Dreno além de 3 metros",
      "Bomba de dreno", "Infraestrutura elétrica além do ponto de força", "Furação em concreto ou alvenaria", "Projeto e ART (quando cobrados à parte)",
      "Içamento ou guindaste", "Andaimes, plataforma elevatória ou equipamento de acesso", "Trabalho noturno, em fim de semana ou feriado",
      "Materiais de acabamento", "Pintura", "Limpeza pós-obra", "Deslocamento fora da região de atendimento",
    ]) expect(NAO_INCLUSO_SUGESTOES, s).toContain(s);
    const chaves = NAO_INCLUSO_SUGESTOES.map((s) => s.toLocaleLowerCase("pt-BR"));
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(NAO_INCLUSO_VISIVEIS).toBe(8);
    expect(NAO_INCLUSO_SUGESTOES.slice(0, 4)).toEqual([
      "Obra civil (alvenaria, forro, pintura e acabamentos)", "Infraestrutura elétrica além do ponto de força",
      "Tubulação frigorígena além de 3 metros", "Dreno além de 3 metros",
    ]);
  });
  it("acrescentar sugestão não duplica e mantém o texto editado", () => {
    const t = adicionarNaoIncluso("Tubulação frigorígena além de 5 metros", "Bomba de dreno");
    expect(t).toBe("Tubulação frigorígena além de 5 metros\nBomba de dreno");
    expect(adicionarNaoIncluso(t, "bomba de DRENO")).toBe(t);
  });
});

describe("bloqueioEnvio (ícones da lista e rota de envio)", () => {
  const agora = new Date("2026-10-15T15:00:00Z");
  const dia = (s: string) => new Date(`${s}T00:00:00Z`);
  it("encerrado ou vencido não envia; rascunho/enviado/recusado dentro da validade, sim", () => {
    for (const status of ["APROVADO", "CANCELADO", "CONVERTIDA"]) expect(bloqueioEnvio({ status, validadeEm: dia("2026-10-20") }, agora)).toBe(MSG_ENVIO_ENCERRADO);
    expect(bloqueioEnvio({ status: "ENVIADO", validadeEm: dia("2026-10-14") }, agora)).toBe(MSG_ENVIO_VENCIDO);
    expect(bloqueioEnvio({ status: "RASCUNHO", validadeEm: dia("2026-10-14") }, agora)).toBe(MSG_ENVIO_VENCIDO);
    for (const status of ["RASCUNHO", "ENVIADO", "REPROVADO"]) expect(bloqueioEnvio({ status, validadeEm: dia("2026-10-15") }, agora)).toBeNull();
    expect(bloqueioEnvio({ status: "RASCUNHO", validadeEm: null }, agora)).toBeNull();
    // Encerrado vence a validade na mensagem
    expect(bloqueioEnvio({ status: "APROVADO", validadeEm: dia("2026-10-01") }, agora)).toBe(MSG_ENVIO_ENCERRADO);
  });
});
