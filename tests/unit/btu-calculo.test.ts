/**
 * Cálculo de BTU (regra pura, estendida): a base e os fatores pessoas/sol são os de sempre; aparelhos
 * e cobertura são aditivos e opcionais (sem efeito quando ausentes). Recomenda o equipamento pela
 * capacidade (parede → piso-teto/cassete) e o conjunto (multisplit/VRF) para vários ambientes.
 */
import { describe, expect, it } from "vitest";
import { calcularAmbiente, equipamentoDoAmbiente, preOrcamento, recomendarConjunto } from "@/lib/leads/btu";

describe("fatores do cálculo", () => {
  it("base residencial/comercial + pessoas + sol (como sempre); aparelhos e cobertura são aditivos", () => {
    // 20 m² residencial = 12000; sem extras
    expect(calcularAmbiente({ nome: "q", tipo: "quarto", areaM2: 20, pessoas: 2, solTarde: false }).btuCalculado).toBe(12000);
    // + 1 pessoa acima de 2 (+600) + 1 aparelho (+600) = 13200
    expect(calcularAmbiente({ nome: "q", tipo: "quarto", areaM2: 20, pessoas: 3, solTarde: false, aparelhos: 1 }).btuCalculado).toBe(13200);
    // sol (+10%) e cobertura (+10%) multiplicam: 12000 × 1,1 × 1,1 = 14520
    expect(calcularAmbiente({ nome: "q", tipo: "quarto", areaM2: 20, pessoas: 2, solTarde: true, cobertura: true }).btuCalculado).toBe(14520);
    // comercial: loja 20 m² = 16000 (800/m²); galpão 20 m² = 18000 (900/m²)
    expect(calcularAmbiente({ nome: "l", tipo: "loja", areaM2: 20, pessoas: 2, solTarde: false }).btuCalculado).toBe(16000);
    expect(calcularAmbiente({ nome: "g", tipo: "galpao", areaM2: 20, pessoas: 2, solTarde: false }).btuCalculado).toBe(18000);
    // ambiente pequeno E grande no mesmo arredondamento de capacidade
    expect(calcularAmbiente({ nome: "p", tipo: "quarto", areaM2: 8, pessoas: 1, solTarde: false }).btuRecomendado).toBe(9000);
    expect(calcularAmbiente({ nome: "s", tipo: "salao", areaM2: 70, pessoas: 20, solTarde: true, cobertura: true }).btuRecomendado).toBe(60000);
  });

  it("aparelhos/cobertura ausentes não mudam o resultado antigo", () => {
    const a = calcularAmbiente({ nome: "x", tipo: "sala", areaM2: 20, pessoas: 3, solTarde: true });
    const b = calcularAmbiente({ nome: "x", tipo: "sala", areaM2: 20, pessoas: 3, solTarde: true, aparelhos: 0, cobertura: false });
    expect(a.btuCalculado).toBe(b.btuCalculado);
    expect(a.btuCalculado).toBe(13860); // 12000+600 = 12600, ×1,1 = 13860
  });
});

describe("equipamento recomendado", () => {
  it("por capacidade: parede (hi-wall) até ~18k; piso-teto/cassete acima; cassete para comercial grande", () => {
    expect(equipamentoDoAmbiente(9000, false).forma).toBe("hi-wall");
    expect(equipamentoDoAmbiente(18000, false).forma).toBe("hi-wall");
    expect(equipamentoDoAmbiente(24000, false)).toMatchObject({ forma: "piso-teto", posicao: "piso" });
    expect(equipamentoDoAmbiente(24000, true)).toMatchObject({ forma: "cassete", posicao: "teto" });
    expect(equipamentoDoAmbiente(48000, false)).toMatchObject({ forma: "cassete", posicao: "teto" });
  });

  it("conjunto: 1 ambiente = o dele; 2-4 = multisplit; muitos/grande = VRF", () => {
    const peq = calcularAmbiente({ nome: "a", tipo: "quarto", areaM2: 12, pessoas: 2, solTarde: false });
    expect(recomendarConjunto([peq]).forma).toBe(peq.equipamento.forma); // 1 ambiente

    const tres = [1, 2, 3].map((i) => calcularAmbiente({ nome: `a${i}`, tipo: "quarto", areaM2: 15, pessoas: 2, solTarde: false }));
    expect(recomendarConjunto(tres)).toMatchObject({ forma: "multisplit", conjunto: true });

    const muitos = [1, 2, 3, 4, 5].map((i) => calcularAmbiente({ nome: `a${i}`, tipo: "sala", areaM2: 20, pessoas: 3, solTarde: false }));
    expect(recomendarConjunto(muitos)).toMatchObject({ forma: "vrf", conjunto: true });

    const grandeComercial = [
      calcularAmbiente({ nome: "loja", tipo: "loja", areaM2: 70, pessoas: 10, solTarde: true }),
      calcularAmbiente({ nome: "dep", tipo: "galpao", areaM2: 20, pessoas: 2, solTarde: false }),
    ];
    expect(recomendarConjunto(grandeComercial).forma).toBe("vrf"); // uma interna comercial ≥ 48k
  });

  it("pré-orçamento soma as faixas por ambiente", () => {
    const a = calcularAmbiente({ nome: "a", tipo: "quarto", areaM2: 12, pessoas: 2, solTarde: false }); // 9000 → [2000,2800]
    const b = calcularAmbiente({ nome: "b", tipo: "sala", areaM2: 30, pessoas: 4, solTarde: true }); // grande
    expect(preOrcamento([a, b])).toEqual({ totalMin: a.faixaPreco[0] + b.faixaPreco[0], totalMax: a.faixaPreco[1] + b.faixaPreco[1] });
  });
});
