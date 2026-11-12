/**
 * Faturamento parcial (P5) — regras puras:
 *  - `faturaParcial`: cada linha da fatura cheia entra proporcional (mantém serviço/produto/origem), quantidade 1,
 *    a última linha absorve o arredondamento; desconto proporcional; líquido = exatamente a parte; rótulo na descrição;
 *  - `validarParcial`: por valor ou por percentual DO TOTAL; não passa do saldo (1 centavo de folga arredonda ao saldo);
 *    zero/negativo/acima de 100%/vazio recusados; saldo zerado recusado;
 *  - `statusFaturamento`/`saldoAFaturar`: A faturar → Parcialmente faturado → Faturado; "mesmo número": as partes somam o total;
 *  - `referenciaNota`: a nota da parte diz "(parcial 40%)"; a cheia e a medição comum seguem iguais;
 *  - `lerCorpoFaturar`: corpo vazio = cheio à vista; parcial por valor/percentual; inválido = 400 (nunca vira cheio por engano).
 */
import { describe, expect, it } from "vitest";
import {
  faturaParcial, percentualDoTotal, referenciaNota, ROTULO_STATUS_FATURAMENTO, rotuloParcial, saldoAFaturar, statusFaturamento, validarParcial,
  type Fatura,
} from "@/lib/faturamento/fatura";
import { lerCorpoFaturar } from "@/lib/faturamento/resposta";

const base: Fatura = {
  linhas: [
    { tipo: "SERVICO", descricao: "Manutenção", quantidade: 2, valorUnitario: 500, valorTotal: 1000, servicoId: "s1", orcamentoId: "o1" },
    { tipo: "SERVICO", descricao: "Deslocamento", quantidade: 1, valorUnitario: 333.33, valorTotal: 333.33, servicoId: null, orcamentoId: "o1" },
    { tipo: "PRODUTO", descricao: "Peça", quantidade: 3, valorUnitario: 55.56, valorTotal: 166.67, produtoId: "p1", orcamentoId: "o1" },
  ],
  valorTotal: 1500, descontoValor: 150, valorLiquido: 1350,
};
const soma = (f: Fatura) => Math.round(f.linhas.reduce((s, l) => s + l.valorTotal, 0) * 100) / 100;

describe("faturaParcial", () => {
  it("40%: linhas proporcionais, mantém serviço/produto/origem, quantidade 1, rótulo na descrição; líquido exato; total = líquido + desconto", () => {
    const f = faturaParcial(base, 540, "parcial 40%");
    expect(f.valorLiquido).toBe(540);
    expect(f.descontoValor).toBe(60);
    expect(f.valorTotal).toBe(600);
    expect(soma(f)).toBe(600);
    expect(f.linhas.map((l) => [l.tipo, l.descricao, l.quantidade, l.servicoId ?? null, l.produtoId ?? null, l.orcamentoId])).toEqual([
      ["SERVICO", "Manutenção — parcial 40%", 1, "s1", null, "o1"],
      ["SERVICO", "Deslocamento — parcial 40%", 1, null, null, "o1"],
      ["PRODUTO", "Peça — parcial 40%", 1, null, "p1", "o1"],
    ]);
    expect(f.linhas.map((l) => l.valorTotal)).toEqual([400, 133.33, 66.67]);
    expect(f.linhas.every((l) => l.valorUnitario === l.valorTotal)).toBe(true);
  });

  it("arredondamento: a última linha absorve a diferença para fechar ao centavo (soma das linhas = total da parte)", () => {
    // 1/3 de 1350 = 450,00 → linhas 333,33 + 111,11 + 55,56 = 500,00 = 450 + 50 de desconto ✓; agora um caso que não fecha sozinho
    const f = faturaParcial(base, 450.01, "parcial 33,33%");
    expect(f.valorLiquido).toBe(450.01);
    expect(soma(f)).toBe(f.valorTotal);
    const bruto = faturaParcial({ ...base, descontoValor: 0, valorTotal: 1350 }, 1, "parcial 0,07%");
    expect(bruto.valorLiquido).toBe(1);
    expect(soma(bruto)).toBe(1);
  });

  it("parte igual ao total: as linhas ficam com os valores cheios (só o rótulo e a quantidade mudam); valor acima do total não amplia", () => {
    const f = faturaParcial(base, 1350, "parcial 100%");
    expect([f.valorTotal, f.descontoValor, f.valorLiquido]).toEqual([1500, 150, 1350]);
    expect(f.linhas.map((l) => l.valorTotal)).toEqual([1000, 333.33, 166.67]);
    const g = faturaParcial(base, 5000, "parcial 100%");
    expect(g.linhas.map((l) => l.valorTotal)).toEqual([1000, 333.33, 166.67]);
    expect([g.valorTotal, g.descontoValor, g.valorLiquido]).toEqual([1500, 150, 1350]); // o teto é a fatura cheia
  });

  it("linha que vira zero sai; base vazia ou parte ≤ 0 → fatura vazia", () => {
    const f = faturaParcial({ linhas: [{ tipo: "SERVICO", descricao: "A", quantidade: 1, valorUnitario: 1000, valorTotal: 1000 }, { tipo: "PRODUTO", descricao: "B", quantidade: 1, valorUnitario: 0.01, valorTotal: 0.01 }], valorTotal: 1000.01, descontoValor: 0, valorLiquido: 1000.01 }, 10, "parcial 1%");
    expect(f.linhas.map((l) => l.descricao)).toEqual(["A — parcial 1%"]);
    expect(f.linhas[0].valorTotal).toBe(10);
    expect(faturaParcial(base, 0, "x")).toEqual({ linhas: [], valorTotal: 0, descontoValor: 0, valorLiquido: 0 });
    expect(faturaParcial({ linhas: [], valorTotal: 0, descontoValor: 0, valorLiquido: 0 }, 10, "x").linhas).toEqual([]);
  });
});

