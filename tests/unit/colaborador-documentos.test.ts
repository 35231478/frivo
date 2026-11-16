/**
 * DOCUMENTOS DO COLABORADOR — as regras puras.
 *
 * O que se prova:
 *  - as categorias cobrem o que o RH guarda, incluindo o grupo de segurança e medicina do trabalho
 *    (ASO, NR-10, NR-35, NR-13, ficha de EPI, integração), cada uma com id estável e rótulo;
 *  - documento ANTIGO (gravado antes da coluna de categoria) continua legível: mostra o `tipo` como
 *    estava, sem ser reclassificado por adivinhação;
 *  - a validade usa a MESMA conta de dias do resto do sistema: vence hoje ainda vale, venceu ontem
 *    é vermelho, e o aviso de 30 dias é um número só (o da lista de colaboradores);
 *  - o que vem da admissão cai numa gaveta conhecida, e o que a empresa inventou cai em "Outros"
 *    em vez de ser chutado para a gaveta errada.
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORIAS, CATEGORIA_PADRAO, DIAS_AVISO_VALIDADE, NOME_MAX, ROTULO_ORIGEM,
  categoriaDoPedido, categoriasPorGrupo, categoriaValida, categoriaVenceNormalmente,
  formatoEmPalavras, nomePadrao, nomeValido, origemValida, resumoValidade, rotuloCategoria,
  rotuloValidade, situacaoValidade, tamanhoEmPalavras,
} from "@/lib/colaborador/documentos";
import { DIAS_AVISO_COLABORADOR } from "@/lib/colaborador-listagem";

/** 16/11/2026, 09:00 em Brasília (o dia civil é gravado como meia-noite UTC) */
const AGORA = new Date("2026-11-16T12:00:00.000Z");
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("documentos do colaborador: categorias", () => {
  it("tem o grupo de segurança e medicina do trabalho que o cliente pede antes da obra", () => {
    const smt = CATEGORIAS.filter((c) => c.grupo === "SMT").map((c) => c.id);
    expect(smt).toEqual(["aso", "nr_10", "nr_35", "nr_13", "ficha_epi", "integracao"]);
    // os que vencem já nascem marcados: é o que a tela usa para pedir a validade
    expect(CATEGORIAS.find((c) => c.id === "aso")?.venceNormalmente).toBe(true);
    expect(CATEGORIAS.find((c) => c.id === "ficha_epi")?.venceNormalmente).toBeUndefined();
  });

  it("sabe quais gavetas costumam vencer (é o que faz a tela lembrar da validade)", () => {
    for (const id of ["aso", "nr_10", "nr_35", "nr_13", "integracao", "cnh"]) {
      expect(categoriaVenceNormalmente(id), id).toBe(true);
    }
    for (const id of ["contrato", "documento_pessoal", "ficha_epi", "outros", "", null]) {
      expect(categoriaVenceNormalmente(id), String(id)).toBe(false);
    }
  });

  it("cobre contrato, documento pessoal, comprovante de residência, dados bancários e outros", () => {
    for (const id of ["contrato", "documento_pessoal", "comprovante_residencia", "dados_bancarios", "outros"]) {
      expect(categoriaValida(id), id).toBe(true);
    }
    expect(categoriaValida("gaveta_inventada")).toBe(false);
    expect(categoriaValida(null)).toBe(false);
    expect(categoriaValida("")).toBe(false);
  });

  it("os ids não se repetem e todo id tem rótulo (o que vai para o banco é o id)", () => {
    const ids = CATEGORIAS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CATEGORIAS.every((c) => c.rotulo.trim().length > 0)).toBe(true);
    expect(categoriaValida(CATEGORIA_PADRAO)).toBe(true);
  });

  it("agrupadas na ordem da tela, sem perder nem repetir categoria", () => {
    const grupos = categoriasPorGrupo();
    expect(grupos.map((g) => g.grupo)).toEqual(["CONTRATO", "PESSOAL", "SMT", "OUTROS"]);
    expect(grupos.flatMap((g) => g.itens)).toHaveLength(CATEGORIAS.length);
    expect(grupos.every((g) => g.rotulo.trim().length > 0)).toBe(true);
  });
});

describe("documentos do colaborador: o rótulo da categoria", () => {
  it("com categoria, mostra o rótulo dela", () => {
    expect(rotuloCategoria({ categoria: "nr_35", tipo: "nr_35" })).toBe("NR-35");
  });

  it("documento ANTIGO (sem categoria) continua mostrando o que foi gravado, sem adivinhação", () => {
    expect(rotuloCategoria({ categoria: null, tipo: "Certificado NR-35" })).toBe("Certificado NR-35");
    expect(rotuloCategoria({ categoria: null, tipo: "Carteira de Trabalho" })).toBe("Carteira de Trabalho");
    expect(rotuloCategoria({ categoria: "", tipo: "Diploma" })).toBe("Diploma");
  });

  it("categoria que não existe mais na lista aparece como está, e documento sem nada vira Outros", () => {
    expect(rotuloCategoria({ categoria: "gaveta_antiga", tipo: "x" })).toBe("gaveta_antiga");
    expect(rotuloCategoria({ categoria: null, tipo: null })).toBe("Outros");
  });
});

