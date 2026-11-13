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
  alcanceDaEdicao, camposAlterados, motivoDaTrava, rotuloDaEdicao,
  TRAVA_APROVADO, TRAVA_ASSINADA, TRAVA_CONCLUIDA, TRAVA_FATURADO, TRAVA_NOTA,
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
    for (const r of [null, undefined, {}, { statusOs: "EM_ANDAMENTO" }, { statusOrcamento: "RASCUNHO" }, { statusOrcamento: "ENVIADO" }, { aceite: "PENDENTE" }, { faturado: false, notaEmitida: false }, { statusOs: "CANCELADA" }]) {
      expect(motivoDaTrava(r), JSON.stringify(r)).toBeNull();
    }
  });

  it("cada motivo com a sua frase: nota emitida, faturado, OS assinada, OS concluída, orçamento aprovado", () => {
    expect(motivoDaTrava({ notaEmitida: true })).toBe(TRAVA_NOTA);
    expect(motivoDaTrava({ faturado: true })).toBe(TRAVA_FATURADO);
    expect(motivoDaTrava({ aceite: "CONFIRMADO" })).toBe(TRAVA_ASSINADA);
    expect(motivoDaTrava({ statusOs: "CONCLUIDA" })).toBe(TRAVA_CONCLUIDA);
    expect(motivoDaTrava({ statusOrcamento: "APROVADO" })).toBe(TRAVA_APROVADO);
    expect(motivoDaTrava({ statusOrcamento: "CONVERTIDA" })).toBe(TRAVA_APROVADO); // aprovado e já virou OS
    for (const frase of [TRAVA_NOTA, TRAVA_FATURADO, TRAVA_ASSINADA, TRAVA_CONCLUIDA, TRAVA_APROVADO]) expect(frase).toMatch(/não pode mais ser editado\.$/);
    expect(new Set([TRAVA_NOTA, TRAVA_FATURADO, TRAVA_ASSINADA, TRAVA_CONCLUIDA, TRAVA_APROVADO]).size).toBe(5);
  });

  it("mais de um motivo: fica o mais definitivo (nota > faturado > assinada > concluída > orçamento aprovado)", () => {
    const tudo = { notaEmitida: true, faturado: true, aceite: "CONFIRMADO", statusOs: "CONCLUIDA", statusOrcamento: "APROVADO" };
    expect(motivoDaTrava(tudo)).toBe(TRAVA_NOTA);
    expect(motivoDaTrava({ ...tudo, notaEmitida: false })).toBe(TRAVA_FATURADO);
    expect(motivoDaTrava({ ...tudo, notaEmitida: false, faturado: false })).toBe(TRAVA_ASSINADA);
    expect(motivoDaTrava({ statusOs: "CONCLUIDA", statusOrcamento: "APROVADO", aceite: "PENDENTE" })).toBe(TRAVA_CONCLUIDA);
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