describe("validarParcial", () => {
  const f = { total: 1000, saldo: 600 };
  it("por percentual DO TOTAL (não do saldo); por valor; devolve a fatia em % do total", () => {
    expect(validarParcial(f, { percentual: 40 })).toEqual({ ok: true, valor: 400, percentual: 40 });
    expect(validarParcial(f, { valor: 250 })).toEqual({ ok: true, valor: 250, percentual: 25 });
    expect(validarParcial(f, { valor: 333.333 })).toEqual({ ok: true, valor: 333.33, percentual: 33.33 });
    // percentual presente manda, mesmo com valor junto
    expect(validarParcial(f, { valor: 999, percentual: 10 })).toEqual({ ok: true, valor: 100, percentual: 10 });
  });
  it("não passa do saldo: 1 centavo de folga arredonda ao saldo; mais que isso é recusado", () => {
    expect(validarParcial(f, { valor: 600 })).toEqual({ ok: true, valor: 600, percentual: 60 });
    expect(validarParcial(f, { valor: 600.01 })).toEqual({ ok: true, valor: 600, percentual: 60 });
    expect(validarParcial(f, { valor: 600.02 })).toEqual({ ok: false, erro: "A parte (600.02) passa do saldo a faturar (600.00)." });
    expect(validarParcial(f, { percentual: 60.01 })).toMatchObject({ ok: false });
    expect(validarParcial(f, { percentual: 100 })).toMatchObject({ ok: false, erro: expect.stringMatching(/passa do saldo/) });
    // 60% de 1000 = 600 = o saldo: fecha a origem
    expect(validarParcial(f, { percentual: 60 })).toEqual({ ok: true, valor: 600, percentual: 60 });
  });
  it("recusa zero, negativo, acima de 100%, vazio e saldo zerado", () => {
    expect(validarParcial(f, { valor: 0 })).toMatchObject({ ok: false, erro: "A parte a faturar precisa ser maior que zero." });
    expect(validarParcial(f, { valor: -5 })).toMatchObject({ ok: false });
    expect(validarParcial(f, { percentual: 0 })).toMatchObject({ ok: false, erro: "Informe um percentual entre 0 e 100." });
    expect(validarParcial(f, { percentual: 101 })).toMatchObject({ ok: false, erro: "Informe um percentual entre 0 e 100." });
    expect(validarParcial(f, {})).toMatchObject({ ok: false, erro: "Informe o valor ou o percentual da parte a faturar." });
    expect(validarParcial(f, { valor: null, percentual: null })).toMatchObject({ ok: false });
    expect(validarParcial(f, { valor: Number.NaN })).toMatchObject({ ok: false, erro: "Informe o valor ou o percentual da parte a faturar." });
    expect(validarParcial({ total: 1000, saldo: 0 }, { valor: 10 })).toEqual({ ok: false, erro: "Nada a faturar: a origem já está faturada." });
  });
});

