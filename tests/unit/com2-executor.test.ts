/**
 * COM-2A — a regra pura da comissão do técnico: a unidade (equipamento atendido × linha), a divisão (igual, para
 * quem executou, % por cargo), a regra que vence para cada técnico, o alvo do gatilho (com a trava de qualidade e a
 * revisão do retorno), o retorno (o último serviço antes), o teto (pessoa vence cargo; o excedente vai para o mês
 * seguinte) e o que a tela manda.
 */
import { describe, expect, it } from "vitest";
import {
  aplicarTetos, alvoDoExecutor, chaveDoExecutor, comissoesDaUnidade, decisaoRevisaoSchema, ehOrigemDoRetorno, inicioDoMesSeguinte, motivoDoEstornoExecutor,
  partesDaDivisao, piorRevisao, tetoDaPessoa, tetoSchema, unidadesDaOs, type EstadoDoExecutor, type LinhaOs, type Participante,
} from "@/lib/comissoes/executor";
import { configComissaoSchema, normalizarRegra, regraSchema, type RegraComissao } from "@/lib/comissoes/regras";

const LIMPEZA: LinhaOs = { id: "l1", tipo: "SERVICO", servicoId: "sLimp", categoria: "Manutenção", descricao: "Limpeza", quantidade: 2, valorTotal: 300, custo: 60 };
const GAS: LinhaOs = { id: "l2", tipo: "PRODUTO", descricao: "Gás R410A", quantidade: 1, valorTotal: 90, custo: null };
const P = (usuarioId: string, cargoId: string | null = null, tecnicoId = `t-${usuarioId}`): Participante => ({ usuarioId, tecnicoId, cargoId, nome: usuarioId });
const regra = (r: Partial<RegraComissao>): RegraComissao => ({ id: r.id ?? "r", quemTipo: "TODOS", papel: "EXECUTOR", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 10, ...r });
const ESTADO: EstadoDoExecutor = { osViva: true, qualidade: true, osConcluida: true, aceite: true, fracao: 1, revisao: null };

describe("a unidade", () => {
  it("com equipamento: uma por (atendido × linha); a linha ÷ os VINCULADOS; o por item conta 1 por equipamento", () => {
    const us = unidadesDaOs([LIMPEZA, GAS], 3, [{ atividadeId: "a1", equipamentoId: "q1", feitoPorTecnicoId: "tC" }]);
    expect(us.map((u) => [u.tipo, u.equipamentoId, u.linhaId, u.item.venda, u.item.vendaLiquida, u.item.custo, u.item.quantidade, u.feitoPorTecnicoId])).toEqual([
      ["EQ", "q1", "l1", 100, 100, 20, 1, "tC"],
      ["EQ", "q1", "l2", 30, 30, null, 1, "tC"],
    ]);
    expect(us[0].item).toMatchObject({ tipo: "SERVICO", servicoId: "sLimp", categoria: "Manutenção" });
    // nenhum atendido: nada
    expect(unidadesDaOs([LIMPEZA], 2, [])).toEqual([]);
  });
  it("sem equipamento vinculado: a linha inteira, com a quantidade dela", () => {
    const [u] = unidadesDaOs([LIMPEZA], 0, [{ atividadeId: "a1", equipamentoId: "q1" }]);
    expect([u.tipo, u.atividadeId, u.equipamentoId, u.item.venda, u.item.quantidade, u.item.custo]).toEqual(["LINHA", null, null, 300, 2, 60]);
  });
  it("a chave única", () => {
    expect(chaveDoExecutor("os1", { atividadeId: "a1", equipamentoId: "q1", linhaId: "l1" }, "u1")).toBe("EXEC:os1:a1:q1:l1:u1");
    expect(chaveDoExecutor("os1", { atividadeId: null, equipamentoId: null, linhaId: "l1" }, "u1")).toBe("EXEC:os1:-:-:l1:u1");
  });
});

