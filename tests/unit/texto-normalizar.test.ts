import { describe, it, expect } from "vitest";
import {
  padronizarNome, padronizarEmail, apararLinha, apararTextoLivre, normalizarTexto, normalizarOpcional,
} from "@/lib/texto/normalizar";

describe("padronizarNome — Nome Próprio a partir de qualquer caixa", () => {
  it("tudo em CAPS, com conectores e sigla (exemplo do pedido)", () => {
    expect(padronizarNome("TERMOFRIO ENGENHARIA E CLIMA LTDA")).toBe("Termofrio Engenharia e Clima Ltda");
  });

  it("tudo minúsculo com conectores", () => {
    expect(padronizarNome("joão da silva")).toBe("João da Silva");
    expect(padronizarNome("maria das graças de souza")).toBe("Maria das Graças de Souza");
  });

  it("misto vira consistente", () => {
    expect(padronizarNome("jOãO dOs SaNtOs")).toBe("João dos Santos");
  });

  it("conector não cai na primeira palavra", () => {
    expect(padronizarNome("das neves imóveis")).toBe("Das Neves Imóveis");
  });

  it("siglas preservadas em maiúsculo", () => {
    expect(padronizarNome("climatização vrf premium")).toBe("Climatização VRF Premium");
    expect(padronizarNome("comercial abc s/a")).toBe("Comercial Abc S/A");
    expect(padronizarNome("joão silva me")).toBe("João Silva ME");
    expect(padronizarNome("TOTAL CLIMA EPP")).toBe("Total Clima EPP");
  });

  it("LTDA tem forma canônica (Ltda), não fica em CAPS", () => {
    expect(padronizarNome("termofrio ltda")).toBe("Termofrio Ltda");
    expect(padronizarNome("TERMOFRIO LTDA")).toBe("Termofrio Ltda");
  });

  it("sigla só pela lista curada: token curto desconhecido vira Nome Próprio (não some)", () => {
    // "ABC" não está na lista → vira "Abc" (preferir nomes certos a adivinhar sigla)
    expect(padronizarNome("loja ABC center")).toBe("Loja Abc Center");
    // já "VRF" está na lista → preservado
    expect(padronizarNome("loja VRF center")).toBe("Loja VRF Center");
  });

  it("nome curto em CAPS NÃO vira sigla (nem em string mista, nem toda em CAPS)", () => {
    expect(padronizarNome("ANA SOUZA")).toBe("Ana Souza");
    expect(padronizarNome("IVO LIMA")).toBe("Ivo Lima");
    expect(padronizarNome("ANA souza")).toBe("Ana Souza");
  });

  it("nomes com hífen", () => {
    expect(padronizarNome("ana-maria DE souza")).toBe("Ana-Maria de Souza");
  });

  it("apara espaços das pontas e do meio", () => {
    expect(padronizarNome("  joão    silva  ")).toBe("João Silva");
  });

  it("vazio/nulo", () => {
    expect(padronizarNome("")).toBe("");
    expect(padronizarNome("   ")).toBe("");
    expect(padronizarNome(null)).toBe("");
    expect(padronizarNome(undefined)).toBe("");
  });

  it("idempotente (rodar de novo não muda)", () => {
    const uma = padronizarNome("TERMOFRIO ENGENHARIA E CLIMA LTDA");
    expect(padronizarNome(uma)).toBe(uma);
  });
});

describe("padronizarEmail", () => {
  it("minúsculo + trim (sem espaços)", () => {
    expect(padronizarEmail("  JOAO@Example.COM ")).toBe("joao@example.com");
    expect(padronizarEmail("Contato @ Empresa.com.BR")).toBe("contato@empresa.com.br");
  });
  it("vazio/nulo", () => {
    expect(padronizarEmail("")).toBe("");
    expect(padronizarEmail(null)).toBe("");
  });
});

describe("apararLinha / apararTextoLivre", () => {
  it("apararLinha: pontas e duplicados no meio", () => {
    expect(apararLinha("  dois   espaços  ")).toBe("dois espaços");
  });

  it("texto livre: só apara, NÃO muda o casing e preserva quebras de linha", () => {
    const entrada = "  Cliente PEDIU   revisão\n\n  linha 2  ";
    const saida = apararTextoLivre(entrada);
    expect(saida).toBe("Cliente PEDIU revisão\n\nlinha 2");
    expect(saida).toContain("PEDIU"); // casing intacto
    expect(saida).toContain("\n\n");  // parágrafo preservado
  });
});

describe("normalizarTexto — despacho por tipo", () => {
  it("cada tipo usa a regra certa", () => {
    expect(normalizarTexto("RUA DAS FLORES, 123 - CENTRO", "endereco")).toBe("Rua das Flores, 123 - Centro");
    expect(normalizarTexto("GOIÂNIA", "cidade")).toBe("Goiânia");
    expect(normalizarTexto("A@B.COM", "email")).toBe("a@b.com");
    expect(normalizarTexto("GERENTE de COMPRAS", "nome")).toBe("Gerente de Compras");
    expect(normalizarTexto("Texto  LIVRE  aqui", "livre")).toBe("Texto LIVRE aqui");
  });

  it("normalizarOpcional preserva nulo e devolve null quando sobra vazio", () => {
    expect(normalizarOpcional(null, "nome")).toBeNull();
    expect(normalizarOpcional(undefined, "nome")).toBeNull();
    expect(normalizarOpcional("   ", "nome")).toBeNull();
    expect(normalizarOpcional("joão", "nome")).toBe("João");
  });
});