describe("status e saldo", () => {
  it("A faturar → Parcialmente faturado → Faturado; saldo nunca negativo; rótulos", () => {
    expect(statusFaturamento({ total: 1000, faturado: 0 })).toBe("A_FATURAR");
    expect(statusFaturamento({ total: 1000, faturado: 400 })).toBe("PARCIAL");
    expect(statusFaturamento({ total: 1000, faturado: 999.99 })).toBe("PARCIAL");
    expect(statusFaturamento({ total: 1000, faturado: 1000 })).toBe("FATURADO");
    expect(statusFaturamento({ total: 1000, faturado: 1000.5 })).toBe("FATURADO");
    expect(saldoAFaturar(1000, 400)).toBe(600);
    expect(saldoAFaturar(1000, 1000.5)).toBe(0);
    expect(saldoAFaturar(0.3, 0.1)).toBe(0.2);
    expect(ROTULO_STATUS_FATURAMENTO).toEqual({ A_FATURAR: "A faturar", PARCIAL: "Parcialmente faturado", FATURADO: "Faturado" });
  });
  it("\"mesmo número\": as partes (40% + 35% + o resto) somam exatamente o total; o resto é o saldo", () => {
    const total = 1234.56;
    const a = validarParcial({ total, saldo: total }, { percentual: 40 });
    const b = validarParcial({ total, saldo: total - (a as any).valor }, { percentual: 35 });
    const saldo = saldoAFaturar(total, (a as any).valor + (b as any).valor);
    expect([(a as any).valor, (b as any).valor, saldo]).toEqual([493.82, 432.1, 308.64]);
    expect(Math.round(((a as any).valor + (b as any).valor + saldo) * 100) / 100).toBe(total);
    expect(statusFaturamento({ total, faturado: (a as any).valor + (b as any).valor + saldo })).toBe("FATURADO");
    expect(percentualDoTotal(saldo, total)).toBe(25);
  });
  it("rótulo da parte em pt-BR, sem casas desnecessárias", () => {
    expect(rotuloParcial(40)).toBe("parcial 40%");
    expect(rotuloParcial(33.33)).toBe("parcial 33,33%");
    expect(rotuloParcial(12.5)).toBe("parcial 12,5%");
  });
});

describe("referenciaNota (discriminação da NFS-e)", () => {
  it("parte: \"Fatura nº … (parcial 40%)\"; cheia: \"Fatura nº …\"; medição comum: \"Medição MED-…\"", () => {
    expect(referenciaNota({ numero: "MED-2026-0012", avulsa: true, faturaParcial: true, percentualFaturado: 40 })).toBe("Fatura nº 2026-0012 (parcial 40%)");
    expect(referenciaNota({ numero: "MED-2026-0012", avulsa: true, faturaParcial: true, percentualFaturado: "33.33" })).toBe("Fatura nº 2026-0012 (parcial 33,33%)");
    expect(referenciaNota({ numero: "MED-2026-0012", avulsa: true, faturaParcial: false, percentualFaturado: null })).toBe("Fatura nº 2026-0012");
    expect(referenciaNota({ numero: "MED-2026-0012", avulsa: true })).toBe("Fatura nº 2026-0012");
    expect(referenciaNota({ numero: "MED-2026-0012", avulsa: false, faturaParcial: true, percentualFaturado: 40 })).toBe("Medição MED-2026-0012");
  });
});

describe("lerCorpoFaturar", () => {
  const req = (corpo?: unknown) => new Request("http://x/api/faturar", { method: "POST", ...(corpo === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }) });
  it("sem corpo, corpo vazio ou JSON quebrado sem campos: cheio, à vista", async () => {
    expect(await lerCorpoFaturar(req())).toEqual({ ok: true, parcelamento: null, parcial: null });
    expect(await lerCorpoFaturar(req({}))).toEqual({ ok: true, parcelamento: null, parcial: null });
    expect(await lerCorpoFaturar(req("isto não é json"))).toEqual({ ok: true, parcelamento: null, parcial: null });
    expect(await lerCorpoFaturar(req({ parcial: null }))).toEqual({ ok: true, parcelamento: null, parcial: null });
    expect(await lerCorpoFaturar(req({ parcial: {} }))).toEqual({ ok: true, parcelamento: null, parcial: null });
  });
  it("parcial por valor ou percentual, com ou sem parcelamento", async () => {
    expect(await lerCorpoFaturar(req({ parcial: { valor: 400 } }))).toEqual({ ok: true, parcelamento: null, parcial: { valor: 400 } });
    expect(await lerCorpoFaturar(req({ parcial: { percentual: 40 }, parcelamento: { quantidade: 3 } }))).toEqual({ ok: true, parcelamento: { quantidade: 3 }, parcial: { percentual: 40 } });
  });
  it("inválido → 400 com mensagem (percentual > 100, valor ≤ 0, parcelas fora da faixa): nunca vira um \"Faturar\" cheio", async () => {
    for (const corpo of [{ parcial: { percentual: 101 } }, { parcial: { valor: 0 } }, { parcial: { valor: -1 } }, { parcial: { valor: "400" } }, { parcelamento: { quantidade: 0 } }, { parcelamento: { quantidade: 49 } }]) {
      const r = await lerCorpoFaturar(req(corpo));
      expect(r.ok, JSON.stringify(corpo)).toBe(false);
      if (!r.ok) {
        expect(r.resposta.status).toBe(400);
        expect(await r.resposta.json()).toEqual({ erro: "Pedido inválido: confira o valor ou o percentual da parte e as parcelas." });
      }
    }
  });
});
