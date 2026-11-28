/**
 * App pronto pra janeiro 2 · PR B — as regras puras.
 *  - D4: a legenda das fotos antes/depois (o schema do sync e a tela antes de sincronizar);
 *  - D5: o saldo disponível para o uso (catálogo + separado para a OS − o que está na fila) e o aviso "vai ficar negativo";
 *  - D14: equipamentos começados × completos.
 */
import { describe, expect, it } from "vitest";
import { avisoSemSaldo, disponivelParaUso, separadoParaUso, textoSaldo, type SeparacaoCandidata } from "@/lib/tecnico/materiais";
import { contarAndamento, resumoEquipamentos } from "@/lib/tecnico/topo-os";
import { operacaoSchema } from "@/lib/tecnico/sync";
import { aplicar } from "@/lib/tecnico/offline/estado";

describe("D5: saldo disponível para o uso", () => {
  const sep = (o: Partial<SeparacaoCandidata>): SeparacaoCandidata => ({ id: "m1", produtoId: "pGas", estadoSeparacao: "SEPARADO", quantidadeSeparada: 4, quantidadeConsumida: 0, ordem: 0, doCampo: false, ...o });
  it("separado: a mesma separação que o lançamento consome (a primeira candidata), inteira ou o que sobrou do campo", () => {
    expect(separadoParaUso([sep({})], "pGas")).toBe(4);
    expect(separadoParaUso([sep({ estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 3, doCampo: true })], "pGas")).toBe(1);
    expect(separadoParaUso([sep({ estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 6, doCampo: true })], "pGas")).toBe(0);
    // consumida pelo escritório (não é do campo) e devolvida: não conta
    expect(separadoParaUso([sep({ estadoSeparacao: "CONSUMIDO", quantidadeConsumida: 3, doCampo: false })], "pGas")).toBe(0);
    expect(separadoParaUso([sep({ estadoSeparacao: "DEVOLVIDO" })], "pGas")).toBe(0);
    expect(separadoParaUso([sep({ produtoId: "pCap" })], "pGas")).toBe(0);
    expect(separadoParaUso([sep({})], null)).toBe(0);
    // duas separações do mesmo produto: só a primeira (pela ordem) entra neste uso
    expect(separadoParaUso([sep({ id: "m2", ordem: 1, quantidadeSeparada: 9 }), sep({ id: "m1", ordem: 0, quantidadeSeparada: 2 })], "pGas")).toBe(2);
  });
  it("disponível = saldo + separado − o que está na fila; sem saldo (não controla estoque) = null", () => {
    expect(disponivelParaUso(10, 0, 0)).toBe(10);
    expect(disponivelParaUso(0, 4, 0)).toBe(4);
    expect(disponivelParaUso(5, 2, 3)).toBe(4);
    expect(disponivelParaUso(1, 0, 3)).toBe(-2);
    expect(disponivelParaUso(0.3, 0.1, 0.2)).toBe(0.2); // sem o erro do ponto flutuante
    expect(disponivelParaUso(null, 4, 0)).toBeNull();
    expect(disponivelParaUso(undefined, 4, 0)).toBeNull();
    expect(disponivelParaUso(Number.NaN, 0, 0)).toBeNull();
  });
  it("o aviso: só quando passa do disponível; mostra o saldo (nunca negativo) e segue", () => {
    expect(avisoSemSaldo(3, 3, "un")).toBeNull();
    expect(avisoSemSaldo(3.5, 1, "m")).toBe("Saldo disponível: 1 m. Vai ficar negativo; o escritório será avisado.");
    expect(avisoSemSaldo(1, -2, "un")).toBe("Saldo disponível: 0 un. Vai ficar negativo; o escritório será avisado.");
    expect(avisoSemSaldo(0.30000000000000004, 0.3, "kg")).toBeNull();
    expect(avisoSemSaldo(0, 0, "un")).toBeNull();
    expect(avisoSemSaldo(-1, 0, "un")).toBeNull();
    expect(avisoSemSaldo(5, null, "un")).toBeNull();
  });
  it("a linha do saldo, com o separado para a OS quando houver", () => {
    expect(textoSaldo(12, 0, "un")).toBe("Saldo disponível: 12 un");
    expect(textoSaldo(5.5, 4, "kg")).toBe("Saldo disponível: 5,5 kg (4 kg separado para esta OS)");
    expect(textoSaldo(null, 4, "kg")).toBeNull();
  });
});

describe("D14: começados × completos", () => {
  const eq = (o: { feito?: boolean; respostas?: number; fotos?: number; completo?: boolean }) =>
    ({ feito: !!o.feito, respostas: Object.fromEntries(Array.from({ length: o.respostas ?? 0 }, (_, i) => [`i${i}`, { status: "OK" }])), fotos: Array.from({ length: o.fotos ?? 0 }, () => ({})), completo: !!o.completo }) as any;
  it("começado = mexeu (feito, resposta ou foto); completo = mexeu e está completo", () => {
    expect(contarAndamento([eq({ respostas: 1 }), eq({}), eq({ fotos: 1 }), eq({ feito: true, completo: true }), eq({ completo: true })]))
      .toEqual({ comecados: 3, completos: 1 });
    expect(contarAndamento([])).toEqual({ comecados: 0, completos: 0 });
  });
  it("o texto", () => {
    expect(resumoEquipamentos(2, 1, 0)).toBe("2 equipamentos · 1 começado · 0 completos");
  });
});

describe("D4: legenda das fotos antes/depois", () => {
  const base = { id: "7b1c2f0e-1d4a-4c39-9a51-2f6c3e8b9d10", atividadeId: "a1", em: "2026-11-28T12:00:00.000Z" };
  it("o schema do sync: pelo id ou pelo id do aparelho; vazia vale (volta à do sistema); nada além disso; limite de tamanho", () => {
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { id: "f1", legenda: "Serpentina suja" } }).success).toBe(true);
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { clientId: "c1", legenda: "" } }).success).toBe(true);
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { id: "f1", legenda: "x".repeat(201) } }).success).toBe(false);
    expect(operacaoSchema.safeParse({ ...base, tipo: "fotoLegenda", dados: { id: "f1", legenda: "ok", url: "x" } }).success).toBe(false);
  });
  it("a tela antes de sincronizar: a foto (pelo id ou pelo clientId) já mostra a legenda; vazia volta a null", () => {
    const x = { equipamentos: [{ fotos: [{ id: "f1", clientId: null, legenda: null }, { id: null, clientId: "c2", legenda: "Velha" }, { id: "f3", clientId: null, legenda: "Fica" }] }] } as any;
    const op = (dados: Record<string, unknown>) => ({ ...base, tipo: "fotoLegenda", dados }) as any;
    let y = aplicar({} as any, x, op({ id: "f1", legenda: "  Antes da limpeza " }));
    y = aplicar({} as any, y, op({ clientId: "c2", legenda: "" }));
    expect(y.equipamentos[0].fotos.map((f: any) => f.legenda)).toEqual(["Antes da limpeza", null, "Fica"]);
  });
});