describe("a divisão", () => {
  const tres = [P("u1", "cgTec", "t1"), P("u2", "cgAj", "t2"), P("u3", "cgAj", "t3")];
  it("igual: 1/n (4 casas)", () => {
    expect([...partesDaDivisao("IGUAL", tres).values()]).toEqual([0.3333, 0.3333, 0.3333]);
    expect([...partesDaDivisao(null, tres.slice(0, 2)).values()]).toEqual([0.5, 0.5]);
    expect(partesDaDivisao("IGUAL", []).size).toBe(0);
  });
  it("para quem executou: tudo para quem marcou; quem marcou não está, ou ninguém marcou: igual", () => {
    expect([...partesDaDivisao("POR_EXECUTOR", tres, { feitoPorTecnicoId: "t2" }).entries()]).toEqual([["u1", 0], ["u2", 1], ["u3", 0]]);
    expect([...partesDaDivisao("POR_EXECUTOR", tres, { feitoPorTecnicoId: "outro" }).values()]).toEqual([0.3333, 0.3333, 0.3333]);
    expect([...partesDaDivisao("POR_EXECUTOR", tres, {}).values()]).toEqual([0.3333, 0.3333, 0.3333]);
  });
  it("% por cargo: normalizado sobre quem está lá (60/40 com dois ajudantes = 60/20/20); sem cargo com %: igual", () => {
    expect([...partesDaDivisao("POR_CARGO", tres, { divisaoCargos: { cgTec: 60, cgAj: 40 } }).values()]).toEqual([0.4286, 0.2857, 0.2857]);
    expect([...partesDaDivisao("POR_CARGO", tres.slice(0, 2), { divisaoCargos: { cgTec: 6, cgAj: 4 } }).values()]).toEqual([0.6, 0.4]);
    expect([...partesDaDivisao("POR_CARGO", [P("u1", "cgTec"), P("u2", null)], { divisaoCargos: { cgTec: 60 } }).values()]).toEqual([1, 0]);
    expect([...partesDaDivisao("POR_CARGO", tres, { divisaoCargos: { outro: 50 } }).values()]).toEqual([0.3333, 0.3333, 0.3333]);
    expect([...partesDaDivisao("POR_CARGO", tres, { divisaoCargos: null }).values()]).toEqual([0.3333, 0.3333, 0.3333]);
  });
});

describe("o valor de cada técnico", () => {
  const [u] = unidadesDaOs([LIMPEZA], 3, [{ atividadeId: "a1", equipamentoId: "q1", feitoPorTecnicoId: "t1" }]);
  it("cada um pela regra que vence para ELE × a parte dele pela divisão DAQUELA regra", () => {
    const regras = [regra({ id: "rTodos", valor: 10 }), regra({ id: "rAna", quemTipo: "PESSOA", usuarioId: "u2", valor: 20, divisao: "IGUAL" })];
    const r = comissoesDaUnidade(u, [P("u1", null, "t1"), P("u2", null, "t2")], regras, false);
    expect(r.map((x) => [x.participante.usuarioId, x.regra.id, x.parte, x.divisao, x.baseValor, x.taxa, x.valor])).toEqual([
      ["u1", "rTodos", 0.5, "IGUAL", 100, 10, 5],
      ["u2", "rAna", 0.5, "IGUAL", 100, 20, 10],
    ]);
  });
  it("sem regra de Executor, ou parte zero, ou valor zero: não entra; regra de Vendedor não vale aqui", () => {
    expect(comissoesDaUnidade(u, [P("u1")], [regra({ papel: "VENDEDOR" })], false)).toEqual([]);
    expect(comissoesDaUnidade(u, [P("u1", null, "t1"), P("u2", null, "t2")], [regra({ divisao: "POR_EXECUTOR" })], false).map((x) => x.participante.usuarioId)).toEqual(["u1"]);
    expect(comissoesDaUnidade(u, [P("u1")], [regra({ base: "PERC_LUCRO", valor: 10 })], false).map((x) => x.valor)).toEqual([8]); // (100 − 20) × 10%
    const semCusto = unidadesDaOs([{ ...LIMPEZA, custo: null }], 1, [{ atividadeId: "a1", equipamentoId: "q1" }])[0];
    expect(comissoesDaUnidade(semCusto, [P("u1")], [regra({ base: "PERC_LUCRO" })], false)).toEqual([]);
  });
  it("valor fixo: R$ por equipamento atendido, dividido", () => {
    const r = comissoesDaUnidade(u, [P("u1"), P("u2")], [regra({ base: "FIXO_ITEM", valor: 25 })], false);
    expect(r.map((x) => [x.baseValor, x.valor])).toEqual([[1, 12.5], [1, 12.5]]);
  });
});

