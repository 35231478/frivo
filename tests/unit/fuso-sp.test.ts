/**
 * O mesmo helper rodando num processo em BRASÍLIA (UTC-3) — o fuso do navegador do cliente. Aqui o
 * erro clássico aparece: o dia civil gravado à meia-noite UTC, lido com getMonth/getDate locais,
 * volta para a véspera (21h do dia anterior). Em Tóquio (fuso.test.ts) esse erro não se manifesta.
 */
process.env.TZ = "America/Sao_Paulo";
import { describe, expect, it } from "vitest";
import { chaveDiaCivil, diaDoMesCivil } from "@/lib/fuso";
import { calcularDataFimContrato, formatarData } from "@/lib/utils";
import { ehOcorrencia } from "@/lib/recorrencia-helpers";

describe("processo em Brasília: dia civil não volta para a véspera", () => {
  it("o processo está mesmo em Brasília", () => {
    expect(new Date("2026-11-01T00:00:00Z").getDate()).toBe(31); // 21h de 31/10
  });

  it("leitura e exibição do dia gravado", () => {
    expect(chaveDiaCivil("2026-11-01T00:00:00.000Z")).toBe("2026-11-01");
    expect(diaDoMesCivil("2026-11-01T00:00:00.000Z")).toBe(1);
    expect(formatarData("2026-11-01T00:00:00.000Z")).toBe("01/11/2026");
  });

  it("fim de vigência: início em 01/11 + 12 meses termina em 31/10 do ano seguinte", () => {
    expect(calcularDataFimContrato("2026-11-01T00:00:00.000Z", 12)!.toISOString()).toBe("2027-10-31T00:00:00.000Z");
    expect(calcularDataFimContrato("2026-03-01T00:00:00.000Z", 1)!.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("recorrência: contrato iniciado em 01/11 tem ocorrência em novembro, não em outubro", () => {
    const inicio = new Date("2026-11-01T00:00:00.000Z");
    expect(ehOcorrencia(inicio, 2026, 11, 3)).toBe(true);
    expect(ehOcorrencia(inicio, 2026, 10, 1)).toBe(false);
    expect(ehOcorrencia(inicio, 2027, 2, 3)).toBe(true);
  });
});
