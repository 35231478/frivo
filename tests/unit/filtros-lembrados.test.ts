/**
 * Filtros lembrados das listas (lib/listagem/filtros-lembrados) — a regra pura: a chave por empresa, usuário e
 * tela; a página não volta; só o guardado HOJE (Brasília) volta; o guardado torto nunca quebra a lista.
 */
import { describe, expect, it } from "vitest";
import { abriuLimpa, chaveFiltrosLembrados, filtroDeHoje, lembrado, paraLembrar } from "@/lib/listagem/filtros-lembrados";

const HOJE = "2026-11-27";

describe("filtros lembrados", () => {
  it("a chave separa empresa, usuário e tela", () => {
    expect(chaveFiltrosLembrados("e1", "u1", "ordens")).toBe("frivo:filtros:e1:u1:ordens");
    expect(new Set([chaveFiltrosLembrados("e1", "u1", "ordens"), chaveFiltrosLembrados("e2", "u1", "ordens"), chaveFiltrosLembrados("e1", "u2", "ordens"), chaveFiltrosLembrados("e1", "u1", "contratos")]).size).toBe(4);
  });
  it("guarda a query toda menos a página (volta-se à 1ª)", () => {
    expect(paraLembrar("mes=2026-10&status=AGENDADA&pagina=3&por=50&sort=numero&dir=asc&q=bom")).toBe("mes=2026-10&status=AGENDADA&por=50&sort=numero&dir=asc&q=bom");
    expect(paraLembrar("pagina=2")).toBe("");
    expect(JSON.parse(lembrado("periodo=todos&pagina=2", HOJE))).toEqual({ q: "periodo=todos", dia: HOJE });
  });
  it("só o de hoje volta; de outro dia, vazio ou torto: a lista abre no padrão", () => {
    expect(filtroDeHoje(lembrado("periodo=todos&tecnico=t1", HOJE), HOJE)).toBe("periodo=todos&tecnico=t1");
    expect(filtroDeHoje(lembrado("periodo=todos", "2026-11-26"), HOJE)).toBeNull();
    expect(filtroDeHoje(lembrado("", HOJE), HOJE)).toBeNull();
    for (const torto of [null, undefined, "", "{", "null", "[]", '"x"', JSON.stringify({ q: 3, dia: HOJE }), JSON.stringify({ q: "a=1" }), "periodo=todos"]) {
      expect(filtroDeHoje(torto, HOJE), String(torto)).toBeNull();
    }
  });
  it("a lista abriu limpa só sem nenhum parâmetro", () => {
    expect(abriuLimpa("")).toBe(true);
    expect(abriuLimpa("periodo=todos")).toBe(false);
    expect(abriuLimpa("pagina=1")).toBe(false);
  });
});
