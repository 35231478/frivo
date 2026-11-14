/**
 * EDITAR NO CONTEXTO — as regras puras (lib/edicao-contexto).
 *
 *  - a interface diz SEMPRE o que está sendo editado: o cadastro-mãe (referência — muda em todo lugar)
 *    ou a linha da transação (uso — muda só ali);
 *  - registro fechado não se edita: nota emitida, faturado, OS assinada ou concluída, orçamento
 *    aprovado pelo cliente — com o motivo dito;
 *  - só vai para o servidor o que mudou.
 */
import { describe, expect, it } from "vitest";
import {
  alcanceDaEdicao, camposAlterados, motivoDaLinhaDaOs, motivoDaLinhaDoOrcamento, motivoDaTrava, numeroDoCampo, numeroParaCampo, rotuloDaEdicao,
  situacaoDaOs, temMaterialMovimentado, type SituacaoDoRegistro,
  TRAVA_APROVADO, TRAVA_ASSINADA, TRAVA_FATURADO, TRAVA_NOTA,
  TRAVA_LINHA_DO_ORCAMENTO, TRAVA_LINHA_EXECUTADA, TRAVA_LINHA_PECA, TRAVA_LINHA_SEPARADA,
  TRAVA_ORCAMENTO_CANCELADO, TRAVA_ORCAMENTO_ENVIADO, TRAVA_ORCAMENTO_REPROVADO,
} from "@/lib/edicao-contexto";

describe("o rótulo do que está sendo editado (regra de ouro)", () => {
  it("REFERÊNCIA: 'Editando o cadastro do cliente' — e a frase diz que vale em todo lugar", () => {
    expect(rotuloDaEdicao("referencia", "do cliente")).toBe("Editando o cadastro do cliente");
    expect(rotuloDaEdicao("referencia", "da categoria de produto")).toBe("Editando o cadastro da categoria de produto");
    expect(rotuloDaEdicao("referencia", "  do tipo de OS ")).toBe("Editando o cadastro do tipo de OS");
    expect(alcanceDaEdicao("referencia")).toBe("Vale em todo lugar onde este cadastro é usado.");
  });

  it("USO: 'Editando este item da OS' — e a frase diz que vale só ali, sem mudar o cadastro", () => {
    expect(rotuloDaEdicao("uso", "este item da OS")).toBe("Editando este item da OS");
    expect(rotuloDaEdicao("uso", "esta linha do orçamento")).toBe("Editando esta linha do orçamento");
    expect(alcanceDaEdicao("uso")).toBe("Vale só aqui. O cadastro não muda.");
  });

  it("os dois escopos nunca dizem a mesma coisa (não dá para confundir cadastro com linha)", () => {
    expect(rotuloDaEdicao("uso", "do cliente")).not.toContain("cadastro");
    expect(alcanceDaEdicao("uso")).not.toBe(alcanceDaEdicao("referencia"));
  });
});

