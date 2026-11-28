/**
 * Pedido do cliente (PC-1) — a regra pura (lib/pedido-cliente/regra): o modo do cliente e da unidade, quem aguarda,
 * as travas (faturar/NFS-e e início), o alerta de valor menor, o texto da NFS-e, a limpeza dos campos e o relógio do sino.
 */
import { describe, expect, it } from "vitest";
import {
  aguardandoPedido, alertaValorPedido, camposDoModo, diasEsperando, inicioDaEspera, limparMotivo, limparNumeroPedido, modoDoCliente,
  modoEfetivo, MODOS_PEDIDO, MSG_TRAVA_FATURAR, MSG_TRAVA_INICIAR, reais, ROTULO_MODO_PEDIDO, textoPedidoNaNota, travaFaturar, travaIniciar,
  type SituacaoPedido,
} from "@/lib/pedido-cliente/regra";

const s = (x: Partial<SituacaoPedido> = {}): SituacaoPedido => ({ modo: "FATURAR", pedidoId: null, liberado: false, encerradoSemCobranca: false, faturado: false, ...x });
const D = (d: number, h = 12) => new Date(Date.UTC(2026, 10, d, h));

describe("o modo", () => {
  it("do cliente: 'para faturar' é o campo antigo; 'para executar' só vale junto com ele", () => {
    expect(modoDoCliente(null)).toBe("NAO");
    expect(modoDoCliente({ exigePcAntesNf: false, exigePedidoExecutar: true })).toBe("NAO");
    expect(modoDoCliente({ exigePcAntesNf: true })).toBe("FATURAR");
    expect(modoDoCliente({ exigePcAntesNf: true, exigePedidoExecutar: true })).toBe("EXECUTAR");
    for (const m of MODOS_PEDIDO) expect(modoDoCliente(camposDoModo(m))).toBe(m);
    expect(MODOS_PEDIDO.map((m) => ROTULO_MODO_PEDIDO[m])).toEqual(["Não", "Para faturar", "Para executar e faturar"]);
  });
  it("da unidade vence o do cliente (inclusive 'Não'); vazio ou desconhecido = como o cliente", () => {
    const fat = { exigePcAntesNf: true };
    expect(modoEfetivo(fat, { exigePedido: "NAO" })).toBe("NAO");
    expect(modoEfetivo({}, { exigePedido: "EXECUTAR" })).toBe("EXECUTAR");
    expect(modoEfetivo(fat, { exigePedido: null })).toBe("FATURAR");
    expect(modoEfetivo(fat, { exigePedido: "QUALQUER" })).toBe("FATURAR");
    expect(modoEfetivo(fat, null)).toBe("FATURAR");
  });
});

describe("quem aguarda e as travas", () => {
  it("aguarda: exige, sem pedido, sem liberação, não cancelado e não faturado", () => {
    expect(aguardandoPedido(s())).toBe(true);
    expect(aguardandoPedido(s({ modo: "EXECUTAR" }))).toBe(true);
    for (const x of [{ modo: "NAO" as const }, { pedidoId: "p1" }, { liberado: true }, { encerradoSemCobranca: true }, { faturado: true }]) {
      expect(aguardandoPedido(s(x)), JSON.stringify(x)).toBe(false);
    }
  });
  it("faturar/NFS-e: basta um item aguardando; o início, só no modo 'para executar'", () => {
    expect(travaFaturar([])).toBeNull();
    expect(travaFaturar([s({ pedidoId: "p" }), s()])).toBe(MSG_TRAVA_FATURAR);
    expect(travaFaturar([s({ pedidoId: "p" }), s({ liberado: true })])).toBeNull();
    expect(travaIniciar(s())).toBeNull();
    expect(travaIniciar(s({ modo: "EXECUTAR" }))).toBe(MSG_TRAVA_INICIAR);
    expect(travaIniciar(s({ modo: "EXECUTAR", liberado: true }))).toBeNull();
  });
});

describe("o alerta de valor e o texto da nota", () => {
  it("avisa só quando o pedido é menor que o total (centavo a centavo); sem valor ou sem total, nada", () => {
    expect(alertaValorPedido(1200, 1500)).toBe(`O valor do pedido (${reais(1200)}) é menor que o total das OS e orçamentos que ele cobre (${reais(1500)}).`);
    expect(alertaValorPedido(1500, 1500)).toBeNull();
    expect(alertaValorPedido(1499.995, 1500)).toBeNull();
    expect(alertaValorPedido(1499.99, 1500)).not.toBeNull();
    expect(alertaValorPedido(null, 1500)).toBeNull();
    expect(alertaValorPedido(0, 1500)).toBeNull();
    expect(alertaValorPedido(100, 0)).toBeNull();
    expect(reais(1234.5)).toBe("R$ 1.234,50");
  });
  it("o número na NFS-e: um ou vários, sem repetir nem vazio", () => {
    expect(textoPedidoNaNota([])).toBeNull();
    expect(textoPedidoNaNota([null, " ", undefined])).toBeNull();
    expect(textoPedidoNaNota([" 4500 ", "4500"])).toBe("Pedido do cliente nº 4500");
    expect(textoPedidoNaNota(["A1", "B2", "A1"])).toBe("Pedidos do cliente nº A1, B2");
  });
  it("número e motivo limpos; tamanhos", () => {
    expect(limparNumeroPedido("  45  00 ")).toBe("45 00");
    expect(limparNumeroPedido("")).toBeNull();
    expect(limparNumeroPedido("x".repeat(61))).toBeNull();
    expect(limparNumeroPedido(45)).toBeNull();
    expect(limparMotivo("ok")).toBeNull();
    expect(limparMotivo("  Emergência   autorizada ")).toBe("Emergência autorizada");
    expect(limparMotivo("x".repeat(301))).toBeNull();
  });
});

describe("o relógio do sino", () => {
  it("'para faturar' conta da conclusão; 'para executar' (e o orçamento) da aprovação; sem início, não conta", () => {
    expect(inicioDaEspera({ modo: "FATURAR", criadoEm: D(1), concluidoEm: D(10) })).toEqual(D(10));
    expect(inicioDaEspera({ modo: "FATURAR", criadoEm: D(1), concluidoEm: null })).toBeNull();
    expect(inicioDaEspera({ modo: "EXECUTAR", aprovadoEm: D(3), criadoEm: D(5), concluidoEm: D(10) })).toEqual(D(3));
    expect(inicioDaEspera({ modo: "EXECUTAR", criadoEm: D(5) })).toEqual(D(5));
    expect(inicioDaEspera({ modo: "FATURAR", ehOrcamento: true, aprovadoEm: D(2) })).toEqual(D(2));
    expect(inicioDaEspera({ modo: "NAO", criadoEm: D(1), concluidoEm: D(2) })).toBeNull();
    expect(diasEsperando(D(10), D(17, 11))).toBe(6);
    expect(diasEsperando(D(10), D(17, 12))).toBe(7);
    expect(diasEsperando(null, D(17))).toBe(0);
  });
});
