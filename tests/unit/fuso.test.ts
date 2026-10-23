/**
 * Fuso de Brasília — o helper único (lib/fuso.ts) e quem depende dele, rodando num processo em
 * TÓQUIO (UTC+9): se algo ainda usasse o fuso de quem roda, os resultados mudariam aqui.
 *  - exibição: instante na hora de Brasília; dia civil (vencimento/validade) no próprio dia;
 *  - regra do dia civil: vence/expira só depois do dia de Brasília (não às 21h da véspera);
 *  - conversões dos campos (data+hora de Brasília ⇄ instante), filtros por período, recorrência.
 */
process.env.TZ = "Asia/Tokyo";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anoBR, chaveDiaBR, chaveDiaCivil, chaveHojeBR, deLocalBR, diaCivilDeChave, diaCivilPassou, diasAteDiaCivil, diaDoMesCivil,
  ehDiaCivil, hojeDiaCivil, horaBR, inicioHojeBR, inicioMesDiaCivil, instanteBR, mesBR, paraLocalBR, partesBR, periodoDiaCivil,
  periodoInstanteBR, relogioBR,
} from "@/lib/fuso";
import { calcularDataFimContrato, formatarData, formatarDataHora } from "@/lib/utils";
import { diasAteVencimento, statusVisualPagar, statusVisualReceber } from "@/lib/financeiro-status";
import { situacaoGarantia, diasRestantesGarantia } from "@/lib/equipamento-garantia";
import { ajustarFimDeSemana, dataAgendadaRecorrencia, ehOcorrencia, proximasOcorrencias } from "@/lib/recorrencia-helpers";
import { condStatusVisualReceber, whereContratos, whereOrdens } from "@/lib/listas/filtros";
import { calcularVencimento } from "@/lib/medicao-helpers";

const VENC = "2026-10-28T00:00:00.000Z"; // dia civil 28/10 (como o banco devolve um vencimento)
const H = (iso: string) => new Date(iso);
afterEach(() => { vi.useRealTimers(); });

