/**
 * COM-1.1 — as regras puras das decisões do #282:
 *  - (3) fatura/título cancelado estorna a comissão dos gatilhos "na aprovação" e "na conclusão" (o recebimento não muda);
 *  - (6) a "data de emissão" é a da FATURA/NF (NFS-e autorizada > NF registrada > enviada > 1º título), e a vista por
 *    emissão conta a parte de cada fatura viva emitida no mês;
 *  - (5) o vencimento da conta a pagar do fechamento: N-º dia útil (seg–sex) ou dia fixo do mês seguinte; nunca antes de hoje;
 *  - (8) a lista de clientes não ordena pela contagem de OS para quem tem "Ver só os próprios".
 */
import { describe, expect, it } from "vitest";
import {
  alvoLiberado, configComissaoSchema, dataDeEmissao, dataDoVencimento, descricaoDoVencimento, faturaFoiCancelada, fracaoEmitidaNoPeriodo,
  lerVencimento, ROTULO_QUANDO, ultimaEmissaoNoPeriodo, vendaComFaturaCancelada, VENCIMENTO_PADRAO, type FaturaDaVenda,
} from "@/lib/comissoes/regras";
import { vencimentoDoFechamento } from "@/lib/desempenho/fechamento-server";
import { ordemSemVolumeDosOutros } from "@/lib/escopo/proprios";
import { montarPermissoes } from "@/lib/permissoes";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const iso = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;
const viva = (emitidaEm: string | null, daVenda: number): FaturaDaVenda => ({ cancelada: false, emitidaEm: emitidaEm ? d(emitidaEm) : null, daVenda });
const cancelada = (emitidaEm: string | null, daVenda: number): FaturaDaVenda => ({ cancelada: true, emitidaEm: emitidaEm ? d(emitidaEm) : null, daVenda });

describe("(3) fatura cancelada", () => {
  it("a medição cancelada, ou TODOS os títulos cancelados, é fatura cancelada; sem título ou com um vivo, não", () => {
    expect(faturaFoiCancelada("CANCELADA", [])).toBe(true);
    expect(faturaFoiCancelada("CANCELADA", [{ cancelado: false }])).toBe(true);
    expect(faturaFoiCancelada("APROVADA", [{ cancelado: true }, { cancelado: true }])).toBe(true);
    expect(faturaFoiCancelada("APROVADA", [{ cancelado: true }, { cancelado: false }])).toBe(false);
    expect(faturaFoiCancelada("APROVADA", [])).toBe(false); // sem título não há o que cancelar
    expect(faturaFoiCancelada("RASCUNHO", [])).toBe(false);
  });

  it("a venda perdeu a fatura só quando alguma foi cancelada e NENHUMA ficou viva (refaturar devolve)", () => {
    expect(vendaComFaturaCancelada([])).toBe(false); // nunca faturou: a venda vale
    expect(vendaComFaturaCancelada([cancelada("2027-01-10", 100)])).toBe(true);
    expect(vendaComFaturaCancelada([cancelada("2027-01-10", 100), viva(null, 100)])).toBe(false); // refaturou (mesmo em rascunho)
    expect(vendaComFaturaCancelada([viva("2027-01-10", 100)])).toBe(false);
  });

  it("alvo: na aprovação e na conclusão, fatura cancelada zera; no recebimento, o dinheiro manda", () => {
    const e = { statusOrcamento: "APROVADO", osConcluida: true, fracao: 0.5 };
    expect(alvoLiberado({ valor: 100, quando: "APROVACAO" }, e)).toBe(100);
    expect(alvoLiberado({ valor: 100, quando: "APROVACAO" }, { ...e, faturaCancelada: true })).toBe(0);
    expect(alvoLiberado({ valor: 100, quando: "CONCLUSAO_OS" }, e)).toBe(100);
    expect(alvoLiberado({ valor: 100, quando: "CONCLUSAO_OS" }, { ...e, faturaCancelada: true })).toBe(0);
    expect(alvoLiberado({ valor: 100, quando: "RECEBIMENTO" }, { ...e, faturaCancelada: true })).toBe(50);
    expect(alvoLiberado({ valor: 100, quando: "APROVACAO" }, { ...e, faturaCancelada: false })).toBe(100);
  });

  it("o gatilho 'na aprovação' não se chama mais 'data de emissão' (emissão agora é a da fatura)", () => {
    expect(ROTULO_QUANDO.APROVACAO).toBe("Na aprovação do orçamento");
  });
});

