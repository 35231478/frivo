/**
 * Período das telas financeiras (lib/periodo.ts) — regras puras: mês corrente de Brasília, ‹ ›,
 * intervalo (inválido ignorado, trocado se invertido), "todo o período" só onde a tela permite,
 * e a faixa sobre coluna de DIA CIVIL (vencimento) com as bordas certas.
 */
import { describe, expect, it } from "vitest";
import { faixaDiaCivil, lerPeriodo, mesAtual, mesVizinho, rotuloMes } from "@/lib/periodo";
import { condCardPeriodoReceber, condPeriodoVencimento } from "@/lib/listas/filtros";

const AGORA = new Date("2026-11-01T02:30:00.000Z"); // 31/10 23:30 em Brasília
const iso = (x?: Date) => x?.toISOString();

describe("período", () => {
  it("mês corrente é o de Brasília; vizinhos viram o ano; rótulo em português", () => {
    expect(mesAtual(AGORA)).toBe("2026-10");
    expect(mesVizinho("2026-12", 1)).toBe("2027-01");
    expect(mesVizinho("2026-01", -1)).toBe("2025-12");
    expect(rotuloMes("2026-03")).toBe("Março de 2026");
  });
  it("todo o período só quando a tela permite; senão cai no mês corrente", () => {
    expect(lerPeriodo({ periodo: "todos" }, AGORA, { permitirTodos: true })).toMatchObject({ tipo: "todos", gte: null, lt: null, rotulo: "Todo o período" });
    expect(lerPeriodo({ periodo: "todos" }, AGORA)).toMatchObject({ tipo: "mes", mes: "2026-10" });
  });
  it("intervalo vence o mês; datas inválidas ignoradas; invertido é trocado", () => {
    expect(lerPeriodo({ mes: "2026-05", de: "2026-11-10", ate: "2026-11-02" }, AGORA)).toMatchObject({ tipo: "intervalo", de: "2026-11-02", ate: "2026-11-10" });
    expect(lerPeriodo({ de: "2026-02-30" }, AGORA)).toMatchObject({ tipo: "mes", mes: "2026-10" });
    expect(lerPeriodo({ mes: "2026-13" }, AGORA)).toMatchObject({ mes: "2026-10" });
  });
  it("faixa de DIA CIVIL (vencimento): mês = [dia 1, dia 1 do seguinte); intervalo inclusivo; todos = sem faixa", () => {
    const mes = faixaDiaCivil(lerPeriodo({ mes: "2026-12" }, AGORA))!;
    expect([iso(mes.gte), iso(mes.lt)]).toEqual(["2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
    const int = faixaDiaCivil(lerPeriodo({ de: "2026-11-15", ate: "2026-11-20" }, AGORA))!;
    expect([iso(int.gte), iso(int.lt)]).toEqual(["2026-11-15T00:00:00.000Z", "2026-11-21T00:00:00.000Z"]);
    const so = faixaDiaCivil(lerPeriodo({ ate: "2026-11-20" }, AGORA))!;
    expect([so.gte, iso(so.lt)]).toEqual([undefined, "2026-11-21T00:00:00.000Z"]);
    expect(faixaDiaCivil(lerPeriodo({ periodo: "todos" }, AGORA, { permitirTodos: true }))).toBeNull();
    expect(condPeriodoVencimento(lerPeriodo({ periodo: "todos" }, AGORA, { permitirTodos: true }))).toBeNull();
    expect(condPeriodoVencimento(lerPeriodo({}, AGORA))).toEqual({ dataVencimento: { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2026-11-01T00:00:00.000Z") } });
  });
  it("cards de Contas a Receber: A_RECEBER antigo = A vencer; Total tira canceladas; desconhecido = sem filtro", () => {
    expect(condCardPeriodoReceber("A_RECEBER", AGORA)).toEqual(condCardPeriodoReceber("A_VENCER", AGORA));
    expect(condCardPeriodoReceber("TOTAL", AGORA)).toEqual({ status: { not: "CANCELADO" } });
    expect(condCardPeriodoReceber("RECEBIDO", AGORA)).toEqual({ status: "RECEBIDO" });
    expect(condCardPeriodoReceber("xyz", AGORA)).toBeNull();
  });
});