describe("trava de registro fechado", () => {
  it("registro aberto: nada trava", () => {
    for (const r of [null, undefined, {}, { statusOrcamento: "RASCUNHO" }, { statusOrcamento: "ENVIADO" }, { aceite: "PENDENTE" }, { faturado: false, notaEmitida: false }]) {
      expect(motivoDaTrava(r), JSON.stringify(r)).toBeNull();
    }
  });

  it("OS só concluída NÃO é registro fechado: o escritório ainda ajusta os itens antes de faturar", () => {
    // o status da OS nem entra na situação; mesmo se alguém mandar, não trava
    expect(motivoDaTrava({ statusOs: "CONCLUIDA" } as SituacaoDoRegistro)).toBeNull();
    expect(motivoDaTrava({ statusOs: "CONCLUIDA", aceite: "PENDENTE", faturado: false, notaEmitida: false } as SituacaoDoRegistro)).toBeNull();
  });

  it("cada motivo com a sua frase: nota emitida, faturado, OS assinada, orçamento aprovado", () => {
    expect(motivoDaTrava({ notaEmitida: true })).toBe(TRAVA_NOTA);
    expect(motivoDaTrava({ faturado: true })).toBe(TRAVA_FATURADO);
    expect(motivoDaTrava({ aceite: "CONFIRMADO" })).toBe(TRAVA_ASSINADA);
    expect(motivoDaTrava({ statusOrcamento: "APROVADO" })).toBe(TRAVA_APROVADO);
    expect(motivoDaTrava({ statusOrcamento: "CONVERTIDA" })).toBe(TRAVA_APROVADO); // aprovado e já virou OS
    for (const frase of [TRAVA_NOTA, TRAVA_FATURADO, TRAVA_ASSINADA, TRAVA_APROVADO]) expect(frase).toMatch(/não pode mais ser editado\.$/);
    expect(new Set([TRAVA_NOTA, TRAVA_FATURADO, TRAVA_ASSINADA, TRAVA_APROVADO]).size).toBe(4);
  });

  it("mais de um motivo: fica o mais definitivo (nota > faturado > assinada > orçamento aprovado)", () => {
    const tudo = { notaEmitida: true, faturado: true, aceite: "CONFIRMADO", statusOrcamento: "APROVADO" };
    expect(motivoDaTrava(tudo)).toBe(TRAVA_NOTA);
    expect(motivoDaTrava({ ...tudo, notaEmitida: false })).toBe(TRAVA_FATURADO);
    expect(motivoDaTrava({ ...tudo, notaEmitida: false, faturado: false })).toBe(TRAVA_ASSINADA);
    expect(motivoDaTrava({ statusOrcamento: "APROVADO", aceite: "PENDENTE" })).toBe(TRAVA_APROVADO);
  });
});

describe("o que mudou (só isso vai para o servidor)", () => {
  const campos = ["nome", "descricao", "cor"];
  it("compara aparado; campo igual não entra; limpar um campo É uma mudança", () => {
    const antes = { nome: "Preventiva", descricao: "Mensal", cor: "#00aa00" };
    expect(camposAlterados(antes, { ...antes }, campos)).toEqual([]);
    expect(camposAlterados(antes, { ...antes, nome: "  Preventiva  " }, campos)).toEqual([]);
    expect(camposAlterados(antes, { ...antes, nome: "Preventiva mensal" }, campos)).toEqual(["nome"]);
    expect(camposAlterados(antes, { nome: "Preventiva", descricao: "", cor: "#0000ff" }, campos)).toEqual(["descricao", "cor"]);
    expect(camposAlterados({ nome: "A", descricao: null, cor: undefined }, { nome: "A", descricao: "", cor: "" }, campos)).toEqual([]);
  });

  it("só olha os campos do formulário: o que não é campo não vira mudança", () => {
    expect(camposAlterados({ nome: "A", id: "1" }, { nome: "A", id: "2", empresaId: "outra" }, ["nome"])).toEqual([]);
  });
});

/* ───────── Leva 2: a trava nas telas de OS e de orçamento ───────── */

describe("a situação da OS (o que a tela e o servidor sabem dela)", () => {
  it("aceite, fatura e nota viram a situação que a trava entende — o status da OS fica de fora", () => {
    expect(situacaoDaOs({ aceite: { situacao: "PENDENTE" } })).toEqual({ aceite: "PENDENTE", faturado: false, notaEmitida: false });
    expect(situacaoDaOs({ aceite: { situacao: "CONFIRMADO" }, faturada: true, notaEmitida: true })).toEqual({ aceite: "CONFIRMADO", faturado: true, notaEmitida: true });
    expect(situacaoDaOs({})).toEqual({ aceite: null, faturado: false, notaEmitida: false });
    // a OS inteira (como a tela a tem), concluída: o status não passa para a situação
    const osConcluida = { status: "CONCLUIDA", aceite: null, faturada: false, notaEmitida: false };
    expect(situacaoDaOs(osConcluida)).toEqual({ aceite: null, faturado: false, notaEmitida: false });
  });

  it("OS aberta ou só concluída não trava; assinada, faturada e com nota travam — cada uma com o seu motivo", () => {
    const concluida = { status: "CONCLUIDA", aceite: null as { situacao: string } | null };
    expect(motivoDaTrava(situacaoDaOs({ aceite: { situacao: "PENDENTE" } }))).toBeNull();
    expect(motivoDaTrava(situacaoDaOs(concluida))).toBeNull();
    expect(motivoDaTrava(situacaoDaOs({ ...concluida, aceite: { situacao: "PENDENTE" } }))).toBeNull(); // concluída, aguardando o cliente
    expect(motivoDaTrava(situacaoDaOs({ ...concluida, aceite: { situacao: "CONFIRMADO" } }))).toBe(TRAVA_ASSINADA);
    expect(motivoDaTrava(situacaoDaOs({ ...concluida, aceite: { situacao: "CONFIRMADO" }, faturada: true }))).toBe(TRAVA_FATURADO);
    expect(motivoDaTrava(situacaoDaOs({ ...concluida, faturada: true, notaEmitida: true }))).toBe(TRAVA_NOTA);
  });
});

