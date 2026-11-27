/**
 * O sino lido (lib/alertas/lidos) — a regra pura: assinatura, o lido de hoje, o número só do não lido,
 * a volta com um aviso novo ou no outro dia, e o guardado malformado (que nunca quebra o sino).
 */
import { describe, expect, it } from "vitest";
import { AVISOS_DO_NUMERO, assinaturaDoAviso, avisosLidos, ehAvisoDoNumero, estaLido, lerLidos, marcarLido, numeroDoSino, totalDoSino } from "@/lib/alertas/lidos";
import { PENDENCIAS, avisoDoItem, type IdPendencia } from "@/lib/alertas/pendencias";

const HOJE = "2026-11-27", ONTEM = "2026-11-26";

describe("assinatura do aviso", () => {
  it("é a contagem e o registro mais recente (quando o aviso tem um); muda quando chega um novo", () => {
    expect(assinaturaDoAviso({ osSemTecnico: 3, osSemTecnicoId: "os1" }, "osSemTecnico")).toBe("3:os1");
    expect(assinaturaDoAviso({ osSemTecnico: 3, osSemTecnicoId: "os2" }, "osSemTecnico")).toBe("3:os2");
    expect(assinaturaDoAviso({ prazosVencidos: 2 }, "prazosVencidos")).toBe("2:");
    // campo que não veio (resposta de outra versão) conta como zero; negativo também
    expect(assinaturaDoAviso({}, "pedidosPendentes")).toBe("0:");
    expect(assinaturaDoAviso({ pedidosPendentes: -1 }, "pedidosPendentes")).toBe("0:");
    expect(assinaturaDoAviso({ orcamentosRespondidos: 1, orcamentoRespondidoId: null }, "orcamentosRespondidos")).toBe("1:");
  });
});

describe("lido de hoje", () => {
  const d = { osSemTecnico: 3, osSemTecnicoId: "os1", prazosVencidos: 2, pedidosPendentes: 5 };
  it("o lido tira o aviso do número; o total geral continua com todos", () => {
    const lidos = marcarLido({}, "osSemTecnico", "3:os1", HOJE);
    expect(lidos).toEqual({ osSemTecnico: { assinatura: "3:os1", dia: HOJE } });
    expect(totalDoSino(d)).toBe(10);
    expect(numeroDoSino(d, lidos, HOJE)).toBe(7);
    expect(numeroDoSino(d, {}, HOJE)).toBe(10);
    expect(avisosLidos(d, lidos, HOJE)).toEqual(["osSemTecnico"]);
    expect(estaLido(lidos, d, "osSemTecnico", HOJE)).toBe(true);
    expect(estaLido(lidos, d, "prazosVencidos", HOJE)).toBe(false);
  });
  it("chegou um novo (outra contagem ou outro registro): volta a contar inteiro", () => {
    const lidos = marcarLido({}, "osSemTecnico", "3:os1", HOJE);
    expect(numeroDoSino({ ...d, osSemTecnico: 4 }, lidos, HOJE)).toBe(11);
    expect(numeroDoSino({ ...d, osSemTecnicoId: "os9" }, lidos, HOJE)).toBe(10);
    expect(avisosLidos({ ...d, osSemTecnico: 4 }, lidos, HOJE)).toEqual([]);
  });
  it("no outro dia volta a contar; o guardado de outros dias é descartado ao ler e ao marcar", () => {
    const lidos = marcarLido({}, "osSemTecnico", "3:os1", ONTEM);
    expect(numeroDoSino(d, lidos, HOJE)).toBe(10);
    expect(lerLidos(lidos, HOJE)).toEqual({});
    expect(marcarLido(lidos, "prazosVencidos", "2:", HOJE)).toEqual({ prazosVencidos: { assinatura: "2:", dia: HOJE } });
    // o de hoje fica ao marcar outro
    expect(Object.keys(marcarLido(marcarLido({}, "osSemTecnico", "3:os1", HOJE), "prazosVencidos", "2:", HOJE))).toEqual(["osSemTecnico", "prazosVencidos"]);
  });
  it("aviso lido que zerou não aparece como lido (nem tira do número)", () => {
    const lidos = marcarLido({}, "prazosVencidos", "0:", HOJE);
    expect(avisosLidos({ prazosVencidos: 0 }, lidos, HOJE)).toEqual([]);
  });
  it("guardado malformado não quebra: lista, texto, campo estranho, dia inválido, assinatura gigante", () => {
    for (const g of [null, undefined, "x", 3, [], { osSemTecnico: "3:os1" }, { osSemTecnico: { assinatura: 3, dia: HOJE } }, { osSemTecnico: { assinatura: "3:os1", dia: "27/11/2026" } }, { osSemTecnico: { assinatura: "x".repeat(201), dia: HOJE } }, { toString: { assinatura: "1:", dia: HOJE } }]) {
      expect(lerLidos(g, HOJE)).toEqual({});
    }
    expect(lerLidos({ osSemTecnico: { assinatura: "3:os1", dia: HOJE, extra: 1 }, foo: { assinatura: "1:", dia: HOJE } }, HOJE)).toEqual({ osSemTecnico: { assinatura: "3:os1", dia: HOJE } });
  });
});

describe("os avisos do número", () => {
  it("só campos conhecidos; as contas do dia e a revisão chegando ficam fora", () => {
    expect(ehAvisoDoNumero("osSemTecnico")).toBe(true);
    for (const c of ["contasPagarHoje", "contasReceberHoje", "revisaoChegando", "total", "toString", "__proto__"]) expect(ehAvisoDoNumero(c)).toBe(false);
    expect(Object.keys(AVISOS_DO_NUMERO)).toHaveLength(36);
  });
  it("cada item do painel que está no número tem o seu aviso (OS atrasadas = atendimentosAtraso); as contas do dia não", () => {
    const m = Object.fromEntries((Object.keys(PENDENCIAS) as IdPendencia[]).map((id) => [id, avisoDoItem(id)]));
    expect(m).toEqual({
      osSemTecnico: "osSemTecnico", osAtrasadas: "atendimentosAtraso", atividadesEsquecidas: "atividadesEsquecidas", comentariosCampo: "comentariosCampo",
      pmocsVencendo: "pmocsVencendo", orcamentosVencendo: "orcamentosVencendo", despesasCampo: "despesasCampo",
      contasPagarHoje: null, contasReceberHoje: null, estoqueNegativoCampo: "estoqueNegativoCampo",
      // PC-1: o painel conta todas as OS que esperam o pedido (fora do número); o sino conta só as atrasadas (pedidosAtrasados)
      pedidosCliente: null,
    });
  });
});
