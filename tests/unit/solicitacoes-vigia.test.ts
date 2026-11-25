/**
 * SOLICITAÇÕES ABRINDO SOZINHAS — a regra pura, condição por condição:
 *  - "novo" é comparação com o último visto, não contagem;
 *  - "ociosa" exige TODAS as condições (aba visível, nada aberto, sem arrasto, sem filtro, parada há 20s);
 *  - abrir sozinho = novo E ociosa;
 *  - o "último visto" nunca anda para trás.
 */
import { describe, expect, it } from "vitest";
import {
  INTERVALO_VIGIA_MS, OCIOSO_MS, deveAbrirSozinha, haNovo, maisRecente, ociosa, type EstadoDaTela,
} from "@/lib/solicitacoes-vigia";

const PARADA: EstadoDaTela = { visivel: true, gavetaAberta: false, dialogoAberto: false, arrastando: false, filtroAtivo: false, ultimaAcaoHa: OCIOSO_MS };
const com = (over: Partial<EstadoDaTela>): EstadoDaTela => ({ ...PARADA, ...over });
const T1 = "2026-11-25T12:00:00.000Z", T2 = "2026-11-25T12:05:00.000Z";

describe("Solicitações — o que é um chamado NOVO", () => {
  it("sem pendência, nada é novo (nem com data, nem sem)", () => {
    expect(haNovo({ total: 0, maisRecenteEm: null }, null)).toBe(false);
    expect(haNovo({ total: 0, maisRecenteEm: T1 }, null)).toBe(false);
    expect(haNovo({ total: 3, maisRecenteEm: null }, T1)).toBe(false);
  });

  it("novo é o que chegou DEPOIS do último visto; igual ou anterior não é", () => {
    expect(haNovo({ total: 1, maisRecenteEm: T2 }, T1)).toBe(true);
    expect(haNovo({ total: 1, maisRecenteEm: T1 }, T1)).toBe(false);
    expect(haNovo({ total: 1, maisRecenteEm: T1 }, T2)).toBe(false);
  });

  it("nunca viu nada e há pendência: conta como novo (quem decide a linha de base é o vigia)", () => {
    expect(haNovo({ total: 2, maisRecenteEm: T1 }, null)).toBe(true);
  });
});

describe("Solicitações — quando a pessoa está OCIOSA", () => {
  it("parada há 20s, aba visível, nada aberto: ociosa", () => {
    expect(ociosa(PARADA)).toBe(true);
    expect(ociosa(com({ ultimaAcaoHa: OCIOSO_MS * 10 }))).toBe(true);
  });

  it("cada condição derruba sozinha", () => {
    expect(ociosa(com({ visivel: false })), "aba em segundo plano").toBe(false);
    expect(ociosa(com({ gavetaAberta: true })), "a gaveta já está aberta").toBe(false);
    expect(ociosa(com({ dialogoAberto: true })), "uma OS aberta, um modal, um balão").toBe(false);
    expect(ociosa(com({ arrastando: true })), "arrastando um cartão").toBe(false);
    expect(ociosa(com({ filtroAtivo: true })), "filtrando").toBe(false);
    expect(ociosa(com({ ultimaAcaoHa: OCIOSO_MS - 1 })), "mexeu há menos de 20s").toBe(false);
    expect(ociosa(com({ ultimaAcaoHa: 0 })), "mexendo agora").toBe(false);
  });
});

describe("Solicitações — abrir sozinha = novo E ociosa", () => {
  it("abre só com os dois", () => {
    expect(deveAbrirSozinha({ total: 1, maisRecenteEm: T2 }, T1, PARADA)).toBe(true);
    expect(deveAbrirSozinha({ total: 1, maisRecenteEm: T1 }, T1, PARADA), "nada novo").toBe(false);
    expect(deveAbrirSozinha({ total: 1, maisRecenteEm: T2 }, T1, com({ filtroAtivo: true })), "novo, mas filtrando").toBe(false);
    expect(deveAbrirSozinha({ total: 1, maisRecenteEm: T2 }, T1, com({ ultimaAcaoHa: 500 })), "novo, mas mexendo").toBe(false);
  });

  it("os tempos combinados: 60s entre conferências, 20s de ociosidade", () => {
    expect(INTERVALO_VIGIA_MS).toBe(60_000);
    expect(OCIOSO_MS).toBe(20_000);
  });
});

describe("Solicitações — o último visto nunca anda para trás", () => {
  it("fica com o maior, ignora o que não veio", () => {
    expect(maisRecente(T1, T2)).toBe(T2);
    expect(maisRecente(T2, T1)).toBe(T2);
    expect(maisRecente(null, T1, undefined)).toBe(T1);
    expect(maisRecente()).toBeNull();
    expect(maisRecente(null, undefined)).toBeNull();
  });
});
