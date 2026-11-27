/**
 * Painel de pendências — regras puras: quem vê cada grupo (escopo do sino), o catálogo (áreas, ordem, zero
 * some, o destino do toque), a OS sem técnico e o orçamento vencendo como `where`, e os filtros das listas.
 */
import { describe, expect, it } from "vitest";
import { PRESETS, montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { escopoDoSino } from "@/lib/alertas/sino";
import { CONTAS_HOJE, PENDENCIAS, escopoDoItem, itemPendencia, painelDePendencias, totalDoPainel, type DadosPendencias } from "@/lib/alertas/pendencias";
import { ATIVIDADE_EM_ABERTO, whereOsSemTecnico } from "@/lib/os/sem-tecnico";
import { DIAS_ORCAMENTO_VENCENDO_PADRAO, whereOrcamentoVencendo } from "@/lib/orcamentos/ciclo";
import { whereOrcamentos, whereOrdens } from "@/lib/listas/filtros";

const NOVOS = ["osSemTecnico", "orcamentosVencendo", "contasPagarHoje", "contasReceberHoje"] as const;
const grupos = (p: Parameters<typeof escopoDoSino>[0]) => { const e = escopoDoSino(p); return NOVOS.filter((k) => e[k]); };

const ZERO: DadosPendencias = {
  osSemTecnico: 0, osSemTecnicoId: null, atendimentosAtraso: 0, atividadesEsquecidas: 0, atividadeEsquecidaOsId: null,
  comentariosCampo: 0, comentarioCampoOsId: null, pmocsVencendo: 0, orcamentosVencendo: 0, orcamentoVencendoId: null,
  despesasCampo: 0, estoqueNegativoCampo: 0, foraDoNumero: { contasPagarHoje: 0, contasReceberHoje: 0 },
};
const TUDO = escopoDoSino({ permissoes: permissoesTotais(), role: "ADMIN", restrito: false });

describe("escopo: quem vê os quatro grupos novos", () => {
  it("administrador vê os quatro; o técnico no modo técnico, nenhum (mesmo com OS e financeiro no perfil)", () => {
    expect(grupos({ permissoes: permissoesTotais(), role: "ADMIN", restrito: false })).toEqual([...NOVOS]);
    expect(grupos({ permissoes: permissoesTotais(), role: "ADMIN", restrito: true })).toEqual([]);
    expect(grupos({ permissoes: PRESETS.TECNICO, role: "TECNICO", restrito: true })).toEqual([]);
  });

  it("cada grupo pela permissão da tela que o toque abre", () => {
    const so = (p: Record<string, string[]>) => grupos({ permissoes: montarPermissoes(p as never), role: "OPERADOR", restrito: false });
    expect(so({ ordens: ["visualizar"] })).toEqual(["osSemTecnico"]);
    expect(so({ orcamentos: ["visualizar"] })).toEqual(["orcamentosVencendo"]);
    // Contas a pagar: Financeiro › Visualizar (a página); Contas a receber: Financeiro › Contas a receber
    expect(so({ financeiro: ["visualizar"] })).toEqual(["contasPagarHoje"]);
    expect(so({ financeiro: ["contasReceber"] })).toEqual(["contasReceberHoje"]);
    expect(so({ estoque: ["visualizar"], pmoc: ["visualizar"] })).toEqual([]);
  });
});

describe("catálogo do painel", () => {
  it("áreas na ordem (Operação, Comercial, Financeiro, Estoque), itens na ordem do catálogo; zero não aparece", () => {
    const d: DadosPendencias = { ...ZERO, atendimentosAtraso: 2, osSemTecnico: 1, osSemTecnicoId: "os1", estoqueNegativoCampo: 3, despesasCampo: 1, foraDoNumero: { contasPagarHoje: 0, contasReceberHoje: 4 } };
    const areas = painelDePendencias(d, TUDO);
    expect(areas.map((a) => [a.rotulo, a.itens.map((i) => i.id)])).toEqual([
      ["Operação", ["osSemTecnico", "osAtrasadas"]],
      ["Financeiro", ["despesasCampo", "contasReceberHoje"]],
      ["Estoque", ["estoqueNegativoCampo"]],
    ]);
    expect(totalDoPainel(areas)).toBe(11);
  });

  it("nada pendente: nenhuma área; sem o escopo, o item some mesmo com número", () => {
    expect(painelDePendencias(ZERO, TUDO)).toEqual([]);
    const soFinanceiro = escopoDoSino({ permissoes: montarPermissoes({ financeiro: ["visualizar"] } as never), role: "OPERADOR", restrito: false });
    const d = { ...ZERO, osSemTecnico: 5, orcamentosVencendo: 2, foraDoNumero: { contasPagarHoje: 1, contasReceberHoje: 3 } };
    expect(painelDePendencias(d, soFinanceiro).flatMap((a) => a.itens.map((i) => [i.id, i.valor]))).toEqual([["contasPagarHoje", 1]]);
  });

  it("o toque: um registro só (com o id) abre o registro; vários, ou sem o id, a lista filtrada", () => {
    const h = (id: keyof typeof PENDENCIAS, d: Partial<DadosPendencias>) => itemPendencia(id, { ...ZERO, ...d }).href;
    expect(h("osSemTecnico", { osSemTecnico: 1, osSemTecnicoId: "os9" })).toBe("/ordens/os9");
    expect(h("osSemTecnico", { osSemTecnico: 2, osSemTecnicoId: "os9" })).toBe("/ordens?tecnico=sem&periodo=todos");
    expect(h("osSemTecnico", { osSemTecnico: 1, osSemTecnicoId: null })).toBe("/ordens?tecnico=sem&periodo=todos");
    expect(h("orcamentosVencendo", { orcamentosVencendo: 1, orcamentoVencendoId: "o3" })).toBe("/orcamentos/o3");
    expect(h("orcamentosVencendo", { orcamentosVencendo: 3, orcamentoVencendoId: "o3" })).toBe("/orcamentos?validade=vencendo&periodo=todos");
    // os do sino continuam com o mesmo destino de antes
    expect(h("comentariosCampo", { comentariosCampo: 2, comentarioCampoOsId: "os4" })).toBe("/ordens/os4#comentarios");
    expect(h("comentariosCampo", { comentariosCampo: 2, comentarioCampoOsId: null })).toBe("/ordens#comentarios");
    expect(h("atividadesEsquecidas", { atividadesEsquecidas: 1, atividadeEsquecidaOsId: "os5" })).toBe("/ordens/os5");
    expect(h("atividadesEsquecidas", { atividadesEsquecidas: 1, atividadeEsquecidaOsId: null })).toBe("/ordens");
    expect(h("contasPagarHoje", {})).toBe(`/financeiro/contas-pagar?${CONTAS_HOJE}`);
    expect(h("contasReceberHoje", {})).toBe("/financeiro/contas-receber?card=VENCE_HOJE&periodo=hoje");
  });

  it("número que não veio (resposta de versão anterior) conta como zero; as contas sem 'foraDoNumero' também", () => {
    const { foraDoNumero: _, ...semContas } = ZERO;
    const parcial = { ...semContas, osSemTecnico: undefined } as unknown as DadosPendencias;
    expect([itemPendencia("osSemTecnico", parcial).valor, itemPendencia("contasPagarHoje", parcial).valor, itemPendencia("contasReceberHoje", parcial).valor]).toEqual([0, 0, 0]);
  });

  it("cada item tem o seu grupo do escopo do sino (a segunda trava da tela usa o mesmo)", () => {
    expect(Object.fromEntries((Object.keys(PENDENCIAS) as (keyof typeof PENDENCIAS)[]).map((id) => [id, escopoDoItem(id)]))).toEqual({
      osSemTecnico: "osSemTecnico", osAtrasadas: "prazos", atividadesEsquecidas: "atividadesEsquecidas", comentariosCampo: "comentariosCampo",
      pmocsVencendo: "pmoc", orcamentosVencendo: "orcamentosVencendo", despesasCampo: "despesasCampo", contasPagarHoje: "contasPagarHoje",
      contasReceberHoje: "contasReceberHoje", estoqueNegativoCampo: "estoqueNegativoCampo",
    });
  });
});

describe("as regras novas como where", () => {
  it("OS sem técnico: em aberto, com atividade em aberto sem técnico ou sem atividade (a cancelada não conta)", () => {
    expect(ATIVIDADE_EM_ABERTO).toEqual(["AGENDADA", "EM_ANDAMENTO"]);
    expect(whereOsSemTecnico()).toEqual({
      status: { notIn: ["CONCLUIDA", "CANCELADA"] },
      OR: [
        { atividades: { some: { status: { in: ["AGENDADA", "EM_ANDAMENTO"] }, tecnicoId: null } } },
        { atividades: { none: { status: { not: "CANCELADA" } } } },
      ],
    });
  });

  it("orçamento vencendo: enviado, de hoje até hoje + N dias (inclusive); o padrão é 3", () => {
    const hoje = new Date(Date.UTC(2027, 2, 10));
    expect(DIAS_ORCAMENTO_VENCENDO_PADRAO).toBe(3);
    expect(whereOrcamentoVencendo(hoje, 3)).toEqual({ status: "ENVIADO", validadeEm: { gte: hoje, lte: new Date(Date.UTC(2027, 2, 13)) } });
  });

  it("filtros das listas: ?tecnico=sem e ?validade=vencendo entram no AND; outro valor é ignorado", () => {
    const agora = new Date("2027-03-10T15:00:00.000Z");
    expect(whereOrdens("e1", { tecnico: "sem" }, agora).AND).toContainEqual(whereOsSemTecnico());
    expect(whereOrdens("e1", { tecnico: "x", periodo: "todos" }, agora).AND).toBeUndefined();
    const hoje = new Date(Date.UTC(2027, 2, 10));
    expect(whereOrcamentos("e1", { validade: "vencendo" }, agora).AND).toContainEqual(whereOrcamentoVencendo(hoje, 3));
    expect(whereOrcamentos("e1", { validade: "vencendo" }, agora, 7).AND).toContainEqual(whereOrcamentoVencendo(hoje, 7));
    expect(whereOrcamentos("e1", { validade: "x" }, agora).AND).toBeUndefined();
  });
});
