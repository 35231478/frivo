/**
 * NFS-e PR1 — leitura do certificado A1 (.pfx) em memória, com arquivos gerados de verdade:
 * titular, CNPJ do CN, validade, o certificado certo quando vem a cadeia, e os erros em português
 * (senha, arquivo inválido, sem chave, vazio, grande demais) — sem repetir a senha na mensagem.
 */
import { describe, expect, it } from "vitest";
import { ErroCertificado, lerCertificadoA1, TAMANHO_MAX_CERTIFICADO } from "@/lib/nfse/certificado";
import { gerarPfx } from "./helpers/pfx";

const erroDe = (f: () => unknown) => { try { f(); return null; } catch (e) { return e as Error; } };

describe("lerCertificadoA1", () => {
  it("lê titular (sem o CNPJ), CNPJ do CN e validade", () => {
    const ate = new Date("2027-05-10T12:00:00Z"), de = new Date("2026-05-10T12:00:00Z");
    const c = lerCertificadoA1(gerarPfx({ de, ate }), "senha123");
    expect(c).toEqual({ titular: "CLIMA TOTAL REFRIGERACAO LTDA", cnpj: "12345678000190", validoDe: de, validoAte: ate });
  });

  it("com a cadeia (AC antes do titular), pega o certificado da chave privada", () => {
    const c = lerCertificadoA1(gerarPfx({ comCadeia: true }), "senha123");
    expect(c.titular).toBe("CLIMA TOTAL REFRIGERACAO LTDA");
    expect(c.cnpj).toBe("12345678000190");
  });

  it("CN sem CNPJ: titular inteiro e cnpj null; CNPJ só vale no fim depois de ':'", () => {
    expect(lerCertificadoA1(gerarPfx({ cn: "JOAO DA SILVA" }), "senha123")).toMatchObject({ titular: "JOAO DA SILVA", cnpj: null });
    expect(lerCertificadoA1(gerarPfx({ cn: "EMPRESA 12345678000190 LTDA" }), "senha123")).toMatchObject({ cnpj: null });
    expect(lerCertificadoA1(gerarPfx({ cn: "PESSOA:12345678901" }), "senha123")).toMatchObject({ titular: "PESSOA", cnpj: null });
  });

  it("senha errada: mensagem clara e sem a senha", () => {
    const e = erroDe(() => lerCertificadoA1(gerarPfx(), "SenhaErradaXYZ"));
    expect(e).toBeInstanceOf(ErroCertificado);
    expect(e!.message).toBe("Senha do certificado incorreta.");
    expect(e!.message).not.toContain("SenhaErradaXYZ");
  });

  it("arquivo que não é .pfx, vazio, grande demais ou sem a chave privada", () => {
    expect(erroDe(() => lerCertificadoA1(Buffer.from("isto não é um pfx"), "x"))?.message).toBe("Arquivo inválido: envie o certificado A1 no formato .pfx ou .p12.");
    expect(erroDe(() => lerCertificadoA1(Buffer.alloc(0), "x"))?.message).toBe("O arquivo do certificado está vazio.");
    expect(erroDe(() => lerCertificadoA1(Buffer.alloc(TAMANHO_MAX_CERTIFICADO + 1, 1), "x"))?.message).toBe("Arquivo grande demais para um certificado A1 (.pfx).");
    expect(erroDe(() => lerCertificadoA1(Buffer.alloc(TAMANHO_MAX_CERTIFICADO, 1), "x"))?.message).toBe("Arquivo inválido: envie o certificado A1 no formato .pfx ou .p12.");
    expect(erroDe(() => lerCertificadoA1(gerarPfx({ semChave: true }), "senha123"))?.message).toBe("O arquivo não tem a chave privada: exporte o certificado A1 completo (.pfx com chave).");
  });
});