describe("quando fica devida", () => {
  const c = { valor: 40, quando: "CONCLUSAO_OS" as const };
  it("cada gatilho: conclusão da OS, aceite do cliente, recebimento (proporcional)", () => {
    expect(alvoDoExecutor(c, ESTADO, 0)).toBe(40);
    expect(alvoDoExecutor(c, { ...ESTADO, osConcluida: false }, 0)).toBe(0);
    expect(alvoDoExecutor({ ...c, quando: "ACEITE" }, { ...ESTADO, aceite: false }, 0)).toBe(0);
    expect(alvoDoExecutor({ ...c, quando: "ACEITE" }, { ...ESTADO, osConcluida: false }, 0)).toBe(40);
    expect(alvoDoExecutor({ ...c, quando: "RECEBIMENTO" }, { ...ESTADO, fracao: 0.25 }, 0)).toBe(10);
    expect(alvoDoExecutor({ ...c, quando: "RECEBIMENTO" }, { ...ESTADO, fracao: 1.5 }, 0)).toBe(40);
    expect(alvoDoExecutor({ ...c, quando: "RECEBIMENTO" }, { ...ESTADO, fracao: -1 }, 0)).toBe(0);
  });
  it("sem qualidade, OS cancelada ou retorno confirmado: zero; em revisão: não libera mais do que já estava; mantida: normal", () => {
    expect(alvoDoExecutor(c, { ...ESTADO, qualidade: false }, 40)).toBe(0);
    expect(alvoDoExecutor(c, { ...ESTADO, osViva: false }, 40)).toBe(0);
    expect(alvoDoExecutor(c, { ...ESTADO, revisao: "ESTORNAR" }, 40)).toBe(0);
    expect(alvoDoExecutor(c, { ...ESTADO, revisao: "A_REVISAR" }, 0)).toBe(0);
    expect(alvoDoExecutor(c, { ...ESTADO, revisao: "A_REVISAR" }, 40)).toBe(40);
    expect(alvoDoExecutor(c, { ...ESTADO, revisao: "A_REVISAR", osConcluida: false }, 40)).toBe(0);
    expect(alvoDoExecutor(c, { ...ESTADO, revisao: "MANTER" }, 0)).toBe(40);
  });
  it("a revisão que manda e o motivo do estorno", () => {
    expect(piorRevisao(["MANTER", "A_REVISAR"])).toBe("A_REVISAR");
    expect(piorRevisao(["A_REVISAR", "ESTORNAR", "MANTER"])).toBe("ESTORNAR");
    expect(piorRevisao(["MANTER"])).toBe("MANTER");
    expect(piorRevisao([])).toBeNull();
    expect(motivoDoEstornoExecutor({ ...ESTADO, osViva: false, revisao: "ESTORNAR" })).toBe("OS cancelada");
    expect(motivoDoEstornoExecutor({ ...ESTADO, revisao: "ESTORNAR", qualidade: false })).toMatch(/^Retorno no mesmo equipamento/);
    expect(motivoDoEstornoExecutor({ ...ESTADO, qualidade: false })).toMatch(/relatório do equipamento ficou incompleto/);
    expect(motivoDoEstornoExecutor(ESTADO)).toMatch(/gatilho deixou de valer/);
  });
});

