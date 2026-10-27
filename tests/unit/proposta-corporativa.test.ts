/**
 * Proposta corporativa — regras puras do documento (lib/orcamentos/proposta.ts) e dos campos que o
 * servidor grava (lib/orcamento-helpers.ts): número formal, normas, "Não incluso", condições com
 * garantias, ART, validade padrão, timbre da empresa, "Para:" do cliente e a ordem dos anexos.
 */
import { describe, expect, it } from "vitest";
import {
  adicionarNaoIncluso, codigoOrcamento, destinatarioOrcamento, diasValidadeValidos, enderecoEmLinha, linhasCondicoes,
  linhasNaoIncluso, NAO_INCLUSO_SUGESTOES, NORMAS, normasDoDocumento, normasValidas, NOTA_ART_APOS_APROVACAO,
  numeroFormalOrcamento, textoArt, timbreEmpresa,
} from "@/lib/orcamentos/proposta";
import { camposCondicoes, montarCamposProposta } from "@/lib/orcamento-helpers";
import { ordenarAnexos, tipoAnexoPorMime } from "@/lib/orcamentos/anexos-server";
import { orcamentoSchema } from "@/lib/validations";

describe("número formal do orçamento", () => {
  it("ORC-AAAA-NNNN → AAAA-NNNN; código fora do padrão sai como está", () => {
    expect(numeroFormalOrcamento("ORC-2026-0147")).toBe("2026-0147");
    expect(numeroFormalOrcamento("ORC-2027-12345")).toBe("2027-12345");
    expect(numeroFormalOrcamento("PROP-77")).toBe("PROP-77");
  });
  it("código pelo ano e sequencial: 4 dígitos, cresce depois de 9999", () => {
    expect(codigoOrcamento(2026, 1)).toBe("ORC-2026-0001");
    expect(codigoOrcamento(2026, 147)).toBe("ORC-2026-0147");
    expect(codigoOrcamento(2026, 10000)).toBe("ORC-2026-10000");
  });
});

describe("normas atendidas", () => {
  it("as três normas, com título e descrição", () => {
    expect(NORMAS.map((n) => n.codigo)).toEqual(["NBR_16401", "NBR_13971", "PMOC"]);
    expect(NORMAS.find((n) => n.codigo === "PMOC")!.titulo).toContain("13.589/2018");
  });
  it("só códigos conhecidos, sem repetir, na ordem da lista", () => {
    expect(normasValidas(["PMOC", "XPTO", "NBR_16401", "PMOC"])).toEqual(["NBR_16401", "PMOC"]);
    expect(normasValidas(null)).toEqual([]);
    expect(normasDoDocumento(["PMOC"]).map((n) => n.titulo)).toEqual(["PMOC — Lei nº 13.589/2018"]);
  });
});

describe("não incluso", () => {
  it("uma exclusão por linha: sem vazias, sem marcador, sem repetir (ignora maiúsculas)", () => {
    expect(linhasNaoIncluso("- Obra civil\n\n• Andaimes\n  obra CIVIL  \n* Taxas")).toEqual(["Obra civil", "Andaimes", "Taxas"]);
    expect(linhasNaoIncluso(null)).toEqual([]);
  });
  it("sugestão acrescenta uma linha; repetida não duplica", () => {
    const s = NAO_INCLUSO_SUGESTOES[0];
    expect(adicionarNaoIncluso("", s)).toBe(s);
    expect(adicionarNaoIncluso("Taxas  ", s)).toBe(`Taxas\n${s}`);
    expect(adicionarNaoIncluso(`Taxas\n${s.toUpperCase()}`, s)).toBe(`Taxas\n${s.toUpperCase()}`);
  });
});

describe("condições, ART e validade", () => {
  it("condições na ordem do comprador; só as preenchidas", () => {
    const l = linhasCondicoes({ prazoExecucao: "5 dias úteis", formaPagamento: " ", garantiaServico: "90 dias", garantiaPecas: "Conforme fabricante", validadeEm: "05/11/2026" });
    expect(l.map((x) => `${x.rotulo}: ${x.valor}`)).toEqual([
      "Prazo de execução dos serviços: 5 dias úteis", "Garantia dos serviços: 90 dias", "Garantia das peças: Conforme fabricante", "Validade da proposta: 05/11/2026",
    ]);
    expect(linhasCondicoes({})).toEqual([]);
  });
  it("ART: número quando há; senão a nota padrão", () => {
    expect(textoArt(" 2620261234567 ")).toBe("ART nº 2620261234567");
    expect(textoArt("")).toBe(NOTA_ART_APOS_APROVACAO);
    expect(NOTA_ART_APOS_APROVACAO).toBe("ART emitida após aprovação");
  });
  it("validade padrão em dias: 1 a 365; inválido = 10", () => {
    expect(diasValidadeValidos(15)).toBe(15);
    expect([0, 366, "x", null, 2.9].map((v) => diasValidadeValidos(v))).toEqual([10, 10, 10, 10, 2]);
  });
});