describe("(6) a data de emissão da fatura", () => {
  it("precedência: NFS-e autorizada (a mais antiga) > NF registrada > enviada > 1º título; nada = não emitida", () => {
    const tudo = { nfseAutorizadas: [d("2027-01-20"), d("2027-01-18")], nfsRegistradas: [d("2027-01-15")], enviadaEm: d("2027-01-10"), titulosEm: [d("2027-01-05")] };
    expect(iso(dataDeEmissao(tudo))).toBe("2027-01-18");
    expect(iso(dataDeEmissao({ ...tudo, nfseAutorizadas: [null] }))).toBe("2027-01-15");
    expect(iso(dataDeEmissao({ ...tudo, nfseAutorizadas: [], nfsRegistradas: [] }))).toBe("2027-01-10");
    expect(iso(dataDeEmissao({ titulosEm: [d("2027-01-09"), d("2027-01-05")] }))).toBe("2027-01-05");
    expect(dataDeEmissao({})).toBeNull();
    expect(dataDeEmissao({ nfseAutorizadas: [new Date("invalida")], enviadaEm: null, titulosEm: [] })).toBeNull();
  });

  it("vista por emissão: a parte das faturas vivas emitidas no mês, acumulada sem passar do total da venda", () => {
    const ini = d("2027-02-01"), fim = d("2027-03-01");
    // Venda de 1.000: 400 emitidos em jan, 600 em fev → fevereiro vale 60%
    expect(fracaoEmitidaNoPeriodo([viva("2027-01-10", 400), viva("2027-02-10", 600)], 1000, ini, fim)).toBeCloseTo(0.6);
    expect(fracaoEmitidaNoPeriodo([viva("2027-01-10", 400), viva("2027-02-10", 600)], 1000, d("2027-01-01"), ini)).toBeCloseTo(0.4);
    // Cancelada e rascunho (sem emissão) não contam
    expect(fracaoEmitidaNoPeriodo([cancelada("2027-02-10", 600), viva(null, 600)], 1000, ini, fim)).toBe(0);
    // Faturar a mais não gera comissão a mais: 900 em jan + 900 em fev → fev só leva o que faltava (10%)
    expect(fracaoEmitidaNoPeriodo([viva("2027-01-10", 900), viva("2027-02-10", 900)], 1000, ini, fim)).toBeCloseTo(0.1);
    expect(fracaoEmitidaNoPeriodo([viva("2027-02-10", 500)], 0, ini, fim)).toBe(0);
    // A data mostrada: a última emissão viva dentro do mês
    expect(iso(ultimaEmissaoNoPeriodo([viva("2027-02-03", 1), viva("2027-02-20", 1), cancelada("2027-02-25", 1), viva("2027-03-01", 1)], ini, fim))).toBe("2027-02-20");
    expect(ultimaEmissaoNoPeriodo([viva(null, 1)], ini, fim)).toBeNull();
  });
});

