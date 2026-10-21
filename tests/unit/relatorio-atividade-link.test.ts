/**
 * Segurança — o token do link público do relatório de atividade (puro, sem banco).
 */
import { describe, expect, it } from "vitest";
import { BYTES_TOKEN_RELATORIO, linkRelatorioAtividade, novoTokenRelatorio, tokenRelatorioNoFormato } from "@/lib/relatorio-atividade-link";

describe("token do relatório de atividade", () => {
  it("token novo: 32 bytes aleatórios em base64url (43 caracteres, sem '='), nunca repete", () => {
    expect(BYTES_TOKEN_RELATORIO).toBe(32);
    const lote = Array.from({ length: 2000 }, () => novoTokenRelatorio());
    expect(lote.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t) && Buffer.from(t, "base64url").length === 32)).toBe(true);
    expect(new Set(lote).size).toBe(2000);
    // usa o alfabeto todo (não é hex nem um uuid disfarçado)
    expect(new Set(lote.join("")).size).toBe(64);
  });

  it("só o formato exato passa (o resto vira 404 sem ir ao banco)", () => {
    const ok = novoTokenRelatorio();
    expect(tokenRelatorioNoFormato(ok)).toBe(true);
    for (const ruim of [undefined, null, "", ok.slice(0, 42), `${ok}A`, `${ok.slice(0, 42)}=`, `${ok.slice(0, 42)}+`, `${ok.slice(0, 42)}/`,
      ` ${ok.slice(1)}`, [ok], [ok, ok], 123, { t: ok }]) {
      expect(tokenRelatorioNoFormato(ruim), String(ruim)).toBe(false);
    }
  });

  it("link: /relatorio/atividade/<id>?t=<token>, com o id escapado", () => {
    expect(linkRelatorioAtividade({ id: "cmabc123", tokenRelatorio: "x".repeat(43) })).toBe(`/relatorio/atividade/cmabc123?t=${"x".repeat(43)}`);
    expect(linkRelatorioAtividade({ id: "a/b?c", tokenRelatorio: "y".repeat(43) })).toBe(`/relatorio/atividade/a%2Fb%3Fc?t=${"y".repeat(43)}`);
  });
});