describe("timbre e destinatário", () => {
  const fmt = { doc: (d: string) => `[${d}]`, tel: (t: string) => `(${t})` };
  it("timbre: fantasia em destaque, razão social, CNPJ · IE · IM, endereço e contatos (só o preenchido)", () => {
    const t = timbreEmpresa({
      nome: "Clima Total Refrigeração Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", inscricaoEstadual: "123.456", inscricaoMunicipal: " ",
      telefone: "1133334444", celular: "11999998888", email: "contato@ct.com.br", site: "https://www.ct.com.br/",
      endereco: "Av. Paulista", numero: "1000", cidade: "São Paulo", estado: "SP", cep: "01310-100",
    }, fmt);
    expect(t).toEqual({
      titulo: "Clima Total", razaoSocial: "Clima Total Refrigeração Ltda", documentos: "CNPJ [12345678000190] · IE 123.456",
      endereco: "Av. Paulista, 1000 — São Paulo/SP — CEP 01310-100", contato: "Tel. (1133334444) / (11999998888) · contato@ct.com.br · www.ct.com.br",
    });
    expect(timbreEmpresa({ nome: "Só Razão", cnpj: "1" }).razaoSocial).toBeNull();
  });
  it("Para: contato A/C escolhido e endereço da unidade; sem eles, contato e endereço do cliente", () => {
    const cliente = { nome: "Hospital Santa Clara S/A", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "22101333000111", inscricaoEstadual: "ISENTO",
      contato: "Recepção", telefone: "3133334444", email: "geral@hsc.com.br", endereco: "Rua A", numero: "10", cidade: "BH", estado: "MG" };
    const d = destinatarioOrcamento(cliente, { nome: "Matriz", logradouro: "Av. Afonso Pena", numero: "2300", cidade: "Belo Horizonte", estado: "MG" },
      { nome: "Juliana Ramos", cargo: "Compras", email: "compras@hsc.com.br", telefone: null, whatsapp: "31988887777" }, fmt);
    expect(d).toEqual({
      razaoSocial: "Hospital Santa Clara S/A", nomeFantasia: "Hospital Santa Clara", documentos: "CNPJ [22101333000111] · IE ISENTO",
      aosCuidados: "Juliana Ramos (Compras)", contato: "(31988887777) · compras@hsc.com.br", unidade: "Matriz", endereco: "Av. Afonso Pena, 2300 — Belo Horizonte/MG",
    });
    const sem = destinatarioOrcamento(cliente, null, null, fmt);
    expect([sem.aosCuidados, sem.contato, sem.unidade, sem.endereco]).toEqual(["Recepção", "(3133334444) · geral@hsc.com.br", null, "Rua A, 10 — BH/MG"]);
    // Unidade sem endereço cadastrado: o endereço do cliente
    expect(destinatarioOrcamento(cliente, { nome: "Bloco B" }, null).endereco).toBe("Rua A, 10 — BH/MG");
    // Pessoa física: CPF
    expect(destinatarioOrcamento({ nome: "João", cpfCnpj: "12345678901" }, null, null).documentos).toBe("CPF 12345678901");
  });
  it("endereço em linha: só as partes preenchidas", () => {
    expect(enderecoEmLinha({ endereco: "Rua X", complemento: "Sala 2", bairro: "Centro", cidade: "Recife" })).toBe("Rua X — Sala 2 — Centro — Recife");
    expect(enderecoEmLinha({})).toBe("");
  });
});

describe("campos gravados pelo servidor", () => {
  const base = (extra: Record<string, unknown> = {}) => orcamentoSchema.parse({ clienteId: "c1", ...extra });
  it("campo que não veio usa a base (padrões no novo / gravado na edição); null ou vazio apaga", () => {
    const padroes = { garantiaServico: "90 dias", garantiaPecas: "Conforme fabricante", naoIncluso: "Obra civil", normas: ["PMOC"] };
    expect(camposCondicoes(base(), padroes)).toMatchObject({ garantiaServico: "90 dias", garantiaPecas: "Conforme fabricante", naoIncluso: "Obra civil", normas: ["PMOC"] });
    expect(camposCondicoes(base({ garantiaServico: null, garantiaPecas: "  ", naoIncluso: "", normas: [] }), padroes))
      .toMatchObject({ garantiaServico: null, garantiaPecas: null, naoIncluso: null, normas: [] });
  });
  it("normaliza: garantias aparadas, não incluso por linha, normas válidas", () => {
    expect(camposCondicoes(base({ garantiaServico: " 6 meses ", naoIncluso: "- Taxas\n\n- taxas\nAndaimes", normas: ["PMOC", "NBR_13971", "X"] })))
      .toMatchObject({ garantiaServico: "6 meses", naoIncluso: "Taxas\nAndaimes", normas: ["NBR_13971", "PMOC"] });
  });
  it("garantia com mais de 200 caracteres é recusada", () => {
    expect(orcamentoSchema.safeParse({ clienteId: "c1", garantiaServico: "x".repeat(201) }).success).toBe(false);
  });
  it("RT e ART valem também no orçamento comum", () => {
    expect(montarCamposProposta(base({ tipo: "COMUM", responsavelTecnicoId: "rt1", artNumero: " 123 " }))).toMatchObject({ tipo: "COMUM", responsavelTecnicoId: "rt1", artNumero: "123" });
    expect(montarCamposProposta(base({ tipo: "COMUM" }))).toMatchObject({ responsavelTecnicoId: null, artNumero: null });
  });
});

describe("anexos da proposta", () => {
  it("imagem = FOTO (registro fotográfico); o resto = ARQUIVO", () => {
    expect(["image/jpeg", "image/png", "application/pdf"].map(tipoAnexoPorMime)).toEqual(["FOTO", "FOTO", "ARQUIVO"]);
  });
  it("fotos primeiro, na ordem em que entraram; depois os arquivos", () => {
    const d = (s: number) => new Date(2026, 0, 1, 0, 0, s);
    const l = ordenarAnexos([
      { id: "pdf", tipo: "ARQUIVO", ordem: 0, criadoEm: d(1) },
      { id: "f2", tipo: "FOTO", ordem: 2, criadoEm: d(2) },
      { id: "f1", tipo: "FOTO", ordem: 1, criadoEm: d(3) },
    ]);
    expect(l.map((a) => a.id)).toEqual(["f1", "f2", "pdf"]);
  });
});