describe("(5) o vencimento da conta a pagar do fechamento", () => {
  it("N-º dia útil do mês seguinte (seg–sex), virando o ano em dezembro; o padrão é o 5º", () => {
    expect(VENCIMENTO_PADRAO).toEqual({ tipo: "DIA_UTIL", dia: 5 });
    // fev/2027 começa numa segunda: 1º útil = 01/02, 5º = 05/02, 6º = 08/02 (pula o fim de semana)
    expect(iso(dataDoVencimento("2027-01", { tipo: "DIA_UTIL", dia: 1 }))).toBe("2027-02-01");
    expect(iso(dataDoVencimento("2027-01", { tipo: "DIA_UTIL", dia: 5 }))).toBe("2027-02-05");
    expect(iso(dataDoVencimento("2027-01", { tipo: "DIA_UTIL", dia: 6 }))).toBe("2027-02-08");
    expect(iso(dataDoVencimento("2027-01", { tipo: "DIA_UTIL", dia: 20 }))).toBe("2027-02-26");
    // mai/2027 começa num sábado: 1º útil = 03/05
    expect(iso(dataDoVencimento("2027-04", { tipo: "DIA_UTIL", dia: 1 }))).toBe("2027-05-03");
    // dezembro → janeiro do ano seguinte (01/01/2027 é sexta)
    expect(iso(dataDoVencimento("2026-12", { tipo: "DIA_UTIL", dia: 1 }))).toBe("2027-01-01");
    expect(iso(dataDoVencimento("2026-12", { tipo: "DIA_UTIL", dia: 2 }))).toBe("2027-01-04");
  });

  it("dia fixo: o dia N do mês seguinte; além do fim do mês, o último dia", () => {
    expect(iso(dataDoVencimento("2027-01", { tipo: "DIA_FIXO", dia: 10 }))).toBe("2027-02-10");
    expect(iso(dataDoVencimento("2027-01", { tipo: "DIA_FIXO", dia: 31 }))).toBe("2027-02-28");
    expect(iso(dataDoVencimento("2027-03", { tipo: "DIA_FIXO", dia: 31 }))).toBe("2027-04-30");
    expect(iso(dataDoVencimento("2026-12", { tipo: "DIA_FIXO", dia: 31 }))).toBe("2027-01-31");
  });

  it("nunca antes de hoje; sem configuração, o padrão", () => {
    expect(iso(vencimentoDoFechamento("2027-01", d("2027-01-31")))).toBe("2027-02-05");
    expect(iso(vencimentoDoFechamento("2027-01", d("2027-03-02")))).toBe("2027-03-02"); // fechou atrasado: vence hoje
    expect(iso(vencimentoDoFechamento("2027-01", d("2027-02-05")))).toBe("2027-02-05");
    expect(iso(vencimentoDoFechamento("2027-01", d("2027-01-31"), { tipo: "DIA_FIXO", dia: 15 }))).toBe("2027-02-15");
  });

  it("lerVencimento: o que veio do banco, saneado (tipo desconhecido ou dia fora do limite volta ao padrão)", () => {
    expect(lerVencimento("DIA_FIXO", 31)).toEqual({ tipo: "DIA_FIXO", dia: 31 });
    expect(lerVencimento("DIA_UTIL", 20)).toEqual({ tipo: "DIA_UTIL", dia: 20 });
    expect(lerVencimento("DIA_UTIL", 21)).toEqual({ tipo: "DIA_UTIL", dia: 5 });
    expect(lerVencimento("DIA_FIXO", 0)).toEqual({ tipo: "DIA_FIXO", dia: 5 });
    expect(lerVencimento("QUALQUER", 3)).toEqual({ tipo: "DIA_UTIL", dia: 3 });
    expect(lerVencimento(undefined, undefined)).toEqual(VENCIMENTO_PADRAO);
    expect(lerVencimento("DIA_UTIL", 2.5)).toEqual({ tipo: "DIA_UTIL", dia: 5 });
  });

  it("a frase da tela e a validação do PUT (tipo e dia juntos; limites por tipo)", () => {
    expect(descricaoDoVencimento({ tipo: "DIA_UTIL", dia: 5 })).toBe("5º dia útil do mês seguinte");
    expect(descricaoDoVencimento({ tipo: "DIA_FIXO", dia: 10 })).toBe("Dia 10 do mês seguinte");
    const base = { quando: "RECEBIMENTO", liquidaImpostos: false };
    expect(configComissaoSchema.safeParse(base).success).toBe(true);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoTipo: "DIA_UTIL", vencimentoDia: 20 }).success).toBe(true);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoTipo: "DIA_UTIL", vencimentoDia: 21 }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoTipo: "DIA_FIXO", vencimentoDia: 31 }).success).toBe(true);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoTipo: "DIA_FIXO", vencimentoDia: 32 }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoTipo: "DIA_FIXO", vencimentoDia: 0 }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoTipo: "DIA_FIXO" }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoDia: 5 }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ ...base, vencimentoTipo: "DIA_FIXO", vencimentoDia: 1.5 }).success).toBe(false);
  });
});

describe("(8) a lista de clientes não ordena pelo volume dos outros", () => {
  const vendedor = { id: "u1", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar", "verSoProprios"] }) };
  const gestor = { id: "u2", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar"] }) };
  it("com a marca em OS, a ordem pela contagem de OS volta ao padrão; as outras ordens e quem não tem a marca, não", () => {
    expect(ordemSemVolumeDosOutros(vendedor, { campo: "os", dir: "desc" })).toEqual({ campo: null, dir: "desc" });
    expect(ordemSemVolumeDosOutros(vendedor, { campo: "nome", dir: "asc" })).toEqual({ campo: "nome", dir: "asc" });
    expect(ordemSemVolumeDosOutros(gestor, { campo: "os", dir: "desc" })).toEqual({ campo: "os", dir: "desc" });
    expect(ordemSemVolumeDosOutros({ ...vendedor, role: "ADMIN" }, { campo: "os", dir: "desc" })).toEqual({ campo: "os", dir: "desc" });
  });
});