describe("a linha da OS: registro fechado primeiro, depois o motivo da própria linha", () => {
  const aberta = situacaoDaOs({});
  it("linha comum de OS aberta: edita", () => {
    expect(motivoDaLinhaDaOs({}, aberta)).toBeNull();
    expect(motivoDaLinhaDaOs({ materialId: null, orcamentoServicoId: null, executado: false, materialMovimentado: false }, null)).toBeNull();
  });

  it("OS fechada trava TODAS as linhas com o motivo do documento, seja qual for a linha", () => {
    const fechada = situacaoDaOs({ aceite: { situacao: "CONFIRMADO" } });
    for (const linha of [{}, { executado: true }, { materialId: "m1" }, { orcamentoServicoId: "o1" }, { materialMovimentado: true }]) {
      expect(motivoDaLinhaDaOs(linha, fechada), JSON.stringify(linha)).toBe(TRAVA_ASSINADA);
    }
    expect(motivoDaLinhaDaOs({}, situacaoDaOs({ notaEmitida: true }))).toBe(TRAVA_NOTA);
  });

  it("OS aberta: peça derivada, item do orçamento aprovado, item executado e material movimentado — nessa ordem", () => {
    expect(motivoDaLinhaDaOs({ materialId: "m1" }, aberta)).toBe(TRAVA_LINHA_PECA);
    expect(motivoDaLinhaDaOs({ orcamentoServicoId: "o1" }, aberta)).toBe(TRAVA_LINHA_DO_ORCAMENTO);
    expect(motivoDaLinhaDaOs({ executado: true }, aberta)).toBe(TRAVA_LINHA_EXECUTADA);
    expect(motivoDaLinhaDaOs({ materialMovimentado: true }, aberta)).toBe(TRAVA_LINHA_SEPARADA);
    expect(motivoDaLinhaDaOs({ materialId: "m1", orcamentoServicoId: "o1", executado: true, materialMovimentado: true }, aberta)).toBe(TRAVA_LINHA_PECA);
    expect(motivoDaLinhaDaOs({ orcamentoServicoId: "o1", executado: true, materialMovimentado: true }, aberta)).toBe(TRAVA_LINHA_DO_ORCAMENTO);
    expect(motivoDaLinhaDaOs({ executado: true, materialMovimentado: true }, aberta)).toBe(TRAVA_LINHA_EXECUTADA);
    expect(new Set([TRAVA_LINHA_PECA, TRAVA_LINHA_DO_ORCAMENTO, TRAVA_LINHA_EXECUTADA, TRAVA_LINHA_SEPARADA]).size).toBe(4);
  });

  it("material movimentado: separado, consumido ou devolvido contam; zerado não", () => {
    expect(temMaterialMovimentado(null)).toBe(false);
    expect(temMaterialMovimentado([])).toBe(false);
    expect(temMaterialMovimentado([{ quantidadeSeparada: 0, quantidadeConsumida: "0", quantidadeDevolvida: null }])).toBe(false);
    expect(temMaterialMovimentado([{ quantidadeSeparada: 0 }, { quantidadeSeparada: "2.5" }])).toBe(true);
    expect(temMaterialMovimentado([{ quantidadeConsumida: 1 }])).toBe(true);
    expect(temMaterialMovimentado([{ quantidadeDevolvida: 0.001 }])).toBe(true);
  });
});

