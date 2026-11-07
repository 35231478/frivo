/**
 * Estoque E4.1 — separação + reserva de material: a regra PURA (lib/estoque/separacao) e o estorno da reserva no
 * razão (lib/estoque/regras): o que falta separar, a situação por material e da OS, o plano (RESERVA − / estorno +),
 * a marca "prestação de contas pendente", o aviso de saldo que não cobre (não trava) e o corpo do POST.
 */
import { describe, expect, it } from "vitest";
import { calcularMovimento } from "@/lib/estoque/regras";
import { moduloDaRota, PRESETS, pode } from "@/lib/permissoes";
import {
  avisoSaldoSeparacao, faltaSeparar, mensagemSeparacao, planoSeparacao, precisaSeparar, resumoSeparacao, separacaoSchema, situacaoDoMaterial,
  type MaterialSeparavel,
} from "@/lib/estoque/separacao";

const M = (id: string, quantidade: number, quantidadeSeparada = 0, estadoSeparacao: MaterialSeparavel["estadoSeparacao"] = null, produtoId: string | null = `p-${id}`): MaterialSeparavel =>
  ({ id, produtoId, descricao: id, unidade: "un", quantidade, quantidadeSeparada, estadoSeparacao });

describe("E4.1 — separação de material (regra pura)", () => {
  it("razão: RESERVA subtrai (como a saída) e ESTORNO_RESERVA devolve — os dois ficam no razão como RESERVA, origem OS", () => {
    expect(calcularMovimento("RESERVA", 10, 3)).toEqual({ tipo: "RESERVA", origem: "OS", delta: -3 });
    expect(calcularMovimento("ESTORNO_RESERVA", 7, 3)).toEqual({ tipo: "RESERVA", origem: "OS", delta: 3 });
    expect(calcularMovimento("ESTORNO_RESERVA", 7, 0.1255)).toEqual({ tipo: "RESERVA", origem: "OS", delta: 0.126 });
  });

  it("permissão: 'Separar material' é ação do Estoque; a fila e a tela de separação não exigem 'Estoque › Visualizar' (a página confere a ação); supervisor novo já separa", () => {
    expect(moduloDaRota("/estoque/separacao")).toBeNull();
    expect(moduloDaRota("/estoque/separacao/os1")).toBeNull();
    expect(moduloDaRota("/estoque")).toBe("estoque");
    expect(moduloDaRota("/estoque/notas")).toBe("estoque");
    expect(pode(PRESETS.SUPERVISOR, "estoque", "separar")).toBe(true);
    expect(pode(PRESETS.FINANCEIRO, "estoque", "separar")).toBe(false);
    expect(pode(PRESETS.TECNICO, "estoque", "separar")).toBe(false);
    expect(pode(PRESETS.ADMINISTRADOR, "estoque", "separar")).toBe(true);
  });

  it("falta / precisa separar / situação por material: pendente, em parte, separado, sem produto, consumido e devolvido (fechados), quantidade 0", () => {
    expect(faltaSeparar(M("a", 3))).toBe(3);
    expect(situacaoDoMaterial(M("a", 3))).toBe("pendente");
    expect(faltaSeparar(M("b", 3, 2, "SEPARADO"))).toBe(1);
    expect(situacaoDoMaterial(M("b", 3, 2, "SEPARADO"))).toBe("parcial");
    expect(faltaSeparar(M("c", 3, 3, "SEPARADO"))).toBe(0);
    expect(situacaoDoMaterial(M("c", 3, 3, "SEPARADO"))).toBe("separado");
    expect(precisaSeparar(M("c", 3, 3, "SEPARADO"))).toBe(false);
    // Sem produto no cadastro: não dá para separar (não puxa a OS para a fila)
    expect(faltaSeparar(M("d", 3, 0, null, null))).toBe(0);
    expect(situacaoDoMaterial(M("d", 3, 0, null, null))).toBe("sem-produto");
    // Consumido/devolvido (E4.2/E4.3): fechados — nada falta, mesmo que a quantidade separada seja menor
    expect(faltaSeparar(M("e", 3, 1, "CONSUMIDO"))).toBe(0);
    expect(situacaoDoMaterial(M("e", 3, 1, "CONSUMIDO"))).toBe("consumido");
    expect(situacaoDoMaterial(M("f", 3, 3, "DEVOLVIDO"))).toBe("devolvido");
    // Arredondamento a 3 casas
    expect(faltaSeparar(M("g", 1, 0.3335))).toBe(0.667);
  });

  it("resumo da OS: sem material / a separar / parcial / completa; prestação de contas pendente só com material SEPARADO; sem-produto à parte", () => {
    expect(resumoSeparacao([])).toMatchObject({ total: 0, aSeparar: 0, situacao: "sem-material", prestacaoPendente: false });
    expect(resumoSeparacao([M("x", 0), M("y", 2, 0, null, null)])).toMatchObject({ total: 0, semProduto: 1, situacao: "sem-material" });
    expect(resumoSeparacao([M("a", 3), M("b", 1)])).toMatchObject({ total: 2, aSeparar: 2, pendentes: 2, parciais: 0, separados: 0, situacao: "pendente", prestacaoPendente: false });
    expect(resumoSeparacao([M("a", 3, 3, "SEPARADO"), M("b", 1)])).toMatchObject({ aSeparar: 1, separados: 1, pendentes: 1, situacao: "parcial", prestacaoPendente: true });
    expect(resumoSeparacao([M("a", 3, 2, "SEPARADO"), M("b", 1, 1, "SEPARADO")])).toMatchObject({ aSeparar: 1, parciais: 1, separados: 1, situacao: "parcial", prestacaoPendente: true });
    expect(resumoSeparacao([M("a", 3, 3, "SEPARADO"), M("b", 1, 1, "SEPARADO")])).toMatchObject({ aSeparar: 0, separados: 2, situacao: "completa", prestacaoPendente: true });
    // Consumido e devolvido (próximas levas): completa e SEM prestação pendente
    expect(resumoSeparacao([M("a", 3, 3, "CONSUMIDO"), M("b", 1, 1, "DEVOLVIDO")])).toMatchObject({ aSeparar: 0, situacao: "completa", prestacaoPendente: false });
    // Quantidade 0 ("não usado") não conta
    expect(resumoSeparacao([M("a", 0), M("b", 1, 1, "SEPARADO")])).toMatchObject({ total: 1, situacao: "completa" });
  });

  it("plano: subir o alvo = RESERVA (−), baixar = estorno (+), 0 = desfaz (estado some); limites: acima do necessário, negativo, 4 casas, sem produto, já consumido; alvo igual = nada", () => {
    expect(planoSeparacao(M("a", 3), 3)).toEqual({ ok: true, delta: -3, quantidadeSeparada: 3, estado: "SEPARADO" });
    expect(planoSeparacao(M("a", 3), 2)).toEqual({ ok: true, delta: -2, quantidadeSeparada: 2, estado: "SEPARADO" });
    expect(planoSeparacao(M("a", 3, 3, "SEPARADO"), 1)).toEqual({ ok: true, delta: 2, quantidadeSeparada: 1, estado: "SEPARADO" });
    expect(planoSeparacao(M("a", 3, 3, "SEPARADO"), 0)).toEqual({ ok: true, delta: 3, quantidadeSeparada: 0, estado: null });
    expect(planoSeparacao(M("a", 3, 2, "SEPARADO"), 2)).toEqual({ ok: true, delta: 0, quantidadeSeparada: 2, estado: "SEPARADO" });
    expect(planoSeparacao(M("a", 2.5), "2,5" as unknown as number)).toMatchObject({ ok: false }); // número vem já convertido pelo schema
    expect(planoSeparacao(M("a", 3), 3.5)).toMatchObject({ ok: false, erro: expect.stringMatching(/mais do que o necessário \(3 un\)/) });
    expect(planoSeparacao(M("a", 3), -1)).toMatchObject({ ok: false, erro: expect.stringMatching(/negativa/) });
    expect(planoSeparacao(M("a", 3), 1.0005)).toMatchObject({ ok: false, erro: expect.stringMatching(/3 casas/) });
    expect(planoSeparacao(M("a", 3, 0, null, null), 1)).toMatchObject({ ok: false, erro: expect.stringMatching(/sem produto/) });
    expect(planoSeparacao(M("a", 3, 3, "CONSUMIDO"), 0)).toMatchObject({ ok: false, erro: expect.stringMatching(/já consumido/) });
    expect(planoSeparacao(M("a", 3, 3, "DEVOLVIDO"), 3)).toMatchObject({ ok: false, erro: expect.stringMatching(/já devolvido/) });
    // Decimais: 0,333 de 1 e arredondamento do delta
    expect(planoSeparacao(M("a", 1, 0.333, "SEPARADO"), 1)).toEqual({ ok: true, delta: -0.667, quantidadeSeparada: 1, estado: "SEPARADO" });
  });

  it("aviso de saldo: só quando o que vai ser separado agora é maior que o disponível — e nunca trava (é texto)", () => {
    expect(avisoSaldoSeparacao(10, 3, "m")).toBeNull();
    expect(avisoSaldoSeparacao(3, 3, "m")).toBeNull();
    expect(avisoSaldoSeparacao(3, 0, "m")).toBeNull();
    expect(avisoSaldoSeparacao(2, 3, "m")).toBe("Saldo disponível (2 m) não cobre: faltam 1 m.");
    expect(avisoSaldoSeparacao(0, 3, "un")).toBe("Sem saldo disponível (0 un): faltam 3 un.");
    expect(avisoSaldoSeparacao(-1.5, 2, "")).toBe("Sem saldo disponível (-1,5): faltam 3,5.");
  });

  it("corpo do POST: alvo por material, número aceita vírgula; lista vazia, campo estranho, id comprido e quantidade em branco são recusados", () => {
    expect(separacaoSchema.parse({ materiais: [{ id: "m1", quantidade: "2,5" }, { id: "m2", quantidade: 0 }] })).toEqual({ materiais: [{ id: "m1", quantidade: 2.5 }, { id: "m2", quantidade: 0 }] });
    const vazio = separacaoSchema.safeParse({ materiais: [] });
    expect(vazio.success).toBe(false);
    if (!vazio.success) expect(mensagemSeparacao(vazio.error)).toBe("Informe ao menos um material.");
    const estranho = separacaoSchema.safeParse({ materiais: [{ id: "m1", quantidade: 1, produtoId: "x" }] });
    expect(estranho.success).toBe(false);
    if (!estranho.success) expect(mensagemSeparacao(estranho.error)).toBe("Campo não permitido: produtoId.");
    expect(separacaoSchema.safeParse({ materiais: [{ id: "x".repeat(41), quantidade: 1 }] }).success).toBe(false);
    const branco = separacaoSchema.safeParse({ materiais: [{ id: "m1", quantidade: "" }] });
    expect(branco.success).toBe(false);
    if (!branco.success) expect(mensagemSeparacao(branco.error)).toBe("Informe a quantidade separada.");
    expect(separacaoSchema.safeParse({ materiais: [{ id: "m1", quantidade: 1 }], outro: 1 }).success).toBe(false);
  });
});