describe("o helper único", () => {
  it("o processo está mesmo em Tóquio (prova de que nada depende do fuso de quem roda)", () => {
    expect(new Date("2026-10-28T17:00:00Z").getHours()).toBe(2); // 02h do dia 29 em Tóquio
  });

  it("instante → relógio de Brasília (hora, dia, mês, ano, dia da semana)", () => {
    expect(partesBR(H("2026-10-29T02:30:00Z"))).toMatchObject({ ano: 2026, mes: 9, dia: 28, hora: 23, minuto: 30, diaSemana: 3 });
    expect(horaBR(H("2026-10-28T17:00:00Z"))).toBe("14:00");
    expect(chaveDiaBR(H("2026-10-29T02:59:00Z"))).toBe("2026-10-28"); // 23:59 de Brasília
    expect(chaveDiaBR(H("2026-10-29T03:00:00Z"))).toBe("2026-10-29"); // meia-noite de Brasília
    expect(instanteBR(2026, 9, 28, 14, 0).toISOString()).toBe("2026-10-28T17:00:00.000Z");
    expect(inicioHojeBR(H("2026-10-29T01:00:00Z")).toISOString()).toBe("2026-10-28T03:00:00.000Z");
    expect(anoBR(H("2027-01-01T01:00:00Z"))).toBe(2026); // 22h de 31/12 em Brasília: ainda 2026
    expect(mesBR(H("2026-11-01T02:00:00Z"))).toBe(10);
  });

  it("dia civil: meia-noite UTC é o próprio dia; com hora é instante (vale o dia de Brasília)", () => {
    expect(ehDiaCivil(VENC)).toBe(true);
    expect(chaveDiaCivil(VENC)).toBe("2026-10-28");
    expect(chaveDiaCivil("2026-10-28T12:00:00.000Z")).toBe("2026-10-28"); // NF-e grava ao meio-dia UTC
    expect(chaveDiaCivil("2026-10-29T01:00:00.000Z")).toBe("2026-10-28"); // 22h de Brasília
    expect(diaDoMesCivil(VENC)).toBe(28);
    expect(diaCivilDeChave("2026-10-28")!.toISOString()).toBe(VENC);
    expect(diaCivilDeChave("")).toBeNull();
  });

  it("a regra: vence/expira só depois do dia de Brasília — às 21h30 do próprio dia ainda é hoje", () => {
    expect(diasAteDiaCivil(VENC, H("2026-10-29T00:30:00Z"))).toBe(0); // 21h30 de 28/10 em Brasília
    expect(diaCivilPassou(VENC, H("2026-10-29T02:59:00Z"))).toBe(false); // 23h59
    expect(diaCivilPassou(VENC, H("2026-10-29T03:00:00Z"))).toBe(true); // 00h00 de 29/10
    expect(diasAteDiaCivil(VENC, H("2026-10-25T12:00:00Z"))).toBe(3);
    expect(diasAteDiaCivil(null)).toBeNull();
    expect(hojeDiaCivil(H("2026-10-29T00:30:00Z")).toISOString()).toBe(VENC); // hoje (BR) gravável
    expect(inicioMesDiaCivil(H("2026-11-01T01:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z"); // ainda outubro em BR
  });

  it("campo de data+hora: o que se escolhe é hora de Brasília, ida e volta", () => {
    expect(deLocalBR("2026-10-30T14:00")!.toISOString()).toBe("2026-10-30T17:00:00.000Z");
    expect(paraLocalBR("2026-10-30T17:00:00.000Z")).toBe("2026-10-30T14:00");
    expect(paraLocalBR(deLocalBR("2026-12-31T23:30"))).toBe("2026-12-31T23:30");
    expect(deLocalBR("30/10/2026 14:00")).toBeNull();
    expect(paraLocalBR("")).toBe("");
  });

  it("valor padrão 'hoje' do campo de data e filtros de período", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: H("2026-10-29T01:00:00Z") }); // 22h de 28/10 em Brasília
    expect(chaveHojeBR()).toBe("2026-10-28");
    expect(chaveHojeBR(7)).toBe("2026-11-04");
    expect(periodoInstanteBR("2026-10-28", "2026-10-28")).toEqual({ gte: H("2026-10-28T03:00:00Z"), lt: H("2026-10-29T03:00:00Z") });
    expect(periodoDiaCivil("2026-10-01", "2026-10-31")).toEqual({ gte: H("2026-10-01T00:00:00Z"), lt: H("2026-11-01T00:00:00Z") });
    expect(periodoInstanteBR(null, "2026-10-28")).toEqual({ lt: H("2026-10-29T03:00:00Z") });
    expect(periodoInstanteBR("", "")).toBeNull();
  });
});