describe("documentos do colaborador: a validade", () => {
  it("sem data não tem selo", () => {
    expect(situacaoValidade(null, AGORA)).toEqual({ situacao: "SEM_VALIDADE", dias: null });
    expect(rotuloValidade(situacaoValidade(null, AGORA))).toBe("");
    expect(situacaoValidade("data-torta", AGORA).situacao).toBe("SEM_VALIDADE");
  });

  it("vence HOJE ainda vale o dia inteiro; a partir de ontem, vencido", () => {
    expect(situacaoValidade(dia("2026-11-16"), AGORA)).toEqual({ situacao: "VENCE_EM_BREVE", dias: 0 });
    expect(rotuloValidade(situacaoValidade(dia("2026-11-16"), AGORA))).toBe("Vence hoje");
    expect(situacaoValidade(dia("2026-11-15"), AGORA)).toEqual({ situacao: "VENCIDO", dias: -1 });
    expect(rotuloValidade(situacaoValidade(dia("2026-11-15"), AGORA))).toBe("Venceu ontem");
    expect(rotuloValidade(situacaoValidade(dia("2026-11-06"), AGORA))).toBe("Vencido há 10 dias");
  });

  it("o aviso é de 30 dias: o 30º dia avisa, o 31º ainda está em dia", () => {
    expect(DIAS_AVISO_VALIDADE).toBe(30);
    expect(situacaoValidade(dia("2026-12-16"), AGORA).situacao).toBe("VENCE_EM_BREVE"); // 30 dias
    expect(situacaoValidade(dia("2026-12-17"), AGORA).situacao).toBe("EM_DIA"); // 31 dias
    expect(rotuloValidade(situacaoValidade(dia("2026-11-17"), AGORA))).toBe("Vence amanhã");
    expect(rotuloValidade(situacaoValidade(dia("2026-11-26"), AGORA))).toBe("Vence em 10 dias");
    expect(rotuloValidade(situacaoValidade(dia("2027-05-01"), AGORA))).toBe("");
  });

  it("é O MESMO número da lista de colaboradores (a ficha e a lista não discordam)", () => {
    expect(DIAS_AVISO_COLABORADOR).toBe(DIAS_AVISO_VALIDADE);
  });

  it("o resumo da ficha conta vencidos e vencendo, e ignora o que está em dia", () => {
    const docs = [
      { dataVencimento: dia("2026-11-15") }, // vencido
      { dataVencimento: dia("2026-10-01") }, // vencido
      { dataVencimento: dia("2026-11-20") }, // vence em breve
      { dataVencimento: dia("2027-10-01") }, // em dia
      { dataVencimento: null }, // sem validade
    ];
    expect(resumoValidade(docs, AGORA)).toEqual({ vencidos: 2, vencendo: 1 });
    expect(resumoValidade([], AGORA)).toEqual({ vencidos: 0, vencendo: 0 });
  });
});

describe("documentos do colaborador: o que vem da admissão", () => {
  it("os documentos padrão do link caem em gavetas conhecidas", () => {
    expect(categoriaDoPedido("rg")).toBe("documento_pessoal");
    expect(categoriaDoPedido("ctps")).toBe("documento_pessoal");
    expect(categoriaDoPedido("comprovante_residencia")).toBe("comprovante_residencia");
    expect(categoriaDoPedido("comprovante_escolaridade")).toBe("escolaridade");
  });

  it("documento que a empresa inventou vai para Outros, não para uma gaveta chutada", () => {
    expect(categoriaDoPedido("certidao_antecedentes")).toBe(CATEGORIA_PADRAO);
    expect(categoriaDoPedido("")).toBe(CATEGORIA_PADRAO);
  });

  it("toda categoria devolvida existe de verdade na lista", () => {
    for (const id of ["rg", "cpf", "ctps", "foto", "titulo_eleitor", "comprovante_residencia", "inventado"]) {
      expect(categoriaValida(categoriaDoPedido(id)), id).toBe(true);
    }
  });

  it("a origem diz quem pôs o papel ali", () => {
    expect(origemValida("MANUAL")).toBe(true);
    expect(origemValida("ADMISSAO")).toBe(true);
    expect(origemValida("QUALQUER")).toBe(false);
    expect(ROTULO_ORIGEM.ADMISSAO).toBe("Enviado na admissão");
  });
});

describe("documentos do colaborador: nome, formato e tamanho", () => {
  it("o nome é obrigatório e tem teto", () => {
    expect(nomeValido("Contrato 2024")).toBe(true);
    expect(nomeValido("   ")).toBe(false);
    expect(nomeValido("")).toBe(false);
    expect(nomeValido(null)).toBe(false);
    expect(nomeValido("x".repeat(NOME_MAX))).toBe(true);
    expect(nomeValido("x".repeat(NOME_MAX + 1))).toBe(false);
  });

  it("sem nome digitado, usa o do arquivo; sem arquivo, o rótulo da categoria", () => {
    expect(nomePadrao("aso", "exame-2026.pdf")).toBe("exame-2026.pdf");
    expect(nomePadrao("aso", "")).toBe("ASO (exame)");
    expect(nomePadrao("gaveta_que_nao_existe", null)).toBe("Outros");
    expect(nomePadrao("outros", "x".repeat(300))).toHaveLength(NOME_MAX);
  });

  it("formato e tamanho em palavras curtas para a linha da lista", () => {
    expect(formatoEmPalavras("application/pdf")).toBe("PDF");
    expect(formatoEmPalavras("image/jpeg")).toBe("JPEG");
    expect(formatoEmPalavras("image/png")).toBe("PNG");
    expect(formatoEmPalavras(null)).toBe("");
    expect(formatoEmPalavras("")).toBe("");

    expect(tamanhoEmPalavras(900)).toBe("900 B");
    expect(tamanhoEmPalavras(245_760)).toBe("240 KB");
    expect(tamanhoEmPalavras(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(tamanhoEmPalavras(null)).toBe("");
    expect(tamanhoEmPalavras(0)).toBe("");
  });
});
