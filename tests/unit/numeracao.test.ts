/**
 * Numeração de documentos (lib/numeracao, pura): formato PREFIXO-ANO-SEQ, leitura do sequencial de um
 * número gravado (inclusive parcela "/n"), regex do "maior usado", mínimo permitido, mensagem e o
 * schema do que a tela manda.
 */
import { describe, expect, it } from "vitest";
import {
  formatarNumero, mensagemMinimo, minimoPermitido, NUMERACOES, NUMERO_MAXIMO, proximoNumeroSchema, regexNumero, sequencialDe, TIPOS_NUMERACAO,
} from "@/lib/numeracao";

describe("tipos e formato", () => {
  it("os 10 documentos que geram número, cada um com prefixo e tabela/coluna de onde ler o maior usado (NFS-e fora)", () => {
    expect(TIPOS_NUMERACAO).toEqual(["orcamento", "os", "chamado", "contrato", "medicao", "pedido_compra", "conta_receber", "conta_pagar", "relatorio_os", "qrcode"]);
    expect(Object.values(NUMERACOES).map((d) => d.prefixo)).toEqual(["ORC", "OS", "CHM", "CT", "MED", "PCI", "CR", "CP", "REL", "QR"]);
    expect(NUMERACOES.chamado).toMatchObject({ tabela: "ordens_servico", coluna: "chamado_numero" });
    expect(NUMERACOES.orcamento).toMatchObject({ tabela: "orcamentos", coluna: "codigo" });
    expect(Object.keys(NUMERACOES).some((t) => /nfs|nota/.test(t))).toBe(false);
  });
  it("formata sem ano e sem zeros à esquerda: PREFIXO-NÚMERO", () => {
    expect(formatarNumero("orcamento", 3358)).toBe("ORC-3358");
    expect(formatarNumero("orcamento", 7)).toBe("ORC-7");
    expect(formatarNumero("contrato", 18)).toBe("CT-18");
    expect(formatarNumero("os", 12345)).toBe("OS-12345");
    expect(formatarNumero("medicao", 21)).toBe("MED-21");
    expect(formatarNumero("chamado", 902)).toBe("CHM-902");
  });
});

describe("ler o sequencial de um número gravado", () => {
  it("aceita o formato novo (PREFIXO-N) e o antigo (PREFIXO-AAAA-NNNN, qualquer ano) e a parcela '/n'; recusa outros prefixos e lixo", () => {
    expect(sequencialDe("orcamento", "ORC-3358")).toBe(3358);
    expect(sequencialDe("orcamento", "ORC-2026-0147")).toBe(147);
    expect(sequencialDe("orcamento", "ORC-2024-12345")).toBe(12345);
    expect(sequencialDe("conta_receber", "CR-2026-0042/3")).toBe(42);
    expect(sequencialDe("conta_receber", "CR-112/2")).toBe(112);
    expect(sequencialDe("contrato", "CT-2026-001")).toBe(1);
    expect(sequencialDe("contrato", "CT-18")).toBe(18);
    expect(sequencialDe("conta_receber", "CT-2026-001/202611")).toBeNull(); // cobrança de contrato: não é CR-
    expect(sequencialDe("os", "CHM-2026-0001")).toBeNull();
    expect(sequencialDe("os", "OS-2026-")).toBeNull();
    expect(sequencialDe("os", "OS-")).toBeNull();
    expect(sequencialDe("os", "OS-26-0001")).toBeNull(); // 2 dígitos não é ano nem número solto (seria OS-26-… com segmento a mais)
    expect(sequencialDe("os", null)).toBeNull();
    expect(sequencialDe("os", "")).toBeNull();
  });
  it("a regex do SQL é a mesma do parse (prefixo, ano opcional de 4 dígitos, 1 a 9 dígitos, parcela opcional)", () => {
    expect(regexNumero("conta_receber")).toBe("^CR-([0-9]{4}-)?[0-9]{1,9}(/[0-9]+)?$");
    const re = new RegExp(regexNumero("os"));
    expect(re.test("OS-2026-0001")).toBe(true);
    expect(re.test("OS-9267")).toBe(true);
    expect(re.test("OS-2026-1234567890")).toBe(false);
    expect(re.test("OSX-2026-0001")).toBe(false);
    expect(re.test("OSX-1")).toBe(false);
  });
});

describe("mínimo permitido e mensagem", () => {
  it("o mínimo é sempre o maior usado + 1; a mensagem diz o mínimo e o maior (ou só 1 sem documento)", () => {
    expect(minimoPermitido(0)).toBe(1);
    expect(minimoPermitido(3357)).toBe(3358);
    expect(mensagemMinimo("orcamento", 3357)).toBe("O próximo número de orçamento precisa ser pelo menos 3358: o maior já usado é 3357.");
    expect(mensagemMinimo("os", 0)).toBe("O próximo número de ordem de serviço precisa ser pelo menos 1.");
  });
});

describe("o que a tela manda", () => {
  it("aceita { tipo, proximo inteiro de 1 ao máximo } e recusa o resto (tipo estranho, zero, decimal, texto, campo extra)", () => {
    expect(proximoNumeroSchema.safeParse({ tipo: "orcamento", proximo: 3358 }).success).toBe(true);
    expect(proximoNumeroSchema.safeParse({ tipo: "orcamento", proximo: NUMERO_MAXIMO }).success).toBe(true);
    expect(proximoNumeroSchema.safeParse({ tipo: "nfse", proximo: 1 }).success).toBe(false);
    expect(proximoNumeroSchema.safeParse({ tipo: "orcamento", proximo: 0 }).success).toBe(false);
    expect(proximoNumeroSchema.safeParse({ tipo: "orcamento", proximo: 1.5 }).success).toBe(false);
    expect(proximoNumeroSchema.safeParse({ tipo: "orcamento", proximo: "3358" }).success).toBe(false);
    expect(proximoNumeroSchema.safeParse({ tipo: "orcamento", proximo: NUMERO_MAXIMO + 1 }).success).toBe(false);
    expect(proximoNumeroSchema.safeParse({ tipo: "orcamento", proximo: 2, ano: 2026 }).success).toBe(false);
  });
});