describe("o retorno", () => {
  const dia = (d: number) => new Date(Date.UTC(2027, 0, d));
  const servicos = [
    { atividadeId: "a1", ordemServicoId: "os1", feitoEm: dia(1) },
    { atividadeId: "a2", ordemServicoId: "os2", feitoEm: dia(10) },
  ];
  it("volta do ÚLTIMO serviço antes da OS do retorno, dentro dos dias; 0 dias = desligado", () => {
    const ret = { ordemServicoId: "osR", abertaEm: dia(15) };
    expect(ehOrigemDoRetorno(servicos, ret, 30, { atividadeId: "a2" })).toBe(true);
    expect(ehOrigemDoRetorno(servicos, ret, 30, { atividadeId: "a1" })).toBe(false);
    expect(ehOrigemDoRetorno(servicos, ret, 4, { atividadeId: "a2" })).toBe(false);
    expect(ehOrigemDoRetorno(servicos, ret, 0, { atividadeId: "a2" })).toBe(false);
    // a própria OS não é retorno dela mesma
    expect(ehOrigemDoRetorno(servicos, { ordemServicoId: "os2", abertaEm: dia(15) }, 30, { atividadeId: "a2" })).toBe(false);
  });
});

describe("o teto", () => {
  const tetos = [
    { quemTipo: "CARGO" as const, cargoId: "cgTec", valor: 1000 },
    { quemTipo: "PESSOA" as const, usuarioId: "u1", valor: 1500 },
    { quemTipo: "CARGO" as const, cargoId: "cgTec", valor: 800 },
    { quemTipo: "PESSOA" as const, usuarioId: "u9", valor: 10, ativo: false },
  ];
  it("a pessoa vence o cargo; dois do mesmo nível = o menor; inativo não vale; sem teto = null", () => {
    expect(tetoDaPessoa(tetos, { usuarioId: "u1", cargoId: "cgTec" })).toBe(1500);
    expect(tetoDaPessoa(tetos, { usuarioId: "u2", cargoId: "cgTec" })).toBe(800);
    expect(tetoDaPessoa(tetos, { usuarioId: "u9", cargoId: null })).toBeNull();
    expect(tetoDaPessoa(tetos, { usuarioId: "u3", cargoId: "outro" })).toBeNull();
  });
  it("quem passou recebe o teto e o excedente vai para o mês seguinte; quem não passou, nada muda", () => {
    const pessoas = [{ usuarioId: "u1", nome: "Carlos", tecnicoId: "t1", valor: 2000 }, { usuarioId: "u2", nome: "Ana", tecnicoId: "t2", valor: 700 }, { usuarioId: "u3", nome: "Bia", tecnicoId: null, valor: 900 }];
    const r = aplicarTetos(pessoas, tetos, new Map([["u1", "cgTec"], ["u2", "cgTec"], ["u3", "cgTec"]]));
    expect(r.pessoas.map((p) => [p.usuarioId, p.valor])).toEqual([["u1", 1500], ["u2", 700], ["u3", 800]]);
    expect(r.excedentes).toEqual([{ usuarioId: "u1", nome: "Carlos", excedente: 500, teto: 1500 }, { usuarioId: "u3", nome: "Bia", excedente: 100, teto: 800 }]);
    expect(aplicarTetos(pessoas, [], new Map()).excedentes).toEqual([]);
  });
  it("o excedente cai no 1º dia do mês seguinte (dezembro → janeiro)", () => {
    expect(inicioDoMesSeguinte("2027-01").toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect(inicioDoMesSeguinte("2027-12").toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });
});

describe("o que a tela manda", () => {
  it("regra do Executor: a divisão; % por cargo exige um cargo com %; o vendedor fica sem divisão", () => {
    const base = { quemTipo: "TODOS", sobreTipo: "TODOS_SERVICOS", base: "PERC_VENDA", valor: 5, papel: "EXECUTOR" };
    expect(regraSchema.safeParse({ ...base, divisao: "POR_CARGO" }).success).toBe(false);
    expect(regraSchema.safeParse({ ...base, divisao: "POR_CARGO", divisaoCargos: { cgTec: 0 } }).success).toBe(false);
    expect(regraSchema.safeParse({ ...base, divisao: "POR_CARGO", divisaoCargos: { cgTec: 101 } }).success).toBe(false);
    expect(regraSchema.safeParse({ ...base, divisao: "OUTRA" }).success).toBe(false);
    const ok = regraSchema.parse({ ...base, divisao: "POR_CARGO", divisaoCargos: { cgTec: "60", cgAj: 0 } });
    expect(normalizarRegra(ok)).toMatchObject({ divisao: "POR_CARGO", divisaoCargos: { cgTec: 60 } });
    expect(normalizarRegra(regraSchema.parse({ ...base, divisao: "POR_EXECUTOR", divisaoCargos: { cgTec: 60 } }))).toMatchObject({ divisao: "POR_EXECUTOR", divisaoCargos: null });
    expect(normalizarRegra(regraSchema.parse({ ...base, papel: "VENDEDOR", divisao: "POR_EXECUTOR" }))).toMatchObject({ divisao: "IGUAL", divisaoCargos: null });
    expect(normalizarRegra(regraSchema.parse(base))).toMatchObject({ divisao: "IGUAL" });
  });
  it("configuração: os campos do técnico são opcionais (a tela antiga manda só os dois de antes); dias de 0 a 365", () => {
    expect(configComissaoSchema.safeParse({ quando: "RECEBIMENTO", liquidaImpostos: false }).success).toBe(true);
    expect(configComissaoSchema.safeParse({ quando: "RECEBIMENTO", liquidaImpostos: false, executorQuando: "ACEITE", retornoDias: "45", tiposRetorno: ["t1"] }).success).toBe(true);
    expect(configComissaoSchema.safeParse({ quando: "RECEBIMENTO", liquidaImpostos: false, executorQuando: "APROVACAO" }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ quando: "RECEBIMENTO", liquidaImpostos: false, retornoDias: 366 }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ quando: "RECEBIMENTO", liquidaImpostos: false, retornoDias: -1 }).success).toBe(false);
    expect(configComissaoSchema.safeParse({ quando: "RECEBIMENTO", liquidaImpostos: false, retornoDias: 1.5 }).success).toBe(false);
  });
  it("teto: pessoa ou cargo exigido conforme o tipo; valor maior que zero", () => {
    expect(tetoSchema.safeParse({ quemTipo: "PESSOA", valor: 100 }).success).toBe(false);
    expect(tetoSchema.safeParse({ quemTipo: "CARGO", valor: 100 }).success).toBe(false);
    expect(tetoSchema.safeParse({ quemTipo: "CARGO", cargoId: "c", valor: 0 }).success).toBe(false);
    expect(tetoSchema.safeParse({ quemTipo: "PESSOA", usuarioId: "u", valor: "1500.5" }).success).toBe(true);
    expect(tetoSchema.safeParse({ quemTipo: "TODOS", valor: 100 }).success).toBe(false);
  });
  it("revisão: estornar ou manter, com motivo (mínimo 5)", () => {
    expect(decisaoRevisaoSchema.safeParse({ decisao: "ESTORNAR", motivo: "abc" }).success).toBe(false);
    expect(decisaoRevisaoSchema.safeParse({ decisao: "OUTRA", motivo: "motivo longo" }).success).toBe(false);
    expect(decisaoRevisaoSchema.safeParse({ decisao: "MANTER", motivo: "  outro defeito  " }).success).toBe(true);
  });
});