describe("exibição: a mesma em qualquer navegador/servidor", () => {
  it("formatarData/formatarDataHora no relógio de Brasília; dia civil não volta para a véspera", () => {
    expect(formatarData(VENC)).toBe("28/10/2026");
    expect(formatarDataHora("2026-10-28T17:00:00Z")).toBe("28/10/2026 às 14:00");
    expect(formatarDataHora("2026-10-29T02:30:00Z")).toBe("28/10/2026 às 23:30");
    expect(formatarData("2026-10-28T12:00:00.000Z")).toBe("28/10/2026");
    expect(formatarData(VENC, "EEEE")).toBe("quarta-feira");
    expect(formatarData("lixo")).toBe("—");
    expect(formatarData(null)).toBe("—");
    expect(relogioBR(H("2026-10-28T17:00:00Z")).getHours()).toBe(14);
  });

  it("fim de vigência do contrato soma meses no dia gravado", () => {
    expect(calcularDataFimContrato(VENC, 12)!.toISOString()).toBe("2027-10-27T00:00:00.000Z");
    expect(calcularDataFimContrato("2026-01-01T00:00:00.000Z", 12)!.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("quem compara datas usa a regra", () => {
  it("contas: 'Vence hoje' até a meia-noite de Brasília; depois 'Vencido 1 dia'", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: H("2026-10-29T00:30:00Z") }); // 21h30 de 28/10
    expect(diasAteVencimento(VENC)).toBe(0);
    expect(statusVisualReceber("A_RECEBER", VENC).chave).toBe("VENCE_HOJE");
    expect(statusVisualPagar("PENDENTE", VENC).chave).toBe("VENCE_HOJE");
    vi.setSystemTime(H("2026-10-29T03:30:00Z")); // 00h30 de 29/10
    expect(statusVisualReceber("A_RECEBER", VENC)).toMatchObject({ chave: "VENCIDO", label: "Vencido 1 dia" });
  });

  it("garantia vale o último dia inteiro", () => {
    expect(situacaoGarantia(VENC, H("2026-10-29T02:00:00Z"))).toBe("vencendo");
    expect(diasRestantesGarantia(VENC, H("2026-10-29T02:00:00Z"))).toBe(0);
    expect(situacaoGarantia(VENC, H("2026-10-29T04:00:00Z"))).toBe("vencida");
  });

  it("filtros do banco: vencidas antes de HOJE (dia civil de Brasília), não do instante UTC", () => {
    const agora = H("2026-10-29T00:30:00Z"); // 21h30 de 28/10 em Brasília
    expect(condStatusVisualReceber("VENCE_HOJE", agora)).toEqual({ status: "A_RECEBER", dataVencimento: { gte: H(VENC), lt: H("2026-10-29T00:00:00Z") } });
    expect(condStatusVisualReceber("VENCIDO", agora)).toEqual({ OR: [{ status: "ATRASADO" }, { status: "A_RECEBER", dataVencimento: { lt: H(VENC) } }] });
    expect(whereContratos("e1", { status: "VENCIDO" }, agora).dataFim).toEqual({ lt: H(VENC) });
    const w = whereOrdens("e1", { data: "2026-10-28" });
    expect(w.AND[0].OR).toEqual([
      { atividades: { some: { dataAgendada: { gte: H("2026-10-28T03:00:00Z"), lt: H("2026-10-29T03:00:00Z") } } } },
      { previsaoConclusao: { gte: H(VENC), lt: H("2026-10-29T00:00:00Z") } },
      { previsaoConclusao: { gte: H("2026-10-28T03:00:00Z"), lt: H("2026-10-29T03:00:00Z") } },
      { criadoEm: { gte: H("2026-10-28T03:00:00Z"), lt: H("2026-10-29T03:00:00Z") } },
    ]);
  });

  it("recorrência: meio-dia de BRASÍLIA (15h UTC) e fim de semana pelo dia da semana de Brasília", () => {
    expect(dataAgendadaRecorrencia(2026, 11, 16, null).toISOString()).toBe("2026-11-16T15:00:00.000Z"); // segunda
    expect(dataAgendadaRecorrencia(2026, 11, 14, "ADIANTAR").toISOString()).toBe("2026-11-13T15:00:00.000Z"); // sáb → sex
    expect(dataAgendadaRecorrencia(2026, 11, 15, "POSTERGAR").toISOString()).toBe("2026-11-16T15:00:00.000Z"); // dom → seg
    // 22h de sábado em Brasília (01h de domingo UTC) continua sábado
    expect(ajustarFimDeSemana(H("2026-11-15T01:00:00Z"), "ADIANTAR").toISOString()).toBe("2026-11-14T01:00:00.000Z");
    expect(ehOcorrencia(H("2026-01-01T00:00:00Z"), 2026, 1, 3)).toBe(true); // início no dia 1: não volta para dezembro
    const oc = proximasOcorrencias({ dataInicio: H("2026-10-01T00:00:00Z"), dataFim: H("2026-12-31T00:00:00Z"), frequencia: "MENSAL", diaRecorrencia: 31, aPartirDe: H("2026-10-01T00:00:00Z") });
    expect(oc.map((o) => o.periodo)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("vencimento da medição é dia civil do mês de referência", () => {
    expect(calcularVencimento(10, 11, 2026).toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });
});