describe("a linha do orçamento: só o rascunho se edita", () => {
  it("rascunho edita; a peça derivada segue os materiais do serviço", () => {
    expect(motivoDaLinhaDoOrcamento({}, { status: "RASCUNHO" })).toBeNull();
    expect(motivoDaLinhaDoOrcamento({ materialId: null }, { status: "RASCUNHO", faturado: false })).toBeNull();
    expect(motivoDaLinhaDoOrcamento({ materialId: "m1" }, { status: "RASCUNHO" })).toBe(TRAVA_LINHA_PECA);
  });

  it("aprovado, convertido, faturado e com nota são registro fechado", () => {
    expect(motivoDaLinhaDoOrcamento({}, { status: "APROVADO" })).toBe(TRAVA_APROVADO);
    expect(motivoDaLinhaDoOrcamento({}, { status: "CONVERTIDA" })).toBe(TRAVA_APROVADO);
    expect(motivoDaLinhaDoOrcamento({}, { status: "APROVADO", faturado: true })).toBe(TRAVA_FATURADO);
    expect(motivoDaLinhaDoOrcamento({}, { status: "APROVADO", faturado: true, notaEmitida: true })).toBe(TRAVA_NOTA);
    expect(motivoDaLinhaDoOrcamento({ materialId: "m1" }, { status: "APROVADO" })).toBe(TRAVA_APROVADO);
  });

  it("enviado, reprovado e cancelado: a regra de sempre, cada um com a sua frase", () => {
    expect(motivoDaLinhaDoOrcamento({}, { status: "ENVIADO" })).toBe(TRAVA_ORCAMENTO_ENVIADO);
    expect(motivoDaLinhaDoOrcamento({}, { status: "REPROVADO" })).toBe(TRAVA_ORCAMENTO_REPROVADO);
    expect(motivoDaLinhaDoOrcamento({}, { status: "CANCELADO" })).toBe(TRAVA_ORCAMENTO_CANCELADO);
    expect(motivoDaLinhaDoOrcamento({ materialId: "m1" }, { status: "ENVIADO" })).toBe(TRAVA_ORCAMENTO_ENVIADO);
    expect(new Set([TRAVA_ORCAMENTO_ENVIADO, TRAVA_ORCAMENTO_REPROVADO, TRAVA_ORCAMENTO_CANCELADO, TRAVA_APROVADO]).size).toBe(4);
  });
});

describe("número digitado no painel (quantidade e preço)", () => {
  it("lê vírgula decimal, ponto de milhar e o prefixo R$", () => {
    expect(numeroDoCampo("3")).toBe(3);
    expect(numeroDoCampo(" 2,5 ")).toBe(2.5);
    expect(numeroDoCampo("150,00")).toBe(150);
    expect(numeroDoCampo("1.250,50")).toBe(1250.5);
    expect(numeroDoCampo("1.250")).toBe(1250);
    expect(numeroDoCampo("12.345.678,9")).toBe(12345678.9);
    expect(numeroDoCampo("R$ 99,90")).toBe(99.9);
    expect(numeroDoCampo("0")).toBe(0);
    expect(numeroDoCampo("2.5")).toBe(2.5);
    // ponto seguido de três dígitos é milhar, não decimal (o engano que viraria R$ 1,25 no lugar de R$ 1.250)
    expect(numeroDoCampo("1.500")).toBe(1500);
    expect(numeroDoCampo("1.50")).toBe(1.5);
    expect(numeroDoCampo("0,5")).toBe(0.5);
  });

  it("o que não é número não vira zero: devolve null", () => {
    for (const ruim of ["", "   ", "abc", "1o0", "10,5,2", "-5", "1,", ",5", "12 34", null, undefined]) expect(numeroDoCampo(ruim), String(ruim)).toBeNull();
  });

  it("mostra como o campo de texto espera", () => {
    expect(numeroParaCampo(2)).toBe("2");
    expect(numeroParaCampo(1.5)).toBe("1,5");
    expect(numeroParaCampo(150, 2)).toBe("150,00");
    expect(numeroParaCampo(1250.5, 2)).toBe("1250,50");
    expect(numeroDoCampo(numeroParaCampo(1250.5, 2))).toBe(1250.5);
  });
});
